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
  | {
      readonly status: "verified";
      /**
       * `exact` when the quotation is on the page word for word.
       * `leading_conjunction` when it is there once the page's "و" or "ف" is
       * put back on its first word.
       */
      readonly match: "exact" | "leading_conjunction";
      /**
       * The quotation to keep. For an exact match, the quotation as given.
       * Otherwise the same words with the page's conjunction restored, so
       * what is kept is what the page says.
       */
      readonly quote: string;
    }
  | {
      readonly status: "unverified";
      readonly reason: "too_short" | "not_on_page";
    };

/**
 * The two letters Arabic joins to a word for "and" and "so".
 *
 * Only these. A joined lam, ba or kaf is a preposition, and "للقطاع" does not
 * say what "القطاع" says, so a quotation that drops one is not on the page.
 */
const CONJUNCTIONS = ["و", "ف"] as const;

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
  if (page.includes(` ${quote.join(" ")} `)) {
    return { status: "verified", match: "exact", quote: input.quote.trim() };
  }

  // A sentence that opens with "ولا يوجد" is often quoted as "لا يوجد". The
  // conjunction is put back on the first word, and only there, and the rest
  // must still be on the page word for word.
  //
  // **This cannot tell a conjunction from a letter that belongs to the
  // word.** "وزارة" is one word, and "زارة الصحة تعلن الخطة" will match a
  // page that says "وزارة الصحة تعلن الخطة". That is safe for one reason:
  // what is returned to be kept is the page's wording, with its first
  // letter. Whatever is stored and shown as verified is on the page, word
  // for word, so this rule can widen which quotations are accepted and
  // cannot attach to a page anything the page does not say.
  const [first, ...rest] = quote;
  // A one-letter first word plus a conjunction is not how anything is quoted.
  if (first !== undefined && [...first].length >= 2) {
    for (const conjunction of CONJUNCTIONS) {
      const restored = [conjunction + first, ...rest].join(" ");
      if (page.includes(` ${restored} `)) {
        return {
          status: "verified",
          match: "leading_conjunction",
          quote: restoreConjunction(input.quote, conjunction),
        };
      }
    }
  }
  return { status: "unverified", reason: "not_on_page" };
}

/** The quotation with the conjunction joined to its first letter. */
function restoreConjunction(quote: string, conjunction: string): string {
  const trimmed = quote.trim();
  const at = trimmed.search(/\p{L}/u);
  return at < 0
    ? trimmed
    : trimmed.slice(0, at) + conjunction + trimmed.slice(at);
}
