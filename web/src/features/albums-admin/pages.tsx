import { photoErrorText } from "./photo-errors";
import { LONG_TEXT } from "@/lib/text-limits";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, btn, Card, Field, inputCls, LoadError, Notice, PageHeader, Table } from "@/features/admin/ui";
import { isUuid } from "@/features/admin/result";
import { one, pick, type IdParams, type SP } from "@/features/admin/query";
import { AlbumGallery } from "@/components/media/gallery/AlbumGallery";
import { AlbumUploader } from "./AlbumUploader";
import { NewAlbumForm } from "./NewAlbumForm";
import { PhotoReorder } from "./PhotoReorder";
import { ALBUM_BUCKET } from "./rules";
import { dateAr } from "@/features/portal/format";
import {
  createCategory,
  deleteCategory,
  purgeAlbum,
  restorePhoto,
  retryAlbumVariants,
  setAlbumCover,
  setAlbumPublished,
  setAlbumState,
  setPhotoPublished,
  trashPhoto,
  updateAlbum,
  updateCategory,
} from "./actions";
import { bidiDir } from "@/lib/bidi";
import { AutoSlug } from "./AutoSlug";
import { AltField, BulkAltProvider } from "./BulkAlt";
import { PhotoViews } from "./PhotoViews";

type Album = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  event_date: string | null;
  source_label: string | null;
  source_url: string | null;
  rights_note: string | null;
  cover_photo_id: string | null;
  sort_order: number;
  is_published: boolean;
  published_at: string | null;
  category_id: string | null;
  archived_at: string | null;
  deleted_at: string | null;
};
type Category = { id: string; slug: string; title: string; sort_order: number; is_published: boolean };
type Photo = {
  id: string;
  storage_path_original: string;
  variants: Record<string, string> | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  alt_text: string | null;
  sort_order: number;
  is_published: boolean;
  upload_status: "uploading" | "pending" | "processing" | "ready" | "failed";
  last_error: string | null;
  attempts: number | null;
  deleted_at: string | null;
};
const ALBUM_COLS =
  "id, slug, title, description, event_date, source_label, source_url, rights_note, cover_photo_id, sort_order, is_published, published_at, category_id, archived_at, deleted_at";
const PHOTO_COLS = "id, storage_path_original, variants, width, height, bytes, alt_text, sort_order, is_published, upload_status, last_error, attempts, deleted_at";
// Generated DB types may lag the CMS migration: read through an untyped client.
const db = async () => (await createClient()) as unknown as SupabaseClient;

const STATUS_LABEL: Record<Photo["upload_status"], string> = { uploading: "جارٍ الرفع", pending: "جارٍ التجهيز", processing: "جارٍ التجهيز", ready: "جاهز", failed: "فشل" };

function albumState(a: Album) {
  if (a.deleted_at) return <Badge tone="danger">في سلة المحذوفات</Badge>;
  if (a.archived_at) return <Badge>مؤرشف</Badge>;
  return a.is_published ? <Badge tone="success">منشور</Badge> : <Badge>مسودة</Badge>;
}

