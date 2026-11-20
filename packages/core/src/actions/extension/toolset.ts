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
  "strategy.listGaps",
  "strategy.createGap",
  "strategy.updateGap",
  "strategy.dismissGap",
  "strategy.listSectorPlan",
  "strategy.setGoalProfile",
  "strategy.listOrgUnits",
  "strategy.setSector",
  "strategy.setAgency",
  "knowledge.registerDocument",
  "knowledge.listDocuments",
  "knowledge.readPage",
  "knowledge.listEvidence",
  "knowledge.addEvidence",
  "knowledge.removeEvidence",
]);
