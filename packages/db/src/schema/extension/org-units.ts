/**
 * Sectors and the agencies under them
 * (docs/extension/design/b0-vertical-slice.md §12.1, migration 0005 in the
 * extension stream).
 *
 * Both are spaces. These two tables say which space is which, so the shipped
 * `spaces` table stays flat and everything hung on a space works for an
 * agency unchanged. Two tables rather than one with a parent column, so that
 * two levels is the shape of the data and not a rule beside it.
 *
 * Indexes and the trigger that keeps a space from being both live in the
 * migration.
 */
import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../../id.ts";
import { spaces } from "../spaces.ts";
import { workspaceMembers, workspaces } from "../workspaces.ts";

export const orgSectors = pgTable("org_sectors", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id")
    .notNull()
    .references(() => spaces.id, { onDelete: "cascade" }),
  /** Who answers for the sector. Null until somebody is named. */
  leadMemberId: uuid("lead_member_id").references(() => workspaceMembers.id, {
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

export const orgAgencies = pgTable("org_agencies", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id")
    .notNull()
    .references(() => spaces.id, { onDelete: "cascade" }),
  sectorId: uuid("sector_id")
    .notNull()
    .references(() => orgSectors.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
