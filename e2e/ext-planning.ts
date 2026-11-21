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

/**
 * A new space named as a sector, and an annual cycle of its own to draft a
 * plan into.
 *
 * **The cycle is the spec's own on purpose.** A drafted objective is a goal,
 * and in the instance's current cycle it is counted by every spec on the
 * same shard that counts that cycle's goals: a quarterly review once listed
 * seven objectives where it expected two. A year far ahead holds nothing
 * anybody else reads.
 */
export async function makeSector(
  page: Page,
  playwright: Requests,
  baseURL: string | undefined,
  name: string,
): Promise<{ readonly sectorId: string; readonly cycleId: string }> {
  const { api, headers } = await apiFor(page, playwright, baseURL, name);
  const space = await api.post("/api/v1/spaces/create", {
    headers,
    data: { name },
  });
  expect(space.status(), await space.text()).toBe(200);
  const sectorId = ((await space.json()).data as { id: string }).id;
  const sector = await api.post("/api/v1/strategy/setSector", {
    headers,
    data: { spaceId: sectorId },
  });
  expect(sector.status(), await sector.text()).toBe(200);

  // Another spec on the shard may hold a year already, so a taken one is
  // tried again with another.
  let cycleId: string | null = null;
  for (let attempt = 0; attempt < 8 && cycleId === null; attempt += 1) {
    const year =
      new Date().getUTCFullYear() + 20 + Math.floor(Math.random() * 150);
    const cycle = await api.post("/api/v1/cycles/create", {
      headers,
      data: { on: `${year}-06-15`, mode: "annual" },
    });
    if (cycle.status() === 200) {
      cycleId = ((await cycle.json()).data as { id: string }).id;
    }
  }
  expect(cycleId, "no free year for the spec's own plan cycle").not.toBeNull();
  await api.dispose();
  return { sectorId, cycleId: cycleId as string };
}

/** Drafts objectives into the spec's own cycle, never the instance's. */
export async function draftObjectivesInto(
  page: Page,
  cycleId: string,
): Promise<void> {
  await page.getByLabel("Plan cycle").selectOption(cycleId);
  await page.getByRole("button", { name: "Draft objectives" }).click();
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
