import { describe, expect, it } from "vitest";
import {
  FixedPlanningProvider,
  type ObjectiveAgentRequest,
  parseObjectiveAgentOutput,
} from "../src/index.ts";

/**
 * The sector-objectives agent's contract
 * (docs/extension/design/b0-vertical-slice.md §5, criteria 8 and 17).
 */
const OBJECTIVE = {
  title: "رفع نسبة إصدار التراخيص خلال اتفاقية مستوى الخدمة إلى 90%",
  proposedTarget: "90% بنهاية 2027",
  rationale: "يغلق فجوة تأخر الطلبات التي تحتاج أكثر من موافقة.",
  confidence: 75,
  objectiveType: "sectoral",
  agency: "وكالة التراخيص",
  gaps: ["لا يوجد نظام موحد يربط الفروع بالمركز الرئيس"],
  evidence: [
    {
      document: "الاستراتيجية الفرعية للتراخيص والامتثال",
      page: 2,
      quote: "رفع نسبة إنجاز طلبات التراخيص خلال خمسة أيام عمل",
    },
  ],
};
const REPORT = { read: ["فجوة واحدة"], excluded: [] };

describe("parseObjectiveAgentOutput", () => {
  it("accepts a draft of the agreed shape", () => {
    expect(
      parseObjectiveAgentOutput({ objectives: [OBJECTIVE], report: REPORT }),
    ).toEqual({
      ok: true,
      output: { objectives: [OBJECTIVE], report: REPORT },
    });
  });

  it("refuses an objective tied to no gap, and one with no evidence", () => {
    for (const broken of [{ gaps: [] }, { evidence: [] }]) {
      expect(
        parseObjectiveAgentOutput({
          objectives: [{ ...OBJECTIVE, ...broken }],
          report: REPORT,
        }).ok,
      ).toBe(false);
    }
  });

  it("refuses an owner, a status or an approval: none of them is the agent's", () => {
    for (const extra of [
      { owner: "somebody" },
      { championId: "01a1f7dd-23c8-7689-869f-58dc858c27f4" },
      { status: "approved" },
      { draftState: null },
      { ownerConfirmed: true },
    ]) {
      expect(
        parseObjectiveAgentOutput({
          objectives: [{ ...OBJECTIVE, ...extra }],
          report: REPORT,
        }).ok,
      ).toBe(false);
    }
  });

  it("refuses an objective type outside the two the plan has", () => {
    expect(
      parseObjectiveAgentOutput({
        objectives: [{ ...OBJECTIVE, objectiveType: "company" }],
        report: REPORT,
      }).ok,
    ).toBe(false);
  });

  it("lets the agency be left out, for an objective of the sector itself", () => {
    const { agency: _agency, ...ofSector } = OBJECTIVE;
    expect(
      parseObjectiveAgentOutput({ objectives: [ofSector], report: REPORT }).ok,
    ).toBe(true);
  });
});

describe("FixedPlanningProvider for objectives", () => {
  const request: ObjectiveAgentRequest = {
    agent: "objectives",
    sector: "قطاع الخدمات والتراخيص",
    agencies: ["وكالة التراخيص"],
    gaps: [{ title: OBJECTIVE.gaps[0] as string, description: null }],
    documents: [],
    existingObjectives: [],
  };

  it("returns the objectives draft it was built with", async () => {
    const provider = new FixedPlanningProvider({
      objectives: { objectives: [OBJECTIVE], report: REPORT },
    });
    expect((await provider.generate(request)).output).toEqual({
      objectives: [OBJECTIVE],
      report: REPORT,
    });
  });

  it("fails when it holds only the other agent's draft", async () => {
    const provider = new FixedPlanningProvider({
      gaps: { gaps: [], report: REPORT },
    });
    await expect(provider.generate(request)).rejects.toThrow(/objectives/);
  });
});
