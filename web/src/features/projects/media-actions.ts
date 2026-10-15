"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { guard, ADMIN_ROLES, ALL_STAFF } from "@/features/admin/guard";
import { dbMessage, fail, FORBIDDEN, isUuid, ok, str, uuid, type ActionResult } from "@/features/admin/result";
import { cleanupPublicMedia, PRIVATE_BUCKET, PUBLIC_BUCKET } from "@/features/publishing/server";
import { checkFile, MAX_FILES_PER_BATCH, MIME_RULES } from "./media-rules";

export type PreparedUpload =
  | { ok: true; name: string; assetId: string; path: string; token: string }
  | { ok: false; name: string; message: string };

/**
 * Step 1: validate, create `media_assets` rows (pending) and signed upload
 * URLs. Both use the caller's client, so RLS decides (admin, or staff
 * assigned to the event). The browser then uploads straight to storage.
 */
export async function prepareUploads(
  eventId: string,
  files: { name: string; type: string; size: number }[],
): Promise<{ ok: boolean; message?: string; items: PreparedUpload[] }> {
  if (!(await guard(ALL_STAFF))) return { ok: false, message: FORBIDDEN.message, items: [] };
  if (!isUuid(eventId) || !Array.isArray(files) || files.length === 0) return { ok: false, message: "لا توجد ملفات.", items: [] };
  if (files.length > MAX_FILES_PER_BATCH) return { ok: false, message: `الحد ${MAX_FILES_PER_BATCH} ملفاً في كل دفعة.`, items: [] };
  const sb = await createClient();
  const items: PreparedUpload[] = [];
  for (const f of files) {
    const name = String(f?.name ?? "").slice(0, 200);
    const problem = checkFile({ type: String(f?.type ?? ""), size: Number(f?.size ?? 0) });
    if (problem) {
      items.push({ ok: false, name, message: problem });
      continue;
    }
    const rule = MIME_RULES[f.type];
    const folderId = randomUUID(); // becomes the asset id
    const path = `events/${eventId}/${folderId}/original.${rule.ext}`;
    const row = {
      event_id: eventId,
      bucket: "private-media" as const,
      path,
      kind: rule.kind,
      mime: f.type,
      bytes: Number(f.size),
      upload_status: "pending" as const,
      visibility: "private" as const,
    };
    // Client-chosen id (grant from migration 0008): storage folder uuid == media_assets.id.
    const ins = await sb.from("media_assets").insert({ ...row, id: folderId }).select("id").single();
    if (ins.error || !ins.data) {
      items.push({ ok: false, name, message: dbMessage(ins.error) });
      continue;
    }
    const assetId = ins.data.id;
    const signed = await sb.storage.from(PRIVATE_BUCKET).createSignedUploadUrl(path);
    if (signed.error || !signed.data) {
      await sb.from("media_assets").update({ upload_status: "failed" }).eq("id", assetId);
      items.push({ ok: false, name, message: "تعذّر تجهيز الرفع لهذا الملف." });
      continue;
    }
    items.push({ ok: true, name, assetId, path, token: signed.data.token });
  }
  return { ok: items.some((i) => i.ok), items };
}

export type FinalizeResult = { assetId: string; ok: boolean; variants: boolean; message: string };

/**
 * Step 2 (per file): confirm the object exists, and for images generate
 * thumb (~480px) and display (~1600px) WebP variants with sharp. The asset is
 * `ready` when the original is stored; variant failure is reported as partial.
 */
