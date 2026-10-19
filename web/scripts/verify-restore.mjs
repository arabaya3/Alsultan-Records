// Verifies a restored stack against the backup it was restored from, and writes a JSON report.
//
//   node scripts/verify-restore.mjs --label A --workdir .cache/restore-env --container supabase_db_alsultan-restore \
//        --expected DIR [--pg-dump FILE] [--storage DIR | --no-storage] [--report ../docs/restore-report.json]
//
// Expected data: DIR/tables/*.json (in-app run) or --pg-dump FILE (COPY blocks). DIR/restore-result.json
// (written by backup-restore.mjs) supplies rows that were knowingly skipped. Credentials for the
// role checks default to the LOCAL DEV seed accounts (override with --owner/--cust-a/--cust-b email:password).
// Exit code: 0 only if every check passes. LOCAL ONLY (refuses non-local API URLs).
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { BACKUP_TABLES, isLocalUrl, parseArgs, parseCopyDump, runPsql, sha256, stackStatus, WEB_ROOT } from "./backup-lib.mjs";

// REMOTE / --db-url mode (used by cloud-restore-rehearsal.mjs):
//   node scripts/verify-restore.mjs --label L --db-url postgresql://USER@HOST:PORT/postgres --api-url https://REF.supabase.co \
//        --expected DIR --pg-dump DIR/db.sql --storage DIR/storage --creds-file F --report ../docs/cloud-restore-report.json \
//        [--i-understand-remote]
//   Password/keys only through the environment (never argv): PGPASSWORD, VERIFY_PUBLISHABLE_KEY, VERIFY_SECRET_KEY.
//   --creds-file: JSON { owner?: {email,password}, a: {...}, b: {...} }. Without an owner login, event_financials
//   is checked through SQL by impersonating the restored owner (role authenticated + request.jwt.claims, aal2).
//   Non-local API/DB URLs need --i-understand-remote; the staging and old production refs are always refused.
const args = parseArgs();
const remoteMode = !!args["db-url"];
if (!args.expected || (remoteMode ? !args["api-url"] : !args.workdir || !args.container)) {
  console.error("usage: verify-restore.mjs --label L (--workdir W --container C | --db-url URL --api-url URL) --expected DIR [--pg-dump FILE] [--storage DIR | --no-storage]");
  process.exit(2);
}
if (args.container === "supabase_db_alsultan-records" || /:54322\//.test(args["db-url"] ?? "")) { console.error("refusing: that is the main stack"); process.exit(2); }
const st = remoteMode
  ? { url: String(args["api-url"]), publishable: process.env.VERIFY_PUBLISHABLE_KEY, secret: process.env.VERIFY_SECRET_KEY }
  : stackStatus(args.workdir);
if (remoteMode) {
  if (!st.publishable || !st.secret) { console.error("set VERIFY_PUBLISHABLE_KEY and VERIFY_SECRET_KEY in the environment"); process.exit(2); }
  const forbidden = ["dyuixzxmmeiypvawzmty", "peufggxvklpnaytyklgg"];
  if (forbidden.some((r) => st.url.includes(r) || String(args["db-url"]).includes(r))) { console.error("refusing: staging / old production project"); process.exit(2); }
  if (!isLocalUrl(st.url) && args["i-understand-remote"] !== true) { console.error(`refusing non-local ${st.url} without --i-understand-remote`); process.exit(2); }
} else if (!isLocalUrl(st.url)) { console.error(`refusing non-local ${st.url}`); process.exit(2); }
const label = String(args.label ?? "restore");
const expDir = path.resolve(args.expected);
const reportFile = path.resolve(args.report ?? path.join(WEB_ROOT, "..", "docs", "restore-report.json"));
const cred = (s, d) => { const [email, ...p] = String(s ?? d).split(":"); return { email, password: p.join(":") }; };
const credsFile = args["creds-file"] ? JSON.parse(fs.readFileSync(path.resolve(args["creds-file"]), "utf8")) : null;
const USERS = credsFile
  ? { owner: credsFile.owner ?? null, a: credsFile.a, b: credsFile.b }
  : {
      owner: cred(args.owner, "owner@dev.local:DevOwner!2026"),
      a: cred(args["cust-a"], "customer.a@dev.local:DevCustA!2026"),
      b: cred(args["cust-b"], "customer.b@dev.local:DevCustB!2026"),
    };

const dbTarget = remoteMode ? { dbUrl: String(args["db-url"]) } : { container: args.container, user: "supabase_admin" };
function sql(q) {
  const r = runPsql(dbTarget, q);
  if (r.status !== 0) throw new Error(r.stderr || String(r.error));
  return r.stdout;
}

const checks = [];
const notes = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined && !ok ? `  ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
}

// ------------------------------------------------------------------ expected data
const mode = args["pg-dump"] ? "pg_dump" : "app-json";
const exp = {};
let dumpText = null;
if (mode === "pg_dump") {
  dumpText = fs.readFileSync(path.resolve(args["pg-dump"]), "utf8");
  const parsed = parseCopyDump(dumpText);
  for (const t of BACKUP_TABLES) exp[t] = parsed[`public.${t}`] ?? [];
  exp["auth.users"] = parsed["auth.users"] ?? [];
} else {
  for (const t of BACKUP_TABLES) exp[t] = JSON.parse(fs.readFileSync(path.join(expDir, "tables", `${t}.json`), "utf8")).rows;
}
const restoreResult = fs.existsSync(path.join(expDir, "restore-result.json")) ? JSON.parse(fs.readFileSync(path.join(expDir, "restore-result.json"), "utf8")) : null;
const skipped = restoreResult?.skipped ?? [];
const skippedIds = new Set(skipped.filter((s) => s.id).map((s) => s.id));
const num = (v) => (v === null || v === undefined ? null : Number(v));
const bool = (v) => v === true || v === "t";

// ------------------------------------------------------------------ 1. counts + full row fidelity
const tableReport = {};
for (const t of BACKUP_TABLES) {
  const expected = exp[t].filter((r) => !(t === "profiles" && skippedIds.has(r.id)));
  const restored = Number(sql(`select count(*) from public.${t};`).trim());
  let rowMismatch = [];
  if (mode === "app-json") {
    const got = JSON.parse(sql(`select coalesce(json_agg(to_jsonb(x)), '[]') from public.${t} x;`).trim());
    const byId = new Map(got.map((r) => [String(r.id), r]));
    const norm = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
    for (const r of expected) {
      const g = byId.get(String(r.id));
      if (!g || norm(g) !== norm(r)) rowMismatch.push(String(r.id));
    }
  } else {
    // Byte-exact text comparison of COPY output vs the dump's COPY block.
    const m = new RegExp(`^COPY public\\.${t} \\(([^)]*)\\) FROM stdin;\\n([\\s\\S]*?)^\\\\\\.$`, "m").exec(dumpText);
    const want = (m?.[2] ?? "").split("\n").filter(Boolean);
    const have = new Set(sql(`copy (select ${m[1]} from public.${t}) to stdout;`).split("\n").filter(Boolean));
    rowMismatch = want.filter((l) => !have.has(l)).map((l) => l.split("\t")[0]);
  }
  // Rows changed by an explained skip (e.g. FK set null for a skipped profile) are reported, not hidden.
  const explained = skipped.filter((s) => s.table === t && s.action).reduce((n, s) => n + s.rows, 0);
  tableReport[t] = { expected: expected.length, restored, row_mismatches: rowMismatch.length, explained_by_skip: explained };
  const countOk = restored === expected.length - skipped.filter((s) => s.table === t && s.action?.startsWith("deleted")).reduce((n, s) => n + s.rows, 0);
  check(`count ${t} = ${expected.length}`, countOk, { restored });
  check(`rows ${t} identical to backup`, rowMismatch.length <= explained, rowMismatch.length ? { mismatched_ids: rowMismatch.slice(0, 10), explained_by_skip: explained } : undefined);
}
const authUsers = Number(sql("select count(*) from auth.users;").trim());
if (mode === "pg_dump") check(`auth.users count = ${exp["auth.users"].length}`, authUsers === exp["auth.users"].length, { restored: authUsers });

// ------------------------------------------------------------------ 2. relationships (restored DB)
const rel = (name, q) => { const n = Number(sql(q).trim()); check(`relationship: ${name}`, n === 0, { violations: n }); return n; };
rel("every event's customer exists", "select count(*) from public.events e where e.customer_id is not null and not exists (select 1 from public.customers c where c.id = e.customer_id);");
rel("every media asset's event exists", "select count(*) from public.media_assets m where m.event_id is not null and not exists (select 1 from public.events e where e.id = m.event_id);");
rel("selection items reference media of the same event", "select count(*) from public.album_selection_items i join public.album_selections s on s.id = i.selection_id join public.media_assets m on m.id = i.media_asset_id where m.event_id is distinct from s.event_id;");
rel("contracts' current/approved versions belong to the contract", "select count(*) from public.contracts k left join public.contract_versions a on a.id = k.approved_version_id left join public.contract_versions c on c.id = k.current_version_id where (k.approved_version_id is not null and a.contract_id is distinct from k.id) or (k.current_version_id is not null and c.contract_id is distinct from k.id);");
rel("profiles have an auth user", "select count(*) from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id);");
// Same relationships must hold for every expected event/media row (customer_id, event_id preserved).
{
  const got = new Map(sql("select id, coalesce(customer_id::text, '') from public.events;").trim().split("\n").filter(Boolean).map((l) => l.split("|")));
  const bad = exp.events.filter((e) => got.get(String(e.id)) !== String(e.customer_id ?? ""));
  check("event→customer links equal backup", bad.length === 0, { bad: bad.map((e) => e.id) });
  const gm = new Map(sql("select id, coalesce(event_id::text, '') from public.media_assets;").trim().split("\n").filter(Boolean).map((l) => l.split("|")));
  const badm = exp.media_assets.filter((m) => gm.get(String(m.id)) !== String(m.event_id ?? ""));
  check(`media→event links equal backup (${exp.media_assets.length})`, badm.length === 0, { bad: badm.slice(0, 10).map((m) => m.id) });
}
{
  const got = new Map(sql("select id, content_hash from public.contract_versions;").trim().split("\n").filter(Boolean).map((l) => l.split("|")));
  const bad = exp.contract_versions.filter((v) => got.get(String(v.id)) !== String(v.content_hash));
  check(`contract_versions.content_hash intact (${exp.contract_versions.length})`, bad.length === 0, { bad: bad.map((v) => v.id) });
}

// ------------------------------------------------------------------ 3. finances via event_financials
function expectedFinancials(eventId) {
  const versions = new Map(exp.contract_versions.map((v) => [String(v.id), v]));
  const ks = exp.contracts.filter((k) => String(k.event_id) === eventId && k.status === "approved");
  const contracted = ks.reduce((s, k) => s + (num(versions.get(String(k.approved_version_id))?.total) ?? 0), 0);
  const qs = exp.quotes.filter((q) => String(q.event_id) === eventId && q.status === "accepted");
  const quoted = qs.reduce((s, q) => s + num(q.total), 0);
  const ps = exp.payments.filter((p) => String(p.event_id) === eventId);
  const paid = ps.filter((p) => p.kind === "payment").reduce((s, p) => s + num(p.amount), 0);
  const refunded = ps.filter((p) => p.kind === "refund").reduce((s, p) => s + num(p.amount), 0);
  const expenses = exp.expenses.filter((x) => String(x.event_id) === eventId).reduce((s, x) => s + num(x.amount), 0);
  const basis = ks.length ? "contract" : qs.length ? "quote" : "none";
  const balance = (ks.length ? contracted : qs.length ? quoted : 0) - paid + refunded;
  return { contracted, paid, refunded, expenses, balance, quoted, balance_basis: basis };
}
const anonClient = () => createClient(st.url, st.publishable, { auth: { persistSession: false, autoRefreshToken: false } });
async function login(who) {
  const c = anonClient();
  const { data, error } = await c.auth.signInWithPassword(USERS[who]);
  check(`restored auth: ${who} (${USERS[who].email}) can sign in with the original password`, !error, error?.message);
  return error ? null : { c, uid: data.user.id, token: data.session.access_token };
}
const owner = USERS.owner ? await login("owner") : null;
// Without owner credentials (cloud: the restored owner's password/TOTP are the source's), impersonate the
// restored owner in SQL: same function, same RLS/authorization path, claims set like PostgREST does.
const ownerId = USERS.owner ? null : sql("select id from public.profiles where role = 'owner' and not disabled order by created_at limit 1;").trim();
if (!USERS.owner) check("restored DB has an active owner profile (for SQL-impersonated financials)", !!ownerId);
async function financialsAsOwner(eventId) {
  if (owner) return owner.c.rpc("event_financials", { p_event_id: eventId });
  try {
    const claims = JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" });
    const out = sql(`begin; set local role authenticated; select set_config('request.jwt.claims', '${claims.replace(/'/g, "''")}', true);
