import { randomUUID } from "node:crypto";
import type { Locator } from "@playwright/test";
import { makeSector, uploadLicensing } from "./ext-planning.ts";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

/**
 * The planning extension's gaps screen (design b0-vertical-slice.md,
 * criteria 4, 5, 13 and 16): a gap is written by hand and quoted from a page,
 * a quotation that is not on its page is marked, and the agent's drafts
 * arrive as drafts with their quotations checked.
 */

const DOCUMENT = "Licensing sub-strategy";

/** Opens a gap's details when they are closed. They stay open across a write. */
async function openDetails(row: Locator): Promise<void> {
  const details = row.locator("details");
  if ((await details.getAttribute("open")) === null) {
    await row.getByText("Sources and details").click();
  }
  await expect(details).toHaveAttribute("open", "");
}
const ON_THE_PAGE = "لا يوجد دليل موحد منشور لاشتراطات التراخيص";

test("a gap is written by hand, quoted, and the agent drafts the rest", async ({
  page,
  playwright,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  const { sectorId } = await makeSector(
    page,
    playwright,
    baseURL,
    `Gaps sector ${randomUUID().slice(0, 8)}`,
  );
  await uploadLicensing(page, sectorId, DOCUMENT);

  // The tab keeps the sector.
  await page.getByRole("link", { name: "Gaps", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/planning/gaps\\?sector=${sectorId}`));
  await expect(page.getByText("No gaps yet.")).toBeVisible();

  // By hand, with no agent involved (criterion 13).
  await page.getByLabel("Gap", { exact: true }).fill("Requirements are scattered");
  await page
    .getByLabel("What is missing")
    .fill("Applicants cannot find what a licence asks of them in one place.");
  await page.getByRole("button", { name: "Add gap" }).click();
  const manual = page
    .getByRole("listitem")
    .filter({ hasText: "Requirements are scattered" });
  await expect(manual).toBeVisible();
  await expect(manual.getByText("Draft", { exact: true })).toBeVisible();
  await expect(manual).toContainText("No source yet");

  // A quotation that is on its page is verified (criterion 4).
  await openDetails(manual);
  await manual.getByLabel("Document").selectOption({ label: DOCUMENT });
  // A page that is not a number is refused in words, and nothing is lost.
  await manual.getByLabel("Page", { exact: true }).fill("three");
  await manual.getByLabel("Quotation").fill(ON_THE_PAGE);
  await manual.getByRole("button", { name: "Add source" }).click();
  await expect(
    manual.getByText("The page is a whole number, starting from 1."),
  ).toBeVisible();
  await expect(manual.getByLabel("Quotation")).toHaveValue(ON_THE_PAGE);
  // The digits an Arabic keyboard types are a page number too.
  await manual.getByLabel("Page", { exact: true }).fill("٣");
  await manual.getByRole("button", { name: "Add source" }).click();
  const quoted = manual.getByRole("listitem").filter({ hasText: ON_THE_PAGE });
  await expect(quoted).toContainText("Verified");
  await expect(
    quoted.getByRole("link", { name: `${DOCUMENT}, page 3` , exact: true }),
  ).toHaveAttribute("href", /\/planning\/documents\?.*page=3/);

  // The details stay open across the write.
  await expect(manual.locator("details")).toHaveAttribute("open", "");

  // One that is not on the page is kept and marked (criterion 5).
  await manual.getByLabel("Document").selectOption({ label: DOCUMENT });
  await manual.getByLabel("Page", { exact: true }).fill("3");
  await manual.getByLabel("Quotation").fill("دليل الاشتراطات غير متاح للمستفيدين اليوم");
  await manual.getByRole("button", { name: "Add source" }).click();
  const paraphrase = manual
    .getByRole("listitem")
    .filter({ hasText: "دليل الاشتراطات غير متاح" });
  await expect(paraphrase).toContainText("Unverified");
  await expect(paraphrase).toContainText("not on that page");
  await expect(manual).toContainText("Unverified: 1");
  await paraphrase.getByRole("button", { name: "Remove source" }).click();
  await expect(paraphrase).toHaveCount(0);
  // The verified one is still there, and is the only one.
  await expect(quoted).toContainText("Verified");
  await expect(manual).toContainText("1 source.");

  // Before any run, the screen already says the output is a sample.
  await expect(page.getByText("Sample output.")).toBeVisible();

  // The agent's drafts arrive as drafts, never as gaps (criterion 16).
  await page.getByRole("button", { name: "Draft gaps" }).click();
  const drafted = page
    .getByRole("listitem")
    .filter({ hasText: "لا سجل موحد للشكاوى يجمع القنوات" });
  await expect(drafted).toBeVisible({ timeout: 30_000 });
  await expect(drafted.getByText("AI draft", { exact: true })).toBeVisible();
  await expect(page.getByText("AI draft", { exact: true })).toHaveCount(6);

  // The run says what it read, and that it is a sample.
  const report = page.getByRole("region", { name: "Last run" });
  await expect(report).toContainText("Runs so far: 1");
  await expect(
    report.getByRole("listitem").filter({ hasText: DOCUMENT }),
  ).toBeVisible();

  // The paraphrase among the drafts is caught by the same check.
  const weak = page
    .getByRole("listitem")
    .filter({ hasText: "نقص المراقبين المؤهلين للمنشآت عالية الخطر" });
  await expect(weak).toContainText("Unverified: 1");

  // Running it again adds nothing.
  await page.getByRole("button", { name: "Draft gaps" }).click();
  await expect(report).toContainText("Runs so far: 2", { timeout: 30_000 });
  await expect(page.getByText("AI draft", { exact: true })).toHaveCount(6);

  // A gap that is not one is set aside, and stays on record.
  await openDetails(weak);
  await weak.getByRole("button", { name: "Set aside" }).click();
  await expect(weak.getByText("Set aside", { exact: true })).toBeVisible();
  await expect(page.getByText("AI draft", { exact: true })).toHaveCount(5);
});

test("the gaps of a sector that does not exist are answered in words", async ({
  page,
}) => {
  await signIn(page);
  await goTo(page, `/planning/gaps?sector=${randomUUID()}`);
  await expect(
    page.getByText("You do not have access to this sector"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Draft gaps" })).toHaveCount(0);
});
