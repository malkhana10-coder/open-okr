/**
 * The planning extension's activity kinds: the payload each one carries and
 * the sentence the feed shows for it. Spread into the shipped catalogue and
 * renderer map by one line each (docs/extension/UPSTREAM-DIFF.md).
 */
import { z } from "zod";

export const EXTENSION_ACTIVITY_PAYLOAD_SCHEMAS = {
  "strategy.domain_created": z.object({ name: z.string() }),
  "strategy.goal_owner_confirmed": z.object({}),
  "governance.submitted": z.object({
    gaps: z.number().int(),
    objectives: z.number().int(),
  }),
  "governance.decided": z.object({
    status: z.string(),
    gaps: z.number().int(),
    objectives: z.number().int(),
  }),
  "planning.agent_run": z.object({
    agent: z.string(),
    status: z.string(),
    drafted: z.number().int(),
  }),
  "strategy.gap_created": z.object({ title: z.string() }),
  "strategy.gap_updated": z.object({ title: z.string() }),
  "strategy.gap_dismissed": z.object({ title: z.string() }),
  "strategy.goal_profile_set": z.object({
    objectiveType: z.string(),
    priority: z.string(),
  }),
  "strategy.sector_set": z.object({ name: z.string() }),
  "strategy.agency_set": z.object({ name: z.string(), sector: z.string() }),
  "knowledge.document_registered": z.object({
    title: z.string(),
    kind: z.string(),
    year: z.number().int(),
  }),
  "knowledge.evidence_added": z.object({
    page: z.number().int(),
    verification: z.string(),
  }),
  "knowledge.evidence_removed": z.object({ page: z.number().int() }),
  "knowledge.document_read": z.union([
    z.object({ outcome: z.literal("ready"), pageCount: z.number().int() }),
    z.object({ outcome: z.literal("failed"), reason: z.string() }),
  ]),
} as const satisfies Record<string, z.ZodType>;

type ExtensionActivityKind = keyof typeof EXTENSION_ACTIVITY_PAYLOAD_SCHEMAS;

export const EXTENSION_ACTIVITY_RENDERERS: Record<
  ExtensionActivityKind,
  (payload: Record<string, unknown>) => string
> = {
  "planning.agent_run": (p) => {
    const agent = p.agent === "objectives" ? "objectives agent" : "gap agent";
    return p.status === "succeeded"
      ? `The ${agent} ran and drafted ${String(p.drafted ?? 0)}`
      : `The ${agent} ran and drafted nothing`;
  },
  "strategy.goal_owner_confirmed": () =>
    "The owner of a drafted objective was confirmed",
  "governance.submitted": (p) =>
    `${String(p.gaps ?? 0)} gap(s) and ${String(p.objectives ?? 0)} objective(s) were sent for approval`,
  "governance.decided": (p) =>
    p.status === "approved"
      ? "An approval request was approved"
      : "An approval request was returned",
  "strategy.domain_created": (p) =>
    `A strategic domain "${String(p.name ?? "")}" was added`,
  "strategy.gap_created": (p) =>
    `A strategic gap "${String(p.title ?? "")}" was written`,
  "strategy.gap_updated": (p) =>
    `The strategic gap "${String(p.title ?? "")}" was changed`,
  "strategy.gap_dismissed": (p) =>
    `The strategic gap "${String(p.title ?? "")}" was set aside`,
  "strategy.goal_profile_set": (p) =>
    p.objectiveType === "operational"
      ? "The objective was classed as operational in the plan"
      : "The objective was classed as a sector objective in the plan",
  "strategy.sector_set": (p) => `"${String(p.name ?? "")}" was made a sector`,
  "strategy.agency_set": (p) =>
    `"${String(p.name ?? "")}" was placed under the sector "${String(p.sector ?? "")}"`,
  "knowledge.document_registered": (p) =>
    `A source document "${String(p.title ?? "")}" was filed`,
  "knowledge.evidence_added": (p) =>
    p.verification === "verified"
      ? `A quotation from page ${String(p.page ?? "")} was attached and found on the page`
      : `A quotation from page ${String(p.page ?? "")} was attached and not found on the page`,
  "knowledge.evidence_removed": (p) =>
    `A quotation from page ${String(p.page ?? "")} was removed`,
  "knowledge.document_read": (p) =>
    p.outcome === "ready"
      ? `A source document was read: ${String(p.pageCount ?? "")} pages`
      : "A source document could not be read",
};
