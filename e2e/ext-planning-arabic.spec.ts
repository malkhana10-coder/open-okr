import type { Page } from "@playwright/test";
import { LICENSING_PDF, makeSector } from "./ext-planning.ts";
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
 * The five planning screens for a member who reads Arabic (design
 * b0-vertical-slice.md, criterion 1): the page runs right to left, the
 * sidebar is on the right, no English is written on the screens, and an
 * objective that mixes Arabic and digits reads in its own direction.
 *
 * A member of their own reads Arabic, not the instance account: the
 * language is the member's, and every other spec on the shard reads the
 * instance account in English.
 */

/** Latin words a screen may hold in Arabic: a file format's own name. */
const ALLOWED_LATIN = new Set(["PDF"]);

/**
 * Every word a reader of the screen meets, Latin ones only: its text, its
 * spoken names and hints, and the choices its own menus offer.
 *
 * The screen's own content, not the shell around it. The shell's footer
 * carries the upstream keyboard hint, whose spoken "Command" is not in the
 * catalogue (DECISIONS-LOG ت-51); the five screens are what criterion 1
 * holds to Arabic.
 *
 * Left out on purpose: the options of the sector and cycle menus. Those are
 * names people gave, and other specs on the shard give theirs in English.
 */
async function latinWords(page: Page): Promise<string[]> {
  const text = await page
    .getByRole("main")
    .locator(".stagger")
    .first()
    .evaluate((root) => {
      const data = 'select[name="sector"], select[name="cycle"]';
      const parts: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!parent || parent.closest(data)) {
          continue;
        }
        if (getComputedStyle(parent).display === "none") {
          continue;
        }
        parts.push(node.textContent ?? "");
      }
      for (const element of root.querySelectorAll(
        "[aria-label], [title], [placeholder], [alt]",
      )) {
        for (const name of ["aria-label", "title", "placeholder", "alt"]) {
          parts.push(element.getAttribute(name) ?? "");
        }
      }
      return parts.join(" ");
    });
  return [...new Set(text.match(/[A-Za-z]{2,}/g) ?? [])].filter(
    (word) => !ALLOWED_LATIN.has(word),
  );
}

/** A planning tab. The sidebar has an entry of the same name for Goals. */
async function tab(page: Page, name: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "شاشات التخطيط" })
    .getByRole("link", { name, exact: true })
    .click();
}

/**
 * Every line of Arabic on the screen starts at the right edge of its box.
 * Under the bidi rule a box with no strong letter of its own was drawn from
 * the left: a button alone in a row, a name in `<bdi>`. That is the fault
 * this catches (DECISIONS-LOG ت-57).
 */
async function linesStartRight(page: Page): Promise<void> {
  const misplaced = await page
    .getByRole("main")
    .locator(".stagger")
    .first()
    .evaluate((root) => {
      const found: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? "";
        // Any line that starts with a letter or a digit, Arabic or not:
        // a line with no Arabic letter at its start is the one at risk.
        if (!/^\s*[\p{L}\p{N}]/u.test(text)) {
          continue;
        }
        // A mixed line is drawn in pieces; its right end is the rightmost.
        const range = document.createRange();
        range.selectNodeContents(node);
        let right = Math.max(
          ...[...range.getClientRects()].map((rect) => rect.right),
        );
        // The nearest block that lays this line out. A box inside the line,
        // a button, is placed by its own edge, not by its text's.
        let block = node.parentElement;
        while (block && getComputedStyle(block).display.startsWith("inline")) {
          if (getComputedStyle(block).display !== "inline") {
            right = block.getBoundingClientRect().right;
          }
          block = block.parentElement;
        }
        if (!block || block.closest("select, option, summary")) {
          continue;
        }
        const style = getComputedStyle(block);
        // Flex and grid place their items themselves, a disclosure's marker
        // stands before its text, and a centred line is centred on purpose.
        if (
          ["flex", "grid"].includes(style.display) ||
          style.textAlign === "center"
        ) {
          continue;
        }
        // The line's start is its first words: a later piece of the same
        // line sits wherever the words before it end.
        const first = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let lead = first.nextNode();
        while (lead && (lead.textContent ?? "").trim() === "") {
          lead = first.nextNode();
        }
        if (lead !== node) {
          continue;
        }
        const box = block.getBoundingClientRect();
        const padding = Number.parseFloat(style.paddingRight) || 0;
        if (Number.isFinite(right) && box.right - padding - right > 4) {
          found.push(text.trim().slice(0, 40));
        }
      }
      return found;
    });
  expect(misplaced).toEqual([]);
}

async function readsRightToLeft(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const main = await page.getByRole("main").boundingBox();
  const sidebar = await page.locator('a[href="/planning"]').first().boundingBox();
  expect(main && sidebar).toBeTruthy();
  // The sidebar starts where the main column ends: on the right of it.
  expect(sidebar?.x ?? 0).toBeGreaterThanOrEqual(
    (main?.x ?? 0) + (main?.width ?? 0) - 2,
  );
  expect(await latinWords(page)).toEqual([]);
  await linesStartRight(page);
  // The browser's own file field writes in the browser's language, so it
  // is never shown: a picture would miss its return by a few pixels.
  const fields = await page.locator('input[type="file"]').evaluateAll((all) =>
    all.map((field) => {
      const box = field.getBoundingClientRect();
      return box.width * box.height;
    }),
  );
  for (const area of fields) {
    expect(area).toBeLessThanOrEqual(1);
  }
  // Western digits, as decided (design §12.5), on every screen.
  await expect(
    page.getByRole("main").getByText(/[\u0660-\u0669\u06F0-\u06F9]/),
  ).toHaveCount(0);
}

