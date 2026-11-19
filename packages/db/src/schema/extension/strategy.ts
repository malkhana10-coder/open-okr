/**
 * The planning extension's strategy tables
 * (docs/extension/design/b0-vertical-slice.md §4).
 *
 * The SQL is in `packages/db/migrations-ext`, the extension's own migration
 * stream.
 */
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../../id.ts";
import { workspaces } from "../workspaces.ts";

/** A named area of the organisation's strategy. Gaps are filed under one. */
export const strategyDomains = pgTable("strategy_domains", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
