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
| `packages/db/src/extension/migrate.ts` | `runExtensionMigrations` و`EXTENSION_LEDGER` و`EXTENSION_MIGRATIONS_DIR` |
| `packages/db/migrations-ext/` | مجلد ترحيلات الامتداد. فيه ملف README فقط حتى الآن |
| `packages/db/test/extension/migrate-ledger.test.ts` | اختبارات السجل الثاني |
