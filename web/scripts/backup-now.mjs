#!/usr/bin/env node
/**
 * One command: dated independent backup + completeness check.
 *   npm run backup                       (= node scripts/backup-now.mjs --target staging)
 *   node scripts/backup-now.mjs --target staging [--root <dir>] [--full]
 *
 * 1. Runs backup-export.mjs into <root>/sultan-backup-<YYYYMMDD-HHMM> (default root: web/backups-local/, gitignored).
 * 2. Verifies the folder ON DISK: manifest status "complete", 0 errors, every file in the manifest exists with
 *    the same size and sha256 (re-hashed), and the row/object counts equal what the source project has right now.
 * 3. Writes VERIFY.txt in the folder and exits 0 only when everything matches.
 *
 * This is a local copy on this machine. It is NOT a scheduled/off-site backup: copy the folder to a drive or
 * cloud folder the owner controls. The folder contains private originals and customer data — never commit it.
 * Never prints secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const target = opt("--target") ?? "staging";
const root = path.resolve(opt("--root") ?? path.join(WEB, "backups-local"));
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Hebron" }).replace(/[-:]/g, "").replace(" ", "-").slice(0, 13);
const out = path.join(root, `sultan-backup-${stamp}`);

// Refuse to write inside the git work tree unless the path is ignored.
const inRepo = spawnSync("git", ["check-ignore", "-q", out], { cwd: WEB });
const repoTop = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: WEB, encoding: "utf8" }).stdout.trim();
if (repoTop && path.resolve(out).toLowerCase().startsWith(path.resolve(repoTop).toLowerCase()) && inRepo.status !== 0) {
  console.error(`refusing: ${out} is inside the repo and not gitignored`); process.exit(2);
}

console.log(`backup → ${out}`);

// Incremental: start the new dated folder from the newest COMPLETE earlier snapshot in <root>. Its storage files are
// hard-linked (no copy, no extra disk) and its manifest is reused, so backup-export downloads only objects that are new
// or changed (size/ETag/sha256), instead of the whole of storage again. A changed object is written to a new file and
// renamed into place, which replaces the link and never alters the earlier snapshot. --full skips this.
if (!argv.includes("--full") && fs.existsSync(root) && !fs.existsSync(path.join(out, "manifest.json"))) {
  const prev = fs
    .readdirSync(root)
    .filter((n) => /^sultan-backup-\d{8}-\d{4}$/.test(n) && path.join(root, n) !== out)
    .sort()
    .reverse()
    .map((n) => path.join(root, n))
    .find((d) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(d, "manifest.json"), "utf8")).status === "complete";
      } catch {
        return false;
      }
    });
  if (prev) {
    const pm = JSON.parse(fs.readFileSync(path.join(prev, "manifest.json"), "utf8"));
    let linked = 0;
    for (const f of pm.files ?? []) {
      if (!f.path.startsWith("storage/")) continue;
      const from = path.join(prev, f.path);
      const to = path.join(out, f.path);
      if (!fs.existsSync(from)) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      try {
        fs.linkSync(from, to);
      } catch {
        fs.copyFileSync(from, to); // another drive: copy instead
      }
      linked++;
    }
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ ...pm, status: "partial", seeded_from: path.basename(prev) }, null, 1) + "\n");
    console.log(`incremental: ${linked} unchanged-candidate files linked from ${path.basename(prev)} (only new or changed objects are downloaded)`);
  }
}

const exp = spawnSync(process.execPath, [path.join(WEB, "scripts/backup-export.mjs"), "--target", target, "--out", out], { cwd: WEB, stdio: "inherit" });
if (exp.status !== 0) { console.error("export failed — run the same command again to resume"); process.exit(1); }

const problems = [];
const m = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
if (m.status !== "complete") problems.push(`manifest status ${m.status}`);
if (m.errors?.length) problems.push(`${m.errors.length} export errors`);
const sha = (f) => new Promise((res, rej) => { const h = createHash("sha256"); fs.createReadStream(f).on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej); });
let checked = 0;
for (const f of m.files) {
  const p = path.join(out, f.path);
  if (!fs.existsSync(p)) { problems.push(`missing ${f.path}`); continue; }
  if (fs.statSync(p).size !== f.bytes) { problems.push(`size ${f.path}`); continue; }
  if ((await sha(p)) !== f.sha256) { problems.push(`sha256 ${f.path}`); continue; }
  checked++;
}

// Compare with the live source right now (counts only; read-only).
const envFile = target === "staging" ? ".env.staging.app.local" : ".env.local";
const env = Object.fromEntries(fs.readFileSync(path.join(WEB, envFile), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
for (const t of ["photo_albums", "album_photos", "showcase_videos", "offers", "services"]) {
  const { count, error } = await db.from(t).select("*", { count: "exact", head: true });
  const exported = typeof m.tables[t] === "object" ? m.tables[t].rows : m.tables[t];
  if (!error && count !== exported) problems.push(`${t}: source ${count}, backup ${exported}`);
}
// Originals live in album-media, or on the external S3 store (storage_provider 's3' → storage/s3/<key>).
const photos = (await db.from("album_photos").select("storage_path_original, storage_provider")).data ?? [];
const originalAt = (r) => path.join(out, "storage", r.storage_provider === "s3" ? "s3" : "album-media", r.storage_path_original);
const originals = photos.filter((r) => r.storage_path_original && !fs.existsSync(originalAt(r))).length;
if (originals) problems.push(`${originals} photo originals missing`);

const summary = [
  `Sultan Records backup — ${m.created_at} (source ${m.source.supabase_host})`,
  `files verified: ${checked}/${m.files.length}, bytes ${m.totals.bytes}, storage objects ${m.totals.storage_objects}`,
  `photo originals present: ${photos.length - originals}/${photos.length}`,
  problems.length ? `RESULT: INCOMPLETE\n${problems.slice(0, 50).join("\n")}` : "RESULT: COMPLETE",
  "Local copy only — move it to a drive/cloud folder the owner controls. Contains private data: never commit or share.",
].join("\n");
fs.writeFileSync(path.join(out, "VERIFY.txt"), summary + "\n");
console.log(summary);
process.exit(problems.length ? 1 : 0);
