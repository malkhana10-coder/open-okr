# التعديلات على نواة open-okr

كل تعديل على ملف موجود في المشروع الأصلي يُسجَّل هنا مع سببه، حتى يسهل جلب تحديثات الأصل وحل التعارضات. الملفات الجديدة كلياً لا تُسجَّل إلا إن كانت داخل حزمة من حزم النواة.

## 0. القاعدة: أين يسكن كود الامتداد

قرار صاحب المنتج بتاريخ 2026-11-19 (التفصيل في [`design/b0-vertical-slice.md`](design/b0-vertical-slice.md) القسم 6.1). **استثناء مقصود من القاعدة 2 في برومبت البناء:** سجل الإجراءات في الأصل ثابت وقت الترجمة، فتعريفات إجراءاتنا ومخططات جداولنا تسكن داخل `core` و`db` بدل حزم مستقلة تماماً.

الحدّ الملزم: ملفاتنا داخل هاتين الحزمتين في مجلدات `extension/` فقط.

| المجلد | المحتوى |
|---|---|
| `packages/core/src/actions/extension/` | تعريفات إجراءات الامتداد |
| `packages/db/src/schema/extension/` | مخططات جداول الامتداد |
| `packages/db/src/extension/` | مشغّل مجرى ترحيلات الامتداد |
| `packages/db/migrations-ext/` | ترحيلات الامتداد |
| `packages/core/test/extension/`، `packages/db/test/extension/` | اختباراتها |
| `packages/adapters/src/extension/`، `packages/adapters/test/extension/` | منفذ الاستخراج ومشغّله واختباراتهما |
| `apps/web/lib/extension/`، `apps/web/test/extension/` | ما يخص الامتداد في تطبيق الويب |

المنطق الصرف يبقى في حزمنا (`packages/strategy`، `packages/knowledge`، `packages/governance`) التي لا تعتمد على `core`، والمشغّل في `packages/planning-agents` فوق `core`.

## 1. سجل ترحيلات ثانٍ

التصميم: [`design/b0-vertical-slice.md`](design/b0-vertical-slice.md) القسم 6، البند 2.

**السبب:** مشغّل الترحيلات يرفض أي ملف جديد يسبق اسمه آخر ملف مطبَّق. في سجل واحد، ترحيل للامتداد وترحيل الأصل التالي يكون كل منهما خارج الترتيب بالنسبة للآخر. لذلك للامتداد مجلد خاص وسجل خاص، ويعمل بعد ترحيلات الأصل.

| الملف | التعديل | احتمال التعارض عند الجلب |
|---|---|---|
| `packages/db/src/migrate.ts` | خيار `ledger` اختياري في `RunMigrationsOptions`، افتراضه `_migrations`. اسم الجدول في أربعة استعلامات صار من الخيار | متوسط: الملف يتغير في الأصل أحياناً. التعديل صغير وموضعي |
| `packages/db/src/index.ts` | تصدير `runExtensionMigrations` وثابتين | منخفض |
| `packages/db/src/bin/migrate.ts` | استدعاء مجرى الامتداد بعد مجرى الأصل | منخفض |
| `packages/db/src/bin/lint-migrations.ts` | فحص مجلد الامتداد متى احتوى ملف SQL | منخفض |
| `deploy/docker/migrate.ts` | استدعاء مجرى الامتداد بعد مجرى الأصل | منخفض |
| `deploy/docker/Dockerfile` | سطر `COPY` لمجلد `migrations-ext` | منخفض |
| `packages/test-support/src/db-harness.ts` | مجرى الامتداد في قالب قاعدة الاختبار وفي بصمته | منخفض |
| `e2e/prepare-database.ts` | مجرى الامتداد في قاعدة الاختبار الشامل | منخفض |

ملفات جديدة داخل حزم النواة:

| الملف | المحتوى |
|---|---|
| `packages/db/src/extension/migrate.ts` | `runExtensionMigrations` و`EXTENSION_LEDGER` و`extensionMigrationsDir()` |
| `packages/db/migrations-ext/` | مجلد ترحيلات الامتداد. فيه ملف README فقط حتى الآن |
| `packages/db/test/extension/migrate-ledger.test.ts` | اختبارات السجل الثاني |

## 2. إجراءات الامتداد ومخططاته وأنواع نشاطه

