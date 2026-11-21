/**
 * Sectors and the agencies under them
 * (docs/extension/design/b0-vertical-slice.md §12.1).
 *
 * A sector is a space and an agency is a space. These actions say which is
 * which. Nothing here grants access: being in a sector does not put somebody
 * in its agencies, and each space's own membership decides as it always has.
 * Inherited access is designed in a later phase.
 *
 * Setting up the structure is how a workspace is organised, so the writes are
 * measured on the workspace domain: an Owner or an Admin. Reading it is open
 * to every member, because every member can already see every space.
 */
import {
  activeOnly,
  newId,
  orgAgencies,
  orgSectors,
  spaces,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { and, asc, eq } from "drizzle-orm";
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

/**
 * A space the caller may see, by name. Not found otherwise, so a space in
 * another workspace and one that does not exist read the same.
 */
async function spaceNamed(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  spaceId: string,
): Promise<string> {
  await getAccessScoped(tx, {
    workspaceId,
    memberId,
    resourceType: "space",
    resourceId: spaceId,
    requires: ACCESS_LEVELS.view,
  });
  const [space] = await tx
    .select({ name: spaces.name })
    // openokr:allow-raw-read: the access getter just above decided that this
    // member may see this space. It answers with a level, not the row, and
    // the name is what the activity line and the refusals say.
    .from(spaces)
    .where(
      activeOnly(
        spaces,
        and(eq(spaces.workspaceId, workspaceId), eq(spaces.id, spaceId)),
      ),
    )
    .limit(1);
  if (!space) {
    throw new OperationError("not_found", "No such space.");
  }
  return space.name;
}

async function sectorOf(
  tx: OperationTx,
  workspaceId: string,
  spaceId: string,
): Promise<{ id: string; leadMemberId: string | null } | undefined> {
  const [sector] = await tx
    .select({ id: orgSectors.id, leadMemberId: orgSectors.leadMemberId })
    .from(orgSectors)
    .where(
      activeOnly(
        orgSectors,
        and(
          eq(orgSectors.workspaceId, workspaceId),
          eq(orgSectors.spaceId, spaceId),
        ),
      ),
    )
    .limit(1);
  return sector;
}

async function agencyOf(
  tx: OperationTx,
  workspaceId: string,
  spaceId: string,
): Promise<{ id: string; sectorId: string } | undefined> {
  const [agency] = await tx
    .select({ id: orgAgencies.id, sectorId: orgAgencies.sectorId })
    .from(orgAgencies)
    .where(
      activeOnly(
        orgAgencies,
        and(
          eq(orgAgencies.workspaceId, workspaceId),
          eq(orgAgencies.spaceId, spaceId),
        ),
      ),
    )
    .limit(1);
  return agency;
}

export const setSector = defineWriteAction({
  name: "strategy.setSector",
  domain: "workspace",
  summary:
    "Marks a space as a sector, the upper of the two planning levels, and names who answers for it.",
  input: z.object({
    spaceId: z.uuid(),
    /** Who answers for the sector. Left out, nobody is named. */
    leadMemberId: z.uuid().optional(),
  }),
  output: z.object({ spaceId: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMemberId(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const name = await spaceNamed(tx, workspaceId, memberId, input.spaceId);
      if (input.leadMemberId) {
        const [lead] = await tx
          .select({ id: workspaceMembers.id })
          .from(workspaceMembers)
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.id, input.leadMemberId),
              eq(workspaceMembers.status, "active"),
            ),
          )
          .limit(1);
        if (!lead) {
          throw new OperationError("not_found", "No such member.");
        }
      }
      if (await agencyOf(tx, workspaceId, input.spaceId)) {
        throw new OperationError(
          "conflict",
          `"${name}" is an agency. A space is a sector or an agency, not both.`,
        );
      }
      const leadMemberId = input.leadMemberId ?? null;
      const existing = await sectorOf(tx, workspaceId, input.spaceId);
      if (existing) {
        // openokr:allow-mutation: the calling Operation's own transaction.
        await tx
          .update(orgSectors)
          .set({ leadMemberId, updatedAt: new Date() })
          .where(activeOnly(orgSectors, eq(orgSectors.id, existing.id)));
      } else {
        // openokr:allow-mutation: the calling Operation's own transaction.
        await tx.insert(orgSectors).values({
          id: newId(),
          workspaceId,
          spaceId: input.spaceId,
          leadMemberId,
        });
      }
      return {
        result: { spaceId: input.spaceId },
        activity: {
          kind: "strategy.sector_set" as const,
          subjectType: "space" as const,
          subjectId: input.spaceId,
          payload: { name },
        },
        audit: {
          action: "strategy.setSector",
          targetType: "space",
          targetId: input.spaceId,
          payload: { name, leadMemberId },
        },
      };
    },
  }),
});

