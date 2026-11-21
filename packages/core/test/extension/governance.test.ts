import { FixedPlanningProvider } from "@openokr/planning-agents";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runExtractionJob } from "../../src/actions/extension/knowledge-extraction.ts";
import { callAction } from "../../src/actions/registry.ts";
import { storeUpload } from "../../src/blobs/upload.ts";
import { provisionWorkspaceForUser } from "../../src/workspaces/provisioning.ts";

/**
 * Approval in one step
 * (docs/extension/design/b0-vertical-slice.md §13, criteria 5, 9, 10, 11, 17).
 *
 * The strategy office sends a sector's gaps and drafted objectives for
 * approval. Leadership approves the batch or returns it with a comment.
 * Who may do which is the role matrix's `approval` domain, not a check
 * written into each action.
 */
const OWNER = "gov-owner";
const STRATEGY = "gov-strategy";
const LEADER = "gov-leader";
const ADMIN = "gov-admin";
const PLAIN = "gov-plain";
const TITLE = "الاستراتيجية الفرعية للتراخيص والامتثال";
const PAGE =
  "تهدف الجهة إلى رفع نسبة إنجاز طلبات التراخيص خلال خمسة أيام عمل إلى 90% بنهاية عام 2027.";
const QUOTE = "رفع نسبة إنجاز طلبات التراخيص خلال خمسة أيام عمل";

const VIEW = 10;
const COMMENT = 40;
const EDIT = 70;
const FULL = 100;

let workspaceId: string;
let sectorId: string;
let cycleId: string;
let documentId: string;
let gapId: string;
const members: Record<string, string> = {};

const as = (userId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});
const call = async (userId: string) => ({
  pool: (await workerDb()).appPool,
  ...as(userId),
});

async function role(name: string, approval: number, others: number) {
  const domains = ["goal", "kpi", "initiative", "task"] as const;
  return (
    await callAction(await call(OWNER), "roles.create", {
      name,
      permissions: [
        ...domains.map((domain) => ({ domain, level: others as never })),
        { domain: "comment", level: COMMENT as never },
        { domain: "space", level: VIEW as never },
        { domain: "workspace", level: VIEW as never },
        { domain: "approval", level: approval as never },
      ],
    })
  ).id;
}

