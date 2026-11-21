/**
 * The trial entity: an invented government body the product is shown on.
 *
 * Everything here is fiction, written to the seed specification in
 * `docs/extension/SEED-AND-MODEL-INPUTS.md` part 2. No name, number or
 * sentence comes from a real body. The text is Arabic because the people the
 * product is shown to read Arabic, and the digits are Western on purpose.
 *
 * The specification is staged (design §12.3): this file holds what the
 * vertical slice can store today. An initiative's tier, source, action and
 * dependency analysis, and an indicator's status rules, wait for the phases
 * that add those fields.
 */

export const PLAN_YEAR = 2027;
export const PREVIOUS_YEAR = 2026;

/**
 * The day both cycles are created as of. The story is fixed in time: 2026 is
 * running with readings to October, and 2027 is being planned.
 */
export const STORY_DATE = "2026-11-01";

export const DOMAINS = [
  {
    name: "التحول الرقمي",
    description: "أتمتة الخدمات وتكامل الأنظمة ورفع جاهزية البنية التقنية.",
  },
  {
    name: "الاستدامة المالية",
    description: "تنمية الإيرادات الذاتية وضبط المصروفات التشغيلية.",
  },
  {
    name: "التراخيص والامتثال",
    description: "إصدار التراخيص في وقتها والرقابة على الالتزام باشتراطاتها.",
  },
  {
    name: "رأس المال البشري",
    description: "استقطاب الكفاءات وتطويرها وشغل الوظائف القيادية.",
  },
  {
    name: "تجربة المستفيد",
    description: "معالجة الشكاوى وقياس الرضا وتوحيد قنوات الخدمة.",
  },
] as const;

export type PersonKey =
  | "strategy"
  | "leadership"
  | "pmo"
  | "businessOwner"
  | "performance";

/** Which of the two roles the seed creates a person holds, if either. */
export type SeedRoleKey = "strategyOffice" | "leadership";

export interface Person {
  readonly key: PersonKey;
  readonly name: string;
  /** The role in the specification's own words, shown as the job title. */
  readonly title: string;
  /** The part before the at sign. The domain is reserved and never routable. */
  readonly mailbox: string;
  readonly role: SeedRoleKey | null;
}

/** Reserved by RFC 2606, so it can never be registered or receive mail. */
export const TRIAL_MAIL_DOMAIN = "tajriba.example";

export const PEOPLE: readonly Person[] = [
  {
    key: "strategy",
    name: "نورة السالم",
    title: "مكتب الاستراتيجية",
    mailbox: "strategy",
    role: "strategyOffice",
  },
  {
    key: "leadership",
    name: "خالد المنصور",
    title: "القيادة",
    mailbox: "leadership",
    role: "leadership",
  },
  {
    key: "pmo",
    name: "منى الفهد",
    title: "مكتب إدارة المشاريع",
    mailbox: "pmo",
    role: null,
  },
  {
    key: "businessOwner",
    name: "فهد الناصر",
    title: "مالك عمل (وكالة التراخيص)",
    mailbox: "licensing",
    role: null,
  },
  {
    key: "performance",
    name: "هند الراشد",
    title: "فريق الأداء",
    mailbox: "performance",
    role: null,
  },
];

/** The two roles design §13.2 approved. The seed creates them by name. */
export const ROLE_NAMES: Record<SeedRoleKey, string> = {
  strategyOffice: "مكتب الاستراتيجية",
  leadership: "القيادة",
};

type SectorKey = "services" | "support" | "planning";
export type AgencyKey =
  | "licensing"
  | "compliance"
  | "beneficiary"
  | "hr"
  | "finance"
  | "strategicPlanning"
  | "digital";
export type SpaceKey = SectorKey | AgencyKey;

export interface Sector {
  readonly key: SectorKey;
  readonly name: string;
  readonly mission: string;
  /** Who answers for the sector, when the cast has somebody who does. */
  readonly leadKey?: PersonKey;
  readonly agencies: readonly {
    readonly key: AgencyKey;
    readonly name: string;
    readonly mission: string;
    /** People who work in the agency, and so may edit what it owns. */
    readonly memberKeys?: readonly PersonKey[];
  }[];
}

