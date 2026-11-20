/**
 * The planning extension's activity kinds: the payload each one carries and
 * the sentence the feed shows for it. Spread into the shipped catalogue and
 * renderer map by one line each (docs/extension/UPSTREAM-DIFF.md).
 */
import { z } from "zod";

export const EXTENSION_ACTIVITY_PAYLOAD_SCHEMAS = {
  "strategy.domain_created": z.object({ name: z.string() }),
  "strategy.gap_created": z.object({ title: z.string() }),
  "strategy.gap_updated": z.object({ title: z.string() }),
  "strategy.gap_dismissed": z.object({ title: z.string() }),
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
  "strategy.domain_created": (p) =>
    `A strategic domain "${String(p.name ?? "")}" was added`,
  "strategy.gap_created": (p) =>
    `A strategic gap "${String(p.title ?? "")}" was written`,
  "strategy.gap_updated": (p) =>
    `The strategic gap "${String(p.title ?? "")}" was changed`,
  "strategy.gap_dismissed": (p) =>
    `The strategic gap "${String(p.title ?? "")}" was set aside`,
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
