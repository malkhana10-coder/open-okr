/**
 * Whether a quotation is on the page it names
 * (docs/extension/design/b0-vertical-slice.md §5.1 and §9 criteria 5 and 6).
 *
 * Every claim an agent drafts carries a document, a page and a quotation.
 * This is what makes the quotation worth something: a pure function over the
 * quotation and the page's text. The model that wrote the quotation is never
 * asked whether it is true, so text injected into a document cannot produce a
 * verified source for something the page does not say.
 */
import { normaliseArabic } from "./arabic.ts";

/**
 * The shortest quotation that is verified, in words, unless a caller says
 * otherwise (docs/extension/design/b0-vertical-slice.md §9 criterion 5).
 *
 * A quotation of fewer words proves nothing: "the licensing sector" is on
 * nearly every page of a strategy that has one. Four is the product owner's
 * decision of 19 November 2026. It is a default, not a rule built into the
 * check, so a workspace setting can carry another number here later without
 * this function changing.
 */
export const MIN_QUOTE_WORDS = 4;

export type CitationVerdict =
  | { readonly status: "verified" }
  | {
      readonly status: "unverified";
      readonly reason: "too_short" | "not_on_page";
    };

/**
 * The words of a text, in order, and nothing else.
 *
 * Punctuation and line breaks are where a quotation copied by a model and a
 * page read out of a PDF differ most, and neither changes what was said. What
 * is left is compared word for word, so a quotation never matches from the
 * middle of a word.
 */
function words(text: string): string[] {
  return normaliseArabic(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "");
}

export function verifyCitation(input: {
  readonly quote: string;
  readonly pageText: string;
  /** The shortest quotation to verify, in words. `MIN_QUOTE_WORDS` if omitted. */
  readonly minWords?: number;
}): CitationVerdict {
  const minWords = input.minWords ?? MIN_QUOTE_WORDS;
  if (!Number.isInteger(minWords) || minWords < 1) {
    // Zero would verify an empty quotation against every page.
    throw new RangeError("minWords must be a whole number of at least 1.");
  }
  const quote = words(input.quote);
  if (quote.length < minWords) {
    return { status: "unverified", reason: "too_short" };
  }
  // Spaces on both sides, so the quotation matches whole words only.
  const page = ` ${words(input.pageText).join(" ")} `;
  return page.includes(` ${quote.join(" ")} `)
    ? { status: "verified" }
    : { status: "unverified", reason: "not_on_page" };
}
