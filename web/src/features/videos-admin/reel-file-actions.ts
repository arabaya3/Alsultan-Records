"use server";

import { randomUUID } from "node:crypto";
import { refresh, updateTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { TAGS } from "@/lib/cache-tags";
import { guard, ADMIN_ROLES } from "@/features/admin/guard";
import { isUuid } from "@/features/admin/result";
import { PARTS_PER_SIGN, partLength, partSizeFor, partsProblem } from "@/lib/album-storage/multipart";
import { s3Env, s3Head, s3MultipartAbort, s3MultipartComplete, s3MultipartCreate, s3MultipartParts, s3Remove, s3SignPart } from "@/lib/album-storage/s3";
import type { S3Sign, S3Start } from "@/features/albums-admin/s3-upload";

/**
 * The original file of a showcase video, for the reels viewer: uploaded straight to S3 in parts (nothing through
 * Vercel), one file per video. Every call re-checks the admin role and that the reservation is still open.
 */
const REEL_MAX_BYTES = 500 * 1024 * 1024;
const MIMES: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov" };
const DENIED = { ok: false as const, denied: true, message: "لا توجد صلاحية (انتهت الجلسة أو تغيّرت الصلاحية)." };
const GONE = { ok: false as const, denied: true, message: "لم يعد هذا الرفع قائمًا — حدّث الصفحة وأعد اختيار الملف." };
const DOWN = { ok: false as const, message: "تعذّر الوصول إلى التخزين — أعد المحاولة." };

type Row = { id: string; storage_path: string; bytes: number; mime: string; s3_upload_id: string | null };
const db = async () => (await createClient()) as unknown as SupabaseClient;

type ReelReserve = { ok: true; id: string } | { ok: false; message: string };

export async function reserveReelFile(
  videoId: string,
  f: { size: number; mime: string; duration: number | null; width: number | null; height: number | null },
): Promise<ReelReserve> {
  if (!(await guard(ADMIN_ROLES)) || !isUuid(videoId)) return { ok: false, message: DENIED.message };
  if (!s3Env()) return { ok: false, message: "تخزين الملفات غير مُعدّ على الخادم." };
  const ext = MIMES[String(f?.mime)];
  const size = Number(f?.size);
  if (!ext) return { ok: false, message: "الملف يجب أن يكون MP4 أو MOV." };
  if (!(size > 0) || size > REEL_MAX_BYTES) return { ok: false, message: "الحد الأقصى 500 ميغابايت." };
  const sb = await db();
  const { data: video } = await sb.from("showcase_videos").select("id, title").eq("id", videoId).maybeSingle();
  if (!video) return { ok: false, message: "الفيديو غير موجود." };
  const { data: existing } = await sb.from("reel_videos").select("id, upload_status, bytes, mime").eq("showcase_video_id", videoId).maybeSingle();
  if (existing?.upload_status === "ready") return { ok: false, message: "لهذا الفيديو ملف جاهز. احذفه أولًا لرفع غيره." };
  // The same file chosen again after a reload: continue its upload.
  if (existing && Number(existing.bytes) === size && existing.mime === f.mime) return { ok: true, id: existing.id };
  if (existing) await removeRow(sb, existing.id);
  const id = randomUUID();
  const num = (v: number | null, max: number) => (typeof v === "number" && v > 0 && v < max ? v : null);
  const { error } = await sb.from("reel_videos").insert({
    id,
    title: String(video.title).slice(0, 160).padEnd(2, "."),
    storage_path: `reels/${id}.${ext}`,
    mime: f.mime,
    bytes: size,
    duration_s: num(f.duration, 10_000) === null ? null : Math.round(f.duration! * 100) / 100,
    width: num(f.width, 20_000) === null ? null : Math.round(f.width!),
    height: num(f.height, 20_000) === null ? null : Math.round(f.height!),
    storage_provider: "s3",
    upload_status: "uploading",
    showcase_video_id: videoId,
  });
  return error ? { ok: false, message: "تعذّر حجز الرفع." } : { ok: true, id };
}

async function open(sb: SupabaseClient, id: string): Promise<Row | null> {
  const { data } = await sb.from("reel_videos").select("id, storage_path, bytes, mime, s3_upload_id").eq("id", id).eq("upload_status", "uploading").eq("storage_provider", "s3").maybeSingle();
  return (data as Row | null) ?? null;
}

export async function startReelUpload(id: string): Promise<S3Start> {
  if (!(await guard(ADMIN_ROLES)) || !isUuid(id)) return DENIED;
  const sb = await db();
  const row = await open(sb, id);
  if (!row) return GONE;
  const partSize = partSizeFor(Number(row.bytes));
  try {
    if (row.s3_upload_id) {
      const parts = await s3MultipartParts(row.storage_path, row.s3_upload_id);
      if (parts) return { ok: true, partSize, parts: parts.map(({ n, size }) => ({ n, size })) };
    }
    const fresh = await s3MultipartCreate(row.storage_path, row.mime);
    const { data } = await sb.from("reel_videos").update({ s3_upload_id: fresh }).eq("id", id).eq("upload_status", "uploading").select("id");
    if (!data?.length) {
      await s3MultipartAbort(row.storage_path, fresh);
      return GONE;
    }
    return { ok: true, partSize, parts: [] };
  } catch {
    return DOWN;
  }
}

export async function signReelParts(id: string, partNumbers: number[]): Promise<S3Sign> {
  if (!(await guard(ADMIN_ROLES)) || !isUuid(id)) return DENIED;
  if (!Array.isArray(partNumbers) || !partNumbers.length || partNumbers.length > PARTS_PER_SIGN) return { ok: false, message: "طلب غير صالح." };
  const sb = await db();
  const row = await open(sb, id);
  if (!row?.s3_upload_id) return GONE;
  const size = Number(row.bytes);
  const ps = partSizeFor(size);
  if (partNumbers.some((n) => !partLength(size, ps, n))) return { ok: false, message: "طلب غير صالح." };
  try {
    return { ok: true, urls: await Promise.all(partNumbers.map(async (n) => ({ n, url: await s3SignPart(row.storage_path, row.s3_upload_id!, n, partLength(size, ps, n)) }))) };
  } catch {
    return DOWN;
  }
}

/** The parts S3 holds (never the browser's list) become the file; its size must match the reservation. */
export async function completeReelUpload(id: string): Promise<{ ok: boolean; message?: string }> {
  if (!(await guard(ADMIN_ROLES)) || !isUuid(id)) return { ok: false, message: DENIED.message };
  const sb = await db();
  const row = await open(sb, id);
  if (!row) return { ok: false, message: GONE.message };
  const size = Number(row.bytes);
  try {
    if (row.s3_upload_id) {
      const parts = await s3MultipartParts(row.storage_path, row.s3_upload_id);
      if (parts) {
        if (partsProblem(parts, size, partSizeFor(size))) return { ok: false, message: "الملف لم يكتمل رفعه بعد." };
        await s3MultipartComplete(row.storage_path, row.s3_upload_id, parts);
      }
    }
    const head = await s3Head(row.storage_path);
    if (!head || head.size !== size) return { ok: false, message: "حجم الملف المرفوع لا يطابق الملف الأصلي — أعد المحاولة." };
  } catch {
    return { ok: false, message: DOWN.message };
  }
  const { data } = await sb.from("reel_videos").update({ upload_status: "ready", s3_upload_id: null }).eq("id", id).eq("upload_status", "uploading").select("id");
  if (!data?.length) return { ok: false, message: "تغيّرت حالة الملف — حدّث الصفحة." };
  updateTag(TAGS.videos);
  refresh();
  return { ok: true };
}

async function removeRow(sb: SupabaseClient, id: string) {
  const { data } = await sb.from("reel_videos").delete().eq("id", id).select("storage_path, s3_upload_id, storage_provider");
  const r = data?.[0] as { storage_path: string; s3_upload_id: string | null; storage_provider: string } | undefined;
  if (!r || r.storage_provider !== "s3") return;
  if (r.s3_upload_id) await s3MultipartAbort(r.storage_path, r.s3_upload_id).catch(() => undefined);
  await s3Remove([r.storage_path]).catch(() => undefined);
}

/** Deletes the file only: the video and its YouTube link stay, and the viewer falls back to YouTube. */
export async function removeReelFile(id: string): Promise<{ ok: boolean }> {
  if (!(await guard(ADMIN_ROLES)) || !isUuid(id)) return { ok: false };
  await removeRow(await db(), id);
  updateTag(TAGS.videos);
  refresh();
  return { ok: true };
}
