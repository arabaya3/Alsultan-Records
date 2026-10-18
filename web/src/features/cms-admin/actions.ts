"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { TAGS, type CacheTag } from "@/lib/cache-tags";
import { ADMIN_ROLES, guard } from "@/features/admin/guard";
import { dbMessage, fail, FORBIDDEN, ok, str, uuid, type ActionResult } from "@/features/admin/result";
import { cms } from "./db";
import {
  announcementSchema,
  firstIssue,
  homeSchema,
  identitySchema,
  keyOrderSchema,
  navItemSchema,
  offerSchema,
  orderSchema,
  sectionIntroSchema,
  sectionSchema,
  serviceSchema,
  stepSchema,
} from "./schema";
import { SECTION_FEATURE } from "./targets";

type SB = Awaited<ReturnType<typeof cms>>;
const FEATURE_TABLE = { video: "showcase_videos", service: "services", offer: "offers", album: "photo_albums" } as const;

/** Expire every affected public cache tag and refresh the admin view. */
function publish(...tags: CacheTag[]) {
  for (const t of new Set(tags)) updateTag(t);
  refresh();
}

const T = {
  identity: [TAGS.business, TAGS.siteContent, TAGS.nav],
  home: [TAGS.business, TAGS.siteContent, TAGS.sections],
  services: [TAGS.services, TAGS.sections],
  process: [TAGS.process, TAGS.sections],
  offers: [TAGS.offers, TAGS.announcements, TAGS.sections],
  announcements: [TAGS.announcements],
  nav: [TAGS.nav, TAGS.sections],
  sections: [TAGS.sections, TAGS.nav],
} satisfies Record<string, CacheTag[]>;

const SLUG_DUP = { "23505": "هذا الرابط المختصر مستخدم مسبقاً. اختر غيره." };
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "1";
const all = (fd: FormData, k: string) => Array.from(new Set(fd.getAll(k).map(String).filter(Boolean)));

// Ordered tables an action may renumber (never user-controlled).
type OrderedTable = "services" | "process_steps" | "offers" | "announcements" | "nav_items";
const ORDER_TAGS: Record<OrderedTable, CacheTag[]> = {
  services: T.services,
  process_steps: T.process,
  offers: T.offers,
  announcements: T.announcements,
  nav_items: T.nav,
};
const ORDERED = Object.keys(ORDER_TAGS) as OrderedTable[];
function orderedTable(fd: FormData): OrderedTable | null {
  const t = str(fd, "table") as OrderedTable;
  return ORDERED.includes(t) ? t : null;
}

async function writeOrder(sb: SB, table: OrderedTable, ids: string[]) {
  for (let k = 0; k < ids.length; k++) {
    const { error } = await sb.from(table).update({ sort_order: (k + 1) * 10 }).eq("id", ids[k]);
    if (error) return error;
  }
  return null;
}

/** Drag-and-drop or buttons: the client posts the full id list in the new order. */
export async function saveOrder(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const table = orderedTable(fd);
  const ids = orderSchema.safeParse(fd.getAll("order").map(String));
  if (!table || !ids.success) return fail("ترتيب غير صالح.");
  const sb = await cms();
  const { data: cur, error } = await sb.from(table).select("id");
  if (error) return fail(dbMessage(error));
  const known = new Set((cur ?? []).map((r: { id: string }) => r.id));
  if (ids.data.length !== known.size || ids.data.some((i) => !known.has(i))) return fail("تغيّرت القائمة. حدّث الصفحة ثم أعد الترتيب.");
  const e = await writeOrder(sb, table, ids.data);
  if (e) return fail(dbMessage(e));
  publish(...ORDER_TAGS[table]);
  return ok("حُفظ الترتيب.");
}

/** Publish/hide toggles for tables with a boolean visibility column. */
const TOGGLES = {
  services: { col: "is_published", tags: T.services },
  process_steps: { col: "is_published", tags: T.process },
  announcements: { col: "is_visible", tags: T.announcements },
  nav_items: { col: "is_visible", tags: T.nav },
} as const;
export async function setVisible(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const table = str(fd, "table") as keyof typeof TOGGLES;
  const id = uuid(fd, "id");
  if (!(table in TOGGLES) || !id) return fail("سجل غير صالح.");
  const on = fd.get("value") === "1";
  const sb = await cms();
  const { data, error } = await sb.from(table).update({ [TOGGLES[table].col]: on }).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  publish(...TOGGLES[table].tags);
  return ok(on ? "أصبح ظاهراً في الموقع." : "أُخفي من الموقع.");
}