async function join(userId: string, name: string, roleId: string) {
  const wb = await workerDb();
  const row = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status, kind)
     values (gen_random_uuid(), $1, $2, $3, 'active', 'human') returning id`,
    [workspaceId, userId, name],
  );
  const id = row.rows[0]?.id as string;
  await callAction(await call(OWNER), "roles.assign", { memberId: id, roleId });
  members[userId] = id;
  return id;
}

const OBJECTIVE = {
  title: "رفع نسبة إصدار التراخيص خلال اتفاقية مستوى الخدمة إلى 90%",
  proposedTarget: "90% بنهاية 2027",
  rationale: "يغلق فجوة تأخر إنجاز الطلبات.",
  confidence: 75,
  objectiveType: "sectoral",
  gaps: ["إنجاز الطلبات يتجاوز خمسة أيام عمل"],
  evidence: [{ document: TITLE, page: 1, quote: QUOTE }],
};

/** A gap with verified evidence and one drafted objective, as the strategy office. */
async function draftBatch() {
  gapId = (
    await callAction(await call(STRATEGY), "strategy.createGap", {
      spaceId: sectorId,
      title: "إنجاز الطلبات يتجاوز خمسة أيام عمل",
    })
  ).id;
  await callAction(await call(STRATEGY), "knowledge.addEvidence", {
    subjectType: "gap",
    subjectId: gapId,
    documentId,
    page: 1,
    quote: QUOTE,
  });
  await callAction(
    {
      ...(await call(STRATEGY)),
      planner: new FixedPlanningProvider({
        objectives: {
          objectives: [OBJECTIVE],
          report: { read: [], excluded: [] },
        },
      }),
    },
    "planning.runObjectiveAgent",
    { spaceId: sectorId, cycleId },
  );
  const { objectives } = await callAction(
    await call(STRATEGY),
    "strategy.listSectorPlan",
    { spaceId: sectorId },
  );
  return objectives[0]?.goalId as string;
}

const submit = async (userId = STRATEGY) =>
  callAction(await call(userId), "governance.submit", { spaceId: sectorId });

async function readyBatch() {
  const goalId = await draftBatch();
  await callAction(await call(STRATEGY), "strategy.confirmGoalOwner", {
    goalId,
  });
  return goalId;
}

const state = async (goalId: string) => {
  const wb = await workerDb();
  const gap = await wb.admin.query<{ status: string }>(
    "select status from strategic_gaps where id = $1",
    [gapId],
  );
  const goal = await wb.admin.query<{ draft_state: string | null }>(
    "select draft_state from goals where id = $1",
    [goalId],
  );
  return { gap: gap.rows[0]?.status, goal: goal.rows[0]?.draft_state };
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values
       ($1, 'Owner', 'gov-owner@example.com'),
       ($2, 'Strategy', 'gov-strategy@example.com'),
       ($3, 'Leader', 'gov-leader@example.com'),
       ($4, 'Admin', 'gov-admin@example.com'),
       ($5, 'Plain', 'gov-plain@example.com')`,
    [OWNER, STRATEGY, LEADER, ADMIN, PLAIN],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Owner" })
  ).workspaceId;
  const { roles } = await callAction(await call(OWNER), "roles.list", {});
  const builtin = (key: string) =>
    roles.find((one) => one.builtinKey === key)?.id as string;
  await join(STRATEGY, "Strategy", await role("مكتب الاستراتيجية", EDIT, EDIT));
  await join(LEADER, "Leader", await role("القيادة", FULL, VIEW));
  await join(ADMIN, "Admin", builtin("admin"));
  await join(PLAIN, "Plain", builtin("member"));

  cycleId = (await callAction(await call(OWNER), "cycles.ensureCurrent", {}))
    .id;
  sectorId = (
    await callAction(await call(OWNER), "spaces.create", {
      name: "قطاع الخدمات والتراخيص",
    })
  ).id;
  await callAction(await call(OWNER), "strategy.setSector", {
    spaceId: sectorId,
  });
  for (const userId of [STRATEGY, PLAIN]) {
    await callAction(await call(OWNER), "spaces.addMember", {
      spaceId: sectorId,
      memberId: members[userId] as string,
      role: "member",
    });
  }

  const files = new Map<string, Buffer>();
  const stored = await storeUpload(
    await call(OWNER),
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
    await callAction(await call(OWNER), "knowledge.registerDocument", {
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

describe("governance.submit", () => {
  it("sends the sector's open gaps and drafted objectives as one request", async () => {
    const goalId = await readyBatch();
    const sent = await submit();
    expect(sent).toEqual({
      requestId: expect.any(String),
      gaps: 1,
      objectives: 1,
    });
    // The gap waits for a decision. The objective is still held back.
    expect(await state(goalId)).toEqual({ gap: "in_review", goal: "draft" });
  });

  it("refuses a batch with a drafted objective whose owner nobody confirmed (criterion 17)", async () => {
    await draftBatch();
    await expect(submit()).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringMatching(/owner/i),
    });
  });

  it("refuses a batch that holds an unverified quotation (criterion 5)", async () => {
    await readyBatch();
    await callAction(await call(STRATEGY), "knowledge.addEvidence", {
      subjectType: "gap",
      subjectId: gapId,
      documentId,
      page: 1,
      quote: "تلتزم الجهة بافتتاح عشرة فروع جديدة خلال عامين",
    });
    await expect(submit()).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringMatching(/unverified/i),
    });
  });

  it("refuses when there is nothing to send, and while a request is already open", async () => {
    await expect(submit()).rejects.toMatchObject({ code: "conflict" });
    await readyBatch();
    await submit();
    await expect(submit()).rejects.toMatchObject({ code: "conflict" });
  });

  it("is for the strategy office: a plain member of the sector may not send", async () => {
    await readyBatch();
    await expect(submit(PLAIN)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("answers not found to somebody who is not in the sector", async () => {
    await readyBatch();
    await expect(submit(LEADER)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("governance.decide", () => {
  const decide = async (
    userId: string,
    requestId: string,
    decision: "approve" | "return",
    comment?: string,
  ) =>
    callAction(await call(userId), "governance.decide", {
      requestId,
      decision,
      ...(comment === undefined ? {} : { comment }),
    });

  it("approves: the gaps are approved, the objectives go live, and the audit names who decided (criterion 9)", async () => {
    const wb = await workerDb();
    const goalId = await readyBatch();
    const { requestId } = await submit();
    await decide(LEADER, requestId, "approve");

    expect(await state(goalId)).toEqual({ gap: "approved", goal: null });
    const audit = await wb.admin.query<{ actor_member_id: string }>(
      "select actor_member_id from audit_events where action = 'governance.decide' and target_id = $1",
      [requestId],
    );
    expect(audit.rows).toEqual([{ actor_member_id: members[LEADER] }]);
    // Live means it is in the list of the sector's objectives like any other.
    const goals = await wb.admin.query<{ next: Date | null }>(
      "select next_check_in_at as next from goals where id = $1",
      [goalId],
    );
    expect(goals.rows[0]?.next).not.toBeNull();
  });

  it("returns with a comment: nothing goes live, and the strategy office sees it came back (criterion 10)", async () => {
    const goalId = await readyBatch();
    const { requestId } = await submit();
    await decide(LEADER, requestId, "return", "المستهدف يحتاج خط أساس");

    expect(await state(goalId)).toEqual({ gap: "returned", goal: "draft" });
    const next = await callAction(
      await call(STRATEGY),
      "governance.myNext",
      {},
    );
    expect(next.returned).toEqual([
      {
        requestId,
        spaceId: sectorId,
        spaceName: "قطاع الخدمات والتراخيص",
        comment: "المستهدف يحتاج خط أساس",
      },
    ]);
    // And it can be changed and sent again.
    await callAction(await call(STRATEGY), "strategy.updateGap", {
      id: gapId,
      rationale: "أضيف خط الأساس",
    });
    await expect(submit()).resolves.toMatchObject({ gaps: 1, objectives: 1 });
  });

  it("asks for a comment when returning", async () => {
    await readyBatch();
    const { requestId } = await submit();
    await expect(decide(LEADER, requestId, "return")).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("refuses the person who sent the request, whatever their role (criterion 11)", async () => {
    const goalId = await readyBatch();
    // The Owner may both send and decide, but not the same request.
    await callAction(await call(OWNER), "spaces.addMember", {
      spaceId: sectorId,
      memberId: (
        await (
          await workerDb()
        ).admin.query<{ id: string }>(
          "select id from workspace_members where workspace_id = $1 and user_id = $2",
          [workspaceId, OWNER],
        )
      ).rows[0]?.id as string,
      role: "member",
    }).catch(() => undefined);
    const { requestId } = await submit(OWNER);
    await expect(decide(OWNER, requestId, "approve")).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await state(goalId)).toEqual({ gap: "in_review", goal: "draft" });
    // Somebody else with the right may.
    await decide(LEADER, requestId, "approve");
    expect(await state(goalId)).toEqual({ gap: "approved", goal: null });
  });

  it("is for leadership: the strategy office and an Admin may send and may not decide", async () => {
    await readyBatch();
    const { requestId } = await submit();
    for (const userId of [ADMIN, PLAIN]) {
      await expect(decide(userId, requestId, "approve")).rejects.toMatchObject({
        code: "not_found",
      });
    }
  });

  it("decides a request once", async () => {
    await readyBatch();
    const { requestId } = await submit();
    await decide(LEADER, requestId, "approve");
    await expect(decide(LEADER, requestId, "approve")).rejects.toMatchObject({
      code: "conflict",
    });
  });
});

describe("governance.myNext", () => {
  it("shows leadership what waits for a decision, without their being in the sector", async () => {
    await readyBatch();
    const { requestId } = await submit();
    const next = await callAction(await call(LEADER), "governance.myNext", {});
    expect(next.toDecide).toEqual([
      {
        requestId,
        spaceId: sectorId,
        spaceName: "قطاع الخدمات والتراخيص",
        gaps: 1,
        objectives: 1,
      },
    ]);
    // Not the sender's to decide, so it is not in the sender's list.
    const mine = await callAction(
      await call(STRATEGY),
      "governance.myNext",
      {},
    );
    expect(mine.toDecide).toEqual([]);
  });
});

describe("an objective held for approval", () => {
  it("cannot be made live by its owner through the product's own publish", async () => {
    const goalId = await readyBatch();
    await expect(
      callAction(await call(STRATEGY), "goals.publishDraft", { id: goalId }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await state(goalId)).goal).toBe("draft");
  });
});

describe("strategy.confirmGoalOwner", () => {
  it("records who confirmed and when, once", async () => {
    const wb = await workerDb();
    const goalId = await draftBatch();
    await callAction(await call(STRATEGY), "strategy.confirmGoalOwner", {
      goalId,
    });
    const stored = await wb.admin.query(
      `select owner_confirmed_by, owner_confirmed_at is not null as confirmed
         from goal_strategy_profiles where goal_id = $1`,
      [goalId],
    );
    expect(stored.rows).toEqual([
      { owner_confirmed_by: members[STRATEGY], confirmed: true },
    ]);
  });
});
