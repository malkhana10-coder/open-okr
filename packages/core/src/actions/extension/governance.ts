/**
 * Approval in one step
 * (docs/extension/design/b0-vertical-slice.md §13, criteria 5, 9, 10, 11, 17).
 *
 * The strategy office sends a sector's open gaps and drafted objectives as
 * one request. Leadership approves the batch or returns it with a comment.
 *
 * **Who may do which is the role matrix's answer.** Each request owns an
 * access context of type `approval`, and a role's level on the `approval`
 * domain is its level on every request. Sending asks for `edit` there and
 * deciding asks for `full`, both through the same access getter every other
 * read and write uses. The built-in Owner holds `full`, an Admin `edit`.
 *
 * **One rule is not a level: nobody decides what they sent.** The Owner may
 * send and may decide, and not the same request. That is checked here, and
 * held by the table too.
 *
 * **Approving is what makes a drafted objective live**, through the function
 * the product's own draft approval uses. Nothing else does: the product's
 * publish refuses an objective an agent drafted (`held-for-approval.ts`).
 */
import {
  activeOnly,
  approvalItems,
  approvalRequests,
  evidence,
  goalStrategyProfiles,
  goals,
  newId,
  orgAgencies,
  orgSectors,
  spaces,
  strategicGaps,
  withContext,
} from "@openokr/db";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ensureContext } from "../../access/contexts.ts";
import { ACCESS_LEVELS } from "../../access/levels.ts";
import { getAccessScoped } from "../../access/reads.ts";
import { resolveRhythm } from "../../cycles/rhythm.ts";
import { readRhythmRow } from "../../cycles/service.ts";
import {
  OperationError,
  type OperationTx,
} from "../../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "../define.ts";
import { moveDraft } from "../goal-drafts.ts";
import { actingMemberId } from "./acting-member.ts";

/** Gaps in these statuses are sent: not yet sent, or sent back. */
const OPEN_GAPS = ["draft", "ai_draft", "returned"] as const;

const sectorNotFound = () =>
  new OperationError(
    "not_found",
    "No such sector, or you do not have access to it.",
  );

const requestNotFound = () =>
  new OperationError(
    "not_found",
    "No such approval request, or you do not have access to it.",
  );

/** The sector's own space and the spaces of its agencies. */
async function sectorSpaces(
  tx: OperationTx,
  workspaceId: string,
  spaceId: string,
): Promise<string[]> {
  const [sector] = await tx
    .select({ id: orgSectors.id })
    .from(orgSectors)
    .where(
      activeOnly(
        orgSectors,
        eq(orgSectors.workspaceId, workspaceId),
        eq(orgSectors.spaceId, spaceId),
      ),
    )
    .limit(1);
  if (!sector) {
    throw sectorNotFound();
  }
  const agencies = await tx
    .select({ spaceId: orgAgencies.spaceId })
    .from(orgAgencies)
    .where(
      activeOnly(
        orgAgencies,
        eq(orgAgencies.workspaceId, workspaceId),
        eq(orgAgencies.sectorId, sector.id),
      ),
    );
  return [spaceId, ...agencies.map((agency) => agency.spaceId)];
}

export const confirmGoalOwner = defineWriteAction({
  name: "strategy.confirmGoalOwner",
  summary:
    "Confirms the owner of an objective an agent drafted. The owner was given by rule, and the objective cannot be sent for approval until a person has confirmed it.",
  input: z.object({ goalId: z.uuid() }),
  output: z.object({ goalId: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMemberId(
        tx,
        workspaceId,
        context.actor.userId,
      );
      await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "goal",
        resourceId: input.goalId,
        requires: ACCESS_LEVELS.edit,
      });
      const [profile] = await tx
        .select({ id: goalStrategyProfiles.id })
        .from(goalStrategyProfiles)
        .where(
          activeOnly(
            goalStrategyProfiles,
            and(
              eq(goalStrategyProfiles.workspaceId, workspaceId),
              eq(goalStrategyProfiles.goalId, input.goalId),
              isNotNull(goalStrategyProfiles.agentRunId),
            ),
          ),
        )
        .limit(1);
      if (!profile) {
        throw new OperationError(
          "conflict",
          "Only an objective an agent drafted has an owner to confirm.",
        );
      }
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(goalStrategyProfiles)
        .set({
          ownerConfirmedAt: new Date(),
          ownerConfirmedBy: memberId,
          updatedAt: new Date(),
        })
        .where(
          activeOnly(
            goalStrategyProfiles,
            eq(goalStrategyProfiles.id, profile.id),
          ),
        );
      return {
        result: { goalId: input.goalId },
        activity: {
          kind: "strategy.goal_owner_confirmed" as const,
          subjectType: "goal" as const,
          subjectId: input.goalId,
          payload: {},
        },
        audit: {
          action: "strategy.confirmGoalOwner",
          targetType: "goal",
          targetId: input.goalId,
          payload: { confirmedBy: memberId },
        },
      };
    },
  }),
});

