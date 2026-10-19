import Link from "next/link";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, btn, Card, Field, FilterChips, inputCls, Notice, PageHeader } from "@/features/admin/ui";
import { isUuid } from "@/features/admin/result";
import { one, type IdParams, type SP } from "@/features/admin/query";
import { OfferCard } from "@/components/offers/OfferCard";
import { monthLabelAr, offerPeriodLabel, offerWhatsappText, type Offer } from "@/features/public-content/cms-model";
import { cms, hebronToday } from "../db";
import { CmsForm } from "../CmsForm";
import { ItemsEditor, LinkPicker, PhotoPicker, SlugField } from "../fields";
import { SortableList } from "../SortableList";
import { loadSection, pickOffers, pickPhotos } from "../data";
import { offerBadge, visibleBadge, type OfferStatus } from "../status";
import { defaultOfferMessage } from "../schema";
import { PAGE_TARGET_LABEL, PAGE_TARGETS } from "../targets";
import { deleteRow, saveAnnouncement, saveOffer, saveOrder, setOfferPinned, setOfferStatus, setVisible } from "../actions";
import { CmsLoadError, DATE_HELP, OFFERS_TABS, PageTabs, SectionIntroCard, today as todayLine } from "./shared";

type OfferDb = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  image_photo_id: string | null;
  price_minor: number | null;
  currency: string;
  show_price: boolean;
  starts_on: string | null;
  ends_on: string | null;
  terms: string | null;
  whatsapp_message: string | null;
  status: OfferStatus;
  pinned_home: boolean;
  sort_order: number;
  target_month: number | null;
  target_year: number | null;
  package_id: string | null;
};
const OFFER_COLS =
  "id, slug, title, description, image_photo_id, price_minor, currency, show_price, starts_on, ends_on, terms, whatsapp_message, status, pinned_home, sort_order, target_month, target_year, package_id";

export async function OffersPage({ searchParams }: { searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const filter = one((await searchParams).filter);
  const sb = await cms();
  const [{ data, error }, section] = await Promise.all([sb.from("offers").select(OFFER_COLS).order("sort_order").order("created_at"), loadSection(sb, "offers")]);
  if (error) return <CmsLoadError error={error} what="العروض" />;
  const today = hebronToday();
  const all = (data ?? []) as OfferDb[];
  const rows = filter ? all.filter((o) => offerBadge(o, today).key === filter) : all;
  return (
    <>
      <PageHeader
        title="العروض"
        back={{ href: "/admin/content", label: "محتوى الموقع" }}
        lead={`هون بتضيف عروض مؤقتة بتاريخ بداية ونهاية. ${todayLine(today)}`}
        actions={
          <Link href="/admin/content/offers/new" className={btn("primary")}>
            + عرض جديد
          </Link>
        }
      />
      <PageTabs label="أقسام العروض" tabs={OFFERS_TABS} current="/admin/content/offers" />
      <FilterChips
        base="/admin/content/offers"
        param="filter"
        current={filter}
        params={filter ? { filter } : {}}
        options={[
          { value: "active", label: "ساري" },
          { value: "scheduled", label: "مجدول" },
          { value: "expired", label: "منتهي" },
          { value: "draft", label: "مسودة" },
          { value: "archived", label: "مؤرشف" },
        ]}
      />
      <div className="space-y-4">
        <p className="text-sm text-on-cream-muted" data-testid="offers-order-help">
          الترتيب في الموقع: المثبّتة أولاً بترتيب السحب هنا، ثم السارية حسب الشهر المستهدف (الأحدث أولاً)، ثم البقية بترتيب السحب.
        </p>
        {rows.length ? (
          filter ? (
            <ul className="space-y-2">
              {rows.map((o) => (
                <li key={o.id} className="rounded-md border border-cream-line bg-[#fffdf8] p-2">
                  <OfferRowView o={o} today={today} />
                </li>
              ))}
            </ul>
          ) : (
            <SortableList label="ترتيب العروض" table="offers" action={saveOrder} testId="offers-list" items={rows.map((o) => ({ id: o.id, content: <OfferRowView o={o} today={today} /> }))} />
          )
        ) : (
          <Notice>لا توجد عروض{filter ? " بهذه الحالة" : ""}.</Notice>
        )}
        <SectionIntroCard section={section} sectionKey="offers" note="يظهر قسم العروض في الرئيسية فقط عند وجود عرض ساري وتفعيل القسم من «القائمة والأقسام»." />
      </div>
    </>
  );
}

function OfferRowView({ o, today }: { o: OfferDb; today: string }) {
  const b = offerBadge(o, today);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="offer-row" data-slug={o.slug}>
      <Link href={`/admin/content/offers/${o.id}`} className="min-w-0 flex-1 break-words font-medium underline-offset-4 hover:underline">
        {o.title}
      </Link>
      <span data-testid="offer-status">
        <Badge tone={b.tone}>{b.label}</Badge>
      </span>
      {o.pinned_home ? <Badge tone="gold">مثبّت</Badge> : null}
      {offerPeriodLabel(o) ? <span className="text-xs" data-testid="offer-period">{offerPeriodLabel(o)}</span> : null}
      <span className="text-xs text-on-cream-muted" dir="ltr">
        {o.starts_on ?? "…"} → {o.ends_on ?? "…"}
      </span>
      <ActionForm action={setOfferPinned} submitLabel={o.pinned_home ? "إلغاء التثبيت" : "تثبيت"} kind="ghost" inline>
        <input type="hidden" name="id" value={o.id} />
        <input type="hidden" name="value" value={o.pinned_home ? "0" : "1"} />
      </ActionForm>
      {o.status === "published" ? (
        <ActionForm action={setOfferStatus} submitLabel="إخفاء" kind="ghost" inline>
          <input type="hidden" name="id" value={o.id} />
          <input type="hidden" name="status" value="draft" />
        </ActionForm>
      ) : (
        <ActionForm action={setOfferStatus} submitLabel="نشر" kind="ghost" inline>
          <input type="hidden" name="id" value={o.id} />
          <input type="hidden" name="status" value="published" />
        </ActionForm>
      )}
    </div>
  );
}

