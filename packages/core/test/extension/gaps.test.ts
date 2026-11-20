import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../../src/workspaces/provisioning.ts";

/**
 * Strategic gaps, written by hand
 * (docs/extension/design/b0-vertical-slice.md §4, §5 and criterion 13).
 *
 * A gap is where the strategy asks for something the sector is not yet
 * doing. An agent drafts them from the source documents in a later change;
 * here a person writes one, edits it and sets it aside, which has to work
 * with no AI provider at all.
 */
const OWNER = "gap-owner";
const OUTSIDER = "gap-outsider";

let workspaceId: string;
let sectorId: string;
let domainId: string;

const as = (userId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});
const owner = async () => ({ pool: (await workerDb()).appPool, ...as(OWNER) });
const outsider = async () => ({
  pool: (await workerDb()).appPool,
  ...as(OUTSIDER),
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values
       ($1, 'Owner', 'gap-owner@example.com'),
       ($2, 'Outsider', 'gap-outsider@example.com')`,
    [OWNER, OUTSIDER],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Owner" })
  ).workspaceId;
  sectorId = (
    await callAction(await owner(), "spaces.create", {
      name: "قطاع الخدمات والتراخيص",
    })
  ).id;
  await callAction(await owner(), "strategy.setSector", { spaceId: sectorId });
  domainId = (
    await callAction(await owner(), "strategy.createDomain", {
      name: "التراخيص والامتثال",
    })
  ).id;
  // In the workspace, not in the sector, with the Member role.
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

const GAP = {
  title: "لا يوجد نظام موحد يربط الفروع بالمركز الرئيس",
  description: "تعتمد معالجة الطلبات على إجراءات ورقية في ثلاثة فروع.",
  rationale: "الاستراتيجية تستهدف إنجاز 90% من الطلبات خلال خمسة أيام عمل.",
};

describe("strategy.createGap and strategy.listGaps", () => {
  it("files a gap under its sector as a person's draft", async () => {
    const created = await callAction(await owner(), "strategy.createGap", {
      spaceId: sectorId,
      domainId,
      ...GAP,
    });
    const { gaps } = await callAction(await owner(), "strategy.listGaps", {
      spaceId: sectorId,
    });
    expect(gaps).toEqual([
      {
        id: created.id,
        ...GAP,
        domainId,
        confidence: null,
        // Written by a person, so never the status an agent's draft carries.
        status: "draft",
      },
    ]);
  });

  it("refuses a gap under a space that is not a sector", async () => {
    const agency = await callAction(await owner(), "spaces.create", {
      name: "وكالة التراخيص",
    });
    await callAction(await owner(), "strategy.setAgency", {
      spaceId: agency.id,
      sectorSpaceId: sectorId,
    });
    await expect(
      callAction(await owner(), "strategy.createGap", {
        spaceId: agency.id,
        title: GAP.title,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("answers not found for a domain that is not this workspace's", async () => {
    await expect(
      callAction(await owner(), "strategy.createGap", {
        spaceId: sectorId,
        title: GAP.title,
        domainId: "01a1f7dd-23c8-7689-869f-58dc858c27f4",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("answers not found to somebody who is not in the sector, for every action", async () => {
    const created = await callAction(await owner(), "strategy.createGap", {
      spaceId: sectorId,
      title: GAP.title,
    });
    const refused = { code: "not_found" };
    await expect(
      callAction(await outsider(), "strategy.listGaps", { spaceId: sectorId }),
    ).rejects.toMatchObject(refused);
    await expect(
      callAction(await outsider(), "strategy.createGap", {
        spaceId: sectorId,
        title: "فجوة من خارج القطاع",
      }),
    ).rejects.toMatchObject(refused);
    await expect(
      callAction(await outsider(), "strategy.updateGap", {
        id: created.id,
        title: "عنوان آخر",
      }),
    ).rejects.toMatchObject(refused);
    await expect(
      callAction(await outsider(), "strategy.dismissGap", { id: created.id }),
    ).rejects.toMatchObject(refused);
  });
});

describe("strategy.updateGap and strategy.dismissGap", () => {
  it("changes what was sent and leaves the rest", async () => {
    const created = await callAction(await owner(), "strategy.createGap", {
      spaceId: sectorId,
      domainId,
      ...GAP,
    });
    await callAction(await owner(), "strategy.updateGap", {
      id: created.id,
      title: "الفروع غير مربوطة بالمركز الرئيس",
      domainId: null,
    });
    const { gaps } = await callAction(await owner(), "strategy.listGaps", {
      spaceId: sectorId,
    });
    expect(gaps[0]).toMatchObject({
      title: "الفروع غير مربوطة بالمركز الرئيس",
      description: GAP.description,
      rationale: GAP.rationale,
      domainId: null,
      status: "draft",
    });
  });

  it("sets a gap aside, keeps it in the list, and refuses to edit it after", async () => {
    const created = await callAction(await owner(), "strategy.createGap", {
      spaceId: sectorId,
      title: GAP.title,
    });
    await callAction(await owner(), "strategy.dismissGap", { id: created.id });
    const { gaps } = await callAction(await owner(), "strategy.listGaps", {
      spaceId: sectorId,
    });
    expect(gaps[0]?.status).toBe("dismissed");
    await expect(
      callAction(await owner(), "strategy.updateGap", {
        id: created.id,
        title: "عنوان بعد الاستبعاد",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      callAction(await owner(), "strategy.dismissGap", { id: created.id }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses to edit a gap that is under review or approved", async () => {
    const wb = await workerDb();
    const created = await callAction(await owner(), "strategy.createGap", {
      spaceId: sectorId,
      title: GAP.title,
    });
    for (const status of ["in_review", "approved"]) {
      await wb.admin.query(
        "update strategic_gaps set status = $2 where id = $1",
        [created.id, status],
      );
      await expect(
        callAction(await owner(), "strategy.updateGap", {
          id: created.id,
          title: "تعديل بعد الرفع",
        }),
      ).rejects.toMatchObject({ code: "conflict" });
    }
  });

  it("records who did it, in the audit trail", async () => {
    const wb = await workerDb();
    const created = await callAction(await owner(), "strategy.createGap", {
      spaceId: sectorId,
      title: GAP.title,
    });
    await callAction(await owner(), "strategy.dismissGap", { id: created.id });
    const audit = await wb.admin.query<{ action: string }>(
      "select action from audit_events where target_id = $1 order by at, id",
      [created.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "strategy.createGap",
      "strategy.dismissGap",
    ]);
  });
});
