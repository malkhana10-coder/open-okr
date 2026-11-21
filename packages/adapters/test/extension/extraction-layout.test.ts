import { describe, expect, it } from "vitest";
import { type Glyph, pageText } from "../../src/extension/page-layout.ts";

/**
 * Glyphs laid out by hand, the way a PDF draws them: each with the character
 * its font says it is, where its origin sits and where the next one starts.
 * A PDF draws a line from left to right whatever language it is in, so an
 * Arabic word arrives last letter first.
 */
const SIZE = 10;
const WIDTH = 6;

/** Draws `visual` from `x`, one glyph per character, left to right. */
function draw(visual: string, x: number, y: number): Glyph[] {
  return [...visual].map((u, index) => ({
    u,
    x: x + index * WIDTH,
    x2: x + (index + 1) * WIDTH,
    y,
    fs: SIZE,
  }));
}

/** An Arabic string as it is drawn: reversed, so its first letter is rightmost. */
const drawn = (logical: string) => [...logical].reverse().join("");

describe("page layout: one line", () => {
  it("reads an Arabic line right to left", () => {
    expect(pageText(draw(drawn("خطة الجهة"), 100, 700))).toBe("خطة الجهة");
  });

  it("reads a Latin line left to right", () => {
    expect(pageText(draw("Digital services", 100, 700))).toBe(
      "Digital services",
    );
  });

  it("keeps Latin words in their own order inside an Arabic line", () => {
    // Logical: "مؤشر Net Score قيمة". Drawn: قيمة reversed, the Latin run as
    // written, مؤشر reversed.
    const visual = `${drawn("قيمة")} Net Score ${drawn("مؤشر")}`;
    expect(pageText(draw(visual, 100, 700))).toBe("مؤشر Net Score قيمة");
  });

  it("reads the Arabic words right to left on a line that is mostly Latin, when the page is Arabic", () => {
    // The second line of an Arabic paragraph can hold more Latin than Arabic.
    const first = draw(drawn("تسعى الجهة إلى أن يبلغ مؤشر"), 100, 700);
    const second = draw(`${drawn("قيمة")} Net Promoter Score`, 100, 680);
    expect(pageText([...first, ...second])).toBe(
      "تسعى الجهة إلى أن يبلغ مؤشر\nNet Promoter Score قيمة",
    );
  });

  it("puts the percent sign after its number in Arabic text, where it is drawn before it", () => {
    // After Arabic letters a browser and a typesetter both draw "90%" with
    // the sign on the left of the digits.
    const visual = `${drawn("بنهاية")} %90 ${drawn("إلى")}`;
    expect(pageText(draw(visual, 100, 700))).toBe("إلى 90% بنهاية");
  });

  it("reads a range of years in Arabic text from the right", () => {
    const visual = `${drawn("للأعوام")} 2030-2026 ${drawn("خطة")}`;
    expect(pageText(draw(visual, 100, 700))).toBe("خطة 2026-2030 للأعوام");
  });

  it("keeps a percent sign and a range as written on a Latin line", () => {
    expect(pageText(draw("Growth of 90% in 2026-2030", 100, 700))).toBe(
      "Growth of 90% in 2026-2030",
    );
  });

  it("keeps a decimal number whole", () => {
    const visual = `${drawn("درجة")} 6.34 ${drawn("من")}`;
    expect(pageText(draw(visual, 100, 700))).toBe("من 6.34 درجة");
  });

  it("adds no space before punctuation that follows a number", () => {
    const visual = `${drawn("خدمات")} :2030 ${drawn("إلى")}`;
    expect(pageText(draw(visual, 100, 700))).toBe("إلى 2030: خدمات");
  });

  it("turns the brackets around a number in an Arabic line the right way", () => {
    // A font stores a bracket by its shape. In right-to-left text the opening
    // bracket is drawn with the closing shape, on the right of what it holds.
    const visual = `${drawn("دقيقة")} (15) ${drawn("الفروع")}`;
    expect(pageText(draw(visual, 100, 700))).toBe("الفروع (15) دقيقة");
  });

  it("leaves the brackets inside a Latin run as they are", () => {
    const visual = `${drawn("قيمة المؤشر")} Net (NPS) ${drawn("يبلغ مؤشر")}`;
    expect(pageText(draw(visual, 100, 700))).toBe(
      "يبلغ مؤشر Net (NPS) قيمة المؤشر",
    );
  });

  it("adds a space where the drawing leaves a gap and the file has none", () => {
    const left = draw(drawn("الجهة"), 100, 700);
    const right = draw(drawn("خطة"), 100 + 5 * WIDTH + 4, 700);
    expect(pageText([...left, ...right])).toBe("خطة الجهة");
  });
});

