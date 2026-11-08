"use server";

import sharp from "sharp";
import { refresh } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_ROLES, guard } from "@/features/admin/guard";
import { fail, FORBIDDEN, isUuid, ok, uuid, type ActionResult } from "@/features/admin/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { albumStore } from "@/lib/album-storage";
import { albumGraph } from "./album-graph";
import { runAlbumPost, type AlbumPatch, type AlbumPost } from "./album-core";

/** One run at a time per album; longer than one run (≤ 60 s) so a crashed run frees itself. */
const LEASE_SECONDS = 90;
const MAX_PHOTOS = 100;

/**
 * «نشر على فيسبوك»: creates a real album on the connected Page and adds the chosen photos (album-core.ts). Separate
 * from «نشر الألبوم» on the site: neither one changes the other. Owners/admins only. The Page token is read on the
 * server from Vault and never reaches the browser. One Facebook album per site album (unique row, migration 0035).
 */
export async function publishAlbumToFacebook(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const me = await guard(ADMIN_ROLES);
  if (!me) return FORBIDDEN;
  const albumId = uuid(fd, "album_id");
  if (!albumId) return fail("سجل غير صالح.");
  const chosen = [...new Set(fd.getAll("photo").map(String).filter(isUuid))];
  const sb = createAdminClient() as unknown as SupabaseClient | null;
  if (!sb) return fail("الخادم غير مهيأ.");

  const [{ data: conn }, { data: token }] = await Promise.all([
    sb.from("meta_page_connection").select("page_id, page_name, status").eq("id", 1).maybeSingle(),
    sb.rpc("meta_page_token"),
  ]);
  const page = conn as { page_id: string; page_name: string; status: string } | null;
  if (page?.status !== "connected" || typeof token !== "string" || !token) return fail("صفحة فيسبوك غير مربوطة. اربطها من الإعدادات › صفحة فيسبوك.");

  const { data: album } = await sb.from("photo_albums").select("id, title, description, archived_at, deleted_at").eq("id", albumId).maybeSingle();
  const a = album as { id: string; title: string; description: string | null; archived_at: string | null; deleted_at: string | null } | null;
  if (!a) return fail("الألبوم غير موجود.");
  if (a.archived_at || a.deleted_at) return fail("استرجع الألبوم من الأرشيف أو سلة المحذوفات أولاً.");

  let { data: row } = await sb.from("facebook_album_posts").select("*").eq("album_id", albumId).maybeSingle();
  if (row && (row as { status: string }).status === "published") {
    return fail("هذا الألبوم منشور على فيسبوك من قبل — لا يُنشر مرتين.", { url: (row as { fb_album_url: string | null }).fb_album_url });
  }
  if (row && (row as { page_id: string }).page_id !== page.page_id) return fail("الصفحة المربوطة تغيّرت منذ بدء النشر. لن نكمل على صفحة أخرى.");

  if (!row || (!(row as { fb_album_id: string | null }).fb_album_id && !Object.keys((row as { done: object }).done ?? {}).length)) {
    // Nothing on Facebook yet: (re)take the current selection, validated against this album's ready photos.
    if (!chosen.length) return fail("اختر صورة واحدة على الأقل.");
    if (chosen.length > MAX_PHOTOS) return fail(`الحد ${MAX_PHOTOS} صورة في المرة الواحدة.`);
    const { data: ok_ } = await sb.from("album_photos").select("id").eq("album_id", albumId).eq("upload_status", "ready").is("deleted_at", null).in("id", chosen);
    if ((ok_ ?? []).length !== chosen.length) return fail("بعض الصور المختارة غير جاهزة أو لا تتبع هذا الألبوم.");
    const fields = { page_id: page.page_id, page_name: page.page_name, title: a.title, photo_ids: chosen };
    if (!row) {
      const ins = await sb.from("facebook_album_posts").insert({ album_id: albumId, ...fields, created_by: me.userId }).select("*").maybeSingle();
      if (ins.error?.code === "23505") return fail("بدأ نشر هذا الألبوم من مكان آخر للتو. حدّث الصفحة.");
      if (ins.error || !ins.data) return fail("تعذّر بدء النشر.");
      row = ins.data;
    } else {
      await sb.from("facebook_album_posts").update(fields).eq("id", (row as { id: string }).id).is("fb_album_id", null);
      row = { ...row, ...fields };
    }
  }

  const id = (row as { id: string }).id;
  const until = new Date(Date.now() + LEASE_SECONDS * 1000).toISOString();
  const claim = await sb
    .from("facebook_album_posts")
    .update({ lease_until: until })
    .eq("id", id)
    .neq("status", "published")
    .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
    .select("id");
  if (!claim.data?.length) return fail("عملية نشر لهذا الألبوم جارية الآن. انتظر قليلاً ثم حدّث الصفحة.");

  const post = { ...(row as AlbumPost), message: a.description?.trim() || null };
  try {
    const r = await runAlbumPost(post, {
      graph: albumGraph((u, i) => fetch(u, { ...i, cache: "no-store" }), token),
      photoJpeg: async (photoId) => {
        const { data: ph } = await sb.from("album_photos").select("variants, storage_provider").eq("id", photoId).eq("album_id", albumId).is("deleted_at", null).maybeSingle();
        const path = (ph as { variants?: { display?: string } } | null)?.variants?.display;
        if (!path) return null;
        const bytes = await albumStore((ph as { storage_provider?: string }).storage_provider, sb).download(path);
        // The site's web copy (never the original), as JPEG: Facebook's photo upload does not take WebP.
        return bytes ? sharp(bytes).rotate().jpeg({ quality: 90, mozjpeg: true }).toBuffer() : null;
      },
      save: async (patch: AlbumPatch) => {
        const { error } = await sb.from("facebook_album_posts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
        if (error) throw new Error("save failed");
      },
    });
    refresh();
    if (r.status === "published") return ok("نُشر الألبوم على فيسبوك.", { url: r.url });
    if (r.status === "uploading") return ok(`أُرسلت ${r.sent} صورة، وبقي ${r.remaining}. اضغط «متابعة النشر» لإكمالها في نفس الألبوم.`);
    return fail(r.error ?? "تعذّر النشر.");
  } finally {
    await sb.from("facebook_album_posts").update({ lease_until: null }).eq("id", id);
  }
}
