// Runs the app's backup code path (src/features/backups/core.ts, the same function the owner-only
// server action calls) as the OWNER, then downloads the run's archives from the `backups` bucket
// with the owner's session.
//
//   node --experimental-strip-types scripts/backup-run.mjs --owner-email E --owner-password P [--out DIR]
//   node --experimental-strip-types scripts/backup-run.mjs --run-id <uuid> --owner-email E --owner-password P   # download only
//
// Source = NEXT_PUBLIC_SUPABASE_URL / keys from .env.local (or --env-file). LOCAL ONLY unless
// --target-url <url> --i-understand-remote. Owner sessions needing aal2 (MFA) cannot be created by
// this script; on staging, run the backup from /admin/backups and use --run-id to download.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { WEB_ROOT, assertTargetAllowed, loadEnvFile, parseArgs, sha256, unzip, writeJson } from "./backup-lib.mjs";

const args = parseArgs();
const env = loadEnvFile(args["env-file"]);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
assertTargetAllowed(url, args, "backup-run");
const email = args["owner-email"], password = args["owner-password"];
if (!email || !password) { console.error("--owner-email and --owner-password are required"); process.exit(2); }

const owner = createClient(url, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { error: le } = await owner.auth.signInWithPassword({ email, password });
if (le) { console.error(`owner login: ${le.message}`); process.exit(1); }

let runId = args["run-id"];
let result = null;
if (!runId) {
  const { runBackupCore } = await import("../src/features/backups/core.ts");
  const { zip } = await import("../src/features/backups/zip-core.ts");
  const admin = createClient(url, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  result = await runBackupCore({ owner, admin, zip });
  if ("error" in result) { console.error(`backup could not start: ${result.error}`); process.exit(1); }
  runId = result.runId;
  console.log(`run ${runId}: status=${result.status}, tables=${Object.keys(result.tableCounts).length}/${result.tablesTotal}, errors=${result.errors.length}`);
}

const { data: run, error: re } = await owner.from("backup_runs").select("*").eq("id", runId).single();
if (re) { console.error(`read run: ${re.message}`); process.exit(1); }

const out = path.resolve(args.out ?? path.join(WEB_ROOT, ".cache", "restore-env", "backup", runId));
fs.mkdirSync(path.join(out, "tables"), { recursive: true });
const files = [];
const { data: tableObjs, error: te } = await owner.storage.from("backups").list(`${runId}/tables`, { limit: 1000 });
if (te) { console.error(te.message); process.exit(1); }
for (const o of [...tableObjs.map((t) => `${runId}/tables/${t.name}`), `${runId}/storage-manifest.zip`]) {
  const { data, error } = await owner.storage.from("backups").download(o);
  if (error) { console.error(`download ${o}: ${error.message}`); process.exit(1); }
  const buf = Buffer.from(await data.arrayBuffer());
  for (const e of unzip(buf)) {
    const dest = e.name === "storage-manifest.json" ? path.join(out, e.name) : path.join(out, "tables", e.name);
    fs.writeFileSync(dest, e.data);
  }
  files.push({ object: o, bytes: buf.length, sha256: sha256(buf) });
}
writeJson(path.join(out, "run.json"), { run, downloaded: files, downloaded_at: new Date().toISOString(), source: url });
console.log(`downloaded ${files.length} archives to ${out}`);
if (run.status !== "completed") { console.error(`run status is ${run.status}; not a complete backup`); process.exit(1); }
