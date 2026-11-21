import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDocumentReader } from "../../lib/extension/document-reader";

/**
 * The relay hands an uploaded strategy document to this reader
 * (docs/extension/design/b0-vertical-slice.md, criterion 3). The reader's own
 * behaviour is tested in `packages/adapters`; what is held here is that the
 * web application reaches a working one, and that the relay is given it.
 */
const SAMPLE = join(
  import.meta.dirname,
  "../../../../packages/adapters/test/fixtures/extension/strategy-sample.pdf",
);

describe("the web application's document reader", () => {
  it("reads the pages of a PDF", async () => {
    const result = await getDocumentReader().extract(readFileSync(SAMPLE));
    expect(result.kind).toBe("pages");
    if (result.kind === "pages") {
      expect(result.pages).toHaveLength(4);
      expect(result.pages[0]?.text).toContain("الحكومية التجريبية");
    }
  });

  it("is built once and kept", () => {
    expect(getDocumentReader()).toBe(getDocumentReader());
  });

  it("is what the relay gives the extraction job", () => {
    // Without this line the job has no reader, throws, and the relay retries
    // a document that will never be read.
    const relay = readFileSync(
      join(import.meta.dirname, "../../lib/relay.ts"),
      "utf8",
    );
    expect(relay).toMatch(
      /extractPages:\s*\(body\)\s*=>\s*getDocumentReader\(\)\.extract\(body\)/,
    );
  });
});
