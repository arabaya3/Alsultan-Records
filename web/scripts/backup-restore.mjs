// Restores an in-app JSON backup (downloaded with backup-run.mjs) into a database that already has
// the migrations applied and no app data. Ids, hashes and timestamps are kept verbatim.
//
//   node scripts/backup-restore.mjs --from DIR --container supabase_db_alsultan-restore [--auth-sql DIR/auth.sql] [--replace]
//   node scripts/backup-restore.mjs --from DIR --db-url postgresql://... --target-url <same> --i-understand-remote   (psql on PATH)
//
// DIR must contain tables/<table>.json (as unzipped from backups/{run}/tables/*.zip).
// --auth-sql: a `pg_dump --data-only --disable-triggers` of auth.users/auth.identities/auth.mfa_factors,
//   loaded FIRST (the in-app export cannot read auth.*). Without it, profiles would point at missing users.
// --skip-orphan-profiles: drop profiles rows whose auth.users row is absent from the auth dump (happens
//   when a user is deleted between the JSON export and the auth dump; they are not one snapshot). Every
//   skipped row is listed in restore-result.json and expected counts are reduced accordingly.
// --replace: wipe existing rows in the restored tables first. Without it the script refuses a target
//   that has any rows other than the migration-seeded singletons/categories.
//
// Load runs in ONE transaction with session_replication_role = replica, so guard/audit/numbering/hash
// triggers do not fire and FK triggers are skipped; FK integrity is then re-checked explicitly for every
// public foreign key. Exit code: 0 only if every table count equals the backup and no FK is orphaned.
// In the local container the load runs as supabase_admin (setting session_replication_role needs it).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BACKUP_TABLES, assertTargetAllowed, parseArgs, parseCopyDump, runPsql, writeJson } from "./backup-lib.mjs";

const args = parseArgs();
if (!args.from || (!args.container && !args["db-url"])) {
  console.error("usage: backup-restore.mjs --from DIR (--container NAME | --db-url URL) [--auth-sql FILE | --pg-dump FILE] [--replace] [--skip-orphan-profiles]");
  process.exit(2);
}
const MAIN_CONTAINER = "supabase_db_alsultan-records";
if (args.container === MAIN_CONTAINER || /:54322\//.test(args["db-url"] ?? "")) {
  console.error("Refusing to restore over the main development stack. Restore into an isolated stack.");
  process.exit(2);
}
if (args["db-url"]) assertTargetAllowed(args["db-url"].replace(/^postgres(ql)?:/, "http:"), { ...args, "target-url": args["target-url"]?.replace(/^postgres(ql)?:/, "http:") }, "backup-restore");

// Container: run as supabase_admin. --db-url: the URL's user; password only via PGPASSWORD env (never argv);
// psql on PATH or a throwaway docker client (see backup-lib runPsql).
const target = args.container ? { container: args.container, user: "supabase_admin" } : { dbUrl: args["db-url"] };
function sqlRun(sql) {
  const r = runPsql(target, sql);
  if (r.status !== 0) throw new Error(`psql failed (${r.status}): ${r.stderr || r.error}`);
  return r;
}
const sqlExec = (sql) => sqlRun(sql).stdout;

const from = path.resolve(args.from);
const MIGRATION_SEEDED = new Set(["business_settings", "app_settings", "service_categories"]);
const report = { from, target: target.container ?? "db-url", started_at: new Date().toISOString(), auth: null, tables: {}, fk_orphans: [], ok: false };