export const submitForApproval = defineWriteAction({
  name: "governance.submit",
  summary:
    "Sends a sector's open gaps and drafted objectives for approval as one request. Refused while any of them rests on an unverified quotation, or while a drafted objective's owner is unconfirmed.",
  input: z.object({
    /** The sector's space. */
    spaceId: z.uuid(),
  }),
  output: z.object({
    requestId: z.uuid(),
    gaps: z.number().int(),
    objectives: z.number().int(),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMemberId(
        tx,
        workspaceId,
        context.actor.userId,
      );
      await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "space",
        resourceId: input.spaceId,
        requires: ACCESS_LEVELS.edit,
      });
      const spaceIds = await sectorSpaces(tx, workspaceId, input.spaceId);

      const [open] = await tx
        .select({ id: approvalRequests.id })
        .from(approvalRequests)
        .where(
          activeOnly(
            approvalRequests,
            and(
              eq(approvalRequests.workspaceId, workspaceId),
              eq(approvalRequests.spaceId, input.spaceId),
              eq(approvalRequests.status, "open"),
            ),
          ),
        )
        .limit(1);
      if (open) {
        throw new OperationError(
          "conflict",
          "This sector already has a request waiting for a decision.",
        );
      }

      const gaps = await tx
        .select({ id: strategicGaps.id })
        .from(strategicGaps)
        .where(
          activeOnly(
            strategicGaps,
            and(
              eq(strategicGaps.workspaceId, workspaceId),
              eq(strategicGaps.spaceId, input.spaceId),
              inArray(strategicGaps.status, [...OPEN_GAPS]),
            ),
          ),
        )
        .orderBy(asc(strategicGaps.createdAt));
      const objectives = await tx
        .select({
          id: goals.id,
          ownerConfirmedAt: goalStrategyProfiles.ownerConfirmedAt,
        })
        // openokr:allow-raw-read: the sector's drafted objectives, for a
        // caller the getter above found to hold `edit` on the sector.
        .from(goals)
        .innerJoin(
          goalStrategyProfiles,
          and(
            eq(goalStrategyProfiles.goalId, goals.id),
            activeOnly(goalStrategyProfiles),
            isNotNull(goalStrategyProfiles.agentRunId),
          ),
        )
        .where(
          activeOnly(
            goals,
            and(
              eq(goals.workspaceId, workspaceId),
              eq(goals.ownerKind, "space"),
              inArray(goals.spaceId, spaceIds),
              eq(goals.draftState, "draft"),
            ),
          ),
        )
        .orderBy(asc(goals.createdAt));
      if (gaps.length === 0 && objectives.length === 0) {
        throw new OperationError(
          "conflict",
          "There is nothing to send: no open gap and no drafted objective.",
        );
      }

      const unconfirmed = objectives.filter(
        (objective) => objective.ownerConfirmedAt === null,
      ).length;
      if (unconfirmed > 0) {
        throw new OperationError(
          "conflict",
          `The owner of ${unconfirmed} drafted objective(s) has not been confirmed. Confirm or change each owner first.`,
        );
      }
      const subjects = [
        ...gaps.map((gap) => gap.id),
        ...objectives.map((objective) => objective.id),
      ];
      const loose = await tx
        .select({ id: evidence.id })
        .from(evidence)
        .where(
          activeOnly(
            evidence,
            and(
              eq(evidence.workspaceId, workspaceId),
              inArray(evidence.subjectId, subjects),
              eq(evidence.verification, "unverified"),
            ),
          ),
        );
      if (loose.length > 0) {
        throw new OperationError(
          "conflict",
          `This batch holds ${loose.length} unverified quotation(s). Correct or remove each one first.`,
        );
      }

      const requestId = newId();
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx.insert(approvalRequests).values({
        id: requestId,
        workspaceId,
        spaceId: input.spaceId,
        submittedBy: memberId,
      });
      await ensureContext(tx, {
        workspaceId,
        resourceType: "approval",
        resourceId: requestId,
      });
      // Sending is the strategy office's: `edit` on the approval domain,
      // asked of the request just made. A refusal rolls everything back.
      try {
        await getAccessScoped(tx, {
          workspaceId,
          memberId,
          resourceType: "approval",
          resourceId: requestId,
          requires: ACCESS_LEVELS.edit,
        });
      } catch (error) {
        if (error instanceof OperationError && error.code === "not_found") {
          throw new OperationError(
            "forbidden",
            "Sending for approval is for the strategy office. Your role does not include it.",
          );
        }
        throw error;
      }

      // openokr:allow-mutation: the same operation's transaction.
      await tx.insert(approvalItems).values([
        ...gaps.map((gap) => ({
          id: newId(),
          workspaceId,
          requestId,
          subjectType: "gap" as const,
          subjectId: gap.id,
        })),
        ...objectives.map((objective) => ({
          id: newId(),
          workspaceId,
          requestId,
          subjectType: "goal" as const,
          subjectId: objective.id,
        })),
      ]);
      if (gaps.length > 0) {
        // openokr:allow-mutation: the same operation's transaction.
        await tx
          .update(strategicGaps)
          .set({ status: "in_review", updatedAt: new Date() })
          .where(
            activeOnly(
              strategicGaps,
              inArray(
                strategicGaps.id,
                gaps.map((gap) => gap.id),
              ),
            ),
          );
      }
      return {
        result: {
          requestId,
          gaps: gaps.length,
          objectives: objectives.length,
        },
        activity: {
          kind: "governance.submitted" as const,
          subjectType: "space" as const,
          subjectId: input.spaceId,
          payload: { gaps: gaps.length, objectives: objectives.length },
        },
        audit: {
          action: "governance.submit",
          targetType: "approval_request",
          targetId: requestId,
          payload: {
            spaceId: input.spaceId,
            gaps: gaps.length,
            objectives: objectives.length,
          },
        },
      };
    },
  }),
});

