/**
 * How well a page came out of its file, measured without a reference
 * (docs/extension/design/b0-vertical-slice.md §9 criterion 19, and the
 * numbers behind it in docs/extension/design/extraction-quality.md).
 *
 * Some PDF files carry a broken table from glyphs to characters. The text
 * read out of them looks like Arabic and is not what the page says: letters
 * without their dots, Latin letters in the middle of a word. A quotation
 * drawn from such a page will not verify, and the person who uploaded the
 * file should be told before an agent runs on it, not after.
 *
 * Nobody has the right text to compare with, so this counts the faults that
 * leave a trace in the text itself.
 *
 * **What it cannot see.** A letter dropped from a word leaves nothing behind.
 * A document with that fault measures clean here and still fails its
 * quotations. Seeing it takes comparing the text with a picture of the page.
 */

/** Counts for one page, or summed for a document. */
export interface ExtractionQuality {
  /** Words holding at least one Arabic letter. */
  readonly arabicWords: number;
  /** Of those, the ones carrying a fault this measure knows. */
  readonly suspectWords: number;
}

/**
 * Above this share of suspect words, a page or a document is flagged.
 *
 * Three in a hundred is the product owner's decision of 20 November 2026,
 * set from three documents: a damaged one measured 18%, two sound ones under
 * 0.1%. It is to be set again when more documents have been measured. A
 * default, not a rule built into the check, so a caller can pass another.
 */
export const LOW_QUALITY_SHARE = 0.03;

/**
 * A page with fewer Arabic words than this is not judged. On a cover or a
 * page of figures, one odd word would cross any threshold.
 */
export const MIN_WORDS_TO_JUDGE = 30;

const ARABIC_LETTER = /[ء-يٮ-ۓ]/;
const LATIN_LETTER = /\p{Script=Latin}/u;
const MARKS = /[\p{M}ـ]/gu;

/**
 * The skeleton of a letter with its dots gone: the dotless ba, qaf, fa and
 * noon, the two-eyed ha and the long ya. A sound Arabic text has none.
 */
const DOTLESS = /[ٮٯڡڧںھے]/;
/** An alef maqsura before another letter, where only a dotted ya can stand. */
const MAQSURA_INSIDE = /ى(?=[ء-ي])/;
/**
 * A word opening with two alefs and a lam: what "ال" followed by a lam-alef
 * becomes when a reader reverses the joined pair.
 */
const REVERSED_LAM_ALEF = /^(اال|األ|اإل|اآل)/;

export function extractionQuality(text: string): ExtractionQuality {
  const words = text
    .normalize("NFKC")
    .replace(MARKS, "")
    .split(/[^\p{L}]+/u)
    .filter((word) => ARABIC_LETTER.test(word));
  let suspectWords = 0;
  for (const word of words) {
    if (
      DOTLESS.test(word) ||
      MAQSURA_INSIDE.test(word) ||
      LATIN_LETTER.test(word) ||
      REVERSED_LAM_ALEF.test(word)
    ) {
      suspectWords++;
    }
  }
  return { arabicWords: words.length, suspectWords };
}

export function isLowQuality(
  quality: ExtractionQuality,
  limits: { readonly share?: number; readonly minWords?: number } = {},
): boolean {
  const share = limits.share ?? LOW_QUALITY_SHARE;
  const minWords = limits.minWords ?? MIN_WORDS_TO_JUDGE;
  if (!(share >= 0 && share < 1)) {
    // 3 for "three per cent" would flag nothing, silently.
    throw new RangeError("share must be a fraction from 0 up to 1.");
  }
  if (quality.arabicWords < minWords || quality.arabicWords === 0) {
    return false;
  }
  return quality.suspectWords / quality.arabicWords > share;
}
