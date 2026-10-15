# StudioOS V25 — ملخص التغييرات

- إصلاح ترتيب تحميل `supabase-config.js` قبل `site.js` حتى يعمل Turnstile فعلياً.
- تحويل Turnstile إلى explicit render مع حالات نجاح/فشل واضحة وفallback إلى واتساب بدلاً من الفشل الصامت.
- توحيد المسارات إلى روابط نظيفة بدون `.html` وإضافة `<base href="/">` حتى لا تنكسر الأصول عند فتح `/route/`.
- إضافة `_redirects` وتحديث `robots.txt` و`sitemap.xml` إلى الروابط النظيفة.
- إصلاح ربط صور CMS مع schema الحقيقية لجدول `media` (`visibility`, `public_url`, `storage_path`, `alt_text`, `caption`).
- إضافة معرض حقيقي ديناميكي للأعمال المنشورة فقط، مع empty state محترم بدل صور وهمية.
- تحسين صفحة المناسبات حتى تبقى مفيدة حتى لو لم توجد مناسبات منشورة للعامة بعد.
- تحسين الخدمات بصرياً وإضافة proof strip واضح.
- جعل reveal animation progressive enhancement حتى لا تختفي أقسام كاملة عند فشل JavaScript.
- تحسين الموبايل: منع overflow، تكبير حقول النماذج، تقوية القائمة، tap targets، safe-area وRTL.
- إضافة meta descriptions للصفحات القانونية/الدعم، وتحسين canonical وOpenGraph.
- الحفاظ على Admin / Portal / MFA / Supabase دون كسر.

## ملاحظة Turnstile
الكود أصبح صحيحاً، لكن يجب أن يسمح Widget في Cloudflare بالـ hostname الحالي `wild-mode-be8c.noor-rabaya-1997-nr.workers.dev` أو الدومين النهائي.
