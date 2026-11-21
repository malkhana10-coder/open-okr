import { readFileSync } from "node:fs";
import { join } from "node:path";
import { trialEntityPlanner } from "@openokr/core";
import { verifyCitation } from "@openokr/knowledge";
import {
  type AgentDocument,
  parseGapAgentOutput,
  parseObjectiveAgentOutput,
} from "@openokr/planning-agents";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DOMAINS,
  SECTORS,
} from "../../../../packages/core/src/extension/trial-entity/data";
import { getDocumentReader } from "../../lib/extension/document-reader";

/**
 * The fixed drafts the trial entity is shown with, held against the two
 * documents as the product itself reads them (design §9a: "fixed outputs,
 * with real quotations from the pages").
 *
 * This lives in the web application because it is the one place that sees
 * both the PDF reader and the drafts. A quotation that stops matching, after
 * a document is reworded or the reader changes, fails here and not in front
 * of the people the product is being shown to.
 */

const DOCUMENTS = join(
  import.meta.dirname,
  "../../../../packages/core/src/extension/trial-entity/documents",
);

const read = async (file: string, title: string): Promise<AgentDocument> => {
  const result = await getDocumentReader().extract(
    readFileSync(join(DOCUMENTS, file)),
  );
  if (result.kind !== "pages") {
    throw new Error(`${file} could not be read.`);
  }
  return { title, pages: result.pages };
};

// Titles a person might type at upload, on purpose not the documents' own.
let licensing: AgentDocument;
let digital: AgentDocument;

beforeAll(async () => {
  licensing = await read("licensing-compliance.pdf", "استراتيجية التراخيص");
  digital = await read("digital-transformation.pdf", "استراتيجية الرقمنة");
});

const gapsFor = async (documents: AgentDocument[]) => {
  const result = await trialEntityPlanner().generate({
    agent: "gaps",
    sector: "قطاع",
    documents,
    existingGaps: [],
  });
  const parsed = parseGapAgentOutput(result.output);
  if (!parsed.ok) {
    throw new Error(parsed.problem);
  }
  return parsed.output;
};

const verdicts = (
  documents: AgentDocument[],
  evidence: readonly { document: string; page: number; quote: string }[],
) =>
  evidence.map((one) => {
    const page = documents
      .find((d) => d.title === one.document)
      ?.pages.find((p) => p.page === one.page);
    return page
      ? verifyCitation({ quote: one.quote, pageText: page.text }).status
      : "no such page";
  });

describe("the two documents", () => {
  it("are thirteen pages each and read cleanly", () => {
    expect(licensing.pages).toHaveLength(13);
    expect(digital.pages).toHaveLength(13);
    expect(licensing.pages[0]?.text).toContain(
      "الاستراتيجية الفرعية للتراخيص والامتثال",
    );
    expect(digital.pages[0]?.text).toContain(
      "الاستراتيجية الفرعية للتحول الرقمي",
    );
  });

  it("say on their first page that they are fiction", () => {
    for (const document of [licensing, digital]) {
      expect(document.pages[0]?.text).toContain("وثيقة خيالية");
    }
  });
});

describe("the fixed gap drafts", () => {
  it("pass the agent's own output schema", async () => {
    const output = await gapsFor([licensing]);
    expect(output.gaps.length).toBeGreaterThanOrEqual(5);
    expect(output.report.read).toEqual(["استراتيجية التراخيص"]);
  });

  it("quote the licensing document word for word, but for one on purpose", async () => {
    const output = await gapsFor([licensing]);
    const all = output.gaps.flatMap((gap) =>
      verdicts([licensing], gap.evidence),
    );
    expect(all.filter((v) => v === "unverified")).toHaveLength(1);
    expect(all.filter((v) => v === "verified").length).toBeGreaterThanOrEqual(
      7,
    );
    expect(all.every((v) => v === "verified" || v === "unverified")).toBe(true);
  });

  it("quote the digital document word for word, every one", async () => {
    const output = await gapsFor([digital]);
    expect(output.gaps.length).toBeGreaterThanOrEqual(5);
    const all = output.gaps.flatMap((gap) => verdicts([digital], gap.evidence));
    expect(all.every((v) => v === "verified")).toBe(true);
  });

  it("name the document by the title it was uploaded under", async () => {
    const output = await gapsFor([digital]);
    for (const gap of output.gaps) {
      for (const one of gap.evidence) {
        expect(one.document).toBe("استراتيجية الرقمنة");
      }
    }
  });

  it("file every gap under a domain the seed makes", async () => {
    const names: string[] = DOMAINS.map((domain) => domain.name);
    for (const document of [licensing, digital]) {
      for (const gap of (await gapsFor([document])).gaps) {
        expect(names, gap.title).toContain(gap.domain);
      }
    }
  });

  it("draft nothing for a real body's document that has the same name", async () => {
    // The sub-strategy's name alone is what a real document would carry.
    const real: AgentDocument = {
      title: "استراتيجيتنا",
      pages: Array.from({ length: 13 }, (_, index) => ({
        page: index + 1,
        text:
          index === 0
            ? "الاستراتيجية الفرعية للتحول الرقمي\nجهة أخرى\n2026 إلى 2030"
            : "نص",
      })),
    };
    const output = await gapsFor([real]);
    expect(output.gaps).toHaveLength(0);
    expect(output.report.read).toEqual([]);
  });

  it("leave out a gap the sector already holds", async () => {
    const all = await gapsFor([licensing]);
    const held = all.gaps[0]?.title as string;
    const result = await trialEntityPlanner().generate({
      agent: "gaps",
      sector: "قطاع",
      documents: [licensing],
      existingGaps: [held],
    });
    const parsed = parseGapAgentOutput(result.output);
    expect(parsed.ok && parsed.output.gaps.map((g) => g.title)).toEqual(
      all.gaps.slice(1).map((g) => g.title),
    );
  });

  it("draft nothing from a document they were not written for", async () => {
    const other: AgentDocument = {
      title: "وثيقة أخرى",
      pages: [{ page: 1, text: "وثيقة لا علاقة لها بالجهة التجريبية." }],
    };
    const output = await gapsFor([other]);
    expect(output.gaps).toHaveLength(0);
    expect(output.report.excluded.length).toBeGreaterThan(0);
  });

  it("keep each sector's gaps to its own document", async () => {
    const fromLicensing = (await gapsFor([licensing])).gaps.map((g) => g.title);
    const fromDigital = (await gapsFor([digital])).gaps.map((g) => g.title);
    expect(fromLicensing.filter((t) => fromDigital.includes(t))).toEqual([]);
  });
});

