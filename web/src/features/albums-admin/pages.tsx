import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, btn, Card, Field, inputCls, LoadError, Notice, PageHeader, Table } from "@/features/admin/ui";
import { isUuid } from "@/features/admin/result";
import type { IdParams } from "@/features/admin/query";
import { AlbumUploader } from "./AlbumUploader";
import { ALBUM_BUCKET } from "./rules";
import {
  createAlbum,
  deleteAlbum,
  deletePhoto,
  movePhoto,
  retryAlbumVariants,
  setAlbumCover,
  setAlbumPublished,
  setPhotoAlt,
  setPhotoPublished,
  updateAlbum,
} from "./actions";

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
};
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
  upload_status: "pending" | "ready" | "failed";
};
const ALBUM_COLS = "id, slug, title, description, event_date, source_label, source_url, rights_note, cover_photo_id, sort_order, is_published";

function AlbumFields({ a }: { a?: Album }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="العنوان">
        <input name="title" required minLength={2} maxLength={160} defaultValue={a?.title ?? ""} className={inputCls} />
      </Field>
      <Field label="المعرّف في الرابط (slug)" hint="أحرف إنجليزية صغيرة وأرقام و -">
        <input name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,79}" maxLength={80} dir="ltr" defaultValue={a?.slug ?? ""} className={inputCls} />
      </Field>
      <Field label="الوصف (اختياري)" className="sm:col-span-2">
        <textarea name="description" rows={3} maxLength={2000} defaultValue={a?.description ?? ""} className={inputCls} />
      </Field>
      <Field label="تاريخ المناسبة (اختياري)">
        <input name="event_date" type="date" defaultValue={a?.event_date ?? ""} className={inputCls} />
      </Field>
      <Field label="الترتيب" hint="الأصغر يظهر أولاً.">
        <input name="sort_order" type="number" inputMode="numeric" min={-1000} max={100000} step={1} defaultValue={a?.sort_order ?? 100} className={inputCls} />
      </Field>
      <Field label="اسم المصدر (يظهر للعامة)" hint="مثال: فيسبوك — ستوديو السلطان">
        <input name="source_label" maxLength={120} defaultValue={a?.source_label ?? ""} className={inputCls} />
      </Field>
      <Field label="رابط المصدر (يظهر للعامة)" hint="https://www.facebook.com/…">
        <input name="source_url" type="url" maxLength={500} dir="ltr" defaultValue={a?.source_url ?? ""} className={inputCls} />
      </Field>
      <Field label="ملاحظة الحقوق والموافقة (للإدارة فقط)" hint="من صاحب الصور ومن وافق على النشر ومتى." className="sm:col-span-2">
        <textarea name="rights_note" rows={2} maxLength={2000} defaultValue={a?.rights_note ?? ""} className={inputCls} />
      </Field>
    </div>
  );
}

export async function AlbumsPage() {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sb = await createClient();
  const [{ data, error }, photos] = await Promise.all([
    sb.from("photo_albums").select(ALBUM_COLS).order("sort_order").order("created_at", { ascending: false }),
    sb.from("album_photos").select("album_id, is_published, upload_status"),
  ]);
  if (error) return <LoadError what="الألبومات" />;
  const rows = (data ?? []) as Album[];
  const counts = new Map<string, { all: number; visible: number }>();
  for (const p of photos.data ?? []) {
    const c = counts.get(p.album_id) ?? { all: 0, visible: 0 };
    c.all++;
    if (p.is_published && p.upload_status === "ready") c.visible++;
    counts.set(p.album_id, c);
  }
  return (
    <>
      <PageHeader title="الألبومات" lead="ألبومات صور تُعرض في الموقع العام بعد النشر. الصور في تخزين خاص ولا تُقرأ إلا وهي منشورة." />
      <div className="space-y-4">
        <Table head={["الألبوم", "التاريخ", "الصور", "الحالة", ""]} empty={!rows.length} label="قائمة الألبومات">
          {rows.map((a) => {
            const c = counts.get(a.id) ?? { all: 0, visible: 0 };
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
                <td className="px-3 py-2 text-sm">{a.event_date ?? "—"}</td>
                <td className="px-3 py-2 text-sm">
                  {c.visible} ظاهرة من {c.all}
                </td>
                <td className="px-3 py-2">{a.is_published ? <Badge tone="success">منشور</Badge> : <Badge>مخفي</Badge>}</td>
                <td className="px-3 py-2">
                  <Link href={`/admin/albums/${a.id}`} className={btn("ghost")}>
                    إدارة
                  </Link>
                </td>
              </tr>
            );
          })}
        </Table>
        <Card title="ألبوم جديد">
          <ActionForm action={createAlbum} submitLabel="إنشاء الألبوم" kind="primary" testId="album-create">
            <AlbumFields />
          </ActionForm>
          <p className="mt-2 text-xs text-on-cream-muted">يُنشأ الألبوم مخفياً؛ ارفع الصور ثم انشره من صفحته.</p>
        </Card>
      </div>
    </>
  );
}

