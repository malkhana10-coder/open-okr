/**
 * The TextExtractor port: the text of an uploaded document, page by page
 * (docs/extension/design/b0-vertical-slice.md, criteria 3, 5 and 7).
 *
 * **Page by page, because a citation names a page.** The planning agents quote
 * a source and say which page the quote is on, and the check that the quote is
 * really there reads that one page. A reader that returned the document as one
 * string would leave nothing to check against.
 *
 * **A result, not a thrown error, for a file that cannot be read.** A damaged
 * or password-protected file is an ordinary answer about somebody's upload.
 * `packages/core` reads the result without importing this package: it declares
 * the same shape and a driver satisfies it structurally, the way
 * `ImageProcessor` already reaches core. A throw means the reader itself is
 * unavailable, and the caller retries.
 *
 * **A page with no text is still a page.** A scanned document has pages and no
 * text on them. The caller decides what that means; the port only reports it.
 */

/** One page of a document. Pages are numbered from 1, as a person counts them. */
export interface ExtractedPage {
  readonly page: number;
  /** In reading order. Empty when the page has no text layer. */
  readonly text: string;
}

export type TextExtractionResult =
  | { readonly kind: "pages"; readonly pages: readonly ExtractedPage[] }
  /** The bytes are not a document this driver reads, or it is damaged or locked. */
  | { readonly kind: "unreadable" };

export interface TextExtractor {
  extract(body: Buffer): Promise<TextExtractionResult>;
}
