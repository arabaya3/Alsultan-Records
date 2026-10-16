// Shared helpers for the backup/restore operator scripts (backup-*.mjs, verify-restore.mjs).
// Node built-ins + @supabase/supabase-js only.
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

export const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Tables in FK-safe (parents first) order. Must match src/features/backups/core.ts BACKUP_TABLES. */
export const BACKUP_TABLES = [
  "business_settings", "app_settings", "service_categories", "profiles", "customers", "staff_members",
  "media_assets", "services", "booking_requests", "booking_stage_history", "events", "deliverables",
  "deliverable_revisions", "video_comments", "album_selections", "album_selection_items",
  "album_selection_snapshots", "quotes", "quote_items", "contracts", "contract_versions", "payments",
  "expenses", "event_staff_assignments", "equipment", "equipment_assignments", "equipment_maintenance",
  "support_requests", "support_messages", "reviews", "notifications", "audit_events", "backup_runs",
];
export const STORAGE_BUCKETS = ["public-media", "private-media", "backups"];

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) out[k] = true;
      else { out[k] = v; i++; }
    } else out._.push(a);
  }
  return out;
}

export function loadEnvFile(file = path.join(WEB_ROOT, ".env.local")) {
  const env = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  }
  return env;
}

export function isLocalUrl(u) {
  const h = new URL(u).hostname;
  return h === "127.0.0.1" || h === "localhost";
}

/** Refuse anything but a local stack unless the operator explicitly opts in. */
export function assertTargetAllowed(url, args, what) {
  if (isLocalUrl(url)) return;
  if (args["target-url"] === url && args["i-understand-remote"] === true) {
    console.warn(`!! ${what}: REMOTE target ${url} explicitly allowed by --i-understand-remote`);
    return;
  }
  console.error(`Refusing ${what} against non-local ${url}. Pass --target-url ${url} --i-understand-remote to override.`);
  process.exit(2);
}

/** Resolve a local stack's URL + keys with `supabase status -o env` for a given workdir. */
export function stackStatus(workdir) {
  const args = ["supabase", "status", "-o", "json"];
  if (workdir) args.push("--workdir", workdir);
  const out = execFileSync("npx", args, { cwd: WEB_ROOT, encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "ignore"] });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  return { url: j.API_URL, secret: j.SECRET_KEY, publishable: j.PUBLISHABLE_KEY, dbUrl: j.DB_URL };
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** Minimal ZIP reader for the archives written by zip-core.ts (deflate or stored). */
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip (no end of central directory)");
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(off + 26), lxlen = buf.readUInt16LE(off + 28);
    const raw = buf.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
    out.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/**
 * Run SQL against a Postgres either inside a local Supabase db container (`--container`)
 * or through psql on PATH (`--db-url`). Returns stdout; throws on non-zero exit.
 */
export function psql({ container, dbUrl }, sql, extra = []) {
  const base = ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-At", ...extra];
  const r = container
    ? spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", ...base], { input: sql, encoding: "utf8", maxBuffer: 1 << 30 })
    : spawnSync("psql", [dbUrl, ...base], { input: sql, encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`psql failed (${r.status}): ${r.stderr || r.error}`);
  return r.stdout;
}

export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}

/**
 * Parse the COPY blocks of a plain-text `pg_dump --data-only` into { "schema.table": rows[] }.
 * Values are strings (or null for \N), exactly as Postgres text output renders them.
 */
export function parseCopyDump(text) {
  const out = {};
  const lines = text.split("\n");
  const unesc = (s) => s.replace(/\\(b|f|n|r|t|v|\\|[0-7]{1,3})/g, (_, c) =>
    ({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\" })[c] ?? String.fromCharCode(parseInt(c, 8)));
  for (let i = 0; i < lines.length; i++) {
    const m = /^COPY ([a-z_]+)\.([a-z_]+) \((.*)\) FROM stdin;$/.exec(lines[i]);
    if (!m) continue;
    const cols = m[3].split(", ").map((c) => c.replace(/^"|"$/g, ""));
    const rows = [];
    for (i++; lines[i] !== "\\."; i++) {
      const vals = lines[i].split("\t");
      rows.push(Object.fromEntries(cols.map((c, k) => [c, vals[k] === "\\N" ? null : unesc(vals[k])])));
    }
    out[`${m[1]}.${m[2]}`] = rows;
  }
  return out;
}