export async function AlbumEditPage({ params }: { params: IdParams }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const { id } = await params;
  if (!isUuid(id)) return <LoadError what="الألبوم" />;
  const sb = await createClient();
  const [albumRes, photosRes] = await Promise.all([
    sb.from("photo_albums").select(ALBUM_COLS).eq("id", id).maybeSingle(),
    sb
      .from("album_photos")
      .select("id, storage_path_original, variants, width, height, bytes, alt_text, sort_order, is_published, upload_status")
      .eq("album_id", id)
      .order("sort_order")
      .order("created_at"),
  ]);
  if (albumRes.error || !albumRes.data) return <LoadError what="الألبوم" />;
  const a = albumRes.data as Album;
  const photos = (photosRes.data ?? []) as Photo[];
  // Admin previews: short-lived signed URLs (admin storage policy), thumb variant when available.
  const previewPath = (p: Photo) => p.variants?.thumb ?? p.storage_path_original;
  const ready = photos.filter((p) => p.upload_status === "ready");
  const signed = ready.length ? await sb.storage.from(ALBUM_BUCKET).createSignedUrls(ready.map(previewPath), 600) : { data: [] };
  const urlByPath = new Map((signed.data ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
  const visible = photos.filter((p) => p.is_published && p.upload_status === "ready").length;

  return (
    <>
      <PageHeader
        title={a.title}
        back={{ href: "/admin/albums", label: "الألبومات" }}
        lead={
          <span>
            {a.is_published ? "منشور" : "مخفي"} · {visible} صورة ظاهرة من {photos.length}
          </span>
        }
        actions={
          a.is_published ? (
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
              confirm={{
                title: "نشر هذا الألبوم؟",
                body: "تظهر الصور الظاهرة للعامة مع اسم المصدر ورابطه. تأكد من وجود موافقة على نشر الصور.",
                confirmLabel: "نشر",
              }}
            >
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="publish" value="1" />
            </ActionForm>
          )
        }
      />
      <div className="space-y-4">
        <Card title="رفع صور">
          <AlbumUploader albumId={a.id} />
        </Card>

        <Card title={`الصور (${photos.length})`}>
          {photos.length ? (
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="صور الألبوم" data-testid="album-photos">
              {photos.map((p, i) => {
                const url = urlByPath.get(previewPath(p));
                const isCover = a.cover_photo_id === p.id;
                return (
                  <li key={p.id} className="rounded-md border border-cream-line p-2" data-testid="album-photo" data-photo-id={p.id} data-status={p.upload_status}>
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                      <img src={url} alt={p.alt_text ?? ""} loading="lazy" className="aspect-[4/3] w-full rounded-sm bg-cream-2 object-contain" />
                    ) : (
                      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-sm bg-cream-2 text-sm text-on-cream-muted">
                        {p.upload_status === "failed" ? "فشل الرفع" : "قيد الرفع"}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className="text-xs text-on-cream-muted">#{i + 1}</span>
                      {isCover ? <Badge tone="gold">الغلاف</Badge> : null}
                      {p.is_published ? <Badge tone="success">ظاهرة</Badge> : <Badge>مخفية</Badge>}
                      {p.upload_status !== "ready" ? <Badge tone="danger">{p.upload_status === "failed" ? "فشل" : "غير مكتمل"}</Badge> : null}
                      {p.upload_status === "ready" && !p.variants?.thumb ? <Badge tone="danger">بلا معاينات</Badge> : null}
                      {p.width && p.height ? (
                        <span className="text-xs text-on-cream-muted" dir="ltr">
                          {p.width}×{p.height}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <ActionForm action={movePhoto} submitLabel="↑ تقديم" kind="ghost" inline disabled={i === 0}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="dir" value="up" />
                      </ActionForm>
                      <ActionForm action={movePhoto} submitLabel="↓ تأخير" kind="ghost" inline disabled={i === photos.length - 1}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="dir" value="down" />
                      </ActionForm>
                      {!isCover && p.upload_status === "ready" ? (
                        <ActionForm action={setAlbumCover} submitLabel="غلاف" kind="ghost" inline>
                          <input type="hidden" name="id" value={p.id} />
                        </ActionForm>
                      ) : null}
                      <ActionForm action={setPhotoPublished} submitLabel={p.is_published ? "إخفاء" : "إظهار"} kind="ghost" inline>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="publish" value={p.is_published ? "0" : "1"} />
                      </ActionForm>
                      {p.upload_status === "ready" && !p.variants?.thumb ? (
                        <ActionForm action={retryAlbumVariants} submitLabel="إعادة إنشاء المعاينات" kind="ghost" inline>
                          <input type="hidden" name="id" value={p.id} />
                        </ActionForm>
                      ) : null}
                      <ActionForm
                        action={deletePhoto}
                        submitLabel="حذف"
                        kind="danger"
                        inline
                        confirm={{ title: "حذف هذه الصورة؟", body: "تُحذف الصورة الأصلية ونسخها من التخزين نهائياً.", confirmLabel: "حذف" }}
                      >
                        <input type="hidden" name="id" value={p.id} />
                      </ActionForm>
                    </div>
                    <ActionForm action={setPhotoAlt} submitLabel="حفظ الوصف" kind="ghost" className="mt-2">
                      <input type="hidden" name="id" value={p.id} />
                      <Field label="وصف الصورة (نص بديل)">
                        <input name="alt_text" maxLength={300} defaultValue={p.alt_text ?? ""} className={inputCls} />
                      </Field>
                    </ActionForm>
                  </li>
                );
              })}
            </ol>
          ) : (
            <Notice>لا توجد صور بعد.</Notice>
          )}
        </Card>

        <Card title="بيانات الألبوم">
          <ActionForm action={updateAlbum} submitLabel="حفظ" kind="primary" testId="album-edit">
            <input type="hidden" name="id" value={a.id} />
            <AlbumFields a={a} />
          </ActionForm>
        </Card>

        <Card title="حذف الألبوم">
          <ActionForm
            action={deleteAlbum}
            submitLabel="حذف الألبوم وكل صوره"
            kind="danger"
            testId="album-delete"
            confirm={{ title: "حذف الألبوم نهائياً؟", body: "تُحذف كل الصور الأصلية ونسخها من التخزين. لا يمكن التراجع.", confirmLabel: "حذف" }}
          >
            <input type="hidden" name="id" value={a.id} />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
