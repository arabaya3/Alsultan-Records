import { loadHomeSections, SectionForm, SectionsOrder } from "./nav";
import { ProcessPage } from "./process";
import { Segmented } from "@/features/admin/ui";
import { one, type SP } from "@/features/admin/query";
import { SECTION_LABEL } from "../targets";
import { IconCalendar, IconEdit as IconPen, IconEye as IconEyeOn, IconGrid, IconMonitor } from "@/features/admin/icons";
import { SettingsFrame } from "@/features/admin/SettingsTabs";
import { Modal } from "@/features/admin/Modal";
import { IconChevronDown, IconLink, IconPhone, IconPinMap, IconUpload } from "@/features/admin/icons";
import Link from "next/link";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, btn, Field, inputCls, Notice, PageHeader } from "@/features/admin/ui";
import { cms } from "../db";
import { CmsForm } from "../CmsForm";
import { PhotoPicker } from "../fields";
import { pickPhotos } from "../data";
import { activateLogo, saveHome, saveIdentity } from "../actions";
import { LogoUploader } from "../LogoUploader";
import { CmsLoadError } from "./shared";
import { LONG_TEXT, LONG_TEXT_HINT } from "@/lib/text-limits";

export const CONTENT_LINKS = [
  { href: "/admin/content/home", label: "الصفحة الرئيسية", lead: "الواجهة وصورتها، وترتيب الأقسام وإظهارها وعناوينها." },
  { href: "/admin/videos", label: "الفيديوهات", lead: "أعمال وبرومو من يوتيوب." },
  { href: "/admin/albums", label: "ألبومات الموقع", lead: "ألبومات الصور المنشورة على الموقع." },
  { href: "/admin/content/packages", label: "البكجات", lead: "باقات خدمات ثابتة: الخدمات المشمولة، السعر الاختياري، التمييز." },
  { href: "/admin/content/offers", label: "العروض", lead: "عروض مؤقتة بتواريخ بداية ونهاية وشهر مستهدف." },
  { href: "/admin/content/announcements", label: "الإعلانات", lead: "شريط أو لافتة أعلى الموقع." },
  { href: "/admin/content/nav", label: "القائمة العلوية", lead: "أسماء روابط القائمة وترتيبها." },
  { href: "/admin/content/identity", label: "هوية النشاط", lead: "الاسم، الأرقام، الروابط والشعار (من الإعدادات)." },
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

  const t = (name: keyof Biz, label: string, o: { ltr?: boolean; hint?: string; max?: number; type?: string; required?: boolean; icon?: React.ReactNode } = {}) => (
    <Field label={label} hint={o.hint}>
      <span className="relative block">
        <input
          name={name}
          type={o.type ?? "text"}
          dir={o.ltr ? "ltr" : undefined}
          maxLength={o.max ?? 300}
          required={o.required}
          defaultValue={(b[name] as string | null) ?? ""}
          className={`${inputCls} !rounded-xl ${o.icon ? "!ps-11" : ""}`}
        />
        {o.icon ? (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-on-cream-muted">
            {o.icon}
          </span>
        ) : null}
      </span>
    </Field>
  );
  const box = "rounded-2xl border border-cream-line bg-[#fffdf8] p-5 shadow-[0_6px_18px_-16px_rgb(60_45_20/0.5)]";
  const boxTitle = (title: string) => (
    <div className="mb-4">
      <h3 className="font-display text-xl font-bold">{title}</h3>
      <span aria-hidden="true" className="mt-2 block h-0.5 w-12 rounded-full bg-gold" />
    </div>
  );

  return (
    <SettingsFrame current="/admin/content/identity" title="هوية النشاط" lead="تظهر في رأس الموقع وتذييله وأزرار التواصل.">
      {/* One form, one «حفظ التغييرات» for the contact data. The logo is uploaded and activated in its own dialog. */}
      <CmsForm action={saveIdentity} testId="identity-form" intents={[{ intent: "save", label: "حفظ التغييرات", kind: "primary" }]}>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section className={box} aria-label="بيانات التواصل">
            {boxTitle("بيانات التواصل")}
            <div className="grid gap-4">
              {t("name", "اسم النشاط", { max: 200, required: true })}
              {t("tagline", "الشعار النصّي (Tagline)", { hint: "جملة قصيرة تحت الاسم." })}
              <div className="grid gap-4 sm:grid-cols-2">
                {t("phone", "رقم الهاتف", { ltr: true, max: 32, type: "tel", icon: <IconPhone /> })}
                {t("whatsapp", "رقم واتساب", { ltr: true, max: 32, type: "tel", hint: "مثال: +970599000000 — تُستخدم لأزرار واتساب.", icon: <WhatsAppGlyph /> })}
              </div>
              {t("address", "العنوان", { icon: <IconPinMap /> })}
              <details className="group rounded-xl border border-cream-line bg-[#fffdf8]" data-testid="identity-more-links">
                <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                  <span aria-hidden="true" className="text-on-cream-muted"><IconLink /></span>
                  <span className="flex-1">
                    روابط إضافية <span className="font-normal text-on-cream-muted">(فيسبوك، يوتيوب، البريد الإلكتروني)</span>
                  </span>
                  <span aria-hidden="true" className="transition-transform group-open:rotate-180"><IconChevronDown /></span>
                </summary>
                <div className="grid gap-4 border-t border-cream-line p-4 sm:grid-cols-2">
                  {t("facebook", "فيسبوك", { ltr: true, hint: "https://www.facebook.com/…" })}
                  {t("youtube_url", "يوتيوب", { ltr: true, hint: "https://www.youtube.com/@…" })}
                  {t("email", "البريد (اختياري)", { ltr: true, type: "email", hint: "يظهر فقط إذا عبّأته." })}
                  {t("instagram", "إنستغرام (اختياري)", { ltr: true, hint: "يظهر فقط إذا عبّأته." })}
                  {t("whatsapp_url", "رابط واتساب (اختياري)", { ltr: true, hint: "https://wa.me/… — يُستخدم فقط إن لم يوجد رقم." })}
                </div>
              </details>
            </div>
          </section>

          <section className={box} aria-label="الشعار">
            {boxTitle("الشعار")}
            <p className="mb-2 text-sm font-medium">الشعار الحالي</p>
            <div className="flex h-36 items-center justify-center rounded-xl bg-navy-deep px-4" data-testid="logo-current">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={(active ? urlOf.get(active.id) : null) ?? "/brand/logo-main.webp"} alt="الشعار الحالي" className="max-h-28 w-auto" />
            </div>
            <p className="mt-1 text-xs text-on-cream-muted">{active ? "شعار مرفوع" : "الشعار الأصلي"}</p>
            <Modal
              title="تغيير الشعار"
              testId="logo-modal"
              trigger={
                <>
                  <IconUpload /> تغيير الشعار
                </>
              }
              triggerClassName="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-gold/60 bg-[#fffdf8] px-4 text-base font-semibold hover:bg-gold/10"
            >
              <div className="space-y-5">
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
                      <li key={l.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-cream-line p-2" data-testid="logo-version">
                        <span className="flex h-14 w-28 items-center justify-center rounded-lg bg-navy-deep p-1">
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
                          <ActionForm action={activateLogo} submitLabel="تفعيل" kind="ghost" inline confirm={{ title: "تفعيل هذا الشعار في الموقع؟", body: "يظهر فوراً في رأس الموقع وتذييله." }}>
                            <input type="hidden" name="id" value={l.id} />
                          </ActionForm>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {logos.error ? <Notice tone="gold">إدارة نسخ الشعار تحتاج تحديث قاعدة البيانات.</Notice> : null}
              </div>
            </Modal>
            <p className="mt-3 text-xs leading-relaxed text-on-cream-muted">
              الصيغ المسموحة: WebP، PNG، JPG
              <br />
              الحد الأقصى للحجم: 2 ميغابايت
            </p>
          </section>
        </div>
      </CmsForm>
    </SettingsFrame>
  );
}

function WhatsAppGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.7Z" />
      <path d="M9 9.5c.3 2.2 2.3 4.3 4.5 4.8l1.2-1.2 1.8.8c-.2 1.2-1 2-2.3 2A6.5 6.5 0 0 1 8 9.7c0-1.3.8-2.1 2-2.3l.8 1.8Z" />
    </svg>
  );
}

