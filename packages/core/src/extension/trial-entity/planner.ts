/**
 * The fixed provider the trial entity is shown with (design §9a).
 *
 * Until a real model is connected, the two planning agents answer with what
 * is written here: gaps and objectives drafted by hand for the two invented
 * sub-strategies in `documents/`. Everything else is the real path. The
 * runner parses this output with the agents' own schema, checks each
 * quotation against the page, and saves it as an AI draft that a person
 * reviews and leadership approves.
 *
 * It answers from what it is shown, not from what it expects:
 *
 * - a document is recognised by what its first page says, not by the title
 *   somebody typed at upload, and quotations name it by that typed title.
 *   The first page has to carry the sub-strategy's name, the invented
 *   body's name and the line that calls it fiction, all three, so a real
 *   body's document with the same name gets nothing;
 * - a sector that holds neither document gets no gaps;
 * - an objective is drafted only while the gap it answers is still there,
 *   and the report says which were left out and why;
 * - what the sector already holds under the same title is not drafted again.
 *
 * It cannot follow a title somebody rewrote. A gap renamed and then drafted
 * again comes back under its first title, which a model that reads the
 * existing gaps would not do.
 *
 * Its name is `fixed`, which is what a run is listed as a sample by.
 *
 * One quotation is a paraphrase on purpose. It comes back "unverified", and
 * shows the check that keeps such a quotation out of an approval request.
 */

import { normaliseArabic } from "@openokr/knowledge";
import type {
  AgentDocument,
  PlanningProvider,
  PlanningRequest,
  PlanningResult,
} from "@openokr/planning-agents";

type DocumentKey = "licensing" | "digital";

/** What each document's cover says, which is how it is recognised. */
const COVER: Record<DocumentKey, string> = {
  licensing: "الاستراتيجية الفرعية للتراخيص والامتثال",
  digital: "الاستراتيجية الفرعية للتحول الرقمي",
};

/** What both covers also say, and a real body's document does not. */
const TRIAL_MARKS = ["الجهة الحكومية التجريبية", "وثيقة خيالية"] as const;

interface Quote {
  readonly page: number;
  readonly quote: string;
}

interface GapDraft {
  readonly document: DocumentKey;
  readonly title: string;
  readonly description: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly domain: string;
  readonly evidence: readonly Quote[];
}

interface ObjectiveDraft {
  readonly document: DocumentKey;
  readonly title: string;
  readonly proposedTarget: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly objectiveType: "sectoral" | "operational";
  readonly agency: string;
  /** The title of the gap draft it answers. */
  readonly gap: string;
  readonly evidence: readonly Quote[];
}

