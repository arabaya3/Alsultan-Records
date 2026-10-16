"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { youTubeWatchUrl } from "@/lib/youtube";
import { guard, ADMIN_ROLES } from "@/features/admin/guard";
import { dbMessage, fail, FORBIDDEN, ok, uuid, type ActionResult } from "@/features/admin/result";
import { readVideoForm } from "./schema";

const DUP = { "23505": "هذا الفيديو مضاف مسبقاً." };
const PROMO_FAIL = "حُفظ الفيديو، لكن تعذّر تعيينه كفيديو تعريفي. أعد المحاولة من القائمة.";

export async function createVideo(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const parsed = readVideoForm(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الحقول.");
  const { is_promo, ...v } = parsed.data;
  const sb = await createClient();
  const { data, error } = await sb
    .from("showcase_videos")
    .insert({ ...v, source_url: youTubeWatchUrl(v.youtube_id), source: "admin", is_promo: false })
    .select("id")
    .single();
  if (error || !data) return fail(dbMessage(error, DUP));
  if (is_promo) {
    const { error: e } = await sb.rpc("set_showcase_promo", { p_id: data.id });
    if (e) {
      refresh();
      return fail(PROMO_FAIL);
    }
  }
  refresh();
  return ok("أُضيف الفيديو.");
}

export async function updateVideo(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const parsed = readVideoForm(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الحقول.");
  const { is_promo, ...v } = parsed.data;
  const sb = await createClient();
  // Promo is only ever set through the RPC (atomic swap); unchecking clears it here.
  const patch = { ...v, source_url: youTubeWatchUrl(v.youtube_id), ...(is_promo ? {} : { is_promo: false }) };
  const { data, error } = await sb.from("showcase_videos").update(patch).eq("id", id).select("id");
  if (error) return fail(dbMessage(error, DUP));
  if (!data?.length) return fail("السجل غير موجود.");
  if (is_promo) {
    const { error: e } = await sb.rpc("set_showcase_promo", { p_id: id });
    if (e) {
      refresh();
      return fail(PROMO_FAIL);
    }
  }
  refresh();
  return ok("حُفظت التعديلات.");
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
  refresh();
  return ok(publish ? "نُشر الفيديو." : "أُخفي الفيديو من الموقع.");
}

export async function makePromo(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const sb = await createClient();
  const { error } = await sb.rpc("set_showcase_promo", { p_id: id });
  if (error) return fail(dbMessage(error));
  refresh();
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
  refresh();
  return ok("حُذف الفيديو.");
}