const money = (minor: number | null) => (minor == null ? "" : (minor / 100).toFixed(minor % 100 ? 2 : 0));

export async function OfferEditPage({ params, searchParams }: { params: IdParams; searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const { id } = await params;
  const saved = (await searchParams).saved === "1";
  const isNew = id === "new";
  if (!isNew && !isUuid(id)) return <CmsLoadError what="العرض" />;
  const sb = await cms();
  const [row, items, photos, pkgs] = await Promise.all([
    isNew ? Promise.resolve({ data: null, error: null }) : sb.from("offers").select(OFFER_COLS).eq("id", id).maybeSingle(),
    isNew ? Promise.resolve({ data: [] }) : sb.from("offer_items").select("label, sort_order").eq("offer_id", id).order("sort_order"),
    pickPhotos(sb),
    sb.from("packages").select("id, title, status").order("sort_order"),
  ]);
  const packages = (pkgs.data ?? []) as { id: string; title: string; status: string }[];
  if (row.error || (!isNew && !row.data)) return <CmsLoadError error={row.error} what="العرض" />;
  const o = row.data as OfferDb | null;
  const today = hebronToday();
  const b = o ? offerBadge(o, today) : null;
  return (
    <>
      <PageHeader
        title={o ? o.title : "عرض جديد"}
        back={{ href: "/admin/content/offers", label: "العروض" }}
        lead={b ? <span data-testid="offer-status"><Badge tone={b.tone}>{b.label}</Badge></span> : undefined}
        actions={
          o ? (
            <Link href={`/admin/content/offers/${o.id}/preview`} className={btn("ghost")}>
              معاينة
            </Link>
          ) : null
        }
      />
      {saved ? <div className="mb-4"><Notice tone="success">حُفظ العرض.</Notice></div> : null}
      <Card>
        <CmsForm
          action={saveOffer}
          testId="offer-form"
          intents={[
            { intent: "draft", label: "حفظ مسودة", kind: "ghost" },
            { intent: "preview", label: "معاينة", kind: "ghost" },
            { intent: "publish", label: o?.status === "published" ? "حفظ (منشور)" : "نشر", kind: "primary" },
            ...(o && o.status !== "archived" ? [{ intent: "archive", label: "أرشفة", kind: "danger" as const }] : []),
          ]}
        >
          {o ? <input type="hidden" name="id" value={o.id} /> : null}
          <input type="hidden" name="status" value={o?.status ?? "draft"} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="عنوان العرض" hint="2–120 حرفاً." className="sm:col-span-2">
              <input name="title" required minLength={2} maxLength={120} defaultValue={o?.title ?? ""} className={inputCls} />
            </Field>
            <div className="sm:col-span-2">
              <SlugField defaultValue={o?.slug} prefix="/offers" />
            </div>
            <Field label="الوصف" hint="حتى 600 حرف." className="sm:col-span-2">
              <textarea name="description" rows={3} maxLength={600} defaultValue={o?.description ?? ""} className={inputCls} />
            </Field>
            <div className="sm:col-span-2">
              <ItemsEditor defaultValue={((items.data ?? []) as { label: string }[]).map((i) => i.label)} />
            </div>
            <Field label="السعر (اختياري)" hint="مثال: 1500 أو 1499.50">
              <input name="price" inputMode="decimal" dir="ltr" defaultValue={money(o?.price_minor ?? null)} pattern="\d{1,9}(\.\d{1,2})?" className={inputCls} />
            </Field>
            <Field label="العملة">
              <select name="currency" defaultValue={o?.currency ?? "ILS"} className={inputCls}>
                <option value="ILS">شيكل (₪)</option>
                <option value="USD">دولار ($)</option>
                <option value="JOD">دينار أردني</option>
              </select>
            </Field>
            <label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="show_price" defaultChecked={o?.show_price ?? false} /> إظهار السعر للزوار
            </label>
            <Field label="يبدأ في (اختياري)">
              <input type="date" name="starts_on" defaultValue={o?.starts_on ?? ""} className={inputCls} />
            </Field>
            <Field label="ينتهي في (اختياري)">
              <input type="date" name="ends_on" defaultValue={o?.ends_on ?? ""} className={inputCls} />
            </Field>
            <p className="text-xs text-on-cream-muted sm:col-span-2">
              {DATE_HELP} {todayLine(today)}. العرض المستقبلي لا يظهر قبل تاريخ البداية، والمنتهي يختفي من الموقع ويبقى هنا.
            </p>
            <Field label="الشهر المستهدف (اختياري)" hint="يحدد ترتيب العروض: الأحدث أولاً. لا نقرأ الشهر من العنوان.">
              <select name="target_month" defaultValue={o?.target_month ? String(o.target_month) : ""} className={inputCls} data-testid="offer-target-month">
                <option value="">— بدون —</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    {monthLabelAr(i + 1)} ({i + 1})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="السنة المستهدفة" hint="مع الشهر، أو اتركهما فارغين.">
              <input name="target_year" inputMode="numeric" dir="ltr" pattern="20\d{2}" defaultValue={o?.target_year ? String(o.target_year) : ""} placeholder={today.slice(0, 4)} className={inputCls} data-testid="offer-target-year" />
            </Field>
            <Field label="مرتبط ببكج (اختياري)" hint="للربط فقط: تعديل العرض أو انتهاؤه لا يغيّر البكج." className="sm:col-span-2">
              <select name="package_id" defaultValue={o?.package_id ?? ""} className={inputCls} data-testid="offer-package">
                <option value="">— بدون —</option>
                {packages.map((pk) => (
                  <option key={pk.id} value={pk.id}>
                    {pk.title}
                    {pk.status !== "published" ? " (غير منشور)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="الشروط (اختياري)" hint="حتى 1000 حرف." className="sm:col-span-2">
              <textarea name="terms" rows={3} maxLength={1000} defaultValue={o?.terms ?? ""} className={inputCls} />
            </Field>
            <Field label="رسالة واتساب" hint={`اتركها فارغة لاستخدام: «${defaultOfferMessage(o?.title ?? "<عنوان العرض>")}»`} className="sm:col-span-2">
              <textarea name="whatsapp_message" rows={2} maxLength={600} defaultValue={o?.whatsapp_message ?? ""} className={inputCls} />
            </Field>
            <div className="sm:col-span-2">
              <PhotoPicker name="image_photo_id" label="صورة العرض (اختياري)" photos={photos} defaultValue={o?.image_photo_id} />
            </div>
            <label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="pinned_home" defaultChecked={o?.pinned_home ?? false} /> تثبيت (يظهر أولاً في العروض والرئيسية، بالترتيب الذي تحدده)
            </label>
          </div>
        </CmsForm>
      </Card>
      {o ? (
        <div className="mt-4">
          <Card title="حذف">
            <ActionForm action={deleteRow} submitLabel="حذف العرض نهائياً" kind="danger" confirm={{ title: "حذف هذا العرض؟", body: "الأفضل «أرشفة» إذا أردت الاحتفاظ به. الإعلانات المرتبطة به تبقى بدون رابط.", confirmLabel: "حذف" }}>
              <input type="hidden" name="table" value="offers" />
              <input type="hidden" name="id" value={o.id} />
              <input type="hidden" name="from" value="edit" />
            </ActionForm>
          </Card>
        </div>
      ) : null}
    </>
  );
}

export async function OfferPreviewPage({ params }: { params: IdParams }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const { id } = await params;
  if (!isUuid(id)) return <CmsLoadError what="العرض" />;
  const sb = await cms();
  const [row, items] = await Promise.all([
    sb.from("offers").select(OFFER_COLS).eq("id", id).maybeSingle(),
    sb.from("offer_items").select("label, sort_order").eq("offer_id", id).order("sort_order"),
  ]);
  if (row.error || !row.data) return <CmsLoadError error={row.error} what="العرض" />;
  const o = row.data as OfferDb;
  const offer: Offer = { ...o, display_price_minor: o.show_price ? o.price_minor : null, items: ((items.data ?? []) as { label: string }[]).map((i) => i.label) };
  const b = offerBadge(o, hebronToday());
  return (
    <>
      <PageHeader
        title="معاينة العرض"
        back={{ href: `/admin/content/offers/${o.id}`, label: "رجوع للتعديل" }}
        lead={
          <>
            هكذا تظهر البطاقة للزوار. الحالة الآن: <Badge tone={b.tone}>{b.label}</Badge>
            {b.key !== "active" ? " — لن تظهر للزوار حتى تكون «ساري»." : null}
          </>
        }
        actions={
          o.status !== "published" ? (
            <ActionForm action={setOfferStatus} submitLabel="نشر" kind="primary" inline>
              <input type="hidden" name="id" value={o.id} />
              <input type="hidden" name="status" value="published" />
            </ActionForm>
          ) : null
        }
      />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="max-w-sm rounded-md bg-cream p-4" data-testid="offer-preview">
          <OfferCard offer={offer} />
        </div>
        <Card title="التفاصيل">
          {offer.items.length ? (
            <ul className="list-disc space-y-1 ps-5 text-sm">
              {offer.items.map((i, k) => (
                <li key={k}>{i}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-on-cream-muted">بدون بنود.</p>
          )}
          {o.terms ? <p className="mt-3 whitespace-pre-line text-xs text-on-cream-muted">{o.terms}</p> : null}
          <p className="mt-3 text-sm">
            رسالة واتساب: <q>{offerWhatsappText(o)}</q>
          </p>
        </Card>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ announcements
type Ann = {
  id: string;
  template: "bar" | "banner";
  text: string;
  link_kind: "none" | "offer" | "page";
  link_offer_id: string | null;
  link_page: string | null;
  starts_on: string | null;
  ends_on: string | null;
  is_visible: boolean;
  dismissible: boolean;
};
const ANN_COLS = "id, template, text, link_kind, link_offer_id, link_page, starts_on, ends_on, is_visible, dismissible";

function AnnPreview({ a }: { a: Pick<Ann, "template" | "text" | "dismissible"> }) {
  const banner = a.template === "banner";
  return (
    <div className={`rounded-sm ${banner ? "bg-gold px-4 py-4 text-ink" : "bg-ink-2 px-4 py-2 text-on-dark"}`} data-testid="announcement-preview">
      <div className="flex items-center gap-3">
        <p className={`min-w-0 flex-1 break-words ${banner ? "text-lg font-semibold" : "text-sm"}`}>
          <bdi>{a.text}</bdi>
        </p>
        {a.dismissible ? <span aria-hidden="true">×</span> : null}
      </div>
    </div>
  );
}

export async function AnnouncementsPage() {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sb = await cms();
  const { data, error } = await sb.from("announcements").select(ANN_COLS).order("sort_order").order("created_at");
  if (error) return <CmsLoadError error={error} what="الإعلانات" />;
  const today = hebronToday();
  const rows = (data ?? []) as Ann[];
  return (
    <>
      <PageHeader
        title="الإعلانات"
        back={{ href: "/admin/content", label: "محتوى الموقع" }}
        lead={`تظهر أعلى كل صفحات الموقع. ${todayLine(today)}`}
        actions={
          <Link href="/admin/content/announcements/new" className={btn("primary")}>
            + إعلان جديد
          </Link>
        }
      />
      <PageTabs label="أقسام العروض" tabs={OFFERS_TABS} current="/admin/content/announcements" />
      {rows.length ? (
        <SortableList
          label="ترتيب الإعلانات"
          table="announcements"
          action={saveOrder}
          testId="announcements-list"
          items={rows.map((a) => {
            const v = visibleBadge(a, today);
            return {
              id: a.id,
              content: (
                <div className="space-y-2" data-testid="announcement-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/content/announcements/${a.id}`} className="min-w-0 flex-1 break-words font-medium underline-offset-4 hover:underline">
                      {a.text}
                    </Link>
                    <Badge tone={v.tone}>{v.label}</Badge>
                    <Badge>{a.template === "banner" ? "لافتة" : "شريط"}</Badge>
                    <ActionForm action={setVisible} submitLabel={a.is_visible ? "إخفاء" : "إظهار"} kind="ghost" inline>
                      <input type="hidden" name="table" value="announcements" />
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="value" value={a.is_visible ? "0" : "1"} />
                    </ActionForm>
                  </div>
                </div>
              ),
            };
          })}
        />
      ) : (
        <Notice>لا توجد إعلانات.</Notice>
      )}
    </>
  );
}

export async function AnnouncementEditPage({ params, searchParams }: { params: IdParams; searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const { id } = await params;
  const saved = (await searchParams).saved === "1";
  const isNew = id === "new";
  if (!isNew && !isUuid(id)) return <CmsLoadError what="الإعلان" />;
  const sb = await cms();
  const [row, offers] = await Promise.all([isNew ? Promise.resolve({ data: null, error: null }) : sb.from("announcements").select(ANN_COLS).eq("id", id).maybeSingle(), pickOffers(sb)]);
  if (row.error || (!isNew && !row.data)) return <CmsLoadError error={row.error} what="الإعلان" />;
  const a = row.data as Ann | null;
  const today = hebronToday();
  return (
    <>
      <PageHeader title={a ? "تعديل إعلان" : "إعلان جديد"} back={{ href: "/admin/content/announcements", label: "الإعلانات" }} lead={a ? <Badge tone={visibleBadge(a, today).tone}>{visibleBadge(a, today).label}</Badge> : undefined} />
      {saved ? <div className="mb-4"><Notice tone="success">حُفظ الإعلان.</Notice></div> : null}
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CmsForm
            action={saveAnnouncement}
            testId="announcement-form"
            intents={[
              { intent: "draft", label: a?.is_visible ? "إخفاء" : "حفظ مخفياً", kind: "ghost" },
              { intent: "publish", label: a?.is_visible ? "حفظ (ظاهر)" : "نشر", kind: "primary" },
            ]}
          >
            {a ? <input type="hidden" name="id" value={a.id} /> : null}
            <div className="grid gap-3">
              <fieldset className="text-sm">
                <legend className="mb-1 font-medium">القالب</legend>
                <label className="me-4 inline-flex min-h-10 items-center gap-2">
                  <input type="radio" name="template" value="bar" defaultChecked={(a?.template ?? "bar") === "bar"} /> شريط رفيع
                </label>
                <label className="inline-flex min-h-10 items-center gap-2">
                  <input type="radio" name="template" value="banner" defaultChecked={a?.template === "banner"} /> لافتة كبيرة
                </label>
              </fieldset>
              <Field label="النص" hint="حتى 140 حرفاً. نص عادي.">
                <input name="text" required minLength={2} maxLength={140} defaultValue={a?.text ?? ""} className={inputCls} />
              </Field>
              <LinkPicker
                offers={offers.map((o) => ({ id: o.id, title: o.title + (o.hidden ? " (غير منشور)" : "") }))}
                pages={PAGE_TARGETS.map((k) => ({ key: k, label: PAGE_TARGET_LABEL[k] }))}
                defaults={{ kind: a?.link_kind ?? "none", offer: a?.link_offer_id ?? null, page: a?.link_page ?? null }}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="يبدأ في (اختياري)">
                  <input type="date" name="starts_on" defaultValue={a?.starts_on ?? ""} className={inputCls} />
                </Field>
                <Field label="ينتهي في (اختياري)">
                  <input type="date" name="ends_on" defaultValue={a?.ends_on ?? ""} className={inputCls} />
                </Field>
              </div>
              <p className="text-xs text-on-cream-muted">{DATE_HELP} إذا كان العرض المرتبط منتهياً يظهر الإعلان بدون رابط.</p>
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input type="checkbox" name="dismissible" defaultChecked={a?.dismissible ?? true} /> يمكن للزائر إغلاقه
              </label>
            </div>
          </CmsForm>
        </Card>
        <div className="space-y-4">
          {a ? (
            <Card title="معاينة">
              <AnnPreview a={a} />
              <p className="mt-2 text-xs text-on-cream-muted">المعاينة بآخر نسخة محفوظة.</p>
            </Card>
          ) : null}
          {a ? (
            <Card title="حذف">
              <ActionForm action={deleteRow} submitLabel="حذف الإعلان" kind="danger" confirm={{ title: "حذف هذا الإعلان؟", confirmLabel: "حذف" }}>
                <input type="hidden" name="table" value="announcements" />
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="from" value="edit" />
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
