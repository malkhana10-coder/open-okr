/**
 * The knowledge layer's pure rules
 * (docs/extension/design/b0-vertical-slice.md §6.1).
 *
 * No database, no network and no import outside this folder, so the server
 * and the browser apply the same rule.
 */
export { normaliseArabic } from "./arabic.ts";
export {
  type CitationVerdict,
  MIN_QUOTE_WORDS,
  verifyCitation,
} from "./citation.ts";
