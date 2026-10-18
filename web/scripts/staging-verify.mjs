#!/usr/bin/env node
/**
 * Post-migration integration & authorization checks.
 *
 *   node scripts/staging-verify.mjs --target local     # web/.env.local + local stack (refuses remote URLs)
 *   node scripts/staging-verify.mjs --target staging   # web/.env.staging.app.local (+ .env.staging.local for read-only SQL)
 *
 * Creates clearly labelled temporary users/rows/objects ("[STAGING-TEST] <run id>") with the secret key,
 * runs the checks with real anon / user sessions (publishable key), then deletes everything it created and
 * verifies zero leftovers. audit_events rows written by triggers are append-only by design and are
 * reported, not deleted. Writes docs/staging-verify-report.json (no secrets). Exit 1 on any failure.
 * Mirrors tests/e2e/qa-security.spec.ts, but builds its own fixtures (staging has no seed).
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXPECTED_REF, StepError, WEB_ROOT, loadStagingEnv, mgmt, parseArgs, parseEnvFile, resolvePath } from "./staging-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const TARGET = args.target;
if (!["local", "staging"].includes(TARGET)) {
  console.error("usage: node scripts/staging-verify.mjs --target local|staging");
  process.exit(1);
}
const REPORT = resolve(WEB_ROOT, "..", "docs", TARGET === "staging" ? "staging-verify-report.json" : "staging-verify-report.local.json");

// ------------------------------------------------------------------ target config
let E, sql;
if (TARGET === "local") {
  E = parseEnvFile(resolve(WEB_ROOT, ".env.local"));
  const u = new URL(E.NEXT_PUBLIC_SUPABASE_URL);
  if (!["127.0.0.1", "localhost"].includes(u.hostname)) {
    console.error("✗ --target local refuses a non-local NEXT_PUBLIC_SUPABASE_URL");
    process.exit(1);
  }
  const container = args.container ?? "supabase_db_alsultan-records";
  sql = async (q) => {
    const out = execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], {
      input: `select coalesce(json_agg(t), '[]'::json) from (${q}) t;`,
      encoding: "utf8",
    });
    return JSON.parse(out.trim());
  };
} else {
  E = parseEnvFile(resolve(WEB_ROOT, ".env.staging.app.local"));
  if (E.NEXT_PUBLIC_SUPABASE_URL !== `https://${EXPECTED_REF}.supabase.co`) {
    console.error(`✗ .env.staging.app.local does not point at ${EXPECTED_REF}`);
    process.exit(1);
  }
  const m = mgmt(loadStagingEnv(args["env-file"] ? resolvePath(args["env-file"]) : resolve(WEB_ROOT, ".env.staging.local")));
  sql = (q) => m.read(q);
}
const URL_ = E.NEXT_PUBLIC_SUPABASE_URL;
const PUB = E.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(URL_, E.SUPABASE_SECRET_KEY, opts);
const anon = createClient(URL_, PUB, opts);

// ------------------------------------------------------------------ check recorder
const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass: !!pass, ...(detail ? { detail: String(detail).slice(0, 300) } : {}) });
  console.log(`  ${pass ? "✓" : "✗"} ${name}${detail && !pass ? ` — ${detail}` : ""}`);
}
const none = (r) => !!r.error || (r.data ?? []).length === 0;
const descr = (r) => (r.error ? `error ${r.error.code ?? ""} ${r.error.message}` : `${(r.data ?? []).length} rows`);
const must = (r, what) => {
  if (r.error) throw new StepError(`${what}: ${r.error.message}`);
  return r.data;
};

// ------------------------------------------------------------------ TOTP (RFC 6238, same as tests/e2e/totp.ts)
function base32Decode(s) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, val = 0; const out = [];
  for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    val = (val << 5) | a.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
async function freshTotp(secret) {
  const left = 30_000 - (Date.now() % 30_000);
  if (left < 3000) await new Promise((r) => setTimeout(r, left + 200));
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const h = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}

// ------------------------------------------------------------------ fixtures
const RUN = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
const TAG = `[STAGING-TEST] ${RUN}`;
const created = { users: {}, customers: [], staff: [], events: [], quotes: [], payments: [], objects: [] };
const PW = `St-${randomBytes(18).toString("base64url")}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function mkUser(key) {
  const email = `staging-test-${RUN}-${key}@example.com`;
  const r = await db.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { full_name: `${TAG} ${key}` } });
  const id = must(r, `create user ${key}`).user.id;
  created.users[key] = { id, email };
  return id;
}
async function signIn(key) {
  const c = createClient(URL_, PUB, opts);
  must(await c.auth.signInWithPassword({ email: created.users[key].email, password: PW }), `sign in ${key}`);
  return c;
}
async function toAal2(c) {
  const en = must(await c.auth.mfa.enroll({ factorType: "totp", friendlyName: `${TAG}` }), "mfa enroll");
  must(await c.auth.mfa.challengeAndVerify({ factorId: en.id, code: await freshTotp(en.totp.secret) }), "mfa verify");
  const { data } = await c.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel;
}
async function upload(bucket, path, body = PNG, contentType = "image/png") {
  must(await db.storage.from(bucket).upload(path, body, { contentType, upsert: true }), `upload ${bucket}/${path}`);
  created.objects.push({ bucket, path });
}
async function mkEvent(customerId, title) {
  const r = await db.from("events").insert({ customer_id: customerId, title: `${TAG} ${title}` }).select("id").single();
  const id = must(r, "insert event").id;
  created.events.push(id);
  return id;
}
async function mkMedia(eventId, bucket, visibility, variant) {
  const id = randomUUID();
  const path = `events/${eventId}/${id}/${variant}.png`;
  await upload(bucket, path);
  must(await db.from("media_assets").insert({ id, event_id: eventId, bucket, path, kind: "image", mime: "image/png", bytes: PNG.length, visibility, upload_status: "ready" }), "insert media");
  return { id, path };
}

async function setup() {
  console.log(`\n[setup] run ${RUN} on ${new URL(URL_).host}`);
  for (const k of ["a", "b", "staff", "admin"]) await mkUser(k);
  const cs = must(await db.from("customers").select("id, user_id").in("user_id", Object.values(created.users).map((u) => u.id)), "customers");
  for (const c of cs) created.customers.push(c.id);
  const cust = (k) => cs.find((c) => c.user_id === created.users[k].id).id;
  const custA = cust("a"), custB = cust("b");
  // Role changes as service role (guard triggers only block API roles). Staff roles require MFA.
  must(await db.from("profiles").update({ role: "staff", mfa_required: true }).eq("id", created.users.staff.id), "staff role");
  must(await db.from("profiles").update({ role: "admin", mfa_required: true }).eq("id", created.users.admin.id), "admin role");
  const st = must(await db.from("staff_members").insert({ full_name: `${TAG} staff`, profile_id: created.users.staff.id }).select("id").single(), "staff member");
  created.staff.push(st.id);

  const EA = await mkEvent(custA, "A private"), EB = await mkEvent(custB, "B private"), EP = await mkEvent(custA, "A public");
  must(await db.from("event_staff_assignments").insert({ event_id: EB, staff_id: st.id }), "assignment");
  must(await db.from("events").update({ public_slug: `staging-test-${RUN}`, publication_consent: "granted" }).eq("id", EP), "consent");
  must(await db.from("events").update({ is_published: true }).eq("id", EP), "publish");
  const MA = await mkMedia(EA, "private-media", "private", "original");
  const MB = await mkMedia(EB, "private-media", "private", "original");
  const MP = await mkMedia(EP, "public-media", "public", "display");
  const qA = must(await db.from("quotes").insert({ customer_id: custA, event_id: EA, status: "sent" }).select("id").single(), "quote A").id;
  const qB = must(await db.from("quotes").insert({ customer_id: custB, event_id: EB, status: "sent" }).select("id").single(), "quote B").id;
  created.quotes.push(qA, qB);
  for (const [k, c, e] of [["a", custA, EA], ["b", custB, EB]]) {
    const p = must(await db.from("payments").insert({ customer_id: c, event_id: e, amount: 100, method: "cash", idempotency_key: `staging-test-${RUN}-${k}`, reference: TAG }).select("id").single(), "payment");
    created.payments.push(p.id);
  }
  const backupPath = `staging-test-${RUN}/probe.json`;
  await upload("backups", backupPath, Buffer.from(JSON.stringify({ tag: TAG })), "application/json");
  console.log(`  fixtures: 4 users, 3 events, 3 media (+objects), 2 quotes, 2 payments, 1 backup object`);
  return { custA, custB, EA, EB, EP, MA, MB, MP, qA, qB, backupPath, staffId: st.id };
}

// ------------------------------------------------------------------ checks
async function run(F) {
  console.log("\n[anon]");
  check("anon: private events invisible", none(await anon.from("events").select("id").in("id", [F.EA, F.EB])));
  check("anon: published+consented event visible (control)", (await anon.from("events").select("id").eq("id", F.EP)).data?.length === 1);
  check("anon: private media rows invisible", none(await anon.from("media_assets").select("id").in("id", [F.MA.id, F.MB.id])));
  for (const t of ["customers", "profiles", "payments", "quotes", "contracts", "booking_requests", "audit_events", "backup_runs", "app_settings", "staff_members", "expenses"]) {
    const r = await anon.from(t).select("id").limit(1);
    check(`anon: ${t} not readable`, none(r), descr(r));
  }
  check("anon: events.production_note not selectable", !!(await anon.from("events").select("production_note").limit(1)).error);
  check("anon: private-media object download denied", !!(await anon.storage.from("private-media").download(F.MA.path)).error);
  check("anon: backups object download denied", !!(await anon.storage.from("backups").download(F.backupPath)).error);
  for (const [fn, a] of [
    ["public_submit_booking", { p_contact_name: TAG, p_contact_phone: "0500000000", p_event_type: "wedding", p_idempotency_key: `st-${RUN}`, p_ip_hash: "x" }],
    ["public_track_booking", { p_tracking_code: "AAAAAAAAAA", p_phone_last4: "0000", p_ip_hash: "x" }],
    ["public_submit_support", { p_contact_name: TAG, p_contact_phone: "0500000000", p_subject: "x", p_message: "x", p_idempotency_key: `st-${RUN}`, p_ip_hash: "x" }],
    ["public_track_support", { p_tracking_code: "AAAAAAAAAA", p_phone_last4: "0000", p_ip_hash: "x" }],
    ["bootstrap_initial_owner", { p_token: "x".repeat(40) }],
    ["claim_storage_cleanup", { p_limit: 1 }],
  ]) {
    const r = await anon.rpc(fn, a);
    check(`anon: rpc ${fn} refused`, !!r.error, descr(r));
  }

  console.log("\n[customer isolation]");
  const A = await signIn("a"), B = await signIn("b");
  const evA = await A.from("events").select("id");
  check("A sees own events (control)", [F.EA, F.EP].every((id) => evA.data?.some((e) => e.id === id)), descr(evA));
  check("A cannot see B's event", none(await A.from("events").select("id").eq("id", F.EB)));
  check("B cannot see A's events", none(await B.from("events").select("id").in("id", [F.EA, F.EP])) || (await B.from("events").select("id").in("id", [F.EA, F.EP])).data.every((e) => e.id === F.EP));
  check("A sees own media (control)", (await A.from("media_assets").select("id").eq("id", F.MA.id)).data?.length === 1);
  check("A cannot see B's media", none(await A.from("media_assets").select("id").eq("id", F.MB.id)));
  check("A sees own quote (control)", (await A.from("quotes").select("id").eq("id", F.qA)).data?.length === 1);
  check("A cannot see B's quote", none(await A.from("quotes").select("id").eq("id", F.qB)));
  check("A cannot accept B's quote", !!(await A.rpc("customer_accept_quote", { p_quote_id: F.qB })).error);
  const payA = await A.from("payments").select("id, customer_id");
  check("A sees only own payments", payA.data?.length >= 1 && payA.data.every((p) => p.customer_id === F.custA), descr(payA));
  check("B cannot see A's payments", none(await B.from("payments").select("id").eq("customer_id", F.custA)));
  check("A cannot read B's event financials", !!(await A.rpc("event_financials", { p_event_id: F.EB })).error);
  check("A can download own private object (control)", !(await A.storage.from("private-media").download(F.MA.path)).error);
  check("A cannot download B's private object", !!(await A.storage.from("private-media").download(F.MB.path)).error);
  const su = await A.storage.from("private-media").createSignedUrl(F.MB.path, 60);
  check("A cannot sign a URL for B's object", !!su.error || !su.data?.signedUrl, descr(su));
  const upB = await A.from("quotes").update({ discount: 1 }).eq("id", F.qB).select("id");
  check("A cannot update B's quote", none(upB));

  console.log("\n[privilege escalation]");
  const roleUp = await A.from("profiles").update({ role: "owner" }).eq("id", created.users.a.id).select("role");
  const { data: profA } = await db.from("profiles").select("role").eq("id", created.users.a.id).single();
  check("customer cannot change own role (column/trigger)", !!roleUp.error && profA.role === "customer", descr(roleUp));
  check("customer cannot call admin_set_user_role", !!(await A.rpc("admin_set_user_role", { p_user_id: created.users.a.id, p_role: "owner" })).error);
  check("customer cannot call bootstrap_initial_owner successfully", !!(await A.rpc("bootstrap_initial_owner", { p_token: "y".repeat(40) })).error);

  console.log("\n[MFA]");
  const S = await signIn("staff");
  check("staff aal1 (MFA required) cannot see assigned event", none(await S.from("events").select("id").eq("id", F.EB)));
  check("staff aal1 cannot see assigned event media", none(await S.from("media_assets").select("id").eq("id", F.MB.id)));
  check("staff reaches aal2 via TOTP", (await toAal2(S)) === "aal2");
  check("staff aal2 sees assigned event (control)", (await S.from("events").select("id").eq("id", F.EB)).data?.length === 1);
  check("staff aal2 cannot see unassigned event", none(await S.from("events").select("id").eq("id", F.EA)));
  const AD = await signIn("admin");
  check("admin aal1 (MFA required) cannot read customer events", none(await AD.from("events").select("id").eq("id", F.EA)));
  check("admin reaches aal2 via TOTP", (await toAal2(AD)) === "aal2");
  check("admin aal2 reads customer events (control)", (await AD.from("events").select("id").eq("id", F.EA)).data?.length === 1);

  console.log("\n[backups bucket]");
  check("service role sees backup object (control)", !(await db.storage.from("backups").download(F.backupPath)).error);
  check("admin aal2 cannot download backups object", !!(await AD.storage.from("backups").download(F.backupPath)).error);
  const lst = await AD.storage.from("backups").list(`staging-test-${RUN}`);
  check("admin aal2 cannot list backups", none(lst), descr(lst));
  check("admin aal2 cannot read backup_runs", none(await AD.from("backup_runs").select("id").limit(1)));
  check("admin aal2 cannot write payments directly", !!(await AD.from("payments").insert({ customer_id: F.custA, amount: 1, method: "x", idempotency_key: `st-x-${RUN}` })).error);

  console.log("\n[consent withdrawal]");
  check("anon reads live public object before withdrawal (control)", !(await anon.storage.from("public-media").download(F.MP.path)).error);
  check("anon sees public media row before withdrawal (control)", (await anon.from("media_assets").select("id").eq("id", F.MP.id)).data?.length === 1);
  const rv = await A.rpc("set_publication_consent", { p_event_id: F.EP, p_status: "revoked" });
  check("customer withdraws consent", !rv.error, descr(rv));
  check("anon object read denied immediately after withdrawal", !!(await anon.storage.from("public-media").download(F.MP.path)).error);
  check("anon media row hidden after withdrawal", none(await anon.from("media_assets").select("id").eq("id", F.MP.id)));
  check("event unpublished after withdrawal", none(await anon.from("events").select("id").eq("id", F.EP)));
  const regrant = await AD.rpc("set_publication_consent", { p_event_id: F.EP, p_status: "granted" });
  check("admin cannot re-grant after customer withdrawal", !!regrant.error, descr(regrant));
  for (const c of [A, B, S, AD]) await c.auth.signOut();

  console.log("\n[catalog (read-only SQL)]");
  const noRls = await sql("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity order by 1");
  check("RLS enabled on every public table", noRls.length === 0, noRls.map((r) => r.relname).join(", "));
  const tableCount = await sql("select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')");
  const ALLOWED_ANON_TABLES = { business_settings: ["SELECT"], services: ["SELECT"], service_categories: ["SELECT"], media_assets: ["SELECT"] };
  const anonTables = await sql(`select c.relname, p.priv from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
      where n.nspname = 'public' and c.relkind in ('r','p','v','m') and has_table_privilege('anon', c.oid, p.priv) order by 1, 2`);
  const extraT = anonTables.filter((r) => !(ALLOWED_ANON_TABLES[r.relname] ?? []).includes(r.priv));
  check("anon table privileges limited to SELECT on business_settings/services/service_categories/media_assets", extraT.length === 0, extraT.map((r) => `${r.relname}:${r.priv}`).join(", "));
  const ALLOWED_ANON_COLS = {
    events: "id title event_type event_date city status public_slug publication_consent is_published featured featured_order seo_title seo_description highlight coverage_notes created_at updated_at".split(" "),
    reviews: "id event_id display_name rating body status created_at".split(" "),
    // display columns only — original_title, source_url, source, verification_notes, updated_by stay admin-only (migration 0013)
    showcase_videos: "id youtube_id title description category duration_seconds published_at is_promo sort_order".split(" ")
      // migration 0017 (CMS) — video role / pin / optional cover photo id
      .concat("role pinned custom_cover_photo_id".split(" ")),
    // migration 0015 — display columns only; rights_note, storage paths, variants, source/review fields stay admin-only
    video_categories: "id slug title sort_order is_published".split(" "),
    showcase_video_categories: "video_id category_id is_primary".split(" "),
    photo_albums: "id slug title description event_date source_label source_url cover_photo_id sort_order".split(" ")
      // migration 0018 (CMS) — album category id; archived_at/deleted_at stay admin-only
      .concat(["category_id"]),
    album_photos: "id album_id width height alt_text sort_order".split(" "),
    // migration 0017 (CMS) — home section config (all rows, incl. is_visible); updated_by admin-only
    site_sections: "key title intro is_visible sort_order item_limit featured_ids".split(" "),
    // migration 0017 — header nav (allow-listed targets only)
    nav_items: "id label target sort_order is_visible".split(" "),
    // migration 0017 — old slug -> new slug paths (trigger-written)
    slug_redirects: "from_path to_path".split(" "),
    // migration 0017 — links of published services to public videos/albums
    service_links: "service_id kind target_id sort_order".split(" "),
    // migration 0017 — published process steps
    process_steps: "id title description photo_id sort_order".split(" "),
    // migration 0017 — ACTIVE offers only (RLS); raw price_minor/status/updated_by stay admin-only, display_price_minor is null unless show_price
    offers: "id slug title description image_photo_id display_price_minor currency show_price starts_on ends_on terms whatsapp_message pinned_home sort_order".split(" "),
    // migration 0017 — items of active offers
    offer_items: "id offer_id label sort_order".split(" "),
    // migration 0017 — ACTIVE announcements only (RLS); is_visible/updated_by stay admin-only
    announcements: "id template text link_kind link_offer_id link_page starts_on ends_on dismissible sort_order".split(" "),
    // migration 0018 — published album categories
    album_categories: "id slug title sort_order".split(" "),
  };
  const anonCols = await sql(`select c.relname, a.attname, p.priv from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p(priv)
      where n.nspname = 'public' and c.relkind in ('r','p','v','m') and has_column_privilege('anon', c.oid, a.attnum, p.priv)
        and not has_table_privilege('anon', c.oid, p.priv) order by 1, 2`);
  const extraC = anonCols.filter((r) => r.priv !== "SELECT" || !(ALLOWED_ANON_COLS[r.relname] ?? []).includes(r.attname));
  check("anon column privileges limited to public display columns (events, reviews, videos, categories, albums, photos)", extraC.length === 0, extraC.map((r) => `${r.relname}.${r.attname}:${r.priv}`).join(", "));
  const anonFns = await sql("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1");
  // Only exception: the /p photo route resolves thumb/display paths of PUBLISHED photos (migrations 0015 + 0016).
  const ALLOWED_ANON_FNS = [
    "album_photo_object_path",
    // migration 0017 (CMS): /a/<id> logo route — returns the storage path only when <id> is the ACTIVE logo
    "active_logo_path",
  ];
  const extraF = anonFns.filter((r) => !ALLOWED_ANON_FNS.includes(r.proname));
  check("anon can execute no public function except album_photo_object_path / active_logo_path", extraF.length === 0, extraF.map((r) => r.proname).join(", "));
  const fnDef = await sql("select pg_get_functiondef('public.album_photo_object_path(uuid,text)'::regprocedure) as d");
  const def = fnDef?.[0]?.d ?? "";
  check("album_photo_object_path never returns originals (variants thumb/display only)", !def.includes("storage_path_original") && def.includes("p_variant in ('thumb', 'display')"));
  const hook = await sql("select has_function_privilege('supabase_auth_admin', 'app.custom_access_token_hook(jsonb)', 'EXECUTE') as auth_admin, has_function_privilege('authenticated', 'app.custom_access_token_hook(jsonb)', 'EXECUTE') as authn, has_function_privilege('anon', 'app.custom_access_token_hook(jsonb)', 'EXECUTE') as anon");
  check("access token hook: executable by supabase_auth_admin only", hook[0].auth_admin && !hook[0].authn && !hook[0].anon, JSON.stringify(hook[0]));
  const buckets = await sql("select id, public from storage.buckets where id in ('public-media','private-media','backups') order by 1");
  check("all three buckets exist and are private", buckets.length === 3 && buckets.every((b) => !b.public), JSON.stringify(buckets));
  return { publicTables: tableCount[0].n };
}

// ------------------------------------------------------------------ cleanup
async function cleanup() {
  console.log("\n[cleanup]");
  const errs = [];
  const step = async (what, p) => { const r = await p; if (r?.error) errs.push(`${what}: ${r.error.message}`); };
  const byBucket = {};
  for (const o of created.objects) (byBucket[o.bucket] ??= []).push(o.path);
  for (const [b, paths] of Object.entries(byBucket)) await step(`remove ${b}`, db.storage.from(b).remove(paths));
  if (created.payments.length) await step("payments", db.from("payments").delete().in("id", created.payments));
  if (created.quotes.length) await step("quotes", db.from("quotes").delete().in("id", created.quotes));
  if (created.events.length) await step("events", db.from("events").delete().in("id", created.events));
  if (created.staff.length) await step("staff", db.from("staff_members").delete().in("id", created.staff));
  if (created.customers.length) await step("customers", db.from("customers").delete().in("id", created.customers));
  for (const [k, u] of Object.entries(created.users)) await step(`user ${k}`, db.auth.admin.deleteUser(u.id));

  // Leftover verification
  const left = {};
  const ids = Object.values(created.users).map((u) => u.id);
  const cnt = async (t, col, vals) => (vals.length ? (await db.from(t).select("id", { count: "exact", head: true }).in(col, vals)).count ?? -1 : 0);
  left.events = await cnt("events", "id", created.events);
  left.media_assets = await cnt("media_assets", "event_id", created.events);
  left.quotes = await cnt("quotes", "id", created.quotes);
  left.payments = await cnt("payments", "id", created.payments);
  left.customers = await cnt("customers", "id", created.customers);
  left.staff_members = await cnt("staff_members", "id", created.staff);
  left.profiles = await cnt("profiles", "id", ids);
  left.tagged_customers = (await db.from("customers").select("id", { count: "exact", head: true }).like("full_name", `${TAG}%`)).count ?? -1;
  let users = 0;
  for (const u of Object.values(created.users)) if (!(await db.auth.admin.getUserById(u.id)).error) users++;
  left.auth_users = users;
  let objects = 0;
  for (const o of created.objects) if (!(await db.storage.from(o.bucket).download(o.path)).error) objects++;
  left.storage_objects = objects;
  const total = Object.values(left).reduce((a, b) => a + Math.max(b, 0), 0) + Object.values(left).filter((v) => v < 0).length;
  const audit = await sql(`select count(*)::int as n from public.audit_events where entity_id in (${[...ids, ...created.events, ...created.quotes, ...created.payments, ...created.staff].map((i) => `'${i}'`).join(",") || "null"})`).catch(() => [{ n: null }]);
  const queue = await sql(`select count(*)::int as n from private.storage_cleanup_queue where done_at is null and (${created.events.map((e) => `reason like '%${e}'`).join(" or ") || "false"})`).catch(() => [{ n: null }]);
  check("cleanup: zero leftovers (users, rows, objects)", total === 0 && errs.length === 0, `${JSON.stringify(left)} ${errs.join("; ")}`);
  console.log(`  retained by design: ${audit[0].n} audit_events rows (append-only); ${queue[0].n} cleanup-queue items for already-removed paths (drained by the worker)`);
  return { leftovers: left, errors: errs, audit_rows_retained: audit[0].n, queue_items_pending: queue[0].n };
}

// ------------------------------------------------------------------ main
const startedAt = new Date().toISOString();
let meta = {}, cleanupResult = null, fatal = null;
try {
  const F = await setup();
  meta = await run(F);
} catch (e) {
  fatal = e?.message ?? String(e);
  check("run completed without fatal error", false, fatal);
} finally {
  try { cleanupResult = await cleanup(); } catch (e) { check("cleanup completed", false, e?.message ?? e); }
}
const passed = checks.filter((c) => c.pass).length;
const report = {
  target: TARGET,
  host: new URL(URL_).host,
  run_id: RUN,
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  totals: { checks: checks.length, passed, failed: checks.length - passed },
  public_tables: meta.publicTables ?? null,
  cleanup: cleanupResult,
  checks,
};
writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
console.log(`\n${passed}/${checks.length} checks passed → ${REPORT}`);
process.exit(checks.length - passed === 0 ? 0 : 1);