export async function finalizeUpload(assetId: string): Promise<FinalizeResult> {
  const fail_ = (message: string): FinalizeResult => ({ assetId, ok: false, variants: false, message });
  if (!(await guard(ALL_STAFF))) return fail_(FORBIDDEN.message);
  if (!isUuid(assetId)) return fail_("ملف غير صالح.");
  const sb = await createClient();
  const { data: asset } = await sb.from("media_assets").select("id, event_id, path, kind, mime, upload_status").eq("id", assetId).maybeSingle();
  if (!asset || !asset.event_id) return fail_("السجل غير موجود.");
  const rule = MIME_RULES[asset.mime];

  const info = await sb.storage.from(PRIVATE_BUCKET).info(asset.path);
  if (info.error || !info.data) {
    await sb.from("media_assets").update({ upload_status: "failed" }).eq("id", assetId);
    return fail_("لم يصل الملف إلى التخزين.");
  }
  const size = info.data.size ?? null;
  if (!rule || (size !== null && size > rule.max)) {
    await sb.storage.from(PRIVATE_BUCKET).remove([asset.path]);
    await sb.from("media_assets").update({ upload_status: "failed" }).eq("id", assetId);
    return fail_("الملف المرفوع تجاوز الحد المسموح أو نوعه غير مدعوم.");
  }

  if (asset.kind !== "image") {
    const up = await sb.from("media_assets").update({ upload_status: "ready", bytes: size }).eq("id", assetId);
    if (up.error) return fail_(dbMessage(up.error));
    return { assetId, ok: true, variants: false, message: "رُفع الملف." };
  }

  const base = asset.path.slice(0, asset.path.lastIndexOf("/"));
  try {
    const dl = await sb.storage.from(PRIVATE_BUCKET).download(asset.path);
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
      sb.storage.from(PRIVATE_BUCKET).upload(`${base}/thumb.webp`, thumb, opts),
      sb.storage.from(PRIVATE_BUCKET).upload(`${base}/display.webp`, display, opts),
    ]);
    if (t.error || d.error) throw new Error("variant upload");
    const oriented = (meta.orientation ?? 1) >= 5;
    const up = await sb
      .from("media_assets")
      .update({
        upload_status: "ready",
        bytes: size,
        width: (oriented ? meta.height : meta.width) ?? null,
        height: (oriented ? meta.width : meta.height) ?? null,
        variants: { thumb: `${base}/thumb.webp`, display: `${base}/display.webp` },
      })
      .eq("id", assetId);
    if (up.error) return fail_(dbMessage(up.error));
    return { assetId, ok: true, variants: true, message: "رُفعت الصورة وأُنشئت المعاينات." };
  } catch {
    // Original is safe in storage; keep it usable but report the partial result.
    await sb.from("media_assets").update({ upload_status: "ready", bytes: size }).eq("id", assetId);
    return { assetId, ok: true, variants: false, message: "رُفع الأصل، لكن تعذّر إنشاء المعاينات (نوع غير مدعوم للمعالجة)." };
  }
}

export async function markUploadFailed(assetId: string): Promise<void> {
  if (!(await guard(ALL_STAFF)) || !isUuid(assetId)) return;
  const sb = await createClient();
  await sb.from("media_assets").update({ upload_status: "failed" }).eq("id", assetId).eq("upload_status", "pending");
}

export async function refreshMedia(): Promise<void> {
  refresh();
}

// ------------------------------------------------------------- publish / unpublish / delete
/**
 * Publish one image: copy its display (and thumb) variant into public-media
 * and create a public media_assets row pointing at the copy. Allowed only
 * while the event is published with granted consent (also enforced by the
 * media_visibility trigger).
 */
