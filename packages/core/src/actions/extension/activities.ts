/**
 * The planning extension's activity kinds: the payload each one carries and
 * the sentence the feed shows for it. Spread into the shipped catalogue and
 * renderer map by one line each (docs/extension/UPSTREAM-DIFF.md).
 */
import { z } from "zod";

export const EXTENSION_ACTIVITY_PAYLOAD_SCHEMAS = {
  "strategy.domain_created": z.object({ name: z.string() }),
  "knowledge.document_registered": z.object({
    title: z.string(),
    kind: z.string(),
    year: z.number().int(),
  }),
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
  "knowledge.document_registered": (p) =>
    `A source document "${String(p.title ?? "")}" was filed`,
  "knowledge.document_read": (p) =>
    p.outcome === "ready"
      ? `A source document was read: ${String(p.pageCount ?? "")} pages`
      : "A source document could not be read",
};
