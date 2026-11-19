import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The Arabic typeface is committed, licensed and loaded
 * (docs/extension/design/b0-vertical-slice.md §7, docs/extension/DEPENDENCIES.md).
 *
 * Geist has no Arabic glyphs, and the fallback stack named no Arabic face, so
 * Arabic text rendered in whatever the visitor's machine happened to have.
 * IBM Plex Sans Arabic is vendored beside Geist for the same reason Geist is:
 * an air-gapped build has no network, and a font fetched at build time fails
 * it.
 */

const WEB = join(import.meta.dirname, "../..");
const FONTS = join(WEB, "app/fonts");
const read = (path: string) => readFileSync(path, "utf8");

/** The four weights the interface uses, with the checksum of each file. */
const FILES: Readonly<Record<string, string>> = {
  "IBMPlexSansArabic-Regular.woff2":
    "74112e1b7bf2e2c547989a4e947a60cba6cd1f9156e0065670134636e717199d",
  "IBMPlexSansArabic-Medium.woff2":
    "c72f6986f50ded745d06e71e508096209c52a55a6b3a81029954e33c52ba1dd2",
  "IBMPlexSansArabic-SemiBold.woff2":
    "869b2acd0a9660607a2025f0fe1c640110bf23d33417509328f07722922b8063",
  "IBMPlexSansArabic-Bold.woff2":
    "db6650a05969c144ab5ab9bb6c3beca6ca4dbb3537bb5f2311c878dd293875b4",
};

describe("the Arabic typeface", () => {
  test("is committed, each file the one its checksum names", () => {
    const wrong = Object.entries(FILES).flatMap(([name, expected]) => {
      const path = join(FONTS, name);
      if (!existsSync(path)) {
        return [`${name} is missing`];
      }
      const actual = createHash("sha256")
        .update(readFileSync(path))
        .digest("hex");
      return actual === expected ? [] : [`${name} is not the file recorded`];
    });
    expect(wrong).toEqual([]);
  });

  test("ships with its licence and the checksums are written down", () => {
    const licence = read(join(FONTS, "LICENSE-IBM-Plex.txt"));
    expect(licence).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(licence).toContain("IBM Corp.");
    const readme = read(join(FONTS, "README.md"));
    for (const checksum of Object.values(FILES)) {
      expect(readme).toContain(checksum);
    }
  });

  test("is loaded from this origin and not preloaded for pages with no Arabic", () => {
    const layout = read(join(WEB, "app/layout.tsx"));
    expect(layout).toContain('variable: "--font-arabic-face"');
    expect(layout).toContain("plexArabic.variable");
    // A browser fetches a face when a glyph needs it. Preloading would make
    // every English page download four files it never draws with.
    expect(layout).toMatch(
      /const plexArabic = localFont\(\{[\s\S]*?preload: false/,
    );
  });

  /**
   * Next expands a font variable into the face **and its fallbacks**: Geist's
   * becomes `geistSans, "geistSans Fallback", …, Arial, sans-serif`. A face
   * listed after that is reached only when none of those has the glyph, and
   * Arial has Arabic glyphs on Windows and macOS, so Arabic text was drawn in
   * Arial there. The Arabic face therefore comes first, limited to the Arabic
   * blocks by `unicode-range`, so it is asked for Arabic and nothing else.
   */
  test("comes first in the stack and is limited to Arabic text", () => {
    const tokens = read(join(WEB, "../../packages/ui/src/styles/tokens.css"));
    expect(tokens).toMatch(
      /--font-sans:\s*var\(--font-arabic-face\),\s*var\(--font-sans-face\),/,
    );
    const layout = read(join(WEB, "app/layout.tsx"));
    expect(layout).toMatch(
      /const plexArabic = localFont\(\{[\s\S]*?prop: "unicode-range"[\s\S]*?U\+0600-06FF/,
    );
    // No size-adjusted fallback face of its own, which would put a second
    // Latin-capable family ahead of Geist.
    expect(layout).toMatch(
      /const plexArabic = localFont\(\{[\s\S]*?adjustFontFallback: false/,
    );
  });
});
