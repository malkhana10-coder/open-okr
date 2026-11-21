import { workerDb } from "@openokr/test-support/db";
import { afterAll, describe, expect, it } from "vitest";

/**
 * A member's language may be Arabic at the database, not only in the action
 * (docs/extension/UPSTREAM-DIFF.md §4).
 *
 * The shipped migration 0078 holds `workspace_members.language` to a closed
 * set, and the extension stream widens that set to carry `ar`. This reads the
 * constraint as it stands after every migration of both streams has run.
 *
 * **It is a guard as much as a test.** If the upstream project ever rewrites
 * the same constraint, to add a language of its own, its migration drops
 * `ar` again, and fails outright on an instance where a member already chose
 * Arabic. This fails first, on the merge that brings that migration in, where
 * the answer is one more extension migration rather than a broken upgrade.
 */

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const definition = async (): Promise<string> => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ definition: string }>(
    `select pg_get_constraintdef(oid) as definition
       from pg_constraint
      where conname = 'workspace_members_language_known'`,
  );
  expect(rows).toHaveLength(1);
  return rows[0]?.definition as string;
};

describe("workspace_members_language_known", () => {
  it("allows exactly the shipped languages and Arabic", async () => {
    const languages = [...(await definition()).matchAll(/'([a-z]{2})'/g)]
      .map((match) => match[1])
      .sort();
    // Exactly, not at least: a language with no catalogue makes `translate`
    // raise on the first key, so the set stays closed.
    expect(languages).toEqual(["ar", "en", "ms"]);
  });
});
