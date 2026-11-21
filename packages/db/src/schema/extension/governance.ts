/**
 * Approval requests and their items
 * (docs/extension/design/b0-vertical-slice.md §13, migration 0011 in the
 * extension stream). Indexes and the checks that hold "nobody decides what
 * they sent" live in the migration.
 */
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../../id.ts";
import { spaces } from "../spaces.ts";
import { workspaceMembers, workspaces } from "../workspaces.ts";

const APPROVAL_STATUSES = ["open", "approved", "returned"] as const;

export const approvalRequests = pgTable("approval_requests", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  /** The sector the batch is from. */
  spaceId: uuid("space_id")
    .notNull()
    .references(() => spaces.id, { onDelete: "cascade" }),
  submittedBy: uuid("submitted_by")
    .notNull()
    .references(() => workspaceMembers.id),
  status: text("status", { enum: APPROVAL_STATUSES }).notNull().default("open"),
  decidedBy: uuid("decided_by").references(() => workspaceMembers.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const approvalItems = pgTable("approval_items", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  requestId: uuid("request_id")
    .notNull()
    .references(() => approvalRequests.id, { onDelete: "cascade" }),
  subjectType: text("subject_type", { enum: ["gap", "goal"] }).notNull(),
  subjectId: uuid("subject_id").notNull(),
  /** Null while the request is open. The same for every item, for now. */
  decision: text("decision", { enum: ["approved", "returned"] }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