التصميم: [`design/b0-vertical-slice.md`](design/b0-vertical-slice.md) القسمان 4 و6.1.

**السبب:** سجل الإجراءات وفهرس أنواع النشاط في الأصل خرائط ثابتة وقت الترجمة. نضيف خرائط الامتداد إليها بسطر نشر (spread) واحد عند كل نقطة.

| الملف | التعديل | احتمال التعارض عند الجلب |
|---|---|---|
| `packages/core/src/actions/registry.ts` | سطر استيراد، وسطر `...EXTENSION_ACTION_MAP` في آخر `ACTION_MAP` | متوسط: آخر الخريطة هو حيث يضيف الأصل إجراءاته الجديدة. الحل دائماً إبقاء سطرنا الأخير |
| `packages/core/src/activities/catalogue.ts` | سطر استيراد، وسطر `...EXTENSION_ACTIVITY_PAYLOAD_SCHEMAS` في آخر الخريطة | متوسط، للسبب نفسه |
| `packages/core/src/activities/renderers.ts` | سطر استيراد، وسطر `...EXTENSION_ACTIVITY_RENDERERS` في آخر الخريطة | متوسط، للسبب نفسه |
| `packages/db/src/index.ts` | سطر `export * from "./schema/extension/index.ts"` | منخفض |
| `packages/core/src/api/mcp/toolset-data.ts` | مجموعة أدوات سابعة للوكلاء باسم `planning`: سطر في `TOOLSET_NAMES`، وسطر `planning: PLANNING_TOOLSET`، وسطر استيراد. كل أداة للوكلاء يجب أن تنتمي لمجموعة واحدة بالضبط | متوسط |
| `packages/core/src/portability/policy.ts` | سطر استيراد، وسطر `...EXTENSION_TABLE_POLICY` في آخر قائمة سياسة النقل. كل جدول في القاعدة يجب أن يُصنَّف: يُصدَّر مع مساحة العمل أو يُستثنى بسبب | متوسط: آخر القائمة هو حيث يضيف الأصل جداوله |
| `packages/core/test/mcp-toolsets.test.ts`، `e2e/s41-mcp-transport.spec.ts`، `docs/design/mcp-toolsets.md` | قائمة أسماء المجموعات صارت تحوي `planning` | منخفض |
| `packages/test-support/src/db-harness.ts` | تفريغ الجداول بين الاختبارات يستثني `_migrations_ext` كما يستثني `_migrations` | منخفض |
| `contract/openapi.json`، `contract/cli.json`، `contract/mcp.json`، `docs/api/reference.md` | مولَّدة آلياً من السجل. تُعاد بـ`pnpm gen:contract` و`pnpm gen:docs` بعد كل جلب، ولا تُحل تعارضاتها يدوياً | مرتفع، وحلّه إعادة التوليد |

ملفات جديدة في مجلدات `extension/`:

| الملف | المحتوى |
|---|---|
| `packages/db/migrations-ext/0001_strategy_domains.sql` | جدول `strategy_domains` بسياسة العزل والحذف الناعم |
| `packages/db/src/schema/extension/strategy.ts`، `index.ts` | مخطط الجدول |
| `packages/core/src/actions/extension/index.ts` | `EXTENSION_ACTION_MAP` |
| `packages/core/src/actions/extension/strategy.ts` | `strategy.listDomains` و`strategy.createDomain` |
| `packages/core/src/actions/extension/activities.ts` | أنواع نشاط الامتداد وجملها |
| `packages/core/src/actions/extension/toolset.ts` | أسماء أدوات مجموعة `planning` |
| `packages/core/src/actions/extension/portability.ts` | تصنيف جداول الامتداد في أرشيف مساحة العمل: `strategy_domains` تُصدَّر، و`_migrations_ext` يُستثنى |
| `packages/core/test/extension/strategy-domains.test.ts` | اختباراتها |
| `packages/db/migrations-ext/0005_org_units.sql`، `packages/db/src/schema/extension/org-units.ts` | `org_sectors` و`org_agencies`: أي مساحة قطاع وأي مساحة وكالة تحت أي قطاع، وزناد يمنع أن تكون المساحة الاثنين معاً. جدول `spaces` في الأصل لم يُمس |
| `packages/core/src/actions/extension/org-units.ts` | `strategy.setSector` و`strategy.setAgency` و`strategy.listOrgUnits` |
| `packages/core/test/extension/org-units.test.ts` | اختباراتها |