type Home = {
  hero_title: string | null;
  hero_subtitle: string | null;
  hero_primary_label: string | null;
  hero_secondary_label: string | null;
  hero_stat_videos: number | null;
  hero_stat_photos: number | null;
  hero_stat_events: number | null;
  booking_message: string | null;
  hero_cover_photo_id: string | null;
  hero_cover_source: "manual" | "latest_album" | null;
  hero_promo_source: "site" | "youtube" | null;
  hero_promo_video_id: string | null;
};

const HOME_TABS = [
  { key: "hero", label: "الواجهة", icon: <IconMonitor /> },
  { key: "sections", label: "الأقسام", icon: <IconGrid /> },
  { key: "content", label: "محتوى الأقسام", icon: <IconPen /> },
  { key: "steps", label: "خطوات الحجز", icon: <IconCalendar /> },
] as const;
type HomeTab = (typeof HOME_TABS)[number]["key"];

/**
 * «الصفحة الرئيسية»: one short editor with four tabs (in the URL: ?tab=…). Each tab shows one form with its own save:
 * the hero, the sections' order and visibility, the chosen section's content (?s=key), the booking steps. Same fields,
 * actions and rules as before.
 */
export async function HomeContentPage({ searchParams }: { searchParams?: SP } = {}) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sp = searchParams ? await searchParams : {};
  const tabRaw = one(sp.tab);
  const tab: HomeTab = (HOME_TABS.find((t) => t.key === tabRaw)?.key ?? "hero") as HomeTab;
  const header = (
    <PageHeader
      title="الصفحة الرئيسية"
      lead="رتّب أقسام الصفحة وعدّل محتواها من مكان واحد"
      actions={
        <Link href="/" target="_blank" className={btn("ghost")}>
          معاينة الموقع
        </Link>
      }
    />
  );
  const tabs = (
    <Segmented
      label="أقسام محرر الصفحة الرئيسية"
      testId="home-tabs"
      current={tab}
      tabs={HOME_TABS.map((t) => ({ key: t.key, href: t.key === "hero" ? "/admin/content/home" : `/admin/content/home?tab=${t.key}`, label: t.label, icon: t.icon }))}
    />
  );

  if (tab === "steps") {
    return (
      <>
        {header}
        {tabs}
        <div className="rounded-2xl border border-cream-line bg-[#fffdf8] p-4 md:p-6" id="home-process">
          <ProcessPage embedded />
        </div>
      </>
    );
  }

  if (tab === "sections" || tab === "content") {
    const data = await loadHomeSections();
    if ("error" in data) return <CmsLoadError error={data.error} what="الأقسام" />;
    if (tab === "sections") {
      return (
        <>
          {header}
          {tabs}
          <div className="rounded-2xl border border-cream-line bg-[#fffdf8] p-4 md:p-6" id="home-sections">
            <h2 className="font-display text-xl font-bold">أقسام الصفحة</h2>
            <span aria-hidden="true" className="mt-2 mb-4 block h-0.5 w-12 rounded-full bg-gold" />
            <SectionsOrder sections={data.sections} />
          </div>
        </>
      );
    }
    const chosenKey = one(sp.s);
    const chosen = data.sections.find((x) => x.key === chosenKey) ?? data.sections[0];
    return (
      <>
        {header}
        {tabs}
        <div className="grid items-start gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
          <nav aria-label="أقسام الصفحة الرئيسية" className="rounded-2xl border border-cream-line bg-[#fffdf8] p-4" data-testid="home-content-sections">
            <h2 className="font-display text-lg font-bold">الأقسام في الصفحة الرئيسية</h2>
            <p className="mb-3 text-sm text-on-cream-muted">اختر قسماً لتعديل محتواه.</p>
            <ul className="space-y-2">
              {data.sections.map((x) => {
                const on = x.key === chosen?.key;
                return (
                  <li key={x.key}>
                    <Link
                      href={`/admin/content/home?tab=content&s=${x.key}`}
                      aria-current={on ? "page" : undefined}
                      data-testid="home-content-section-link"
                      data-key={x.key}
                      className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 text-sm transition-colors ${on ? "border-gold bg-gold/15 font-bold" : "border-cream-line hover:border-on-cream-muted"}`}
                    >
                      <span className="min-w-0 flex-1 break-words">{x.title || SECTION_LABEL[x.key]}</span>
                      {x.is_visible ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">
                          <IconEyeOn size={14} /> ظاهر
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs text-danger">مخفي</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {chosen ? (
            <section aria-labelledby="home-section-editor" className="rounded-2xl border border-cream-line bg-[#fffdf8] p-4 md:p-6" id={`section-${chosen.key}-card`}>
              <h2 id="home-section-editor" className="font-display text-2xl font-bold">
                {SECTION_LABEL[chosen.key]}
              </h2>
              <span aria-hidden="true" className="mt-2 mb-4 block h-0.5 w-12 rounded-full bg-gold" />
              <SectionForm s={chosen} opts={data.opts} />
            </section>
          ) : null}
        </div>
      </>
    );
  }

  // tab === "hero"
  const sb = await cms();
  const [biz, photos] = await Promise.all([
    sb
      .from("business_settings")
      .select("hero_title, hero_subtitle, hero_primary_label, hero_secondary_label, booking_message, hero_cover_photo_id, hero_cover_source, hero_promo_source, hero_promo_video_id, hero_stat_videos, hero_stat_photos, hero_stat_events")
      .eq("id", 1)
      .maybeSingle(),
    pickPhotos(sb),
  ]);
  if (biz.error || !biz.data) return <CmsLoadError error={biz.error} what="الرئيسية" />;
  const h = biz.data as Home;
  // Through the gated /p route: shown only while the photo is published.
  const cover = h.hero_cover_photo_id ? `/p/${h.hero_cover_photo_id}/thumb` : null;
  return (
    <>
      {header}
      {tabs}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <section aria-labelledby="home-hero-title" className="rounded-2xl border border-cream-line bg-[#fffdf8] p-4 md:p-6">
          <h2 id="home-hero-title" className="font-display text-2xl font-bold">
            واجهة الصفحة
          </h2>
          <span aria-hidden="true" className="mt-2 mb-4 block h-0.5 w-12 rounded-full bg-gold" />
          <CmsForm action={saveHome} testId="home-form" intents={[{ intent: "save", label: "حفظ التغييرات", kind: "primary" }]}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="العنوان الرئيسي" hint="حتى 120 حرفاً. فارغ = «وراء كل مناسبة حكاية تستحق أن تُروى».">
                <input name="hero_title" maxLength={120} defaultValue={h.hero_title ?? ""} className={inputCls} />
              </Field>
              <Field label="نص زر واتساب" hint="فارغ = «تواصل عبر واتساب». يظهر في الواجهة وفي شريط التواصل.">
                <input name="hero_primary_label" maxLength={40} defaultValue={h.hero_primary_label ?? ""} className={inputCls} />
              </Field>
              <Field label="النص تحت العنوان" hint={`فارغ = اسم الاستوديو و«ميثلون — جنين». ${LONG_TEXT_HINT}`}>
                <textarea name="hero_subtitle" rows={3} maxLength={LONG_TEXT} defaultValue={h.hero_subtitle ?? ""} className={inputCls} />
              </Field>
              <Field label="رسالة واتساب للحجز" hint="تُكتب تلقائياً عند ضغط زر الحجز.">
                <textarea name="booking_message" rows={3} maxLength={LONG_TEXT} defaultValue={h.booking_message ?? ""} className={inputCls} />
              </Field>
              <fieldset className="space-y-2 text-sm sm:col-span-2" data-testid="hero-cover-source">
                <legend className="mb-1 font-medium">مصدر صورة الواجهة</legend>
                <label className="flex min-h-10 items-center gap-2">
                  <input type="radio" name="hero_cover_source" value="manual" defaultChecked={(h.hero_cover_source ?? "manual") === "manual"} /> صورة أختارها بنفسي (من القائمة تحت)
                </label>
                <label className="flex min-h-10 items-center gap-2">
                  <input type="radio" name="hero_cover_source" value="latest_album" defaultChecked={h.hero_cover_source === "latest_album"} /> تلقائياً من أحدث ألبوم منشور
                </label>
                <p className="text-xs text-on-cream-muted" data-testid="hero-slideshow-note">
                  هاي الصورة بتظهر أول ما تفتح الرئيسية، وبعدها الواجهة بتتنقل لحالها بين صور الألبومات المنشورة، من الأحدث للأقدم.
                </p>
              </fieldset>
              <fieldset className="sm:col-span-2" data-testid="hero-stats">
                <legend className="mb-1 text-sm font-medium">أرقام الواجهة</legend>
                <p className="mb-3 text-xs text-on-cream-muted">تظهر بجانب العنوان. اكتب أرقامكم الحقيقية؛ الخانة الفارغة لا تظهر، وإذا كانت الثلاث فارغة لا يظهر شيء.</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="عدد الفيديوهات">
                    <input name="hero_stat_videos" type="number" inputMode="numeric" min={1} max={10000000} step={1} defaultValue={h.hero_stat_videos ?? ""} className={inputCls} data-testid="hero-stat-videos" />
                  </Field>
                  <Field label="عدد الصور">
                    <input name="hero_stat_photos" type="number" inputMode="numeric" min={1} max={10000000} step={1} defaultValue={h.hero_stat_photos ?? ""} className={inputCls} data-testid="hero-stat-photos" />
                  </Field>
                  <Field label="عدد المناسبات">
                    <input name="hero_stat_events" type="number" inputMode="numeric" min={1} max={10000000} step={1} defaultValue={h.hero_stat_events ?? ""} className={inputCls} data-testid="hero-stat-events" />
                  </Field>
                </div>
              </fieldset>
              <div className="sm:col-span-2">
                <PhotoPicker name="hero_cover_photo_id" label="الصورة المختارة يدوياً (اختياري)" photos={photos} defaultValue={h.hero_cover_photo_id} />
              </div>
              <details className="group rounded-xl border border-cream-line sm:col-span-2" data-testid="home-advanced">
                <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 font-semibold [&::-webkit-details-marker]:hidden">
                  <span className="flex-1">
                    إعدادات متقدمة <span className="font-normal text-on-cream-muted">(اختياري)</span>
                  </span>
                  <span aria-hidden="true" className="transition-transform group-open:rotate-180">▾</span>
                </summary>
                <div className="grid gap-4 border-t border-cream-line p-4">
                  <p className="text-xs text-on-cream-muted">
                    التلقائي: غلاف أحدث ألبوم منشور (أو أول صورة ظاهرة فيه إذا الغلاف مخفي). يتغيّر وحده لما تنشر ألبوماً جديداً أو تغيّر غلافه أو تخفي
                    الصورة. لا يستخدم أبداً صورة من مسودة أو ألبوم مخفي أو سلة المحذوفات. إذا ما في صورة ظاهرة تظهر أغلفة الألبومات المنشورة الأخرى، وإن لم توجد فلوحة داكنة بدون صورة. اختيارك
                    اليدوي يبقى محفوظاً ويرجع لما تختار «صورة أختارها بنفسي».
                  </p>
                  {/* The poster hero has one button. The stored label is sent back unchanged. */}
                  <input type="hidden" name="hero_secondary_label" value={h.hero_secondary_label ?? ""} />
                  <Field label="نص الزر الثاني (أعمالنا)" hint="غير مستخدم: واجهة التصميم الحالي فيها زر واتساب فقط. «أعمالنا» في القائمة العلوية.">
                    <input disabled readOnly value={h.hero_secondary_label ?? ""} className={`${inputCls} cursor-not-allowed bg-cream-2 text-on-cream-muted`} data-testid="off-secondary-label" />
                  </Field>
                  {/* The poster hero has no video. The stored choice is sent back unchanged. */}
                  <input type="hidden" name="hero_promo_source" value={h.hero_promo_source ?? "site"} />
                  <input type="hidden" name="hero_promo_video_id" value={h.hero_promo_video_id ?? ""} />
                  <div className="rounded-md border border-cream-line bg-cream-2 px-3 py-2 text-sm text-on-cream-muted" data-testid="off-hero-video">
                    <p className="font-medium text-on-cream">الفيديو التعريفي في الواجهة</p>
                    <p>غير مستخدم: واجهة التصميم الحالي صورة بدون فيديو. اختيارك السابق محفوظ كما هو. الفيديوهات تظهر في «أعمالنا» وفي قسم البرومو إذا أظهرته.</p>
                  </div>
                </div>
              </details>
            </div>
          </CmsForm>
        </section>
        <aside aria-label="معاينة الواجهة" className="rounded-2xl border border-cream-line bg-[#fffdf8] p-4" data-testid="home-hero-preview">
          <p className="mb-3 flex items-center gap-2 font-semibold">
            <IconEyeOn /> معاينة الواجهة
          </p>
          <div className="relative flex aspect-[3/4] items-end overflow-hidden rounded-xl bg-navy-deep">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt="" className="absolute inset-0 size-full object-cover opacity-70" />
            ) : null}
            <div className="relative w-full bg-gradient-to-t from-navy-deep via-navy-deep/70 to-transparent p-4 text-center text-ivory">
              <p className="font-display text-xl font-bold">{h.hero_title || "وراء كل مناسبة حكاية تستحق أن تُروى"}</p>
              <p className="mt-1 text-sm text-ivory/80">{h.hero_subtitle || "ستوديو وتسجيلات السلطان · ميثلون — جنين"}</p>
              <span className="mt-3 inline-flex min-h-10 items-center rounded-full bg-gold px-4 text-sm font-semibold text-ink">{h.hero_primary_label || "تواصل عبر واتساب"}</span>
            </div>
          </div>
          <p className="mt-2 text-xs text-on-cream-muted">المعاينة تعرض آخر ما حُفظ.</p>
        </aside>
      </div>
    </>
  );
}