select coalesce(json_agg(to_jsonb(f)), '[]') from public.event_financials('${String(eventId).replace(/'/g, "")}'::uuid) f; rollback;`).trim();
    return { data: JSON.parse(out.split("\n").filter(Boolean).at(-1)), error: null };
  } catch (e) { return { data: null, error: { message: e.message.slice(0, 200) } }; }
}
const finReport = [];
if (owner || ownerId) {
  for (const e of exp.events) {
    const want = expectedFinancials(String(e.id));
    const { data, error } = await financialsAsOwner(e.id);
    const got = data?.[0];
    const same = !error && got && Object.entries(want).every(([k, v]) => (k === "balance_basis" ? got[k] === v : Number(got[k]) === v));
    finReport.push({ event: e.id, expected: want, restored: got ?? error?.message });
    check(`event_financials ${e.id} equals backup-derived totals`, same, { want, got: got ?? error?.message });
  }
}

// ------------------------------------------------------------------ 4. RLS in the restored DB
const rlsOff = sql("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;").trim();
check("RLS enabled on every public table", rlsOff === "", { tables_without_rls: rlsOff.split("\n").filter(Boolean) });
const isPublic = (e) => bool(e.is_published) && e.publication_consent === "granted";
const ca = await login("a");
const cb = await login("b");
const custOf = (uid) => exp.customers.find((c) => String(c.user_id) === uid)?.id;
if (ca) {
  // Custom access token hook configured on the target: the JWT carries app_role from public.profiles.
  const claims = JSON.parse(Buffer.from(ca.token.split(".")[1], "base64url").toString("utf8"));
  const role = sql(`select role from public.profiles where id = '${ca.uid.replace(/'/g, "")}';`).trim();
  check(`access token hook: customer A JWT app_role = profiles.role (${role})`, claims.app_role === role, { app_role: claims.app_role ?? null });
}
if (ca && cb) {
  const aCust = custOf(ca.uid), bCust = custOf(cb.uid);
  check("customer A and B have customer rows in the backup", !!aCust && !!bCust, { aCust, bCust });
  const { data: evA } = await ca.c.from("events").select("id, customer_id, is_published, publication_consent");
  const leaks = (evA ?? []).filter((e) => String(e.customer_id) !== String(aCust) && !isPublic(e));
  check("customer A sees no private event of another customer", leaks.length === 0, { leaks: leaks.map((e) => e.id) });
  const ownA = exp.events.filter((e) => String(e.customer_id) === String(aCust)).length;
  check(`customer A sees all own events (${ownA})`, (evA ?? []).filter((e) => String(e.customer_id) === String(aCust)).length === ownA);
  const { data: bRows } = await ca.c.from("customers").select("id").eq("id", bCust);
  check("customer A cannot read customer B's customers row", (bRows ?? []).length === 0, { got: bRows });
  const { data: bPay } = await ca.c.from("payments").select("id").eq("customer_id", bCust);
  check("customer A cannot read customer B's payments", (bPay ?? []).length === 0, { got: bPay?.length });
  const bEventIds = exp.events.filter((e) => String(e.customer_id) === String(bCust) && !isPublic(e)).map((e) => e.id);
  const { data: bMedia } = bEventIds.length ? await ca.c.from("media_assets").select("id").in("event_id", bEventIds) : { data: [] };
  check("customer A cannot read media of customer B's private events", (bMedia ?? []).length === 0, { got: bMedia?.length });
  const bEvent = bEventIds[0] ?? exp.events.find((e) => String(e.customer_id) === String(bCust))?.id;
  if (bEvent) {
    const { error: fe } = await ca.c.rpc("event_financials", { p_event_id: bEvent });
    check("customer A cannot call event_financials for customer B's event", !!fe, fe?.message);
  }
}
{
  const an = anonClient();
  const { data: evAnon } = await an.from("events").select("id, is_published, publication_consent");
  const wantIds = exp.events.filter(isPublic).map((e) => String(e.id)).sort();
  const gotIds = (evAnon ?? []).map((e) => String(e.id)).sort();
  check(`anon sees exactly the published+consented events (${wantIds.length})`, JSON.stringify(gotIds) === JSON.stringify(wantIds), { want: wantIds, got: gotIds });
  const { data: cAnon } = await an.from("customers").select("id");
  check("anon reads no customers", (cAnon ?? []).length === 0);
  const { data: mAnon } = await an.from("media_assets").select("id, bucket, visibility");
  check("anon media rows are public-media/public only", (mAnon ?? []).every((m) => m.bucket === "public-media" && m.visibility === "public"), { n: mAnon?.length });
}

