#!/usr/bin/env node
/**
 * Fails if any server secret ends up in the browser bundle.
 *   node scripts/check-bundle-secrets.mjs [--env-file .env.local] [--dir .next/static]
 * Scans every file under the dir for: each value of a secret variable in the env file
 * (anything not NEXT_PUBLIC_*), plus the markers `sb_secret_<key body>` and `service_role`.
 * Prints variable NAMES and file paths only, never values.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { WEB_ROOT, parseArgs, parseEnvFile, resolvePath } from "./staging-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const envFile = args["env-file"] ? resolvePath(args["env-file"]) : resolve(WEB_ROOT, ".env.local");
const dir = args.dir ? resolvePath(args.dir) : resolve(WEB_ROOT, ".next/static");
if (!existsSync(envFile)) { console.error(`✗ env file not found: ${envFile}`); process.exit(1); }
if (!existsSync(dir)) { console.error(`✗ ${dir} not found — build first (npm run build)`); process.exit(1); }

const env = parseEnvFile(envFile);
const needles = Object.entries(env)
  .filter(([k, v]) => !k.startsWith("NEXT_PUBLIC_") && v && v.length >= 8)
  .map(([k, v]) => ({ name: k, value: v }));
// Markers: a real sb_secret_ KEY (prefix + key body; the bare prefix appears in supabase-js itself,
// which uses it to detect new-format keys) and any service_role mention (legacy JWT payload or code).
needles.push({ name: "marker:sb_secret_<key>", re: /sb_secret_[A-Za-z0-9_-]{16,}/ }, { name: "marker:service_role", re: /service_role/ });

const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
walk(dir);

const hits = [];
for (const f of files) {
  const text = readFileSync(f).toString("latin1");
  for (const n of needles) if (n.re ? n.re.test(text) : text.includes(n.value)) hits.push(`${n.name} in ${relative(WEB_ROOT, f)}`);
}
console.log(`scanned ${files.length} files in ${relative(WEB_ROOT, dir) || dir} for ${needles.length} needles (${needles.map((n) => n.name).join(", ")})`);
if (hits.length) {
  for (const h of hits) console.error(`✗ ${h}`);
  process.exit(1);
}
console.log("✓ no secret values or secret markers found in the client bundle");
