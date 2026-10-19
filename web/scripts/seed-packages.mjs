#!/usr/bin/env node
/**
 * Adds the owner's 10 packages (prices in ILS, shown as «شيكل»; initial prices, editable from the admin).
 *   node scripts/seed-packages.mjs --target local|staging [--apply]
 * Idempotent and non-destructive: a slug that already exists is SKIPPED (never updated or deleted); no offers,
 * no end dates, no discounts, no images (clean text cards), not featured. Dry run unless --apply. Never prints secrets.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
const target = argv[argv.indexOf("--target") + 1];
const APPLY = argv.includes("--apply");
if (!["local", "staging"].includes(target)) { console.error("usage: seed-packages.mjs --target local|staging [--apply]"); process.exit(2); }
const env = Object.fromEntries(readFileSync(target === "staging" ? ".env.staging.app.local" : ".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
if (target === "staging" && !env.NEXT_PUBLIC_SUPABASE_URL.includes("dyuixzxmmeiypvawzmty")) throw new Error("not the approved project");
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const { PACKAGES } = await import("./seed-packages-data.mjs");

const { data: existing, error } = await db.from("packages").select("slug, title, sort_order");
if (error) throw error;
const have = new Set(existing.map((r) => r.slug));
const haveTitle = new Set(existing.map((r) => r.title.trim()));
let base = Math.max(0, ...existing.map((r) => r.sort_order));
const report = [];
for (const [i, p] of PACKAGES.entries()) {
  if (have.has(p.slug) || haveTitle.has(p.title)) { report.push({ slug: p.slug, result: "skipped (already exists)" }); continue; }
  const row = {
    slug: p.slug, title: p.title, description: p.description, price_minor: p.price * 100, currency: "ILS", show_price: true,
    whatsapp_message: null, status: "published", featured: false, sort_order: base + (i + 1) * 10,
    group_label: p.group, gift: p.gift, internal_note: p.note, image_photo_id: null,
  };
  if (!APPLY) { report.push({ slug: p.slug, result: "would insert" }); continue; }
  const ins = await db.from("packages").insert(row).select("id").single();
  if (ins.error) { report.push({ slug: p.slug, result: `error ${ins.error.message}` }); continue; }
  if (p.items.length) {
    const it = await db.from("package_items").insert(p.items.map((label, k) => ({ package_id: ins.data.id, label, sort_order: (k + 1) * 10 })));
    if (it.error) { report.push({ slug: p.slug, result: `inserted, items error ${it.error.message}` }); continue; }
  }
  report.push({ slug: p.slug, result: "inserted", id: ins.data.id });
}
console.table(report);
console.log(`${APPLY ? "APPLIED" : "DRY RUN"} · target ${target} · offers created: 0`);
