/**
 * The sector-objectives agent's contract
 * (docs/extension/design/b0-vertical-slice.md §5, criteria 8 and 17).
 *
 * The agent is shown a sector's gaps and drafts objectives that close them.
 * Each objective names the gaps it answers, by their titles, and rests on
 * quotations like a gap does.
 *
 * As strict as the gap agent's. The agent proposes a title, a target, a
 * reason, a type and an agency. It has no say in who owns the objective,
 * whether the owner confirmed it, or whether it is approved: an output that
 * carries any of those is refused whole.
 */
import { z } from "zod";
import {
  type AgentDocument,
  describeProblem,
  quotation,
  report,
} from "./gap-agent.ts";

export interface ObjectiveAgentRequest {
  readonly agent: "objectives";
  readonly sector: string;
  /** The names of the sector's agencies, one of which an objective may name. */
  readonly agencies: readonly string[];
  /** The gaps to answer. Set-aside gaps are not among them. */
  readonly gaps: readonly {
    readonly title: string;
    readonly description: string | null;
  }[];
  readonly documents: readonly AgentDocument[];
  /** Titles of objectives the sector already has, so none is drafted twice. */
  readonly existingObjectives: readonly string[];
}

/** The most objectives one run may draft. */
export const MAX_OBJECTIVES_PER_RUN = 30;

const draftedObjective = z.strictObject({
  title: z.string().trim().min(1).max(500),
  /** The target in words, as a plan states it: "90% by the end of 2027". */
  proposedTarget: z.string().trim().min(1).max(500),
  rationale: z.string().trim().min(1).max(4000),
  confidence: z.number().int().min(0).max(100),
  objectiveType: z.enum(["sectoral", "operational"]),
  /** One of the sector's agencies by name. Left out, it is the sector's own. */
  agency: z.string().trim().min(1).max(300).optional(),
  /** The titles of the gaps it answers, exactly as they were given. */
  gaps: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
  evidence: z.array(quotation).min(1).max(10),
});

const objectiveAgentOutput = z.strictObject({
  objectives: z.array(draftedObjective).max(MAX_OBJECTIVES_PER_RUN),
  report,
});

export type ObjectiveAgentOutput = z.infer<typeof objectiveAgentOutput>;

export type ParsedObjectiveAgentOutput =
  | { readonly ok: true; readonly output: ObjectiveAgentOutput }
  | { readonly ok: false; readonly problem: string };

export function parseObjectiveAgentOutput(
  raw: unknown,
): ParsedObjectiveAgentOutput {
  const parsed = objectiveAgentOutput.safeParse(raw);
  return parsed.success
    ? { ok: true, output: parsed.data }
    : { ok: false, problem: describeProblem(parsed.error) };
}
