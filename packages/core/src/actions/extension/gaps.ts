/**
 * Strategic gaps, written and kept by hand
 * (docs/extension/design/b0-vertical-slice.md §4, §5 and criterion 13).
 *
 * Everything here works with no AI provider. An agent that drafts gaps
 * arrives in a later change and writes into the same table with the status
 * `ai_draft`; what a person writes is a `draft`.
 *
 * **Measured on the sector, at `edit`.** A gap says what a sector is failing
 * to do, drawn from its strategy, so it is for the people who work in the
 * sector. Every member can see that a sector exists; being in it is what
 * `edit` on its space means. Somebody outside gets not-found for all four
 * actions, the same answer as for a gap that does not exist.
 */
import {
  activeOnly,
  GAP_STATUSES,
  newId,
  orgSectors,
  strategicGaps,
  strategyDomains,
  withContext,
} from "@openokr/db";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../../access/levels.ts";
import { getAccessScoped } from "../../access/reads.ts";
import {
  OperationError,
  type OperationTx,
} from "../../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "../define.ts";
import { actingMemberId } from "./acting-member.ts";

type GapStatus = (typeof GAP_STATUSES)[number];

/**
 * The statuses in which a gap may still be changed or set aside: before it
 * is sent, and after it comes back. Under review and approved it is what a
 * decision was, or will be, taken on.
 */
const OPEN_TO_CHANGE: ReadonlySet<GapStatus> = new Set([
  "draft",
  "ai_draft",
  "returned",
]);

const title = z.string().trim().min(1).max(300);
const prose = z.string().trim().min(1).max(4000);

export async function inSector(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  spaceId: string,
): Promise<void> {
  await getAccessScoped(tx, {
    workspaceId,
    memberId,
    resourceType: "space",
    resourceId: spaceId,
    requires: ACCESS_LEVELS.edit,
  });
}

async function domainOf(
  tx: OperationTx,
  workspaceId: string,
  domainId: string,
): Promise<void> {
  const [domain] = await tx
    .select({ id: strategyDomains.id })
    .from(strategyDomains)
    .where(
      activeOnly(
        strategyDomains,
        eq(strategyDomains.workspaceId, workspaceId),
        eq(strategyDomains.id, domainId),
      ),
    )
    .limit(1);
  if (!domain) {
    throw new OperationError("not_found", "No such strategic domain.");
  }
}

/** The gap, once the caller is known to be in its sector. Not found otherwise. */
export async function gapForChange(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  id: string,
): Promise<{ spaceId: string; title: string; status: GapStatus }> {
  const [gap] = await tx
    .select({
      spaceId: strategicGaps.spaceId,
      title: strategicGaps.title,
      status: strategicGaps.status,
    })
    .from(strategicGaps)
    .where(
      activeOnly(
        strategicGaps,
        eq(strategicGaps.workspaceId, workspaceId),
        eq(strategicGaps.id, id),
      ),
    )
    .limit(1);
  if (!gap) {
    throw new OperationError(
      "not_found",
      "No such gap, or you do not have access to it.",
    );
  }
  await inSector(tx, workspaceId, memberId, gap.spaceId);
  return gap;
}

export function refuseUnlessOpen(status: GapStatus): void {
  if (!OPEN_TO_CHANGE.has(status)) {
    throw new OperationError(
      "conflict",
      status === "dismissed"
        ? "This gap was set aside and can no longer be changed."
        : "This gap has been sent for approval and can no longer be changed.",
    );
  }
}

export const createGap = defineWriteAction({
  name: "strategy.createGap",
  summary:
    "Writes a strategic gap for a sector: something its strategy asks for that the sector is not yet doing.",
  input: z.object({
    /** The sector's space. */
    spaceId: z.uuid(),
    title,
    description: prose.optional(),
    /** Why this is a gap. */
    rationale: prose.optional(),
    domainId: z.uuid().optional(),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMemberId(
        tx,
        workspaceId,
        context.actor.userId,
      );
      await inSector(tx, workspaceId, memberId, input.spaceId);
      const [sector] = await tx
        .select({ id: orgSectors.id })
        .from(orgSectors)
        .where(
          activeOnly(
            orgSectors,
            eq(orgSectors.workspaceId, workspaceId),
            eq(orgSectors.spaceId, input.spaceId),
          ),
        )
        .limit(1);
      if (!sector) {
        throw new OperationError(
          "conflict",
          "A gap is filed under a sector, and this space is not one.",
        );
      }
      if (input.domainId) {
        await domainOf(tx, workspaceId, input.domainId);
      }
      const id = newId();
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx.insert(strategicGaps).values({
        id,
        workspaceId,
        spaceId: input.spaceId,
        domainId: input.domainId ?? null,
        title: input.title,
        description: input.description ?? null,
        rationale: input.rationale ?? null,
        status: "draft",
        createdBy: memberId,
      });
      return {
        result: { id },
        activity: {
          kind: "strategy.gap_created" as const,
          subjectType: "space" as const,
          subjectId: input.spaceId,
          payload: { title: input.title },
        },
        audit: {
          action: "strategy.createGap",
          targetType: "strategic_gap",
          targetId: id,
          payload: { title: input.title, spaceId: input.spaceId },
        },
      };
    },
  }),
});

