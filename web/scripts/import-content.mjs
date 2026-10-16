#!/usr/bin/env node
/**
 * Content import: business_settings defaults + showcase_videos from content/youtube-selection.json.
 *
 *   node scripts/import-content.mjs --target local|staging [--apply]
 *
 * Dry run by default. Never overwrites existing data:
 *  - business_settings (id=1): fills ONLY null/empty fields; email/instagram are never touched.
 *  - showcase_videos: inserts rows whose youtube_id is absent; existing rows are left as-is
 *    (admin edits win) and differences are only reported. is_promo is set on insert only when
 *    no promo exists yet.
 * Idempotent: a second --apply run inserts 0 and updates 0.
 * Uses the service-role key from the target env file; never prints secret values.
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
const CATEGORIES = new Set(["wedding", "evening", "groom_prep", "folk", "engagement", "graduation", "festival", "dj", "other"]);

const counts = { settingsFilled: 0, settingsKept: 0, videosInserted: 0, videosUpdated: 0, videosUnchanged: 0, videosDiffering: 0 };
const isEmpty = (v) => v === null || v === undefined || String(v).trim() === "";

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
    } else {
      counts.settingsKept++;
      console.log(`  kept existing  ${field}`);
    }
  }
  if (APPLY && Object.keys(patch).length) {
    const { error: e } = await sb.from("business_settings").update(patch).eq("id", 1);
    if (e) throw new Error(`business_settings update failed: ${e.message}`);
  }
}

function loadSelection() {
  const sel = JSON.parse(readFileSync(resolve(WEB_ROOT, "content/youtube-selection.json"), "utf8"));
  const method = sel.source?.method ?? "";
  const verifiedAt = sel.source?.verified_at ?? "";
  return sel.videos.map((v) => {
    if (!ID.test(v.youtube_id)) throw new Error(`invalid youtube_id in selection: ${v.youtube_id}`);
    if (!CATEGORIES.has(v.category)) throw new Error(`invalid category for ${v.youtube_id}: ${v.category}`);
    const notes = [`Verified ${verifiedAt} via: ${method}`, v.unverified ? `Unverified/caveat: ${v.unverified}` : null].filter(Boolean).join("\n");
    return {
      youtube_id: v.youtube_id,
      source_url: `https://www.youtube.com/watch?v=${v.youtube_id}`,
      original_title: v.original_title ?? null,
      title: v.title,
      description: v.description ?? null,
      category: v.category,
      duration_seconds: v.duration_seconds ?? null,
      published_at: v.published_at ?? null,
      is_promo: v.is_promo === true,
      sort_order: v.sort_order ?? 100,
      is_published: true,
      source: "youtube_channel",
      verification_notes: notes.slice(0, 2000),
    };
  });
}

async function importVideos() {
  console.log(`\nshowcase_videos`);
  const wanted = loadSelection();
  const { data: existing, error } = await sb.from("showcase_videos").select("*");
  if (error) throw new Error(`cannot read showcase_videos: ${error.message}`);
  const byId = new Map(existing.map((r) => [r.youtube_id, r]));
  let promoTaken = existing.some((r) => r.is_promo);
  const COMPARE = ["title", "description", "category", "duration_seconds", "published_at", "is_promo", "sort_order", "is_published", "original_title"];
  for (const w of wanted) {
    const cur = byId.get(w.youtube_id);
    if (cur) {
      const diffs = COMPARE.filter((k) => (cur[k] ?? null) !== (w[k] ?? null));
      if (diffs.length) {
        counts.videosDiffering++;
        console.log(`  exists ${w.youtube_id} — kept admin version; differs from selection in: ${diffs.join(", ")}`);
      } else {
        counts.videosUnchanged++;
        console.log(`  exists ${w.youtube_id} — identical, nothing to do`);
      }
      continue;
    }
    const row = { ...w };
    if (row.is_promo && promoTaken) {
      row.is_promo = false;
      console.log(`  note: ${w.youtube_id} is promo in selection but a promo already exists — inserting as non-promo`);
    }
    if (row.is_promo) promoTaken = true;
    counts.videosInserted++;
    console.log(`  ${APPLY ? "insert" : "would insert"} ${w.youtube_id} (${w.category}${row.is_promo ? ", promo" : ""}, sort ${w.sort_order})`);
    if (APPLY) {
      const { error: e } = await sb.from("showcase_videos").insert(row);
      if (e) throw new Error(`insert ${w.youtube_id} failed: ${e.message}`);
    }
  }
}

console.log(`import-content → target=${TARGET} host=${host} mode=${APPLY ? "APPLY" : "dry-run"}`);
try {
  await importSettings();
  await importVideos();
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  process.exit(1);
}
console.log(
  `\nsummary (${APPLY ? "applied" : "dry-run"}): business_settings filled ${counts.settingsFilled}, kept ${counts.settingsKept}; ` +
    `showcase_videos inserted ${counts.videosInserted}, updated ${counts.videosUpdated}, unchanged ${counts.videosUnchanged}, differing-kept ${counts.videosDiffering}`,
);