function AlbumFields({ a, categories }: { a?: Album; categories: Category[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="العنوان">
        <input name="title" required minLength={2} maxLength={160} defaultValue={a?.title ?? ""} className={inputCls} />
      </Field>
      <AutoSlug
        label="المعرّف في الرابط (slug)"
        hint="أحرف إنجليزية صغيرة وأرقام و -."
        defaultValue={a?.slug}
        pattern="[a-z0-9][a-z0-9\-]{1,79}"
        maxLength={80}
        testId="album-slug"
      />
      <Field label="التصنيف">
        <select name="category_id" defaultValue={a?.category_id ?? ""} className={inputCls} data-testid="album-category">
          <option value="">بلا تصنيف</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
              {c.is_published ? "" : " (مخفي)"}
            </option>
          ))}
        </select>
      </Field>
      <Field label="تاريخ المناسبة (اختياري)">
        <input name="event_date" type="date" defaultValue={a?.event_date ?? ""} className={inputCls} />
      </Field>
      <Field label="الوصف (اختياري)" className="sm:col-span-2">
        <textarea name="description" rows={3} maxLength={LONG_TEXT} defaultValue={a?.description ?? ""} className={inputCls} />
      </Field>
      <p className="text-xs text-on-cream-muted sm:col-span-2" data-testid="album-dates-note">
        تاريخ المناسبة اختياري ويقبل أي يوم (ماضٍ أو قادم)، ويظهر للزوار فقط إذا عبّأته. ترتيب الألبومات في الموقع حسب تاريخ النشر:
        يُسجَّل تلقائياً أول مرة تنشر فيها الألبوم، والألبوم الأحدث نشراً يظهر أولاً. تعديل الألبوم أو إضافة صور له لا يغيّر مكانه.
        {a?.published_at ? ` نُشر أول مرة: ${dateAr(a.published_at)}.` : ""}
      </p>
      <Field label="اسم المصدر (يظهر للعامة)" hint="مثال: فيسبوك — ستوديو السلطان">
        <input name="source_label" maxLength={120} defaultValue={a?.source_label ?? ""} className={inputCls} />
      </Field>
      <Field label="رابط المصدر (يظهر للعامة)" hint="https://www.facebook.com/…" className="sm:col-span-2">
        <input name="source_url" type="url" maxLength={500} dir="ltr" defaultValue={a?.source_url ?? ""} className={inputCls} />
      </Field>
      <Field label="ملاحظة الحقوق والموافقة (للإدارة فقط)" hint="من صاحب الصور ومن وافق على النشر ومتى." className="sm:col-span-2">
        <textarea name="rights_note" rows={2} maxLength={2000} defaultValue={a?.rights_note ?? ""} className={inputCls} />
      </Field>
    </div>
  );
}

const VIEWS = ["active", "archived", "trash"] as const;
const VIEW_LABEL: Record<(typeof VIEWS)[number], string> = { active: "الألبومات", archived: "الأرشيف", trash: "سلة المحذوفات" };

function CategoriesCard({ categories }: { categories: Category[] }) {
  return (
    <Card title="تصنيفات الألبومات">
      <div className="space-y-3" data-testid="album-categories">
        {categories.length ? (
          categories.map((c) => (
            <div key={c.id} className="flex flex-wrap items-end gap-2 rounded-md border border-cream-line p-2" data-testid="album-category-row" data-slug={c.slug}>
              <ActionForm action={updateCategory} submitLabel="حفظ" kind="ghost" className="flex-1">
                <input type="hidden" name="id" value={c.id} />
                <div className="grid items-end gap-2 sm:grid-cols-4">
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">عنوان التصنيف</span>
                    <input name="title" required minLength={2} maxLength={80} defaultValue={c.title} className={`${inputCls} w-full`} />
                  </label>
                  <AutoSlug label="المعرّف في الرابط" hint="أحرف إنجليزية صغيرة وأرقام و -." defaultValue={c.slug} pattern="[a-z0-9][a-z0-9\-]{1,59}" maxLength={60} />
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">الترتيب</span>
                    <input name="sort_order" type="number" defaultValue={c.sort_order} className={`${inputCls} w-full`} />
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" name="is_published" defaultChecked={c.is_published} className="size-5" /> ظاهر للزوار
                  </label>
                </div>
              </ActionForm>
              <ActionForm
                action={deleteCategory}
                submitLabel="حذف"
                kind="danger"
                inline
                confirm={{ title: `حذف التصنيف «${c.title}»؟`, body: "تبقى الألبومات كما هي لكن بلا تصنيف.", confirmLabel: "حذف" }}
              >
                <input type="hidden" name="id" value={c.id} />
              </ActionForm>
            </div>
          ))
        ) : (
          <Notice>لا توجد تصنيفات بعد.</Notice>
        )}
        <ActionForm action={createCategory} submitLabel="إضافة تصنيف" kind="primary" resetOnSuccess testId="album-category-create">
          <p className="text-sm font-semibold">تصنيف جديد</p>
          <div className="grid items-end gap-2 sm:grid-cols-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">عنوان التصنيف</span>
              <input name="title" required minLength={2} maxLength={80} placeholder="مثال: أعراس" className={`${inputCls} w-full`} />
            </label>
            <AutoSlug label="المعرّف في الرابط" hint="أحرف إنجليزية صغيرة وأرقام و -." pattern="[a-z0-9][a-z0-9\-]{1,59}" maxLength={60} testId="album-category-slug" />
            <label className="block text-sm">
              <span className="mb-1 block font-medium">الترتيب</span>
              <input name="sort_order" type="number" defaultValue={100} className={`${inputCls} w-full`} />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="is_published" defaultChecked className="size-5" /> ظاهر للزوار
            </label>
          </div>
        </ActionForm>
      </div>
    </Card>
  );
}

