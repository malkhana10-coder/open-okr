/**
 * Running a planning agent, and the record of each run
 * (docs/extension/design/b0-vertical-slice.md §5, §5.1, criteria 2, 4, 16).
 *
 * **Three steps, and the provider is called between two transactions.** What
 * the agent will be shown is read first, with the caller's access decided.
 * Then the provider is asked, with no transaction open, because a call to a
 * model can take a minute. Then everything is written in one Operation: the
 * run, the gaps and their evidence, with the activity and audit rows.
 *
 * **Nothing the provider returns is trusted.** The output is parsed against
 * a strict contract, and one that claims a field the agent has no say in is
 * refused whole. A gap is stored as `ai_draft` because this code says so, not
 * because the output does. A quotation is verified here against the stored
 * page, and one that is not on its page is kept as unverified. A quotation
 * from a document the sector does not have is dropped. So text injected into
 * a source document can at worst produce a draft that a person reviews, with
 * its false quotation marked as false.
 *
 * **A failed run is recorded too.** A person who pressed the button and got
 * nothing should be able to see that it ran, when, and that it failed.
 */
import {
  activeOnly,
  evidence,
  newId,
  orgSectors,
  PLANNING_AGENTS,
  PLANNING_RUN_STATUSES,
  planningAgentRuns,
  sourceDocumentPages,
  sourceDocuments,
  spaces,
  strategicGaps,
  strategyDomains,
  withContext,
} from "@openokr/db";
import { normaliseArabic, verifyCitation } from "@openokr/knowledge";
import {
  type GapAgentOutput,
  type GapAgentRequest,
  parseGapAgentOutput,
} from "@openokr/planning-agents";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../../access/levels.ts";
import { getAccessScoped } from "../../access/reads.ts";
import {
  OperationError,
  type OperationTx,
  runOperation,
} from "../../operations/operation.ts";
import {
  type ActionCallContext,
  defineReadAction,
  requireDeclaredAccess,
} from "../define.ts";
import { actingMemberId } from "./acting-member.ts";

const runInput = z.object({
  /** The sector's space. */
  spaceId: z.uuid(),
});

const runOutput = z.object({
  runId: z.uuid(),
  status: z.enum(PLANNING_RUN_STATUSES),
  gapsDrafted: z.number().int(),
});

interface ShownDocument {
  readonly id: string;
  readonly title: string;
  readonly pages: readonly { page: number; text: string }[];
}

interface Prepared {
  readonly memberId: string;
  readonly sector: string;
  readonly documents: readonly ShownDocument[];
  readonly existingGaps: readonly string[];
  readonly domains: readonly { id: string; name: string }[];
}

const sectorNotFound = () =>
  new OperationError(
    "not_found",
    "No such sector, or you do not have access to it.",
  );