const GAPS: readonly GapDraft[] = [
  {
    document: "licensing",
    title: "لا دليل موحد منشور لاشتراطات التراخيص",
    description:
      "اشتراطات كل نوع من التراخيص موزعة بين تعاميم وقرارات، فيقدم المستفيد طلبه ناقصاً ويُعاد إليه.",
    rationale:
      "الوثيقة تربط نقص المستندات بغياب الدليل، وتذكر أن أكثر من ربع الطلبات لا يكتمل من أول تقديم.",
    confidence: 85,
    domain: "التراخيص والامتثال",
    evidence: [
      { page: 3, quote: "لا يوجد دليل موحد منشور لاشتراطات التراخيص" },
      { page: 3, quote: "فلا يكتمل من أول تقديم إلا 72% من الطلبات" },
    ],
  },
  {
    document: "licensing",
    title: "خطوات يدوية في دراسة الطلب لا يُعرف زمنها",
    description:
      "ثلاث خطوات من دراسة طلب الترخيص تُنجز خارج النظام، فلا تُعرف الخطوة التي تؤخر الطلب.",
    rationale:
      "الوثيقة تعدّ هذه الخطوات السبب الثاني للتأخير، وتذكر أن زمن كل منها غير معروف.",
    confidence: 80,
    domain: "التراخيص والامتثال",
    evidence: [
      {
        page: 3,
        quote: "ثلاث خطوات من دراسة الطلب ما زالت تُنجز يدوياً خارج النظام",
      },
      { page: 6, quote: "الخطوات اليدوية الثلاث لا يُعرف زمن كل منها" },
    ],
  },
  {
    document: "licensing",
    title: "لا سجل موحد للشكاوى يجمع القنوات",
    description:
      "لكل قناة من القنوات الخمس سجلها وفريقها، فتُسجل الشكوى مرتين ويطول زمن معالجتها.",
    rationale:
      "متوسط زمن المعالجة لم يبلغ مستهدفه في أي شهر، والوثيقة تنسب ذلك إلى توزع الشكاوى بين القنوات.",
    confidence: 85,
    domain: "تجربة المستفيد",
    evidence: [
      { page: 5, quote: "لا يوجد سجل موحد للشكاوى يجمع القنوات الخمس" },
      {
        page: 5,
        quote: "بلغ متوسط زمن معالجة الشكاوى 8.1 يوم عمل في أكتوبر 2026",
      },
    ],
  },
  {
    document: "licensing",
    title: "قياس رضا المستفيدين لا يمكن التحقق منه",
    description:
      "نتيجة استبيان الرضا تُرفع دون توثيق حجم العينة وطريقة اختيارها.",
    rationale:
      "نتيجة لا تُعرف عينتها لا تُقارن بين ربع وآخر، ولا تصلح أساساً لمستهدف.",
    confidence: 75,
    domain: "تجربة المستفيد",
    evidence: [{ page: 5, quote: "لكن حجم العينة وطريقة اختيارها غير موثقين" }],
  },
  {
    document: "licensing",
    title: "الجولات الرقابية لا تُوجَّه بحسب الخطر",
    description:
      "المنشآت تُزار بالتناوب الجغرافي، فتُزار المنشأة كثيرة المخالفات بمعدل غيرها.",
    rationale:
      "نسبة الامتثال دون مستهدفها، وجزء كبير من الجولات يذهب إلى منشآت ملتزمة.",
    confidence: 80,
    domain: "التراخيص والامتثال",
    evidence: [
      {
        page: 4,
        quote: "تُختار المنشآت التي تُزار بالتناوب الجغرافي، لا بحسب درجة الخطر",
      },
    ],
  },
  {
    document: "licensing",
    title: "نقص المراقبين المؤهلين للمنشآت عالية الخطر",
    description: "عدد المراقبين المؤهلين لا يغطي المنشآت عالية الخطر.",
    rationale: "الرقابة بحسب الخطر تحتاج مراقبين متخصصين قبل أن تبدأ.",
    confidence: 55,
    domain: "رأس المال البشري",
    // A paraphrase, not the page's words, so the check marks it unverified.
    evidence: [
      {
        page: 6,
        quote: "عدد المراقبين المؤهلين لا يغطي المنشآت عالية الخطر",
      },
    ],
  },
  {
    document: "digital",
    title: "أتمتة الخدمات لا تتبع حجم الطلب",
    description:
      "أُتمتت خدمات قليلة الطلب لأنها أسهل، وبقيت الخدمات الأعلى طلباً تُكمل يدوياً.",
    rationale: "الوثيقة تذكر أن الخدمات غير المؤتمتة لم تُرتب بحسب الطلب عليها.",
    confidence: 85,
    domain: "التحول الرقمي",
    evidence: [
      {
        page: 3,
        quote: "لم تُرتب الخدمات غير المؤتمتة بحسب حجم الطلب عليها",
      },
      {
        page: 3,
        quote: "بلغ عدد الخدمات المؤتمتة بالكامل 33 خدمة من أصل 54",
      },
    ],
  },
  {
    document: "digital",
    title: "لا منصة تكامل موحدة بين الأنظمة",
    description:
      "الأنظمة تتبادل بياناتها بروابط ثنائية، وتعطل رابط واحد يوقف الخدمة التي تعتمد عليه.",
    rationale: "كل نظام جديد يحتاج رابطاً مع كل نظام يتبادل معه البيانات.",
    confidence: 90,
    domain: "التحول الرقمي",
    evidence: [{ page: 4, quote: "لا توجد منصة تكامل موحدة بين الأنظمة" }],
  },
  {
    document: "digital",
    title: "لا خط أساس لنسبة الأنظمة المتكاملة",
    description:
      "لم يُعتمد تعريف للنظام المتكامل، فلا يمكن قياس النسبة اليوم ولا وضع مستهدف موثوق لها.",
    rationale: "مستهدف بلا خط أساس لا يُعرف هل تحقق.",
    confidence: 85,
    domain: "التحول الرقمي",
    evidence: [{ page: 4, quote: "فلا يوجد خط أساس لنسبة الأنظمة المتكاملة" }],
  },
  {
    document: "digital",
    title: "لا موقع بديل عند تعطل الموقع الرئيسي",
    description:
      "أي عطل في الموقع الرئيسي توقف كامل، وخطة التعافي لم تُختبر منذ كتابتها.",
    rationale: "التوافر بلغ مستهدفه، لكنه بلا ضمان عند عطل كبير.",
    confidence: 80,
    domain: "التحول الرقمي",
    evidence: [
      {
        page: 5,
        quote: "لا يوجد موقع بديل تنتقل إليه الأنظمة عند تعطل الموقع الرئيسي",
      },
    ],
  },
  {
    document: "digital",
    title: "بيانات الجهة غير مصنفة وبلا مالك",
    description:
      "لا تُعرف مجموعات البيانات الحساسة من غيرها، ولا مالك مسمى يقرر من يطلع عليها.",
    rationale: "لا تُشارك بيانات ولا تُحمى قبل تصنيفها.",
    confidence: 80,
    domain: "التحول الرقمي",
    evidence: [{ page: 5, quote: "ولا يوجد مالك مسمى لكل مجموعة بيانات" }],
  },
];

