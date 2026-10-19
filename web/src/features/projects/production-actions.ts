"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { guard, ADMIN_ROLES, ALL_STAFF } from "@/features/admin/guard";
import { pick } from "@/features/admin/query";
import { dbMessage, fail, FORBIDDEN, ok, optDate, optStr, str, uuid, type ActionResult } from "@/features/admin/result";
import { Constants } from "@/types/database";

export async function createDeliverable(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ALL_STAFF))) return FORBIDDEN;
  const eventId = uuid(fd, "event_id");
  const kind = pick(str(fd, "kind"), Constants.public.Enums.deliverable_kind);
  const title = str(fd, "title").slice(0, 200);
  if (!eventId || !kind || !title) return fail("العنوان والنوع مطلوبان.");
  const due = optDate(fd, "due_at");
  const sb = await createClient();
  const { error } = await sb
    .from("deliverables")
    .insert({ event_id: eventId, kind, title, due_at: due ? `${due}T21:00:00Z` : null });
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("أُضيف التسليم.");
}

export async function updateDeliverable(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ALL_STAFF))) return FORBIDDEN;
  const id = uuid(fd, "id");
  const status = pick(str(fd, "status"), Constants.public.Enums.deliverable_status);
  if (!id || !status) return fail("طلب غير صالح.");
  const due = optDate(fd, "due_at");
  const sb = await createClient();
  const { error } = await sb
    .from("deliverables")
    .update({ status, title: str(fd, "title").slice(0, 200) || undefined, due_at: due ? `${due}T21:00:00Z` : null })
    .eq("id", id);
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("حُفظ التسليم.");
}

/** New revision; the trigger numbers it and checks the media belongs to the same event. */
export async function addRevision(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ALL_STAFF))) return FORBIDDEN;
  const deliverableId = uuid(fd, "deliverable_id");
  if (!deliverableId) return fail("طلب غير صالح.");
  const raw = str(fd, "media_asset_id");
  const mediaId = raw ? uuid(fd, "media_asset_id") : null;
  if (raw && !mediaId) return fail("ملف غير صالح.");
  const sb = await createClient();
  const { error } = await sb
    .from("deliverable_revisions")
    .insert({ deliverable_id: deliverableId, media_asset_id: mediaId, notes: optStr(fd, "notes")?.slice(0, 4000) ?? null, revision_no: 1 });
  if (error) return fail(dbMessage(error, { "23514": "الملف المختار لا يتبع هذه المناسبة." }));
  if (fd.get("send_review") === "on") {
    await sb.from("deliverables").update({ status: "review" }).eq("id", deliverableId);
  }
  refresh();
  return ok("أُضيفت النسخة.");
}

export async function toggleComment(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ALL_STAFF))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const resolved = str(fd, "resolved") === "1";
  const sb = await createClient();
  const { error } = await sb.from("video_comments").update({ resolved }).eq("id", id);
  if (error) return fail(dbMessage(error));
  refresh();
  return ok(resolved ? "عُلّمت كمنجزة." : "أُعيد فتحها.");
}

export async function replyComment(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ALL_STAFF))) return FORBIDDEN;
  const revisionId = uuid(fd, "revision_id");
  const body = str(fd, "body").slice(0, 4000);
  const tc = /^(\d{1,2}):(\d{2})$/.exec(str(fd, "timecode"));
  if (!revisionId || !body) return fail("اكتب التعليق.");
  const ms = tc ? (Number(tc[1]) * 60 + Number(tc[2])) * 1000 : 0;
  const sb = await createClient();
  const { error } = await sb.from("video_comments").insert({ revision_id: revisionId, body, timecode_ms: ms });
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("أُضيف التعليق.");
}

export async function setSelectionStatus(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  const status = pick(str(fd, "status"), ["locked", "draft"] as const);
  if (!id || !status) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { error } = await sb.from("album_selections").update({ status }).eq("id", id);
  if (error) return fail(dbMessage(error));
  refresh();
  return ok(status === "locked" ? "قُفل الاختيار." : "أُعيد فتح الاختيار للعميل.");
}
