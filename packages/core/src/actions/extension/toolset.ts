/**
 * The agent toolset the planning extension's tools are offered in
 * (docs/design/mcp-toolsets.md, docs/extension/UPSTREAM-DIFF.md).
 *
 * Explicit names, as every toolset is: a new extension action fails the
 * placement test until it is listed here.
 */
export const PLANNING_TOOLSET: ReadonlySet<string> = new Set([
  "strategy.listDomains",
  "strategy.createDomain",
]);
