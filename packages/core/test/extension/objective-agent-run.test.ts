import { FixedPlanningProvider } from "@openokr/planning-agents";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runExtractionJob } from "../../src/actions/extension/knowledge-extraction.ts";
import { callAction } from "../../src/actions/registry.ts";
import { storeUpload } from "../../src/blobs/upload.ts";
import { provisionWorkspaceForUser } from "../../src/workspaces/provisioning.ts";

/**
 * Running the sector-objectives agent
 * (docs/extension/design/b0-vertical-slice.md §5, criteria 8, 16 and 17).
 *
 * The fixed provider again. What it drafts becomes a real objective, held as
 * a draft: not live, marked as machine-written, tied to the gaps it answers,
 * and owned by the sector's lead until a person confirms or changes that.
 */
const OWNER = "objective-owner";
const LEAD = "objective-lead";
const OUTSIDER = "objective-outsider";
const TITLE = "الاستراتيجية الفرعية للتراخيص والامتثال";
const PAGE =
  "تهدف الجهة إلى رفع نسبة إنجاز طلبات التراخيص خلال خمسة أيام عمل إلى 90% بنهاية عام 2027.";
const GAP_TITLE = "إنجاز الطلبات يتجاوز خمسة أيام عمل";

let workspaceId: string;
let ownerMemberId: string;
let leadMemberId: string;
let sectorId: string;
let agencyId: string;
let cycleId: string;
let gapId: string;
let documentId: string;

const as = (userId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});
const owner = async () => ({ pool: (await workerDb()).appPool, ...as(OWNER) });

const REPORT = { read: ["فجوة واحدة"], excluded: [] };
const OBJECTIVE = {
  title: "رفع نسبة إصدار التراخيص خلال اتفاقية مستوى الخدمة إلى 90%",
  proposedTarget: "90% بنهاية 2027",
  rationale: "يغلق فجوة تأخر إنجاز الطلبات.",
  confidence: 75,
  objectiveType: "sectoral",
  agency: "وكالة التراخيص",
  gaps: [GAP_TITLE],
  evidence: [
    {
      document: TITLE,
      page: 1,
      quote: "رفع نسبة إنجاز طلبات التراخيص خلال خمسة أيام عمل",
    },
  ],
};

const run = async (objectives: readonly unknown[]) =>
  callAction(
    {
      ...(await owner()),
      planner: new FixedPlanningProvider({
        objectives: { objectives, report: REPORT },
      }),
    },
    "planning.runObjectiveAgent",
    { spaceId: sectorId, cycleId },
  );

const plan = async () =>
  callAction(await owner(), "strategy.listSectorPlan", { spaceId: sectorId });