/** What the agent will be shown, for a caller who is in the sector. */
async function prepare(
  context: ActionCallContext,
  spaceId: string,
): Promise<Prepared> {
  const userId = context.actor.userId;
  if (!userId) {
    throw sectorNotFound();
  }
  return withContext(
    drizzle(context.pool),
    { workspaceId: context.workspaceId, userId },
    async (rawTx) => {
      const tx = rawTx as OperationTx;
      const memberId = await actingMemberId(tx, context.workspaceId, userId);
      await getAccessScoped(tx, {
        workspaceId: context.workspaceId,
        memberId,
        resourceType: "space",
        resourceId: spaceId,
        requires: ACCESS_LEVELS.edit,
      });
      const [sector] = await tx
        .select({ name: spaces.name })
        .from(orgSectors)
        .innerJoin(spaces, eq(spaces.id, orgSectors.spaceId))
        .where(
          activeOnly(
            orgSectors,
            eq(orgSectors.workspaceId, context.workspaceId),
            eq(orgSectors.spaceId, spaceId),
          ),
        )
        .limit(1);
      if (!sector) {
        throw sectorNotFound();
      }
      const documents = await tx
        .select({ id: sourceDocuments.id, title: sourceDocuments.title })
        .from(sourceDocuments)
        .where(
          activeOnly(
            sourceDocuments,
            eq(sourceDocuments.workspaceId, context.workspaceId),
            eq(sourceDocuments.spaceId, spaceId),
            eq(sourceDocuments.processingStatus, "ready"),
          ),
        )
        .orderBy(asc(sourceDocuments.createdAt), asc(sourceDocuments.id));
      const pages =
        documents.length === 0
          ? []
          : await tx
              .select({
                documentId: sourceDocumentPages.documentId,
                page: sourceDocumentPages.page,
                text: sourceDocumentPages.text,
              })
              .from(sourceDocumentPages)
              .where(
                activeOnly(
                  sourceDocumentPages,
                  eq(sourceDocumentPages.workspaceId, context.workspaceId),
                  inArray(
                    sourceDocumentPages.documentId,
                    documents.map((document) => document.id),
                  ),
                ),
              )
              .orderBy(asc(sourceDocumentPages.page));
      const gaps = await tx
        .select({ title: strategicGaps.title })
        .from(strategicGaps)
        .where(
          activeOnly(
            strategicGaps,
            eq(strategicGaps.workspaceId, context.workspaceId),
            eq(strategicGaps.spaceId, spaceId),
          ),
        );
      const domains = await tx
        .select({ id: strategyDomains.id, name: strategyDomains.name })
        .from(strategyDomains)
        .where(
          activeOnly(
            strategyDomains,
            eq(strategyDomains.workspaceId, context.workspaceId),
          ),
        );
      return {
        memberId,
        sector: sector.name,
        documents: documents.map((document) => ({
          ...document,
          pages: pages
            .filter((page) => page.documentId === document.id)
            .map(({ page, text }) => ({ page, text })),
        })),
        existingGaps: gaps.map((gap) => gap.title),
        domains,
      };
    },
  );
}

interface GapToStore {
  readonly title: string;
  readonly description: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly domainId: string | null;
  readonly evidence: readonly {
    documentId: string;
    page: number;
    quote: string;
    verification: "verified" | "unverified";
    unverifiedReason: "too_short" | "not_on_page" | null;
  }[];
}

/** Names compared the way a reader would call them the same. */
const sameName = (text: string) =>
  normaliseArabic(text).replace(/\s+/g, " ").trim();

/**
 * What of the agent's draft is stored, and what is left out and why.
 *
 * The decisions here are the system's, not the agent's: which gaps are new,
 * which quotations point at a page the sector really has, and whether each
 * one is on that page.
 */
function settle(
  output: GapAgentOutput,
  prepared: Prepared,
): { gaps: GapToStore[]; excluded: string[] } {
  const known = new Set(prepared.existingGaps.map(sameName));
  const excluded: string[] = [];
  const gaps: GapToStore[] = [];
  for (const drafted of output.gaps) {
    const name = sameName(drafted.title);
    if (known.has(name)) {
      excluded.push(`Already a gap of this sector: ${drafted.title}`);
      continue;
    }
    const kept: GapToStore["evidence"][number][] = [];
    for (const quotation of drafted.evidence) {
      const document = prepared.documents.find(
        (one) => sameName(one.title) === sameName(quotation.document),
      );
      const page = document?.pages.find((one) => one.page === quotation.page);
      if (!document || !page) {
        excluded.push(
          `A quotation named a page the sector does not have: ${quotation.document}, page ${quotation.page}`,
        );
        continue;
      }
      const verdict = verifyCitation({
        quote: quotation.quote,
        pageText: page.text,
      });
      kept.push({
        documentId: document.id,
        page: quotation.page,
        // The page's wording when the check restored a conjunction.
        quote: verdict.status === "verified" ? verdict.quote : quotation.quote,
        verification: verdict.status,
        unverifiedReason:
          verdict.status === "unverified" ? verdict.reason : null,
      });
    }
    if (kept.length === 0) {
      excluded.push(`No quotation left to rest on: ${drafted.title}`);
      continue;
    }
    known.add(name);
    gaps.push({
      title: drafted.title,
      description: drafted.description,
      rationale: drafted.rationale,
      confidence: drafted.confidence,
      domainId:
        prepared.domains.find(
          (domain) =>
            drafted.domain !== undefined &&
            sameName(domain.name) === sameName(drafted.domain),
        )?.id ?? null,
      evidence: kept,
    });
  }
  return { gaps, excluded };
}