// ---------------------------------------------------------------- 0. read backup
const data = {};
const orig = {};
const pgDump = args["pg-dump"] ? fs.readFileSync(path.resolve(args["pg-dump"]), "utf8") : null;
if (pgDump) {
  const parsed = parseCopyDump(pgDump);
  for (const t of BACKUP_TABLES) {
    if (!parsed[`public.${t}`]) { console.error(`dump has no COPY block for public.${t}`); process.exit(1); }
    data[t] = parsed[`public.${t}`];
    orig[t] = data[t].length;
  }
  if (!parsed["auth.users"]) { console.error("dump has no auth.users block (dump auth.users/identities/mfa_factors in the SAME pg_dump)"); process.exit(1); }
}
for (const t of pgDump ? [] : BACKUP_TABLES) {
  const f = path.join(from, "tables", `${t}.json`);
  if (!fs.existsSync(f)) { console.error(`missing ${f}`); process.exit(1); }
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  if (j.table !== t || j.count !== j.rows.length) { console.error(`${t}.json is inconsistent (count ${j.count} vs ${j.rows.length} rows)`); process.exit(1); }
  data[t] = j.rows;
  orig[t] = j.rows.length;
}

// ---------------------------------------------------------------- 0b. schema version must match the source
// DIR/schema-migrations.txt = `select version from supabase_migrations.schema_migrations order by 1` on the
// SOURCE at backup time. The target must have exactly the same migrations applied.
report.target_migrations = sqlExec("select version from supabase_migrations.schema_migrations order by 1;").trim().split("\n").filter(Boolean);
{
  const f = path.join(from, "schema-migrations.txt");
  if (fs.existsSync(f)) {
    const want = fs.readFileSync(f, "utf8").trim().split(/\r?\n/).filter(Boolean);
    if (JSON.stringify(want) !== JSON.stringify(report.target_migrations)) {
      console.error(`Schema mismatch. Backup was taken at migrations [${want.at(-1)}], target has [${report.target_migrations.at(-1)}]. Apply exactly the source's migrations to the target first.`);
      process.exit(1);
    }
    report.schema_check = `ok (${want.length} migrations, last ${want.at(-1)})`;
  } else {
    report.schema_check = "skipped: no schema-migrations.txt next to the backup";
    console.warn("!! no schema-migrations.txt in the backup folder; schema version NOT checked.");
  }
}

// ---------------------------------------------------------------- 1. emptiness check
const counts = Object.fromEntries(sqlExec(BACKUP_TABLES.map((t) => `select '${t}', count(*) from public.${t};`).join("\n"))
  .trim().split("\n").map((l) => l.split("|")).map(([t, n]) => [t, Number(n)]));
const busy = Object.entries(counts).filter(([t, n]) => n > 0 && !MIGRATION_SEEDED.has(t));
if (busy.length && !args.replace) {
  console.error(`Target is not empty: ${busy.map(([t, n]) => `${t}=${n}`).join(", ")}. Use --replace to wipe these tables first.`);
  process.exit(1);
}

// ---------------------------------------------------------------- 2. auth (pg_dump of auth schema)
const wipeSql = `set local session_replication_role = replica;\n${[...BACKUP_TABLES].reverse().map((t) => `delete from public.${t};`).join("\n")}
delete from auth.mfa_factors; delete from auth.identities; delete from auth.users;\n`;
if (pgDump) {
  // Single-snapshot path: public + auth from ONE pg_dump. Migration-seeded rows are wiped first.
  const authUsers = Number(sqlExec("select count(*) from auth.users;").trim());
  if (authUsers > 0 && !args.replace) { console.error(`auth.users already has ${authUsers} rows; use --replace`); process.exit(1); }
  sqlExec(`begin;\n${wipeSql}commit;\n`);
  sqlExec(`begin;\n${pgDump}\ncommit;\n`);
  report.mode = "pg_dump";
  report.auth = Object.fromEntries(sqlExec("select 'users', count(*) from auth.users; select 'identities', count(*) from auth.identities; select 'mfa_factors', count(*) from auth.mfa_factors;")
    .trim().split("\n").map((l) => l.split("|")).map(([k, n]) => [k, Number(n)]));
  console.log(`pg_dump loaded; auth: ${JSON.stringify(report.auth)}`);
} else if (args["auth-sql"]) {
  const authUsers = Number(sqlExec("select count(*) from auth.users;").trim());
  if (authUsers > 0 && !args.replace) { console.error(`auth.users already has ${authUsers} rows; use --replace`); process.exit(1); }
  if (args.replace) {
    // Replica mode: no FK cascades into immutable tables (album_selection_snapshots, audit_events).
    sqlExec(`begin;\n${wipeSql}commit;\n`);
  }
  const sql = fs.readFileSync(path.resolve(args["auth-sql"]), "utf8");
  sqlExec(`begin;\n${sql}\ncommit;\n`);
  report.auth = Object.fromEntries(sqlExec("select 'users', count(*) from auth.users; select 'identities', count(*) from auth.identities; select 'mfa_factors', count(*) from auth.mfa_factors;")
    .trim().split("\n").map((l) => l.split("|")).map(([k, n]) => [k, Number(n)]));
  console.log(`auth loaded: ${JSON.stringify(report.auth)}`);
} else {
  console.warn("!! no --auth-sql given: profiles/customers that reference auth.users will be orphaned (FK check will fail).");
}