const DELETABLE = { services: T.services, process_steps: T.process, offers: T.offers, announcements: T.announcements } as const;
const BACK: Record<keyof typeof DELETABLE, string> = {
  services: "/admin/content/services",
  process_steps: "/admin/content/process",
  offers: "/admin/content/offers",
  announcements: "/admin/content/announcements",
};
export async function deleteRow(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const table = str(fd, "table") as keyof typeof DELETABLE;
  const id = uuid(fd, "id");
  if (!(table in DELETABLE) || !id) return fail("سجل غير صالح.");
  const sb = await cms();
  const { data, error } = await sb.from(table).delete().eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  publish(...DELETABLE[table]);
  if (fd.get("from") === "edit") redirect(BACK[table]);
  return ok("حُذف.");
}

// ------------------------------------------------------------------ identity + home
export async function saveIdentity(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const keys = ["name", "tagline", "phone", "whatsapp", "whatsapp_url", "address", "facebook", "youtube_url", "instagram", "email"] as const;
  const parsed = identitySchema.safeParse(Object.fromEntries(keys.map((k) => [k, str(fd, k)])));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const sb = await cms();
  const { data, error } = await sb.from("business_settings").update(parsed.data).eq("id", 1).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("تعذّر الحفظ: لا توجد صلاحية أو السجل غير موجود.");
  publish(...T.identity);
  return ok("حُفظت الهوية. ظهرت التغييرات في الموقع.");
}

export async function saveHome(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const keys = ["hero_title", "hero_subtitle", "hero_primary_label", "hero_secondary_label", "booking_message", "hero_cover_photo_id", "hero_promo_source", "hero_promo_video_id"] as const;
  const parsed = homeSchema.safeParse(Object.fromEntries(keys.map((k) => [k, str(fd, k)])));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const sb = await cms();
  const { data, error } = await sb.from("business_settings").update(parsed.data).eq("id", 1).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("تعذّر الحفظ.");
  publish(...T.home, TAGS.videos);
  return ok("حُفظت الصفحة الرئيسية.");
}

/** Section title/intro only (services / process pages). */
export async function saveSectionIntro(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const parsed = sectionIntroSchema.safeParse({ key: str(fd, "key"), title: str(fd, "title"), intro: str(fd, "intro") });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const sb = await cms();
  const { key, ...patch } = parsed.data;
  const { data, error } = await sb.from("site_sections").update(patch).eq("key", key).select("key");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("القسم غير موجود.");
  publish(...T.sections, ...(key === "services" ? T.services : key === "process" ? T.process : key === "offers" ? T.offers : []));
  return ok("حُفظ عنوان القسم ومقدمته.");
}

// ------------------------------------------------------------------ logo
// Two steps so the file never passes through the Server Action body (1 MB limit): the browser uploads
// to a signed URL in the private `site-media` bucket, then finalizeLogo validates the stored bytes.
const LOGO_MIME = new Set(["image/png", "image/webp", "image/jpeg"]);
const LOGO_FORMAT: Record<string, string> = { png: "image/png", webp: "image/webp", jpeg: "image/jpeg" };
const LOGO_EXT: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg" };
const LOGO_MAX = 2 * 1024 * 1024;
const LOGO_PATH = /^brand\/([0-9a-f-]{36})\/logo\.(png|webp|jpg)$/;

/** Step 1: check declared type/size, return a one-time signed upload URL. */
export async function logoUploadUrl(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const mime = str(fd, "mime");
  const size = Number(str(fd, "size"));
  if (!LOGO_MIME.has(mime)) return fail("الصيغ المسموحة: PNG أو WebP أو JPEG (SVG غير مسموح).");
  if (!Number.isFinite(size) || size <= 0) return fail("اختر ملف الشعار.");
  if (size > LOGO_MAX) return fail("حجم الملف أكبر من 2 ميغابايت.");
  const id = randomUUID();
  const path = `brand/${id}/logo.${LOGO_EXT[mime]}`;
  const sb = await cms();
  const { data, error } = await sb.storage.from("site-media").createSignedUploadUrl(path);
  if (error || !data) return fail("تعذّر تجهيز الرفع. حاول مرة أخرى.");
  return ok("", { path, token: data.token });
}

