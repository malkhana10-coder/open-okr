import { describe, expect, it } from "vitest";
import { planningProvider } from "../../lib/extension/planning";

/**
 * The provider the planning screens run the agents on.
 *
 * **This test is meant to fail the day a real model is connected.** While
 * the provider is fixed, "Draft gaps" asks no model: it works with the
 * workspace's AI off, and the screen says the output is a sample before the
 * button is pressed. A provider that asks a model makes that button an AI
 * affordance. CLAUDE.md's rule then applies: it carries the AI mark, and it
 * is hidden or disabled when the provider is off, with the hand-written path
 * unchanged. Do that work, then change what this test holds.
 */
describe("the planning screens' provider", () => {
  it("is fixed, so its buttons are not AI affordances yet", () => {
    const provider = planningProvider();
    expect(provider.fixed).toBe(true);
    // What `planning.listRuns` lists a run as a sample by.
    expect(provider.name).toBe("fixed");
  });
});
