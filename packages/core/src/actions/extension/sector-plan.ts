/**
 * What an objective is in the plan, and a sector's plan as one list
 * (docs/extension/design/b0-vertical-slice.md §12.2).
 *
 * A plan holds three kinds of item. A sector objective and an operational
 * objective are both goals, told apart by a profile beside the goal. An
 * operational indicator is followed without being an objective, and is the
 * product's own indicator owned by an agency: nothing new is stored for it.
 *
 * **The profile is measured on the goal**, at `edit`, like any change to it.
 *
 * **The plan is measured on the sector**, at `edit`, and gathers from the
 * sector's own space and the spaces of its agencies. Being in a sector does
 * not put somebody in its agencies, so this read is how the sector's people
 * see the whole of their plan (§12.1). It shows titles and how each item is
 * classed, not what is inside an objective: opening one still goes through
 * the goal's own access.
 */
import {
  activeOnly,
  goalStrategyProfiles,
  goals,
  KPI_DIRECTION_VALUES,
  KPI_FREQUENCY_VALUES,
  kpis,
  newId,
  OBJECTIVE_PRIORITIES,
  OBJECTIVE_SOURCES,
  OBJECTIVE_TYPES,
  orgAgencies,
  orgSectors,
  PLAN_STATUSES,
  sourceDocuments,
  spaces,
  withContext,
} from "@openokr/db";
import { and, asc, eq, inArray } from "drizzle-orm";
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

const profileFields = {
  objectiveType: z.enum(OBJECTIVE_TYPES),
  priority: z.enum(OBJECTIVE_PRIORITIES),
  /** New this year, or carried over from the last plan. */
  planStatus: z.enum(PLAN_STATUSES),
  sourceKind: z.enum(OBJECTIVE_SOURCES),
  /** The baseline is not known yet, which a plan writes as "TBD". */
  baselineUndetermined: z.boolean(),
};

export const setGoalProfile = defineWriteAction({
  name: "strategy.setGoalProfile",
  summary:
    "Says what an objective is in the plan: sector or operational, a priority or not, new or carried over, and where it comes from.",
  input: z.object({
    goalId: z.uuid(),
    ...profileFields,
    /** The sub-strategy it comes from. Only with the source `sub_strategy`. */
    sourceDocumentId: z.uuid().optional(),
  }),
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
      if (input.sourceDocumentId && input.sourceKind !== "sub_strategy") {
        throw new OperationError(
          "conflict",
          "A source document is named only for an objective that comes from a sub-strategy.",
        );
      }
      if (input.sourceDocumentId) {
        const [document] = await tx
          .select({ spaceId: sourceDocuments.spaceId })
          .from(sourceDocuments)
          .where(
            activeOnly(
              sourceDocuments,
              eq(sourceDocuments.workspaceId, workspaceId),
              eq(sourceDocuments.id, input.sourceDocumentId),
            ),
          )
          .limit(1);
        if (!document) {
          throw new OperationError("not_found", "No such source document.");
        }
        // A document is its sector's. Naming one is for somebody who can
        // open it.
        await getAccessScoped(tx, {
          workspaceId,
          memberId,
          resourceType: "space",
          resourceId: document.spaceId,
          requires: ACCESS_LEVELS.edit,
        });
      }
      const values = {
        objectiveType: input.objectiveType,
        priority: input.priority,
        planStatus: input.planStatus,
        sourceKind: input.sourceKind,
        sourceDocumentId: input.sourceDocumentId ?? null,
        baselineUndetermined: input.baselineUndetermined,
      };
      const [existing] = await tx
        .select({ id: goalStrategyProfiles.id })
        .from(goalStrategyProfiles)
        .where(
          activeOnly(
            goalStrategyProfiles,
            eq(goalStrategyProfiles.workspaceId, workspaceId),
            eq(goalStrategyProfiles.goalId, input.goalId),
          ),
        )
        .limit(1);
      if (existing) {
        // openokr:allow-mutation: the calling Operation's own transaction.
        await tx
          .update(goalStrategyProfiles)
          .set({ ...values, updatedAt: new Date() })
          .where(
            activeOnly(
              goalStrategyProfiles,
              eq(goalStrategyProfiles.id, existing.id),
            ),
          );
      } else {
        // openokr:allow-mutation: the calling Operation's own transaction.
        await tx.insert(goalStrategyProfiles).values({
          id: newId(),
          workspaceId,
          goalId: input.goalId,
          ...values,
        });
      }
      return {
        result: { goalId: input.goalId },
        activity: {
          kind: "strategy.goal_profile_set" as const,
          subjectType: "goal" as const,
          subjectId: input.goalId,
          payload: {
            objectiveType: input.objectiveType,
            priority: input.priority,
          },
        },
        audit: {
          action: "strategy.setGoalProfile",
          targetType: "goal",
          targetId: input.goalId,
          payload: values,
        },
      };
    },
  }),
});

