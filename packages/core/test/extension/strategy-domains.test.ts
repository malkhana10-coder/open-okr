import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../../src/workspaces/provisioning.ts";

/**
 * Strategic domains, the first entity of the planning extension
 * (docs/extension/design/b0-vertical-slice.md §4 and §5).
 *
 * A domain is a named area of the organisation's strategy, such as
 * "Licensing and compliance". Gaps and sector objectives are filed under one.
 * What is checked here is what only rows can settle: the tenant floor, the
 * name's uniqueness inside a workspace, and that the write is refused for a
 * role that may not configure the workspace.
 */

const OWNER = "domain-owner";
const OTHER = "domain-other";
const STRANGER = "domain-stranger";

let workspaceId: string;
let strangerWorkspaceId: string;
let otherMemberId: string;

const as = (userId: string, workspace = workspaceId) => ({
  workspaceId: workspace,
  actor: { kind: "human" as const, userId },
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values
       ($1, 'Owner', 'domain-owner@example.com'),
       ($2, 'Other', 'domain-other@example.com'),
       ($3, 'Stranger', 'domain-stranger@example.com')`,
    [OWNER, OTHER, STRANGER],
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
     values (gen_random_uuid(), $1, $2, 'Other', 'active', 'human') returning id`,
    [workspaceId, OTHER],
  );
  otherMemberId = second.rows[0]?.id as string;
  // The Member role, which reads the workspace's setup and does not change it.
  // A row written straight into the table has no role at all.
  const { roles } = await callAction(
    { pool: wb.appPool, ...as(OWNER) },
    "roles.list",
    {},
  );
  await callAction({ pool: wb.appPool, ...as(OWNER) }, "roles.assign", {
    memberId: otherMemberId,
    roleId: roles.find((role) => role.builtinKey === "member")?.id as string,
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("strategy.createDomain and strategy.listDomains", () => {
  it("creates a domain and lists it by name", async () => {
    const wb = await workerDb();
    const created = await callAction(
      { pool: wb.appPool, ...as(OWNER) },
      "strategy.createDomain",
      { name: "التراخيص والامتثال", description: "منح التراخيص ومتابعتها" },
    );
    await callAction(
      { pool: wb.appPool, ...as(OWNER) },
      "strategy.createDomain",
      { name: "تجربة المستفيد" },
    );

    const { domains } = await callAction(
      { pool: wb.appPool, ...as(OWNER) },
      "strategy.listDomains",
      {},
    );
    expect(domains.map((domain) => domain.name)).toEqual([
      "التراخيص والامتثال",
      "تجربة المستفيد",
    ]);
    expect(domains[0]).toMatchObject({
      id: created.id,
      description: "منح التراخيص ومتابعتها",
    });
    expect(domains[1]?.description).toBeNull();
  });

  it("refuses a second domain with the same name in the workspace", async () => {
    const wb = await workerDb();
    const call = (name: string) =>
      callAction({ pool: wb.appPool, ...as(OWNER) }, "strategy.createDomain", {
        name,
      });
    await call("Licensing");

    await expect(call("  licensing ")).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("keeps one workspace's domains out of another's list", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...as(OWNER) },
      "strategy.createDomain",
      { name: "التراخيص والامتثال" },
    );

    const { domains } = await callAction(
      { pool: wb.appPool, ...as(STRANGER, strangerWorkspaceId) },
      "strategy.listDomains",
      {},
    );
    expect(domains).toEqual([]);
    // The same name is free in the other workspace.
    await expect(
      callAction(
        { pool: wb.appPool, ...as(STRANGER, strangerWorkspaceId) },
        "strategy.createDomain",
        { name: "التراخيص والامتثال" },
      ),
    ).resolves.toMatchObject({ name: "التراخيص والامتثال" });
  });

  it("lets a member read the domains and refuses their write", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...as(OWNER) },
      "strategy.createDomain",
      { name: "التراخيص والامتثال" },
    );

    const { domains } = await callAction(
      { pool: wb.appPool, ...as(OTHER) },
      "strategy.listDomains",
      {},
    );
    expect(domains).toHaveLength(1);
    await expect(
      callAction({ pool: wb.appPool, ...as(OTHER) }, "strategy.createDomain", {
        name: "تجربة المستفيد",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("writes an audit row naming the domain", async () => {
    const wb = await workerDb();
    const created = await callAction(
      { pool: wb.appPool, ...as(OWNER) },
      "strategy.createDomain",
      { name: "التراخيص والامتثال" },
    );

    const audit = await wb.admin.query(
      `select action, target_type, target_id from audit_events
        where workspace_id = $1 and action = 'strategy.createDomain'`,
      [workspaceId],
    );
    expect(audit.rows).toEqual([
      {
        action: "strategy.createDomain",
        target_type: "strategy_domain",
        target_id: created.id,
      },
    ]);
  });
});
