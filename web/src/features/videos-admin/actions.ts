"use server";

import { refresh, updateTag } from "next/cache";
import { TAGS } from "@/lib/cache-tags";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { youTubeWatchUrl } from "@/lib/youtube";
import { guard, ADMIN_ROLES } from "@/features/admin/guard";
import { dbMessage, fail, FORBIDDEN, ok, uuid, type ActionResult } from "@/features/admin/result";
import { readCategoryForm, readVideoForm } from "./schema";

const DUP = { "23505": "هذا الفيديو مضاف مسبقاً." };
const PROMO_FAIL = "حُفظ الفيديو، لكن تعذّر تعيينه كفيديو تعريفي. أعد المحاولة من القائمة.";
const LINKS_FAIL = "حُفظ الفيديو، لكن تعذّر حفظ التصنيفات. أعد المحاولة.";

type SB = Awaited<ReturnType<typeof createClient>>;

/** Videos and categories feed /work, the home works/promos sections and the hero promo. */
function invalidate() {
  updateTag(TAGS.videos);
  updateTag(TAGS.sections);
  updateTag(TAGS.business);
  refresh();
}

/**
 * Make the video's category links exactly `ids`, with `primary` (or none) as the primary link.
 * The primary is unset before it is set (partial unique index: one primary per video).
 */
async function syncCategories(sb: SB, videoId: string, ids: string[], primary: string | null): Promise<boolean> {
  const { data: cur, error } = await sb.from("showcase_video_categories").select("category_id, is_primary").eq("video_id", videoId);
  if (error) return false;
  const have = new Set((cur ?? []).map((l) => l.category_id));
  const drop = [...have].filter((c) => !ids.includes(c));
  if (drop.length) {
    const d = await sb.from("showcase_video_categories").delete().eq("video_id", videoId).in("category_id", drop);
    if (d.error) return false;
  }
  const add = ids.filter((c) => !have.has(c));
  if (add.length) {
    const i = await sb.from("showcase_video_categories").insert(add.map((category_id) => ({ video_id: videoId, category_id, is_primary: false })));
    if (i.error) return false;
  }
  const u = await sb.from("showcase_video_categories").update({ is_primary: false }).eq("video_id", videoId).eq("is_primary", true);
  if (u.error) return false;
  if (primary) {
    const p = await sb.from("showcase_video_categories").update({ is_primary: true }).eq("video_id", videoId).eq("category_id", primary);
    if (p.error) return false;
  }
  return true;
}