export const SECTORS: readonly Sector[] = [
  {
    key: "services",
    name: "قطاع الخدمات والتراخيص",
    mission: "إصدار التراخيص والرقابة عليها وخدمة المستفيدين.",
    leadKey: "businessOwner",
    agencies: [
      {
        key: "licensing",
        name: "وكالة التراخيص",
        mission: "استقبال طلبات التراخيص ودراستها وإصدارها.",
        memberKeys: ["businessOwner"],
      },
      {
        key: "compliance",
        name: "وكالة الرقابة والامتثال",
        mission: "الجولات الرقابية ومتابعة الالتزام باشتراطات التراخيص.",
      },
      {
        key: "beneficiary",
        name: "وكالة تجربة المستفيد",
        mission: "معالجة الشكاوى وقياس رضا المستفيدين.",
      },
    ],
  },
  {
    key: "support",
    name: "قطاع الخدمات المساندة",
    mission: "الموارد البشرية والشؤون المالية.",
    agencies: [
      {
        key: "hr",
        name: "وكالة الموارد البشرية",
        mission: "الاستقطاب والتدريب وتطوير القيادات.",
      },
      {
        key: "finance",
        name: "وكالة الشؤون المالية",
        mission: "الميزانية والصرف والإقفال المالي.",
      },
    ],
  },
  {
    key: "planning",
    name: "قطاع التخطيط والتطوير",
    mission: "التخطيط الاستراتيجي والتحول الرقمي.",
    agencies: [
      {
        key: "strategicPlanning",
        name: "وكالة التخطيط الاستراتيجي",
        mission: "إعداد الخطة السنوية ومتابعة تنفيذها.",
      },
      {
        key: "digital",
        name: "وكالة التحول الرقمي",
        mission: "أتمتة الخدمات وتكامل الأنظمة وتشغيل المنصات.",
      },
    ],
  },
];

export type IndicatorKey = `k${number}`;

type Frequency = "monthly" | "quarterly" | "yearly";

/** One 2026 reading. The month is 1 to 12; a quarter is read at its end. */
interface Reading {
  readonly month: number;
  /** Null is a period that was due and has no value. */
  readonly actual: number | null;
  readonly remark?: string;
}

export interface Indicator {
  readonly key: IndicatorKey;
  readonly title: string;
  readonly unit: string;
  /**
   * The specification has two half-yearly indicators. The product has no
   * half-yearly frequency until phase (z) adds one, so they are seeded as
   * quarterly, which the product owner approved (design §12.5).
   */
  readonly frequency: Frequency;
  readonly halfYearlyInSpecification?: true;
  readonly direction: "higher_better" | "lower_better";
  readonly target2026: number;
  readonly target2027: number;
  /**
   * The agency that owns a standalone operational indicator. An indicator
   * that measures an objective has no space: it is reached through the
   * objective, and listing it under an agency would count it twice.
   */
  readonly agencyKey?: AgencyKey;
  readonly readings: readonly Reading[];
}

const monthly = (
  values: readonly (number | null)[],
  from = 1,
  remarks: Record<number, string> = {},
): Reading[] =>
  values.map((actual, index) => {
    const month = from + index;
    const remark = remarks[month];
    return { month, actual, ...(remark ? { remark } : {}) };
  });

const quarterly = (
  values: readonly (number | null)[],
  remarks: Record<number, string> = {},
): Reading[] =>
  values.map((actual, index) => {
    const month = (index + 1) * 3;
    const remark = remarks[month];
    return { month, actual, ...(remark ? { remark } : {}) };
  });

