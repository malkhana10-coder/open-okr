import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runExtractionJob } from "../../src/actions/extension/knowledge-extraction.ts";
import { callAction } from "../../src/actions/registry.ts";
import { createAuth } from "../../src/auth/auth.ts";
import { storeUpload } from "../../src/blobs/upload.ts";
import {
  buildTrialEntity,
  type TrialEntityResult,
} from "../../src/extension/trial-entity/builder.ts";
import { trialEntityPlanner } from "../../src/extension/trial-entity/planner.ts";
import { provisionWorkspaceForUser } from "../../src/workspaces/provisioning.ts";

/**
 * The fixed provider through the real runners, on the seeded trial entity.
 *
 * `apps/web/test/extension/trial-drafts.test.ts` holds the drafts against the
 * two PDFs. What is held here is what only the runners decide: that a draft's
 * domain and agency name something the seed made, that a second run adds
 * nothing, and that a run is listed as a sample.
 *
 * The page text is made from the provider's own quotations, each put on the
 * page it names, because this package has no PDF reader. The one quotation
 * that is a paraphrase is left off its page, as it is off the real one.
 */

const OWNER = "planner-owner";
const COVER =
  "الاستراتيجية الفرعية للتراخيص والامتثال\nالجهة الحكومية التجريبية\nوثيقة خيالية أُعدت لأغراض العرض والاختبار.";
const PARAPHRASED = "نقص المراقبين المؤهلين للمنشآت عالية الخطر";
const TITLE = "استراتيجية التراخيص كما سمّاها من رفعها";
const SERVICES = "قطاع الخدمات والتراخيص";

let workspaceId: string;
let built: TrialEntityResult;
let sectorId: string;

const as = async (userId: string) => ({
  pool: (await workerDb()).appPool,
  workspaceId,
  actor: { kind: "human" as const, userId },
});
const strategy = async () => {
  const person = built.people.find((one) => one.key === "strategy");
  return {
    ...(await as(person?.userId as string)),
    planner: trialEntityPlanner(),
  };
};
const sql = async <Row extends Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<Row[]> =>
  (await (await workerDb()).admin.query<Row>(text, values)).rows;

/** Thirteen pages holding every quotation on the page that names it. */
async function pages(): Promise<{ page: number; text: string }[]> {
  const blank = Array.from({ length: 13 }, (_, index) => ({
    page: index + 1,
    text: index === 0 ? COVER : "صفحة",
  }));
  const probe = { title: TITLE, pages: blank };
  const gaps = (
    await trialEntityPlanner().generate({
      agent: "gaps",
      sector: SERVICES,
      documents: [probe],
      existingGaps: [],
    })
  ).output as {
    gaps: { title: string; evidence: { page: number; quote: string }[] }[];
  };
  const objectives = (
    await trialEntityPlanner().generate({
      agent: "objectives",
      sector: SERVICES,
      agencies: [],
      gaps: gaps.gaps.map((gap) => ({ title: gap.title, description: null })),
      documents: [probe],
      existingObjectives: [],
    })
  ).output as {
    objectives: { evidence: { page: number; quote: string }[] }[];
  };
  const quotes = [
    ...gaps.gaps
      .filter((gap) => gap.title !== PARAPHRASED)
      .flatMap((gap) => gap.evidence),
    ...objectives.objectives.flatMap((objective) => objective.evidence),
  ];
  return blank.map((page) => ({
    page: page.page,
    text: [
      page.text,
      ...quotes.filter((one) => one.page === page.page).map((one) => one.quote),
    ].join("\n"),
  }));
}

beforeAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "مسؤول النظام", "planner-owner@example.com"],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "الجهة الحكومية التجريبية",
    })
  ).workspaceId;
  built = await buildTrialEntity({
    pool: wb.appPool,
    workspaceId,
    adminUserId: OWNER,
    auth: createAuth({
      pool: wb.appPool,
      secret: "a-test-secret-of-sufficient-length-for-signing",
      baseUrl: "http://localhost:3000",
      rateLimit: { enabled: false },
    }),
    password: "a-password-for-the-trial",
  });
  sectorId = built.sectors.find((s) => s.name === SERVICES)?.spaceId as string;

  const files = new Map<string, Buffer>();
  const stored = await storeUpload(
    await strategy(),
    {
      storage: {
        async put(key: string, body: Buffer) {
          files.set(key, body);
          return { key, size: body.byteLength };
        },
      },
      images: {
        async process(): Promise<never> {
          throw new Error("A PDF is not an image.");
        },
      },
    },
    {
      filename: "licensing.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("%PDF-1.7 the sub-strategy"),
    },
  );
  const registered = await callAction(
    await strategy(),
    "knowledge.registerDocument",
    {
      spaceId: sectorId,
      blobId: stored.blobId,
      title: TITLE,
      kind: "sub_strategy",
      year: 2027,
    },
  );
  const text = await pages();
  await runExtractionJob(
    { workspaceId, documentId: registered.id },
    {
      pool: wb.appPool,
      getFile: async (key) => files.get(key) ?? null,
      extractPages: async () => ({ kind: "pages", pages: text }),
    },
  );
}, 240_000);

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the gap agent on the fixed provider", () => {
  it("drafts six gaps, each under a domain the seed made", async () => {
    const run = await callAction(await strategy(), "planning.runGapAgent", {
      spaceId: sectorId,
    });
    expect(run.status).toBe("succeeded");
    expect(run.gapsDrafted).toBe(6);

    const { gaps } = await callAction(await strategy(), "strategy.listGaps", {
      spaceId: sectorId,
    });
    expect(gaps).toHaveLength(6);
    for (const gap of gaps) {
      expect(gap.status, gap.title).toBe("ai_draft");
      expect(gap.domainId, gap.title).not.toBeNull();
    }
  });

  it("stores every quotation verified but the paraphrase", async () => {
    const rows = await sql<{ title: string; verification: string }>(
      `select g.title, e.verification
         from evidence e join strategic_gaps g on g.id = e.subject_id
        where e.workspace_id = $1 and e.subject_type = 'gap'`,
      [workspaceId],
    );
    expect(rows).toHaveLength(9);
    expect(
      rows.filter((r) => r.verification !== "verified").map((r) => r.title),
    ).toEqual([PARAPHRASED]);
  });

  it("is listed as a sample run", async () => {
    const { runs } = await callAction(await strategy(), "planning.listRuns", {
      spaceId: sectorId,
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.fixed).toBe(true);
  });

  it("adds nothing on a second run", async () => {
    const run = await callAction(await strategy(), "planning.runGapAgent", {
      spaceId: sectorId,
    });
    expect(run.gapsDrafted).toBe(0);
    const { gaps } = await callAction(await strategy(), "strategy.listGaps", {
      spaceId: sectorId,
    });
    expect(gaps).toHaveLength(6);
  });
});

describe("the objective agent on the fixed provider", () => {
  it("drafts five objectives, each in the agency its draft names", async () => {
    const run = await callAction(
      await strategy(),
      "planning.runObjectiveAgent",
      { spaceId: sectorId, cycleId: built.planCycleId },
    );
    expect(run.status).toBe("succeeded");
    expect(run.objectivesDrafted).toBe(5);

    const rows = await sql<{ space: string }>(
      `select s.name as space
         from goals g join spaces s on s.id = g.space_id
        where g.workspace_id = $1 and g.ai_generated and g.deleted_at is null`,
      [workspaceId],
    );
    expect(rows).toHaveLength(5);
    // None fell back to the sector, which is what an unknown agency does.
    for (const row of rows) {
      expect(row.space.startsWith("وكالة"), row.space).toBe(true);
    }
  });

  it("adds nothing on a second run", async () => {
    const run = await callAction(
      await strategy(),
      "planning.runObjectiveAgent",
      { spaceId: sectorId, cycleId: built.planCycleId },
    );
    expect(run.objectivesDrafted).toBe(0);
  });

  it("repeats nothing the seed already holds", async () => {
    const rows = await sql<{ title: string; copies: string }>(
      `select title, count(*)::text as copies from goals
        where workspace_id = $1 and deleted_at is null
        group by title having count(*) > 1`,
      [workspaceId],
    );
    expect(rows).toEqual([]);
    const initiatives = await sql<{ title: string }>(
      `select i.title from initiatives i
         join goals g on g.workspace_id = i.workspace_id and g.title = i.title
        where i.workspace_id = $1`,
      [workspaceId],
    );
    expect(initiatives).toEqual([]);
  });
});
