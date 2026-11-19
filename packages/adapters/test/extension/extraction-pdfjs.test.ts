import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PdfjsTextExtractor } from "../../src/index.ts";

/**
 * `strategy-sample.pdf` is an invented four-page strategy for "the trial
 * government entity", printed from `strategy-sample.html` beside it. Nothing
 * in it comes from a real document.
 */
const FIXTURES = join(import.meta.dirname, "../fixtures/extension");
const sample = () => readFileSync(join(FIXTURES, "strategy-sample.pdf"));

async function pagesOf(body: Buffer): Promise<readonly string[]> {
  const result = await new PdfjsTextExtractor().extract(body);
  if (result.kind !== "pages") {
    throw new Error(`expected pages, got ${result.kind}`);
  }
  return result.pages.map((page) => page.text);
}

/**
 * Without vowel marks. A font may draw two letters as one joined glyph, and a
 * mark on that glyph cannot be placed on one letter or the other, so the
 * letters are compared exactly and the marks by a test of their own.
 */
const bare = (text: string | undefined) =>
  (text ?? "").normalize("NFKC").replace(/\p{M}/gu, "");

describe("PdfjsTextExtractor on an Arabic document", () => {
  it("returns every page, numbered from one", async () => {
    const result = await new PdfjsTextExtractor().extract(sample());
    expect(result.kind).toBe("pages");
    if (result.kind === "pages") {
      expect(result.pages.map((page) => page.page)).toEqual([1, 2, 3, 4]);
    }
  });

  it("reads a page in the order a person does, heading first", async () => {
    const [first] = await pagesOf(sample());
    expect(bare(first)).toBe(
      bare(
        [
          "الخطة الاستراتيجية للجهة الحكومية التجريبية",
          "وثيقة خيالية لأغراض الاختبار. لا تمثل أي جهة حقيقية.",
          "رؤية الجهة ورسالتها للأعوام 2026 إلى 2030: خدمات ترخيص ميسّرة وموثوقة لكل مستفيد.",
        ].join("\n\n"),
      ),
    );
  });

  it("keeps the two letters of a lam-alef in their order", async () => {
    const pages = await pagesOf(sample());
    const all = pages.join("\n");
    expect(all).toContain("لا تمثل");
    expect(all).toContain("والامتثال");
    expect(all).toContain("خلال خمسة أيام");
    // The signature of a reversed lam-alef: a word opening with two alefs.
    expect(all).not.toMatch(/(^|\s)اال/);
  });

  it("keeps numbers, percent signs and wrapped lines of a paragraph", async () => {
    const [, second] = await pagesOf(sample());
    expect(second?.replace(/\n/g, " ")).toContain(
      "تهدف الجهة إلى رفع نسبة إنجاز طلبات التراخيص خلال خمسة أيام عمل إلى 90% بنهاية عام 2027، مع الحفاظ على رضا المستفيدين.",
    );
  });

  it("keeps Latin words, marks and brackets right inside Arabic text", async () => {
    const [, , third] = await pagesOf(sample());
    const flat = bare(third).replace(/\n/g, " ");
    expect(flat).toContain("Digital services (KPI 3)");
    expect(flat).toContain(
      bare(
        "تسعى الجهة إلى أن تُقدَّم 80% من الخدمات عبر القنوات الرقمية، وأن يبلغ مؤشر Net Promoter Score قيمة 60 نقطة.",
      ),
    );
    expect(flat).toContain(
      "ولا يتجاوز زمن انتظار المستفيد في الفروع (15) دقيقة في المتوسط.",
    );
  });

  it("reads two columns one after the other, the right one first", async () => {
    const [, , , fourth] = await pagesOf(sample());
    const flat = bare(fourth).replace(/\s+/g, " ");
    expect(flat).toBe(
      bare(
        [
          "التحديات والفرص",
          "أولاً: تعتمد معالجة الطلبات اليوم على إجراءات ورقية في ثلاثة فروع، ولا يوجد نظام موحد يربط الفروع بالمركز الرئيس، فتتأخر الطلبات التي تحتاج إلى أكثر من موافقة واحدة.",
          "ثانياً: أظهر استطلاع المستفيدين أن أغلب الشكاوى تتعلق بغموض المتطلبات لا بطول المدة، وهذه فرصة لتبسيط الأدلة الإرشادية ونشرها في القنوات الرقمية قبل نهاية العام.",
          "ثالثاً: لا تملك الجهة حالياً لوحة متابعة واحدة لمؤشرات القطاعات، فيُعدّ كل قطاع تقريره بصيغته الخاصة، ولا تتاح للقيادة مقارنة الأداء بين القطاعات إلا مرة في العام.",
        ].join(" "),
      ),
    );
  });

  it("keeps every vowel mark inside a word", async () => {
    const pages = await pagesOf(sample());
    const all = pages.join("\n");
    // The fixture has a shadda, two dammas and four tanweens the font names.
    expect(all.match(/\p{M}/gu)?.length ?? 0).toBeGreaterThanOrEqual(7);
    // None stands alone or opens a word, which is what a mark left off its
    // letter looks like.
    expect(all).not.toMatch(/(^|\s)\p{M}/mu);
  });
});

describe("PdfjsTextExtractor on files it cannot use", () => {
  it("reports a page with no text as an empty page, not as a failure", async () => {
    const result = await new PdfjsTextExtractor().extract(
      readFileSync(join(FIXTURES, "blank.pdf")),
    );
    expect(result).toEqual({ kind: "pages", pages: [{ page: 1, text: "" }] });
  });

  it("answers unreadable for bytes that are not a PDF", async () => {
    const result = await new PdfjsTextExtractor().extract(
      Buffer.from("this is a text file with a .pdf name"),
    );
    expect(result).toEqual({ kind: "unreadable" });
  });

  it("answers unreadable for a PDF cut off halfway", async () => {
    const whole = sample();
    const result = await new PdfjsTextExtractor().extract(
      whole.subarray(0, Math.floor(whole.length / 2)),
    );
    expect(result).toEqual({ kind: "unreadable" });
  });

  it("does not change the bytes it was given", async () => {
    const body = sample();
    const before = Buffer.from(body);
    await new PdfjsTextExtractor().extract(body);
    expect(body.equals(before)).toBe(true);
  });
});
