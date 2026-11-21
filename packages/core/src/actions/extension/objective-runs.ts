/**
 * Running the sector-objectives agent
 * (docs/extension/design/b0-vertical-slice.md §4, §5, criteria 8, 16, 17).
 *
 * The agent is shown a sector's gaps and drafts objectives that close them.
 * The steps are the gap agent's (`agent-runs.ts`): read what it will be
 * shown, ask the provider with no transaction open, write everything in one
 * Operation.
 *
 * **A drafted objective is a real objective, held back.** It is a row in the
 * product's own `goals`, made by the same function `goals.create` uses, so it
 * has its access wiring, its rhythm and its quality score. Three things mark
 * it: `draft_state` is `draft`, so it is not live; `ai_generated` is true;
 * and its profile names the run that drafted it. Approval, in a later
 * change, is what makes it live.
 *
 * **Its owner is given by rule and nobody has chosen it yet.** The sector's
 * lead when one is named, otherwise whoever ran the agent. The profile's
 * `owner_confirmed_at` stays null until a person confirms or changes the
 * owner, and an objective cannot be sent for approval before that
 * (criterion 17). The agent's output has no field for an owner.
 */
import {
  evidence,
  gapGoalLinks,
  goalStrategyProfiles,
  newId,
  PLANNING_RUN_STATUSES,
} from "@openokr/db";
import { verifyCitation } from "@openokr/knowledge";
import {
  type ObjectiveAgentOutput,
  type ObjectiveAgentRequest,
  parseObjectiveAgentOutput,
} from "@openokr/planning-agents";
import { z } from "zod";
import { ACCESS_LEVELS } from "../../access/levels.ts";
import { seedGoalFrequencyInTx } from "../../cadence/space-frequency.ts";
import { createGoalInTx } from "../../goals/service.ts";
import { OperationError } from "../../operations/operation.ts";
import { recomputeUnitQualityInTx } from "../../quality/service.ts";
import { type ActionCallContext, requireDeclaredAccess } from "../define.ts";
import { realign, recompute } from "../goals.ts";
import {
  type Prepared,
  prepare,
  type RunRecord,
  record,
  sameName,
} from "./agent-runs.ts";

const runInput = z.object({
  /** The sector's space. */
  spaceId: z.uuid(),
  /** The planning cycle the objectives are drafted for. */
  cycleId: z.uuid(),
});

const runOutput = z.object({
  runId: z.uuid(),
  status: z.enum(PLANNING_RUN_STATUSES),
  objectivesDrafted: z.number().int(),
});

interface ObjectiveToStore {
  readonly title: string;
  readonly proposedTarget: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly objectiveType: "sectoral" | "operational";
  /** The agency's space, or the sector's own. */
  readonly spaceId: string;
  readonly gapIds: readonly string[];
  readonly evidence: readonly {
    documentId: string;
    page: number;
    quote: string;
    verification: "verified" | "unverified";
    unverifiedReason: "too_short" | "not_on_page" | null;
  }[];
}

/** The gaps an objective may answer: every one that was not set aside. */
const answerable = (prepared: Prepared) =>
  prepared.gaps.filter((gap) => gap.status !== "dismissed");

/** What of the draft is stored, and what is left out and why. */
function settle(
  output: ObjectiveAgentOutput,
  prepared: Prepared,
  sectorSpaceId: string,
): { objectives: ObjectiveToStore[]; excluded: string[] } {
  const known = new Set(prepared.existingObjectives.map(sameName));
  const gaps = answerable(prepared);
  const excluded: string[] = [];
  const objectives: ObjectiveToStore[] = [];
  for (const drafted of output.objectives) {
    const name = sameName(drafted.title);
    if (known.has(name)) {
      excluded.push(`Already an objective of this sector: ${drafted.title}`);
      continue;
    }
    const gapIds: string[] = [];
    for (const named of drafted.gaps) {
      const gap = gaps.find((one) => sameName(one.title) === sameName(named));
      if (gap) {
        gapIds.push(gap.id);
      } else {
        excluded.push(
          `An objective named a gap the sector does not have: ${named}`,
        );
      }
    }
    if (gapIds.length === 0) {
      excluded.push(`Answers no gap of this sector: ${drafted.title}`);
      continue;
    }
    const kept: ObjectiveToStore["evidence"][number][] = [];
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
    const agency =
      drafted.agency === undefined
        ? undefined
        : prepared.agencies.find(
            (one) => sameName(one.name) === sameName(drafted.agency as string),
          );
    if (drafted.agency !== undefined && !agency) {
      excluded.push(
        `An objective named an agency the sector does not have, and was filed under the sector: ${drafted.agency}`,
      );
    }
    known.add(name);
    objectives.push({
      title: drafted.title,
      proposedTarget: drafted.proposedTarget,
      rationale: drafted.rationale,
      confidence: drafted.confidence,
      objectiveType: drafted.objectiveType,
      spaceId: agency?.spaceId ?? sectorSpaceId,
      gapIds: [...new Set(gapIds)],
      evidence: kept,
    });
  }
  return { objectives, excluded };
}

