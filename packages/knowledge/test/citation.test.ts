import { describe, expect, it } from "vitest";
import { verifyCitation } from "../src/index.ts";

/**
 * A quotation is checked against the page it names
 * (docs/extension/design/b0-vertical-slice.md §9 criteria 5 and 6).
 *
 * An agent's claim is worth what its source says. The check is a pure
 * function over the quotation and the page's text: the model that wrote the
 * quotation is never asked whether it is true.
 */

const PAGE =
  "تهدف الجهة إلى رفع نسبة إنجاز طلبات التراخيص خلال خمسة أيام عمل إلى ٩٠٪ " +
  "بنهاية عام ٢٠٢٧، مع الحفاظ على رضا المستفيدين. ويتولى قطاع التراخيص " +
  "والامتثال متابعة هذا المستهدف ورفع تقرير ربعي عنه.";

describe("verifyCitation", () => {
  it("verifies a quotation that is on the page", () => {
    expect(
      verifyCitation({
        quote: "رفع نسبة إنجاز طلبات التراخيص خلال خمسة أيام عمل",
        pageText: PAGE,
      }),
    ).toMatchObject({ status: "verified", match: "exact" });
  });

  it("verifies one that differs only in vowel marks, hamza form or tatweel", () => {
    expect(
      verifyCitation({
        quote: "رَفْعُ نسبة انجاز طلبات التراخيـــص خلال خمسة ايام عمل",
        pageText: PAGE,
      }),
    ).toMatchObject({ status: "verified", match: "exact" });
  });

  it("verifies one that differs only in digits, punctuation or line breaks", () => {
    expect(
      verifyCitation({
        quote: "إلى 90% بنهاية\nعام 2027 مع الحفاظ على رضا المستفيدين",
        pageText: PAGE,
      }),
    ).toMatchObject({ status: "verified", match: "exact" });
  });

  it("does not verify a quotation the page does not carry", () => {
    expect(
      verifyCitation({
        quote: "رفع نسبة إنجاز طلبات التراخيص خلال ثلاثة أيام عمل",
        pageText: PAGE,
      }),
    ).toEqual({ status: "unverified", reason: "not_on_page" });
  });

  it("does not verify words of the page put in another order", () => {
    expect(
      verifyCitation({
        quote: "طلبات التراخيص رفع نسبة إنجاز خلال خمسة أيام عمل",
        pageText: PAGE,
      }),
    ).toEqual({ status: "unverified", reason: "not_on_page" });
  });

  it("does not verify a quotation too short to mean anything", () => {
    // Three words or fewer are on nearly every page of a strategy.
    expect(verifyCitation({ quote: "قطاع التراخيص", pageText: PAGE })).toEqual({
      status: "unverified",
      reason: "too_short",
    });
  });

  it("takes the shortest quotation it accepts from its caller", () => {
    const short = { quote: "قطاع التراخيص والامتثال", pageText: PAGE };
    // Three words: refused by the default, accepted when the caller asks for
    // three, refused again when it asks for more than the page can settle.
    expect(verifyCitation(short)).toEqual({
      status: "unverified",
      reason: "too_short",
    });
    expect(verifyCitation({ ...short, minWords: 3 })).toMatchObject({
      status: "verified",
    });
    expect(
      verifyCitation({
        quote: "رفع نسبة إنجاز طلبات التراخيص",
        pageText: PAGE,
        minWords: 6,
      }),
    ).toEqual({ status: "unverified", reason: "too_short" });
  });

  it("refuses a shortest length that would accept anything", () => {
    expect(() =>
      verifyCitation({ quote: "قطاع", pageText: PAGE, minWords: 0 }),
    ).toThrow(/minWords/);
  });

  it("does not let a quotation match across a word boundary", () => {
    // "عمل إلى" is on the page; "مل إلى ٩٠٪ بنهاية عام" starts inside a word.
    expect(
      verifyCitation({ quote: "مل إلى ٩٠٪ بنهاية عام", pageText: PAGE }),
    ).toEqual({ status: "unverified", reason: "not_on_page" });
  });

  it("does not verify anything against an empty page", () => {
    expect(
      verifyCitation({
        quote: "رفع نسبة إنجاز طلبات التراخيص خلال خمسة أيام عمل",
        pageText: "",
      }),
    ).toEqual({ status: "unverified", reason: "not_on_page" });
  });
});

/**
 * A leading conjunction (design, criterion 6; approved 21 November 2026).
 *
 * Arabic writes "and" and "so" as one letter joined to the next word. A
 * person or a model quoting a sentence that opens with "ولا يوجد" will often
 * write "لا يوجد". The check allows for that, as narrowly as it can.
 */
