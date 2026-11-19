import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The page is written in its locale's direction
 * (docs/extension/design/b0-vertical-slice.md §9 criterion 1).
 *
 * `<html>` carries `lang` and nothing else until now. Arabic needs `dir="rtl"`
 * on the root element, where the browser reads it for the scrollbar, the text
 * alignment and every logical CSS property. The root layout is a server
 * component that reads the session, so this reads its source, as
 * `rhythm-card.test.ts` does for a server action.
 */
const layout = readFileSync(
  join(import.meta.dirname, "../../app/layout.tsx"),
  "utf8",
);

describe("the root layout", () => {
  test("sets the direction of the page from its locale", () => {
    expect(layout).toContain("dir={directionOf(locale)}");
    expect(layout).toMatch(
      /import \{[^}]*\bdirectionOf\b[^}]*\} from "@openokr\/ui"/,
    );
  });

  test("keeps the language beside it", () => {
    expect(layout).toContain("lang={locale}");
  });
});