test("the planning screens read right to left, all in Arabic", async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  test.setTimeout(300_000);
  // Digits only: a hex tag would put Latin letters in the sector's name.
  const tag = String(Date.now()).slice(-6);
  // Arabic names: the screens show them, and they are part of what is read.
  const sector = `قطاع الخدمات والتراخيص ${tag}`;
  const reader = { name: "نورة السالم", email: `arabic-${tag}@example.com` };

  await signIn(page);
  const { sectorId, cycleId } = await makeSector(
    page,
    playwright,
    baseURL,
    sector,
  );
  const joinPath = await inviteByEmail(page, reader.email);
  // An Arabic browser too: the file picker's own words are the browser's.
  const theirs = await personContext(browser, { locale: "ar-SA" });
  const arabic = await theirs.newPage();
  await joinAsNewcomer(arabic, joinPath, reader);
  const pool = instancePool();
  const { rows } = await pool.query<{ id: string }>(
    `select m.id from workspace_members m join users u on u.id = m.user_id
      where u.email = $1 and m.deleted_at is null`,
    [reader.email],
  );
  await pool.end();
  expect(rows[0]?.id, "the reader joined").toBeTruthy();
  await makeAdministrator(page, rows[0]?.id as string);

  // The member chooses Arabic for themselves.
  await goTo(arabic, "/account");
  await arabic.getByTestId("language-ar").click();
  await expect(arabic.locator("html")).toHaveAttribute("dir", "rtl", {
    timeout: 15_000,
  });

  // Documents.
  await goTo(arabic, `/planning/documents?sector=${sectorId}`);
  await expect(
    arabic.getByRole("heading", { name: "الوثائق المصدرية", level: 1 }),
  ).toBeVisible();
  await arabic.getByLabel("ملف PDF").setInputFiles(LICENSING_PDF);
  await arabic.getByLabel("العنوان").fill("الاستراتيجية الفرعية للتراخيص");
  await arabic.getByLabel("السنة").fill("2027");
  await arabic.getByRole("button", { name: "رفع", exact: true }).click();
  const row = arabic
    .getByRole("listitem")
    .filter({ hasText: "الاستراتيجية الفرعية للتراخيص" });
  await expect(row).toContainText("عدد الصفحات: 13", { timeout: 60_000 });
  await readsRightToLeft(arabic);

  // Gaps.
  await tab(arabic, "الفجوات");
  await arabic.getByRole("button", { name: "صياغة الفجوات" }).click();
  await expect(arabic.getByText("مسودة آلية", { exact: true })).toHaveCount(6, {
    timeout: 30_000,
  });
  // The last run's date: Gregorian, Western digits.
  await expect(arabic.getByText(/^وقت التشغيل: .*\d{4}/)).toBeVisible();
  await readsRightToLeft(arabic);

  // Objectives.
  await tab(arabic, "الأهداف");
  await arabic.getByLabel("دورة الخطة").selectOption(cycleId);
  await arabic.getByRole("button", { name: "صياغة الأهداف" }).click();
  await expect(arabic.getByText("مسودة آلية", { exact: true })).toHaveCount(5, {
    timeout: 30_000,
  });
  await readsRightToLeft(arabic);

  // A stored target mixing Arabic and a year reads right to left. Two
  // things show it, and the first is what a left-to-right line would get
  // wrong: the line starts at the right edge of its box, and the year that
  // ends it is drawn to the left of the word before it.
  const target = "دليل منشور يغطي كل أنواع التراخيص بنهاية عام 2027";
  await expect(arabic.getByText(target)).toBeVisible();
  const placed = await arabic.getByText(target).evaluate((element) => {
    const node = element.firstChild;
    const text = node?.textContent ?? "";
    const box = (part: string) => {
      const range = document.createRange();
      const start = text.indexOf(part);
      range.setStart(node as Node, start);
      range.setEnd(node as Node, start + part.length);
      return range.getBoundingClientRect();
    };
    return {
      right: element.getBoundingClientRect().right,
      firstWord: box("دليل").right,
      year: box("2027").left,
      before: box("عام").left,
    };
  });
  expect(Math.abs(placed.right - placed.firstWord)).toBeLessThan(4);
  expect(placed.year).toBeLessThan(placed.before);

  // Alignment.
  await tab(arabic, "الربط");
  await expect(
    arabic.getByRole("heading", { name: "الفجوات", level: 2 }),
  ).toBeVisible();
  await readsRightToLeft(arabic);

  // Approvals.
  await tab(arabic, "الاعتماد");
  await expect(
    arabic.getByRole("heading", { name: "الرفع للاعتماد", level: 2 }),
  ).toBeVisible();
  await readsRightToLeft(arabic);

  // The reference pictures, in both directions, of the same screen
  // (criterion 1). Masked: what changes from run to run or release to
  // release, the sector's name, the year the form offers, and the footer's
  // version. Recorded on Linux only, where continuous integration runs.
  if (process.platform === "linux") {
    await goTo(arabic, `/planning/documents?sector=${sectorId}`);
    await expect(row).toBeVisible();
    await expect(arabic).toHaveScreenshot("documents-rtl.png", {
      mask: [
        arabic.getByRole("combobox"),
        arabic.getByLabel("السنة"),
        arabic.getByTestId("app-footer"),
      ],
      maxDiffPixelRatio: 0.01,
    });
    await goTo(page, `/planning/documents?sector=${sectorId}`);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(
      page.getByRole("listitem").filter({ hasText: "الاستراتيجية الفرعية" }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot("documents-ltr.png", {
      mask: [
        page.getByRole("combobox"),
        page.getByLabel("Year"),
        page.getByTestId("app-footer"),
      ],
      maxDiffPixelRatio: 0.01,
    });
  }

  await theirs.close();
});