export async function publishMediaItem(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const assetId = uuid(fd, "id");
  if (!assetId) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { data: a } = await sb.from("media_assets").select("id, event_id, kind, variants, width, height, sort_order").eq("id", assetId).eq("bucket", "private-media").maybeSingle();
  if (!a?.event_id) return fail("الملف غير موجود.");
  if (a.kind !== "image") return fail("يُنشر من الصور فقط. للفيديو استخدم مزوّد البث (انظر التوثيق).");
  const v = (a.variants ?? {}) as Record<string, unknown>;
  if (typeof v.display !== "string") return fail("لا توجد نسخة عرض لهذه الصورة.");
  const { data: ev } = await sb.from("events").select("is_published, publication_consent").eq("id", a.event_id).maybeSingle();
  if (!ev || !ev.is_published || ev.publication_consent !== "granted")
    return fail("لا يمكن نشر صور مناسبة غير منشورة أو بدون موافقة العميل.");

  const base = v.display.slice(0, v.display.lastIndexOf("/"));
  const pubDisplay = `${base}/display.webp`;
  const pubThumb = `${base}/thumb.webp`;
  const existing = await sb.from("media_assets").select("id").eq("bucket", "public-media").eq("path", pubDisplay).maybeSingle();
  if (existing.data) return ok("الصورة منشورة مسبقاً.");

  const c1 = await sb.storage.from(PRIVATE_BUCKET).copy(v.display, pubDisplay, { destinationBucket: PUBLIC_BUCKET });
  const c2 = typeof v.thumb === "string" ? await sb.storage.from(PRIVATE_BUCKET).copy(v.thumb, pubThumb, { destinationBucket: PUBLIC_BUCKET }) : { error: null };
  if (c1.error || c2.error) {
    await sb.storage.from(PUBLIC_BUCKET).remove([pubDisplay, pubThumb]);
    return fail("تعذّر نسخ الصورة إلى التخزين العام.");
  }
  const ins = await sb.from("media_assets").insert({
    event_id: a.event_id,
    bucket: "public-media",
    path: pubDisplay,
    kind: "image",
    mime: "image/webp",
    width: a.width,
    height: a.height,
    sort_order: a.sort_order,
    variants: { display: pubDisplay, thumb: typeof v.thumb === "string" ? pubThumb : pubDisplay }, // paths only: every value is treated as a storage path by the cleanup queue
    visibility: "public",
    upload_status: "ready",
  });
  if (ins.error) {
    await sb.storage.from(PUBLIC_BUCKET).remove([pubDisplay, pubThumb]);
    return fail(dbMessage(ins.error, { "42501": "لا يمكن النشر: المناسبة غير منشورة أو بدون موافقة." }));
  }
  refresh();
  return ok("نُشرت الصورة.");
}

export async function unpublishMediaItem(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const publicId = uuid(fd, "public_id");
  const eventId = uuid(fd, "event_id");
  if (!publicId || !eventId) return fail("طلب غير صالح.");
  const sb = await createClient();
  const r = await cleanupPublicMedia(sb, eventId, [publicId]);
  refresh();
  return r.failed ? fail("تعذّر إزالة النسخة العامة. أعد المحاولة.") : ok("أُزيلت الصورة من النشر وحُذفت نسختها العامة.");
}

/** Bulk delete with per-item results. Removes storage objects, then the row. Admin only. */
export async function deleteMediaItems(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const ids = fd.getAll("ids").map(String).filter(isUuid).slice(0, 200);
  const eventId = uuid(fd, "event_id");
  if (!ids.length || !eventId) return fail("لم تختر أي ملف.");
  const sb = await createClient();
  const { data: rows } = await sb.from("media_assets").select("id, path, variants").in("id", ids).eq("event_id", eventId).eq("bucket", "private-media");
  const results: { id: string; ok: boolean }[] = [];
  for (const id of ids) {
    const row = rows?.find((r) => r.id === id);
    if (!row) {
      results.push({ id, ok: false });
      continue;
    }
    // Public copies made from this asset go first.
    const pub = await sb.from("media_assets").select("id").eq("bucket", "public-media").eq("event_id", eventId).like("path", `events/${eventId}/${id}/%`);
    if (pub.data?.length) await cleanupPublicMedia(sb, eventId, pub.data.map((p) => p.id));
    const v = (row.variants ?? {}) as Record<string, unknown>;
    const paths = [row.path, v.thumb, v.display].filter((p): p is string => typeof p === "string");
    const rm = await sb.storage.from(PRIVATE_BUCKET).remove(Array.from(new Set(paths)));
    const del = rm.error ? { error: rm.error } : await sb.from("media_assets").delete().eq("id", id);
    results.push({ id, ok: !del.error });
  }
  const okCount = results.filter((r) => r.ok).length;
  refresh();
  const msg = `حُذف ${okCount} من ${ids.length}.${okCount < ids.length ? ` تعذّر حذف ${ids.length - okCount}.` : ""}`;
  return okCount === ids.length ? ok(msg, { results }) : fail(msg, { results });
}

export async function retryVariants(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id");
  const r = await finalizeUpload(id);
  refresh();
  return r.ok && r.variants ? ok(r.message) : fail(r.message);
}