const OBJECTIVES: readonly ObjectiveDraft[] = [
  {
    document: "licensing",
    title: "نشر اشتراطات كل أنواع التراخيص في دليل واحد",
    proposedTarget: "دليل منشور يغطي كل أنواع التراخيص بنهاية عام 2027",
    rationale:
      "نشر الاشتراطات في دليل واحد يجعل المستفيد يعرف المطلوب قبل التقديم.",
    confidence: 80,
    objectiveType: "operational",
    agency: "وكالة التراخيص",
    gap: "لا دليل موحد منشور لاشتراطات التراخيص",
    evidence: [
      { page: 9, quote: "جمع اشتراطات كل نوع من التراخيص في دليل واحد منشور" },
    ],
  },
  {
    document: "licensing",
    title: "قياس زمن كل خطوة في دراسة طلب الترخيص",
    proposedTarget: "زمن مسجل لكل خطوة في كل طلب بنهاية عام 2027",
    rationale: "تسجيل زمن كل خطوة يكشف الخطوة التي تؤخر الطلب.",
    confidence: 75,
    objectiveType: "operational",
    agency: "وكالة التراخيص",
    gap: "خطوات يدوية في دراسة الطلب لا يُعرف زمنها",
    evidence: [
      { page: 9, quote: "مسار آلي داخل النظام، مع تسجيل زمن كل خطوة" },
    ],
  },
  {
    document: "licensing",
    title: "نقل القنوات الخمس إلى سجل شكاوى واحد",
    proposedTarget: "القنوات الخمس كلها على السجل الموحد بنهاية عام 2027",
    rationale: "السجل الموحد يمنع تكرار الشكوى ويقصّر زمن معالجتها.",
    confidence: 80,
    objectiveType: "operational",
    agency: "وكالة تجربة المستفيد",
    gap: "لا سجل موحد للشكاوى يجمع القنوات",
    evidence: [
      {
        page: 9,
        quote: "سجل واحد يستقبل الشكاوى من القنوات الخمس ويتابعها حتى الإغلاق",
      },
    ],
  },
  {
    document: "licensing",
    title: "توثيق عينة استبيان الرضا مع كل نتيجة",
    proposedTarget: "100% من نتائج الاستبيان مرفقة بوثائق العينة في عام 2027",
    rationale: "نتيجة موثقة العينة يمكن التحقق منها ومقارنتها بين ربع وآخر.",
    confidence: 75,
    objectiveType: "operational",
    agency: "وكالة تجربة المستفيد",
    gap: "قياس رضا المستفيدين لا يمكن التحقق منه",
    evidence: [
      {
        page: 8,
        quote: "على أن تُرفق بكل نتيجة وثائق تبين حجم العينة وطريقة اختيارها",
      },
    ],
  },
  {
    document: "licensing",
    title: "اعتماد تصنيف المنشآت بحسب درجة الخطر",
    proposedTarget: "تصنيف معتمد في الربع الثاني من عام 2027",
    rationale: "لا تُوجَّه الجولات بحسب الخطر قبل أن تُعرف درجة خطر كل منشأة.",
    confidence: 75,
    objectiveType: "sectoral",
    agency: "وكالة الرقابة والامتثال",
    gap: "الجولات الرقابية لا تُوجَّه بحسب الخطر",
    evidence: [
      {
        page: 10,
        quote:
          "نموذج معتمد يحسب درجة خطر كل منشأة من سجل مخالفاتها ونوع نشاطها",
      },
      {
        page: 12,
        quote: "موعد نهائي لاعتماد التصنيف في الربع الثاني من عام 2027",
      },
    ],
  },
  {
    document: "digital",
    title: "ترتيب الخدمات غير المؤتمتة بحسب حجم الطلب عليها",
    proposedTarget: "ترتيب معتمد تُؤتمت الخدمات بحسبه طوال عام 2027",
    rationale: "ترتيب الأتمتة بحسب الطلب يرفع أثرها على المستفيد.",
    confidence: 80,
    objectiveType: "operational",
    agency: "وكالة التحول الرقمي",
    gap: "أتمتة الخدمات لا تتبع حجم الطلب",
    evidence: [
      {
        page: 9,
        quote:
          "ترتيب الخدمات غير المؤتمتة بحسب حجم الطلب، وأتمتة الأعلى طلباً أولاً",
      },
    ],
  },
  {
    document: "digital",
    title: "تشغيل منصة تكامل موحدة بين الأنظمة",
    proposedTarget: "منصة عاملة بنهاية عام 2027",
    rationale: "منصة واحدة تزيل نقاط التعطل المستقلة بين كل نظامين.",
    confidence: 80,
    objectiveType: "sectoral",
    agency: "وكالة التحول الرقمي",
    gap: "لا منصة تكامل موحدة بين الأنظمة",
    evidence: [{ page: 9, quote: "منصة واحدة تتبادل الأنظمة بياناتها عبرها" }],
  },
  {
    document: "digital",
    title: "اعتماد تعريف النظام المتكامل وقياس خط الأساس",
    proposedTarget: "تعريف معتمد وخط أساس مقيس في الربع الأول من عام 2027",
    rationale: "لا مستهدف يمكن التحقق منه لنسبة التكامل قبل تعريفها وقياسها.",
    confidence: 85,
    objectiveType: "operational",
    agency: "وكالة التحول الرقمي",
    gap: "لا خط أساس لنسبة الأنظمة المتكاملة",
    evidence: [
      {
        page: 10,
        quote: "اعتماد تعريف لما يُعد نظاماً متكاملاً، وقياس خط الأساس على أساسه",
      },
    ],
  },
  {
    document: "digital",
    title: "تأسيس موقع بديل واختبار خطة التعافي مرتين في السنة",
    proposedTarget: "موقع بديل عامل واختباران ناجحان في عام 2027",
    rationale: "الموقع البديل يحوّل العطل الكبير من توقف كامل إلى انتقال.",
    confidence: 75,
    objectiveType: "operational",
    agency: "وكالة التحول الرقمي",
    gap: "لا موقع بديل عند تعطل الموقع الرئيسي",
    evidence: [
      { page: 9, quote: "تأسيس موقع بديل واختبار خطة التعافي مرتين في السنة" },
    ],
  },
  {
    document: "digital",
    title: "تسمية مالك لكل مجموعة بيانات رئيسية",
    proposedTarget: "مالك مسمى لكل مجموعة بيانات رئيسية بنهاية عام 2027",
    rationale: "تسمية المالك شرط لتصنيف البيانات ومشاركتها وحمايتها.",
    confidence: 75,
    objectiveType: "operational",
    agency: "وكالة التخطيط الاستراتيجي",
    gap: "بيانات الجهة غير مصنفة وبلا مالك",
    evidence: [
      { page: 10, quote: "تصنيف بيانات الجهة وتسمية مالك لكل مجموعة منها" },
    ],
  },
];

