import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../../src/actions/registry.ts";
import { readArchive } from "../../src/portability/archive.ts";
import { exportWorkspace } from "../../src/portability/export.ts";
import { importWorkspace } from "../../src/portability/import.ts";
import { provisionWorkspaceForUser } from "../../src/workspaces/provisioning.ts";

/**
 * A workspace's strategic domains travel with it
 * (TECHNICAL-PLAN §7.3, docs/extension/UPSTREAM-DIFF.md §2).
 *
 * The policy list says the table is exported. This proves the rows arrive:
 * a domain made in one workspace is read in another after an export and an
 * import, with its name and description.
 */

const SOURCE_OWNER = "66666666-6666-4666-8666-666666666666";
const TARGET_OWNER = "77777777-7777-4777-8777-777777777777";
const PASSPHRASE = "correct horse battery staple";

let sourceWorkspaceId: string;
let targetWorkspaceId: string;
let targetMemberId: string;

const as = (userId: string, workspaceId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values
       ($1, 'Source Owner', 'domains-source@example.com'),
       ($2, 'Target Owner', 'domains-target@example.com')`,
    [SOURCE_OWNER, TARGET_OWNER],
  );
  sourceWorkspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: SOURCE_OWNER,
      name: "Source Owner",
    })
  ).workspaceId;
  const target = await provisionWorkspaceForUser(wb.appPool, {
    id: TARGET_OWNER,
    name: "Target Owner",
  });
  targetWorkspaceId = target.workspaceId;
  targetMemberId = target.memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a workspace archive", () => {
  it("carries the strategic domains to the workspace it is imported into", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...as(SOURCE_OWNER, sourceWorkspaceId) },
      "strategy.createDomain",
      { name: "التراخيص والامتثال", description: "منح التراخيص ومتابعتها" },
    );

    const db = drizzle(wb.appPool);
    const exported = await withWorkspace(db, sourceWorkspaceId, (tx) =>
      exportWorkspace({
        tx,
        workspaceId: sourceWorkspaceId,
        passphrase: PASSPHRASE,
        instance: "test-source",
      }),
    );
    const archive = readArchive(exported.bytes, { passphrase: PASSPHRASE });
    await withWorkspace(db, targetWorkspaceId, (tx) =>
      importWorkspace({
        tx,
        workspaceId: targetWorkspaceId,
        archive,
        dryRun: false,
        actorMemberId: targetMemberId,
      }),
    );

    const { domains } = await callAction(
      { pool: wb.appPool, ...as(TARGET_OWNER, targetWorkspaceId) },
      "strategy.listDomains",
      {},
    );
    expect(
      domains.map(({ name, description }) => ({ name, description })),
    ).toEqual([
      { name: "التراخيص والامتثال", description: "منح التراخيص ومتابعتها" },
    ]);
  });
});