/** Writes the drafted objectives with everything that hangs on them. */
function writeObjectives(
  objectives: readonly ObjectiveToStore[],
  prepared: Prepared,
  cycleId: string,
): RunRecord["write"] {
  // By rule, and unconfirmed: the sector's lead, or whoever ran the agent.
  const ownerId = prepared.leadMemberId ?? prepared.memberId;
  return async (tx, workspaceId, runId) => {
    for (const objective of objectives) {
      const created = await createGoalInTx(tx, {
        workspaceId,
        title: objective.title,
        cycleId,
        level: "department",
        ownerKind: "space",
        spaceId: objective.spaceId,
        championId: ownerId,
        reviewerId: null,
        aiGenerated: true,
        // Held back until it is approved.
        draftState: "draft",
      });
      // What `goals.create` does after creating a draft: its rhythm, its
      // derived numbers, the alignment of its scope and the unit's quality.
      // No first due date, because a draft owes no check-in.
      await seedGoalFrequencyInTx(tx, {
        workspaceId,
        goalId: created.id,
        spaceId: objective.spaceId,
      });
      await recompute(tx, workspaceId, created.id);
      await realign(tx, workspaceId, created.id);
      await recomputeUnitQualityInTx(tx, { workspaceId, goalId: created.id });

      // openokr:allow-mutation: the run's own operation, on its transaction.
      await tx.insert(goalStrategyProfiles).values({
        id: newId(),
        workspaceId,
        goalId: created.id,
        objectiveType: objective.objectiveType,
        // The agent does not decide what is a priority. A person does.
        priority: "not_priority",
        planStatus: "new",
        // Drafted from the sector's documents: the first one it rests on.
        sourceKind: "sub_strategy",
        sourceDocumentId: objective.evidence[0]?.documentId ?? null,
        baselineUndetermined: false,
        proposedTarget: objective.proposedTarget,
        rationale: objective.rationale,
        confidence: objective.confidence,
        agentRunId: runId,
      });
      // openokr:allow-mutation: the same operation's transaction.
      await tx.insert(gapGoalLinks).values(
        objective.gapIds.map((gapId) => ({
          id: newId(),
          workspaceId,
          gapId,
          goalId: created.id,
        })),
      );
      // openokr:allow-mutation: the same operation's transaction.
      await tx.insert(evidence).values(
        objective.evidence.map((quotation) => ({
          id: newId(),
          workspaceId,
          subjectType: "goal" as const,
          subjectId: created.id,
          documentId: quotation.documentId,
          page: quotation.page,
          quote: quotation.quote,
          verification: quotation.verification,
          unverifiedReason: quotation.unverifiedReason,
          createdBy: prepared.memberId,
        })),
      );
    }
  };
}

export const runObjectiveAgent = {
  name: "planning.runObjectiveAgent" as const,
  summary:
    "Runs the sector-objectives agent on a sector's gaps. What it drafts is stored as objectives held back for review, each tied to the gaps it answers and with its quotations checked.",
  input: runInput,
  output: runOutput,
  access: ACCESS_LEVELS.edit,
  safety: "write" as const,
  runsThroughPipeline: true,
  async handler(context: ActionCallContext, rawInput: unknown) {
    await requireDeclaredAccess(
      context,
      ACCESS_LEVELS.edit,
      "planning.runObjectiveAgent",
    );
    const input = runInput.parse(rawInput);
    const prepared = await prepare(context, input.spaceId);
    const gaps = answerable(prepared);
    if (gaps.length === 0) {
      throw new OperationError(
        "conflict",
        "This sector has no gap to answer yet. Write a gap or run the gap agent first.",
      );
    }
    const planner = context.planner;
    if (!planner) {
      throw new OperationError(
        "forbidden",
        "Running an agent needs an AI provider, and none is configured.",
      );
    }

    const request: ObjectiveAgentRequest = {
      agent: "objectives",
      sector: prepared.sector,
      agencies: prepared.agencies.map((agency) => agency.name),
      gaps: gaps.map(({ title, description }) => ({ title, description })),
      documents: prepared.documents.map(({ title, pages }) => ({
        title,
        pages,
      })),
      existingObjectives: prepared.existingObjectives,
    };
    const started = Date.now();
    const base = {
      agent: "objectives" as const,
      action: "planning.runObjectiveAgent",
      provider: planner.name,
    };
    const failed = async (failure: string, model: string): Promise<never> => {
      await record(context, input.spaceId, prepared, {
        ...base,
        status: "failed",
        failure,
        model,
        output: null,
        report: { read: [], excluded: [] },
        durationMs: Date.now() - started,
        costUsd: null,
        drafted: 0,
        write: async () => undefined,
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
    const parsed = parseObjectiveAgentOutput(result.output);
    if (!parsed.ok) {
      return failed(parsed.problem, result.model);
    }

    const settled = settle(parsed.output, prepared, input.spaceId);
    const runId = await record(context, input.spaceId, prepared, {
      ...base,
      status: "succeeded",
      failure: null,
      model: result.model,
      output: parsed.output,
      report: {
        read: [...parsed.output.report.read],
        excluded: [...parsed.output.report.excluded, ...settled.excluded],
      },
      durationMs: Date.now() - started,
      costUsd: result.costUsd ?? null,
      drafted: settled.objectives.length,
      write: writeObjectives(settled.objectives, prepared, input.cycleId),
    });
    return {
      runId,
      status: "succeeded" as const,
      objectivesDrafted: settled.objectives.length,
    };
  },
};