export async function AlbumsPage({ searchParams }: { searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sp = await searchParams;
  const view = pick(one(sp.view), VIEWS) ?? "active";
  const sb = await db();
  // Same order as the public list (migration 0026): newest published first; drafts by creation time.
  let q = sb.from("photo_albums").select(ALBUM_COLS).order("listed_at", { ascending: false }).order("id", { ascending: false });
  q = view === "trash" ? q.not("deleted_at", "is", null) : view === "archived" ? q.is("deleted_at", null).not("archived_at", "is", null) : q.is("deleted_at", null).is("archived_at", null);
  const [{ data, error }, photos, cats] = await Promise.all([
    q,
    sb.from("album_photos").select("album_id, is_published, upload_status").is("deleted_at", null),
    sb.from("album_categories").select("id, slug, title, sort_order, is_published").order("sort_order").order("title"),
  ]);
  if (error) return <LoadError what="الألبومات" />;
  const rows = (data ?? []) as Album[];
  const categories = (cats.data ?? []) as Category[];
  const catTitle = new Map(categories.map((c) => [c.id, c.title]));
  const counts = new Map<string, { all: number; visible: number; open: number }>();
  for (const p of photos.data ?? []) {
    const c = counts.get(p.album_id) ?? { all: 0, visible: 0, open: 0 };
    c.all++;
    if (p.is_published && p.upload_status === "ready") c.visible++;
    if (p.upload_status !== "ready") c.open++;
    counts.set(p.album_id, c);
  }
  return (
    <>
      <PageHeader title="الألبومات" lead="ألبومات صور تُعرض في الموقع العام بعد النشر. الأصول في تخزين خاص ولا يرى الزائر إلا نسخ العرض." />
      <nav className="mb-3 flex flex-wrap gap-2" aria-label="عرض">
        {VIEWS.map((v) => (
          <Link
            key={v}
            href={v === "active" ? "/admin/albums" : `/admin/albums?view=${v}`}
            aria-current={view === v ? "true" : undefined}
            className={`rounded-sm border px-3 py-1 text-sm ${view === v ? "border-ink bg-ink text-on-dark" : "border-cream-line bg-[#fffdf8] hover:border-on-cream-muted"}`}
          >
            {VIEW_LABEL[v]}
          </Link>
        ))}
      </nav>
      <div className="space-y-4">
        <Table head={["الألبوم", "التصنيف", "الصور", "الحالة", ""]} empty={!rows.length} label="قائمة الألبومات">
          {rows.map((a) => {
            const c = counts.get(a.id) ?? { all: 0, visible: 0, open: 0 };
            return (
              <tr key={a.id} data-testid="album-row" data-slug={a.slug}>
                <td className="px-3 py-2">
                  <Link href={`/admin/albums/${a.id}`} className="font-medium underline-offset-2 hover:underline">
                    {a.title}
                  </Link>
                  <p className="text-xs text-on-cream-muted" dir="ltr">
                    {a.slug}
                  </p>
                </td>
                <td className="px-3 py-2 text-sm">{(a.category_id && catTitle.get(a.category_id)) || "—"}</td>
                <td className="px-3 py-2 text-sm">
                  {c.visible} ظاهرة من {c.all}
                  {c.open ? <span className="block text-xs text-on-cream-muted">{c.open} غير مكتملة</span> : null}
                </td>
                <td className="px-3 py-2">
                  {albumState(a)}
                  {a.published_at ? <span className="block text-xs text-on-cream-muted">نُشر {dateAr(a.published_at)}</span> : null}
                </td>
                <td className="px-3 py-2">
                  <Link href={`/admin/albums/${a.id}`} className={btn("ghost")}>
                    إدارة
                  </Link>
                </td>
              </tr>
            );
          })}
        </Table>
        {view === "active" ? (
          <>
            <Card title="ألبوم جديد">
              <NewAlbumForm>
                <AlbumFields categories={categories} />
              </NewAlbumForm>
              <p className="mt-2 text-xs text-on-cream-muted">يُنشأ الألبوم مسودة (ما بينشر تلقائياً). الصور المختارة تبلّش ترفع فوراً بصفحة الألبوم، وبتقدر تضيف صور لاحقاً من نفس الصفحة.</p>
            </Card>
            <CategoriesCard categories={categories} />
          </>
        ) : view === "trash" ? (
          <Notice>الألبومات في السلة مخفية عن الموقع ويمكن استرجاعها. الحذف النهائي من صفحة الألبوم ويتطلب كتابة معرّفه.</Notice>
        ) : null}
      </div>
    </>
  );
}

async function signedMap(sb: SupabaseClient, paths: string[]) {
  if (!paths.length) return new Map<string, string>();
  const signed = await sb.storage.from(ALBUM_BUCKET).createSignedUrls(paths, 600);
  return new Map((signed.data ?? []).filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl]));
}