describe("verifyCitation: a conjunction joined to the first word", () => {
  const page =
    "تعتمد المعالجة على إجراءات ورقية، ولا يوجد نظام موحد يربط الفروع. فلا تتاح للقيادة مقارنة الأداء.";

  it("verifies a quotation whose first word lost its waw", () => {
    expect(
      verifyCitation({ quote: "لا يوجد نظام موحد يربط", pageText: page }),
    ).toEqual({
      status: "verified",
      match: "leading_conjunction",
      // What is kept is what the page says, with its conjunction.
      quote: "ولا يوجد نظام موحد يربط",
    });
  });

  it("verifies a quotation whose first word lost its fa", () => {
    expect(
      verifyCitation({
        quote: "لا تتاح للقيادة مقارنة الأداء",
        pageText: page,
      }),
    ).toEqual({
      status: "verified",
      match: "leading_conjunction",
      quote: "فلا تتاح للقيادة مقارنة الأداء",
    });
  });

  it("says a word-for-word match is exact, and keeps the quotation as it is", () => {
    expect(
      verifyCitation({ quote: "ولا يوجد نظام موحد يربط", pageText: page }),
    ).toEqual({
      status: "verified",
      match: "exact",
      quote: "ولا يوجد نظام موحد يربط",
    });
  });

  it("prefers the exact match when the page holds both", () => {
    const both =
      "لا يوجد نظام موحد يربط الفروع. ولا يوجد نظام موحد يربط الأقسام.";
    expect(
      verifyCitation({ quote: "لا يوجد نظام موحد يربط", pageText: both }),
    ).toMatchObject({ match: "exact", quote: "لا يوجد نظام موحد يربط" });
  });

  it("does not allow for a lam, a ba or a kaf: those change what is said", () => {
    for (const [quote, text] of [
      ["القطاع يتولى متابعة المستهدف", "وهو للقطاع يتولى متابعة المستهدف"],
      ["النظام الموحد يربط الفروع", "تعمل بالنظام الموحد يربط الفروع"],
      ["المعتاد في الجهات الحكومية", "تسير كالمعتاد في الجهات الحكومية"],
    ] as const) {
      expect(verifyCitation({ quote, pageText: text })).toEqual({
        status: "unverified",
        reason: "not_on_page",
      });
    }
  });

  it("allows for it on the first word only", () => {
    // The third word lost its waw. Every word after the first is exact.
    expect(
      verifyCitation({
        quote: "إجراءات ورقية لا يوجد نظام",
        pageText: page,
      }),
    ).toEqual({ status: "unverified", reason: "not_on_page" });
  });

  it("does not allow for two conjunctions, or for one the quotation already has", () => {
    expect(
      verifyCitation({
        quote: "لا يوجد نظام موحد",
        pageText: "وفلا يوجد نظام موحد",
      }).status,
    ).toBe("unverified");
  });

  it("still asks for four words", () => {
    expect(verifyCitation({ quote: "لا يوجد نظام", pageText: page })).toEqual({
      status: "unverified",
      reason: "too_short",
    });
  });

  /**
   * The rule cannot tell a conjunction from a word whose own first letter is
   * a waw: "وزارة" is a ministry, not "and" joined to anything. So "زارة
   * الصحة تعلن الخطة" does verify on a page that says "وزارة الصحة تعلن
   * الخطة". What keeps that from being a hole is what is stored: the page's
   * own words, "وزارة الصحة تعلن الخطة". The quotation that is kept and shown
   * is on the page, word for word. Nothing the page does not say can be
   * attached to it this way.
   */
  it("keeps the page's own words where the first letter was part of the word", () => {
    expect(
      verifyCitation({
        quote: "زارة الصحة تعلن الخطة",
        pageText: "أمس وزارة الصحة تعلن الخطة الجديدة",
      }),
    ).toEqual({
      status: "verified",
      match: "leading_conjunction",
      quote: "وزارة الصحة تعلن الخطة",
    });
  });

  it("does not turn a one-letter first word into a match", () => {
    // "و" plus "ب" would be "وب", and nothing is quoted that way.
    expect(
      verifyCitation({
        quote: "ب نظام موحد يربط",
        pageText: "وب نظام موحد يربط الفروع",
      }).status,
    ).toBe("unverified");
  });

  it("keeps vowel marks and digits out of the way, as the exact check does", () => {
    expect(
      verifyCitation({
        quote: "لا يوجد نظام مُوحَّد",
        pageText: "وَلا يوجد نظام موحد",
      }),
    ).toMatchObject({ status: "verified", match: "leading_conjunction" });
  });
});
