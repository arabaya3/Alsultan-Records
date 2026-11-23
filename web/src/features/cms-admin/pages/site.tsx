import Link from "next/link";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, btn, Card, Field, inputCls, Notice, PageHeader } from "@/features/admin/ui";
import { cms } from "../db";
import { CmsForm } from "../CmsForm";
import { PhotoPicker } from "../fields";
import { pickPhotos } from "../data";
import { activateLogo, saveHome, saveIdentity } from "../actions";
import { LogoUploader } from "../LogoUploader";
import { CmsLoadError } from "./shared";
import { LONG_TEXT, LONG_TEXT_HINT } from "@/lib/text-limits";

export const CONTENT_LINKS = [
  { href: "/admin/content/identity", label: "الهوية ومعلومات النشاط", lead: "الاسم، الأرقام، الروابط والشعار." },
  { href: "/admin/content/home", label: "الرئيسية", lead: "عنوان الواجهة، الأزرار، صورة الغلاف والفيديو التعريفي." },
  { href: "/admin/content/services", label: "الخدمات", lead: "إضافة وترتيب وإخفاء الخدمات." },
  { href: "/admin/content/process", label: "طريقة شغلنا", lead: "خطوات العمل مع العميل." },
  { href: "/admin/content/packages", label: "البكجات", lead: "باقات خدمات ثابتة: الخدمات المشمولة، السعر الاختياري، التمييز." },
  { href: "/admin/content/offers", label: "العروض", lead: "عروض مؤقتة بتواريخ بداية ونهاية وشهر مستهدف." },
  { href: "/admin/content/announcements", label: "الإعلانات", lead: "شريط أو لافتة أعلى الموقع." },
  { href: "/admin/videos", label: "الفيديوهات", lead: "أعمال وبرومو من يوتيوب." },
  { href: "/admin/albums", label: "ألبومات الصور", lead: "الألبومات والصور." },
  { href: "/admin/content/nav", label: "القائمة والأقسام", lead: "أسماء روابط القائمة وترتيب أقسام الرئيسية." },
];

