import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ALL_STAFF, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, LoadError, Notice, PageHeader, Pagination, RowLink, SearchBox, Table } from "@/features/admin/ui";
import { cleanSearch, one, pageOf, rangeOf, type SP } from "@/features/admin/query";
import { fmtBytes, fmtDate } from "@/features/admin/format";
import { UPLOAD_STATUS } from "@/features/admin/labels";
import { isUuid } from "@/features/admin/result";
import { cleanupPublic, runStorageCleanup } from "./actions";
import { deleteMediaItems, publishMediaItem, retryVariants, unpublishMediaItem } from "./media-actions";
import { MediaUploader } from "./MediaUploader";
import { signMediaUrls } from "@/features/media/sign";

const MEDIA_PAGE = 48;

export async function MediaIndex({ searchParams }: { searchParams: SP }) {
  const session = await guard(ALL_STAFF);
  if (!session) return <Forbidden />;
  const sp = await searchParams;
  const orphans = one(sp.orphans) === "1";
  const q = cleanSearch(one(sp.q));
  const page = pageOf(sp.page);
  const sb = await createClient();

  if (orphans && session.role !== "staff") {
    const { data, error } = await sb
      .from("media_assets")
      .select("event_id, events(title)")
      .eq("bucket", "public-media")
      .eq("visibility", "private")
      .not("event_id", "is", null)
      .limit(1000);
    const byEvent = new Map<string, { title: string; n: number }>();
    for (const r of data ?? []) if (r.event_id) byEvent.set(r.event_id, { title: r.events?.title ?? "—", n: (byEvent.get(r.event_id)?.n ?? 0) + 1 });
    return (
      <>
        <PageHeader title="نسخ عامة يجب إزالتها" lead="مناسبات توقف نشرها وما زالت لها سجلات نسخ عامة. «إزالة» يحذف السجلات ويشغّل قائمة حذف الملفات." back={{ href: "/admin/media", label: "الوسائط" }} />
        <div className="mb-3"><ActionForm action={runStorageCleanup} submitLabel="تشغيل قائمة حذف الملفات" kind="ghost" /></div>
        {error ? <LoadError /> : (
          <Table head={["المناسبة", "عدد الملفات", ""]} empty={!byEvent.size}>
            {[...byEvent.entries()].map(([id, v]) => (
              <tr key={id}>
                <td><RowLink href={`/admin/events/${id}`}>{v.title}</RowLink></td>
                <td>{v.n}</td>
                <td>
                  <ActionForm action={cleanupPublic} submitLabel="إزالة" kind="danger" inline>
                    <input type="hidden" name="id" value={id} />
                  </ActionForm>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </>
    );
  }

  let query = sb.from("events").select("id, title, event_date, is_published", { count: "exact" }).order("event_date", { ascending: false, nullsFirst: false });
  if (q) query = query.ilike("title", `%${q}%`);
  const { data, count, error } = await query.range(...rangeOf(page));
  return (
    <>
      <PageHeader title="الوسائط" lead="اختر مناسبة لرفع ملفاتها أو إدارة نشر صورها." />
      <SearchBox base="/admin/media" q={q} params={{ q }} placeholder="بحث باسم المناسبة" />
      {error ? <LoadError /> : (
        <>
          <Table head={["المناسبة", "التاريخ", "النشر"]} empty={!data?.length}>
            {data?.map((e) => (
              <tr key={e.id}>
                <td><RowLink href={`/admin/events/${e.id}/media`}>{e.title}</RowLink></td>
                <td>{fmtDate(e.event_date)}</td>
                <td>{e.is_published ? <Badge tone="success">منشورة</Badge> : <Badge>خاصة</Badge>}</td>
              </tr>
            ))}
          </Table>
          <Pagination base="/admin/media" page={page} total={count ?? 0} size={25} params={{ q }} />
        </>
      )}
    </>
  );
}

export async function EventMedia({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const session = await guard(ALL_STAFF);
  if (!session) return <Forbidden />;
  const isAdmin = session.role !== "staff";
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const page = pageOf(sp.page);
  const sb = await createClient();
  const ev = await sb.from("events").select("id, title, is_published, publication_consent").eq("id", id).maybeSingle();
  if (ev.error) return <LoadError />;
  if (!ev.data) notFound();
  const publishable = ev.data.is_published && ev.data.publication_consent === "granted";

  const [assets, pubs] = await Promise.all([
    sb
      .from("media_assets")
      .select("id, path, kind, mime, bytes, width, height, variants, upload_status, created_at", { count: "exact" })
      .eq("event_id", id)
      .eq("bucket", "private-media")
      .order("created_at", { ascending: false })
      .range(...rangeOf(page, MEDIA_PAGE)),
    sb.from("media_assets").select("id, path").eq("event_id", id).eq("bucket", "public-media").eq("visibility", "public"),
  ]);
  if (assets.error) return <LoadError what="الوسائط" />;
  const publicBySource = new Map<string, string>();
  for (const p of pubs.data ?? []) {
    // public copy lives at events/{event}/{source asset id}/display.webp
    const s = p.path.split("/")[2];
    if (typeof s === "string") publicBySource.set(s, p.id);
  }
  const imgs = (assets.data ?? []).filter((a) => a.kind === "image" && a.upload_status === "ready");
  const urls = new Map<string, string>();
  for (const r of await signMediaUrls({ assetIds: imgs.map((a) => a.id), variant: "thumb" })) if (r.url) urls.set(r.key, r.url);

  return (
    <>
      <PageHeader
        title={`وسائط · ${ev.data.title}`}
        back={{ href: `/admin/events/${id}`, label: "المناسبة" }}
        actions={publishable ? <Badge tone="success">المناسبة منشورة</Badge> : <Badge>المناسبة غير منشورة</Badge>}
      />
      <Card title="رفع ملفات" className="mb-4">
        <MediaUploader eventId={id} />
      </Card>
      {isAdmin && !publishable ? (
        <div className="mb-4">
          <Notice>نشر الصور في صفحة الأعمال متاح فقط بعد موافقة العميل ونشر المناسبة.</Notice>
        </div>
      ) : null}
      <Card
        title={`الملفات (${assets.count ?? 0})`}
        actions={
          isAdmin ? (
            <ActionForm
              id="bulk-delete"
              action={deleteMediaItems}
              submitLabel="حذف المحدد"
              kind="danger"
              inline
              confirm={{ title: "حذف الملفات المحددة؟", body: "تُحذف الملفات الأصلية ومعايناتها ونسخها العامة نهائياً.", confirmLabel: "حذف" }}
            >
              <input type="hidden" name="event_id" value={id} />
            </ActionForm>
          ) : null
        }
      >
        {assets.data?.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="media-grid">
            {assets.data.map((a) => {
              const url = urls.get(a.id);
              const hasVariants = !!(a.variants as Record<string, unknown> | null)?.display;
              const publicId = publicBySource.get(a.id);
              return (
                <li key={a.id} className="overflow-hidden rounded-md border border-cream-line text-xs" data-testid="media-item" data-variants={hasVariants ? "1" : "0"}>
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                    <img src={url} alt="" loading="lazy" className="aspect-[4/3] w-full bg-cream-2 object-cover" />
                  ) : (
                    <div className="grid aspect-[4/3] place-items-center bg-cream-2 text-on-cream-muted">
                      {a.kind === "video" ? "فيديو" : a.kind === "document" ? "ملف" : "بدون معاينة"}
                    </div>
                  )}
                  <div className="space-y-1.5 p-2">
                    <div className="flex items-center justify-between gap-1">
                      {isAdmin ? (
                        <label className="flex items-center gap-1">
                          <input type="checkbox" name="ids" value={a.id} form="bulk-delete" aria-label="تحديد" />
                          {fmtBytes(a.bytes)}
                        </label>
                      ) : (
                        <span>{fmtBytes(a.bytes)}</span>
                      )}
                      <Badge tone={a.upload_status === "failed" ? "danger" : a.upload_status === "pending" ? "gold" : "neutral"}>
                        {UPLOAD_STATUS[a.upload_status]}
                      </Badge>
                    </div>
                    {a.width ? <p className="text-on-cream-muted" dir="ltr">{a.width}×{a.height}</p> : null}
                    {a.kind === "image" && a.upload_status === "ready" && !hasVariants ? (
                      <ActionForm action={retryVariants} submitLabel="إنشاء المعاينات" kind="ghost" inline>
                        <input type="hidden" name="id" value={a.id} />
                      </ActionForm>
                    ) : null}
                    {isAdmin && a.kind === "image" && hasVariants ? (
                      publicId ? (
                        <ActionForm action={unpublishMediaItem} submitLabel="إلغاء النشر" kind="ghost" inline>
                          <input type="hidden" name="public_id" value={publicId} />
                          <input type="hidden" name="event_id" value={id} />
                        </ActionForm>
                      ) : (
                        <ActionForm action={publishMediaItem} submitLabel="نشر في الأعمال" kind="ghost" inline disabled={!publishable}>
                          <input type="hidden" name="id" value={a.id} />
                        </ActionForm>
                      )
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-on-cream-muted">لا توجد ملفات بعد.</p>
        )}
        <Pagination base={`/admin/events/${id}/media`} page={page} total={assets.count ?? 0} size={MEDIA_PAGE} params={{}} />
      </Card>
      <p className="mt-4 text-xs text-on-cream-muted">
        الفيديو يُحفظ كملف أصلي خاص. البث للعامة يتم عبر مزوّد بث خارجي (انظر توثيق النسخ الاحتياطي والوسائط). <Link className="underline" href="/admin/production">الإنتاج والتسليم</Link>
      </p>
    </>
  );
}
