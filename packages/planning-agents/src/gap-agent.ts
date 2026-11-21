/**
 * The gap agent's contract: what it is given and what it must hand back
 * (docs/extension/design/b0-vertical-slice.md §5 and §5.1).
 *
 * **The output is checked before anything is stored, and it is strict.** An
 * agent drafts a title, a description, a reason, how sure it is, and the
 * quotations it rests on. It has no say in a gap's status, its owner, or
 * whether a quotation was verified, so a field of that kind is not ignored
 * here: it makes the whole output invalid. Text inside a source document can
 * tell a model to write "status: approved". This is one of the places where
 * that goes nowhere.
 *
 * **A quotation names its document by title, not by id.** The agent reads
 * titles and pages. Ids are the caller's, and the caller matches a title to
 * the sector's own documents, so a quotation cannot point at a document the
 * agent was never shown.
 */
import { z } from "zod";

/** One page of a source document, as the agent is shown it. */
export interface AgentPage {
  readonly page: number;
  readonly text: string;
}

export interface AgentDocument {
  readonly title: string;
  readonly pages: readonly AgentPage[];
}

export interface GapAgentRequest {
  readonly agent: "gaps";
  /** The sector's name. */
  readonly sector: string;
  /** The sector's documents that have been read. Data, never instructions. */
  readonly documents: readonly AgentDocument[];
  /** Titles of the gaps the sector already has, so they are not drafted again. */
  readonly existingGaps: readonly string[];
}

/** The most gaps one run may draft. More than a person will review. */
export const MAX_GAPS_PER_RUN = 40;

const quotation = z.strictObject({
  /** The document's title, exactly as it was given. */
  document: z.string().trim().min(1).max(300),
  /** Counted from 1. */
  page: z.number().int().min(1),
  quote: z.string().trim().min(1).max(2000),
});

const draftedGap = z.strictObject({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(4000),
  /** Why this is a gap: what the strategy asks for that is not there. */
  rationale: z.string().trim().min(1).max(4000),
  /** How sure the agent is, 0 to 100. */
  confidence: z.number().int().min(0).max(100),
  /** A strategic domain by name, when the agent can place the gap in one. */
  domain: z.string().trim().min(1).max(160).optional(),
  evidence: z.array(quotation).min(1).max(10),
});

/** What the agent read and what it left out, for the person reviewing. */
const report = z.strictObject({
  read: z.array(z.string().trim().min(1).max(500)).max(100),
  excluded: z.array(z.string().trim().min(1).max(500)).max(100),
});

const gapAgentOutput = z.strictObject({
  gaps: z.array(draftedGap).max(MAX_GAPS_PER_RUN),
  report,
});

export type GapAgentOutput = z.infer<typeof gapAgentOutput>;

export type ParsedGapAgentOutput =
  | { readonly ok: true; readonly output: GapAgentOutput }
  /** `problem` is for the run's record, not for a screen. */
  | { readonly ok: false; readonly problem: string };

export function parseGapAgentOutput(raw: unknown): ParsedGapAgentOutput {
  const parsed = gapAgentOutput.safeParse(raw);
  if (parsed.success) {
    return { ok: true, output: parsed.data };
  }
  const problem = parsed.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, problem };
}