## 3. العربية لغة جزئية، واتجاه الصفحة

التصميم: [`design/b0-vertical-slice.md`](design/b0-vertical-slice.md) القسم 6، البند 5.

**السبب:** `translate` يرمي خطأ عند أي مفتاح ناقص، والشريحة تترجم الهيكل العام وشاشاتها فقط. اللغة الجزئية تُكمَّل من الإنجليزية عند بناء الكتالوجات، فالشاشة غير المترجمة تظهر بالإنجليزية بدل أن تنكسر.

| الملف | التعديل | احتمال التعارض عند الجلب |
|---|---|---|
| `packages/ui/src/i18n/catalogue.ts` | `ar` في نوع `Locale`، و`PARTIAL_LOCALES`، وكتالوج `ar` مبني من الإنجليزية مع ملفنا، والدالة `directionOf` | منخفض إلى متوسط |
| `apps/web/app/layout.tsx` | `dir={directionOf(locale)}` على `<html>`، واستيراد الدالة | منخفض |

ملفات جديدة:

| الملف | المحتوى |
|---|---|
| `packages/ui/src/i18n/messages/ar.partial.json` | المفاتيح المترجمة للعربية. يكبر مع كل شاشة |
| `packages/ui/test/extension/arabic-locale.test.ts` | اكتمال الكتالوج، الرجوع للإنجليزية، لا مفاتيح قديمة، تطابق الثغرات، الاتجاه |
| `apps/web/test/extension/page-direction.test.ts` | `dir` على العنصر الجذر |

### الخط العربي

| الملف | التعديل | احتمال التعارض عند الجلب |
|---|---|---|
| `apps/web/app/layout.tsx` | تعريف `plexArabic` بـ`next/font/local` (أربعة أوزان، دون تحميل مسبق، بنطاق `unicode-range` للعربية)، وإضافة متغيره إلى صنف `<html>` | منخفض |
| `packages/ui/src/styles/tokens.css` | `var(--font-arabic-face)` أول سلسلة `--font-sans` | منخفض |
| `apps/web/app/fonts/README.md` | قسم للخط الجديد: الإصدار والمصدر والمجاميع | منخفض |

ملفات جديدة: أربعة ملفات `IBMPlexSansArabic-*.woff2` و`LICENSE-IBM-Plex.txt` في `apps/web/app/fonts/`، و`apps/web/test/extension/arabic-font.test.ts`.

**لماذا الخط العربي أول السلسلة:** Next يوسّع متغير Geist إلى الخط وبدائله، وآخرها Arial، وArial فيه حروف عربية على ويندوز وماك. لو جاء الخط العربي بعد Geist لما وصل إليه المتصفح هناك. نطاق `unicode-range` يجعله يُسأل عن الحروف العربية فقط، فبقية النص يبقى بـGeist.

لم يُنجز بعد من هذا البند: الأصناف المنطقية في الهيكل العام.

### عزل الاتجاه للنصوص المختلطة

| الملف | التعديل | احتمال التعارض عند الجلب |
|---|---|---|
| `apps/web/app/globals.css` | سطر `@import` لملف العزل | منخفض |

ملفات جديدة: `packages/ui/src/styles/extension/bidi-isolation.css` (قاعدة واحدة تحت `[dir="rtl"]` فقط: كل عنصر يُقرأ باتجاه نصه هو)، و`apps/web/test/extension/bidi-isolation.test.ts`، و`e2e/ext-bidi-isolation.spec.ts`.

## 4. العربية لغة يختارها العضو، وقيد قاعدة البيانات

التصميم: [`design/b0-vertical-slice.md`](design/b0-vertical-slice.md) القسم 6، البندان 5 و5أ. قرار صاحب المنتج بتاريخ 2026-11-19: الخيار (أ).

**السبب:** الترحيل الأصلي `0078` يضع على `workspace_members.language` قيداً يحصرها في `en` و`ms`. توسيع القائمة في الكود وحده لا يكفي: الحفظ يُرفض في القاعدة.

**هذا هو الموضع الوحيد الذي يغيّر فيه مجرى الامتداد شيئاً في جدول أصلي.** التغيير توسيع فقط: لا صف كان صحيحاً يصير خاطئاً.

