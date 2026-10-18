"use server";

import { randomUUID } from "node:crypto";
import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { TAGS } from "@/lib/cache-tags";
import { guard, ADMIN_ROLES } from "@/features/admin/guard";
import { dbMessage, fail, FORBIDDEN, isUuid, ok, str, uuid, type ActionResult } from "@/features/admin/result";
import { runPhotoJobs } from "@/features/photo-processing/runner";
import { readAlbumForm, altTextSchema, readCategoryForm } from "./schema";
import { ALBUM_BUCKET, ALBUM_MAX_FILES_PER_BATCH, albumObjectPath, checkAlbumFile, SHA256_RE } from "./rules";

const SLUG_DUP = { "23505": "هذا المعرّف مستخدم لألبوم آخر." };
const CAT_DUP = { "23505": "هذا المعرّف مستخدم لتصنيف آخر." };
// Generated types may lag the CMS migration (categories, soft delete, queue columns): use an untyped view.
type SB = SupabaseClient;
const db = async () => (await createClient()) as unknown as SB;

/** Public-affecting change: expire the public albums cache and refresh the admin view. */
function published() {
  updateTag(TAGS.albums);
  refresh();
}

// ------------------------------------------------------------------ categories
export async function createCategory(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const parsed = readCategoryForm(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الحقول.");
  const { error } = await (await db()).from("album_categories").insert(parsed.data);
  if (error) return fail(dbMessage(error, CAT_DUP));
  published();
  return ok("أُضيف التصنيف.");
}

export async function updateCategory(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const parsed = readCategoryForm(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الحقول.");
  const { data, error } = await (await db()).from("album_categories").update(parsed.data).eq("id", id).select("id");
  if (error) return fail(dbMessage(error, CAT_DUP));
  if (!data?.length) return fail("السجل غير موجود.");
  published();
  return ok("حُفظ التصنيف.");
}

/** Albums keep existing; their category_id is cleared by the FK (on delete set null). */
export async function deleteCategory(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const { data, error } = await (await db()).from("album_categories").delete().eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  published();
  return ok("حُذف التصنيف (الألبومات بقيت بلا تصنيف).");
}

// ------------------------------------------------------------------ albums
export async function createAlbum(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const parsed = readAlbumForm(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الحقول.");
  const { data, error } = await (await db()).from("photo_albums").insert({ ...parsed.data, is_published: false }).select("id").single();
  if (error || !data) return fail(dbMessage(error, SLUG_DUP));
  redirect(`/admin/albums/${data.id}`);
}

export async function updateAlbum(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const parsed = readAlbumForm(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الحقول.");
  const { data, error } = await (await db()).from("photo_albums").update(parsed.data).eq("id", id).select("id");
  if (error) return fail(dbMessage(error, SLUG_DUP));
  if (!data?.length) return fail("السجل غير موجود.");
  published();
  return ok("حُفظ الألبوم.");
}

export async function setAlbumPublished(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const publish = fd.get("publish") === "1";
  const sb = await db();
  if (publish) {
    const { data: a } = await sb.from("photo_albums").select("archived_at, deleted_at").eq("id", id).maybeSingle();
    if (a?.archived_at || a?.deleted_at) return fail("استرجع الألبوم من الأرشيف أو سلة المحذوفات أولاً.");
    const { count } = await sb
      .from("album_photos")
      .select("id", { count: "exact", head: true })
      .eq("album_id", id)
      .eq("upload_status", "ready")
      .eq("is_published", true)
      .is("deleted_at", null);
    if (!count) return fail("لا يمكن نشر ألبوم بلا صور ظاهرة جاهزة.");
  }
  const { data, error } = await sb.from("photo_albums").update({ is_published: publish }).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  published();
  return ok(publish ? "نُشر الألبوم." : "أُخفي الألبوم وصوره من الموقع فوراً.");
}

/** Archive / trash / restore: soft states. Archived or trashed albums are never visible to the public (RLS). */
export async function setAlbumState(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const op = str(fd, "op");
  const now = new Date().toISOString();
  const patch: Record<string, unknown> | null =
    op === "archive" ? { archived_at: now, is_published: false }
    : op === "unarchive" ? { archived_at: null }
    : op === "trash" ? { deleted_at: now, is_published: false }
    : op === "untrash" ? { deleted_at: null }
    : null;
  if (!patch) return fail("طلب غير صالح.");
  const { data, error } = await (await db()).from("photo_albums").update(patch).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  published();
  const msg: Record<string, string> = {
    archive: "نُقل الألبوم إلى الأرشيف وأُخفي من الموقع.",
    unarchive: "أُعيد الألبوم من الأرشيف (مخفياً؛ انشره عند الجاهزية).",
    trash: "نُقل الألبوم إلى سلة المحذوفات. يمكن استرجاعه.",
    untrash: "استُرجع الألبوم من سلة المحذوفات (مخفياً).",
  };
  return ok(msg[op]);
}

/** Hard delete: only from the trash, only after typing the slug. The RPC deletes rows and enqueues storage cleanup. */
export async function purgeAlbum(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const confirmSlug = str(fd, "confirm_slug");
  const sb = await db();
  const { data: a } = await sb.from("photo_albums").select("slug, deleted_at").eq("id", id).maybeSingle();
  if (!a) return fail("السجل غير موجود.");
  if (!a.deleted_at) return fail("انقل الألبوم إلى سلة المحذوفات أولاً.");
  if (confirmSlug !== a.slug) return fail("المعرّف المكتوب لا يطابق معرّف الألبوم.");
  const { error } = await sb.rpc("purge_album", { p_id: id, p_confirm_slug: confirmSlug });
  if (error) return fail(dbMessage(error));
  updateTag(TAGS.albums);
  redirect("/admin/albums?view=trash");
}

// ------------------------------------------------------------------ uploads
export type UploadFile = { name: string; type: string; size: number; sha256: string };
export type PreparedAlbumUpload =
  | { ok: true; name: string; photoId: string; path: string; token: string; warning?: string }
  | { ok: false; name: string; message: string; skipped?: boolean };

type Dup = { album_id: string; album_title: string };

/**
 * Step 1: validate each file (type/size/sha256), dedupe by sha256 (same album → skip; another album →
 * upload with a warning naming that album's title only), create a `pending` album_photos row (id = storage
 * folder) and a signed upload URL into the private `album-media` bucket. Admin only (RLS + storage policy).
 */
export async function prepareAlbumUploads(
  albumId: string,
  files: UploadFile[],
): Promise<{ ok: boolean; message?: string; items: PreparedAlbumUpload[] }> {
  if (!(await guard(ADMIN_ROLES))) return { ok: false, message: FORBIDDEN.message, items: [] };
  if (!isUuid(albumId) || !Array.isArray(files) || !files.length) return { ok: false, message: "لا توجد ملفات.", items: [] };
  if (files.length > ALBUM_MAX_FILES_PER_BATCH) return { ok: false, message: `الحد ${ALBUM_MAX_FILES_PER_BATCH} صورة في كل دفعة.`, items: [] };
  const sb = await db();
  const { data: album } = await sb.from("photo_albums").select("id, deleted_at").eq("id", albumId).maybeSingle();
  if (!album || album.deleted_at) return { ok: false, message: "الألبوم غير موجود أو في سلة المحذوفات.", items: [] };
  const { data: last } = await sb.from("album_photos").select("sort_order").eq("album_id", albumId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  let sort = (last?.sort_order ?? 0) + 10;
  const items: PreparedAlbumUpload[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const name = String(f?.name ?? "").slice(0, 200);
    const type = String(f?.type ?? "");
    const size = Number(f?.size ?? 0);
    const sha = String(f?.sha256 ?? "").toLowerCase();
    const problem = checkAlbumFile({ type, size }) ?? (SHA256_RE.test(sha) ? null : "تعذّر حساب بصمة الملف.");
    if (problem) {
      items.push({ ok: false, name, message: problem });
      continue;
    }
    if (seen.has(sha)) {
      items.push({ ok: false, name, skipped: true, message: "مكرر داخل هذه الدفعة — تم تخطيه." });
      continue;
    }
    seen.add(sha);
    const dup = await sb.rpc("find_duplicate_photo", { p_sha256: sha });
    const dups = ((dup.data ?? []) as Dup[]).filter(Boolean);
    if (dups.some((d) => d.album_id === albumId)) {
      items.push({ ok: false, name, skipped: true, message: "الصورة موجودة في هذا الألبوم — تم تخطيها." });
      continue;
    }
    const other = dups.find((d) => d.album_id !== albumId);
    const photoId = randomUUID();
    const path = albumObjectPath(albumId, photoId, type);
    const ins = await sb
      .from("album_photos")
      .insert({ id: photoId, album_id: albumId, storage_path_original: path, mime: type, bytes: size, sha256: sha, sort_order: sort, upload_status: "pending" })
      .select("id")
      .single();
    if (ins.error || !ins.data) {
      items.push(ins.error?.code === "23505" ? { ok: false, name, skipped: true, message: "الصورة موجودة في هذا الألبوم — تم تخطيها." } : { ok: false, name, message: dbMessage(ins.error) });
      continue;
    }
    sort += 10;
    const signed = await sb.storage.from(ALBUM_BUCKET).createSignedUploadUrl(path);
    if (signed.error || !signed.data) {
      await sb.from("album_photos").delete().eq("id", photoId).eq("upload_status", "pending");
      items.push({ ok: false, name, message: "تعذّر تجهيز الرفع لهذا الملف." });
      continue;
    }
    items.push({
      ok: true,
      name,
      photoId,
      path,
      token: signed.data.token,
      warning: other ? `تنبيه: الصورة نفسها موجودة في ألبوم «${other.album_title}».` : undefined,
    });
  }
  return { ok: items.some((i) => i.ok), items };
}

export type PhotoStatus = { id: string; status: "pending" | "processing" | "ready" | "failed"; error: string | null; attempts: number };

async function statuses(sb: SB, where: { albumId?: string; ids?: string[] }): Promise<PhotoStatus[]> {
  let q = sb.from("album_photos").select("id, upload_status, last_error, attempts").is("deleted_at", null);
  if (where.ids) q = q.in("id", where.ids);
  if (where.albumId) q = q.eq("album_id", where.albumId);
  const { data } = await q;
  // requeue_album_photos parks rows as failed / attempts 0 / "requeued by admin" = waiting in the queue.
  return (data ?? []).map((r) => {
    const queued = r.upload_status === "failed" && r.last_error === "requeued by admin";
    return { id: r.id, status: queued ? "pending" : r.upload_status, error: queued ? null : (r.last_error ?? null), attempts: r.attempts ?? 0 };
  });
}

/**
 * Step 2 (immediate feedback only): run the same server-side worker the cron uses, limited to the given
 * photos. If this request dies, the cron finishes the job; the result is just the current DB state.
 */
export async function processUploadedPhotos(albumId: string, photoIds: string[]): Promise<PhotoStatus[]> {
  if (!(await guard(ADMIN_ROLES))) return [];
  const ids = (Array.isArray(photoIds) ? photoIds : []).filter(isUuid).slice(0, ALBUM_MAX_FILES_PER_BATCH);
  if (!isUuid(albumId) || !ids.length) return [];
  const sb = await db();
  // Skip the 2-minute "browser may still be uploading" grace: these uploads are confirmed finished.
  for (const id of ids) await sb.rpc("requeue_album_photos", { p_album_id: albumId, p_photo_id: id });
  try {
    await runPhotoJobs({ limit: Math.min(ids.length, 8) });
  } catch {
    /* the cron worker retries */
  }
  return statuses(sb, { ids });
}

/** Resume after reload: photos of this album that are not finished yet (pending/processing/failed). */
export async function getUnfinishedPhotos(albumId: string): Promise<PhotoStatus[]> {
  if (!(await guard(ADMIN_ROLES)) || !isUuid(albumId)) return [];
  return (await statuses(await db(), { albumId })).filter((s) => s.status !== "ready");
}

/** The browser could not upload the original: drop the still-empty pending row so a retry can re-prepare
 *  the same file (the sha256 unique index would otherwise flag it as a duplicate). Only rows whose object
 *  does not exist are removed. */
export async function discardFailedUpload(photoId: string): Promise<void> {
  if (!(await guard(ADMIN_ROLES)) || !isUuid(photoId)) return;
  const sb = await db();
  const { data: p } = await sb.from("album_photos").select("storage_path_original, upload_status").eq("id", photoId).maybeSingle();
  if (!p || p.upload_status !== "pending") return;
  const info = await sb.storage.from(ALBUM_BUCKET).info(p.storage_path_original);
  if (info.data) return; // the object arrived after all: let the queue process it
  await sb.from("album_photos").delete().eq("id", photoId).eq("upload_status", "pending");
}

/** «إعادة المحاولة»: fresh attempt budget (requeue RPC), then process now. */
export async function retryPhoto(albumId: string, photoId: string): Promise<PhotoStatus[]> {
  return processUploadedPhotos(albumId, [photoId]);
}

/** «إعادة المحاولة» form for a failed/pending photo in the grid. */
export async function retryAlbumVariants(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const p = await photoOf(await db(), id);
  if (!p) return fail("الصورة غير موجودة.");
  const [s] = await processUploadedPhotos(p.album_id, [id]);
  published();
  return s?.status === "ready" ? ok("أُنشئت المعاينات.") : fail(s?.status === "failed" ? `فشلت المعالجة: ${s.error ?? ""}` : "أُضيفت إلى طابور المعالجة؛ ستكتمل خلال دقائق.");
}

export async function refreshAlbum(): Promise<void> {
  updateTag(TAGS.albums);
  refresh();
}

// ------------------------------------------------------------------ photos
async function photoOf(sb: SB, id: string) {
  const { data } = await sb.from("album_photos").select("id, album_id, upload_status, deleted_at").eq("id", id).maybeSingle();
  return data as { id: string; album_id: string; upload_status: string; deleted_at: string | null } | null;
}

export async function setAlbumCover(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await db();
  const p = await photoOf(sb, id);
  if (!p || p.deleted_at) return fail("الصورة غير موجودة.");
  if (p.upload_status !== "ready") return fail("الصورة لم تجهز بعد.");
  const { error } = await sb.from("photo_albums").update({ cover_photo_id: id }).eq("id", p.album_id);
  if (error) return fail(dbMessage(error));
  published();
  return ok("أصبحت صورة الغلاف.");
}

export async function setPhotoPublished(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const publish = fd.get("publish") === "1";
  const { data, error } = await (await db()).from("album_photos").update({ is_published: publish }).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("الصورة غير موجودة.");
  published();
  return ok(publish ? "أصبحت الصورة ظاهرة." : "أُخفيت الصورة من الموقع.");
}

export async function setPhotoAlt(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const alt = altTextSchema.safeParse(str(fd, "alt_text"));
  if (!alt.success) return fail(alt.error.issues[0]?.message ?? "نص غير صالح.");
  const { data, error } = await (await db()).from("album_photos").update({ alt_text: alt.data || null }).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("الصورة غير موجودة.");
  published();
  return ok("حُفظ الوصف.");
}

async function renumber(sb: SB, albumId: string, orderedIds: string[]): Promise<string | null> {
  const { data: rows, error } = await sb.from("album_photos").select("id, sort_order").eq("album_id", albumId).is("deleted_at", null).order("sort_order").order("created_at");
  if (error || !rows) return dbMessage(error);
  const known = new Set(rows.map((r) => r.id));
  const order = [...orderedIds.filter((id) => known.has(id)), ...rows.map((r) => r.id).filter((id) => !orderedIds.includes(id))];
  const current = new Map(rows.map((r) => [r.id, r.sort_order]));
  for (let k = 0; k < order.length; k++) {
    const want = (k + 1) * 10;
    if (current.get(order[k]) === want) continue;
    const u = await sb.from("album_photos").update({ sort_order: want }).eq("id", order[k]).eq("album_id", albumId);
    if (u.error) return dbMessage(u.error);
  }
  return null;
}

/** Up/down buttons: swap with the neighbour, renumber 10, 20, … */
export async function movePhoto(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const dir = fd.get("dir") === "up" ? -1 : 1;
  const sb = await db();
  const p = await photoOf(sb, id);
  if (!p) return fail("الصورة غير موجودة.");
  const { data: rows, error } = await sb.from("album_photos").select("id").eq("album_id", p.album_id).is("deleted_at", null).order("sort_order").order("created_at");
  if (error || !rows) return fail(dbMessage(error));
  const ids = rows.map((r) => r.id as string);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return ok("لا تغيير.");
  [ids[i], ids[j]] = [ids[j], ids[i]];
  const err = await renumber(sb, p.album_id, ids);
  if (err) return fail(err);
  published();
  return ok("تغيّر الترتيب.");
}

/** Drag & drop: the full new order of the album's photo ids. */
export async function reorderPhotos(albumId: string, orderedIds: string[]): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  if (!isUuid(albumId) || !Array.isArray(orderedIds) || !orderedIds.every(isUuid) || orderedIds.length > 5000) return fail("طلب غير صالح.");
  const err = await renumber(await db(), albumId, orderedIds);
  if (err) return fail(err);
  published();
  return ok("حُفظ الترتيب.");
}

/** Soft delete (trash). Files stay until the album is purged; restorable. Cover is cleared if needed. */
export async function trashPhoto(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await db();
  const p = await photoOf(sb, id);
  if (!p) return fail("الصورة غير موجودة.");
  const { error } = await sb.from("album_photos").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) return fail(dbMessage(error));
  await sb.from("photo_albums").update({ cover_photo_id: null }).eq("id", p.album_id).eq("cover_photo_id", id);
  published();
  return ok("نُقلت الصورة إلى سلة المحذوفات.");
}

export async function restorePhoto(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const { data, error } = await (await db()).from("album_photos").update({ deleted_at: null }).eq("id", id).select("id");
  if (error) return fail(dbMessage(error, { "23505": "نسخة مطابقة من الصورة موجودة في الألبوم." }));
  if (!data?.length) return fail("الصورة غير موجودة.");
  published();
  return ok("استُرجعت الصورة.");
}