export const listSectorPlan = defineReadAction({
  name: "strategy.listSectorPlan",
  summary:
    "A sector's plan in one list: the objectives of the sector and its agencies with how each is classed, and the operational indicators they follow.",
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
        /** Null until somebody has said what the objective is in the plan. */
        profile: z
          .object({
            ...profileFields,
            sourceDocumentId: z.uuid().nullable(),
          })
          .nullable(),
      }),
    ),
    indicators: z.array(
      z.object({
        kpiId: z.uuid(),
        title: z.string(),
        spaceId: z.uuid(),
        spaceName: z.string(),
        frequency: z.enum(KPI_FREQUENCY_VALUES),
        direction: z.enum(KPI_DIRECTION_VALUES),
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

        const objectives = await tx
          .select({
            goalId: goals.id,
            title: goals.title,
            spaceId: spaces.id,
            spaceName: spaces.name,
            objectiveType: goalStrategyProfiles.objectiveType,
            priority: goalStrategyProfiles.priority,
            planStatus: goalStrategyProfiles.planStatus,
            sourceKind: goalStrategyProfiles.sourceKind,
            sourceDocumentId: goalStrategyProfiles.sourceDocumentId,
            baselineUndetermined: goalStrategyProfiles.baselineUndetermined,
          })
          // openokr:allow-raw-read: the sector's plan, for somebody the
          // getter above found to hold `edit` on the sector. It gathers the
          // titles and classes of what the sector's agencies own (design
          // §12.1). Opening an objective goes through the goal's own access.
          .from(goals)
          .innerJoin(spaces, eq(spaces.id, goals.spaceId))
          .leftJoin(
            goalStrategyProfiles,
            and(
              eq(goalStrategyProfiles.goalId, goals.id),
              activeOnly(goalStrategyProfiles),
            ),
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

        const indicators = await tx
          .select({
            kpiId: kpis.id,
            title: kpis.title,
            spaceId: spaces.id,
            spaceName: spaces.name,
            frequency: kpis.frequency,
            direction: kpis.direction,
          })
          // openokr:allow-raw-read: as for the objectives above.
          .from(kpis)
          .innerJoin(spaces, eq(spaces.id, kpis.spaceId))
          .where(
            activeOnly(
              kpis,
              eq(kpis.workspaceId, context.workspaceId),
              eq(kpis.ownerKind, "space"),
              inArray(kpis.spaceId, spaceIds),
            ),
          )
          .orderBy(asc(kpis.createdAt), asc(kpis.id));

        return {
          objectives: objectives.map(
            ({ goalId, title, spaceId, spaceName, ...profile }) => ({
              goalId,
              title,
              spaceId,
              spaceName,
              profile:
                profile.objectiveType === null ||
                profile.priority === null ||
                profile.planStatus === null ||
                profile.sourceKind === null ||
                profile.baselineUndetermined === null
                  ? null
                  : {
                      objectiveType: profile.objectiveType,
                      priority: profile.priority,
                      planStatus: profile.planStatus,
                      sourceKind: profile.sourceKind,
                      sourceDocumentId: profile.sourceDocumentId,
                      baselineUndetermined: profile.baselineUndetermined,
                    },
            }),
          ),
          indicators,
        };
      },
    );
  },
});