export async function AlbumEditPage({ params, searchParams }: { params: IdParams; searchParams?: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const { id } = await params;
  // One photo list, two views of it: «التفاصيل» (cover, visibility, status, alt texts, trash) or «الترتيب» (order).
  const view = one((await searchParams)?.view) === "order" ? "order" : "details";
  if (!isUuid(id)) return <LoadError what="الألبوم" />;
  const sb = await db();
  const [albumRes, photosRes, cats] = await Promise.all([
    sb.from("photo_albums").select(ALBUM_COLS).eq("id", id).maybeSingle(),
    sb.from("album_photos").select(PHOTO_COLS).eq("album_id", id).order("sort_order").order("created_at"),
    sb.from("album_categories").select("id, slug, title, sort_order, is_published").order("sort_order").order("title"),
  ]);
  if (albumRes.error || !albumRes.data) return <LoadError what="الألبوم" />;
  const a = albumRes.data as Album;
  const all = (photosRes.data ?? []) as Photo[];
  const photos = all.filter((p) => !p.deleted_at);
  const trashed = all.filter((p) => p.deleted_at);
  const categories = (cats.data ?? []) as Category[];
  // Admin previews: short-lived signed URLs (admin storage policy), thumb variant only (never needs the original).
  const urlByPath = await signedMap(sb, all.map((p) => p.variants?.thumb).filter((x): x is string => !!x));
  const thumbOf = (p: Photo) => (p.variants?.thumb ? (urlByPath.get(p.variants.thumb) ?? null) : null);
  const visible = photos.filter((p) => p.is_published && p.upload_status === "ready").length;
  const notReady = photos.filter((p) => p.upload_status !== "ready").length;
  const locked = !!(a.archived_at || a.deleted_at);

  const stateForm = (op: string, label: string, kind: "ghost" | "danger" = "ghost", confirm?: { title: string; body: string; confirmLabel: string }) => (
    <ActionForm action={setAlbumState} submitLabel={label} kind={kind} testId={`album-${op}`} confirm={confirm}>
      <input type="hidden" name="id" value={a.id} />
      <input type="hidden" name="op" value={op} />
    </ActionForm>
  );

  return (
    <>
      <PageHeader
        title={a.title}
        back={{ href: "/admin/albums", label: "الألبومات" }}
        lead={
          <span className="flex flex-wrap items-center gap-2">
            {albumState(a)} · {visible} صورة ظاهرة من {photos.length}
            {notReady ? (
              <span className="text-xs text-gold-press" data-testid="album-not-ready">
                · {notReady} صورة لسا مش جاهزة (رفع/تجهيز/فشل) — ما بتظهر بالموقع حتى تجهز
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            <Link href={`/admin/albums/${a.id}/preview`} className={btn("ghost")} data-testid="album-preview-link">
              معاينة
            </Link>
            {locked ? null : a.is_published ? (
              <ActionForm
                action={setAlbumPublished}
                submitLabel="إخفاء الألبوم"
                kind="ghost"
                testId="album-unpublish"
                confirm={{ title: "إخفاء هذا الألبوم؟", body: "يختفي الألبوم وكل صوره من الموقع فوراً.", confirmLabel: "إخفاء" }}
              >
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="publish" value="0" />
              </ActionForm>
            ) : (
              <ActionForm
                action={setAlbumPublished}
                submitLabel="نشر الألبوم"
                kind="primary"
                testId="album-publish"
                confirm={{ title: "نشر هذا الألبوم؟", body: `تظهر الصور الظاهرة والجاهزة فقط للعامة مع اسم المصدر ورابطه${notReady ? ` (${notReady} صورة غير جاهزة لن تظهر حتى تجهز)` : ""}. تأكد من وجود موافقة على نشر الصور.`, confirmLabel: "نشر" }}
              >
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="publish" value="1" />
              </ActionForm>
            )}
          </>
        }
      />
      <div className="space-y-4">
        {a.deleted_at ? <Notice tone="danger">هذا الألبوم في سلة المحذوفات ومخفي عن الموقع.</Notice> : a.archived_at ? <Notice>هذا الألبوم مؤرشف ومخفي عن الموقع.</Notice> : null}
        {a.deleted_at ? null : (
          <Card title="رفع صور">
            <AlbumUploader albumId={a.id} />
          </Card>
        )}

        <Card title={`الصور (${photos.length})`}>
          {photos.length ? (
            <PhotoViews
              initial={view}
              order={photos.length > 1 ? <PhotoReorder albumId={a.id} items={photos.map((p, i) => ({ id: p.id, thumb: thumbOf(p), label: `الصورة ${i + 1}` }))} /> : null}
              details={
            <BulkAltProvider albumId={a.id}>
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="صور الألبوم" data-testid="album-photos">
              {photos.map((p, i) => {
                const url = thumbOf(p);
                const isCover = a.cover_photo_id === p.id;
                return (
                  <li key={p.id} className="rounded-md border border-cream-line p-2" data-testid="album-photo" data-photo-id={p.id} data-status={p.upload_status}>
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                      <img src={url} alt={p.alt_text ?? ""} loading="lazy" className="aspect-[4/3] w-full rounded-sm bg-cream-2 object-contain" />
                    ) : (
                      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-sm bg-cream-2 text-sm text-on-cream-muted">{STATUS_LABEL[p.upload_status] ?? "—"}</div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className="text-xs text-on-cream-muted">#{i + 1}</span>
                      {isCover ? (
                        <span data-testid="photo-cover-badge">
                          <Badge tone="gold">الغلاف الحالي</Badge>
                        </span>
                      ) : null}
                      {p.is_published ? <Badge tone="success">ظاهرة</Badge> : <Badge>مخفية</Badge>}
                      {p.upload_status !== "ready" ? <Badge tone={p.upload_status === "failed" ? "danger" : "neutral"}>{STATUS_LABEL[p.upload_status]}</Badge> : null}
                      {p.upload_status === "ready" && !p.variants?.thumb ? <Badge tone="danger">بلا معاينات</Badge> : null}
                      {p.width && p.height ? (
                        <span className="text-xs text-on-cream-muted" dir="ltr">
                          {p.width}×{p.height}
                        </span>
                      ) : null}
                    </div>
                    {p.upload_status === "failed" && p.last_error ? <p className="mt-1 text-xs text-danger" data-testid="photo-error">{photoErrorText(p.last_error)}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {!isCover && p.upload_status === "ready" ? (
                        <ActionForm action={setAlbumCover} submitLabel="تعيين كغلاف" kind="ghost" inline testId="photo-set-cover">
                          <input type="hidden" name="id" value={p.id} />
                        </ActionForm>
                      ) : null}
                      <ActionForm action={setPhotoPublished} submitLabel={p.is_published ? "إخفاء" : "إظهار"} kind="ghost" inline disabled={!p.is_published && p.upload_status !== "ready"}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="publish" value={p.is_published ? "0" : "1"} />
                      </ActionForm>
                      {p.upload_status === "failed" || p.upload_status === "pending" ? (
                        <ActionForm action={retryAlbumVariants} submitLabel="إعادة المحاولة" kind="ghost" inline>
                          <input type="hidden" name="id" value={p.id} />
                        </ActionForm>
                      ) : null}
                    </div>
                    <AltField photoId={p.id} initial={p.alt_text ?? ""} index={i + 1} />
                    {/* Destructive action apart from the everyday ones, with an explicit confirmation. */}
                    <div className="mt-3 flex justify-end border-t border-cream-line pt-2">
                      <ActionForm
                        action={trashPhoto}
                        submitLabel="نقل إلى السلة"
                        kind="danger"
                        inline
                        testId="photo-trash"
                        confirm={{ title: `نقل الصورة ${i + 1} إلى السلة؟`, body: "تختفي من الألبوم والموقع، ويمكن استرجاعها من «صور في سلة المحذوفات» أسفل الصفحة.", confirmLabel: "نقل إلى السلة" }}
                      >
                        <input type="hidden" name="id" value={p.id} />
                      </ActionForm>
                    </div>
                  </li>
                );
              })}
            </ol>
            </BulkAltProvider>
              }
            />
          ) : (
            <Notice>لا توجد صور بعد.</Notice>
          )}
        </Card>

        {trashed.length ? (
          <Card title={`صور في سلة المحذوفات (${trashed.length})`}>
            <ul className="grid gap-2 sm:grid-cols-4" data-testid="album-trashed-photos">
              {trashed.map((p) => {
                const url = thumbOf(p);
                return (
                  <li key={p.id} className="rounded-md border border-cream-line p-2" data-photo-id={p.id}>
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                      <img src={url} alt="" loading="lazy" className="aspect-square w-full rounded-sm bg-cream-2 object-cover opacity-60" />
                    ) : null}
                    <ActionForm action={restorePhoto} submitLabel="استرجاع" kind="ghost" inline>
                      <input type="hidden" name="id" value={p.id} />
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-on-cream-muted">تبقى ملفاتها في التخزين حتى الحذف النهائي للألبوم.</p>
          </Card>
        ) : null}

        <Card title="بيانات الألبوم">
          <ActionForm action={updateAlbum} submitLabel="حفظ" kind="primary" testId="album-edit">
            <input type="hidden" name="id" value={a.id} />
            <AlbumFields a={a} categories={categories} />
          </ActionForm>
        </Card>

        <Card title="أرشفة وحذف">
          <div className="flex flex-wrap gap-2">
            {a.deleted_at
              ? stateForm("untrash", "استرجاع من سلة المحذوفات")
              : (
                <>
                  {a.archived_at ? stateForm("unarchive", "إخراج من الأرشيف") : stateForm("archive", "أرشفة", "ghost", { title: "أرشفة الألبوم؟", body: "يُخفى من الموقع ويُنقل إلى الأرشيف. يمكن إعادته لاحقاً.", confirmLabel: "أرشفة" })}
                  {stateForm("trash", "نقل إلى سلة المحذوفات", "danger", { title: "نقل الألبوم إلى السلة؟", body: "يُخفى فوراً من الموقع. يمكن استرجاعه من «سلة المحذوفات».", confirmLabel: "نقل" })}
                </>
              )}
          </div>
          {a.deleted_at ? (
            <ActionForm action={purgeAlbum} submitLabel="حذف نهائي" kind="danger" className="mt-4" testId="album-purge">
              <input type="hidden" name="id" value={a.id} />
              <Field label={`للحذف النهائي اكتب معرّف الألبوم: ${a.slug}`} hint="تُحذف كل الصور الأصلية ونسخها من التخزين. لا يمكن التراجع.">
                <input name="confirm_slug" required dir="ltr" autoComplete="off" pattern={a.slug /* slugs are [a-z0-9-] only: no regex escaping needed (escaping "-" is invalid in v-mode) */} className={inputCls} data-testid="album-purge-slug" />
              </Field>
            </ActionForm>
          ) : null}
        </Card>
      </div>
    </>
  );
}

/** Admin-only preview: the public album gallery component, fed with short-lived signed variant URLs so
 *  drafts (and unpublished photos) can be checked before publishing. Nothing here is cached or public. */
export async function AlbumPreviewPage({ params }: { params: IdParams }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const { id } = await params;
  if (!isUuid(id)) return <LoadError what="الألبوم" />;
  const sb = await db();
  const [albumRes, photosRes] = await Promise.all([
    sb.from("photo_albums").select(ALBUM_COLS).eq("id", id).maybeSingle(),
    sb.from("album_photos").select(PHOTO_COLS).eq("album_id", id).is("deleted_at", null).eq("upload_status", "ready").order("sort_order").order("created_at"),
  ]);
  if (albumRes.error || !albumRes.data) return <LoadError what="الألبوم" />;
  const a = albumRes.data as Album;
  const photos = ((photosRes.data ?? []) as Photo[]).filter((p) => p.variants?.thumb && p.variants?.display);
  const shown = photos.filter((p) => p.is_published);
  const urls = await signedMap(sb, shown.flatMap((p) => [p.variants!.thumb, p.variants!.display]));
  return (
    <>
      <PageHeader
        title={`معاينة: ${a.title}`}
        back={{ href: `/admin/albums/${a.id}`, label: "العودة إلى الألبوم" }}
        lead={
          <span className="flex flex-wrap items-center gap-2" data-testid="album-preview">
            {albumState(a)} · هكذا سيظهر للزائر ({shown.length} صورة ظاهرة؛ {photos.length - shown.length} مخفية لا تظهر)
          </span>
        }
      />
      <article className="rounded-md bg-ink p-6 text-on-dark">
        <h2 className="text-3xl font-bold">
          <bdi dir={bidiDir(a.title)}>{a.title}</bdi>
          <span className="text-gold">.</span>
        </h2>
        {a.description ? <p className="mt-3 max-w-3xl whitespace-pre-line text-on-dark/90">{a.description}</p> : null}
        {a.source_label ? <p className="mt-2 text-sm text-muted">المصدر: {a.source_label}</p> : null}
      </article>
      <div className="mt-6 rounded-md bg-cream p-4">
        {shown.length ? (
          <AlbumGallery
            albumTitle={a.title}
            sourceLabel={a.source_label}
            sourceUrl={null}
            photos={shown.map((p) => ({
              id: p.id,
              thumb: urls.get(p.variants!.thumb) ?? "",
              display: urls.get(p.variants!.display) ?? "",
              width: p.width,
              height: p.height,
              alt: p.alt_text ?? "",
            }))}
          />
        ) : (
          <Notice>لا توجد صور ظاهرة جاهزة بعد.</Notice>
        )}
      </div>
    </>
  );
}