| الملف | التعديل | احتمال التعارض عند الجلب |
|---|---|---|
| `packages/core/src/settings/registry.ts` | `ar` في مخطط إعداد لغة العضو | منخفض |
| `packages/core/src/actions/people.ts` | `ar` في مخططي الإدخال والإخراج للغة العضو (موضعان) | منخفض |
| `apps/web/lib/appearance.tsx`، `apps/web/lib/appearance-action.ts` | خيار العربية في منتقي اللغة للعضو | منخفض |
| `apps/web/app/admin/general/general-settings-form.tsx` | خيار العربية في لغة مساحة العمل | منخفض |
| `packages/ui/src/i18n/messages/en.json`، `ms.json` | المفتاح `appearance.arabic` | منخفض |
| `packages/ui/test/catalogue.test.tsx` | المفتاح الجديد في قائمة ما يتطابق في الملايوية والإنجليزية (اسم لغة) | منخفض |

ملفات جديدة:

| الملف | المحتوى |
|---|---|
| `packages/db/migrations-ext/0002_member_language_arabic.sql` | يُسقط القيد ويعيده بالقيم الثلاث في جملة واحدة |
| `packages/db/test/extension/member-language-constraint.test.ts` | الاختبار الحارس |
| `packages/core/test/extension/arabic-language.test.ts` | العضو يختار العربية وتُقرأ كما اختارها، والقائمة ما زالت مغلقة |

### خطر معروف وحارسه

لو أعاد المشروع الأصلي كتابة القيد نفسه (لإضافة لغة مثلاً)، فترحيله سيُسقط `ar`، وسيفشل على خادم فيه عضو لغته عربية. **الاختبار الحارس يقرأ القيد بعد كل الترحيلات ويشترط القيم الثلاث بالضبط**، فيفشل عند أول جلب يُدخل ذلك الترحيل. العلاج حينها: ترحيل جديد في مجرى الامتداد يعيد `ar` إلى القيد بقيم الأصل الجديدة، وتحديث الاختبار.

## 4أ. وثائق المصدر وقراءتها في الخلفية

التصميم: [`design/b0-vertical-slice.md`](design/b0-vertical-slice.md) القسمان 4 و5.

| الملف | التعديل | احتمال التعارض عند الجلب |
|---|---|---|
| `packages/core/src/outbox/handlers.ts` | سطرا استيراد، وحقل `extractPages` في اعتماديات المعالجات، وسطر `...EXTENSION_OUTBOX_HANDLERS` في آخر جدول المعالجات | متوسط: آخر الجدول هو حيث يضيف الأصل مواضيعه |
| `packages/core/package.json` | الاعتماد على `@openokr/knowledge` | منخفض |
| `packages/core/test/write-floor-classification.test.ts`، `apps/web/test/action-coverage.test.ts` | تصنيف الإجراءات الثلاثة الجديدة | منخفض |

ملفات جديدة في مجلدات `extension/`:

| الملف | المحتوى |
|---|---|
| `packages/db/migrations-ext/0003_source_documents.sql` | الجدولان `source_documents` و`source_document_pages` |
| `packages/db/src/schema/extension/knowledge.ts` | مخططهما |
| `packages/core/src/actions/extension/knowledge.ts` | `knowledge.registerDocument` و`knowledge.listDocuments` و`knowledge.readPage` |
| `packages/core/src/actions/extension/knowledge-extraction.ts` | مهمة القراءة في الخلفية وتسجيل نتيجتها |
| `packages/core/src/actions/extension/outbox.ts` | معالج الموضوع `knowledge.extract` |
| `packages/core/src/actions/extension/acting-member.ts` | تحديد العضو المنفِّذ |
| `packages/db/migrations-ext/0004_extraction_quality.sql` | عدّا الكلمات العربية والمشبوهة على الوثيقة وعلى كل صفحة (المعيار 19). لا يمس جدولاً من الأصل |

**قرار صلاحيات يستحق الذكر:** قراءة وثائق القطاع وصفحاتها تطلب مستوى «تعديل» على القطاع، لا «عرض». في الأصل كل عضو في مساحة العمل يملك «عرض» على كل القطاعات (لا خصوصية للقطاع)، و«تعديل» لأعضاء القطاع ولمسؤول النظام والمالك. الطلب يمر عبر `getAccessScoped` نفسها بمستوى أعلى، لا بفحص خاص.