// ---------------------------------------------------------------- 2b. orphaned profiles (export/auth race)
report.skipped = [];
{
  const authIds = new Set(sqlExec("select id from auth.users;").trim().split("\n").filter(Boolean));
  const orphans = data.profiles.filter((r) => !authIds.has(r.id));
  if (orphans.length) {
    const msg = orphans.map((r) => `${r.id} (${r.full_name ?? "?"}, ${r.role ?? "?"})`).join(", ");
    if (!args["skip-orphan-profiles"]) {
      console.error(`profiles without an auth.users row in the auth dump: ${msg}. Re-take a consistent auth dump, or pass --skip-orphan-profiles to drop them (recorded).`);
      process.exit(1);
    }
    console.warn(`!! skipping ${orphans.length} profile(s) with no auth user: ${msg}`);
    data.profiles = data.profiles.filter((r) => authIds.has(r.id));
    report.skipped.push(...orphans.map((r) => ({ table: "profiles", id: r.id, reason: "auth.users row missing from auth dump" })));
  }
}

// ---------------------------------------------------------------- 3. tables, one transaction
const tag = (s) => { let t; do t = `j${crypto.randomBytes(4).toString("hex")}`; while (s.includes(`$${t}$`)); return t; };
let sql = "begin;\nset local session_replication_role = replica;\n";
for (const t of [...BACKUP_TABLES].reverse()) sql += `delete from public.${t};\n`;
sql += `
create function pg_temp.restore_table(p_table text, p_rows jsonb) returns bigint language plpgsql as $f$
declare v_cols text; v_n bigint;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table and is_generated = 'NEVER';
  execute format('insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I, $1)',
                 p_table, v_cols, v_cols, p_table) using p_rows;
  get diagnostics v_n = row_count;
  return v_n;
end $f$;
`;
for (const t of BACKUP_TABLES) {
  const json = JSON.stringify(data[t]);
  const q = tag(json);
  sql += `select '${t}', pg_temp.restore_table('${t}', $${q}$${json}$${q}$::jsonb);\n`;
}
const skippedProfiles = report.skipped.filter((x) => x.table === "profiles").map((x) => x.id);
if (skippedProfiles.length) {
  // Replay exactly what the source did when those users were deleted: each FK's own ON DELETE action.
  sql += `
do $$
declare r record; v bigint; ids uuid[] := array[${skippedProfiles.map((i) => `'${i}'`).join(",")}]::uuid[];
begin
  for r in select c.conrelid::regclass::text as child, a.attname as col, c.confdeltype as act
           from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
           where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass and array_length(c.conkey, 1) = 1
  loop
    if r.act = 'n' then execute format('update %s set %I = null where %I = any($1)', r.child, r.col, r.col) using ids;
    elsif r.act = 'c' then execute format('delete from %s where %I = any($1)', r.child, r.col) using ids;
    else raise exception 'FK %.% has no ON DELETE action; cannot drop orphan profile', r.child, r.col;
    end if;
    get diagnostics v = row_count;
    if v > 0 then raise notice 'SKIPFX|%|%|%|%', r.child, r.col, r.act, v; end if;
  end loop;
end $$;
`;
}
sql += "commit;\n";
const loadOut = pgDump ? { stdout: BACKUP_TABLES.map((t) => `${t}|${orig[t]}`).join("\n"), stderr: "" } : sqlRun(sql);
const inserted = Object.fromEntries(loadOut.stdout.trim().split("\n").filter(Boolean).map((l) => l.split("|")).map(([t, n]) => [t, Number(n)]));
for (const line of loadOut.stderr.split("\n")) {
  const m = /SKIPFX\|public\.([^|]+)\|([^|]+)\|([^|]+)\|(\d+)|SKIPFX\|([^|]+)\|([^|]+)\|([^|]+)\|(\d+)/.exec(line);
  if (!m) continue;
  const [child, col, act, n] = m[1] ? [m[1], m[2], m[3], Number(m[4])] : [m[5], m[6], m[7], Number(m[8])];
  report.skipped.push({ table: child, column: col, action: act === "c" ? "deleted (ON DELETE CASCADE)" : "set null (ON DELETE SET NULL)", rows: n });
  if (act === "c") data[child] = data[child].slice(0, data[child].length - n); // expected count shrinks
  console.warn(`!! ${child}.${col}: ${n} row(s) ${act === "c" ? "deleted" : "set null"} for skipped profile(s)`);
}

