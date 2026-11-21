/**
 * The objectives an agent drafted for a sector, as a reviewer reads them
 * (design b0-vertical-slice.md, criteria 8 and 17).
 *
 * A drafted objective is a real goal that is not live. What makes it
 * reviewable is not on the goal: the target the agent proposed, why, how
 * sure it was, the gaps it answers, the pages it quotes, and whether a
 * person has confirmed who answers for it. This read gathers those for the
 * whole sector at once, so a screen does not ask objective by objective.
 *
 * **It shows more of an agency's objective than the sector's plan does.**
 * `strategy.listSectorPlan` shows titles and classes only (design §12.1).
 * This shows the proposed target, the reasoning and the quotations too, to
 * somebody who may edit the sector. All of that is drawn from the sector's
 * own gaps and documents, which that person already reads, and it is what
 * they are asked to send for approval. Gaps and quotations are kept to the
 * sector asked about, so an objective moved in from another sector brings
 * none of the other sector's material with it.
 */

import {
  activeOnly,
  approvalItems,
  approvalRequests,
  EVIDENCE_UNVERIFIED_REASONS,
  EVIDENCE_VERIFICATIONS,
  evidence,
  gapGoalLinks,
  goalStrategyProfiles,
  goals,
  OBJECTIVE_TYPES,
  orgAgencies,
  orgSectors,
  sourceDocumentPages,
  sourceDocuments,
  spaces,
  strategicGaps,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { isLowQuality } from "@openokr/knowledge";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../../access/levels.ts";
import { getAccessScoped } from "../../access/reads.ts";
import {
  OperationError,
  type OperationTx,
} from "../../operations/operation.ts";
import { defineReadAction } from "../define.ts";
import { actingMemberId } from "./acting-member.ts";

/** `draft` until it is sent, `awaiting_approval` until decided, then live. */
const DRAFT_STATES = ["draft", "awaiting_approval", "live"] as const;

export const listObjectiveDrafts = defineReadAction({
  name: "planning.listObjectiveDrafts",
  summary:
    "The objectives an agent drafted for a sector and its agencies, each with its proposed target, the gaps it answers, its quotations, and whether its owner is confirmed.",
  input: z.object({
    /** The sector's space. */
    spaceId: z.uuid(),
  }),
  output: z.object({
    objectives: z.array(
      z.object({
        goalId: z.uuid(),
        title: z.string(),
        spaceId: z.uuid(),
        spaceName: z.string(),
        objectiveType: z.enum(OBJECTIVE_TYPES),
        proposedTarget: z.string().nullable(),
        rationale: z.string().nullable(),
        confidence: z.number().int().nullable(),
        state: z.enum(DRAFT_STATES),
        owner: z.object({ memberId: z.uuid(), name: z.string() }),
        /** A person has said this owner is the right one (criterion 17). */
        ownerConfirmed: z.boolean(),
        gaps: z.array(z.object({ id: z.uuid(), title: z.string() })),
        evidence: z.array(
          z.object({
            id: z.uuid(),
            documentId: z.uuid(),
            documentTitle: z.string(),
            page: z.number().int(),
            quote: z.string(),
            verification: z.enum(EVIDENCE_VERIFICATIONS),
            unverifiedReason: z.enum(EVIDENCE_UNVERIFIED_REASONS).nullable(),
            /** The page was read poorly, so a miss may be the file's. */
            weakPage: z.boolean(),
          }),
        ),
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
        // Decides access: not found unless the caller may edit the sector.
        await getAccessScoped(tx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "space",
          resourceId: input.spaceId,
          requires: ACCESS_LEVELS.edit,
        });
        const [sector] = await tx
          .select({ id: orgSectors.id })
          .from(orgSectors)
          .where(
            activeOnly(
              orgSectors,
              eq(orgSectors.workspaceId, context.workspaceId),
              eq(orgSectors.spaceId, input.spaceId),
            ),
          )
          .limit(1);
        if (!sector) {
          // The same answer as for a space the caller may not see.
          throw new OperationError(
            "not_found",
            "No such sector, or you do not have access to it.",
          );
        }
        const agencies = await tx
          .select({ spaceId: orgAgencies.spaceId })
          .from(orgAgencies)
          .where(
            activeOnly(
              orgAgencies,
              eq(orgAgencies.workspaceId, context.workspaceId),
              eq(orgAgencies.sectorId, sector.id),
            ),
          );
        const spaceIds = [
          input.spaceId,
          ...agencies.map((agency) => agency.spaceId),
        ];

        const rows = await tx
          .select({
            goalId: goals.id,
            title: goals.title,
            spaceId: spaces.id,
            spaceName: spaces.name,
            draftState: goals.draftState,
            ownerId: workspaceMembers.id,
            ownerName: workspaceMembers.name,
            objectiveType: goalStrategyProfiles.objectiveType,
            proposedTarget: goalStrategyProfiles.proposedTarget,
            rationale: goalStrategyProfiles.rationale,
            confidence: goalStrategyProfiles.confidence,
            ownerConfirmedAt: goalStrategyProfiles.ownerConfirmedAt,
          })
          // openokr:allow-raw-read: the sector's drafted objectives, for a
          // caller the getter above found to hold `edit` on the sector. It
          // gathers what the sector's agencies own, with the reasoning the
          // agent drafted from the sector's own gaps and documents (see the
          // file's header). Changing an objective goes through its own
          // access.
          .from(goals)
          .innerJoin(
            spaces,
            and(eq(spaces.id, goals.spaceId), activeOnly(spaces)),
          )
          .innerJoin(
            goalStrategyProfiles,
            and(
              eq(goalStrategyProfiles.goalId, goals.id),
              activeOnly(goalStrategyProfiles),
              isNotNull(goalStrategyProfiles.agentRunId),
            ),
          )
          .innerJoin(
            workspaceMembers,
            eq(workspaceMembers.id, goals.championId),
          )
          .where(
            activeOnly(
              goals,
              eq(goals.workspaceId, context.workspaceId),
              eq(goals.ownerKind, "space"),
              inArray(goals.spaceId, spaceIds),
            ),
          )
          .orderBy(asc(goals.createdAt), asc(goals.id));
        if (rows.length === 0) {
          return { objectives: [] };
        }
        const goalIds = rows.map((row) => row.goalId);

        const links = await tx
          .select({
            goalId: gapGoalLinks.goalId,
            id: strategicGaps.id,
            title: strategicGaps.title,
          })
          .from(gapGoalLinks)
          .innerJoin(
            strategicGaps,
            and(
              eq(strategicGaps.id, gapGoalLinks.gapId),
              // The sector's own gaps only.
              eq(strategicGaps.spaceId, input.spaceId),
              activeOnly(strategicGaps),
            ),
          )
          .where(
            activeOnly(
              gapGoalLinks,
              eq(gapGoalLinks.workspaceId, context.workspaceId),
              inArray(gapGoalLinks.goalId, goalIds),
            ),
          )
          .orderBy(asc(strategicGaps.createdAt), asc(strategicGaps.id));

        const quoted = await tx
          .select({
            goalId: evidence.subjectId,
            id: evidence.id,
            documentId: evidence.documentId,
            documentTitle: sourceDocuments.title,
            page: evidence.page,
            quote: evidence.quote,
            verification: evidence.verification,
            unverifiedReason: evidence.unverifiedReason,
            arabicWords: sourceDocumentPages.arabicWords,
            suspectWords: sourceDocumentPages.suspectWords,
          })
          .from(evidence)
          .innerJoin(
            sourceDocuments,
            and(
              eq(sourceDocuments.id, evidence.documentId),
              // The sector's own documents only.
              eq(sourceDocuments.spaceId, input.spaceId),
              activeOnly(sourceDocuments),
            ),
          )
          .leftJoin(
            sourceDocumentPages,
            and(
              eq(sourceDocumentPages.documentId, evidence.documentId),
              eq(sourceDocumentPages.page, evidence.page),
            ),
          )
          .where(
            activeOnly(
              evidence,
              eq(evidence.workspaceId, context.workspaceId),
              eq(evidence.subjectType, "goal"),
              inArray(evidence.subjectId, goalIds),
            ),
          )
          .orderBy(asc(evidence.createdAt), asc(evidence.id));

        // Sending a sector's request does not change the goal: what says an
        // objective is waiting is its row in a request that is still open.
        const waiting = new Set(
          (
            await tx
              .select({ goalId: approvalItems.subjectId })
              .from(approvalItems)
              .innerJoin(
                approvalRequests,
                and(
                  eq(approvalRequests.id, approvalItems.requestId),
                  eq(approvalRequests.status, "open"),
                  activeOnly(approvalRequests),
                ),
              )
              .where(
                activeOnly(
                  approvalItems,
                  eq(approvalItems.workspaceId, context.workspaceId),
                  eq(approvalItems.subjectType, "goal"),
                  inArray(approvalItems.subjectId, goalIds),
                ),
              )
          ).map((row) => row.goalId),
        );

        return {
          objectives: rows.map((row) => ({
            goalId: row.goalId,
            title: row.title,
            spaceId: row.spaceId,
            spaceName: row.spaceName,
            objectiveType: row.objectiveType,
            proposedTarget: row.proposedTarget,
            rationale: row.rationale,
            confidence: row.confidence,
            state:
              row.draftState === null
                ? ("live" as const)
                : waiting.has(row.goalId)
                  ? ("awaiting_approval" as const)
                  : row.draftState,
            owner: { memberId: row.ownerId, name: row.ownerName },
            ownerConfirmed: row.ownerConfirmedAt !== null,
            gaps: links
              .filter((link) => link.goalId === row.goalId)
              .map(({ id, title }) => ({ id, title })),
            evidence: quoted
              .filter((one) => one.goalId === row.goalId)
              .map(({ goalId: _, arabicWords, suspectWords, ...one }) => ({
                ...one,
                weakPage:
                  arabicWords !== null &&
                  suspectWords !== null &&
                  isLowQuality({ arabicWords, suspectWords }),
              })),
          })),
        };
      },
    );
  },
});
