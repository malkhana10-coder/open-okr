import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mixed text in a right-to-left page
 * (docs/extension/design/b0-vertical-slice.md §9أ, "عزل الاتجاه").
 *
 * What the rule does on screen is measured in a browser by
 * `e2e/ext-bidi-isolation.spec.ts`. What is held here is that the rule is
 * loaded, and that it cannot reach a left-to-right page.
 */
const root = join(import.meta.dirname, "../../../..");
const rule = readFileSync(
  join(root, "packages/ui/src/styles/extension/bidi-isolation.css"),
  "utf8",
);
const globals = readFileSync(join(root, "apps/web/app/globals.css"), "utf8");

describe("bidirectional isolation", () => {
  it("is loaded by the application's stylesheet", () => {
    expect(globals).toContain("styles/extension/bidi-isolation.css");
  });

  it("lets every element read in the direction of its own text", () => {
    expect(rule).toMatch(/unicode-bidi:\s*plaintext/);
  });

  it("applies under a right-to-left page and nowhere else", () => {
    const selectors = [...rule.matchAll(/^([^@/*\s][^{]*)\{/gm)].map((match) =>
      (match[1] ?? "").trim(),
    );
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      for (const part of selector.split(",")) {
        expect(part.trim()).toMatch(/^\[dir="rtl"\]/);
      }
    }
  });
});
