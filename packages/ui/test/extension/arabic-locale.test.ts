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

/**
 * The shell is in Arabic (docs/extension/design/b0-vertical-slice.md §9
 * criterion 1): every navigation label, the group headings, the role names
 * and the two buttons of the top bar. A key listed here that reads the same
 * as the English is one nobody translated.
 */
describe("the shell, in Arabic", () => {
  const SHELL_KEYS = Object.keys(CATALOGUES.en).filter(
    (key) =>
      key.startsWith("nav.item.") ||
      key.startsWith("nav.group.") ||
      key.startsWith("role.builtin.") ||
      key === "okrList.newInTopbar" ||
      key === "copilot.copilotPanel.ask",
  );

  /** Product and protocol names Arabic writes as they are. */
  const SAME_IN_ARABIC: ReadonlySet<string> = new Set(["nav.group.okr"]);

  test("has more than a handful of keys to speak for", () => {
    expect(SHELL_KEYS.length).toBeGreaterThan(40);
  });

  test("translates every one of them", () => {
    const untranslated = SHELL_KEYS.filter(
      (key) =>
        !SAME_IN_ARABIC.has(key) && CATALOGUES.ar[key] === CATALOGUES.en[key],
    );
    expect(untranslated).toEqual([]);
  });
});

describe("the direction a locale is written in", () => {
  test("is right to left for Arabic and left to right for the others", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("en")).toBe("ltr");
    expect(directionOf("ms")).toBe("ltr");
  });
});
