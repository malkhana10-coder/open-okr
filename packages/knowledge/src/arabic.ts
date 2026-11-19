/**
 * Arabic text, made comparable
 * (docs/extension/design/b0-vertical-slice.md §3).
 *
 * One rule for every place two pieces of Arabic text are compared: a
 * quotation against the page it names, a search against the text it should
 * find, a new objective against the ones that exist. It is a pure function so
 * that the server, the browser and a test all apply the same one.
 *
 * What it folds, and why each is safe to fold:
 *
 * - **Presentation forms.** A PDF often stores a letter by its shape in the
 *   word rather than by the letter. Unicode compatibility normalisation
 *   returns the letter.
 * - **Vowel marks and the tatweel.** Optional in writing, and absent or
 *   present by the habit of whoever typed the text.
 * - **The alef's hamza, the hamza's carrier, the taa marbuta and the alef
 *   maqsura.** The four spellings people most often write interchangeably.
 * - **Digits.** Arabic-Indic and Persian digits are the same numbers.
 * - **Invisible marks and runs of white space.** Direction marks and joiners
 *   carry no text.
 *
 * It does not stem, drop the definite article or remove punctuation. Those
 * change which words match, which is a decision for a caller, not for the
 * rule every caller shares.
 */

/** Vowel marks, the superscript alef, Quranic annotation marks, and the tatweel. */
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

/** Direction marks, joiners, the byte order mark and the soft hyphen. */
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿­]/g;

const LETTERS: Readonly<Record<string, string>> = {
  أ: "ا", // alef with hamza above
  إ: "ا", // alef with hamza below
  آ: "ا", // alef with madda
  ٱ: "ا", // alef wasla
  ؤ: "و", // waw with hamza
  ئ: "ي", // yeh with hamza
  ة: "ه", // taa marbuta
  ى: "ي", // alef maqsura
  ی: "ي", // Farsi yeh
  ک: "ك", // keheh
};

const LETTER = new RegExp(`[${Object.keys(LETTERS).join("")}]`, "g");

/** Arabic-Indic digits start at U+0660 and Persian ones at U+06F0. */
const DIGIT = /[٠-٩۰-۹]/g;

const asciiDigit = (digit: string): string => {
  const code = digit.charCodeAt(0);
  return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
};

export function normaliseArabic(text: string): string {
  return text
    .normalize("NFKC")
    .replace(MARKS, "")
    .replace(INVISIBLE, "")
    .replace(LETTER, (letter) => LETTERS[letter] ?? letter)
    .replace(DIGIT, asciiDigit)
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}
