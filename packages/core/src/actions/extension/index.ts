/**
 * The planning extension's actions, spread into the action registry by one
 * line (docs/extension/design/b0-vertical-slice.md §6.1,
 * docs/extension/UPSTREAM-DIFF.md).
 *
 * The registry is static at compile time: its keys type `callAction`, the REST
 * routes are computed from it when it loads, and the contract generator runs
 * from inside this package. So the extension's actions are declared here, in a
 * folder that is the extension's alone, rather than registered from a package
 * above this one.
 */
import { listRuns, runGapAgent } from "./agent-runs.ts";
import {
  addEvidence,
  listEvidence,
  listSectorEvidence,
  removeEvidence,
} from "./evidence.ts";
import { createGap, dismissGap, listGaps, updateGap } from "./gaps.ts";
import {
  confirmGoalOwner,
  decideApproval,
  myNext,
  submitForApproval,
} from "./governance.ts";
import {
  listSourceDocuments,
  readSourceDocumentPage,
  registerSourceDocument,
} from "./knowledge.ts";
import { runObjectiveAgent } from "./objective-runs.ts";
import { listOrgUnits, setAgency, setSector } from "./org-units.ts";
import { listSectorPlan, setGoalProfile } from "./sector-plan.ts";
import { createStrategyDomain, listStrategyDomains } from "./strategy.ts";

export const EXTENSION_ACTION_MAP = {
  "strategy.listDomains": listStrategyDomains,
  "strategy.createDomain": createStrategyDomain,
  "governance.myNext": myNext,
  "governance.submit": submitForApproval,
  "governance.decide": decideApproval,
  "strategy.confirmGoalOwner": confirmGoalOwner,
  "planning.listRuns": listRuns,
  "planning.runGapAgent": runGapAgent,
  "planning.runObjectiveAgent": runObjectiveAgent,
  "strategy.listGaps": listGaps,
  "strategy.createGap": createGap,
  "strategy.updateGap": updateGap,
  "strategy.dismissGap": dismissGap,
  "strategy.listSectorPlan": listSectorPlan,
  "strategy.setGoalProfile": setGoalProfile,
  "strategy.listOrgUnits": listOrgUnits,
  "strategy.setSector": setSector,
  "strategy.setAgency": setAgency,
  "knowledge.registerDocument": registerSourceDocument,
  "knowledge.listDocuments": listSourceDocuments,
  "knowledge.readPage": readSourceDocumentPage,
  "knowledge.listEvidence": listEvidence,
  "knowledge.listSectorEvidence": listSectorEvidence,
  "knowledge.addEvidence": addEvidence,
  "knowledge.removeEvidence": removeEvidence,
} as const;
