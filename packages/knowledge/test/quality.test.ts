import { describe, expect, it } from "vitest";
import {
  extractionQuality,
  isLowQuality,
  LOW_QUALITY_SHARE,
  MIN_WORDS_TO_JUDGE,
} from "../src/index.ts";

/**
 * How well a page came out of its file, measured without a reference
 * (docs/extension/design/b0-vertical-slice.md §9 criterion 19).
 */
describe("extractionQuality", () => {
  it("counts Arabic words and finds nothing suspect in clean text", () => {
    expect(
      extractionQuality("تهدف الجهة إلى رفع نسبة إنجاز طلبات التراخيص."),
    ).toEqual({ arabicWords: 8, suspectWords: 0 });
  });

  it("does not count numbers, Latin words or punctuation as Arabic words", () => {
    expect(extractionQuality("بلغ المؤشر 90% في Net Promoter Score.")).toEqual({
      arabicWords: 3,
      suspectWords: 0,
    });
  });

  it("flags a word holding a letter that lost its dots", () => {
    // U+066E is the dotless skeleton of ba, ta and tha. U+06A1 of fa.
    expect(extractionQuality("الٮرخيص ڡي الجهة")).toEqual({
      arabicWords: 3,
      suspectWords: 2,
    });
  });

  it("flags an alef maqsura in the middle of a word, where a dotted ya belongs", () => {
    expect(extractionQuality("الجهة فىها")).toEqual({
      arabicWords: 2,
      suspectWords: 1,
    });
  });

  it("leaves an alef maqsura at the end of a word alone", () => {
    expect(extractionQuality("إلى مستوى أعلى").suspectWords).toBe(0);
  });

  it("flags a Latin letter inside an Arabic word", () => {
    expect(extractionQuality("الترQخيص سليم")).toEqual({
      arabicWords: 2,
      suspectWords: 1,
    });
  });

  it("flags a word that opens with a reversed lam-alef", () => {
    expect(extractionQuality("االستراتيجية األولى اإلنجاز")).toEqual({
      arabicWords: 3,
      suspectWords: 3,
    });
  });

  it("counts a word once however many faults it has", () => {
    expect(extractionQuality("االٮرخيص").suspectWords).toBe(1);
  });

  it("is not thrown by vowel marks, tatweel or presentation forms", () => {
    expect(extractionQuality("تُقدَّم الخدمـــات ﻻ تمثل")).toEqual({
      arabicWords: 4,
      suspectWords: 0,
    });
  });

  it("returns zeros for an empty page", () => {
    expect(extractionQuality("")).toEqual({ arabicWords: 0, suspectWords: 0 });
  });
});

describe("isLowQuality", () => {
  it("is three in a hundred by default, and thirty words before judging", () => {
    expect(LOW_QUALITY_SHARE).toBe(0.03);
    expect(MIN_WORDS_TO_JUDGE).toBe(30);
  });

  it("is low above the threshold and not at it", () => {
    expect(isLowQuality({ arabicWords: 100, suspectWords: 4 })).toBe(true);
    expect(isLowQuality({ arabicWords: 100, suspectWords: 3 })).toBe(false);
  });

  it("does not judge a page with too few words, where one word would decide", () => {
    expect(isLowQuality({ arabicWords: 29, suspectWords: 29 })).toBe(false);
    expect(isLowQuality({ arabicWords: 30, suspectWords: 2 })).toBe(true);
  });

  it("takes another threshold and another minimum from its caller", () => {
    const counts = { arabicWords: 20, suspectWords: 2 };
    expect(isLowQuality(counts, { share: 0.05, minWords: 10 })).toBe(true);
    expect(isLowQuality(counts, { share: 0.1, minWords: 10 })).toBe(false);
  });

  it("refuses a threshold that is not a share", () => {
    expect(() =>
      isLowQuality({ arabicWords: 100, suspectWords: 1 }, { share: 3 }),
    ).toThrow(RangeError);
  });
});
