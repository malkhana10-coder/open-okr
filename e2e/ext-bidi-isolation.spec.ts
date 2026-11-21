import { expect, test } from "./fixtures";

/**
 * Mixed Arabic and Latin text in the right-to-left interface
 * (docs/extension/design/b0-vertical-slice.md §9أ, "عزل الاتجاه").
 *
 * The first Arabic screenshots showed untranslated English read backwards:
 * "53 days overdue." drawn as ".days overdue 53". A right-to-left page lays
 * every line out from the right unless the line says otherwise, so a line of
 * English gets its number and its full stop moved to the wrong ends.
 *
 * This measures the built application's own stylesheet on the sign-in page,
 * which needs no account: the page is turned right-to-left, text of the kinds
 * a person types is put on it, and where each piece is drawn is read back.
 */

/** The left edge of each word of `#id`, in the order the text stores them. */
async function leftEdges(
  page: import("@playwright/test").Page,
  id: string,
  words: readonly string[],
): Promise<number[]> {
  return page.evaluate(
    ({ id, words }) => {
      const node = document.getElementById(id)?.firstChild;
      const text = node?.textContent ?? "";
      if (!node) {
        throw new Error(`no text in #${id}`);
      }
      return words.map((word) => {
        const start = text.indexOf(word);
        if (start < 0) {
          throw new Error(`"${word}" is not in #${id}`);
        }
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + word.length);
        return range.getBoundingClientRect().left;
      });
    },
    { id, words },
  );
}

test("mixed text reads in its own direction on a right-to-left page", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "ar";
    const host = document.createElement("div");
    host.style.width = "900px";
    host.innerHTML = [
      // An objective as somebody would type it: Arabic, with an English
      // abbreviation, a number and a percentage.
      '<h2 id="objective">رفع نسبة الخدمات المؤتمتة ضمن مؤشر KPI 3 إلى 80% بنهاية 2027.</h2>',
      // A line the catalogue has no Arabic for yet.
      '<p id="english">53 days overdue.</p>',
      // An English name inside an Arabic sentence, as a chip would hold it.
      '<p id="sentence">يملكه <span id="name">Net Promoter Score (NPS)</span> في القطاع.</p>',
    ].join("");
    document.body.append(host);
  });

  // English reads left to right: the number first, the full stop last.
  const [number, days, overdue, stop] = await leftEdges(page, "english", [
    "53",
    "days",
    "overdue",
    ".",
  ]);
  expect(number).toBeLessThan(days as number);
  expect(days).toBeLessThan(overdue as number);
  expect(overdue).toBeLessThan(stop as number);

  // Arabic reads right to left, and what is Latin inside it keeps its order.
  const [first, kpi, three, percent, year, end] = await leftEdges(
    page,
    "objective",
    ["رفع", "KPI", "3", "80%", "2027", "."],
  );
  expect(first).toBeGreaterThan(kpi as number);
  expect(kpi).toBeLessThan(three as number);
  expect(three).toBeGreaterThan(percent as number);
  expect(percent).toBeGreaterThan(year as number);
  expect(year).toBeGreaterThan(end as number);

  // A Latin name inside an Arabic sentence keeps its closing bracket.
  const [net, nps, close] = await leftEdges(page, "name", [
    "Net",
    "NPS",
    ")",
  ]);
  expect(net).toBeLessThan(nps as number);
  expect(nps).toBeLessThan(close as number);
});

test("a left-to-right page is laid out as it was", async ({ page }) => {
  await page.goto("/sign-in");
  const value = await page.evaluate(
    () => getComputedStyle(document.body).unicodeBidi,
  );
  expect(value).not.toBe("plaintext");
});
