"use server";

import { z } from "zod";
import { signMediaUrls } from "@/features/media/sign";
import { customerForAction, isUuid, MSG, type ActionResult } from "@/features/portal/session";

export type VideoComment = {
  id: string;
  timecodeMs: number;
  body: string;
  resolved: boolean;
  createdAt: string;
  mine: boolean;
};

/** Signed URL for a revision's video (RLS: revision → media asset → storage policy). */
export async function getRevisionVideoUrl(
  revisionId: string,
): Promise<ActionResult<{ url: string | null; expiresAt: number | null }>> {
  const ctx = await customerForAction();
  if (!ctx) return { ok: false, error: MSG.auth, code: "auth" };
  if (!isUuid(revisionId)) return { ok: false, error: MSG.forbidden, code: "invalid" };
  const { data: rev } = await ctx.supabase
    .from("deliverable_revisions")
    .select("id, media_asset_id")
    .eq("id", revisionId)
    .maybeSingle();
  if (!rev) return { ok: false, error: MSG.forbidden, code: "forbidden" };
  if (!rev.media_asset_id) return { ok: true, data: { url: null, expiresAt: null } };
  const [s] = await signMediaUrls({ assetIds: [rev.media_asset_id], variant: "display", ttlSeconds: 600 });
  return { ok: true, data: { url: s?.url ?? null, expiresAt: s?.expiresAt ?? null } };
}

export async function listRevisionComments(revisionId: string): Promise<ActionResult<VideoComment[]>> {
  const ctx = await customerForAction();
  if (!ctx) return { ok: false, error: MSG.auth, code: "auth" };
  if (!isUuid(revisionId)) return { ok: false, error: MSG.forbidden, code: "invalid" };
  const { data, error } = await ctx.supabase
    .from("video_comments")
    .select("id, timecode_ms, body, resolved, created_at, author_id")
    .eq("revision_id", revisionId)
    .order("timecode_ms")
    .order("created_at");
  if (error) return { ok: false, error: "تعذّر تحميل الملاحظات.", code: "unavailable" };
  return {
    ok: true,
    data: (data ?? []).map((c) => ({
      id: c.id,
      timecodeMs: c.timecode_ms,
      body: c.body,
      resolved: c.resolved,
      createdAt: c.created_at,
      mine: c.author_id === ctx.session.userId,
    })),
  };
}

const commentSchema = z.object({
  revisionId: z.string().uuid(),
  timecodeMs: z.number().int().min(0).max(24 * 3600 * 1000),
  body: z.string().trim().min(1, "اكتب ملاحظتك أولاً.").max(4000, "الملاحظة طويلة جداً."),
});

export async function addRevisionComment(input: {
  revisionId: string;
  timecodeMs: number;
  body: string;
}): Promise<ActionResult<VideoComment>> {
  const ctx = await customerForAction();
  if (!ctx) return { ok: false, error: MSG.auth, code: "auth" };
  const parsed = commentSchema.safeParse({ ...input, timecodeMs: Math.round(Number(input?.timecodeMs)) });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? MSG.forbidden, code: "invalid" };
  const { data, error } = await ctx.supabase
    .from("video_comments")
    .insert({ revision_id: parsed.data.revisionId, timecode_ms: parsed.data.timecodeMs, body: parsed.data.body })
    .select("id, timecode_ms, body, resolved, created_at")
    .single();
  if (error || !data) {
    return error?.code === "42501"
      ? { ok: false, error: MSG.forbidden, code: "forbidden" }
      : { ok: false, error: MSG.unavailable, code: "unavailable" };
  }
  return {
    ok: true,
    data: { id: data.id, timecodeMs: data.timecode_ms, body: data.body, resolved: data.resolved, createdAt: data.created_at, mine: true },
  };
}