export const setAgency = defineWriteAction({
  name: "strategy.setAgency",
  domain: "workspace",
  summary:
    "Places a space under a sector as one of its agencies, or moves it to another sector.",
  input: z.object({
    spaceId: z.uuid(),
    /** The space of the sector it belongs to. */
    sectorSpaceId: z.uuid(),
  }),
  output: z.object({ spaceId: z.uuid(), sectorSpaceId: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMemberId(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const name = await spaceNamed(tx, workspaceId, memberId, input.spaceId);
      const sectorName = await spaceNamed(
        tx,
        workspaceId,
        memberId,
        input.sectorSpaceId,
      );
      const sector = await sectorOf(tx, workspaceId, input.sectorSpaceId);
      if (!sector) {
        // Two levels and no more: an agency goes under a sector, and a
        // space that is an agency or nothing at all is not one.
        throw new OperationError(
          "conflict",
          `"${sectorName}" is not a sector, so nothing can be placed under it.`,
        );
      }
      if (await sectorOf(tx, workspaceId, input.spaceId)) {
        throw new OperationError(
          "conflict",
          `"${name}" is a sector. A space is a sector or an agency, not both.`,
        );
      }
      const existing = await agencyOf(tx, workspaceId, input.spaceId);
      if (existing) {
        // openokr:allow-mutation: the calling Operation's own transaction.
        await tx
          .update(orgAgencies)
          .set({ sectorId: sector.id, updatedAt: new Date() })
          .where(activeOnly(orgAgencies, eq(orgAgencies.id, existing.id)));
      } else {
        // openokr:allow-mutation: the calling Operation's own transaction.
        await tx.insert(orgAgencies).values({
          id: newId(),
          workspaceId,
          spaceId: input.spaceId,
          sectorId: sector.id,
        });
      }
      return {
        result: {
          spaceId: input.spaceId,
          sectorSpaceId: input.sectorSpaceId,
        },
        activity: {
          kind: "strategy.agency_set" as const,
          subjectType: "space" as const,
          subjectId: input.spaceId,
          payload: { name, sector: sectorName },
        },
        audit: {
          action: "strategy.setAgency",
          targetType: "space",
          targetId: input.spaceId,
          payload: { name, sectorSpaceId: input.sectorSpaceId },
        },
      };
    },
  }),
});

export const listOrgUnits = defineReadAction({
  name: "strategy.listOrgUnits",
  summary: "The workspace's sectors, each with the agencies under it.",
  input: z.object({}),
  output: z.object({
    sectors: z.array(
      z.object({
        spaceId: z.uuid(),
        name: z.string(),
        leadMemberId: z.uuid().nullable(),
        agencies: z.array(z.object({ spaceId: z.uuid(), name: z.string() })),
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
        const sectors = await tx
          .select({
            id: orgSectors.id,
            spaceId: orgSectors.spaceId,
            name: spaces.name,
            leadMemberId: orgSectors.leadMemberId,
          })
          .from(orgSectors)
          .innerJoin(spaces, eq(spaces.id, orgSectors.spaceId))
          .where(
            activeOnly(
              orgSectors,
              activeOnly(
                spaces,
                eq(orgSectors.workspaceId, context.workspaceId),
              ),
            ),
          )
          .orderBy(asc(spaces.name), asc(orgSectors.id));
        const agencies = await tx
          .select({
            sectorId: orgAgencies.sectorId,
            spaceId: orgAgencies.spaceId,
            name: spaces.name,
          })
          .from(orgAgencies)
          .innerJoin(spaces, eq(spaces.id, orgAgencies.spaceId))
          .where(
            activeOnly(
              orgAgencies,
              activeOnly(
                spaces,
                eq(orgAgencies.workspaceId, context.workspaceId),
              ),
            ),
          )
          .orderBy(asc(spaces.name), asc(orgAgencies.id));
        return {
          sectors: sectors.map(({ id, ...sector }) => ({
            ...sector,
            agencies: agencies
              .filter((agency) => agency.sectorId === id)
              .map(({ spaceId, name }) => ({ spaceId, name })),
          })),
        };
      },
    );
  },
});
