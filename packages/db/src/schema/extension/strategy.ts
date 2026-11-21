/**
 * The planning extension's strategy tables
 * (docs/extension/design/b0-vertical-slice.md §4).
 *
 * The SQL is in `packages/db/migrations-ext`, the extension's own migration
 * stream.
 */
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../../id.ts";
import { goals } from "../goals.ts";
import { spaces } from "../spaces.ts";
import { workspaceMembers, workspaces } from "../workspaces.ts";
import { sourceDocuments } from "./knowledge.ts";

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

export const PLANNING_AGENTS = ["gaps", "objectives"] as const;
export const PLANNING_RUN_STATUSES = ["succeeded", "failed"] as const;

/** What an agent read and what was left out. */
export interface PlanningRunReport {
  readonly read: readonly string[];
  readonly excluded: readonly string[];
}

/** One run of a planning agent (migration 0009 in the extension stream). */
export const planningAgentRuns = pgTable("planning_agent_runs", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id")
    .notNull()
    .references(() => spaces.id, { onDelete: "cascade" }),
  agent: text("agent", { enum: PLANNING_AGENTS }).notNull(),
  /** "fixed" for drafts written in advance. */
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version"),
  status: text("status", { enum: PLANNING_RUN_STATUSES }).notNull(),
  failure: text("failure"),
  /** A summary of what the agent was shown. Never the pages' text. */
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  report: jsonb("report").$type<PlanningRunReport>().notNull(),
  documentsUsed: jsonb("documents_used")
    .$type<string[]>()
    .notNull()
    .default([]),
  durationMs: integer("duration_ms").notNull(),
  costUsd: numeric("cost_usd"),
  startedBy: uuid("started_by").references(() => workspaceMembers.id, {
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
  /** The run that drafted it. Null for one a person wrote. */
  agentRunId: uuid("agent_run_id").references(() => planningAgentRuns.id, {
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

export const OBJECTIVE_TYPES = ["sectoral", "operational"] as const;
export const OBJECTIVE_PRIORITIES = ["priority", "not_priority"] as const;
export const PLAN_STATUSES = ["new", "carried"] as const;
export const OBJECTIVE_SOURCES = [
  "sub_strategy",
  "proposed",
  "leadership_directive",
] as const;

/**
 * What an objective is in the plan, beside the goal (migration 0008 in the
 * extension stream). The operational indicator, the third kind of item, is
 * the product's own `kpis` and has no row here.
 */
export const goalStrategyProfiles = pgTable("goal_strategy_profiles", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  objectiveType: text("objective_type", { enum: OBJECTIVE_TYPES }).notNull(),
  priority: text("priority", { enum: OBJECTIVE_PRIORITIES }).notNull(),
  planStatus: text("plan_status", { enum: PLAN_STATUSES }).notNull(),
  sourceKind: text("source_kind", { enum: OBJECTIVE_SOURCES }).notNull(),
  sourceDocumentId: uuid("source_document_id").references(
    () => sourceDocuments.id,
    { onDelete: "set null" },
  ),
  /** The baseline is not known yet, which a plan writes as "TBD". */
  baselineUndetermined: boolean("baseline_undetermined")
    .notNull()
    .default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
