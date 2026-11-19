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
    ).toEqual({ status: "verified" });
  });

  it("verifies one that differs only in vowel marks, hamza form or tatweel", () => {
    expect(
      verifyCitation({
        quote: "رَفْعُ نسبة انجاز طلبات التراخيـــص خلال خمسة ايام عمل",
        pageText: PAGE,
      }),
    ).toEqual({ status: "verified" });
  });

  it("verifies one that differs only in digits, punctuation or line breaks", () => {
    expect(
      verifyCitation({
        quote: "إلى 90% بنهاية\nعام 2027 مع الحفاظ على رضا المستفيدين",
        pageText: PAGE,
      }),
    ).toEqual({ status: "verified" });
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