interface RunRecord {
  readonly status: "succeeded" | "failed";
  readonly failure: string | null;
  readonly provider: string;
  readonly model: string;
  readonly output: GapAgentOutput | null;
  readonly report: { read: string[]; excluded: string[] };
  readonly durationMs: number;
  readonly costUsd: number | null;
  readonly gaps: readonly GapToStore[];
}

/** Writes the run and what came of it, in one Operation. */
async function record(
  context: ActionCallContext,
  spaceId: string,
  prepared: Prepared,
  run: RunRecord,
): Promise<string> {
  const runId = newId();
  await runOperation(
    { pool: context.pool },
    {
      action: "planning.runGapAgent",
      workspaceId: context.workspaceId,
      actor: context.actor,
      async execute({ tx, workspaceId }) {
        // openokr:allow-mutation: this is the operation's own execute, on the
        // transaction runOperation opened.
        await tx.insert(planningAgentRuns).values({
          id: runId,
          workspaceId,
          spaceId,
          agent: "gaps",
          provider: run.provider,
          model: run.model,
          status: run.status,
          failure: run.failure,
          input: {
            sector: prepared.sector,
            documents: prepared.documents.map((document) => ({
              id: document.id,
              title: document.title,
              pages: document.pages.length,
            })),
            existingGaps: prepared.existingGaps.length,
          },
          output: run.output,
          report: run.report,
          documentsUsed: prepared.documents.map((document) => document.id),
          durationMs: run.durationMs,
          costUsd: run.costUsd === null ? null : String(run.costUsd),
          startedBy: prepared.memberId,
        });
        for (const gap of run.gaps) {
          const gapId = newId();
          // openokr:allow-mutation: the same operation's transaction.
          await tx.insert(strategicGaps).values({
            id: gapId,
            workspaceId,
            spaceId,
            domainId: gap.domainId,
            title: gap.title,
            description: gap.description,
            rationale: gap.rationale,
            confidence: gap.confidence,
            // Always. The agent's output has no field that could say else.
            status: "ai_draft",
            createdBy: prepared.memberId,
            agentRunId: runId,
          });
          // openokr:allow-mutation: the same operation's transaction.
          await tx.insert(evidence).values(
            gap.evidence.map((quotation) => ({
              id: newId(),
              workspaceId,
              subjectType: "gap" as const,
              subjectId: gapId,
              documentId: quotation.documentId,
              page: quotation.page,
              quote: quotation.quote,
              verification: quotation.verification,
              unverifiedReason: quotation.unverifiedReason,
              createdBy: prepared.memberId,
            })),
          );
        }
        return {
          result: undefined,
          activity: {
            kind: "planning.agent_run" as const,
            subjectType: "space" as const,
            subjectId: spaceId,
            payload: {
              agent: "gaps",
              status: run.status,
              drafted: run.gaps.length,
            },
          },
          audit: {
            action: "planning.runGapAgent",
            targetType: "planning_agent_run",
            targetId: runId,
            payload: {
              spaceId,
              provider: run.provider,
              model: run.model,
              status: run.status,
              drafted: run.gaps.length,
            },
          },
        };
      },
    },
  );
  return runId;
}

