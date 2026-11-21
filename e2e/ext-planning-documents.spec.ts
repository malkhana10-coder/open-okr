import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { apiFor, LICENSING_PDF, makeSector } from "./ext-planning.ts";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

/**
 * The planning extension's documents screen (design b0-vertical-slice.md,
 * criteria 3 and 19): a sector's strategy is uploaded, read in the
 * background by the built server's own PDF reader, and opened page by page.
 *
 * The spec makes its own sector, because a shard holds only the claimed
 * instance. No screen names a space as a sector yet, so that one step goes
 * through the REST surface with a token minted on the account screen.
 */

test("a sector's strategy is uploaded, read and opened page by page", async ({
  page,
  playwright,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  const name = `Licensing sector ${randomUUID().slice(0, 8)}`;
  const { sectorId } = await makeSector(page, playwright, baseURL, name);

  // The sidebar leads to it, and it opens on the documents.
  await goTo(page, "/spaces");
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "Planning" }).first(),
  ).toHaveAttribute("href", "/planning");
  await goTo(page, "/planning");
  await expect(page).toHaveURL(/\/planning\/documents/);
  await expect(
    page.getByRole("heading", { name: "Source documents" }),
  ).toBeVisible();

  await goTo(page, `/planning/documents?sector=${sectorId}`);
  await expect(page.getByLabel("Sector")).toHaveValue(sectorId);
  await expect(page.getByText("No documents yet.")).toBeVisible();

  // Nothing chosen is refused in words, not by a crash.
  await page.getByLabel("Title").fill("Licensing sub-strategy");
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Choose a PDF first.")).toBeVisible();
  // What was typed is still there after the refusal.
  await expect(page.getByLabel("Title")).toHaveValue("Licensing sub-strategy");

  // A file that only claims to be a PDF is refused by what it holds.
  await page.getByLabel("PDF file").setInputFiles({
    name: "notes.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("plain text under a PDF's name"),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("This file is not a PDF.")).toBeVisible();

  // A year that is not one is refused before anything is stored.
  await page.getByLabel("PDF file").setInputFiles(LICENSING_PDF);
  await page.getByLabel("Year").fill("0027");
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByText("The year is four digits, between 1900 and 2200."),
  ).toBeVisible();
  await expect(page.getByText("No documents yet.")).toBeVisible();

  await page.getByLabel("PDF file").setInputFiles(LICENSING_PDF);
  await page.getByLabel("Kind").selectOption("strategy");
  await page.getByLabel("Year").fill("2027");
  await page.getByRole("button", { name: "Upload" }).click();

  const row = page.getByRole("listitem").filter({
    hasText: "Licensing sub-strategy",
  });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await expect(row).toContainText("Strategy");
  // Read in the background by the relay. Nobody reloads: the screen asks
  // again by itself while a document is still being read.
  await expect(row).toContainText("13 pages", { timeout: 60_000 });
  // A clean document carries no warning.
  await expect(row).not.toContainText("Weak extraction");

  await row.getByRole("link", { name: "Read" }).click();
  const reader = page.getByRole("region", {
    name: "Licensing sub-strategy page 1 of 13",
  });
  await expect(reader).toContainText("الاستراتيجية الفرعية للتراخيص والامتثال");
  await reader.getByRole("link", { name: "Next page" }).click();
  const second = page.getByRole("region", {
    name: "Licensing sub-strategy page 2 of 13",
  });
  await expect(second).toContainText("المقدمة والنطاق");
  // The file itself opens on the page read (criterion 7).
  const original = second.getByRole("link", {
    name: "Open the original file at this page",
  });
  const href = (await original.getAttribute("href")) ?? "";
  expect(href).toMatch(/\/file#page=2$/);
  const file = await page.request.get(href.replace(/#.*$/, ""));
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toBe("application/pdf");
  expect(file.headers()["content-disposition"]).toMatch(/^inline;/);
  expect((await file.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  // Nothing on it may run where it opens: the app's own policy covers it.
  const policy = file.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("object-src 'none'");
  expect(policy).toMatch(/script-src 'self' 'nonce-/);
  expect(file.headers()["x-content-type-options"]).toBe("nosniff");
  // A document that is not there is answered as one nobody may see.
  const missing = await page.request.get(
    href.replace(/documents\/[^/]+\/file.*$/, `documents/${randomUUID()}/file`),
  );
  expect(missing.status()).toBe(404);

  await second.getByRole("link", { name: "Previous page" }).click();
  await expect(reader).toBeVisible();

  // A page past the end is the last page, not a fault.
  await goTo(
    page,
    `${page.url().replace(/page=\d+/, "page=99")}`,
  );
  await expect(
    page.getByRole("region", { name: "Licensing sub-strategy page 13 of 13" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Close" }).click();
  await expect(page.getByRole("region")).toHaveCount(0);

  // A file named in Arabic opens too. A header carries bytes, not letters,
  // so the name goes in its encoded form beside a plain fallback.
  await goTo(page, `/planning/documents?sector=${sectorId}`);
  await page.getByLabel("PDF file").setInputFiles({
    name: "الاستراتيجية-الفرعية.pdf",
    mimeType: "application/pdf",
    buffer: readFileSync(LICENSING_PDF),
  });
  await page.getByLabel("Title").fill("Arabic file name");
  await page.getByRole("button", { name: "Upload" }).click();
  const arabicRow = page.getByRole("listitem").filter({
    hasText: "Arabic file name",
  });
  await expect(arabicRow).toContainText("13 pages", { timeout: 60_000 });
  await arabicRow.getByRole("link", { name: "Read" }).click();
  const arabicHref =
    (await page
      .getByRole("link", { name: "Open the original file at this page" })
      .getAttribute("href")) ?? "";
  const arabicFile = await page.request.get(arabicHref.replace(/#.*$/, ""));
  expect(arabicFile.status()).toBe(200);
  expect(arabicFile.headers()["content-disposition"]).toContain(
    `filename*=UTF-8''${encodeURIComponent("الاستراتيجية-الفرعية.pdf")}`,
  );
});

test("a space that is not a sector is not opened as one", async ({
  page,
  playwright,
  baseURL,
}) => {
  await signIn(page);
  // The owner may edit this space, and that does not make it a sector.
  const { api, headers } = await apiFor(
    page,
    playwright,
    baseURL,
    `Plain space ${randomUUID().slice(0, 8)}`,
  );
  const space = await api.post("/api/v1/spaces/create", {
    headers,
    data: { name: `Plain space ${randomUUID().slice(0, 8)}` },
  });
  expect(space.status(), await space.text()).toBe(200);
  const spaceId = ((await space.json()).data as { id: string }).id;
  await api.dispose();

  await goTo(page, `/planning/documents?sector=${spaceId}`);
  await expect(
    page.getByText("You do not have access to this sector"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload" })).toHaveCount(0);
});

test("a sector that does not exist is answered in words", async ({ page }) => {
  await signIn(page);
  await goTo(page, `/planning/documents?sector=${randomUUID()}`);
  await expect(
    page.getByText("You do not have access to this sector"),
  ).toBeVisible();
});
