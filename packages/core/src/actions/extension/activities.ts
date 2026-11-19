/**
 * The planning extension's activity kinds: the payload each one carries and
 * the sentence the feed shows for it. Spread into the shipped catalogue and
 * renderer map by one line each (docs/extension/UPSTREAM-DIFF.md).
 */
import { z } from "zod";

export const EXTENSION_ACTIVITY_PAYLOAD_SCHEMAS = {
  "strategy.domain_created": z.object({ name: z.string() }),
} as const satisfies Record<string, z.ZodType>;

type ExtensionActivityKind = keyof typeof EXTENSION_ACTIVITY_PAYLOAD_SCHEMAS;

export const EXTENSION_ACTIVITY_RENDERERS: Record<
  ExtensionActivityKind,
  (payload: Record<string, unknown>) => string
> = {
  "strategy.domain_created": (p) =>
    `A strategic domain "${String(p.name ?? "")}" was added`,
};
