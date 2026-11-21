import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../../src/workspaces/provisioning.ts";

/**
 * Sectors and the agencies under them
 * (docs/extension/design/b0-vertical-slice.md §12.1).
 *
 * A sector is a space and an agency is a space. What makes one a sector and
 * the other its agency is kept beside the spaces, in the extension's own
 * tables, so objectives, indicators and initiatives are still owned by a
 * space the way the product already does it.
 */
const OWNER = "org-owner";
const MEMBER = "org-member";
const STRANGER = "org-stranger";

let workspaceId: string;
let strangerWorkspaceId: string;
let memberId: string;

const as = (userId: string, workspace = workspaceId) => ({
  workspaceId: workspace,
  actor: { kind: "human" as const, userId },
});

async function space(name: string, userId = OWNER, workspace = workspaceId) {
  const wb = await workerDb();
  return (
    await callAction(
      { pool: wb.appPool, ...as(userId, workspace) },
      "spaces.create",
      { name },
    )
  ).id;
}

const owner = async () => ({ pool: (await workerDb()).appPool, ...as(OWNER) });

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values
       ($1, 'Owner', 'org-owner@example.com'),
       ($2, 'Member', 'org-member@example.com'),
       ($3, 'Stranger', 'org-stranger@example.com')`,
    [OWNER, MEMBER, STRANGER],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Owner" })
  ).workspaceId;
  strangerWorkspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: STRANGER,
      name: "Stranger",
    })
  ).workspaceId;
  const second = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status, kind)
     values (gen_random_uuid(), $1, $2, 'Member', 'active', 'human') returning id`,
    [workspaceId, MEMBER],
  );
  memberId = second.rows[0]?.id as string;
  const { roles } = await callAction(await owner(), "roles.list", {});
  await callAction(await owner(), "roles.assign", {
    memberId,
    roleId: roles.find((role) => role.builtinKey === "member")?.id as string,
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("strategy.setSector, strategy.setAgency and strategy.listOrgUnits", () => {
  it("lists each sector with its agencies, by name", async () => {
    const services = await space("قطاع الخدمات والتراخيص");
    const support = await space("قطاع الخدمات المساندة");
    const licensing = await space("وكالة التراخيص");
    const compliance = await space("وكالة الرقابة والامتثال");
    const finance = await space("وكالة الشؤون المالية");

    await callAction(await owner(), "strategy.setSector", {
      spaceId: services,
      leadMemberId: memberId,
    });
    await callAction(await owner(), "strategy.setSector", { spaceId: support });
    for (const [agency, sector] of [
      [licensing, services],
      [compliance, services],
      [finance, support],
    ] as const) {
      await callAction(await owner(), "strategy.setAgency", {
        spaceId: agency,
        sectorSpaceId: sector,
      });
    }

    const { sectors } = await callAction(
      await owner(),
      "strategy.listOrgUnits",
      {},
    );
    expect(sectors).toEqual([
      {
        spaceId: support,
        name: "قطاع الخدمات المساندة",
        leadMemberId: null,
        agencies: [{ spaceId: finance, name: "وكالة الشؤون المالية" }],
      },
      {
        spaceId: services,
        name: "قطاع الخدمات والتراخيص",
        leadMemberId: memberId,
        agencies: [
          { spaceId: licensing, name: "وكالة التراخيص" },
          { spaceId: compliance, name: "وكالة الرقابة والامتثال" },
        ],
      },
    ]);
  });

  it("lets any member read the structure, and only an Owner or Admin change it", async () => {
    const wb = await workerDb();
    const sector = await space("قطاع التخطيط والتطوير");
    await callAction(await owner(), "strategy.setSector", { spaceId: sector });

    await expect(
      callAction(
        { pool: wb.appPool, ...as(MEMBER) },
        "strategy.listOrgUnits",
        {},
      ),
    ).resolves.toMatchObject({ sectors: [{ spaceId: sector }] });

    const other = await space("وكالة التحول الرقمي");
    await expect(
      callAction({ pool: wb.appPool, ...as(MEMBER) }, "strategy.setAgency", {
        spaceId: other,
        sectorSpaceId: sector,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("changes a sector's lead when it is set again, and keeps one row", async () => {
    const wb = await workerDb();
    const sector = await space("قطاع الخدمات المساندة");
    await callAction(await owner(), "strategy.setSector", { spaceId: sector });
    await callAction(await owner(), "strategy.setSector", {
      spaceId: sector,
      leadMemberId: memberId,
    });
    const rows = await wb.admin.query(
      "select lead_member_id from org_sectors where space_id = $1",
      [sector],
    );
    expect(rows.rows).toEqual([{ lead_member_id: memberId }]);
  });

  it("moves an agency to another sector when it is set again", async () => {
    const first = await space("قطاع الخدمات والتراخيص");
    const second = await space("قطاع التخطيط والتطوير");
    const agency = await space("وكالة تجربة المستفيد");
    await callAction(await owner(), "strategy.setSector", { spaceId: first });
    await callAction(await owner(), "strategy.setSector", { spaceId: second });
    await callAction(await owner(), "strategy.setAgency", {
      spaceId: agency,
      sectorSpaceId: first,
    });
    await callAction(await owner(), "strategy.setAgency", {
      spaceId: agency,
      sectorSpaceId: second,
    });
    const { sectors } = await callAction(
      await owner(),
      "strategy.listOrgUnits",
      {},
    );
    expect(
      sectors.map((sector) => [sector.spaceId, sector.agencies.length]),
    ).toEqual([
      [second, 1],
      [first, 0],
    ]);
  });
});

describe("two levels and no more", () => {
  it("refuses an agency under a space that is not a sector", async () => {
    const plain = await space("مساحة عادية");
    const agency = await space("وكالة التراخيص");
    await expect(
      callAction(await owner(), "strategy.setAgency", {
        spaceId: agency,
        sectorSpaceId: plain,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses an agency under an agency", async () => {
    const sector = await space("قطاع الخدمات والتراخيص");
    const agency = await space("وكالة التراخيص");
    const under = await space("إدارة تحت الوكالة");
    await callAction(await owner(), "strategy.setSector", { spaceId: sector });
    await callAction(await owner(), "strategy.setAgency", {
      spaceId: agency,
      sectorSpaceId: sector,
    });
    await expect(
      callAction(await owner(), "strategy.setAgency", {
        spaceId: under,
        sectorSpaceId: agency,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses to make a sector of an agency, or an agency of a sector", async () => {
    const sector = await space("قطاع الخدمات والتراخيص");
    const other = await space("قطاع الخدمات المساندة");
    const agency = await space("وكالة التراخيص");
    await callAction(await owner(), "strategy.setSector", { spaceId: sector });
    await callAction(await owner(), "strategy.setSector", { spaceId: other });
    await callAction(await owner(), "strategy.setAgency", {
      spaceId: agency,
      sectorSpaceId: sector,
    });
    await expect(
      callAction(await owner(), "strategy.setSector", { spaceId: agency }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      callAction(await owner(), "strategy.setAgency", {
        spaceId: other,
        sectorSpaceId: sector,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("is held by the database too, whatever writes the rows", async () => {
    // An import or a data change never passes through the action.
    const wb = await workerDb();
    const sector = await space("قطاع الخدمات والتراخيص");
    const agency = await space("وكالة التراخيص");
    await callAction(await owner(), "strategy.setSector", { spaceId: sector });
    await callAction(await owner(), "strategy.setAgency", {
      spaceId: agency,
      sectorSpaceId: sector,
    });
    await expect(
      wb.admin.query(
        `insert into org_sectors (id, workspace_id, space_id)
         values (gen_random_uuid(), $1, $2)`,
        [workspaceId, agency],
      ),
    ).rejects.toThrow(/agency/);
    await expect(
      wb.admin.query(
        `insert into org_agencies (id, workspace_id, space_id, sector_id)
         select gen_random_uuid(), $1, $2, id from org_sectors where space_id = $2`,
        [workspaceId, sector],
      ),
    ).rejects.toThrow(/sector/);
  });
});

describe("the tenant floor", () => {
  it("answers not found for a space, a sector or a lead from another workspace", async () => {
    const foreign = await space("قطاع غريب", STRANGER, strangerWorkspaceId);
    await expect(
      callAction(await owner(), "strategy.setSector", { spaceId: foreign }),
    ).rejects.toMatchObject({ code: "not_found" });

    const mine = await space("وكالة التراخيص");
    await expect(
      callAction(await owner(), "strategy.setAgency", {
        spaceId: mine,
        sectorSpaceId: foreign,
      }),
    ).rejects.toMatchObject({ code: "not_found" });

    const sector = await space("قطاع الخدمات والتراخيص");
    const wb = await workerDb();
    const outsider = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where workspace_id = $1 limit 1",
      [strangerWorkspaceId],
    );
    await expect(
      callAction(await owner(), "strategy.setSector", {
        spaceId: sector,
        leadMemberId: outsider.rows[0]?.id as string,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("shows another workspace none of this one's structure", async () => {
    const wb = await workerDb();
    const sector = await space("قطاع الخدمات والتراخيص");
    await callAction(await owner(), "strategy.setSector", { spaceId: sector });
    await expect(
      callAction(
        { pool: wb.appPool, ...as(STRANGER, strangerWorkspaceId) },
        "strategy.listOrgUnits",
        {},
      ),
    ).resolves.toEqual({ sectors: [] });
  });
});
