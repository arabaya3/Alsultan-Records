# StudioOS V25 — QA قبل النشر

## تم التحقق محلياً
- JavaScript: `site.js`, `cms.js`, `admin-v3.js` تمر فحص syntax.
- لا يوجد IDs مكررة في ملفات HTML.
- لا توجد روابط داخلية باقية بصيغة `.html`.
- لا توجد assets محلية مفقودة في المراجع الثابتة.
- `supabase-config.js` يحمّل قبل `site.js` في الصفحات التي تحتوي نماذج، وهذا يصلح تهيئة Turnstile.
- الروابط النظيفة + `<base href="/">` تمنع كسر `/assets/...` عند فتح مسارات منتهية بـ `/`.
- `robots.txt` و`sitemap.xml` محدثان للمسارات النظيفة.
- CMS media محدث إلى schema الفعلية لجدول `media`.
- Edge Functions السبعة أصبحت تقفل CORS/Origin افتراضياً على رابط الموقع الحالي حتى لو لم يوجد `PUBLIC_SITE_ORIGIN` secret.

## يحتاج إعداد حساب خارجي وليس ملف كود
1. Cloudflare Turnstile: أضف hostname الحالي `wild-mode-be8c.noor-rabaya-1997-nr.workers.dev` إلى الـWidget المستخدم، أو أضف الدومين النهائي عند ربطه.
2. Supabase Auth: فعّل Leaked Password Protection من لوحة Authentication إذا بقي التحذير ظاهراً.
3. لا يوجد حتى الآن Public Events / Public Media / Reviews / Offers؛ V25 يعرض Empty States محترمة ولا يختلق محتوى عملاء.
4. النسخ الاحتياطي الحالي Snapshot/Manifest فقط. النسخة الحقيقية لملفات Storage تحتاج وجهة نسخ خارجية.
5. Analytics غير مفعلة لأن Google Analytics ID وCloudflare Analytics token غير موجودين في إعدادات النشاط.