export const INDICATORS: readonly Indicator[] = [
  {
    // Met its target.
    key: "k1",
    title: "نسبة التراخيص الصادرة خلال اتفاقية مستوى الخدمة",
    unit: "%",
    frequency: "monthly",
    direction: "higher_better",
    target2026: 85,
    target2027: 90,
    readings: monthly([78, 80, 81, 83, 84, 85, 86, 86, 87, 88], 1, {
      9: "عدد الطلبات المنجزة خلال المدة 412 من أصل 474.",
      10: "عدد الطلبات المنجزة خلال المدة 431 من أصل 490.",
    }),
  },
  {
    key: "k2",
    title: "نسبة طلبات التراخيص المكتملة من أول تقديم",
    unit: "%",
    frequency: "quarterly",
    direction: "higher_better",
    target2026: 70,
    target2027: 75,
    readings: quarterly([66, 69, 72], {
      9: "اكتمل 936 طلباً من أول تقديم من أصل 1300.",
    }),
  },
  {
    // Did not meet its target: lower is better, and it stayed above.
    key: "k3",
    title: "متوسط زمن معالجة الشكاوى",
    unit: "يوم عمل",
    frequency: "monthly",
    direction: "lower_better",
    target2026: 6,
    target2027: 5,
    readings: monthly([9.5, 9.2, 9, 8.8, 8.9, 8.5, 8.4, 8.6, 8.2, 8.1], 1, {
      10: "أُغلقت 380 شكوى في الشهر، ومتوسط زمن معالجتها 8.1 يوم عمل.",
    }),
  },
  {
    // Partly met, because the supporting documents were not attached.
    key: "k4",
    title: "نسبة رضا المستفيدين عن معالجة الشكاوى",
    unit: "%",
    frequency: "quarterly",
    direction: "higher_better",
    target2026: 80,
    target2027: 85,
    readings: quarterly([71, 73, 74], {
      6: "نتيجة الاستبيان 73%. لم تُرفق الوثائق الداعمة لحجم العينة.",
      9: "نتيجة الاستبيان 74%. لم تُرفق الوثائق الداعمة لحجم العينة.",
    }),
  },
  {
    key: "k5",
    title: "نسبة الخدمات الرقمية المؤتمتة بالكامل",
    unit: "%",
    frequency: "quarterly",
    direction: "higher_better",
    target2026: 60,
    target2027: 80,
    readings: quarterly([52, 57, 61], {
      9: "أُتمتت 33 خدمة من أصل 54.",
    }),
  },
  {
    // Added in April through a change request, so nothing is due before it.
    key: "k6",
    title: "نسبة المعاملات المنجزة عبر القنوات الرقمية",
    unit: "%",
    frequency: "monthly",
    direction: "higher_better",
    target2026: 75,
    target2027: 85,
    readings: monthly([70, 72, 73, 75, 76, 77, 78], 4, {
      4: "أُضيف المؤشر في أبريل بطلب تغيير. ما قبله لم يحن موعد قياسه.",
    }),
  },
  {
    key: "k7",
    title: "نسبة توافر المنصات الرقمية",
    unit: "%",
    frequency: "monthly",
    direction: "higher_better",
    target2026: 99,
    target2027: 99.5,
    readings: monthly([
      99.1, 99.3, 99.2, 99.4, 99.0, 99.5, 99.6, 99.4, 99.3, 99.5,
    ]),
  },
  {
    // Partly met.
    key: "k8",
    title: "نسبة الامتثال في الجولات الرقابية",
    unit: "%",
    frequency: "quarterly",
    direction: "higher_better",
    target2026: 90,
    target2027: 95,
    readings: quarterly([79, 82, 84], {
      9: "التزمت 252 منشأة من أصل 300 منشأة شملتها الجولات.",
    }),
  },
  {
    // Its indicator guide is not approved yet, so no value can be accepted.
    key: "k9",
    title: "نسبة الأنظمة المتكاملة عبر منصة التكامل",
    unit: "%",
    frequency: "quarterly",
    halfYearlyInSpecification: true,
    direction: "higher_better",
    target2026: 50,
    target2027: 70,
    readings: quarterly([null, null, null], {
      3: "لم يُعتمد دليل المؤشر بعد.",
      6: "لم يُعتمد دليل المؤشر بعد.",
      9: "لم يُعتمد دليل المؤشر بعد.",
    }),
  },
  {
    // One due period has no reading: July.
    key: "k10",
    title: "متوسط زمن الرد على استفسارات المستفيدين",
    unit: "ساعة",
    frequency: "monthly",
    direction: "lower_better",
    target2026: 6,
    target2027: 4,
    agencyKey: "beneficiary",
    readings: [
      ...monthly([6.8, 6.5, 6.1, 5.9, 5.8, 5.6]),
      ...monthly([5.5, 5.4, 5.2], 8),
    ],
  },
  {
    key: "k11",
    title: "نسبة إنجاز خطة التدريب السنوية",
    unit: "%",
    frequency: "quarterly",
    direction: "higher_better",
    target2026: 70,
    target2027: 90,
    agencyKey: "hr",
    readings: quarterly([24, 48, 73], {
      9: "نُفذ 44 برنامجاً تدريبياً من أصل 60 في الخطة.",
    }),
  },
  {
    key: "k12",
    title: "نسبة صرف مستحقات الموردين خلال 30 يوماً",
    unit: "%",
    frequency: "quarterly",
    direction: "higher_better",
    target2026: 90,
    target2027: 95,
    agencyKey: "finance",
    readings: quarterly([88, 91, 93], {
      9: "صُرفت 558 مطالبة خلال المدة من أصل 600.",
    }),
  },
  {
    key: "k13",
    title: "نسبة إنجاز مبادرات الخطة التشغيلية",
    unit: "%",
    frequency: "quarterly",
    halfYearlyInSpecification: true,
    direction: "higher_better",
    target2026: 80,
    target2027: 85,
    agencyKey: "strategicPlanning",
    // Read once, at the half year, as the specification's frequency has it.
    readings: [
      {
        month: 6,
        actual: 41,
        remark: "قراءة النصف الأول: أُنجزت 9 مراحل من أصل 22 مخططة.",
      },
    ],
  },
  {
    // Yearly: nothing is due before the year ends.
    key: "k14",
    title: "مؤشر نضج التحول الرقمي",
    unit: "%",
    frequency: "yearly",
    direction: "higher_better",
    target2026: 70,
    target2027: 80,
    agencyKey: "digital",
    readings: [],
  },
];

