import { join } from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "./fixtures.ts";
import { goTo } from "./instance-account.ts";

/**
 * What the planning extension's specs share: a sector of their own, and a
 * trial document uploaded to it.
 *
 * A spec makes its own sector because a shard holds only the claimed
 * instance. No screen names a space as a sector yet, so that one step goes
 * through the REST surface with a token minted on the account screen.
 */

type Requests = {
  request: { newContext(options: object): Promise<APIRequestContext> };
};

const TRIAL_DOCUMENTS = join(
  import.meta.dirname,
  "../packages/core/src/extension/trial-entity/documents",
);
export const LICENSING_PDF = join(TRIAL_DOCUMENTS, "licensing-compliance.pdf");

/** A token for the signed-in account, and a client to call the API with. */
export async function apiFor(
  page: Page,
  playwright: Requests,
  baseURL: string | undefined,
  label: string,
): Promise<{ api: APIRequestContext; headers: { authorization: string } }> {
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill(label);
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  const token = ((await shown.textContent()) ?? "").trim();
  return {
    api: await playwright.request.newContext({ baseURL }),
    headers: { authorization: `Bearer ${token}` },
  };
}

/** A new space named as a sector. Returns the space's id. */
export async function makeSector(
  page: Page,
  playwright: Requests,
  baseURL: string | undefined,
  name: string,
): Promise<string> {
  const { api, headers } = await apiFor(page, playwright, baseURL, name);
  const space = await api.post("/api/v1/spaces/create", {
    headers,
    data: { name },
  });
  expect(space.status(), await space.text()).toBe(200);
  const spaceId = ((await space.json()).data as { id: string }).id;
  const sector = await api.post("/api/v1/strategy/setSector", {
    headers,
    data: { spaceId },
  });
  expect(sector.status(), await sector.text()).toBe(200);
  await api.dispose();
  return spaceId;
}

/** Uploads the licensing sub-strategy to a sector and waits until it is read. */
export async function uploadLicensing(
  page: Page,
  sectorId: string,
  title: string,
): Promise<void> {
  await goTo(page, `/planning/documents?sector=${sectorId}`);
  await page.getByLabel("PDF file").setInputFiles(LICENSING_PDF);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Year").fill("2027");
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: title }),
  ).toContainText("13 pages", { timeout: 60_000 });
}