describe("page layout: vowel marks", () => {
  it("gives a mark to the letter it is drawn on, not the one before it", () => {
    // "ميسّرة": the shadda belongs to the seen. A mark has no width, and in a
    // right-to-left run its origin is the left edge of its own letter, which
    // is also the right edge of the letter before.
    const letters = draw(drawn("ميسرة"), 100, 700);
    const seen = letters.find((glyph) => glyph.u === "س");
    const shadda: Glyph = {
      u: "ّ",
      x: seen?.x ?? 0,
      x2: seen?.x ?? 0,
      y: 700,
      fs: SIZE,
    };
    expect(pageText([...letters, shadda])).toBe("ميسّرة");
  });

  it("gives a mark drawn a little above the line to its letter, not a line of its own", () => {
    const letters = draw(drawn("حاليا لوحة"), 100, 700);
    // Drawn last letter first, so the first alef drawn is the word's last.
    const alef = letters.filter((glyph) => glyph.u === "ا")[0];
    const tanween: Glyph = {
      u: "ً",
      x: alef?.x ?? 0,
      x2: alef?.x ?? 0,
      y: 704,
      fs: SIZE,
    };
    expect(pageText([...letters, tanween])).toBe("حالياً لوحة");
  });

  it("reads a shadda and fatha stored as one isolated character as marks on the letter", () => {
    // U+FC60 is spelled "space, shadda, fatha". The space is not drawn.
    const letters = draw(drawn("تقدم"), 100, 700);
    const dal = letters.find((glyph) => glyph.u === "د");
    const both: Glyph = {
      u: "\uFC60",
      x: dal?.x ?? 0,
      x2: dal?.x ?? 0,
      y: 703,
      fs: SIZE,
    };
    expect(pageText([...letters, both])).toBe(
      "تقد\u0651\u064Eم".normalize("NFKC"),
    );
  });
});

describe("page layout: glyphs with no character", () => {
  it("drops a glyph the font names with a control character, and opens no gap for it", () => {
    const letters = draw(drawn("تقدم"), 100, 700);
    const dal = letters.find((glyph) => glyph.u === "د");
    const unnamed: Glyph = {
      u: "\u0000",
      x: (dal?.x ?? 0) + 1,
      x2: (dal?.x ?? 0) + 1,
      y: 703,
      fs: SIZE,
    };
    expect(pageText([...letters, unnamed])).toBe("تقدم");
  });
});

describe("page layout: text drawn twice", () => {
  it("reads once a line drawn twice to look bold", () => {
    // A file can fake a bold face by drawing the same text again a hair to
    // the side.
    const once = draw(drawn("حصتها من الناتج"), 100, 700);
    const again = once.map((glyph) => ({
      ...glyph,
      x: glyph.x + 0.3,
      x2: glyph.x2 + 0.3,
    }));
    expect(pageText([...once, ...again])).toBe("حصتها من الناتج");
  });

  it("keeps a doubled letter that is really written twice", () => {
    expect(pageText(draw("Assess 100", 100, 700))).toBe("Assess 100");
  });
});

describe("page layout: blocks and columns", () => {
  it("puts a heading before the paragraph under it", () => {
    const heading = draw(drawn("الخطة الاستراتيجية"), 300, 760).map(
      (glyph) => ({
        ...glyph,
        fs: 16,
      }),
    );
    const body = [
      ...draw(drawn("وثيقة خيالية لأغراض الاختبار"), 240, 730),
      ...draw(drawn("رؤية الجهة ورسالتها"), 294, 700),
    ];
    expect(pageText([...body, ...heading])).toBe(
      "الخطة الاستراتيجية\n\nوثيقة خيالية لأغراض الاختبار\n\nرؤية الجهة ورسالتها",
    );
  });

  it("reads the right column to its end before the left one on an Arabic page", () => {
    const lines = [
      ["أول العمود الأيمن هنا", "أول العمود الأيسر هنا"],
      ["وسط العمود الأيمن هنا", "وسط العمود الأيسر هنا"],
      ["آخر العمود الأيمن هنا", "آخر العمود الأيسر هنا"],
    ] as const;
    const glyphs = lines.flatMap(([right, left], row) => [
      ...draw(drawn(left), 60, 700 - row * 14),
      ...draw(drawn(right), 320, 700 - row * 14),
    ]);
    expect(pageText(glyphs)).toBe(
      [
        "أول العمود الأيمن هنا\nوسط العمود الأيمن هنا\nآخر العمود الأيمن هنا",
        "أول العمود الأيسر هنا\nوسط العمود الأيسر هنا\nآخر العمود الأيسر هنا",
      ].join("\n\n"),
    );
  });

  it("keeps a paragraph that starts low in the right column before the left column", () => {
    // Two paragraphs on the right, two on the left, none level with another.
    const right = [
      ...draw(drawn("الفقرة الأولى يمين"), 320, 700),
      ...draw(drawn("تتمة الأولى يمين"), 332, 686),
      ...draw(drawn("الفقرة الثانية يمين"), 314, 650),
      ...draw(drawn("تتمة الثانية يمين"), 326, 636),
    ];
    const left = [
      ...draw(drawn("الفقرة الثالثة يسار"), 60, 693),
      ...draw(drawn("تتمة الثالثة يسار"), 72, 679),
      ...draw(drawn("الفقرة الرابعة يسار"), 60, 643),
    ];
    const text = pageText([...left, ...right]);
    const order = ["الأولى", "الثانية", "الثالثة", "الرابعة"].map((word) =>
      text.indexOf(`الفقرة ${word}`),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index >= 0)).toBe(true);
  });

  it("returns an empty string for a page with nothing drawn", () => {
    expect(pageText([])).toBe("");
  });
});
