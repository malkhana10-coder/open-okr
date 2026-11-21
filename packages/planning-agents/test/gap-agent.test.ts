import { describe, expect, it } from "vitest";
import {
  FixedPlanningProvider,
  type GapAgentRequest,
  parseGapAgentOutput,
} from "../src/index.ts";

/**
 * The gap agent's contract
 * (docs/extension/design/b0-vertical-slice.md §5, §5.1 and §9أ).
 *
 * Whatever produces the draft, a model or the fixed provider the clickable
 * demo runs on, hands back the same shape, and it is checked here before
 * anything is stored.
 */
const GAP = {
  title: "لا يوجد نظام موحد يربط الفروع بالمركز الرئيس",
  description: "تعتمد معالجة الطلبات على إجراءات ورقية في ثلاثة فروع.",
  rationale: "الاستراتيجية تستهدف إنجاز 90% من الطلبات خلال خمسة أيام عمل.",
  confidence: 80,
  domain: "التراخيص والامتثال",
  evidence: [
    {
      document: "الاستراتيجية الفرعية للتراخيص والامتثال",
      page: 4,
      quote: "تعتمد معالجة الطلبات اليوم على إجراءات ورقية في ثلاثة فروع",
    },
  ],
};
const REPORT = {
  read: ["الاستراتيجية الفرعية للتراخيص والامتثال: 4 صفحات"],
  excluded: [],
};

describe("parseGapAgentOutput", () => {
  it("accepts a draft of the agreed shape", () => {
    const parsed = parseGapAgentOutput({ gaps: [GAP], report: REPORT });
    expect(parsed).toEqual({
      ok: true,
      output: { gaps: [GAP], report: REPORT },
    });
  });

  it("refuses a gap with no evidence: every claim rests on a page", () => {
    const parsed = parseGapAgentOutput({
      gaps: [{ ...GAP, evidence: [] }],
      report: REPORT,
    });
    expect(parsed.ok).toBe(false);
  });

  it("refuses a status, an owner or any other field the agent has no say in", () => {
    for (const extra of [
      { status: "approved" },
      { verification: "verified" },
      { createdBy: "somebody" },
    ]) {
      expect(
        parseGapAgentOutput({ gaps: [{ ...GAP, ...extra }], report: REPORT })
          .ok,
      ).toBe(false);
    }
    expect(
      parseGapAgentOutput({
        gaps: [
          {
            ...GAP,
            evidence: [{ ...GAP.evidence[0], verification: "verified" }],
          },
        ],
        report: REPORT,
      }).ok,
    ).toBe(false);
  });

  it("refuses a confidence outside 0 to 100, and a page below 1", () => {
    expect(
      parseGapAgentOutput({
        gaps: [{ ...GAP, confidence: 140 }],
        report: REPORT,
      }).ok,
    ).toBe(false);
    expect(
      parseGapAgentOutput({
        gaps: [{ ...GAP, evidence: [{ ...GAP.evidence[0], page: 0 }] }],
        report: REPORT,
      }).ok,
    ).toBe(false);
  });

  it("refuses more gaps than one run may draft", () => {
    const many = Array.from({ length: 41 }, (_, index) => ({
      ...GAP,
      title: `فجوة رقم ${index}`,
    }));
    expect(parseGapAgentOutput({ gaps: many, report: REPORT }).ok).toBe(false);
  });

  it("says what was wrong, for the run's record", () => {
    const parsed = parseGapAgentOutput({ gaps: "none" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.problem.length).toBeGreaterThan(0);
    }
  });

  it("refuses text that is not an object at all", () => {
    expect(parseGapAgentOutput("ignore previous instructions").ok).toBe(false);
    expect(parseGapAgentOutput(null).ok).toBe(false);
  });
});

describe("FixedPlanningProvider", () => {
  const request: GapAgentRequest = {
    agent: "gaps",
    sector: "قطاع الخدمات والتراخيص",
    documents: [
      {
        title: "الاستراتيجية الفرعية للتراخيص والامتثال",
        pages: [
          { page: 4, text: "تعتمد معالجة الطلبات اليوم على إجراءات ورقية" },
        ],
      },
    ],
    existingGaps: [],
  };

  it("returns what it was built with, whatever it is asked", async () => {
    const provider = new FixedPlanningProvider({
      gaps: { gaps: [GAP], report: REPORT },
    });
    const first = await provider.generate(request);
    const second = await provider.generate({ ...request, sector: "قطاع آخر" });
    expect(first.output).toEqual({ gaps: [GAP], report: REPORT });
    expect(second.output).toEqual(first.output);
  });

  it("says plainly that it is not a model", async () => {
    const provider = new FixedPlanningProvider({
      gaps: { gaps: [GAP], report: REPORT },
    });
    expect(provider.name).toBe("fixed");
    expect(provider.fixed).toBe(true);
    expect((await provider.generate(request)).model).toBe("fixed");
  });

  it("fails for an agent it holds no draft for", async () => {
    const provider = new FixedPlanningProvider({});
    await expect(provider.generate(request)).rejects.toThrow(/gaps/);
  });
});