// (pg_dump mode: "inserted" = rows in the dump; the restored count is then checked below.)
// ---------------------------------------------------------------- 4. verify counts + FK integrity
const after = Object.fromEntries(sqlExec(BACKUP_TABLES.map((t) => `select '${t}', count(*) from public.${t};`).join("\n"))
  .trim().split("\n").map((l) => l.split("|")).map(([t, n]) => [t, Number(n)]));
let mismatches = 0;
for (const t of BACKUP_TABLES) {
  const loaded = t === "profiles" ? orig[t] - skippedProfiles.length : orig[t];
  const ok = after[t] === data[t].length && inserted[t] === loaded;
  if (!ok) mismatches++;
  report.tables[t] = { backup: orig[t], expected: data[t].length, inserted: inserted[t], restored: after[t], ok };
}
const fkSql = `
do $$
declare r record; v bigint;
begin
  for r in
    select c.conname, cl.relname as child, ca.attname as col, pn.nspname as pschema, pc.relname as parent, pa.attname as pcol
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
    join pg_class pc on pc.oid = c.confrelid join pg_namespace pn on pn.oid = pc.relnamespace
    join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = c.conkey[1]
    join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
    where c.contype = 'f' and n.nspname = 'public' and array_length(c.conkey, 1) = 1
  loop
    execute format('select count(*) from public.%I x where x.%I is not null and not exists (select 1 from %I.%I p where p.%I = x.%I)',
                   r.child, r.col, r.pschema, r.parent, r.pcol, r.col) into v;
    raise notice 'FK|%|%|%|%', r.conname, r.child, r.parent, v;
  end loop;
end $$;`;
const fkOut = sqlRun(fkSql).stderr;
let fkChecked = 0;
for (const line of fkOut.split("\n")) {
  const m = /FK\|([^|]+)\|([^|]+)\|([^|]+)\|(\d+)/.exec(line);
  if (!m) continue;
  fkChecked++;
  if (Number(m[4]) > 0) report.fk_orphans.push({ constraint: m[1], child: m[2], parent: m[3], orphans: Number(m[4]) });
}
report.fk_checked = fkChecked;
report.finished_at = new Date().toISOString();
report.ok = mismatches === 0 && report.fk_orphans.length === 0 && fkChecked > 0;
writeJson(path.join(from, "restore-result.json"), report);
console.log(`tables: ${BACKUP_TABLES.length - mismatches}/${BACKUP_TABLES.length} counts match; FKs checked: ${fkChecked}; orphaned FKs: ${report.fk_orphans.length}`);
if (!report.ok) {
  for (const [t, r] of Object.entries(report.tables)) if (!r.ok) console.error(`MISMATCH ${t}: ${JSON.stringify(r)}`);
  for (const o of report.fk_orphans) console.error(`ORPHAN ${JSON.stringify(o)}`);
  process.exit(1);
}
console.log("OK");