export const decideApproval = defineWriteAction({
  name: "governance.decide",
  summary:
    "Approves an approval request, or returns it with a comment. Approving makes its drafted objectives live. The person who sent a request cannot decide it.",
  input: z.object({
    requestId: z.uuid(),
    decision: z.enum(["approve", "return"]),
    /** Asked for when returning: what has to change. */
    comment: z.string().trim().min(1).max(2000).optional(),
  }),
  output: z.object({
    requestId: z.uuid(),
    status: z.enum(["approved", "returned"]),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMemberId(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const [request] = await tx
        .select({
          spaceId: approvalRequests.spaceId,
          submittedBy: approvalRequests.submittedBy,
          status: approvalRequests.status,
        })
        .from(approvalRequests)
        .where(
          activeOnly(
            approvalRequests,
            and(
              eq(approvalRequests.workspaceId, workspaceId),
              eq(approvalRequests.id, input.requestId),
            ),
          ),
        )
        .limit(1);
      if (!request) {
        throw requestNotFound();
      }
      // Deciding is leadership's: `full` on the approval domain.
      await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "approval",
        resourceId: input.requestId,
        requires: ACCESS_LEVELS.full,
      });
      if (request.submittedBy === memberId) {
        throw new OperationError(
          "forbidden",
          "You sent this request, so somebody else has to decide it.",
        );
      }
      if (request.status !== "open") {
        throw new OperationError(
          "conflict",
          "This request has already been decided.",
        );
      }
      if (input.decision === "return" && !input.comment) {
        throw new OperationError(
          "conflict",
          "Say what has to change when returning a request.",
        );
      }

      const approved = input.decision === "approve";
      const status = approved ? ("approved" as const) : ("returned" as const);
      const now = new Date();
      const items = await tx
        .select({
          subjectType: approvalItems.subjectType,
          subjectId: approvalItems.subjectId,
        })
        .from(approvalItems)
        .where(
          activeOnly(
            approvalItems,
            and(
              eq(approvalItems.workspaceId, workspaceId),
              eq(approvalItems.requestId, input.requestId),
            ),
          ),
        );
      const gapIds = items
        .filter((item) => item.subjectType === "gap")
        .map((item) => item.subjectId);
      const goalIds = items
        .filter((item) => item.subjectType === "goal")
        .map((item) => item.subjectId);

      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(approvalRequests)
        .set({
          status,
          decidedBy: memberId,
          decidedAt: now,
          comment: input.comment ?? null,
          updatedAt: now,
        })
        .where(
          activeOnly(
            approvalRequests,
            eq(approvalRequests.id, input.requestId),
          ),
        );
      // openokr:allow-mutation: the same operation's transaction.
      await tx
        .update(approvalItems)
        .set({ decision: status, updatedAt: now })
        .where(
          activeOnly(
            approvalItems,
            eq(approvalItems.requestId, input.requestId),
          ),
        );
      if (gapIds.length > 0) {
        // openokr:allow-mutation: the same operation's transaction.
        await tx
          .update(strategicGaps)
          .set({ status, updatedAt: now })
          .where(activeOnly(strategicGaps, inArray(strategicGaps.id, gapIds)));
      }
      if (approved && goalIds.length > 0) {
        // Live, by the function the product's own draft approval uses: the
        // draft state is cleared and the check-in rhythm starts.
        const thresholds = resolveRhythm(
          await readRhythmRow(tx, workspaceId),
        ).thresholds;
        for (const goalId of goalIds) {
          await moveDraft(tx, workspaceId, goalId, null, thresholds);
        }
      }
      return {
        result: { requestId: input.requestId, status },
        activity: {
          kind: "governance.decided" as const,
          subjectType: "space" as const,
          subjectId: request.spaceId,
          payload: {
            status,
            gaps: gapIds.length,
            objectives: goalIds.length,
          },
        },
        audit: {
          action: "governance.decide",
          targetType: "approval_request",
          targetId: input.requestId,
          payload: {
            status,
            spaceId: request.spaceId,
            gaps: gapIds.length,
            objectives: goalIds.length,
          },
        },
      };
    },
  }),
});

