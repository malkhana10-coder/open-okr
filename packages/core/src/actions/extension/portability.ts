/**
 * What a workspace archive does with the planning extension's tables
 * (TECHNICAL-PLAN §7.3, docs/extension/UPSTREAM-DIFF.md).
 *
 * Spread at the end of the shipped policy list. Every extension table
 * references shipped tables and never the other way round, so writing them
 * last is always a valid order. A new extension table is classified here by
 * whoever adds it: `portability-policy.test.ts` fails until it is.
 */
export const EXTENSION_TABLE_POLICY = [
  {
    table: "_migrations_ext",
    decision: "exclude",
    reason:
      "The extension schema's own bookkeeping, as `_migrations` is for the shipped schema. The receiving instance has its own.",
  },
  {
    table: "strategy_domains",
    decision: "export",
    reason:
      "The areas of the strategy that gaps and sector objectives are filed under.",
  },
] as const;
