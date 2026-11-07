import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, Card, LoadError, Notice, PageHeader } from "@/features/admin/ui";
import { isUuid } from "@/features/admin/result";
import type { IdParams } from "@/features/admin/query";
import { signedMap } from "@/features/albums-admin/pages";
import { publishAlbumToFacebook } from "./album-actions";

type Photo = { id: string; variants: { thumb?: string } | null; storage_provider: string | null; is_published: boolean; alt_text: string | null };
type Post = { status: string; page_name: string; photo_ids: string[]; done: Record<string, string>; fb_album_id: string | null; fb_album_url: string | null; last_error: string | null };

/**
 * «نشر على فيسبوك» for one album: shows the connected Page's name and the photos that will go up BEFORE anything is
 * sent, then creates a real Facebook album (never a multi-photo post). Separate from «نشر الألبوم» on the site.
 */
export async function AlbumFacebookPage({ params }: { params: IdParams }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const { id } = await params;
  if (!isUuid(id)) return <LoadError what="الألبوم" />;
  const sb = (await createClient()) as unknown as SupabaseClient;
  // The connection row is owner-readable under RLS; admins who may publish still need the Page NAME and status (only
  // those two columns, read on the server — never the token).
  const service = createAdminClient() as unknown as SupabaseClient | null;
  const [albumRes, photosRes, connRes, postRes] = await Promise.all([
    sb.from("photo_albums").select("id, title, archived_at, deleted_at").eq("id", id).maybeSingle(),
    sb.from("album_photos").select("id, variants, storage_provider, is_published, alt_text").eq("album_id", id).eq("upload_status", "ready").is("deleted_at", null).order("sort_order").order("created_at").order("id"),
    (service ?? sb).from("meta_page_connection").select("page_name, status").eq("id", 1).maybeSingle(),
    sb.from("facebook_album_posts").select("status, page_name, photo_ids, done, fb_album_id, fb_album_url, last_error").eq("album_id", id).maybeSingle(),
  ]);
  if (albumRes.error || !albumRes.data) return <LoadError what="الألبوم" />;
  const a = albumRes.data as { id: string; title: string; archived_at: string | null; deleted_at: string | null };
  const photos = (photosRes.data ?? []) as Photo[];
  const conn = connRes.data as { page_name: string; status: string } | null;
  const post = (postRes.data ?? null) as Post | null;
  const urls = await signedMap(sb, photos as never, ["thumb"]);
  const connected = conn?.status === "connected";
  const started = !!post && (!!post.fb_album_id || Object.keys(post.done ?? {}).length > 0);
  // Before anything is on Facebook the owner picks the photos; after that the run continues the same selection.
  const selectable = !started;
  const preselected = new Set(post?.photo_ids?.length ? post.photo_ids : photos.filter((p) => p.is_published).map((p) => p.id));
  const shown = started ? photos.filter((p) => post!.photo_ids.includes(p.id)) : photos;
  const back = { href: `/admin/albums/${a.id}`, label: a.title };

  return (
    <>
      <PageHeader title="نشر على فيسبوك" back={back} lead="ينشئ ألبوم صور حقيقي على صفحة الاستوديو، منفصل عن نشر الألبوم على الموقع. لا إعلانات ولا ترويج مدفوع." />
      <div className="space-y-4">
        <Card title="الصفحة">
          <div data-testid="fb-album-page" data-status={conn?.status ?? "none"} className="text-sm">
            {connected ? (
              <p>
                <Badge tone="success">مربوطة</Badge> سيُنشر على صفحة: <strong data-testid="fb-album-page-name">{conn!.page_name}</strong>
              </p>
            ) : (
              <p>
                <Badge tone="danger">غير مربوطة</Badge> اربط صفحة الاستوديو من الإعدادات › صفحة فيسبوك أولاً.
              </p>
            )}
          </div>
        </Card>

        {post?.status === "published" ? (
          <Notice>
            <span data-testid="fb-album-published">
              هذا الألبوم منشور على فيسبوك ({Object.keys(post.done).length} صورة على صفحة {post.page_name}).{" "}
              {post.fb_album_url ? (
                <a href={post.fb_album_url} target="_blank" rel="noopener noreferrer" className="font-medium underline" data-testid="fb-album-link">
                  فتح الألبوم على فيسبوك
                </a>
              ) : null}{" "}
              لا يُنشر مرتين.
            </span>
          </Notice>
        ) : post?.last_error ? (
          <Notice tone="danger">
            <span data-testid="fb-album-error">{post.last_error}</span>
          </Notice>
        ) : started ? (
          <Notice>
            <span data-testid="fb-album-partial">
              أُرسلت {Object.keys(post!.done).length} من {post!.photo_ids.length} صورة إلى نفس الألبوم. اضغط «متابعة النشر» لإكمال الباقي.
            </span>
          </Notice>
        ) : null}

        {post?.status === "published" ? null : (
          <Card title={`الصور (${shown.length})`}>
            {!photos.length ? (
              <p className="text-sm">لا توجد صور جاهزة في هذا الألبوم.</p>
            ) : (
              <ActionForm
                action={publishAlbumToFacebook}
                submitLabel={started ? "متابعة النشر" : "نشر على فيسبوك"}
                kind="primary"
                testId="fb-album-submit"
                disabled={!connected || !!a.archived_at || !!a.deleted_at}
                confirm={{
                  title: started ? "متابعة النشر على فيسبوك؟" : "نشر هذا الألبوم على فيسبوك؟",
                  body: `سيُنشأ ألبوم «${a.title}» على صفحة «${conn?.page_name ?? ""}» بالصور المحددة فقط. يظهر للعامة على فيسبوك فوراً، ولا يُنشر الألبوم نفسه مرتين. تأكد أن الصور مسموح نشرها.`,
                  confirmLabel: started ? "متابعة" : "نشر",
                }}
              >
                <input type="hidden" name="album_id" value={a.id} />
                <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6" data-testid="fb-album-photos">
                  {shown.map((p) => {
                    const thumb = p.variants?.thumb ? urls.get(p.variants.thumb) : null;
                    const sent = !!post?.done?.[p.id];
                    return (
                      <li key={p.id}>
                        <label className="block cursor-pointer rounded-sm border border-hairline p-1 has-[:checked]:border-gold">
                          <span className="block aspect-square bg-night-deep">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {thumb ? <img src={thumb} alt={p.alt_text ?? ""} className="size-full object-contain" loading="lazy" /> : null}
                          </span>
                          <span className="mt-1 flex min-h-11 items-center gap-2 text-xs">
                            {selectable ? (
                              <input type="checkbox" name="photo" value={p.id} defaultChecked={preselected.has(p.id)} className="size-5" data-testid="fb-album-photo" />
                            ) : (
                              <input type="hidden" name="photo" value={p.id} />
                            )}
                            {sent ? "على فيسبوك" : p.is_published ? "ظاهرة بالموقع" : "مخفية بالموقع"}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </ActionForm>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
