import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../../src/actions/registry.ts";
import { SETTINGS_REGISTRY } from "../../src/settings/registry.ts";
import { provisionWorkspaceForUser } from "../../src/workspaces/provisioning.ts";

/**
 * Arabic is a language a member may choose
 * (docs/extension/design/b0-vertical-slice.md §9 criterion 1).
 *
 * The member's language is a closed set, because a locale with no catalogue
 * makes `translate()` raise on the first key. The catalogue carries `ar` now,
 * so the set does too.
 */

const OWNER = "arabic-owner";

let workspaceId: string;
let ownerMemberId: string;

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Owner", "arabic-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a member's language", () => {
  it("may be Arabic, and is read back as chosen", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context() },
      "people.updateOwnProfile",
      { language: "ar" },
    );

    const me = await callAction(
      { pool: wb.appPool, ...context() },
      "people.readMember",
      { memberId: ownerMemberId },
    );
    expect(me.language).toBe("ar");
  });

  it("is still a closed set", async () => {
    const wb = await workerDb();
    await expect(
      callAction(
        { pool: wb.appPool, ...context() },
        "people.updateOwnProfile",
        // A language with no catalogue.
        { language: "fr" } as never,
      ),
    ).rejects.toThrow();
  });

  it("is Arabic in the settings registry too", () => {
    const language = SETTINGS_REGISTRY.find(
      (setting) => setting.key === "language" && setting.scope === "member",
    );
    expect(language?.schema.safeParse("ar").success).toBe(true);
    expect(language?.schema.safeParse("fr").success).toBe(false);
  });
});
