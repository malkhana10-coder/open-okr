/**
 * The planning extension's knowledge tables
 * (docs/extension/design/b0-vertical-slice.md §4).
 *
 * The SQL is in `packages/db/migrations-ext`.
 */
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../../id.ts";
import { blobs } from "../blobs.ts";
import { spaces } from "../spaces.ts";
import { workspaceMembers, workspaces } from "../workspaces.ts";

export const SOURCE_DOCUMENT_KINDS = [
  "strategy",
  "sub_strategy",
  "previous_plan",
  "report",
] as const;

export const SOURCE_DOCUMENT_STATUSES = ["pending", "ready", "failed"] as const;

/** Why a document could not be read, in a word a screen can translate. */
export const SOURCE_DOCUMENT_FAILURES = [
  "no_text",
  "unreadable",
  "missing",
] as const;

/** An uploaded file a sector plans from. The file itself is a blob. */
export const sourceDocuments = pgTable("source_documents", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id")
    .notNull()
    .references(() => spaces.id, { onDelete: "cascade" }),
  blobId: uuid("blob_id")
    .notNull()
    .references(() => blobs.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  kind: text("kind", { enum: SOURCE_DOCUMENT_KINDS }).notNull(),
  year: integer("year").notNull(),
  processingStatus: text("processing_status", {
    enum: SOURCE_DOCUMENT_STATUSES,
  })
    .notNull()
    .default("pending"),
  failureReason: text("failure_reason", { enum: SOURCE_DOCUMENT_FAILURES }),
  pageCount: integer("page_count"),
  uploadedBy: uuid("uploaded_by").references(() => workspaceMembers.id, {
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

/** One page of a source document, as text. Pages are counted from 1. */
export const sourceDocumentPages = pgTable("source_document_pages", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  documentId: uuid("document_id")
    .notNull()
    .references(() => sourceDocuments.id, { onDelete: "cascade" }),
  page: integer("page").notNull(),
  text: text("text").notNull(),
  textNormalised: text("text_normalised").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
