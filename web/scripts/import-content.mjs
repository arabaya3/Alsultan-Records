#!/usr/bin/env node
/**
 * Content import: business_settings defaults + video categories + showcase_videos (+ category links)
 * from content/youtube-inventory.json (complete channel inventory). content/youtube-selection.json is
 * only consulted for the sort_order / is_promo of a video when it is first inserted.
 *
 *   node scripts/import-content.mjs --target local|staging [--apply]
 *
 * Dry run by default. Idempotent: a second --apply run reports 0 inserts / 0 changes.
 * Uses the service-role key from the target env file; never prints secret values.
 *
 * POLICY (admin edits always win; also documented in docs/security-model.md §16)
 *  - business_settings (id=1): fills ONLY null/empty fields; email/instagram are never touched.
 *  - video_categories: matched by slug. Missing slugs are inserted (title/sort_order from the
 *    inventory, published). An existing category's title / sort_order / is_published is never changed.
 *  - showcase_videos, new youtube_id: inserted with title = original YouTube title verbatim
 *    (title_source 'youtube'), youtube_title/youtube_description, duration, published_at,
 *    needs_review + review_note from the inventory. is_published = true, except a needs_review video
 *    with no category is inserted hidden. is_promo only if the selection marks it AND no promo exists.
 *  - showcase_videos, existing row:
 *      always refreshed: youtube_title, youtube_description, duration_seconds, published_at;
 *      public `title` refreshed from the original title ONLY while title_source = 'youtube'
 *      (never when an admin set it: 'manual');
 *      never touched: is_published, sort_order, is_promo, description, category, title when manual;
 *      needs_review: only ever set to true (with review_note) and only while reviewed_at IS NULL
 *      (an admin who reviewed the row owns the flag); never cleared by the import.
 *  - category links: missing (video, category) links from the inventory are added (primary only when
 *    the video has no primary yet); links are NEVER removed — links in the DB but not in the inventory
 *    are only reported (admin curation).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { EXPECTED_REF, FORBIDDEN_REFS, WEB_ROOT, parseArgs, parseEnvFile } from "./staging-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const TARGET = args.target;
const APPLY = args.apply === true;
if (TARGET !== "local" && TARGET !== "staging") {
  console.error("usage: node scripts/import-content.mjs --target local|staging [--apply]");
  process.exit(2);
}

const envFile = resolve(WEB_ROOT, TARGET === "local" ? ".env.local" : ".env.staging.app.local");
if (!existsSync(envFile)) {
  console.error(`missing env file for target ${TARGET}`);
  process.exit(2);
}
const env = parseEnvFile(envFile);
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = env.SUPABASE_SECRET_KEY ?? "";
if (!url || !key) {
  console.error("env file lacks NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY");
  process.exit(2);
}
let host;
try {
  host = new URL(url).hostname;
} catch {
  console.error("invalid Supabase URL in env file");
  process.exit(2);
}
if (FORBIDDEN_REFS.some((r) => url.includes(r))) {
  console.error("refusing: env points at a forbidden project");
  process.exit(2);
}
if (TARGET === "local" && !["127.0.0.1", "localhost"].includes(host)) {
  console.error(`refusing: target local but URL host is ${host}`);
  process.exit(2);
}
if (TARGET === "staging" && host !== `${EXPECTED_REF}.supabase.co`) {
  console.error(`refusing: target staging but URL host is not the staging project (${host})`);
  process.exit(2);
}

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const BUSINESS = {
  name: "ستوديو وتسجيلات السلطان",
  tagline: "نوثّق أجمل لحظاتكم بالصوت والصورة",
  phone: "+970598677477",
  whatsapp: "+970598677477",
  address: "ميثلون، جنين، فلسطين",
  facebook: "https://www.facebook.com/Sultan.Rec0rds2",
  youtube_url: "https://www.youtube.com/channel/UCpxtdVABBIOaNLne-0_dDmQ/videos",
  whatsapp_url: "https://wa.me/message/I4OXKEUV7DX6L1",
};
const ID = /^[A-Za-z0-9_-]{11}$/;
const SLUG = /^[a-z0-9_]{2,30}$/;
const LEGACY = new Set(["wedding", "evening", "groom_prep", "folk", "engagement", "graduation", "festival", "dj", "other"]);

const counts = {
  settingsFilled: 0,
  categoriesInserted: 0,
  categoriesKept: 0,
  videosInserted: 0,
  videosChanged: 0,
  videosUnchanged: 0,
  linksInserted: 0,
  linksExtra: 0,
  dbVideosNotInInventory: 0,
};
const isEmpty = (v) => v === null || v === undefined || String(v).trim() === "";
const clip = (s, n) => (s == null ? null : String(s).slice(0, n));

async function importSettings() {
  console.log(`\nbusiness_settings (id=1)`);
  const { data: row, error } = await sb.from("business_settings").select(Object.keys(BUSINESS).join(", ")).eq("id", 1).maybeSingle();
  if (error || !row) throw new Error(`cannot read business_settings: ${error?.message ?? "row missing"}`);
  const patch = {};
  for (const [field, value] of Object.entries(BUSINESS)) {
    if (isEmpty(row[field])) {
      patch[field] = value;
      counts.settingsFilled++;
      console.log(`  ${APPLY ? "filled" : "would fill"}  ${field}`);
    }
  }
  if (!Object.keys(patch).length) console.log("  all fields already set — kept");
  if (APPLY && Object.keys(patch).length) {
    const { error: e } = await sb.from("business_settings").update(patch).eq("id", 1);
    if (e) throw new Error(`business_settings update failed: ${e.message}`);
  }
}

function loadInventory() {
  const inv = JSON.parse(readFileSync(resolve(WEB_ROOT, "content/youtube-inventory.json"), "utf8"));
  const sel = existsSync(resolve(WEB_ROOT, "content/youtube-selection.json"))
    ? JSON.parse(readFileSync(resolve(WEB_ROOT, "content/youtube-selection.json"), "utf8"))
    : { videos: [] };
  const selById = new Map(sel.videos.map((v) => [v.youtube_id, v]));
  const categories = inv.categories.map((c) => {
    if (!SLUG.test(c.slug)) throw new Error(`invalid category slug: ${c.slug}`);
    return { slug: c.slug, title: String(c.title).trim(), sort_order: Number.isInteger(c.sort_order) ? c.sort_order : 100 };
  });
  const slugs = new Set(categories.map((c) => c.slug));
  const videos = inv.videos.map((v) => {
    if (!ID.test(v.youtube_id)) throw new Error(`invalid youtube_id in inventory: ${v.youtube_id}`);
    const title = String(v.original_title ?? "").trim();
    if (title.length < 2 || title.length > 200) throw new Error(`original_title length out of range for ${v.youtube_id}`);
    const cats = (v.categories ?? []).filter((s) => slugs.has(s));
    const primary = slugs.has(v.primary_category) ? v.primary_category : cats[0] ?? null;
    if (primary && !cats.includes(primary)) cats.unshift(primary);
    const s = selById.get(v.youtube_id);
    return {
      youtube_id: v.youtube_id,
      title,
      youtube_description: clip(v.description || null, 10000),
      duration_seconds: Number.isInteger(v.duration_seconds) ? v.duration_seconds : null,
      published_at: typeof v.published_at === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.published_at) ? v.published_at.slice(0, 10) : null,
      needs_review: v.needs_review === true,
      review_note: v.needs_review === true ? clip(v.review_reason || "تحتاج مراجعة (من الاستيراد)", 2000) : null,
      categories: cats,
      primary,
      notes: clip([v.classification_basis ? `basis: ${v.classification_basis}` : null, v.reason || null].filter(Boolean).join("\n") || null, 2000),
      sel_sort: s?.sort_order ?? null,
      sel_promo: s?.is_promo === true || v.is_promo === true,
    };
  });
  return { categories, videos };
}

async function importCategories(categories) {
  console.log(`\nvideo_categories`);
  const { data: existing, error } = await sb.from("video_categories").select("id, slug, title, sort_order, is_published");
  if (error) throw new Error(`cannot read video_categories: ${error.message}`);
  const bySlug = new Map(existing.map((c) => [c.slug, c]));
  for (const c of categories) {
    if (bySlug.has(c.slug)) {
      counts.categoriesKept++;
      console.log(`  exists ${c.slug} — kept admin version`);
      continue;
    }
    counts.categoriesInserted++;
    console.log(`  ${APPLY ? "insert" : "would insert"} ${c.slug} «${c.title}» sort ${c.sort_order}`);
    if (APPLY) {
      const { data, error: e } = await sb.from("video_categories").insert({ ...c, is_published: true }).select("id, slug").single();
      if (e) throw new Error(`insert category ${c.slug} failed: ${e.message}`);
      bySlug.set(c.slug, data);
    }
  }
  for (const c of existing) if (!categories.some((x) => x.slug === c.slug)) console.log(`  note: DB category ${c.slug} is not in the inventory (kept)`);
  return bySlug;
}

const same = (a, b) => (a ?? null) === (b ?? null);

async function importVideos(videos, catBySlug) {
  console.log(`\nshowcase_videos`);
  const { data: rows, error } = await sb
    .from("showcase_videos")
    .select("id, youtube_id, title, title_source, youtube_title, youtube_description, duration_seconds, published_at, needs_review, review_note, reviewed_at, is_promo, is_published");
  if (error) throw new Error(`cannot read showcase_videos: ${error.message}`);
  const { data: links, error: le } = await sb.from("showcase_video_categories").select("video_id, category_id, is_primary");
  if (le) throw new Error(`cannot read showcase_video_categories: ${le.message}`);
  const byYt = new Map(rows.map((r) => [r.youtube_id, r]));
  let promoTaken = rows.some((r) => r.is_promo);
  const slugById = new Map([...catBySlug.values()].map((c) => [c.id, c.slug]));

  for (const v of videos) {
    let cur = byYt.get(v.youtube_id);
    const line = [];
    if (!cur) {
      const hidden = v.needs_review && v.categories.length === 0;
      const promo = v.sel_promo && !promoTaken;
      if (promo) promoTaken = true;
      const legacy = v.primary && LEGACY.has(v.primary) ? v.primary : "other";
      const row = {
        youtube_id: v.youtube_id,
        source_url: `https://www.youtube.com/watch?v=${v.youtube_id}`,
        original_title: clip(v.title, 300),
        title: v.title,
        title_source: "youtube",
        youtube_title: clip(v.title, 300),
        youtube_description: v.youtube_description,
        category: legacy,
        duration_seconds: v.duration_seconds,
        published_at: v.published_at,
        is_promo: promo,
        sort_order: v.sel_sort ?? 100,
        is_published: !hidden,
        needs_review: v.needs_review,
        review_note: v.review_note,
        source: "youtube_channel",
        verification_notes: v.notes,
      };
      counts.videosInserted++;
      line.push(`${APPLY ? "insert" : "would insert"}${hidden ? " (hidden: needs review, no category)" : ""}${promo ? " promo" : ""}${v.needs_review ? " needs_review" : ""}`);
      if (APPLY) {
        const { data, error: e } = await sb.from("showcase_videos").insert(row).select("id").single();
        if (e) throw new Error(`insert ${v.youtube_id} failed: ${e.message}`);
        cur = { id: data.id };
      }
    } else {
      const patch = {};
      if (!same(cur.youtube_title, clip(v.title, 300))) patch.youtube_title = clip(v.title, 300);
      if (!same(cur.youtube_description, v.youtube_description)) patch.youtube_description = v.youtube_description;
      if (v.duration_seconds !== null && !same(cur.duration_seconds, v.duration_seconds)) patch.duration_seconds = v.duration_seconds;
      if (v.published_at !== null && !same(cur.published_at, v.published_at)) patch.published_at = v.published_at;
      if (cur.title_source === "youtube" && cur.title !== v.title) patch.title = v.title;
      if (v.needs_review && !cur.needs_review && cur.reviewed_at === null) {
        patch.needs_review = true;
        patch.review_note = v.review_note;
      }
      const keys = Object.keys(patch);
      if (keys.length) {
        counts.videosChanged++;
        line.push(`${APPLY ? "update" : "would update"} ${keys.join(", ")}${cur.title_source === "manual" ? " (title manual — kept)" : ""}`);
        if (APPLY) {
          const { error: e } = await sb.from("showcase_videos").update(patch).eq("id", cur.id);
          if (e) throw new Error(`update ${v.youtube_id} failed: ${e.message}`);
        }
      } else {
        counts.videosUnchanged++;
        line.push(`unchanged${cur.title_source === "manual" ? " (title manual)" : ""}`);
      }
    }

    // category links (add-only)
    const mine = cur?.id ? links.filter((l) => l.video_id === cur.id) : [];
    let hasPrimary = mine.some((l) => l.is_primary);
    const added = [];
    for (const slug of v.categories) {
      const cat = catBySlug.get(slug);
      if (!cat?.id) {
        added.push(`${slug}(category pending)`);
        counts.linksInserted++;
        continue;
      }
      if (mine.some((l) => l.category_id === cat.id)) continue;
      const is_primary = !hasPrimary && slug === v.primary;
      if (is_primary) hasPrimary = true;
      counts.linksInserted++;
      added.push(`${slug}${is_primary ? "*" : ""}`);
      if (APPLY && cur?.id) {
        const { error: e } = await sb.from("showcase_video_categories").insert({ video_id: cur.id, category_id: cat.id, is_primary });
        if (e) throw new Error(`link ${v.youtube_id}/${slug} failed: ${e.message}`);
      }
    }
    if (added.length) line.push(`${APPLY ? "linked" : "would link"} ${added.join(",")}`);
    const extra = mine.filter((l) => !v.categories.includes(slugById.get(l.category_id)));
    if (extra.length) {
      counts.linksExtra += extra.length;
      line.push(`kept admin links not in inventory: ${extra.map((l) => slugById.get(l.category_id) ?? l.category_id).join(",")}`);
    }
    console.log(`  ${v.youtube_id}  ${line.join(" · ")}`);
  }
  for (const r of rows) {
    if (!videos.some((v) => v.youtube_id === r.youtube_id)) {
      counts.dbVideosNotInInventory++;
      console.log(`  note: DB video ${r.youtube_id} is not in the inventory (kept)`);
    }
  }
}

console.log(`import-content → target=${TARGET} host=${host} mode=${APPLY ? "APPLY" : "dry-run"}`);
try {
  const inv = loadInventory();
  await importSettings();
  const catBySlug = await importCategories(inv.categories);
  await importVideos(inv.videos, catBySlug);
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  process.exit(1);
}
console.log(
  `\nsummary (${APPLY ? "applied" : "dry-run"}): settings filled ${counts.settingsFilled}; ` +
    `categories inserted ${counts.categoriesInserted}, kept ${counts.categoriesKept}; ` +
    `videos inserted ${counts.videosInserted}, changed ${counts.videosChanged}, unchanged ${counts.videosUnchanged}; ` +
    `links added ${counts.linksInserted}, admin-only links kept ${counts.linksExtra}; DB videos not in inventory ${counts.dbVideosNotInInventory}`,
);
