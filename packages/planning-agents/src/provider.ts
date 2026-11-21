/**
 * What produces an agent's draft
 * (docs/extension/design/b0-vertical-slice.md §9أ).
 *
 * A provider is given a request and returns whatever it produced, unchecked.
 * The caller parses it. A real provider calls a model through the AI port; it
 * arrives in a later change.
 *
 * **The fixed provider returns drafts written in advance.** It exists so the
 * whole path from a document to an approved objective can be clicked through
 * before a model is wired in. What it returns is stored as an agent's draft
 * like any other, checked and verified the same way. It says that it is
 * fixed, so a screen can say so too.
 */
import type { GapAgentRequest } from "./gap-agent.ts";
import type { ObjectiveAgentRequest } from "./objective-agent.ts";

export type PlanningRequest = GapAgentRequest | ObjectiveAgentRequest;

export interface PlanningResult {
  /** Unchecked. The caller parses it. */
  readonly output: unknown;
  /** The model that produced it, for the run's record. */
  readonly model: string;
  /** What the call cost in US dollars, when the provider knows. */
  readonly costUsd?: number;
}

export interface PlanningProvider {
  /** For the run's record. */
  readonly name: string;
  /** True when the drafts were written in advance and no model is asked. */
  readonly fixed: boolean;
  generate(request: PlanningRequest): Promise<PlanningResult>;
}

/** Drafts written in advance, one per agent. */
export interface FixedDrafts {
  readonly gaps?: unknown;
  readonly objectives?: unknown;
}

export class FixedPlanningProvider implements PlanningProvider {
  readonly name = "fixed";
  readonly fixed = true;
  readonly #drafts: FixedDrafts;

  constructor(drafts: FixedDrafts) {
    this.#drafts = drafts;
  }

  generate(request: PlanningRequest): Promise<PlanningResult> {
    const output = this.#drafts[request.agent];
    if (output === undefined) {
      return Promise.reject(
        new Error(`The fixed provider holds no draft for "${request.agent}".`),
      );
    }
    return Promise.resolve({ output, model: "fixed" });
  }
}