export const runGapAgent = {
  name: "planning.runGapAgent" as const,
  summary:
    "Runs the gap agent on a sector's source documents. What it drafts is stored as drafts for a person to review, each with its quotations checked against their pages.",
  input: runInput,
  output: runOutput,
  access: ACCESS_LEVELS.edit,
  safety: "write" as const,
  runsThroughPipeline: true,
  async handler(context: ActionCallContext, rawInput: unknown) {
    await requireDeclaredAccess(
      context,
      ACCESS_LEVELS.edit,
      "planning.runGapAgent",
    );
    const input = runInput.parse(rawInput);
    const prepared = await prepare(context, input.spaceId);
    if (prepared.documents.length === 0) {
      throw new OperationError(
        "conflict",
        "This sector has no source document that has been read yet. Upload a document and wait until it is ready.",
      );
    }
    const planner = context.planner;
    if (!planner) {
      throw new OperationError(
        "forbidden",
        "Running an agent needs an AI provider, and none is configured.",
      );
    }

    const request: GapAgentRequest = {
      agent: "gaps",
      sector: prepared.sector,
      documents: prepared.documents.map(({ title, pages }) => ({
        title,
        pages,
      })),
      existingGaps: prepared.existingGaps,
    };
    const started = Date.now();
    const failed = async (failure: string, model: string): Promise<never> => {
      await record(context, input.spaceId, prepared, {
        status: "failed",
        failure,
        provider: planner.name,
        model,
        output: null,
        report: { read: [], excluded: [] },
        durationMs: Date.now() - started,
        costUsd: null,
        gaps: [],
      });
      throw new OperationError(
        "conflict",
        "The agent returned nothing that could be used. The run is recorded, and nothing was drafted.",
      );
    };

    let result: Awaited<ReturnType<typeof planner.generate>>;
    try {
      result = await planner.generate(request);
    } catch (error) {
      return failed(
        error instanceof Error ? error.message : String(error),
        planner.name,
      );
    }
    const parsed = parseGapAgentOutput(result.output);
    if (!parsed.ok) {
      return failed(parsed.problem, result.model);
    }

    const settled = settle(parsed.output, prepared);
    const runId = await record(context, input.spaceId, prepared, {
      status: "succeeded",
      failure: null,
      provider: planner.name,
      model: result.model,
      output: parsed.output,
      report: {
        read: [...parsed.output.report.read],
        excluded: [...parsed.output.report.excluded, ...settled.excluded],
      },
      durationMs: Date.now() - started,
      costUsd: result.costUsd ?? null,
      gaps: settled.gaps,
    });
    return {
      runId,
      status: "succeeded" as const,
      gapsDrafted: settled.gaps.length,
    };
  },
};

export const listRuns = defineReadAction({
  name: "planning.listRuns",
  summary:
    "The planning agents' runs on a sector, newest first, each with what the agent read and what was left out.",
  input: z.object({ spaceId: z.uuid() }),
  output: z.object({
    runs: z.array(
      z.object({
        id: z.uuid(),
        agent: z.enum(PLANNING_AGENTS),
        status: z.enum(PLANNING_RUN_STATUSES),
        provider: z.string(),
        model: z.string(),
        /** The drafts were written in advance and no model was asked. */
        fixed: z.boolean(),
        documentsUsed: z.array(z.uuid()),
        report: z.object({
          read: z.array(z.string()),
          excluded: z.array(z.string()),
        }),
        failure: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const userId = context.actor.userId;
    if (!userId) {
      throw sectorNotFound();
    }
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMemberId(tx, context.workspaceId, userId);
        await getAccessScoped(tx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "space",
          resourceId: input.spaceId,
          requires: ACCESS_LEVELS.edit,
        });
        const runs = await tx
          .select({
            id: planningAgentRuns.id,
            agent: planningAgentRuns.agent,
            status: planningAgentRuns.status,
            provider: planningAgentRuns.provider,
            model: planningAgentRuns.model,
            documentsUsed: planningAgentRuns.documentsUsed,
            report: planningAgentRuns.report,
            failure: planningAgentRuns.failure,
            createdAt: planningAgentRuns.createdAt,
          })
          .from(planningAgentRuns)
          .where(
            activeOnly(
              planningAgentRuns,
              and(
                eq(planningAgentRuns.workspaceId, context.workspaceId),
                eq(planningAgentRuns.spaceId, input.spaceId),
              ),
            ),
          )
          .orderBy(
            desc(planningAgentRuns.createdAt),
            desc(planningAgentRuns.id),
          );
        return {
          runs: runs.map((run) => ({
            ...run,
            fixed: run.provider === "fixed",
            report: {
              read: [...run.report.read],
              excluded: [...run.report.excluded],
            },
            createdAt: run.createdAt.toISOString(),
          })),
        };
      },
    );
  },
});
