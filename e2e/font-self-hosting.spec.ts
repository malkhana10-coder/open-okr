import { expect, test } from "./fixtures.ts";

/**
 * The typeface is self-hosted, and stays that way.
 *
 * UIUX-PLAN.md §2 says Geist is self-hosted and PLAN.md requires an install
 * that works air-gapped. Both are easy to break without noticing: swapping
 * `next/font/local` back to `next/font/google`, or adding a stylesheet that
 * pulls a face from a CDN, leaves the product looking identical on a
 * developer machine with a network and broken on a customer's isolated one.
 *
 * Runs against the built standalone server, so it sees what ships.
 */
test("no request leaves this origin, and the font is ours", async ({
  page,
}) => {
  const external: string[] = [];
  const fonts: string[] = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      external.push(request.url());
    }
    if (url.pathname.includes(".woff")) {
      fonts.push(url.pathname);
    }
  });

  await page.goto("/sign-in");
  await page.evaluate(() => document.fonts.ready);

  // Not "no font CDN" — no third-party request of any kind.
  expect(external).toEqual([]);

  // One variable file covering 100 to 900, served by us. Nine static weights
  // would be nine requests, and a Google-hosted build would be none from here
  // and several from fonts.gstatic.com.
  expect(fonts).toHaveLength(1);
  expect(fonts[0]).toMatch(/^\/_next\/static\/media\/Geist_Variable/);
});

test("the face is really in use, not merely declared", async ({ page }) => {
  await page.goto("/sign-in");
  await page.evaluate(() => document.fonts.ready);

  const loaded = await page.evaluate(() =>
    [...document.fonts].map((face) => `${face.family}:${face.status}`),
  );
  expect(loaded).toContain("geistSans:loaded");

  const stack = await page.evaluate(
    () => getComputedStyle(document.body).fontFamily,
  );
  // The Arabic face leads, limited to the Arabic blocks by its unicode-range,
  // and Geist follows it at once (apps/web/app/fonts/README.md). It has to
  // lead: Next expands Geist's variable into the face and its fallbacks, which
  // end in Arial, and Arial has Arabic glyphs on Windows and macOS.
  const families = stack.split(",").map((family) => family.trim());
  expect(families[0]).toContain("plexArabic");
  expect(families[1]).toContain("geistSans");

  // A declared-but-unloaded face silently falls back and every assertion above
  // still passes. Measuring the same string in both faces is what separates
  // "the CSS is right" from "the glyphs on screen are Geist".
  const { geist, fallback } = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.textContent = "Handgloves 0123456789";
    probe.style.cssText =
      "position:absolute;left:-9999px;font-size:40px;white-space:nowrap";
    document.body.append(probe);
    probe.style.fontFamily = "geistSans";
    const withGeist = probe.getBoundingClientRect().width;
    probe.style.fontFamily = "Arial";
    const withFallback = probe.getBoundingClientRect().width;
    probe.remove();
    return { geist: withGeist, fallback: withFallback };
  });

  expect(geist).toBeGreaterThan(0);
  expect(Math.abs(geist - fallback)).toBeGreaterThan(1);
});

/**
 * Leading the stack must not cost Latin text its face, and must give Arabic
 * text one (docs/extension/design/b0-vertical-slice.md §9 criterion 1).
 *
 * The page's own stack is measured, not a family named by hand: Latin text in
 * it is exactly as wide as in Geist alone, so the Arabic face draws none of
 * it, and Arabic text in it is not what the generic fallback would draw.
 */
test("Latin text stays Geist and Arabic text is drawn in the Arabic face", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.evaluate(() => document.fonts.ready);

  const measured = await page.evaluate(async () => {
    const stack = getComputedStyle(document.body).fontFamily;
    const probe = document.createElement("span");
    probe.style.cssText =
      "position:absolute;left:-9999px;font-size:40px;white-space:nowrap";
    document.body.append(probe);
    const width = (text: string, family: string) => {
      probe.textContent = text;
      probe.style.fontFamily = family;
      return probe.getBoundingClientRect().width;
    };

    const latin = "Handgloves 0123456789";
    const arabic = "الأهداف القطاعية";
    // Drawing Arabic is what makes the browser fetch the face. The face is
    // then awaited by its own name: the page's stack also names Geist's
    // metric fallback, a local face a machine may not have, and asking for
    // the whole stack fails on that one.
    width(arabic, stack);
    await document.fonts.load("40px plexArabic", arabic);
    await document.fonts.ready;

    const result = {
      latinInStack: width(latin, stack),
      latinInGeist: width(latin, "geistSans"),
      arabicInStack: width(arabic, stack),
      arabicInFallback: width(arabic, "sans-serif"),
      faces: [...document.fonts].map((face) => `${face.family}:${face.status}`),
    };
    probe.remove();
    return result;
  });

  expect(measured.latinInStack).toBe(measured.latinInGeist);
  expect(measured.faces).toContain("plexArabic:loaded");
  expect(
    Math.abs(measured.arabicInStack - measured.arabicInFallback),
  ).toBeGreaterThan(1);
});
