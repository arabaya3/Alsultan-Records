import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { youTubeThumbUrl, youTubeWatchUrl } from "@/lib/youtube";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, btn, Card, DL, Field, inputCls, LoadError, PageHeader, Table } from "@/features/admin/ui";
import { isUuid } from "@/features/admin/result";
import type { IdParams } from "@/features/admin/query";
import { createVideo, deleteVideo, makePromo, setVideoPublished, updateVideo } from "./actions";
import { VIDEO_CATEGORIES, VIDEO_CATEGORY_LABEL, type VideoCategory } from "./schema";

const COLS = "id, youtube_id, title, description, category, duration_seconds, published_at, is_promo, sort_order, is_published";

type VideoRow = {
  id: string;
  youtube_id: string;
  title: string;
  description: string | null;
  category: string;
  sort_order: number;
  is_published: boolean;
  is_promo: boolean;
};

const catLabel = (c: string) => VIDEO_CATEGORY_LABEL[c as VideoCategory] ?? c;

function VideoFields({ v }: { v?: VideoRow }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="رابط الفيديو على يوتيوب أو معرّفه" hint="مثال: https://www.youtube.com/watch?v=… أو youtu.be/… — لا تلصق كود تضمين." className="sm:col-span-2">
        <input name="youtube" required maxLength={500} dir="ltr" defaultValue={v ? youTubeWatchUrl(v.youtube_id) : ""} className={inputCls} />
      </Field>
      <Field label="العنوان المعروض" hint="بين 2 و120 حرفاً، دون أسماء أشخاص.">
        <input name="title" required minLength={2} maxLength={120} defaultValue={v?.title ?? ""} className={inputCls} />
      </Field>
      <Field label="التصنيف">
        <select name="category" required defaultValue={v?.category ?? "wedding"} className={inputCls}>
          {VIDEO_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {VIDEO_CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="الوصف (اختياري)" hint="حتى 500 حرف." className="sm:col-span-2">
        <textarea name="description" rows={3} maxLength={500} defaultValue={v?.description ?? ""} className={inputCls} />
      </Field>
      <Field label="الترتيب" hint="الأصغر يظهر أولاً.">
        <input name="sort_order" type="number" inputMode="numeric" min={-1000} max={100000} step={1} defaultValue={v?.sort_order ?? 100} className={inputCls} />
      </Field>
      <fieldset className="space-y-2 text-sm">
        <legend className="mb-1 font-medium">الظهور</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="is_published" defaultChecked={v ? v.is_published : true} /> منشور في الموقع
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="is_promo" defaultChecked={v?.is_promo ?? false} /> الفيديو التعريفي (يحل محل الحالي)
        </label>
      </fieldset>
    </div>
  );
}

export async function VideosPage() {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sb = await createClient();
  const { data, error } = await sb.from("showcase_videos").select(COLS).order("sort_order").order("created_at");
  if (error) return <LoadError what="الفيديوهات" />;
  const rows = (data ?? []) as VideoRow[];
  return (
    <>
      <PageHeader title="الفيديوهات" lead="مقاطع من قناة الاستوديو على يوتيوب تُعرض في الموقع العام. يُحفظ معرّف الفيديو فقط." />
      <div className="space-y-4">
        <Table head={["الفيديو", "التصنيف", "الترتيب", "الحالة", "إجراءات"]} empty={!rows.length} label="قائمة الفيديوهات">
          {rows.map((v) => (
            <tr key={v.id} data-testid="video-row" data-youtube-id={v.youtube_id}>
              <td className="px-3 py-2">
                <div className="flex items-center gap-3">
                  <Image src={youTubeThumbUrl(v.youtube_id)} alt="" width={96} height={54} className="h-[54px] w-24 shrink-0 rounded-sm object-cover" />
                  <div className="min-w-0">
                    <Link href={`/admin/videos/${v.id}`} className="font-medium underline-offset-2 hover:underline">
                      {v.title}
                    </Link>
                    <p className="text-xs text-on-cream-muted" dir="ltr">{v.youtube_id}</p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2 text-sm">{catLabel(v.category)}</td>
              <td className="px-3 py-2 text-sm">{v.sort_order}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {v.is_published ? <Badge tone="success">منشور</Badge> : <Badge>مخفي</Badge>}
                  {v.is_promo ? <Badge tone="gold">تعريفي</Badge> : null}
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <ActionForm action={setVideoPublished} submitLabel={v.is_published ? "إخفاء" : "نشر"} kind="ghost" inline>
                    <input type="hidden" name="id" value={v.id} />
                    <input type="hidden" name="publish" value={v.is_published ? "0" : "1"} />
                  </ActionForm>
                  {!v.is_promo ? (
                    <ActionForm action={makePromo} submitLabel="اجعله تعريفياً" kind="ghost" inline>
                      <input type="hidden" name="id" value={v.id} />
                    </ActionForm>
                  ) : null}
                  <Link href={`/admin/videos/${v.id}`} className={btn("ghost")}>
                    تعديل
                  </Link>
                  <ActionForm
                    action={deleteVideo}
                    submitLabel="حذف"
                    kind="danger"
                    inline
                    confirm={{ title: "حذف هذا الفيديو؟", body: "يُزال من الموقع ومن هذه القائمة. لا يتأثر الفيديو على يوتيوب.", confirmLabel: "حذف" }}
                  >
                    <input type="hidden" name="id" value={v.id} />
                  </ActionForm>
                </div>
              </td>
            </tr>
          ))}
        </Table>
        <Card title="إضافة فيديو">
          <ActionForm action={createVideo} submitLabel="إضافة" kind="primary" resetOnSuccess testId="video-create">
            <VideoFields />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

export async function VideoEditPage({ params }: { params: IdParams }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const { id } = await params;
  if (!isUuid(id)) return <LoadError what="الفيديو" />;
  const sb = await createClient();
  const [row, details] = await Promise.all([
    sb.from("showcase_videos").select(COLS).eq("id", id).maybeSingle(),
    sb.from("showcase_video_admin_details").select("original_title, source, verification_notes").eq("video_id", id).maybeSingle(),
  ]);
  if (row.error || !row.data) return <LoadError what="الفيديو" />;
  const v = row.data as VideoRow;
  const d = details.data;
  return (
    <>
      <PageHeader title={v.title} back={{ href: "/admin/videos", label: "الفيديوهات" }} />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card title="تعديل الفيديو">
          <ActionForm action={updateVideo} submitLabel="حفظ" kind="primary" testId="video-edit">
            <input type="hidden" name="id" value={v.id} />
            <VideoFields v={v} />
          </ActionForm>
        </Card>
        <div className="space-y-4">
          <Card title="المعاينة">
            <Image src={youTubeThumbUrl(v.youtube_id)} alt="" width={480} height={270} className="w-full rounded-sm" />
            <a href={youTubeWatchUrl(v.youtube_id)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm underline" dir="ltr">
              {youTubeWatchUrl(v.youtube_id)}
            </a>
          </Card>
          <Card title="سجل المصدر (للإدارة فقط)">
            <DL
              items={[
                ["العنوان الأصلي", d?.original_title ?? "—"],
                ["المصدر", d?.source ?? "—"],
                ["ملاحظات التحقق", d?.verification_notes ? <span className="whitespace-pre-line">{d.verification_notes}</span> : "—"],
              ]}
            />
          </Card>
          <Card title="حذف">
            <ActionForm
              action={deleteVideo}
              submitLabel="حذف الفيديو"
              kind="danger"
              confirm={{ title: "حذف هذا الفيديو؟", body: "يُزال من الموقع ومن القائمة. لا يتأثر الفيديو على يوتيوب.", confirmLabel: "حذف" }}
            >
              <input type="hidden" name="id" value={v.id} />
              <input type="hidden" name="from" value="edit" />
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
