import Link from "next/link";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, btn, Card, Field, FilterChips, inputCls, Notice, PageHeader } from "@/features/admin/ui";
import { isUuid } from "@/features/admin/result";
import { one, type IdParams, type SP } from "@/features/admin/query";
import { cms } from "../db";
import { CmsForm } from "../CmsForm";
import { ItemsEditor, PhotoPicker, SlugField } from "../fields";
import { SortableList } from "../SortableList";
import { pickPhotos } from "../data";
import { packageBadge, type PackageStatus } from "../status";
import { defaultPackageMessage } from "../schema";
import { deleteRow, savePackage, saveOrder, setPackageFeatured, setPackageStatus } from "../actions";
import { CmsLoadError } from "./shared";

type PackageDb = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  image_photo_id: string | null;
  price_minor: number | null;
  currency: string;
  show_price: boolean;
  whatsapp_message: string | null;
  status: PackageStatus;
  featured: boolean;
  sort_order: number;
};
const PACKAGE_COLS = "id, slug, title, description, image_photo_id, price_minor, currency, show_price, whatsapp_message, status, featured, sort_order";

export async function PackagesPage({ searchParams }: { searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const filter = one((await searchParams).filter);
  const sb = await cms();
  const { data, error } = await sb.from("packages").select(PACKAGE_COLS).order("sort_order").order("created_at");
  if (error) return <CmsLoadError error={error} what="البكجات" />;
  const all = (data ?? []) as PackageDb[];
  const rows = filter ? all.filter((p) => p.status === filter) : all;
  return (
    <>
      <PageHeader
        title="البكجات"
        back={{ href: "/admin/content", label: "محتوى الموقع" }}
        lead="باقات خدمات ثابتة (بدون تاريخ انتهاء). العروض المؤقتة لها صفحتها الخاصة."
        actions={
          <Link href="/admin/content/packages/new" className={btn("primary")}>
            + بكج جديد
          </Link>
        }
      />
      <FilterChips
        base="/admin/content/packages"
        param="filter"
        current={filter}
        params={filter ? { filter } : {}}
        options={[
          { value: "published", label: "منشور" },
          { value: "draft", label: "مسودة" },
          { value: "hidden", label: "مخفي" },
        ]}
      />
      <div className="space-y-4">
        {rows.length ? (
          filter ? (
            <ul className="space-y-2">
              {rows.map((p) => (
                <li key={p.id} className="rounded-md border border-cream-line bg-[#fffdf8] p-2">
                  <PackageRowView p={p} />
                </li>
              ))}
            </ul>
          ) : (
            <SortableList label="ترتيب البكجات" table="packages" action={saveOrder} testId="packages-list" items={rows.map((p) => ({ id: p.id, content: <PackageRowView p={p} /> }))} />
          )
        ) : (
          <Notice>لا توجد بكجات{filter ? " بهذه الحالة" : " بعد. أضف أول بكج بالأسماء والخدمات والأسعار الحقيقية"}.</Notice>
        )}
      </div>
    </>
  );
}

function PackageRowView({ p }: { p: PackageDb }) {
  const b = packageBadge(p);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="package-row" data-slug={p.slug}>
      <Link href={`/admin/content/packages/${p.id}`} className="min-w-0 flex-1 break-words font-medium underline-offset-4 hover:underline">
        {p.title}
      </Link>
      <span data-testid="package-status">
        <Badge tone={b.tone}>{b.label}</Badge>
      </span>
      {p.featured ? <Badge tone="gold">مميّز</Badge> : null}
      <ActionForm action={setPackageFeatured} submitLabel={p.featured ? "إلغاء التمييز" : "تمييز"} kind="ghost" inline>
        <input type="hidden" name="id" value={p.id} />
        <input type="hidden" name="value" value={p.featured ? "0" : "1"} />
      </ActionForm>
      {p.status === "published" ? (
        <ActionForm action={setPackageStatus} submitLabel="إخفاء" kind="ghost" inline>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="status" value="hidden" />
        </ActionForm>
      ) : (
        <ActionForm action={setPackageStatus} submitLabel="نشر" kind="ghost" inline>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="status" value="published" />
        </ActionForm>
      )}
    </div>
  );
}

const money = (minor: number | null) => (minor == null ? "" : (minor / 100).toFixed(minor % 100 ? 2 : 0));