/** Step 2: read the stored object, validate content with sharp (decoded format + 256–4000 px), record it. Not activated. */
export async function finalizeLogo(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const path = str(fd, "path");
  const m = LOGO_PATH.exec(path);
  if (!m) return fail("ملف غير صالح.");
  const id = m[1];
  const sb = await cms();
  const drop = async (msg: string) => {
    await sb.storage.from("site-media").remove([path]);
    return fail(msg);
  };
  const dl = await sb.storage.from("site-media").download(path);
  if (dl.error || !dl.data) return fail("لم يكتمل رفع الملف. حاول مرة أخرى.");
  const buf = Buffer.from(await dl.data.arrayBuffer());
  if (buf.length > LOGO_MAX) return drop("حجم الملف أكبر من 2 ميغابايت.");
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(buf, { failOn: "error" }).metadata();
  } catch {
    return drop("تعذّر قراءة الصورة. تأكد أنها ملف صورة سليم.");
  }
  // Trust the decoded content, not the browser-declared type; it must also match the extension.
  const mime = meta.format ? LOGO_FORMAT[meta.format] : undefined;
  if (!mime || LOGO_EXT[mime] !== m[2]) return drop("الملف ليس PNG أو WebP أو JPEG كما يدّعي امتداده.");
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < 256 || h < 256) return drop(`الأبعاد صغيرة (${w}×${h}). الحد الأدنى 256×256.`);
  if (w > 4000 || h > 4000) return drop(`الأبعاد كبيرة (${w}×${h}). الحد الأقصى 4000×4000.`);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const note = str(fd, "note").slice(0, 200) || null;
  const { error } = await sb.from("brand_assets").insert({ id, kind: "logo", storage_path: path, mime, width: w, height: h, bytes: buf.length, sha256, note });
  if (error) return drop(dbMessage(error));
  refresh();
  return ok("رُفع الشعار الجديد. عاينه ثم اضغط «تفعيل» ليظهر في الموقع.");
}


/** id = brand_assets id, or empty = built-in original logo. */
export async function activateLogo(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const raw = str(fd, "id");
  const id = raw === "" ? null : uuid(fd, "id");
  if (raw !== "" && !id) return fail("سجل غير صالح.");
  const sb = await cms();
  const { data, error } = await sb.from("business_settings").update({ active_logo_id: id }).eq("id", 1).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("تعذّر التفعيل.");
  publish(...T.identity);
  return ok(id ? "فُعّل الشعار الجديد." : "عاد الموقع للشعار الأصلي.");
}

// ------------------------------------------------------------------ services
async function syncServiceLinks(sb: SB, serviceId: string, videos: string[], albums: string[]) {
  const d = await sb.from("service_links").delete().eq("service_id", serviceId);
  if (d.error) return d.error;
  const rows = [
    ...videos.map((target_id, i) => ({ service_id: serviceId, kind: "video", target_id, sort_order: (i + 1) * 10 })),
    ...albums.map((target_id, i) => ({ service_id: serviceId, kind: "album", target_id, sort_order: (i + 1) * 10 })),
  ];
  if (!rows.length) return null;
  const i = await sb.from("service_links").insert(rows);
  return i.error;
}

function readService(fd: FormData) {
  return serviceSchema.safeParse({
    title: str(fd, "title"),
    slug: str(fd, "slug"),
    summary: str(fd, "summary"),
    body: str(fd, "body"),
    cover_photo_id: str(fd, "cover_photo_id"),
    is_published: fd.get("intent") === "publish" ? true : fd.get("intent") === "draft" ? false : bool(fd, "is_published"),
    video_ids: all(fd, "video_ids"),
    album_ids: all(fd, "album_ids"),
  });
}

export async function saveService(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const raw = str(fd, "id");
  const id = raw ? uuid(fd, "id") : null;
  if (raw && !id) return fail("سجل غير صالح.");
  const parsed = readService(fd);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { video_ids, album_ids, ...row } = parsed.data;
  const sb = await cms();
  let sid = id;
  if (sid) {
    const { data, error } = await sb.from("services").update(row).eq("id", sid).select("id");
    if (error) return fail(dbMessage(error, SLUG_DUP));
    if (!data?.length) return fail("السجل غير موجود.");
  } else {
    const { data: last } = await sb.from("services").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const sort_order = ((last?.[0] as { sort_order?: number } | undefined)?.sort_order ?? 0) + 10;
    const { data, error } = await sb.from("services").insert({ ...row, sort_order }).select("id").single();
    if (error || !data) return fail(dbMessage(error, SLUG_DUP));
    sid = (data as { id: string }).id;
  }
  const le = await syncServiceLinks(sb, sid, video_ids, album_ids);
  publish(...T.services);
  if (le) return fail("حُفظت الخدمة، لكن تعذّر حفظ الروابط بالفيديوهات/الألبومات. أعد المحاولة.");
  if (!id) redirect(`/admin/content/services/${sid}?saved=1`);
  return ok(row.is_published ? "حُفظت الخدمة وهي منشورة." : "حُفظت الخدمة كمسودة (مخفية).");
}