const same = (a: string, b: string): boolean =>
  normaliseArabic(a).trim() === normaliseArabic(b).trim();

/** The title each recognised document was uploaded under. */
function recognise(
  documents: readonly AgentDocument[],
): Map<DocumentKey, string> {
  const found = new Map<DocumentKey, string>();
  for (const document of documents) {
    const cover = normaliseArabic(
      document.pages.find((page) => page.page === 1)?.text ?? "",
    );
    if (!TRIAL_MARKS.every((mark) => cover.includes(normaliseArabic(mark)))) {
      continue;
    }
    for (const key of Object.keys(COVER) as DocumentKey[]) {
      if (!found.has(key) && cover.includes(normaliseArabic(COVER[key]))) {
        found.set(key, document.title);
      }
    }
  }
  return found;
}

function generate(request: PlanningRequest): unknown {
  const known = recognise(request.documents);
  const recognised = new Set(known.values());
  const read = request.documents
    .filter((document) => recognised.has(document.title))
    .map((document) => document.title);
  const excluded = request.documents
    .filter((document) => !recognised.has(document.title))
    .map(
      (document) =>
        `«${document.title}»: المخرجات التجريبية مكتوبة لوثيقتي الجهة التجريبية فقط.`,
    );
  const cite = (title: string, evidence: readonly Quote[]) =>
    evidence.map((one) => ({
      document: title,
      page: one.page,
      quote: one.quote,
    }));

  if (request.agent === "gaps") {
    const gaps = [];
    for (const gap of GAPS) {
      const title = known.get(gap.document);
      if (
        title === undefined ||
        request.existingGaps.some((one) => same(one, gap.title))
      ) {
        continue;
      }
      gaps.push({
        title: gap.title,
        description: gap.description,
        rationale: gap.rationale,
        confidence: gap.confidence,
        domain: gap.domain,
        evidence: cite(title, gap.evidence),
      });
    }
    return { gaps, report: { read, excluded } };
  }

  const agencies = new Set(request.agencies);
  const objectives = [];
  for (const objective of OBJECTIVES) {
    const title = known.get(objective.document);
    if (
      title === undefined ||
      request.existingObjectives.some((one) => same(one, objective.title))
    ) {
      continue;
    }
    const gap = request.gaps.find((one) => same(one.title, objective.gap));
    if (!gap) {
      excluded.push(
        `«${objective.title}»: الفجوة التي يجيبها «${objective.gap}» ليست بين فجوات القطاع بعنوانها.`,
      );
      continue;
    }
    objectives.push({
      title: objective.title,
      proposedTarget: objective.proposedTarget,
      rationale: objective.rationale,
      confidence: objective.confidence,
      objectiveType: objective.objectiveType,
      // An agency the sector does not have is left out, and the runner then
      // keeps the objective on the sector itself.
      ...(agencies.has(objective.agency) ? { agency: objective.agency } : {}),
      // The gap's title as the sector holds it, which is what the runner
      // matches against.
      gaps: [gap.title],
      evidence: cite(title, objective.evidence),
    });
  }
  return { objectives, report: { read, excluded } };
}

/** The provider a preview instance runs the two agents on. */
export function trialEntityPlanner(): PlanningProvider {
  return {
    name: "fixed",
    fixed: true,
    generate: (request): Promise<PlanningResult> =>
      Promise.resolve({ output: generate(request), model: "fixed" }),
  };
}