// ------------------------------------------------------------------ 5. storage
let storageReport = { verified: false, reason: "not requested (--no-storage)" };
if (!args["no-storage"] && args.storage) {
  const man = JSON.parse(fs.readFileSync(path.join(path.resolve(args.storage), "storage-checksums.json"), "utf8"));
  const admin = createClient(st.url, st.secret, { auth: { persistSession: false } });
  const counts = Object.fromEntries(sql("select bucket_id, count(*) from storage.objects group by 1;").trim().split("\n").filter(Boolean).map((l) => l.split("|")).map(([b, n]) => [b, Number(n)]));
  for (const [b, m] of Object.entries(man.buckets)) check(`storage ${b}: ${m.count} objects`, (counts[b] ?? 0) === m.count, { restored: counts[b] ?? 0 });
  let ok = 0; const bad = [];
  for (const o of man.objects) {
    const { data, error } = await admin.storage.from(o.bucket).download(o.path);
    const h = error ? null : sha256(Buffer.from(await data.arrayBuffer()));
    if (h === o.sha256) ok++; else bad.push(`${o.bucket}/${o.path}`);
  }
  check(`storage checksums match (${ok}/${man.objects.length})`, bad.length === 0 && ok === man.objects.length, { bad: bad.slice(0, 10) });
  // Every media row's original + variants must resolve to a restored object.
  const have = new Set(man.objects.map((o) => `${o.bucket}/${o.path}`));
  const missing = [];
  for (const m of exp.media_assets) {
    if (m.upload_status !== "ready") continue;
    const v = typeof m.variants === "string" ? JSON.parse(m.variants || "{}") : m.variants ?? {};
    const paths = [m.path, ...Object.values(v).filter((x) => typeof x === "string")];
    for (const p of paths) if (!have.has(`${m.bucket}/${p}`) && !have.has(p)) missing.push(`${m.bucket}/${p}`);
  }
  check("every ready media_assets path/variant has a restored object", missing.length === 0, { missing: missing.length, sample: missing.slice(0, 5) });
  // Signed URL for a private object, as its owner (customer A), in the restored stack.
  if (ca && cb) {
    const aCust = custOf(ca.uid);
    const aEvents = new Set(exp.events.filter((e) => String(e.customer_id) === String(aCust)).map((e) => String(e.id)));
    const obj = man.objects.find((o) => o.bucket === "private-media" && aEvents.has(o.path.split("/")[1]));
    const anyPrivate = man.objects.find((o) => o.bucket === "private-media");
    if (!obj && anyPrivate && args["allow-no-owner-object"]) {
      // Test users own no media (e.g. cloud rehearsal [RESTORE-TEST] customers): prove the negative half and that
      // the restored object is servable through a signed URL (created with the secret key), and record the gap.
      notes.push("owner-signed URL not exercised: customer A owns no private object in the source");
      const { data: s } = await admin.storage.from("private-media").createSignedUrl(anyPrivate.path, 60);
      const r = s?.signedUrl ? await fetch(s.signedUrl) : null;
      const h = r?.ok ? sha256(Buffer.from(await r.arrayBuffer())) : null;
      check(`service-signed URL serves restored private object ${anyPrivate.path} (sha256 equal)`, h === anyPrivate.sha256, { status: r?.status });
      for (const [who, cl] of [["customer A", ca.c], ["customer B", cb.c]]) {
        const { data: x } = await cl.storage.from("private-media").createSignedUrl(anyPrivate.path, 60);
        check(`${who} (not the owner) cannot sign that object`, !x?.signedUrl);
      }
      const r2 = await fetch(`${st.url}/storage/v1/object/public/private-media/${anyPrivate.path}`);
      check("private object is not publicly readable", r2.status >= 400, { status: r2.status });
    } else if (!obj && !anyPrivate && args["allow-no-owner-object"]) {
      notes.push("signed URL checks not exercised: the source has no private-media objects");
    } else if (!obj) check("found a private object of customer A to sign", false);
    else {
      const { data: s, error } = await ca.c.storage.from("private-media").createSignedUrl(obj.path, 60);
      let h = null, status = null;
      if (s?.signedUrl) { const r = await fetch(s.signedUrl); status = r.status; h = sha256(Buffer.from(await r.arrayBuffer())); }
      check(`owner's signed URL works for private object ${obj.path}`, status === 200 && h === obj.sha256, { error: error?.message, status });
      const { data: sb2 } = await cb.c.storage.from("private-media").createSignedUrl(obj.path, 60);
      check("another customer cannot sign that object", !sb2?.signedUrl);
      const r2 = await fetch(`${st.url}/storage/v1/object/public/private-media/${obj.path}`);
      check("private object is not publicly readable", r2.status >= 400, { status: r2.status });
    }
  }
  storageReport = { verified: true, buckets: man.buckets, restored_counts: counts, checksum_ok: ok, objects: man.objects.length, missing_media_paths: missing.length };
} else if (args["no-storage"]) {
  storageReport = { verified: false, reason: String(args["no-storage"] === true ? "--no-storage" : args["no-storage"]) };
}

