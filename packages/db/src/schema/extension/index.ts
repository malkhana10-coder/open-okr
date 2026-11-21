/**
 * Every table of the planning extension, exported through `@openokr/db` by one
 * line in the package index (docs/extension/UPSTREAM-DIFF.md).
 */

export { approvalItems, approvalRequests } from "./governance.ts";
export {
  EVIDENCE_UNVERIFIED_REASONS,
  EVIDENCE_VERIFICATIONS,
  evidence,
  SOURCE_DOCUMENT_FAILURES,
  SOURCE_DOCUMENT_KINDS,
  SOURCE_DOCUMENT_STATUSES,
  sourceDocumentPages,
  sourceDocuments,
} from "./knowledge.ts";
export { orgAgencies, orgSectors } from "./org-units.ts";
export {
  GAP_STATUSES,
  gapGoalLinks,
  goalStrategyProfiles,
  OBJECTIVE_PRIORITIES,
  OBJECTIVE_SOURCES,
  OBJECTIVE_TYPES,
  PLAN_STATUSES,
  PLANNING_AGENTS,
  PLANNING_RUN_STATUSES,
  planningAgentRuns,
  strategicGaps,
  strategyDomains,
} from "./strategy.ts";
