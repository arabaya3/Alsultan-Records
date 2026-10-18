import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { youTubeThumbUrl, youTubeWatchUrl } from "@/lib/youtube";
import { ADMIN_ROLES, Forbidden, guard } from "@/features/admin/guard";
import { ActionForm } from "@/features/admin/ActionForm";
import { Badge, btn, Card, DL, Field, FilterChips, inputCls, LoadError, Notice, PageHeader, Table } from "@/features/admin/ui";
import { isUuid } from "@/features/admin/result";
import { PhotoPicker, type PickPhoto } from "@/features/cms-admin/fields";
import { pickPhotos } from "@/features/cms-admin/data";
import type { SupabaseClient } from "@supabase/supabase-js";
import { one, type IdParams, type SP } from "@/features/admin/query";
import {
  createCategory,
  createVideo,
  deleteCategory,
  deleteVideo,
  makePromo,
  markReviewed,
  moveCategory,
  restoreYouTubeTitle,
  setVideoPinned,
  setVideoRole,
  setCategoryPublished,
  setVideoPublished,
  updateCategory,
  updateVideo,
} from "./actions";

// title_source / needs_review are admin-only: column grants exclude them for the shared `authenticated`
// role, so they are read from the admin-only view showcase_video_admin_details and merged by id.
const COLS = "id, youtube_id, title, description, duration_seconds, published_at, is_promo, sort_order, is_published, role, pinned, custom_cover_photo_id";
const ADMIN_COLS = "video_id, title_source, needs_review";
type AdminFlags = { video_id: string; title_source: string; needs_review: boolean };

type VideoRow = {
  id: string;
  youtube_id: string;
  title: string;
  title_source: string;
  needs_review: boolean;
  description: string | null;
  sort_order: number;
  is_published: boolean;
  is_promo: boolean;
  role: string;
  pinned: boolean;
  custom_cover_photo_id: string | null;
};
const ROLE_LABEL: Record<string, string> = { work: "أعمال", promo: "برومو", both: "أعمال وبرومو" };
type Category = { id: string; slug: string; title: string; sort_order: number; is_published: boolean };
type Link_ = { video_id: string; category_id: string; is_primary: boolean };
type Details = {
  youtube_title: string | null;
  youtube_description: string | null;
  original_title: string | null;
  source: string | null;
  verification_notes: string | null;
  review_note: string | null;
  reviewed_at: string | null;
};

