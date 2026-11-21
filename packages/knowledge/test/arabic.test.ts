import { describe, expect, it } from "vitest";
import { normaliseArabic } from "../src/index.ts";

/**
 * Arabic text, made comparable
 * (docs/extension/design/b0-vertical-slice.md §3 and §9 criterion 6).
 *
 * The same word is written several ways: with or without its vowel marks,
 * with a hamza on the alef or without one, stretched with a tatweel to fill a
 * line. A quotation copied from a document and the page it came from differ
 * in exactly these ways, and so do a search and the text it should find.
 */

describe("normaliseArabic", () => {
  it("removes the vowel marks", () => {
    expect(normaliseArabic("الْأَهْدَافُ الاسْتِرَاتِيجِيَّةُ")).toBe(
      "الاهداف الاستراتيجيه",
    );
  });

  it("removes the tatweel that stretches a word", () => {
    expect(normaliseArabic("الخـــطة")).toBe("الخطه");
  });

  it("writes every alef the same way", () => {
    expect(normaliseArabic("أهداف إدارة آلية ٱلعمل")).toBe(
      "اهداف اداره اليه العمل",
    );
  });

  it("writes a hamza on its carrier as the carrier", () => {
    expect(normaliseArabic("مسؤول شؤون وسائل")).toBe("مسوول شوون وسايل");
  });

  it("writes the taa marbuta and the alef maqsura as their plain forms", () => {
    expect(normaliseArabic("مبادرة")).toBe(normaliseArabic("مبادره"));
    expect(normaliseArabic("مستوى")).toBe(normaliseArabic("مستوي"));
  });

  it("writes Arabic-Indic and Persian digits as ASCII digits", () => {
    expect(normaliseArabic("٢٠٢٧ و ۲۰۲۷")).toBe("2027 و 2027");
  });

  it("folds the presentation forms a PDF often carries", () => {
    // U+FEDF U+FE8E: lam and alef in their isolated presentation forms.
    expect(normaliseArabic("ﻟﺎ")).toBe("لا");
  });

  it("drops the invisible marks and collapses the spaces around them", () => {
    expect(normaliseArabic("  الخطة‏   السنوية‌\n")).toBe("الخطه السنويه");
  });

  it("lowers Latin letters and leaves everything else alone", () => {
    expect(normaliseArabic("KPI رقم 3: Net Promoter Score")).toBe(
      "kpi رقم 3: net promoter score",
    );
  });

  it("is idempotent", () => {
    const once = normaliseArabic("الْأَهْدَافُ الاسـتراتيجيّة ٢٠٢٧");
    expect(normaliseArabic(once)).toBe(once);
  });

  it("answers an empty string for an empty string", () => {
    expect(normaliseArabic("")).toBe("");
  });
});
