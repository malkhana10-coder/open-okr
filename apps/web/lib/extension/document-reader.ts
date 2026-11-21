/**
 * The reader the relay uses to turn an uploaded strategy document into pages
 * (docs/extension/design/b0-vertical-slice.md, criterion 3).
 *
 * Built on first use and kept on `globalThis`, the way `getImageProcessor`
 * keeps the image driver: a development server reloads modules, and the
 * reader holds a loaded library that should be loaded once.
 */
import { PdfjsTextExtractor, type TextExtractor } from "@openokr/adapters";

const globals = globalThis as typeof globalThis & {
  openokrDocumentReader?: TextExtractor;
};

export function getDocumentReader(): TextExtractor {
  globals.openokrDocumentReader ??= new PdfjsTextExtractor();
  return globals.openokrDocumentReader;
}