async function member(userId: string, name: string) {
  const wb = await workerDb();
  const row = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status, kind)
     values (gen_random_uuid(), $1, $2, $3, 'active', 'human') returning id`,
    [workspaceId, userId, name],
  );
  const { roles } = await callAction(await owner(), "roles.list", {});
  await callAction(await owner(), "roles.assign", {
    memberId: row.rows[0]?.id as string,
    roleId: roles.find((role) => role.builtinKey === "member")?.id as string,
  });
  return row.rows[0]?.id as string;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values
       ($1, 'Owner', 'objective-owner@example.com'),
       ($2, 'Lead', 'objective-lead@example.com'),
       ($3, 'Outsider', 'objective-outsider@example.com')`,
    [OWNER, LEAD, OUTSIDER],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  leadMemberId = await member(LEAD, "Lead");
  await member(OUTSIDER, "Outsider");
  cycleId = (await callAction(await owner(), "cycles.ensureCurrent", {})).id;
  sectorId = (
    await callAction(await owner(), "spaces.create", {
      name: "قطاع الخدمات والتراخيص",
    })
  ).id;
  agencyId = (
    await callAction(await owner(), "spaces.create", { name: "وكالة التراخيص" })
  ).id;
  await callAction(await owner(), "strategy.setSector", { spaceId: sectorId });
  await callAction(await owner(), "strategy.setAgency", {
    spaceId: agencyId,
    sectorSpaceId: sectorId,
  });
  gapId = (
    await callAction(await owner(), "strategy.createGap", {
      spaceId: sectorId,
      title: GAP_TITLE,
    })
  ).id;

  const files = new Map<string, Buffer>();
  const stored = await storeUpload(
    await owner(),
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
      filename: "strategy.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("%PDF-1.7 the strategy"),
    },
  );
  documentId = (
    await callAction(await owner(), "knowledge.registerDocument", {
      spaceId: sectorId,
      blobId: stored.blobId,
      title: TITLE,
      kind: "sub_strategy",
      year: 2027,
    })
  ).id;
  await runExtractionJob(
    { workspaceId, documentId },
    {
      pool: wb.appPool,
      getFile: async (key) => files.get(key) ?? null,
      extractPages: async () => ({
        kind: "pages",
        pages: [{ page: 1, text: PAGE }],
      }),
    },
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("planning.runObjectiveAgent: before it runs", () => {
  it("refuses a sector with no gap to answer, and says so", async () => {
    await callAction(await owner(), "strategy.dismissGap", { id: gapId });
    await expect(run([OBJECTIVE])).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringMatching(/gap/i),
    });
  });

  it("refuses when no provider is configured", async () => {
    await expect(
      callAction(await owner(), "planning.runObjectiveAgent", {
        spaceId: sectorId,
        cycleId,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("answers not found to somebody who is not in the sector", async () => {
    const wb = await workerDb();
    await expect(
      callAction(
        {
          pool: wb.appPool,
          ...as(OUTSIDER),
          planner: new FixedPlanningProvider({
            objectives: { objectives: [OBJECTIVE], report: REPORT },
          }),
        },
        "planning.runObjectiveAgent",
        { spaceId: sectorId, cycleId },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("planning.runObjectiveAgent: a run", () => {
  it("stores a sector-level objective as a draft that is not live (criterion 8)", async () => {
    const wb = await workerDb();
    const result = await run([OBJECTIVE]);
    expect(result).toMatchObject({ objectivesDrafted: 1, status: "succeeded" });

    const goals = await wb.admin.query(
      `select title, level, draft_state, ai_generated, space_id, cycle_id
         from goals where workspace_id = $1`,
      [workspaceId],
    );
    expect(goals.rows).toEqual([
      {
        title: OBJECTIVE.title,
        level: "department",
        // Held back: it is in no list of live objectives until approved.
        draft_state: "draft",
        ai_generated: true,
        space_id: agencyId,
        cycle_id: cycleId,
      },
    ]);
  });

  it("ties it to the gap it answers, with its evidence checked, and classes it in the plan", async () => {
    const wb = await workerDb();
    await run([OBJECTIVE]);
    const { objectives } = await plan();
    expect(objectives).toHaveLength(1);
    expect(objectives[0]).toMatchObject({
      title: OBJECTIVE.title,
      spaceId: agencyId,
      profile: {
        objectiveType: "sectoral",
        planStatus: "new",
        sourceKind: "sub_strategy",
        sourceDocumentId: documentId,
      },
    });
    const goalId = objectives[0]?.goalId as string;
    const stored = await wb.admin.query(
      `select p.proposed_target, p.rationale, p.confidence,
              p.agent_run_id is not null as from_run,
              (select array_agg(l.gap_id) from gap_goal_links l where l.goal_id = p.goal_id) as gaps,
              (select array_agg(e.verification) from evidence e
                where e.subject_type = 'goal' and e.subject_id = p.goal_id) as evidence
         from goal_strategy_profiles p where p.goal_id = $1`,
      [goalId],
    );
    expect(stored.rows[0]).toEqual({
      proposed_target: "90% بنهاية 2027",
      rationale: OBJECTIVE.rationale,
      confidence: 75,
      from_run: true,
      gaps: [gapId],
      evidence: ["verified"],
    });
  });

  it("gives it to whoever ran the agent when the sector has no lead, unconfirmed (criterion 17)", async () => {
    const wb = await workerDb();
    await run([OBJECTIVE]);
    const stored = await wb.admin.query(
      `select g.champion_id, p.owner_confirmed_at
         from goals g join goal_strategy_profiles p on p.goal_id = g.id
        where g.workspace_id = $1`,
      [workspaceId],
    );
    expect(stored.rows).toEqual([
      { champion_id: ownerMemberId, owner_confirmed_at: null },
    ]);
  });

  it("gives it to the sector's lead when there is one, unconfirmed (criterion 17)", async () => {
    const wb = await workerDb();
    await callAction(await owner(), "strategy.setSector", {
      spaceId: sectorId,
      leadMemberId,
    });
    await run([OBJECTIVE]);
    const stored = await wb.admin.query(
      `select g.champion_id, p.owner_confirmed_at
         from goals g join goal_strategy_profiles p on p.goal_id = g.id
        where g.workspace_id = $1`,
      [workspaceId],
    );
    expect(stored.rows).toEqual([
      { champion_id: leadMemberId, owner_confirmed_at: null },
    ]);
  });

  it("files an objective with no agency, or an unknown one, under the sector itself", async () => {
    const { agency: _agency, ...ofSector } = OBJECTIVE;
    await run([
      ofSector,
      {
        ...OBJECTIVE,
        title: "هدف لوكالة غير موجودة",
        agency: "وكالة لا وجود لها",
      },
    ]);
    const { objectives } = await plan();
    expect(objectives.map((one) => one.spaceId)).toEqual([sectorId, sectorId]);
  });

  it("does not draft an objective the sector already has, or one that answers no known gap", async () => {
    await run([OBJECTIVE]);
    const second = await run([
      OBJECTIVE,
      {
        ...OBJECTIVE,
        title: "هدف يجيب فجوة غير موجودة",
        gaps: ["فجوة لا وجود لها"],
      },
    ]);
    expect(second.objectivesDrafted).toBe(0);
    expect((await plan()).objectives).toHaveLength(1);
    const { runs } = await callAction(await owner(), "planning.listRuns", {
      spaceId: sectorId,
    });
    expect(runs[0]).toMatchObject({ agent: "objectives" });
    const excluded = runs[0]?.report.excluded.join(" ") ?? "";
    expect(excluded).toContain(OBJECTIVE.title);
    expect(excluded).toContain("فجوة لا وجود لها");
  });

  it("stores nothing when the output names an owner, and records the failed run (criterion 16)", async () => {
    const wb = await workerDb();
    await expect(
      run([{ ...OBJECTIVE, championId: leadMemberId }]),
    ).rejects.toMatchObject({ code: "conflict" });
    const goals = await wb.admin.query(
      "select 1 from goals where workspace_id = $1",
      [workspaceId],
    );
    expect(goals.rows).toEqual([]);
    const { runs } = await callAction(await owner(), "planning.listRuns", {
      spaceId: sectorId,
    });
    expect(runs[0]).toMatchObject({ agent: "objectives", status: "failed" });
  });
});
