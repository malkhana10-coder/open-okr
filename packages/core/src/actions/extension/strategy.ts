/**
 * Strategy actions of the planning extension
 * (docs/extension/design/b0-vertical-slice.md §5).
 */
import { activeOnly, newId, strategyDomains, withContext } from "@openokr/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../../access/levels.ts";
import {
  OperationError,
  type OperationTx,
} from "../../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "../define.ts";

export const listStrategyDomains = defineReadAction({
  name: "strategy.listDomains",
  summary:
    "The workspace's strategic domains, the areas gaps and sector objectives are filed under.",
  input: z.object({}),
  output: z.object({
    domains: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        description: z.string().nullable(),
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
        const domains = await tx
          .select({
            id: strategyDomains.id,
            name: strategyDomains.name,
            description: strategyDomains.description,
          })
          .from(strategyDomains)
          .where(
            activeOnly(
              strategyDomains,
              eq(strategyDomains.workspaceId, context.workspaceId),
            ),
          )
          .orderBy(asc(strategyDomains.position), asc(strategyDomains.name));
        return { domains };
      },
    );
  },
});

export const createStrategyDomain = defineWriteAction({
  name: "strategy.createDomain",
  // Domains are how a workspace is set up, like KPI categories for the whole
  // organisation, so the write is measured on the workspace domain: an Owner
  // or an Admin, not every member.
  domain: "workspace",
  summary:
    "Adds a strategic domain, an area of the strategy that gaps and sector objectives are filed under.",
  input: z.object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(2000).optional(),
  }),
  output: z.object({ id: z.uuid(), name: z.string() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [taken] = await tx
        .select({ id: strategyDomains.id })
        .from(strategyDomains)
        .where(
          activeOnly(
            strategyDomains,
            and(
              eq(strategyDomains.workspaceId, workspaceId),
              sql`lower(btrim(${strategyDomains.name})) = lower(${input.name})`,
            ),
          ),
        )
        .limit(1);
      if (taken) {
        throw new OperationError(
          "conflict",
          `A strategic domain named "${input.name}" already exists.`,
        );
      }
      const id = newId();
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx.insert(strategyDomains).values({
        id,
        workspaceId,
        name: input.name,
        description: input.description ?? null,
      });
      return {
        result: { id, name: input.name },
        activity: {
          kind: "strategy.domain_created" as const,
          subjectType: "workspace" as const,
          subjectId: workspaceId,
          payload: { name: input.name },
        },
        audit: {
          action: "strategy.createDomain",
          targetType: "strategy_domain",
          targetId: id,
          payload: { name: input.name },
        },
      };
    },
  }),
});
