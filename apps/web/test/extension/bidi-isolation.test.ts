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

  it("puts alignment back to the page's start, for both engines", () => {
    // Without it every box with no strong letter of its own, a button alone
    // in a row, is drawn from the left on an Arabic page.
    expect(rule).toMatch(/text-align:\s*match-parent/);
    expect(rule).toMatch(/text-align:\s*-webkit-match-parent/);
    expect(rule).toMatch(/:not\(input, textarea, pre, pre \*, code\)/);
  });

  it("applies under a right-to-left page and nowhere else", () => {
    // Comments out first, then each rule's selector: whatever stands
    // between one block's end and the next block's start.
    const bare = rule.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...bare.matchAll(/([^{}]+)\{/g)].map((match) =>
      (match[1] ?? "").trim(),
    );
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      // Commas inside `:not()` and `:where()` belong to one selector.
      const parts: string[] = [];
      let depth = 0;
      let current = "";
      for (const char of selector) {
        depth += char === "(" ? 1 : char === ")" ? -1 : 0;
        if (char === "," && depth === 0) {
          parts.push(current);
          current = "";
        } else {
          current += char;
        }
      }
      parts.push(current);
      for (const part of parts) {
        // Directly, or inside `:where()`, which keeps the same scope and
        // gives it no weight.
        expect(part.trim()).toMatch(/^(:where\()?\[dir="rtl"\]/);
      }
    }
  });
});