export async function PackageEditPage({ params, searchParams }: { params: IdParams; searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const { id } = await params;
  const saved = (await searchParams).saved === "1";
  const isNew = id === "new";
  if (!isNew && !isUuid(id)) return <CmsLoadError what="البكج" />;
  const sb = await cms();
  const [row, items, photos, linked] = await Promise.all([
    isNew ? Promise.resolve({ data: null, error: null }) : sb.from("packages").select(PACKAGE_COLS).eq("id", id).maybeSingle(),
    isNew ? Promise.resolve({ data: [] }) : sb.from("package_items").select("label, sort_order").eq("package_id", id).order("sort_order"),
    pickPhotos(sb),
    isNew ? Promise.resolve({ data: [] }) : sb.from("offers").select("id, title").eq("package_id", id).order("sort_order"),
  ]);
  if (row.error || (!isNew && !row.data)) return <CmsLoadError error={row.error} what="البكج" />;
  const p = row.data as PackageDb | null;
  const b = p ? packageBadge(p) : null;
  const offers = (linked.data ?? []) as { id: string; title: string }[];
  return (
    <>
      <PageHeader
        title={p ? p.title : "بكج جديد"}
        back={{ href: "/admin/content/packages", label: "البكجات" }}
        lead={b ? <span data-testid="package-status"><Badge tone={b.tone}>{b.label}</Badge></span> : undefined}
        actions={
          p?.status === "published" ? (
            <Link href={`/packages#${p.slug}`} className={btn("ghost")} target="_blank">
              عرض في الموقع
            </Link>
          ) : null
        }
      />
      {saved ? <div className="mb-4"><Notice tone="success">حُفظ البكج.</Notice></div> : null}
      <Card>
        <CmsForm
          action={savePackage}
          testId="package-form"
          intents={[
            { intent: "draft", label: "حفظ مسودة", kind: "ghost" },
            { intent: "publish", label: p?.status === "published" ? "حفظ (منشور)" : "نشر", kind: "primary" },
            ...(p && p.status === "published" ? [{ intent: "hide", label: "إخفاء", kind: "danger" as const }] : []),
          ]}
        >
          {p ? <input type="hidden" name="id" value={p.id} /> : null}
          <input type="hidden" name="status" value={p?.status ?? "draft"} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="اسم البكج" hint="2–120 حرفاً." className="sm:col-span-2">
              <input name="title" required minLength={2} maxLength={120} defaultValue={p?.title ?? ""} className={inputCls} />
            </Field>
            <div className="sm:col-span-2">
              <SlugField defaultValue={p?.slug} prefix="/packages#" />
            </div>
            <Field label="الوصف" hint="حتى 1000 حرف." className="sm:col-span-2">
              <textarea name="description" rows={3} maxLength={1000} defaultValue={p?.description ?? ""} className={inputCls} />
            </Field>
            <div className="sm:col-span-2">
              <ItemsEditor legend="الخدمات المشمولة" max={30} defaultValue={((items.data ?? []) as { label: string }[]).map((i) => i.label)} />
            </div>
            <Field label="السعر (اختياري)" hint="مثال: 3000 أو 2999.50">
              <input name="price" inputMode="decimal" dir="ltr" defaultValue={money(p?.price_minor ?? null)} pattern="\d{1,9}(\.\d{1,2})?" className={inputCls} />
            </Field>
            <Field label="العملة">
              <select name="currency" defaultValue={p?.currency ?? "ILS"} className={inputCls}>
                <option value="ILS">شيكل (₪)</option>
                <option value="USD">دولار ($)</option>
                <option value="JOD">دينار أردني</option>
              </select>
            </Field>
            <label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="show_price" defaultChecked={p?.show_price ?? false} /> إظهار السعر للزوار
            </label>
            <Field label="رسالة واتساب" hint={`اتركها فارغة لاستخدام: «${defaultPackageMessage(p?.title ?? "<اسم البكج>")}»`} className="sm:col-span-2">
              <textarea name="whatsapp_message" rows={2} maxLength={600} defaultValue={p?.whatsapp_message ?? ""} className={inputCls} />
            </Field>
            <div className="sm:col-span-2">
              <PhotoPicker name="image_photo_id" label="صورة البكج (اختياري)" photos={photos} defaultValue={p?.image_photo_id} />
            </div>
            <label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="featured" defaultChecked={p?.featured ?? false} /> بكج مميّز (إطار ذهبي وشارة «مميّز»)
            </label>
          </div>
        </CmsForm>
      </Card>
      {p ? (
        <div className="mt-4 space-y-4">
          {offers.length ? (
            <Card title="عروض مرتبطة بهذا البكج">
              <ul className="list-disc ps-5 text-sm" data-testid="package-linked-offers">
                {offers.map((o) => (
                  <li key={o.id}>
                    <Link href={`/admin/content/offers/${o.id}`} className="underline underline-offset-4">
                      {o.title}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-on-cream-muted">العروض تشير للبكج فقط؛ تعديلها أو انتهاؤها لا يغيّر البكج.</p>
            </Card>
          ) : null}
          <Card title="حذف">
            <ActionForm action={deleteRow} submitLabel="حذف البكج نهائياً" kind="danger" confirm={{ title: "حذف هذا البكج؟", body: "الأفضل «إخفاء» إذا أردت الاحتفاظ به. العروض المرتبطة تبقى بدون ربط.", confirmLabel: "حذف" }}>
              <input type="hidden" name="table" value="packages" />
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="from" value="edit" />
            </ActionForm>
          </Card>
        </div>
      ) : null}
    </>
  );
}