describe("the fixed objective drafts", () => {
  const objectivesFor = async (
    documents: AgentDocument[],
    gaps: string[],
    agencies: string[],
  ) => {
    const result = await trialEntityPlanner().generate({
      agent: "objectives",
      sector: "قطاع",
      agencies,
      gaps: gaps.map((title) => ({ title, description: null })),
      documents,
      existingObjectives: [],
    });
    const parsed = parseObjectiveAgentOutput(result.output);
    if (!parsed.ok) {
      throw new Error(parsed.problem);
    }
    return parsed.output;
  };

  const agenciesOf = (sector: string): string[] =>
    SECTORS.find((one) => one.name === sector)?.agencies.map((a) => a.name) ??
    [];
  const SERVICES = agenciesOf("قطاع الخدمات والتراخيص");
  const PLANNING = agenciesOf("قطاع التخطيط والتطوير");

  it("answer every gap but the unverified one, in an agency the seed makes", async () => {
    for (const [document, agencies] of [
      [licensing, SERVICES],
      [digital, PLANNING],
    ] as const) {
      expect(agencies.length).toBeGreaterThan(0);
      const gaps = (await gapsFor([document])).gaps.map((g) => g.title);
      const output = await objectivesFor([document], gaps, agencies);
      expect(output.objectives).toHaveLength(5);
      // Five different gaps, so no draft names a gap that is not drafted.
      expect(new Set(output.objectives.flatMap((o) => o.gaps)).size).toBe(5);
      for (const objective of output.objectives) {
        // Left out when the sector has no agency of that name.
        expect(objective.agency, objective.title).toBeDefined();
        expect(verdicts([document], objective.evidence)).toEqual(
          objective.evidence.map(() => "verified"),
        );
      }
    }
  });

  it("leave out the objective whose gap is gone, and say so", async () => {
    const gaps = (await gapsFor([licensing])).gaps.map((g) => g.title);
    const all = await objectivesFor([licensing], gaps, SERVICES);
    const gone = all.objectives[0];
    const fewer = await objectivesFor(
      [licensing],
      gaps.filter((title) => title !== gone?.gaps[0]),
      SERVICES,
    );
    expect(fewer.objectives.map((o) => o.title)).toEqual(
      all.objectives.slice(1).map((o) => o.title),
    );
    expect(
      fewer.report.excluded.some((line) =>
        line.includes(gone?.title as string),
      ),
    ).toBe(true);
  });

  it("still answer a gap whose title gained a space or lost its marks", async () => {
    const gaps = (await gapsFor([licensing])).gaps.map((g) => g.title);
    const retyped = gaps.map(
      (title) => ` ${title.replace(/[\u064B-\u0652]/g, "")} `,
    );
    const output = await objectivesFor([licensing], retyped, SERVICES);
    expect(output.objectives).toHaveLength(5);
    // The gap is named as the sector holds it, which the runner matches
    // on. The agent's schema trims a title, so the spaces are gone.
    const held = retyped.map((title) => title.trim());
    for (const objective of output.objectives) {
      expect(held).toContain(objective.gaps[0]);
    }
  });

  it("leave out an objective the sector already holds", async () => {
    const gaps = (await gapsFor([licensing])).gaps.map((g) => g.title);
    const all = await objectivesFor([licensing], gaps, SERVICES);
    const result = await trialEntityPlanner().generate({
      agent: "objectives",
      sector: "قطاع",
      agencies: SERVICES,
      gaps: gaps.map((title) => ({ title, description: null })),
      documents: [licensing],
      existingObjectives: [all.objectives[0]?.title as string],
    });
    const parsed = parseObjectiveAgentOutput(result.output);
    expect(parsed.ok && parsed.output.objectives).toHaveLength(4);
  });

  it("draft nothing when no gap is given", async () => {
    const output = await objectivesFor([licensing], [], SERVICES);
    expect(output.objectives).toHaveLength(0);
  });
});

describe("the provider", () => {
  it("is named `fixed`, which is what lists a run as a sample", () => {
    // `planning.listRuns` reads the stored provider name, nothing else.
    expect(trialEntityPlanner().name).toBe("fixed");
    expect(trialEntityPlanner().fixed).toBe(true);
  });
});