export async function ContentIndexPage() {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  return (
    <>
      <PageHeader title="محتوى الموقع" lead="كل ما يراه الزوار. التعديلات تظهر في الموقع مباشرة بعد الحفظ أو النشر." />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CONTENT_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="block h-full rounded-md border border-cream-line bg-[#fffdf8] p-4 hover:border-gold">
              <span className="font-semibold">{l.label}</span>
              <span className="mt-1 block text-sm text-on-cream-muted">{l.lead}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

type Biz = {
  name: string;
  tagline: string | null;
  phone: string | null;
  whatsapp: string | null;
  whatsapp_url: string | null;
  address: string | null;
  facebook: string | null;
  youtube_url: string | null;
  instagram: string | null;
  email: string | null;
  active_logo_id: string | null;
};
type Logo = { id: string; storage_path: string; width: number; height: number; bytes: number; note: string | null; created_at: string };

export async function IdentityPage() {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sb = await cms();
  const [biz, logos] = await Promise.all([
    sb.from("business_settings").select("name, tagline, phone, whatsapp, whatsapp_url, address, facebook, youtube_url, instagram, email, active_logo_id").eq("id", 1).maybeSingle(),
    sb.from("brand_assets").select("id, storage_path, width, height, bytes, note, created_at").eq("kind", "logo").order("created_at", { ascending: false }).limit(20),
  ]);
  if (biz.error || !biz.data) return <CmsLoadError error={biz.error} what="الهوية" />;
  const b = biz.data as Biz;
  const list = (logos.data ?? []) as Logo[];
  // Private bucket: short-lived signed URLs for admin preview only.
  const signed = list.length ? await sb.storage.from("site-media").createSignedUrls(list.map((l) => l.storage_path), 600) : { data: [] };
  const urlOf = new Map((signed.data ?? []).map((s, i) => [list[i]?.id, s.signedUrl]));
  const active = list.find((l) => l.id === b.active_logo_id) ?? null;
  const previous = list.find((l) => l.id !== b.active_logo_id) ?? null;

  const t = (name: keyof Biz, label: string, o: { ltr?: boolean; hint?: string; max?: number; type?: string; required?: boolean } = {}) => (
    <Field label={label} hint={o.hint}>
      <input
        name={name}
        type={o.type ?? "text"}
        dir={o.ltr ? "ltr" : undefined}
        maxLength={o.max ?? 300}
        required={o.required}
        defaultValue={(b[name] as string | null) ?? ""}
        className={inputCls}
      />
    </Field>
  );

  return (
    <>
      <PageHeader title="الهوية ومعلومات النشاط" back={{ href: "/admin/content", label: "محتوى الموقع" }} lead="تظهر في رأس الموقع وتذييله وأزرار التواصل." />
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card title="معلومات النشاط">
          <CmsForm action={saveIdentity} testId="identity-form">
            <div className="grid gap-3 sm:grid-cols-2">
              {t("name", "اسم النشاط", { max: 200, required: true })}
              {t("tagline", "الشعار النصّي (Tagline)", { hint: "جملة قصيرة تحت الاسم." })}
              {t("phone", "رقم الهاتف", { ltr: true, max: 32, type: "tel" })}
              {t("whatsapp", "رقم واتساب", { ltr: true, max: 32, type: "tel", hint: "مثال: +970599000000 — تُستخدم لأزرار واتساب." })}
              {t("whatsapp_url", "رابط واتساب (اختياري)", { ltr: true, hint: "https://wa.me/… — يُستخدم فقط إن لم يوجد رقم." })}
              {t("address", "العنوان")}
              {t("facebook", "فيسبوك", { ltr: true, hint: "https://www.facebook.com/…" })}
              {t("youtube_url", "يوتيوب", { ltr: true, hint: "https://www.youtube.com/@…" })}
              {t("instagram", "إنستغرام (اختياري)", { ltr: true, hint: "يظهر فقط إذا عبّأته." })}
              {t("email", "البريد (اختياري)", { ltr: true, type: "email", hint: "يظهر فقط إذا عبّأته." })}
            </div>
          </CmsForm>
        </Card>
        <Card title="الشعار">
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium">الشعار الحالي في الموقع</p>
              <div className="flex h-24 items-center rounded-md bg-ink px-4" data-testid="logo-current">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={(active ? urlOf.get(active.id) : null) ?? "/brand/logo-main.webp"} alt="الشعار الحالي" className="h-16 w-auto" />
              </div>
              <p className="mt-1 text-xs text-on-cream-muted">{active ? "شعار مرفوع" : "الشعار الأصلي"}</p>
            </div>
            {b.active_logo_id ? (
              <div className="flex flex-wrap gap-2">
                {previous ? (
                  <ActionForm action={activateLogo} submitLabel="الرجوع للشعار السابق" kind="ghost" inline>
                    <input type="hidden" name="id" value={previous.id} />
                  </ActionForm>
                ) : null}
                <ActionForm action={activateLogo} submitLabel="الشعار الأصلي" kind="ghost" inline confirm={{ title: "العودة للشعار الأصلي؟", body: "يبقى الشعار المرفوع محفوظاً ويمكن تفعيله لاحقاً." }}>
                  <input type="hidden" name="id" value="" />
                </ActionForm>
              </div>
            ) : null}
            <LogoUploader />
            {list.length ? (
              <ul className="space-y-2" aria-label="نسخ الشعار">
                {list.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-3 rounded-md border border-cream-line p-2" data-testid="logo-version">
                    <span className="flex h-14 w-28 items-center justify-center rounded-sm bg-ink p-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={urlOf.get(l.id) ?? undefined} alt="معاينة على خلفية الرأس الداكنة" className="max-h-12 w-auto" />
                    </span>
                    <span className="text-xs text-on-cream-muted">
                      {l.width}×{l.height} · {Math.round(l.bytes / 1024)} KB
                      {l.note ? ` · ${l.note}` : ""}
                    </span>
                    {l.id === b.active_logo_id ? (
                      <Badge tone="success">مفعّل</Badge>
                    ) : (
                      <ActionForm action={activateLogo} submitLabel="تفعيل" kind="ghost" inline confirm={{ title: "تفعيل هذا الشعار في الموقع؟", body: "يظهر فوراً في رأس الموقع وتذييله. يمكنك الرجوع في أي وقت." }}>
                        <input type="hidden" name="id" value={l.id} />
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {logos.error ? <Notice tone="gold">إدارة نسخ الشعار تحتاج تحديث قاعدة البيانات.</Notice> : null}
          </div>
        </Card>
      </div>
    </>
  );
}

type Home = {
  hero_title: string | null;
  hero_subtitle: string | null;
  hero_primary_label: string | null;
  hero_secondary_label: string | null;
  booking_message: string | null;
  hero_cover_photo_id: string | null;
  hero_cover_source: "manual" | "latest_album" | null;
  hero_promo_source: "site" | "youtube" | null;
  hero_promo_video_id: string | null;
};

export async function HomeContentPage() {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sb = await cms();
  const [biz, photos] = await Promise.all([
    sb
      .from("business_settings")
      .select("hero_title, hero_subtitle, hero_primary_label, hero_secondary_label, booking_message, hero_cover_photo_id, hero_cover_source, hero_promo_source, hero_promo_video_id")
      .eq("id", 1)
      .maybeSingle(),
    pickPhotos(sb),
  ]);
  if (biz.error || !biz.data) return <CmsLoadError error={biz.error} what="الرئيسية" />;
  const h = biz.data as Home;
  return (
    <>
      <PageHeader
        title="الصفحة الرئيسية"
        back={{ href: "/admin/content", label: "محتوى الموقع" }}
        lead="الحقول الفارغة تعني استخدام نص التصميم المعتمد للواجهة."
        actions={
          <Link href="/" target="_blank" className={btn("ghost")}>
            معاينة الموقع
          </Link>
        }
      />
      <Card title="واجهة الصفحة">
        <CmsForm action={saveHome} testId="home-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="العنوان الرئيسي" hint="حتى 120 حرفاً. فارغ = «وراء كل مناسبة حكاية تستحق أن تُروى»." className="sm:col-span-2">
              <input name="hero_title" maxLength={120} defaultValue={h.hero_title ?? ""} className={inputCls} />
            </Field>
            <Field label="النص تحت العنوان" hint={`فارغ = اسم الاستوديو و«ميثلون — جنين». ${LONG_TEXT_HINT}`} className="sm:col-span-2">
              <textarea name="hero_subtitle" rows={3} maxLength={LONG_TEXT} defaultValue={h.hero_subtitle ?? ""} className={inputCls} />
            </Field>
            <Field label="نص زر واتساب" hint="فارغ = «تواصل عبر واتساب». يظهر في الواجهة وفي شريط التواصل.">
              <input name="hero_primary_label" maxLength={40} defaultValue={h.hero_primary_label ?? ""} className={inputCls} />
            </Field>
            {/* The poster hero has one button. The stored label is sent back unchanged. */}
            <input type="hidden" name="hero_secondary_label" value={h.hero_secondary_label ?? ""} />
            <Field label="نص الزر الثاني (أعمالنا)" hint="غير مستخدم: واجهة التصميم الحالي فيها زر واتساب فقط. «أعمالنا» في القائمة العلوية.">
              <input disabled readOnly value={h.hero_secondary_label ?? ""} className={`${inputCls} cursor-not-allowed bg-cream-2 text-on-cream-muted`} data-testid="off-secondary-label" />
            </Field>
            <Field label="رسالة واتساب الافتراضية للحجز" hint="تُكتب تلقائياً عند ضغط زر الحجز." className="sm:col-span-2">
              <textarea name="booking_message" rows={2} maxLength={LONG_TEXT} defaultValue={h.booking_message ?? ""} className={inputCls} />
            </Field>
            <fieldset className="space-y-2 text-sm sm:col-span-2" data-testid="hero-cover-source">
              <legend className="mb-1 font-medium">مصدر صورة الواجهة</legend>
              <label className="flex min-h-10 items-center gap-2">
                <input type="radio" name="hero_cover_source" value="manual" defaultChecked={(h.hero_cover_source ?? "manual") === "manual"} /> صورة أختارها بنفسي (من القائمة تحت)
              </label>
              <label className="flex min-h-10 items-center gap-2">
                <input type="radio" name="hero_cover_source" value="latest_album" defaultChecked={h.hero_cover_source === "latest_album"} /> تلقائياً من أحدث ألبوم منشور
              </label>
              <p className="text-xs text-on-cream-muted">
                التلقائي: غلاف أحدث ألبوم منشور (أو أول صورة ظاهرة فيه إذا الغلاف مخفي). يتغيّر وحده لما تنشر ألبوماً جديداً أو تغيّر غلافه أو تخفي
                الصورة. لا يستخدم أبداً صورة من مسودة أو ألبوم مخفي أو سلة المحذوفات. إذا ما في صورة ظاهرة تظهر أغلفة الألبومات المنشورة الأخرى، وإن لم توجد فلوحة داكنة بدون صورة. اختيارك
                اليدوي يبقى محفوظاً ويرجع لما تختار «صورة أختارها بنفسي».
              </p>
            </fieldset>
            <div className="sm:col-span-2">
              <PhotoPicker name="hero_cover_photo_id" label="الصورة المختارة يدوياً (اختياري)" photos={photos} defaultValue={h.hero_cover_photo_id} />
            </div>
            {/* The poster hero has no video. The stored choice is sent back unchanged. */}
            <input type="hidden" name="hero_promo_source" value={h.hero_promo_source ?? "site"} />
            <input type="hidden" name="hero_promo_video_id" value={h.hero_promo_video_id ?? ""} />
            <div className="rounded-md border border-cream-line bg-cream-2 px-3 py-2 text-sm text-on-cream-muted sm:col-span-2" data-testid="off-hero-video">
              <p className="font-medium text-on-cream">الفيديو التعريفي في الواجهة</p>
              <p>غير مستخدم: واجهة التصميم الحالي صورة بدون فيديو. اختيارك السابق محفوظ كما هو. الفيديوهات تظهر في «أعمالنا» وفي قسم البرومو إذا أظهرته.</p>
            </div>
          </div>
        </CmsForm>
      </Card>
    </>
  );
}
