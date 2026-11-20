/**
 * Every table of the planning extension, exported through `@openokr/db` by one
 * line in the package index (docs/extension/UPSTREAM-DIFF.md).
 */
export {
  SOURCE_DOCUMENT_FAILURES,
  SOURCE_DOCUMENT_KINDS,
  SOURCE_DOCUMENT_STATUSES,
  sourceDocumentPages,
  sourceDocuments,
} from "./knowledge.ts";
export { orgAgencies, orgSectors } from "./org-units.ts";
export { GAP_STATUSES, strategicGaps, strategyDomains } from "./strategy.ts";
