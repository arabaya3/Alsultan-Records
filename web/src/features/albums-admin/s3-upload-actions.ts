"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { guard, ADMIN_ROLES } from "@/features/admin/guard";
import { isUuid } from "@/features/admin/result";
import { PARTS_PER_SIGN, partLength, partSizeFor } from "@/lib/album-storage/multipart";
import { s3MultipartAbort, s3MultipartCreate, s3MultipartParts, s3SignPart } from "@/lib/album-storage/s3";
import type { S3Sign, S3Start } from "./s3-upload";

/**
 * Direct multipart upload to S3: nothing passes through Vercel. Every call re-checks the admin role and that the photo
 * is still an open S3 reservation, so a revoked admin or a deleted reservation gets no further URLs. The key and the
 * upload id come from the database, and the browser only ever names a photo and part numbers.
 */
const DENIED = { ok: false as const, denied: true, message: "لا توجد صلاحية للرفع إلى هذا الألبوم (انتهت الجلسة أو تغيّرت الصلاحية)." };
const GONE = { ok: false as const, denied: true, message: "لم يعد هذا الرفع قائمًا — حدّث الصفحة وأعد اختيار الملف." };
const STORAGE_DOWN = { ok: false as const, message: "تعذّر الوصول إلى التخزين — أعد المحاولة." };

type Row = { id: string; storage_path_original: string; bytes: number; mime: string; s3_upload_id: string | null };

async function openReservation(sb: SupabaseClient, photoId: string): Promise<Row | null> {
  const { data } = await sb
    .from("album_photos")
    .select("id, album_id, storage_path_original, bytes, mime, s3_upload_id")
    .eq("id", photoId)
    .eq("upload_status", "uploading")
    .eq("storage_provider", "s3")
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;
  const { data: album } = await sb.from("photo_albums").select("deleted_at").eq("id", data.album_id).maybeSingle();
  return album && !album.deleted_at ? (data as Row) : null;
}

/** Start or resume. Parts already stored (after a reload, or on another tab) are reported so they are not sent again. */
export async function startS3Upload(photoId: string): Promise<S3Start> {
  if (!(await guard(ADMIN_ROLES)) || !isUuid(photoId)) return DENIED;
  const sb = (await createClient()) as unknown as SupabaseClient;
  const row = await openReservation(sb, photoId);
  if (!row) return GONE;
  const partSize = partSizeFor(Number(row.bytes));
  try {
    if (row.s3_upload_id) {
      const parts = await s3MultipartParts(row.storage_path_original, row.s3_upload_id);
      if (parts) return { ok: true, partSize, parts: parts.map(({ n, size }) => ({ n, size })) };
    }
    const fresh = await s3MultipartCreate(row.storage_path_original, row.mime);
    const { data: kept, error } = await sb.rpc("album_s3_upload_set", { p_photo_id: photoId, p_upload_id: fresh, p_replace: row.s3_upload_id });
    if (error || !kept) {
      await s3MultipartAbort(row.storage_path_original, fresh);
      return error ? STORAGE_DOWN : GONE;
    }
    if (kept !== fresh) {
      // Another tab started first: use its upload.
      await s3MultipartAbort(row.storage_path_original, fresh);
      const parts = await s3MultipartParts(row.storage_path_original, kept);
      return { ok: true, partSize, parts: (parts ?? []).map(({ n, size }) => ({ n, size })) };
    }
    return { ok: true, partSize, parts: [] };
  } catch {
    return STORAGE_DOWN;
  }
}

export async function signS3Parts(photoId: string, partNumbers: number[]): Promise<S3Sign> {
  if (!(await guard(ADMIN_ROLES)) || !isUuid(photoId)) return DENIED;
  if (!Array.isArray(partNumbers) || !partNumbers.length || partNumbers.length > PARTS_PER_SIGN) return { ok: false, message: "طلب غير صالح." };
  const sb = (await createClient()) as unknown as SupabaseClient;
  const row = await openReservation(sb, photoId);
  if (!row?.s3_upload_id) return GONE;
  const size = Number(row.bytes);
  const partSize = partSizeFor(size);
  if (partNumbers.some((n) => !partLength(size, partSize, n))) return { ok: false, message: "طلب غير صالح." };
  try {
    const urls = await Promise.all(partNumbers.map(async (n) => ({ n, url: await s3SignPart(row.storage_path_original, row.s3_upload_id!, n, partLength(size, partSize, n)) })));
    return { ok: true, urls };
  } catch {
    return STORAGE_DOWN;
  }
}