## 4ب. قارئ PDF

التصميم والقياس: [`design/extraction-quality.md`](design/extraction-quality.md). التبعية: [`DEPENDENCIES.md`](DEPENDENCIES.md).

| الملف | التعديل | احتمال التعارض عند الجلب |
|---|---|---|
| `packages/adapters/src/index.ts` | تصدير `PdfjsTextExtractor` وأنواع المنفذ الثلاثة | منخفض |
| `packages/adapters/package.json` | التبعية `pdfjs-dist` | منخفض |
| `pnpm-workspace.yaml` | `ignoredOptionalDependencies` لاستبعاد `@napi-rs/canvas` | منخفض |
| `apps/web/lib/relay.ts` | سطر استيراد، وسطر `extractPages` في اعتماديات المعالجات | منخفض إلى متوسط |

ملفات جديدة في مجلدات `extension/`:

| الملف | المحتوى |
|---|---|
| `packages/adapters/src/extension/extraction-port.ts` | المنفذ `TextExtractor`: نص الوثيقة صفحةً صفحة، أو «غير مقروءة» |
| `packages/adapters/src/extension/pdfjs-extractor.ts` | المشغّل: يعيد تنفيذ تعليمات رسم الصفحة ويجمع كل حرف مرسوم بموضعه |
| `packages/adapters/src/extension/page-layout.ts` | منطق صرف: من الحروف ومواضعها إلى نص بترتيب القراءة (التشكيل، الأسطر، الأعمدة، الاتجاهان، الأقواس) |
| `packages/adapters/src/extension/pdfjs-worker.d.ts` | تعريف نوع لملف المحلِّل في المكتبة |
| `packages/adapters/test/extension/` | اختبارات المنطق بحروف موضوعة يدوياً، واختبارات المشغّل على ملف تجريبي مؤلَّف |
| `packages/adapters/test/fixtures/extension/` | `strategy-sample.html` و`strategy-sample.pdf` (أربع صفحات للجهة الخيالية) و`blank.pdf` |
| `apps/web/lib/extension/document-reader.ts` | القارئ الذي يُعطى للمُرحِّل |

**استثناء مسجَّل من عادة الحزمة:** منافذ `packages/adapters` في `ports/` ومشغّلاتها في `drivers/`. منفذ الامتداد ومشغّله في `src/extension/` التزاماً بقاعدة القسم 0.

**كيف تُحمَّل المكتبة:** `pdfjs-dist` تحمّل محلِّلها بمسار ملف يُحسب وقت التشغيل، والخادم المبني لا يملك ذلك المسار. المشغّل يستورد الملفين استيراداً عادياً ويسلّم المحلِّل للمكتبة عبر `globalThis.pdfjsWorker`، وهي طريقتها الموثقة لذلك.

## 5. حزم الامتداد المستقلة

حزم جديدة كلياً لا تعدّل شيئاً في الأصل. تُسجَّل هنا للحصر فقط.

| الحزمة | المحتوى | تعتمد على |
|---|---|---|
| `packages/knowledge` | `normaliseArabic` (توحيد النص العربي) و`verifyCitation` (التحقق من اقتباس أمام نص صفحته) و`extractionQuality` و`isLowQuality` (جودة الاستخراج دون مرجع). منطق صرف، واختبار يفرض ألا تستورد شيئاً من خارجها | لا شيء |

الأثر الوحيد على ملف من ملفات الأصل: إدخال للحزمة في `pnpm-lock.yaml`، وهو ملف مولَّد يُعاد بـ`pnpm install` عند أي تعارض.

### قيد معروف: إصدار مخطط الامتداد في الأرشيف

أرشيف مساحة العمل يسجّل إصدار المخطط من `_migrations` فقط، والاستيراد يرفض أرشيفاً من نسخة أحدث بناءً عليه. جداول الامتداد تُصدَّر الآن، لكن إصدار مجراها (`_migrations_ext`) لا يُسجَّل في الأرشيف، فأرشيف من نسخة امتداد أحدث لا يُرفض عند الاستيراد في نسخة أقدم. لا أثر له ما دام التصدير والاستيراد بين نسختين من البناء نفسه. يُعالج في مرحلة التصليب (ط) بإضافة إصدار مجرى الامتداد إلى بيان الأرشيف.
