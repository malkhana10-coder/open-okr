/**
 * The planning extension's strategy tables
 * (docs/extension/design/b0-vertical-slice.md §4).
 *
 * The SQL is in `packages/db/migrations-ext`, the extension's own migration
 * stream.
 */
import {
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../../id.ts";
import { spaces } from "../spaces.ts";
import { workspaceMembers, workspaces } from "../workspaces.ts";

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

/**
 * Where a gap stands. `draft` is a person's and `ai_draft` an agent's, so a
 * gap somebody wrote never carries the status that marks machine output.
 */
export const GAP_STATUSES = [
  "draft",
  "ai_draft",
  "in_review",
  "approved",
  "returned",
  "dismissed",
] as const;

/** Strategic gaps (migration 0006 in the extension stream). */
export const strategicGaps = pgTable("strategic_gaps", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  /** The sector it is filed under. */
  spaceId: uuid("space_id")
    .notNull()
    .references(() => spaces.id, { onDelete: "cascade" }),
  domainId: uuid("domain_id").references(() => strategyDomains.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  description: text("description"),
  rationale: text("rationale"),
  /** 0 to 100, from the agent that drafted it. Null for a person's. */
  confidence: smallint("confidence"),
  status: text("status", { enum: GAP_STATUSES }).notNull().default("draft"),
  createdBy: uuid("created_by").references(() => workspaceMembers.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
