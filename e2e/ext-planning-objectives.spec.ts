import { randomUUID } from "node:crypto";
import { makeSector, uploadLicensing } from "./ext-planning.ts";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

/**
 * The planning extension's proposed objectives screen (design
 * b0-vertical-slice.md, criteria 8 and 17): the agent drafts objectives that
 * answer the sector's gaps, none is live, and a person confirms each owner.
 */

test("objectives are drafted from the gaps, and a person confirms an owner", async ({
  page,
  playwright,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  const sectorId = await makeSector(
    page,
    playwright,
    baseURL,
    `Objectives sector ${randomUUID().slice(0, 8)}`,
  );
  await uploadLicensing(page, sectorId, "Licensing sub-strategy");

  // With no gap to answer, the agent is refused in words and drafts nothing.
  await page.getByRole("link", { name: "Objectives", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/planning/objectives\\?sector=${sectorId}`),
  );
  await expect(page.getByText("No proposed objectives yet.")).toBeVisible();
  await page.getByRole("button", { name: "Draft objectives" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /gap/i })).toBeVisible(
    { timeout: 30_000 },
  );
  await expect(page.getByText("No proposed objectives yet.")).toBeVisible();

  await page.getByRole("link", { name: "Gaps", exact: true }).click();
  await page.getByRole("button", { name: "Draft gaps" }).click();
  await expect(page.getByText("AI draft", { exact: true })).toHaveCount(6, {
    timeout: 30_000,
  });

  await page.getByRole("link", { name: "Objectives", exact: true }).click();
  // The cycle chosen is the one drafted into, and it stays chosen.
  const cycle = page.getByLabel("Plan cycle");
  const offered = await cycle.inputValue();
  expect(offered).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Draft objectives" }).click();
  // Five: the sixth gap rests on a quotation that is not on its page, and
  // the drafts hold no objective for it.
  await expect(page.getByText("AI draft", { exact: true })).toHaveCount(5, {
    timeout: 30_000,
  });
  await expect(page.getByText("Owner not confirmed")).toHaveCount(5);
  await expect(cycle).toHaveValue(offered);

  const objective = page
    .getByRole("listitem")
    .filter({ hasText: "نشر اشتراطات كل أنواع التراخيص في دليل واحد" });
  await expect(objective).toContainText("Operational objective");
  await expect(objective).toContainText(
    "دليل منشور يغطي كل أنواع التراخيص بنهاية عام 2027",
  );

  // What it answers and what it quotes are there to judge it by.
  await objective.getByText("Reasoning and sources").click();
  await expect(objective).toContainText(
    "لا دليل موحد منشور لاشتراطات التراخيص",
  );
  await expect(
    objective.getByRole("link", { name: "Licensing sub-strategy, page 9" }),
  ).toBeVisible();
  await expect(objective.getByText("Verified", { exact: true })).toBeVisible();

  // A person confirms the owner. The agent never does (criterion 17).
  await objective.getByRole("button", { name: "Confirm owner" }).click();
  await expect(
    objective.getByText("Owner confirmed", { exact: true }),
  ).toBeVisible();
  await expect(
    objective.getByRole("button", { name: "Confirm owner" }),
  ).toHaveCount(0);
  await expect(page.getByText("Owner not confirmed")).toHaveCount(4);

  // A second run drafts nothing more.
  await page.getByRole("button", { name: "Draft objectives" }).click();
  await expect(
    page.getByRole("region", { name: "Last run" }),
  ).toContainText("Runs so far: 2", { timeout: 30_000 });
  await expect(page.getByText("AI draft", { exact: true })).toHaveCount(5);
});

test("the objectives of a sector that does not exist are answered in words", async ({
  page,
}) => {
  await signIn(page);
  await goTo(page, `/planning/objectives?sector=${randomUUID()}`);
  await expect(
    page.getByText("You do not have access to this sector"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Draft objectives" }),
  ).toHaveCount(0);
});
