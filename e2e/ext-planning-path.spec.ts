import { randomUUID } from "node:crypto";
import { makeSector, uploadLicensing } from "./ext-planning.ts";
import { expect, test } from "./fixtures.ts";
import {
  inviteByEmail,
  instancePool,
  joinAsNewcomer,
  makeAdministrator,
  personContext,
} from "./hosting.ts";
import { goTo, signIn } from "./instance-account.ts";

/**
 * The whole path with two people (design b0-vertical-slice.md, criteria 9,
 * 10 and 11): one drafts and sends a sector's request, the other returns it
 * with what has to change, then approves it once it comes back.
 *
 * The sender is an administrator, whose role sends and does not decide. The
 * decider is the instance's owner. Neither can do the other's part: the
 * sender is never offered the decision, and the request an owner sent would
 * need somebody else.
 */

const COMMENT = "The complaints objective needs a date the centre opens.";

test("one person sends a sector's request, another returns it, then approves it", async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  test.setTimeout(360_000);
  const tag = randomUUID().slice(0, 8);
  const sector = `Path sector ${tag}`;
  const drafter = {
    name: `Drafter ${tag}`,
    email: `drafter-${tag}@example.com`,
  };

  // The owner makes the sector and brings the drafter in as an administrator.
  await signIn(page);
  const sectorId = await makeSector(page, playwright, baseURL, sector);
  const joinPath = await inviteByEmail(page, drafter.email);
  const theirs = await personContext(browser);
  const drafting = await theirs.newPage();
  await joinAsNewcomer(drafting, joinPath, drafter);
  const pool = instancePool();
  const { rows } = await pool.query<{ id: string }>(
    `select m.id from workspace_members m join users u on u.id = m.user_id
      where u.email = $1 and m.deleted_at is null`,
    [drafter.email],
  );
  await pool.end();
  await makeAdministrator(page, rows[0]?.id as string);

  // The drafter: document, gaps, objectives, owners, send.
  await uploadLicensing(drafting, sectorId, "Licensing sub-strategy");
  await drafting.getByRole("link", { name: "Gaps", exact: true }).click();
  await drafting.getByRole("button", { name: "Draft gaps" }).click();
  await expect(drafting.getByText("AI draft", { exact: true })).toHaveCount(6, {
    timeout: 30_000,
  });
  const weak = drafting.getByRole("listitem").filter({
    hasText: "نقص المراقبين المؤهلين للمنشآت عالية الخطر",
  });
  await weak.getByText("Sources and details").click();
  await weak.getByRole("button", { name: "Set aside" }).click();
  await expect(weak.getByText("Set aside", { exact: true })).toBeVisible();
  await drafting.getByRole("link", { name: "Objectives", exact: true }).click();
  await drafting.getByRole("button", { name: "Draft objectives" }).click();
  await expect(drafting.getByText("AI draft", { exact: true })).toHaveCount(5, {
    timeout: 30_000,
  });
  for (let left = 5; left > 0; left -= 1) {
    await drafting
      .getByRole("button", { name: "Confirm owner" })
      .first()
      .click();
    await expect(drafting.getByText("Owner not confirmed")).toHaveCount(
      left - 1,
    );
  }
  await drafting.getByRole("link", { name: "Approvals", exact: true }).click();
  const send = drafting.getByRole("region", { name: "Send for approval" });
  await send.getByRole("button", { name: "Send for approval" }).click();
  await expect(send).toContainText("Waiting for a decision", {
    timeout: 30_000,
  });
  // The sender is not offered the decision (criterion 11).
  await expect(
    drafting
      .getByRole("region", { name: "Your next action" })
      .getByRole("button"),
  ).toHaveCount(0);

  // The owner: the request is waiting, by sector and by count.
  await goTo(page, "/planning/approvals");
  const mine = page.getByRole("region", { name: "Your next action" });
  await expect(mine).toContainText(sector);
  await expect(mine).toContainText("Gaps: 5. Objectives: 5.");

  // Returned, with what has to change (criterion 10).
  await mine
    .getByLabel(`What has to change in the request of ${sector}`)
    .fill(COMMENT);
  await mine
    .getByRole("button", { name: `Return the request of ${sector}` })
    .click();
  await expect(mine).not.toContainText(sector, { timeout: 30_000 });

  // It comes back to the drafter with the comment, and nothing went live.
  await goTo(drafting, `/planning/approvals?sector=${sectorId}`);
  const back = drafting.getByRole("region", { name: "Your next action" });
  await expect(back).toContainText("Returned to you");
  await expect(back).toContainText(COMMENT);
  await back.getByRole("link", { name: "Open the sector's gaps" }).click();
  await expect(drafting.getByText("Returned", { exact: true })).toHaveCount(5);
  await drafting.getByRole("link", { name: "Objectives", exact: true }).click();
  await expect(drafting.getByText("AI draft", { exact: true })).toHaveCount(5);
  await expect(drafting.getByText("Approved", { exact: true })).toHaveCount(0);

  // Sent again.
  await drafting.getByRole("link", { name: "Approvals", exact: true }).click();
  await expect(send).toContainText("Returned and back in this batch: 5");
  await send.getByRole("button", { name: "Send for approval" }).click();
  await expect(send).toContainText("Waiting for a decision", {
    timeout: 30_000,
  });

  // The owner approves. The tick comes first: the button alone does nothing.
  await goTo(page, "/planning/approvals");
  await expect(mine).toContainText(sector);
  const approve = mine.getByRole("button", {
    name: `Approve the request of ${sector}`,
  });
  await approve.click();
  await expect(mine).toContainText(sector);
  await mine.getByRole("checkbox").check();
  await approve.click();
  await expect(mine).not.toContainText(sector, { timeout: 30_000 });

  // Approved: the gaps say so, and the objectives are live (criterion 9).
  await goTo(drafting, `/planning/gaps?sector=${sectorId}`);
  await expect(drafting.getByText("Approved", { exact: true })).toHaveCount(5);
  await drafting.getByRole("link", { name: "Objectives", exact: true }).click();
  await expect(drafting.getByText("Approved", { exact: true })).toHaveCount(5);
  await expect(drafting.getByText("AI draft", { exact: true })).toHaveCount(0);
  await drafting.getByRole("link", { name: "Approvals", exact: true }).click();
  await expect(send).toContainText("Nothing to send");

  await theirs.close();
});