function VideoFields({ v, cats, links, details, photos }: { v?: VideoRow; cats: Category[]; links: Link_[]; details?: Details | null; photos: PickPhoto[] }) {
  const selected = new Set(links.map((l) => l.category_id));
  const primary = links.find((l) => l.is_primary)?.category_id ?? "";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="رابط الفيديو على يوتيوب أو معرّفه" hint="مثال: https://www.youtube.com/watch?v=… أو youtu.be/… — لا تلصق كود تضمين." className="sm:col-span-2">
        <input name="youtube" required maxLength={500} dir="ltr" defaultValue={v ? youTubeWatchUrl(v.youtube_id) : ""} className={inputCls} />
      </Field>
      <Field
        label="العنوان المعروض"
        hint={
          v?.title_source === "youtube"
            ? "مطابق لعنوان YouTube ويُحدَّث مع الاستيراد. تعديله يجعله يدوياً."
            : "عنوان يدوي: لن يغيّره الاستيراد. حتى 200 حرف."
        }
        className="sm:col-span-2"
      >
        <input name="title" required minLength={2} maxLength={200} defaultValue={v?.title ?? ""} className={inputCls} />
      </Field>
      <fieldset className="text-sm sm:col-span-2" data-testid="video-role">
        <legend className="mb-1 font-medium">دور الفيديو (منفصل عن التصنيف)</legend>
        {(["work", "promo", "both"] as const).map((r) => (
          <label key={r} className="me-4 inline-flex min-h-10 items-center gap-2">
            <input type="radio" name="role" value={r} defaultChecked={(v?.role ?? "work") === r} /> {ROLE_LABEL[r]}
          </label>
        ))}
      </fieldset>
      <div className="sm:col-span-2">
        <PhotoPicker name="custom_cover_photo_id" label="غلاف مخصص (اختياري، بدل صورة يوتيوب)" photos={photos} defaultValue={v?.custom_cover_photo_id} />
      </div>
      <fieldset className="sm:col-span-2 text-sm" data-testid="video-categories">
        <legend className="mb-1 font-medium">التصنيفات (اختر واحداً أو أكثر، وحدّد الرئيسي)</legend>
        {cats.length ? (
          <ul className="grid gap-1 sm:grid-cols-2">
            {cats.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-sm border border-cream-line px-2 py-1">
                <label className="flex min-h-8 items-center gap-2">
                  <input type="checkbox" name="category_ids" value={c.id} defaultChecked={selected.has(c.id)} />
                  {c.title}
                  {!c.is_published ? <span className="text-xs text-on-cream-muted">(مخفي)</span> : null}
                </label>
                <label className="ms-auto flex items-center gap-1 text-xs">
                  <input type="radio" name="primary_category" value={c.id} defaultChecked={primary === c.id} aria-label={`${c.title} تصنيف رئيسي`} />
                  رئيسي
                </label>
              </li>
            ))}
            <li className="flex items-center gap-2 px-2 py-1 text-xs">
              <label className="flex items-center gap-1">
                <input type="radio" name="primary_category" value="" defaultChecked={!primary} /> بلا تصنيف رئيسي
              </label>
            </li>
          </ul>
        ) : (
          <p className="text-on-cream-muted">
            لا توجد تصنيفات بعد. <Link href="/admin/videos/categories" className="underline">أضف تصنيفاً</Link>.
          </p>
        )}
      </fieldset>
      <Field label="الوصف المعروض (اختياري)" hint="حتى 500 حرف. وصف YouTube الأصلي يظهر في سجل المصدر للقراءة فقط." className="sm:col-span-2">
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
          <input type="checkbox" name="is_promo" defaultChecked={v?.is_promo ?? false} /> الفيديو التعريفي الرئيسي (يحل محل الحالي)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="pinned" defaultChecked={v?.pinned ?? false} /> مثبّت في المقدمة
        </label>
      </fieldset>
      <fieldset className="space-y-2 text-sm sm:col-span-2">
        <legend className="mb-1 font-medium">المراجعة</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="needs_review" defaultChecked={v?.needs_review ?? false} /> يحتاج مراجعة
        </label>
        <Field label="ملاحظة المراجعة (للإدارة فقط)" hint="إلغاء «يحتاج مراجعة» يسجّل وقت المراجعة، ولن يعيده الاستيراد.">
          <textarea name="review_note" rows={2} maxLength={2000} defaultValue={details?.review_note ?? ""} className={inputCls} />
        </Field>
      </fieldset>
    </div>
  );
}

async function loadCategories(sb: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await sb.from("video_categories").select("id, slug, title, sort_order, is_published").order("sort_order").order("created_at");
  return { cats: (data ?? []) as Category[], error };
}

