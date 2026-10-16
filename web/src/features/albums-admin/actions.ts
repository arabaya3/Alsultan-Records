"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { guard, ADMIN_ROLES } from "@/features/admin/guard";
import { dbMessage, fail, FORBIDDEN, isUuid, ok, str, uuid, type ActionResult } from "@/features/admin/result";
import { readAlbumForm, altTextSchema } from "./schema";
import { ALBUM_BUCKET, ALBUM_MAX_BYTES, ALBUM_MAX_FILES_PER_BATCH, ALBUM_MIME_EXT, albumObjectPath, checkAlbumFile } from "./rules";

const SLUG_DUP = { "23505": "هذا المعرّف مستخدم لألبوم آخر." };
type SB = Awaited<ReturnType<typeof createClient>>;

// ------------------------------------------------------------------ albums
export async function createAlbum(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const parsed = readAlbumForm(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الحقول.");
  const sb = await createClient();
  const { data, error } = await sb.from("photo_albums").insert({ ...parsed.data, is_published: false }).select("id").single();
  if (error || !data) return fail(dbMessage(error, SLUG_DUP));
  redirect(`/admin/albums/${data.id}`);
}

export async function updateAlbum(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const parsed = readAlbumForm(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الحقول.");
  const sb = await createClient();
  const { data, error } = await sb.from("photo_albums").update(parsed.data).eq("id", id).select("id");
  if (error) return fail(dbMessage(error, SLUG_DUP));
  if (!data?.length) return fail("السجل غير موجود.");
  refresh();
  return ok("حُفظ الألبوم.");
}

export async function setAlbumPublished(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const publish = fd.get("publish") === "1";
  const sb = await createClient();
  if (publish) {
    const { count } = await sb.from("album_photos").select("id", { count: "exact", head: true }).eq("album_id", id).eq("upload_status", "ready").eq("is_published", true);
    if (!count) return fail("لا يمكن نشر ألبوم بلا صور ظاهرة جاهزة.");
  }
  const { data, error } = await sb.from("photo_albums").update({ is_published: publish }).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  refresh();
  return ok(publish ? "نُشر الألبوم." : "أُخفي الألبوم وصوره من الموقع فوراً.");
}

function photoPaths(p: { storage_path_original: string; variants: unknown }): string[] {
  const v = (p.variants ?? {}) as Record<string, unknown>;
  return Array.from(new Set([p.storage_path_original, v.thumb, v.display].filter((x): x is string => typeof x === "string" && !!x)));
}

export async function deleteAlbum(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const sb = await createClient();
  const { data: photos, error: pe } = await sb.from("album_photos").select("storage_path_original, variants").eq("album_id", id);
  if (pe) return fail(dbMessage(pe));
  const paths = (photos ?? []).flatMap(photoPaths);
  for (let i = 0; i < paths.length; i += 100) {
    const rm = await sb.storage.from(ALBUM_BUCKET).remove(paths.slice(i, i + 100));
    if (rm.error) return fail("تعذّر حذف ملفات الألبوم من التخزين. لم يُحذف شيء من السجل؛ أعد المحاولة.");
  }
  const { data, error } = await sb.from("photo_albums").delete().eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  redirect("/admin/albums");
}

// ------------------------------------------------------------------ uploads
export type PreparedAlbumUpload =
  | { ok: true; name: string; photoId: string; path: string; token: string }
  | { ok: false; name: string; message: string };

/**
 * Step 1: validate each file (type/size), create a pending album_photos row (id = storage folder)
 * and a signed upload URL into the private `album-media` bucket. RLS/storage policies: admin only.
 */
export async function prepareAlbumUploads(
  albumId: string,
  files: { name: string; type: string; size: number }[],
): Promise<{ ok: boolean; message?: string; items: PreparedAlbumUpload[] }> {
  if (!(await guard(ADMIN_ROLES))) return { ok: false, message: FORBIDDEN.message, items: [] };
  if (!isUuid(albumId) || !Array.isArray(files) || !files.length) return { ok: false, message: "لا توجد ملفات.", items: [] };
  if (files.length > ALBUM_MAX_FILES_PER_BATCH) return { ok: false, message: `الحد ${ALBUM_MAX_FILES_PER_BATCH} صورة في كل دفعة.`, items: [] };
  const sb = await createClient();
  const { data: last } = await sb.from("album_photos").select("sort_order").eq("album_id", albumId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  let sort = (last?.sort_order ?? 0) + 10;
  const items: PreparedAlbumUpload[] = [];
  for (const f of files) {
    const name = String(f?.name ?? "").slice(0, 200);
    const type = String(f?.type ?? "");
    const size = Number(f?.size ?? 0);
    const problem = checkAlbumFile({ type, size });
    if (problem) {
      items.push({ ok: false, name, message: problem });
      continue;
    }
    const photoId = randomUUID();
    const path = albumObjectPath(albumId, photoId, type);
    const ins = await sb
      .from("album_photos")
      .insert({ id: photoId, album_id: albumId, storage_path_original: path, mime: type, bytes: size, sort_order: sort, upload_status: "pending" })
      .select("id")
      .single();
    if (ins.error || !ins.data) {
      items.push({ ok: false, name, message: dbMessage(ins.error) });
      continue;
    }
    sort += 10;
    const signed = await sb.storage.from(ALBUM_BUCKET).createSignedUploadUrl(path);
    if (signed.error || !signed.data) {
      await sb.from("album_photos").update({ upload_status: "failed" }).eq("id", photoId);
      items.push({ ok: false, name, message: "تعذّر تجهيز الرفع لهذا الملف." });
      continue;
    }
    items.push({ ok: true, name, photoId, path, token: signed.data.token });
  }
  return { ok: items.some((i) => i.ok), items };
}

export type AlbumFinalizeResult = { photoId: string; ok: boolean; variants: boolean; message: string };

/**
 * Step 2 (per file): confirm the object, then generate WebP thumb (≈480) and display (≈1600)
 * variants with sharp (fit inside: never cropped; the original object is never modified, so any
 * watermark is preserved), and record width/height. Variant failure is a partial result.
 */
export async function finalizeAlbumPhoto(photoId: string): Promise<AlbumFinalizeResult> {
  const fail_ = (message: string): AlbumFinalizeResult => ({ photoId, ok: false, variants: false, message });
  if (!(await guard(ADMIN_ROLES))) return fail_(FORBIDDEN.message);
  if (!isUuid(photoId)) return fail_("ملف غير صالح.");
  const sb = await createClient();
  const { data: p } = await sb.from("album_photos").select("id, storage_path_original, mime").eq("id", photoId).maybeSingle();
  if (!p) return fail_("السجل غير موجود.");
  const markFailed = () => sb.from("album_photos").update({ upload_status: "failed" }).eq("id", photoId);

  const info = await sb.storage.from(ALBUM_BUCKET).info(p.storage_path_original);
  if (info.error || !info.data) {
    await markFailed();
    return fail_("لم يصل الملف إلى التخزين.");
  }
  const size = info.data.size ?? null;
  if (!ALBUM_MIME_EXT[p.mime] || (size !== null && size > ALBUM_MAX_BYTES)) {
    await sb.storage.from(ALBUM_BUCKET).remove([p.storage_path_original]);
    await markFailed();
    return fail_("الملف المرفوع تجاوز الحد المسموح أو نوعه غير مدعوم.");
  }
  const base = p.storage_path_original.slice(0, p.storage_path_original.lastIndexOf("/"));
  try {
    const dl = await sb.storage.from(ALBUM_BUCKET).download(p.storage_path_original);
    if (dl.error || !dl.data) throw new Error("download");
    const input = Buffer.from(await dl.data.arrayBuffer());
    const img = sharp(input, { failOn: "error" }).rotate();
    const meta = await img.metadata();
    const [thumb, display] = await Promise.all([
      img.clone().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 76 }).toBuffer(),
      img.clone().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
    ]);
    const opts = { contentType: "image/webp", upsert: true, cacheControl: "31536000" };
    const [t, d] = await Promise.all([
      sb.storage.from(ALBUM_BUCKET).upload(`${base}/thumb.webp`, thumb, opts),
      sb.storage.from(ALBUM_BUCKET).upload(`${base}/display.webp`, display, opts),
    ]);
    if (t.error || d.error) throw new Error("variant upload");
    const oriented = (meta.orientation ?? 1) >= 5;
    const up = await sb
      .from("album_photos")
      .update({
        upload_status: "ready",
        bytes: size,
        width: (oriented ? meta.height : meta.width) ?? null,
        height: (oriented ? meta.width : meta.height) ?? null,
        variants: { thumb: `${base}/thumb.webp`, display: `${base}/display.webp` },
      })
      .eq("id", photoId);
    if (up.error) return fail_(dbMessage(up.error));
    return { photoId, ok: true, variants: true, message: "رُفعت الصورة وأُنشئت المعاينات." };
  } catch {
    // The original is stored and untouched; keep it (ready, no variants) and report partial.
    await sb.from("album_photos").update({ upload_status: "ready", bytes: size }).eq("id", photoId);
    return { photoId, ok: true, variants: false, message: "رُفع الأصل، لكن تعذّر إنشاء المعاينات. استخدم «إعادة إنشاء المعاينات»." };
  }
}

export async function markAlbumUploadFailed(photoId: string): Promise<void> {
  if (!(await guard(ADMIN_ROLES)) || !isUuid(photoId)) return;
  const sb = await createClient();
  await sb.from("album_photos").update({ upload_status: "failed" }).eq("id", photoId).eq("upload_status", "pending");
}

export async function refreshAlbum(): Promise<void> {
  refresh();
}

export async function retryAlbumVariants(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const r = await finalizeAlbumPhoto(str(fd, "id"));
  refresh();
  return r.ok && r.variants ? ok(r.message) : fail(r.message);
}

// ------------------------------------------------------------------ photos
async function photoOf(sb: SB, id: string) {
  const { data } = await sb.from("album_photos").select("id, album_id, storage_path_original, variants, upload_status").eq("id", id).maybeSingle();
  return data;
}

export async function setAlbumCover(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await createClient();
  const p = await photoOf(sb, id);
  if (!p) return fail("الصورة غير موجودة.");
  const { error } = await sb.from("photo_albums").update({ cover_photo_id: id }).eq("id", p.album_id);
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("أصبحت صورة الغلاف.");
}

export async function setPhotoPublished(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const publish = fd.get("publish") === "1";
  const sb = await createClient();
  const { data, error } = await sb.from("album_photos").update({ is_published: publish }).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("الصورة غير موجودة.");
  refresh();
  return ok(publish ? "أصبحت الصورة ظاهرة." : "أُخفيت الصورة من الموقع.");
}

export async function setPhotoAlt(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const alt = altTextSchema.safeParse(str(fd, "alt_text"));
  if (!alt.success) return fail(alt.error.issues[0]?.message ?? "نص غير صالح.");
  const sb = await createClient();
  const { data, error } = await sb.from("album_photos").update({ alt_text: alt.data || null }).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("الصورة غير موجودة.");
  refresh();
  return ok("حُفظ الوصف.");
}

/** Up/down: renumber the album's photos 10, 20, … in the new order. */
export async function movePhoto(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const dir = fd.get("dir") === "up" ? -1 : 1;
  const sb = await createClient();
  const p = await photoOf(sb, id);
  if (!p) return fail("الصورة غير موجودة.");
  const { data: rows, error } = await sb.from("album_photos").select("id, sort_order").eq("album_id", p.album_id).order("sort_order").order("created_at");
  if (error || !rows) return fail(dbMessage(error));
  const i = rows.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return ok("لا تغيير.");
  [rows[i], rows[j]] = [rows[j], rows[i]];
  for (let k = 0; k < rows.length; k++) {
    const want = (k + 1) * 10;
    if (rows[k].sort_order === want) continue;
    const u = await sb.from("album_photos").update({ sort_order: want }).eq("id", rows[k].id);
    if (u.error) return fail(dbMessage(u.error));
  }
  refresh();
  return ok("تغيّر الترتيب.");
}

/** Removes the storage objects (original + variants), then the row (cover is cleared by FK). */
export async function deletePhoto(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await createClient();
  const p = await photoOf(sb, id);
  if (!p) return fail("الصورة غير موجودة.");
  const rm = await sb.storage.from(ALBUM_BUCKET).remove(photoPaths(p));
  if (rm.error) return fail("تعذّر حذف ملفات الصورة من التخزين. أعد المحاولة.");
  const { error } = await sb.from("album_photos").delete().eq("id", id);
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("حُذفت الصورة وملفاتها.");
}
