/**
 * The planning agents' contracts
 * (docs/extension/design/b0-vertical-slice.md §5, §6.1 and §9أ).
 *
 * Pure: no database and no network. What an agent is given, the shape it must
 * hand back, and the provider interface that produces a draft.
 */
export {
  type AgentDocument,
  type AgentPage,
  type GapAgentOutput,
  type GapAgentRequest,
  MAX_GAPS_PER_RUN,
  type ParsedGapAgentOutput,
  parseGapAgentOutput,
} from "./gap-agent.ts";
export {
  type FixedDrafts,
  FixedPlanningProvider,
  type PlanningProvider,
  type PlanningRequest,
  type PlanningResult,
} from "./provider.ts";