export const updateGap = defineWriteAction({
  name: "strategy.updateGap",
  summary:
    "Changes a strategic gap that has not been sent for approval, or that came back.",
  input: z.object({
    id: z.uuid(),
    title: title.optional(),
    /** Null clears it. Left out, it stays as it is. */
    description: prose.nullable().optional(),
    rationale: prose.nullable().optional(),
    domainId: z.uuid().nullable().optional(),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMemberId(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const gap = await gapForChange(tx, workspaceId, memberId, input.id);
      refuseUnlessOpen(gap.status);
      if (input.domainId) {
        await domainOf(tx, workspaceId, input.domainId);
      }
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(strategicGaps)
        .set({
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          ...(input.rationale === undefined
            ? {}
            : { rationale: input.rationale }),
          ...(input.domainId === undefined ? {} : { domainId: input.domainId }),
          updatedAt: new Date(),
        })
        .where(activeOnly(strategicGaps, eq(strategicGaps.id, input.id)));
      const named = input.title ?? gap.title;
      return {
        result: { id: input.id },
        activity: {
          kind: "strategy.gap_updated" as const,
          subjectType: "space" as const,
          subjectId: gap.spaceId,
          payload: { title: named },
        },
        audit: {
          action: "strategy.updateGap",
          targetType: "strategic_gap",
          targetId: input.id,
          payload: { title: named },
        },
      };
    },
  }),
});

export const dismissGap = defineWriteAction({
  name: "strategy.dismissGap",
  summary:
    "Sets a strategic gap aside. It stays on record, so the same gap is not drafted again.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMemberId(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const gap = await gapForChange(tx, workspaceId, memberId, input.id);
      refuseUnlessOpen(gap.status);
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(strategicGaps)
        .set({ status: "dismissed", updatedAt: new Date() })
        .where(activeOnly(strategicGaps, eq(strategicGaps.id, input.id)));
      return {
        result: { id: input.id },
        activity: {
          kind: "strategy.gap_dismissed" as const,
          subjectType: "space" as const,
          subjectId: gap.spaceId,
          payload: { title: gap.title },
        },
        audit: {
          action: "strategy.dismissGap",
          targetType: "strategic_gap",
          targetId: input.id,
          payload: { title: gap.title, from: gap.status },
        },
      };
    },
  }),
});

export const listGaps = defineReadAction({
  name: "strategy.listGaps",
  summary: "A sector's strategic gaps, with where each one stands.",
  input: z.object({ spaceId: z.uuid() }),
  output: z.object({
    gaps: z.array(
      z.object({
        id: z.uuid(),
        title: z.string(),
        description: z.string().nullable(),
        rationale: z.string().nullable(),
        domainId: z.uuid().nullable(),
        confidence: z.number().int().nullable(),
        status: z.enum(GAP_STATUSES),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMemberId(tx, context.workspaceId, userId);
        await inSector(tx, context.workspaceId, memberId, input.spaceId);
        const gaps = await tx
          .select({
            id: strategicGaps.id,
            title: strategicGaps.title,
            description: strategicGaps.description,
            rationale: strategicGaps.rationale,
            domainId: strategicGaps.domainId,
            confidence: strategicGaps.confidence,
            status: strategicGaps.status,
          })
          .from(strategicGaps)
          .where(
            activeOnly(
              strategicGaps,
              eq(strategicGaps.workspaceId, context.workspaceId),
              eq(strategicGaps.spaceId, input.spaceId),
            ),
          )
          .orderBy(asc(strategicGaps.createdAt), asc(strategicGaps.id));
        return { gaps };
      },
    );
  },
});