export async function VideosPage({ searchParams }: { searchParams: SP }) {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sp = await searchParams;
  const filter = one(sp.filter) === "review" ? "review" : "";
  const sb = await createClient();
  const [{ data, error }, flagsRes, { cats, error: ce }, linksRes] = await Promise.all([
    sb.from("showcase_videos").select(COLS).order("sort_order").order("created_at"),
    sb.from("showcase_video_admin_details").select(ADMIN_COLS),
    loadCategories(sb),
    sb.from("showcase_video_categories").select("video_id, category_id, is_primary"),
  ]);
  const photos = await pickPhotos(sb as unknown as SupabaseClient);
  if (error || flagsRes.error || ce || linksRes.error) return <LoadError what="الفيديوهات" />;
  const flags = new Map(((flagsRes.data ?? []) as AdminFlags[]).map((f) => [f.video_id, f]));
  const rows = ((data ?? []) as Omit<VideoRow, "title_source" | "needs_review">[])
    .map((r) => ({ ...r, title_source: flags.get(r.id)?.title_source ?? "youtube", needs_review: flags.get(r.id)?.needs_review ?? false }))
    .filter((r) => filter !== "review" || r.needs_review) as VideoRow[];
  const links = (linksRes.data ?? []) as Link_[];
  const catById = new Map(cats.map((c) => [c.id, c]));
  return (
    <>
      <PageHeader
        title="الفيديوهات"
        lead="مقاطع من قناة الاستوديو على يوتيوب تُعرض في الموقع العام بعناوينها الأصلية. يُحفظ معرّف الفيديو فقط."
        actions={
          <Link href="/admin/videos/categories" className={btn("ghost")}>
            التصنيفات
          </Link>
        }
      />
      <FilterChips base="/admin/videos" param="filter" current={filter} options={[{ value: "review", label: "تحتاج مراجعة" }]} params={filter ? { filter } : {}} />
      <div className="space-y-4">
        <Table head={["الفيديو", "التصنيفات", "الترتيب", "الحالة", "إجراءات"]} empty={!rows.length} label="قائمة الفيديوهات">
          {rows.map((v) => {
            const mine = links.filter((l) => l.video_id === v.id).sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
            return (
              <tr key={v.id} data-testid="video-row" data-youtube-id={v.youtube_id}>
                <td className="px-3 py-2">
                  <div className="flex items-start gap-3">
                    <Image src={youTubeThumbUrl(v.youtube_id)} alt="" width={96} height={54} className="h-[54px] w-24 shrink-0 rounded-sm object-cover" />
                    <div className="min-w-0 max-w-md">
                      <Link href={`/admin/videos/${v.id}`} className="whitespace-normal break-words font-medium underline-offset-2 hover:underline" data-testid="video-title">
                        {v.title}
                      </Link>
                      <p className="text-xs text-on-cream-muted">
                        <span dir="ltr">{v.youtube_id}</span> · {v.title_source === "manual" ? "عنوان يدوي" : "عنوان YouTube"}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-sm">
                  <ul className="flex flex-wrap gap-1" aria-label="التصنيفات">
                    {mine.length ? (
                      mine.map((l) => (
                        <li key={l.category_id}>
                          <Badge tone={l.is_primary ? "gold" : "neutral"}>
                            {catById.get(l.category_id)?.title ?? "—"}
                            {l.is_primary ? <span className="sr-only"> (رئيسي)</span> : null}
                          </Badge>
                        </li>
                      ))
                    ) : (
                      <li className="text-on-cream-muted">بلا تصنيف</li>
                    )}
                  </ul>
                </td>
                <td className="px-3 py-2 text-sm">{v.sort_order}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {v.is_published ? <Badge tone="success">منشور</Badge> : <Badge>مخفي</Badge>}
                    {v.is_promo ? <Badge tone="gold">تعريفي</Badge> : null}
                    <Badge>{ROLE_LABEL[v.role] ?? v.role}</Badge>
                    {v.pinned ? <Badge tone="gold">مثبّت</Badge> : null}
                    {v.needs_review ? <Badge tone="danger">تحتاج مراجعة</Badge> : null}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionForm action={setVideoPublished} submitLabel={v.is_published ? "إخفاء" : "نشر"} kind="ghost" inline>
                      <input type="hidden" name="id" value={v.id} />
                      <input type="hidden" name="publish" value={v.is_published ? "0" : "1"} />
                    </ActionForm>
                    <ActionForm action={setVideoPinned} submitLabel={v.pinned ? "إلغاء التثبيت" : "تثبيت"} kind="ghost" inline>
                      <input type="hidden" name="id" value={v.id} />
                      <input type="hidden" name="pinned" value={v.pinned ? "0" : "1"} />
                    </ActionForm>
                    <ActionForm action={setVideoRole} submitLabel="تغيير الدور" kind="ghost" inline>
                      <input type="hidden" name="id" value={v.id} />
                      <label className="sr-only" htmlFor={`role-${v.id}`}>دور الفيديو</label>
                      <select id={`role-${v.id}`} name="role" defaultValue={v.role} className="field !min-h-10 !py-1 text-sm">
                        <option value="work">أعمال</option>
                        <option value="promo">برومو</option>
                        <option value="both">كلاهما</option>
                      </select>
                    </ActionForm>
                    {!v.is_promo ? (
                      <ActionForm action={makePromo} submitLabel="اجعله تعريفياً" kind="ghost" inline>
                        <input type="hidden" name="id" value={v.id} />
                      </ActionForm>
                    ) : null}
                    {v.needs_review ? (
                      <ActionForm action={markReviewed} submitLabel="تمت المراجعة" kind="ghost" inline>
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
            );
          })}
        </Table>
        <Card title="إضافة فيديو">
          <ActionForm action={createVideo} submitLabel="إضافة" kind="primary" resetOnSuccess testId="video-create">
            <VideoFields cats={cats} links={[]} photos={photos} />
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
  const [row, details, { cats }, linksRes] = await Promise.all([
    sb.from("showcase_videos").select(COLS).eq("id", id).maybeSingle(),
    sb
      .from("showcase_video_admin_details")
      .select("original_title, source, verification_notes, youtube_title, youtube_description, review_note, reviewed_at, title_source, needs_review")
      .eq("video_id", id)
      .maybeSingle(),
    loadCategories(sb),
    sb.from("showcase_video_categories").select("video_id, category_id, is_primary").eq("video_id", id),
  ]);
  const photos = await pickPhotos(sb as unknown as SupabaseClient);
  if (row.error || !row.data) return <LoadError what="الفيديو" />;
  const v = {
    ...(row.data as Omit<VideoRow, "title_source" | "needs_review">),
    title_source: details.data?.title_source ?? "youtube",
    needs_review: details.data?.needs_review ?? false,
  } as VideoRow;
  const d = details.data as Details | null;
  const canRestore = !!d?.youtube_title && (v.title_source !== "youtube" || v.title !== d.youtube_title);
  return (
    <>
      <PageHeader title={v.title} back={{ href: "/admin/videos", label: "الفيديوهات" }} />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {v.needs_review ? (
            <Notice tone="danger">
              <strong>تحتاج مراجعة.</strong> {d?.review_note ?? ""}
            </Notice>
          ) : null}
          <Card title="تعديل الفيديو">
            <ActionForm action={updateVideo} submitLabel="حفظ" kind="primary" testId="video-edit">
              <input type="hidden" name="id" value={v.id} />
              <VideoFields v={v} cats={cats} links={(linksRes.data ?? []) as Link_[]} details={d} photos={photos} />
            </ActionForm>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="المعاينة">
            <Image src={youTubeThumbUrl(v.youtube_id)} alt="" width={480} height={270} className="w-full rounded-sm" />
            <a href={youTubeWatchUrl(v.youtube_id)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm underline" dir="ltr">
              {youTubeWatchUrl(v.youtube_id)}
            </a>
          </Card>
          <Card title="عنوان YouTube">
            <p className="whitespace-normal break-words text-sm" data-testid="youtube-title">
              {d?.youtube_title ?? "—"}
            </p>
            <p className="mt-1 text-xs text-on-cream-muted">
              {v.title_source === "manual" ? "العنوان المعروض يدوي حالياً." : "العنوان المعروض يتبع YouTube."}
            </p>
            {canRestore ? (
              <div className="mt-3">
                <ActionForm action={restoreYouTubeTitle} submitLabel="استعادة عنوان YouTube" kind="ghost" testId="restore-title">
                  <input type="hidden" name="id" value={v.id} />
                </ActionForm>
              </div>
            ) : null}
          </Card>
          <Card title="سجل المصدر (للإدارة فقط)">
            <DL
              items={[
                ["العنوان الأصلي", d?.original_title ?? "—"],
                ["وصف YouTube", d?.youtube_description ? <span className="whitespace-pre-line">{d.youtube_description}</span> : "—"],
                ["المصدر", d?.source ?? "—"],
                ["آخر مراجعة", d?.reviewed_at ? new Date(d.reviewed_at).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" }) : "—"],
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

// ------------------------------------------------------------------ categories
function CategoryFields({ c }: { c?: Category }) {
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <Field label="الاسم" className="sm:col-span-2">
        <input name="title" required minLength={2} maxLength={60} defaultValue={c?.title ?? ""} className={inputCls} />
      </Field>
      <Field label="المعرّف (slug)" hint="a-z و 0-9 و _">
        <input name="slug" required pattern="[a-z0-9_]{2,30}" maxLength={30} dir="ltr" defaultValue={c?.slug ?? ""} className={inputCls} />
      </Field>
      <Field label="الترتيب">
        <input name="sort_order" type="number" inputMode="numeric" min={-1000} max={100000} step={1} defaultValue={c?.sort_order ?? 100} className={inputCls} />
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-4">
        <input type="checkbox" name="is_published" defaultChecked={c ? c.is_published : true} /> منشور في الموقع
      </label>
    </div>
  );
}

export async function VideoCategoriesPage() {
  if (!(await guard(ADMIN_ROLES))) return <Forbidden />;
  const sb = await createClient();
  const [{ cats, error }, linksRes] = await Promise.all([loadCategories(sb), sb.from("showcase_video_categories").select("category_id")]);
  if (error) return <LoadError what="التصنيفات" />;
  const count = new Map<string, number>();
  for (const l of linksRes.data ?? []) count.set(l.category_id, (count.get(l.category_id) ?? 0) + 1);
  return (
    <>
      <PageHeader title="تصنيفات الفيديو" back={{ href: "/admin/videos", label: "الفيديوهات" }} lead="تُعرض المنشورة منها كمرشّحات في صفحة الفيديو العامة. الاستيراد لا يغيّر اسم أو ترتيب أو نشر تصنيف موجود." />
      <div className="space-y-4">
        <ol className="space-y-3" aria-label="قائمة التصنيفات">
          {cats.map((c, i) => (
            <li key={c.id} data-testid="category-row" data-slug={c.slug}>
              <Card
                title={c.title}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    {c.is_published ? <Badge tone="success">منشور</Badge> : <Badge>مخفي</Badge>}
                    <span className="text-xs text-on-cream-muted">{count.get(c.id) ?? 0} فيديو</span>
                    <ActionForm action={moveCategory} submitLabel="↑ أعلى" kind="ghost" inline disabled={i === 0}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="dir" value="up" />
                    </ActionForm>
                    <ActionForm action={moveCategory} submitLabel="↓ أسفل" kind="ghost" inline disabled={i === cats.length - 1}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="dir" value="down" />
                    </ActionForm>
                    <ActionForm action={setCategoryPublished} submitLabel={c.is_published ? "إخفاء" : "نشر"} kind="ghost" inline>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="publish" value={c.is_published ? "0" : "1"} />
                    </ActionForm>
                    <ActionForm
                      action={deleteCategory}
                      submitLabel="حذف"
                      kind="danger"
                      inline
                      confirm={{ title: `حذف تصنيف «${c.title}»؟`, body: "يُزال من كل الفيديوهات المرتبطة به. الفيديوهات نفسها لا تُحذف.", confirmLabel: "حذف" }}
                    >
                      <input type="hidden" name="id" value={c.id} />
                    </ActionForm>
                  </div>
                }
              >
                <ActionForm action={updateCategory} submitLabel="حفظ" kind="secondary" testId={`category-edit-${c.slug}`}>
                  <input type="hidden" name="id" value={c.id} />
                  <CategoryFields c={c} />
                </ActionForm>
              </Card>
            </li>
          ))}
        </ol>
        {!cats.length ? <Notice>لا توجد تصنيفات بعد.</Notice> : null}
        <Card title="إضافة تصنيف">
          <ActionForm action={createCategory} submitLabel="إضافة" kind="primary" resetOnSuccess testId="category-create">
            <CategoryFields />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
