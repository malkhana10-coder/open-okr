import { randomUUID } from "node:crypto";
import {
  draftObjectivesInto,
  makeSector,
  uploadLicensing,
} from "./ext-planning.ts";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

/**
 * The planning extension's approvals and alignment screens (design
 * b0-vertical-slice.md, criteria 5, 11, 15 and 17).
 *
 * One person here, the instance's owner, which is enough for everything but
 * the decision: whoever sends a request cannot decide it. The decision by a
 * second person is `ext-planning-path.spec.ts`.
 */

test("a sector's drafts are linked, held back while unfit, then sent", async ({
  page,
  playwright,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await signIn(page);
  const { sectorId, cycleId } = await makeSector(
    page,
    playwright,
    baseURL,
    `Approvals sector ${randomUUID().slice(0, 8)}`,
  );
  await uploadLicensing(page, sectorId, "Licensing sub-strategy");
  await page.getByRole("link", { name: "Gaps", exact: true }).click();
  await page.getByRole("button", { name: "Draft gaps" }).click();
  await expect(page.getByText("AI draft", { exact: true })).toHaveCount(6, {
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "Objectives", exact: true }).click();
  await draftObjectivesInto(page, cycleId);
  await expect(page.getByText("AI draft", { exact: true })).toHaveCount(5, {
    timeout: 30_000,
  });

  // Alignment: every gap beside the objectives that answer it (criterion 15).
  await page.getByRole("link", { name: "Alignment", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/planning/alignment\\?sector=${sectorId}`),
  );
  const gaps = page.getByRole("region", { name: "Gaps" });
  const objectives = page.getByRole("region", { name: "Objectives" });
  await expect(gaps.getByRole("button")).toHaveCount(6);
  await expect(objectives.getByRole("button")).toHaveCount(5);
  // The gap nothing answers is marked.
  const bare = gaps.getByRole("listitem").filter({
    hasText: "نقص المراقبين المؤهلين للمنشآت عالية الخطر",
  });
  await expect(bare).toContainText("No objective answers this gap");
  await expect(gaps.getByText("No objective answers this gap")).toHaveCount(1);
  // Choosing a gap brings out its objective, and only that one.
  await gaps
    .getByRole("button", { name: "لا سجل موحد للشكاوى يجمع القنوات" })
    .click();
  await expect(objectives.locator('[data-linked="true"]')).toHaveCount(1);
  await expect(objectives.locator('[data-linked="true"]')).toContainText(
    "نقل القنوات الخمس إلى سجل شكاوى واحد",
  );
  // Said in words too, for whoever cannot see the highlight.
  await expect(objectives.locator('[data-linked="true"]')).toContainText(
    "Answers the chosen gap",
  );
  await expect(
    page.getByText("Objectives that answer the chosen gap: 1"),
  ).toBeVisible();
  // And the other way round.
  await objectives
    .getByRole("button", { name: "قياس زمن كل خطوة في دراسة طلب الترخيص" })
    .click();
  await expect(gaps.locator('[data-linked="true"]')).toHaveCount(1);
  await expect(gaps.locator('[data-linked="true"]')).toContainText(
    "خطوات يدوية في دراسة الطلب لا يُعرف زمنها",
  );

  // Approvals: what would be sent, and what holds it back.
  await page.getByRole("link", { name: "Approvals", exact: true }).click();
  const send = page.getByRole("region", { name: "Send for approval" });
  await expect(send).toContainText("Gaps to send: 6");
  await expect(send).toContainText("Objectives to send: 5");
  await expect(send).toContainText("Unverified sources: 1");
  await expect(send).toContainText("Owners not confirmed: 5");
  // Sending anyway is refused, in words (criteria 5 and 17).
  await send.getByRole("button", { name: "Send for approval" }).click();
  await expect(send.getByRole("alert")).toContainText(/has not been confirmed/, {
    timeout: 30_000,
  });
  await expect(send).toContainText("Gaps to send: 6");

  // The unverified quotation goes with its gap, and each owner is confirmed.
  await page.getByRole("link", { name: "Gaps", exact: true }).click();
  const weak = page.getByRole("listitem").filter({
    hasText: "نقص المراقبين المؤهلين للمنشآت عالية الخطر",
  });
  await weak.getByText("Sources and details").click();
  await weak.getByRole("button", { name: "Set aside" }).click();
  await expect(weak.getByText("Set aside", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Objectives", exact: true }).click();
  for (let left = 5; left > 0; left -= 1) {
    await page.getByRole("button", { name: "Confirm owner" }).first().click();
    await expect(page.getByText("Owner not confirmed")).toHaveCount(left - 1);
  }

  await page.getByRole("link", { name: "Approvals", exact: true }).click();
  await expect(send).toContainText("Gaps to send: 5");
  await expect(send).toContainText("Nothing holds this back.");
  await send.getByRole("button", { name: "Send for approval" }).click();
  await expect(send).toContainText("Waiting for a decision", {
    timeout: 30_000,
  });
  await expect(send).toContainText("Gaps: 5");
  await expect(send).toContainText("Objectives: 5");
  await expect(
    send.getByRole("button", { name: "Send for approval" }),
  ).toHaveCount(0);

  // Whoever sent it does not decide it (criterion 11).
  const mine = page.getByRole("region", { name: "Your next action" });
  await expect(mine).toContainText("Nothing is waiting for you");
  await expect(mine.getByRole("button")).toHaveCount(0);

  // The gap that was set aside is no longer asked about.
  await page.getByRole("link", { name: "Alignment", exact: true }).click();
  await expect(gaps.getByRole("button")).toHaveCount(5);
  await expect(gaps.getByText("No objective answers this gap")).toHaveCount(0);

  // What was sent can no longer be changed.
  await page.getByRole("link", { name: "Gaps", exact: true }).click();
  await expect(page.getByText("Sent for approval", { exact: true })).toHaveCount(
    5,
  );
  await page.getByRole("link", { name: "Objectives", exact: true }).click();
  await expect(page.getByText("Sent for approval", { exact: true })).toHaveCount(
    5,
  );
  await expect(page.getByRole("button", { name: "Confirm owner" })).toHaveCount(
    0,
  );
});

test("approvals and alignment answer a sector that does not exist in words", async ({
  page,
}) => {
  await signIn(page);
  await goTo(page, `/planning/alignment?sector=${randomUUID()}`);
  await expect(
    page.getByText("You do not have access to this sector"),
  ).toBeVisible();
  await goTo(page, `/planning/approvals?sector=${randomUUID()}`);
  await expect(
    page.getByText("You do not have access to this sector"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send for approval" }),
  ).toHaveCount(0);
});