export type ObjectiveKey = `s${number}` | `o${number}`;

export interface Objective {
  readonly key: ObjectiveKey;
  readonly title: string;
  readonly description: string;
  readonly spaceKey: SpaceKey;
  readonly objectiveType: "sectoral" | "operational";
  readonly priority: "priority" | "not_priority";
  readonly planStatus: "new" | "carried";
  readonly sourceKind: "sub_strategy" | "proposed" | "leadership_directive";
  readonly baselineUndetermined: boolean;
  /**
   * The indicators that measure it, and the share each carries. The product
   * keeps a weight to two decimals, so the specification's 0.333 is 0.33.
   */
  readonly measures: readonly {
    readonly indicatorKey: IndicatorKey;
    readonly weight: number;
    /**
     * The level 2026 ran at: its last reading, or its average where the
     * last reading already sits on the target. Left out when not known.
     */
    readonly baseline?: number;
  }[];
}

export const OBJECTIVES: readonly Objective[] = [
  {
    key: "s1",
    title: "رفع نسبة إصدار التراخيص خلال اتفاقية مستوى الخدمة إلى 90%",
    description:
      "يُصدر الترخيص خلال المدة المعلنة للمستفيد، ويُقاس على كل الطلبات المكتملة.",
    spaceKey: "services",
    objectiveType: "sectoral",
    priority: "priority",
    planStatus: "carried",
    sourceKind: "sub_strategy",
    baselineUndetermined: false,
    measures: [
      { indicatorKey: "k1", weight: 0.5, baseline: 88 },
      { indicatorKey: "k2", weight: 0.5, baseline: 72 },
    ],
  },
  {
    key: "s2",
    title: "خفض متوسط زمن معالجة الشكاوى إلى 5 أيام عمل",
    description:
      "تُغلق الشكوى من أول استلامها حتى إبلاغ المستفيد بالنتيجة خلال خمسة أيام عمل.",
    spaceKey: "services",
    objectiveType: "sectoral",
    priority: "priority",
    planStatus: "new",
    sourceKind: "sub_strategy",
    baselineUndetermined: false,
    measures: [
      { indicatorKey: "k3", weight: 0.5, baseline: 8.1 },
      { indicatorKey: "k4", weight: 0.5, baseline: 74 },
    ],
  },
  {
    key: "s3",
    title: "رفع نسبة الخدمات الرقمية المؤتمتة بالكامل إلى 80%",
    description:
      "تُنجز الخدمة من الطلب إلى الإصدار دون تدخل يدوي ودون مراجعة فرع.",
    spaceKey: "planning",
    objectiveType: "sectoral",
    priority: "priority",
    planStatus: "new",
    sourceKind: "sub_strategy",
    baselineUndetermined: false,
    measures: [
      { indicatorKey: "k5", weight: 0.33, baseline: 61 },
      { indicatorKey: "k6", weight: 0.33, baseline: 78 },
      { indicatorKey: "k7", weight: 0.33, baseline: 99.3 },
    ],
  },
  {
    // The one sector objective no initiative serves, for the coverage warning.
    key: "s4",
    title: "رفع نسبة الامتثال في الجولات الرقابية إلى 95%",
    description:
      "تلتزم المنشآت المرخصة باشتراطات تراخيصها عند الجولة الرقابية الأولى.",
    spaceKey: "services",
    objectiveType: "sectoral",
    priority: "not_priority",
    planStatus: "carried",
    sourceKind: "sub_strategy",
    baselineUndetermined: false,
    measures: [{ indicatorKey: "k8", weight: 1, baseline: 84 }],
  },
  {
    key: "s5",
    title: "رفع نسبة الأنظمة المتكاملة عبر منصة التكامل إلى 70%",
    description:
      "تتبادل أنظمة الجهة بياناتها عبر منصة واحدة بدل الربط الثنائي بين كل نظامين.",
    spaceKey: "planning",
    objectiveType: "sectoral",
    priority: "not_priority",
    planStatus: "new",
    sourceKind: "sub_strategy",
    baselineUndetermined: true,
    measures: [{ indicatorKey: "k9", weight: 1 }],
  },
  {
    key: "o1",
    title: "رفع نسبة شغل الوظائف القيادية المعتمدة إلى 90%",
    description: "تُشغل الوظائف القيادية المعتمدة في الهيكل بمكلفين أو معينين.",
    spaceKey: "hr",
    objectiveType: "operational",
    priority: "not_priority",
    planStatus: "new",
    sourceKind: "proposed",
    baselineUndetermined: true,
    measures: [],
  },
  {
    key: "o2",
    title: "إقفال الحسابات الشهرية خلال 7 أيام عمل",
    description:
      "تُقفل حسابات الشهر وتُرفع تقاريره خلال سبعة أيام عمل من نهايته.",
    spaceKey: "finance",
    objectiveType: "operational",
    priority: "not_priority",
    planStatus: "new",
    sourceKind: "leadership_directive",
    baselineUndetermined: false,
    measures: [],
  },
];

