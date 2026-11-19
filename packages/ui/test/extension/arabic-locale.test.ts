import { describe, expect, test } from "vitest";
import {
  CATALOGUES,
  directionOf,
  messageHoles,
  missingKeys,
  PARTIAL_LOCALES,
  translate,
} from "../../src/i18n/catalogue.ts";
import arabic from "../../src/i18n/messages/ar.partial.json";

/**
 * Arabic as a partial locale (docs/extension/design/b0-vertical-slice.md §3
 * and §6 row 5).
 *
 * The first slice translates the shell and its own screens, not the whole
 * catalogue. `translate` throws on a missing key, so a partial locale is
 * completed from the English source when the catalogues are built: a screen
 * outside the slice reads in English instead of failing.
 */

describe("Arabic, a partial locale", () => {
  test("is a shipped catalogue with every key the source has", () => {
    expect(Object.keys(CATALOGUES)).toContain("ar");
    expect(missingKeys("ar")).toEqual([]);
    expect(PARTIAL_LOCALES).toEqual(["ar"]);
  });

  test("reads a translated key in Arabic", () => {
    expect(translate(CATALOGUES.ar, "shell.footer.search")).toBe("بحث");
  });

  test("reads an untranslated key in English rather than throwing", () => {
    const untranslated = Object.keys(CATALOGUES.en).find(
      (key) => !(key in arabic),
    );
    expect(untranslated).toBeDefined();
    expect(CATALOGUES.ar[untranslated as string]).toBe(
      CATALOGUES.en[untranslated as string],
    );
  });

  test("translates no key the source does not have", () => {
    const stale = Object.keys(arabic).filter((key) => !(key in CATALOGUES.en));
    expect(stale).toEqual([]);
  });

  test("keeps every hole of the message it translates", () => {
    const wrong = Object.entries(arabic as Record<string, string>).filter(
      ([key, value]) =>
        [...messageHoles(value)].sort().join() !==
        [...messageHoles(CATALOGUES.en[key] ?? "")].sort().join(),
    );
    expect(wrong.map(([key]) => key)).toEqual([]);
  });
});

describe("the direction a locale is written in", () => {
  test("is right to left for Arabic and left to right for the others", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("en")).toBe("ltr");
    expect(directionOf("ms")).toBe("ltr");
  });
});