export const myNext = defineReadAction({
  name: "governance.myNext",
  summary:
    "What waits for you in approvals: requests you may decide, and requests of yours that came back.",
  input: z.object({}),
  output: z.object({
    toDecide: z.array(
      z.object({
        requestId: z.uuid(),
        spaceId: z.uuid(),
        spaceName: z.string(),
        gaps: z.number().int(),
        objectives: z.number().int(),
      }),
    ),
    returned: z.array(
      z.object({
        requestId: z.uuid(),
        spaceId: z.uuid(),
        spaceName: z.string(),
        comment: z.string(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context) {
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
        const requests = await tx
          .select({
            id: approvalRequests.id,
            spaceId: approvalRequests.spaceId,
            spaceName: spaces.name,
            submittedBy: approvalRequests.submittedBy,
            status: approvalRequests.status,
            comment: approvalRequests.comment,
          })
          .from(approvalRequests)
          .innerJoin(spaces, eq(spaces.id, approvalRequests.spaceId))
          .where(
            activeOnly(
              approvalRequests,
              eq(approvalRequests.workspaceId, context.workspaceId),
            ),
          )
          .orderBy(desc(approvalRequests.createdAt), desc(approvalRequests.id));

        const toDecide: {
          requestId: string;
          spaceId: string;
          spaceName: string;
          gaps: number;
          objectives: number;
        }[] = [];
        for (const request of requests) {
          if (request.status !== "open" || request.submittedBy === memberId) {
            continue;
          }
          // The matrix decides, request by request, as it will on the write.
          try {
            await getAccessScoped(tx, {
              workspaceId: context.workspaceId,
              memberId,
              resourceType: "approval",
              resourceId: request.id,
              requires: ACCESS_LEVELS.full,
            });
          } catch (error) {
            if (error instanceof OperationError) {
              continue;
            }
            throw error;
          }
          const items = await tx
            .select({ subjectType: approvalItems.subjectType })
            .from(approvalItems)
            .where(
              activeOnly(
                approvalItems,
                and(
                  eq(approvalItems.workspaceId, context.workspaceId),
                  eq(approvalItems.requestId, request.id),
                ),
              ),
            );
          toDecide.push({
            requestId: request.id,
            spaceId: request.spaceId,
            spaceName: request.spaceName,
            gaps: items.filter((item) => item.subjectType === "gap").length,
            objectives: items.filter((item) => item.subjectType === "goal")
              .length,
          });
        }

        // The newest request of each sector, when it is mine and came back.
        const seen = new Set<string>();
        const returned: {
          requestId: string;
          spaceId: string;
          spaceName: string;
          comment: string;
        }[] = [];
        for (const request of requests) {
          if (seen.has(request.spaceId)) {
            continue;
          }
          seen.add(request.spaceId);
          if (
            request.status === "returned" &&
            request.submittedBy === memberId
          ) {
            returned.push({
              requestId: request.id,
              spaceId: request.spaceId,
              spaceName: request.spaceName,
              comment: request.comment ?? "",
            });
          }
        }
        return { toDecide, returned };
      },
    );
  },
});
