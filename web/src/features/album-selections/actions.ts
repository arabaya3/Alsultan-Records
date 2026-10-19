"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { customerForAction, isUuid, MSG, type ActionResult } from "@/features/portal/session";
import { selectionCount } from "./data";

type Ctx = NonNullable<Awaited<ReturnType<typeof customerForAction>>>;
type Fail = "locked" | "forbidden" | "unavailable" | "none";

async function ensureDraft(ctx: Ctx, eventId: string, create: boolean): Promise<{ id: string } | { error: Fail }> {
  const { supabase, session } = ctx;
  const find = () => supabase.from("album_selections").select("id, status").eq("event_id", eventId).maybeSingle();
  const first = await find();
  if (first.error) return { error: "unavailable" };
  let sel = first.data;
  if (!sel && create) {
    const { data: cust } = await supabase.from("customers").select("id").eq("user_id", session.userId).maybeSingle();
    if (!cust) return { error: "forbidden" };
    const ins = await supabase.from("album_selections").insert({ event_id: eventId, customer_id: cust.id });
    if (ins.error && ins.error.code !== "23505") return { error: "forbidden" };
    sel = (await find()).data;
  }
  if (!sel) return { error: create ? "forbidden" : "none" };
  if (sel.status !== "draft") return { error: "locked" };
  return { id: sel.id };
}

function fail(e: Fail): { ok: false; error: string; code: "locked" | "forbidden" | "unavailable" } {
  if (e === "locked") return { ok: false, error: MSG.locked, code: "locked" };
  if (e === "forbidden" || e === "none") return { ok: false, error: MSG.forbidden, code: "forbidden" };
  return { ok: false, error: MSG.unavailable, code: "unavailable" };
}

export async function toggleSelection(
  eventId: string,
  assetId: string,
  selected: boolean,
): Promise<ActionResult<{ count: number; selected: boolean }>> {
  const ctx = await customerForAction();
  if (!ctx) return { ok: false, error: MSG.auth, code: "auth" };
  if (!isUuid(eventId) || !isUuid(assetId)) return { ok: false, error: MSG.forbidden, code: "invalid" };
  const sel = await ensureDraft(ctx, eventId, Boolean(selected));
  if ("error" in sel) {
    if (sel.error === "none") return { ok: true, data: { count: 0, selected: false } };
    return fail(sel.error);
  }
  if (selected) {
    const { error } = await ctx.supabase
      .from("album_selection_items")
      .upsert(
        { selection_id: sel.id, media_asset_id: assetId },
        { onConflict: "selection_id,media_asset_id", ignoreDuplicates: true },
      );
    if (error) return fail(error.code === "42501" || error.code === "23514" ? "forbidden" : "unavailable");
  } else {
    const { error } = await ctx.supabase
      .from("album_selection_items")
      .delete()
      .eq("selection_id", sel.id)
      .eq("media_asset_id", assetId);
    if (error) return fail("unavailable");
  }
  return { ok: true, data: { count: await selectionCount(ctx.supabase, sel.id), selected: Boolean(selected) } };
}

const noteSchema = z.string().max(1000);

export async function saveSelectionNote(eventId: string, assetId: string, note: string): Promise<ActionResult> {
  const ctx = await customerForAction();
  if (!ctx) return { ok: false, error: MSG.auth, code: "auth" };
  const parsed = noteSchema.safeParse(note);
  if (!isUuid(eventId) || !isUuid(assetId) || !parsed.success)
    return { ok: false, error: "الملاحظة طويلة جداً (الحد ١٠٠٠ حرف).", code: "invalid" };
  const sel = await ensureDraft(ctx, eventId, false);
  if ("error" in sel) return fail(sel.error);
  const { data, error } = await ctx.supabase
    .from("album_selection_items")
    .update({ note: parsed.data.trim() || null })
    .eq("selection_id", sel.id)
    .eq("media_asset_id", assetId)
    .select("id");
  if (error) return fail("unavailable");
  if (!data?.length) return { ok: false, error: "اختر الصورة أولاً ثم أضف ملاحظتك.", code: "invalid" };
  return { ok: true, data: null };
}

export async function submitSelection(eventId: string): Promise<ActionResult<{ snapshotId: string }>> {
  const ctx = await customerForAction();
  if (!ctx) return { ok: false, error: MSG.auth, code: "auth" };
  if (!isUuid(eventId)) return { ok: false, error: MSG.forbidden, code: "invalid" };
  const { data, error } = await ctx.supabase.rpc("submit_album_selection", { p_event_id: eventId });
  if (error) {
    if (error.code === "P0002" || (error.code === "22023" && error.message.includes("empty")))
      return { ok: false, error: "اختر صورة واحدة على الأقل قبل الإرسال.", code: "invalid" };
    if (error.code === "22023") return fail("locked");
    return fail(error.code === "42501" ? "forbidden" : "unavailable");
  }
  refresh();
  return { ok: true, data: { snapshotId: data } };
}