// ------------------------------------------------------------------ report
const failed = checks.filter((c) => !c.ok);
const entry = {
  label, mode, verified_at: new Date().toISOString(), restored_stack: st.url, expected_from: path.relative(WEB_ROOT, expDir),
  run: fs.existsSync(path.join(expDir, "run.json")) ? (({ id, status, started_at, finished_at, table_counts, object_counts }) => ({ id, status, started_at, finished_at, table_counts, object_counts }))(JSON.parse(fs.readFileSync(path.join(expDir, "run.json"), "utf8")).run) : null,
  restore: restoreResult ? { auth: restoreResult.auth, skipped: restoreResult.skipped, fk_checked: restoreResult.fk_checked, fk_orphans: restoreResult.fk_orphans } : null,
  tables: tableReport, financials: finReport, storage: storageReport,
  notes,
  summary: { checks: checks.length, passed: checks.length - failed.length, failed: failed.length },
  checks,
};
const all = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, "utf8")) : {};
all.generated_by = "web/scripts/verify-restore.mjs";
if (!args.report) all.cloud_restore = "PENDING: no staging access; only local isolated-stack restores verified";
all.proofs = { ...(all.proofs ?? {}), [label]: entry };
fs.writeFileSync(reportFile, JSON.stringify(all, null, 2) + "\n");
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed -> ${reportFile}`);
process.exit(failed.length ? 1 : 0);