export interface Initiative {
  readonly title: string;
  readonly description: string;
  readonly agencyKey: AgencyKey;
  readonly ownerKey: PersonKey;
  /** The objective it serves. Null serves an agency's own work. */
  readonly objectiveKey: ObjectiveKey | null;
  /** Started in 2026 and still running into the plan year. */
  readonly carried: boolean;
}

export const INITIATIVES: readonly Initiative[] = [
  {
    title: "أتمتة إجراءات إصدار التراخيص",
    description: "تحويل خطوات دراسة الطلب وإصدار الترخيص إلى مسار آلي.",
    agencyKey: "licensing",
    ownerKey: "businessOwner",
    objectiveKey: "s1",
    carried: true,
  },
  {
    // Close to the one above on purpose, for the duplicate warning.
    title: "رقمنة إجراءات إصدار التراخيص",
    description: "تحويل خطوات إصدار الترخيص الورقية إلى مسار رقمي كامل.",
    agencyKey: "licensing",
    ownerKey: "businessOwner",
    objectiveKey: "s1",
    carried: false,
  },
  {
    title: "إعادة هندسة رحلة طلب الترخيص",
    description: "اختصار خطوات الطلب وحذف المستندات المكررة.",
    agencyKey: "licensing",
    ownerKey: "businessOwner",
    objectiveKey: "s1",
    carried: true,
  },
  {
    title: "تطوير دليل اشتراطات التراخيص الموحد",
    description: "دليل واحد منشور يجمع اشتراطات كل نوع من التراخيص.",
    agencyKey: "compliance",
    ownerKey: "pmo",
    objectiveKey: "s1",
    carried: false,
  },
  {
    title: "إنشاء مركز موحد لمعالجة الشكاوى",
    description: "مركز واحد يستقبل الشكاوى من كل القنوات ويتابعها حتى الإغلاق.",
    agencyKey: "beneficiary",
    ownerKey: "pmo",
    objectiveKey: "s2",
    carried: true,
  },
  {
    title: "تطوير نظام قياس رضا المستفيدين",
    description: "استبيان آلي بعد إغلاق كل شكوى، مع توثيق حجم العينة.",
    agencyKey: "beneficiary",
    ownerKey: "pmo",
    objectiveKey: "s2",
    carried: false,
  },
  {
    title: "تدريب موظفي الصف الأول على معالجة الشكاوى",
    description: "برنامج تدريبي لموظفي الاستقبال على التصنيف والتصعيد.",
    agencyKey: "beneficiary",
    ownerKey: "pmo",
    objectiveKey: "s2",
    carried: false,
  },
  {
    title: "أتمتة الخدمات ذات الأولوية",
    description: "أتمتة الخدمات الأعلى طلباً أولاً، من الطلب إلى الإصدار.",
    agencyKey: "digital",
    ownerKey: "pmo",
    objectiveKey: "s3",
    carried: true,
  },
  {
    title: "تطوير بوابة الخدمات الموحدة",
    description: "بوابة واحدة يدخل منها المستفيد إلى كل خدمات الجهة.",
    agencyKey: "digital",
    ownerKey: "pmo",
    objectiveKey: "s3",
    carried: true,
  },
  {
    title: "رفع جاهزية البنية التقنية واستمرارية الأعمال",
    description: "موقع بديل وخطة تعافٍ تُختبر مرتين في السنة.",
    agencyKey: "digital",
    ownerKey: "pmo",
    objectiveKey: "s3",
    carried: false,
  },
  {
    title: "برنامج التحول إلى القنوات الرقمية",
    description: "توجيه المستفيدين من الفروع إلى القنوات الرقمية.",
    agencyKey: "digital",
    ownerKey: "pmo",
    objectiveKey: "s3",
    carried: false,
  },
  {
    title: "بناء منصة التكامل بين الأنظمة",
    description: "منصة واحدة تتبادل الأنظمة بياناتها عبرها.",
    agencyKey: "digital",
    ownerKey: "pmo",
    objectiveKey: "s5",
    carried: false,
  },
  {
    title: "حوكمة البيانات وتصنيفها",
    description: "تصنيف بيانات الجهة وتحديد مالك لكل مجموعة منها.",
    agencyKey: "strategicPlanning",
    ownerKey: "pmo",
    // The sub-strategy has it serve its data objective, which is not
    // one of the plan's sector objectives.
    objectiveKey: null,
    carried: true,
  },
  {
    title: "برنامج تطوير القيادات",
    description: "مسار تأهيل للصف الثاني لشغل الوظائف القيادية.",
    agencyKey: "hr",
    ownerKey: "pmo",
    objectiveKey: null,
    carried: false,
  },
  {
    title: "أتمتة إجراءات الإقفال المالي",
    description: "مطابقات آلية تختصر مدة إقفال حسابات الشهر.",
    agencyKey: "finance",
    ownerKey: "pmo",
    objectiveKey: null,
    carried: false,
  },
];