export async function createVideo(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const parsed = readVideoForm(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الحقول.");
  const { is_promo, category_ids, primary_category, ...rest } = parsed.data;
  // The main promo is always shown as a promo too.
  const v = { ...rest, role: is_promo && rest.role === "work" ? ("both" as const) : rest.role };
  const sb = await createClient();
  const { data, error } = await sb
    .from("showcase_videos")
    .insert({ ...v, title_source: "manual", source_url: youTubeWatchUrl(v.youtube_id), source: "admin", is_promo: false })
    .select("id")
    .single();
  if (error || !data) return fail(dbMessage(error, DUP));
  if (!(await syncCategories(sb, data.id, category_ids, primary_category))) {
    invalidate();
    return fail(LINKS_FAIL);
  }
  if (is_promo) {
    const { error: e } = await sb.rpc("set_showcase_promo", { p_id: data.id });
    if (e) {
      invalidate();
      return fail(PROMO_FAIL);
    }
  }
  invalidate();
  return ok("أُضيف الفيديو.");
}

export async function updateVideo(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const parsed = readVideoForm(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الحقول.");
  const { is_promo, category_ids, primary_category, ...rest } = parsed.data;
  // The main promo is always shown as a promo too.
  const v = { ...rest, role: is_promo && rest.role === "work" ? ("both" as const) : rest.role };
  const sb = await createClient();
  const { data: cur } = await sb.from("showcase_videos").select("title").eq("id", id).maybeSingle();
  if (!cur) return fail("السجل غير موجود.");
  // Editing the title hands it to the admin: the import never overwrites a 'manual' title.
  const titleChanged = cur.title !== v.title;
  // Promo is only ever set through the RPC (atomic swap); unchecking clears it here.
  const patch = {
    ...v,
    source_url: youTubeWatchUrl(v.youtube_id),
    ...(titleChanged ? { title_source: "manual" } : {}),
    ...(is_promo ? {} : { is_promo: false }),
  };
  const { data, error } = await sb.from("showcase_videos").update(patch).eq("id", id).select("id");
  if (error) return fail(dbMessage(error, DUP));
  if (!data?.length) return fail("السجل غير موجود.");
  if (!(await syncCategories(sb, id, category_ids, primary_category))) {
    invalidate();
    return fail(LINKS_FAIL);
  }
  if (is_promo) {
    const { error: e } = await sb.rpc("set_showcase_promo", { p_id: id });
    if (e) {
      invalidate();
      return fail(PROMO_FAIL);
    }
  }
  invalidate();
  return ok(titleChanged ? "حُفظت التعديلات. العنوان الآن يدوي ولن يغيّره الاستيراد." : "حُفظت التعديلات.");
}

/** Reset the public title to the last title fetched from YouTube (title_source back to 'youtube'). */
export async function restoreYouTubeTitle(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const sb = await createClient();
  const { data: d } = await sb.from("showcase_video_admin_details").select("youtube_title").eq("video_id", id).maybeSingle();
  const yt = d?.youtube_title?.trim();
  if (!yt) return fail("لا يوجد عنوان محفوظ من يوتيوب لهذا الفيديو بعد.");
  const { data, error } = await sb.from("showcase_videos").update({ title: yt.slice(0, 200), title_source: "youtube" }).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  invalidate();
  return ok("استُعيد عنوان YouTube.");
}

/** Quick action from the list: clear needs_review (the DB stamps reviewed_at). */
export async function markReviewed(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const sb = await createClient();
  const { data, error } = await sb.from("showcase_videos").update({ needs_review: false }).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  invalidate();
  return ok("عُلّم كمُراجَع.");
}

export async function setVideoPublished(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const publish = fd.get("publish") === "1";
  const sb = await createClient();
  const { data, error } = await sb.from("showcase_videos").update({ is_published: publish }).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  invalidate();
  return ok(publish ? "نُشر الفيديو." : "أُخفي الفيديو من الموقع.");
}

export async function setVideoPinned(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const pinned = fd.get("pinned") === "1";
  const sb = await createClient();
  const { data, error } = await sb.from("showcase_videos").update({ pinned }).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  invalidate();
  return ok(pinned ? "ثُبّت الفيديو في المقدمة." : "أُلغي التثبيت.");
}

export async function setVideoRole(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  const role = fd.get("role");
  if (!id || (role !== "work" && role !== "promo" && role !== "both")) return fail("سجل غير صالح.");
  const sb = await createClient();
  const { data, error } = await sb.from("showcase_videos").update({ role }).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  invalidate();
  return ok("تغيّر دور الفيديو.");
}

export async function makePromo(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const sb = await createClient();
  const { error } = await sb.rpc("set_showcase_promo", { p_id: id });
  if (error) return fail(dbMessage(error));
  await sb.from("showcase_videos").update({ role: "both" }).eq("id", id).eq("role", "work");
  invalidate();
  return ok("أصبح هذا الفيديو التعريفي.");
}

export async function deleteVideo(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const sb = await createClient();
  const { data, error } = await sb.from("showcase_videos").delete().eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  if (fd.get("from") === "edit") redirect("/admin/videos");
  invalidate();
  return ok("حُذف الفيديو.");
}

// ------------------------------------------------------------------ categories
const CAT_DUP = { "23505": "هذا المعرّف مستخدم لتصنيف آخر." };

export async function createCategory(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const parsed = readCategoryForm(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الحقول.");
  const sb = await createClient();
  const { error } = await sb.from("video_categories").insert(parsed.data);
  if (error) return fail(dbMessage(error, CAT_DUP));
  invalidate();
  return ok("أُضيف التصنيف.");
}

export async function updateCategory(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const parsed = readCategoryForm(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الحقول.");
  const sb = await createClient();
  const { data, error } = await sb.from("video_categories").update(parsed.data).eq("id", id).select("id");
  if (error) return fail(dbMessage(error, CAT_DUP));
  if (!data?.length) return fail("السجل غير موجود.");
  invalidate();
  return ok("حُفظ التصنيف.");
}

export async function setCategoryPublished(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const publish = fd.get("publish") === "1";
  const sb = await createClient();
  const { data, error } = await sb.from("video_categories").update({ is_published: publish }).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  invalidate();
  return ok(publish ? "نُشر التصنيف." : "أُخفي التصنيف من الموقع.");
}

/** Move one step up/down: renumbers all categories 10, 20, … in the new order (stable, no ties). */
export async function moveCategory(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  const dir = fd.get("dir") === "up" ? -1 : 1;
  if (!id) return fail("سجل غير صالح.");
  const sb = await createClient();
  const { data: rows, error } = await sb.from("video_categories").select("id, sort_order").order("sort_order").order("created_at");
  if (error || !rows) return fail(dbMessage(error));
  const i = rows.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return ok("لا تغيير.");
  [rows[i], rows[j]] = [rows[j], rows[i]];
  for (let k = 0; k < rows.length; k++) {
    const want = (k + 1) * 10;
    if (rows[k].sort_order === want) continue;
    const u = await sb.from("video_categories").update({ sort_order: want }).eq("id", rows[k].id);
    if (u.error) return fail(dbMessage(u.error));
  }
  invalidate();
  return ok("تغيّر الترتيب.");
}

export async function deleteCategory(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const sb = await createClient();
  const { data, error } = await sb.from("video_categories").delete().eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  invalidate();
  return ok("حُذف التصنيف (أُزيل من الفيديوهات المرتبطة).");
}
