import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../../src/workspaces/provisioning.ts";

/**
 * What kind of item an objective is in the plan, and the sector's plan as
 * one list (docs/extension/design/b0-vertical-slice.md §12.2).
 *
 * A plan holds three kinds of item: a sector objective, an operational
 * objective, and an operational indicator that is followed without being an
 * objective. The first two are goals told apart by a profile beside the
 * goal. The third is the product's own indicator, owned by an agency.
 */
const OWNER = "plan-owner";
const OUTSIDER = "plan-outsider";

let workspaceId: string;
let ownerMemberId: string;
let sectorId: string;
let agencyId: string;
let cycleId: string;

const as = (userId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});
const owner = async () => ({ pool: (await workerDb()).appPool, ...as(OWNER) });

async function goal(title: string, spaceId: string) {
  return (
    (await callAction(await owner(), "goals.create", {
      title,
      cycleId,
      level: "department",
      ownerKind: "space",
      spaceId,
      championId: ownerMemberId,
      weight: 1,
    })) as { id: string }
  ).id;
}

async function indicator(title: string, spaceId: string) {
  return (
    (await callAction(await owner(), "kpis.create", {
      title,
      frequency: "quarterly",
      direction: "lower_better",
      indicatorType: "lagging",
      tier: "output",
      aggregate: "sum",
      ownerKind: "space",
      spaceId,
    })) as { id: string }
  ).id;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values
       ($1, 'Owner', 'plan-owner@example.com'),
       ($2, 'Outsider', 'plan-outsider@example.com')`,
    [OWNER, OUTSIDER],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
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
  const second = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status, kind)
     values (gen_random_uuid(), $1, $2, 'Outsider', 'active', 'human') returning id`,
    [workspaceId, OUTSIDER],
  );
  const { roles } = await callAction(await owner(), "roles.list", {});
  await callAction(await owner(), "roles.assign", {
    memberId: second.rows[0]?.id as string,
    roleId: roles.find((role) => role.builtinKey === "member")?.id as string,
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const PROFILE = {
  objectiveType: "sectoral",
  priority: "priority",
  planStatus: "carried",
  sourceKind: "proposed",
  baselineUndetermined: true,
} as const;

describe("strategy.setGoalProfile", () => {
  it("says what an objective is in the plan, and reads back in the sector's plan", async () => {
    const id = await goal("رفع نسبة إصدار التراخيص ضمن SLA إلى 90%", agencyId);
    await callAction(await owner(), "strategy.setGoalProfile", {
      goalId: id,
      ...PROFILE,
    });
    const plan = await callAction(await owner(), "strategy.listSectorPlan", {
      spaceId: sectorId,
    });
    expect(plan.objectives).toEqual([
      {
        goalId: id,
        title: "رفع نسبة إصدار التراخيص ضمن SLA إلى 90%",
        spaceId: agencyId,
        spaceName: "وكالة التراخيص",
        profile: { ...PROFILE, sourceDocumentId: null },
      },
    ]);
  });

  it("replaces the profile when it is set again, and keeps one row", async () => {
    const wb = await workerDb();
    const id = await goal("خفض متوسط زمن معالجة الشكاوى", agencyId);
    await callAction(await owner(), "strategy.setGoalProfile", {
      goalId: id,
      ...PROFILE,
    });
    await callAction(await owner(), "strategy.setGoalProfile", {
      goalId: id,
      ...PROFILE,
      objectiveType: "operational",
      priority: "not_priority",
      baselineUndetermined: false,
    });
    const rows = await wb.admin.query(
      "select objective_type, priority, baseline_undetermined from goal_strategy_profiles where goal_id = $1",
      [id],
    );
    expect(rows.rows).toEqual([
      {
        objective_type: "operational",
        priority: "not_priority",
        baseline_undetermined: false,
      },
    ]);
  });

  it("takes a source document only for an objective that comes from a sub-strategy", async () => {
    const id = await goal("رفع نسبة الخدمات الرقمية المؤتمتة", agencyId);
    const missing = "01a1f7dd-23c8-7689-869f-58dc858c27f4";
    await expect(
      callAction(await owner(), "strategy.setGoalProfile", {
        goalId: id,
        ...PROFILE,
        sourceKind: "proposed",
        sourceDocumentId: missing,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      callAction(await owner(), "strategy.setGoalProfile", {
        goalId: id,
        ...PROFILE,
        sourceKind: "sub_strategy",
        sourceDocumentId: missing,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses somebody who may not edit the objective", async () => {
    // The Member role may edit any objective in the workspace, which is the
    // product's own rule. A Viewer may not.
    const wb = await workerDb();
    const { roles } = await callAction(await owner(), "roles.list", {});
    const outsider = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, OUTSIDER],
    );
    await callAction(await owner(), "roles.assign", {
      memberId: outsider.rows[0]?.id as string,
      roleId: roles.find((role) => role.builtinKey === "viewer")?.id as string,
    });
    const id = await goal("هدف لا يملكه الغريب", agencyId);
    await expect(
      callAction(
        { pool: wb.appPool, ...as(OUTSIDER) },
        "strategy.setGoalProfile",
        { goalId: id, ...PROFILE },
      ),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/not_found|forbidden/),
    });
  });
});

describe("strategy.listSectorPlan", () => {
  it("gathers the sector's own objectives and its agencies', and nothing from another sector", async () => {
    const other = (
      await callAction(await owner(), "spaces.create", {
        name: "قطاع الخدمات المساندة",
      })
    ).id;
    await callAction(await owner(), "strategy.setSector", { spaceId: other });
    const ofAgency = await goal("هدف الوكالة", agencyId);
    const ofSector = await goal("هدف القطاع نفسه", sectorId);
    await goal("هدف قطاع آخر", other);

    const plan = await callAction(await owner(), "strategy.listSectorPlan", {
      spaceId: sectorId,
    });
    expect(plan.objectives.map((one) => one.goalId).sort()).toEqual(
      [ofAgency, ofSector].sort(),
    );
    // An objective nobody has classified yet is listed, with no profile.
    expect(plan.objectives.every((one) => one.profile === null)).toBe(true);
  });

  it("lists the operational indicators its agencies own", async () => {
    const id = await indicator("متوسط زمن معالجة الشكاوى", agencyId);
    const plan = await callAction(await owner(), "strategy.listSectorPlan", {
      spaceId: sectorId,
    });
    expect(plan.indicators).toEqual([
      {
        kpiId: id,
        title: "متوسط زمن معالجة الشكاوى",
        spaceId: agencyId,
        spaceName: "وكالة التراخيص",
        frequency: "quarterly",
        direction: "lower_better",
      },
    ]);
  });

  it("answers not found to somebody who is not in the sector, and for a space that is not a sector", async () => {
    const wb = await workerDb();
    await expect(
      callAction(
        { pool: wb.appPool, ...as(OUTSIDER) },
        "strategy.listSectorPlan",
        { spaceId: sectorId },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      callAction(await owner(), "strategy.listSectorPlan", {
        spaceId: agencyId,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