// ------------------------------------------------------------------ process steps
export async function saveStep(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const raw = str(fd, "id");
  const id = raw ? uuid(fd, "id") : null;
  if (raw && !id) return fail("سجل غير صالح.");
  const parsed = stepSchema.safeParse({
    title: str(fd, "title"),
    description: str(fd, "description"),
    photo_id: str(fd, "photo_id"),
    is_published: bool(fd, "is_published"),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const sb = await cms();
  if (id) {
    const { data, error } = await sb.from("process_steps").update(parsed.data).eq("id", id).select("id");
    if (error) return fail(dbMessage(error));
    if (!data?.length) return fail("السجل غير موجود.");
  } else {
    const { data: last } = await sb.from("process_steps").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const sort_order = ((last?.[0] as { sort_order?: number } | undefined)?.sort_order ?? 0) + 10;
    const { error } = await sb.from("process_steps").insert({ ...parsed.data, sort_order });
    if (error) return fail(dbMessage(error));
  }
  publish(...T.process);
  return ok(id ? "حُفظت الخطوة." : "أُضيفت الخطوة.");
}

// ------------------------------------------------------------------ offers
function readOffer(fd: FormData) {
  const intent = str(fd, "intent");
  const status = intent === "publish" ? "published" : intent === "draft" ? "draft" : intent === "archive" ? "archived" : str(fd, "status") || "draft";
  return offerSchema.safeParse({
    title: str(fd, "title"),
    slug: str(fd, "slug"),
    description: str(fd, "description"),
    image_photo_id: str(fd, "image_photo_id"),
    price_minor: str(fd, "price"),
    currency: str(fd, "currency") || "ILS",
    show_price: bool(fd, "show_price"),
    starts_on: str(fd, "starts_on"),
    ends_on: str(fd, "ends_on"),
    terms: str(fd, "terms"),
    whatsapp_message: str(fd, "whatsapp_message"),
    status,
    pinned_home: bool(fd, "pinned_home"),
    items: fd.getAll("items").map(String).map((s) => s.trim()).filter(Boolean),
  });
}

export async function saveOffer(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const raw = str(fd, "id");
  const id = raw ? uuid(fd, "id") : null;
  if (raw && !id) return fail("سجل غير صالح.");
  const parsed = readOffer(fd);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { items, ...row } = parsed.data;
  const sb = await cms();
  let oid = id;
  if (oid) {
    const { data, error } = await sb.from("offers").update(row).eq("id", oid).select("id");
    if (error) return fail(dbMessage(error, SLUG_DUP));
    if (!data?.length) return fail("السجل غير موجود.");
  } else {
    const { data: last } = await sb.from("offers").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const sort_order = ((last?.[0] as { sort_order?: number } | undefined)?.sort_order ?? 0) + 10;
    const { data, error } = await sb.from("offers").insert({ ...row, sort_order }).select("id").single();
    if (error || !data) return fail(dbMessage(error, SLUG_DUP));
    oid = (data as { id: string }).id;
  }
  const d = await sb.from("offer_items").delete().eq("offer_id", oid);
  const ins = !d.error && items.length ? await sb.from("offer_items").insert(items.map((label, i) => ({ offer_id: oid, label, sort_order: (i + 1) * 10 }))) : null;
  publish(...T.offers);
  if (d.error || ins?.error) return fail("حُفظ العرض، لكن تعذّر حفظ البنود. أعد المحاولة.");
  if (str(fd, "intent") === "preview") redirect(`/admin/content/offers/${oid}/preview`);
  if (!id) redirect(`/admin/content/offers/${oid}?saved=1`);
  const msg = { draft: "حُفظ العرض كمسودة (غير ظاهر).", published: "نُشر العرض.", archived: "أُرشف العرض (غير ظاهر)." } as const;
  return ok(msg[row.status]);
}

export async function setOfferStatus(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  const status = str(fd, "status");
  if (!id || !["draft", "published", "archived"].includes(status)) return fail("سجل غير صالح.");
  const sb = await cms();
  const { data, error } = await sb.from("offers").update({ status }).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  publish(...T.offers);
  return ok(status === "published" ? "نُشر العرض." : status === "archived" ? "أُرشف العرض." : "أُعيد العرض لمسودة.");
}

export async function setOfferPinned(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const on = fd.get("value") === "1";
  const sb = await cms();
  const { data, error } = await sb.from("offers").update({ pinned_home: on }).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  publish(...T.offers);
  return ok(on ? "ثُبّت العرض في الرئيسية." : "أُلغي تثبيت العرض.");
}

// ------------------------------------------------------------------ announcements
export async function saveAnnouncement(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const raw = str(fd, "id");
  const id = raw ? uuid(fd, "id") : null;
  if (raw && !id) return fail("سجل غير صالح.");
  const parsed = announcementSchema.safeParse({
    template: str(fd, "template") || "bar",
    text: str(fd, "text"),
    link_kind: str(fd, "link_kind") || "none",
    link_offer_id: str(fd, "link_offer_id"),
    link_page: str(fd, "link_page"),
    starts_on: str(fd, "starts_on"),
    ends_on: str(fd, "ends_on"),
    is_visible: fd.get("intent") === "draft" ? false : fd.get("intent") === "publish" ? true : bool(fd, "is_visible"),
    dismissible: bool(fd, "dismissible"),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const sb = await cms();
  if (id) {
    const { data, error } = await sb.from("announcements").update(parsed.data).eq("id", id).select("id");
    if (error) return fail(dbMessage(error));
    if (!data?.length) return fail("السجل غير موجود.");
  } else {
    const { data: last } = await sb.from("announcements").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const sort_order = ((last?.[0] as { sort_order?: number } | undefined)?.sort_order ?? 0) + 10;
    const { data, error } = await sb.from("announcements").insert({ ...parsed.data, sort_order }).select("id").single();
    if (error || !data) return fail(dbMessage(error));
    publish(...T.announcements);
    redirect(`/admin/content/announcements/${(data as { id: string }).id}?saved=1`);
  }
  publish(...T.announcements);
  return ok(parsed.data.is_visible ? "حُفظ الإعلان وهو مفعّل." : "حُفظ الإعلان (مخفي).");
}

// ------------------------------------------------------------------ nav + sections
export async function saveNavItem(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("سجل غير صالح.");
  const parsed = navItemSchema.safeParse({ label: str(fd, "label"), is_visible: bool(fd, "is_visible") });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const sb = await cms();
  // Only label/visibility: the target (URL) is fixed by the allow-list and never changes here.
  const { data, error } = await sb.from("nav_items").update(parsed.data).eq("id", id).select("id");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("السجل غير موجود.");
  publish(...T.nav);
  return ok("حُفظ الرابط. العنوان (URL) لم يتغيّر.");
}

export async function saveSection(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const parsed = sectionSchema.safeParse({
    key: str(fd, "key"),
    title: str(fd, "title"),
    intro: str(fd, "intro"),
    is_visible: bool(fd, "is_visible"),
    item_limit: str(fd, "item_limit") || "6",
    featured_ids: all(fd, "featured_ids"),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { key, ...patch } = parsed.data;
  const sb = await cms();
  // Featured items must exist in the table that matches the section type.
  const kind = SECTION_FEATURE[key];
  if (!kind) patch.featured_ids = [];
  else if (patch.featured_ids.length) {
    const table = FEATURE_TABLE[kind];
    const { data: found, error: fe } = await sb.from(table).select("id").in("id", patch.featured_ids);
    if (fe) return fail(dbMessage(fe));
    const ok_ = new Set((found ?? []).map((r: { id: string }) => r.id));
    if (patch.featured_ids.some((i) => !ok_.has(i))) return fail("أحد العناصر المميزة غير موجود أو من نوع مختلف.");
  }
  const { data, error } = await sb.from("site_sections").update(patch).eq("key", key).select("key");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("القسم غير موجود.");
  publish(...T.sections);
  return ok("حُفظ القسم.");
}

export async function saveSectionOrder(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const keys = keyOrderSchema.safeParse(fd.getAll("order").map(String));
  if (!keys.success) return fail("ترتيب غير صالح.");
  const sb = await cms();
  for (let k = 0; k < keys.data.length; k++) {
    const { error } = await sb.from("site_sections").update({ sort_order: (k + 1) * 10 }).eq("key", keys.data[k]);
    if (error) return fail(dbMessage(error));
  }
  publish(...T.sections);
  return ok("حُفظ ترتيب الأقسام.");
}

export async function setSectionVisible(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const key = keyOrderSchema.safeParse([str(fd, "key")]);
  if (!key.success) return fail("قسم غير صالح.");
  const on = fd.get("value") === "1";
  const sb = await cms();
  const { data, error } = await sb.from("site_sections").update({ is_visible: on }).eq("key", key.data[0]).select("key");
  if (error) return fail(dbMessage(error));
  if (!data?.length) return fail("القسم غير موجود.");
  publish(...T.sections);
  return ok(on ? "القسم ظاهر في الرئيسية." : "أُخفي القسم من الرئيسية.");
}
