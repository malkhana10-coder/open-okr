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
  {
    table: "org_sectors",
    decision: "export",
    reason:
      "Which spaces are sectors, the upper of the two planning levels, and who answers for each.",
  },
  {
    table: "org_agencies",
    decision: "export",
    reason: "Which spaces are agencies, and the sector each one is under.",
  },
  {
    table: "strategic_gaps",
    decision: "export",
    reason:
      "What each sector's strategy asks for that the sector is not yet doing, and where each gap stands.",
  },
  {
    table: "source_documents",
    decision: "export",
    reason:
      "Which uploaded file a sector plans from, and what kind of document it is. The file itself is a blob.",
  },
  {
    table: "source_document_pages",
    decision: "export",
    reason:
      "The text of each page, which the quotations of a workspace's gaps and objectives are checked against.",
  },
  {
    table: "evidence",
    decision: "export",
    reason:
      "The quotations each gap rests on, with the page each is from and whether it was found there.",
  },
] as const;
