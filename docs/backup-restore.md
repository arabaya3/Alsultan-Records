# Backup and restore

Owner: Administration. Code: `web/src/features/backups/*` (UI at `/admin/backups`, owner only) and the operator scripts in `web/scripts/`:

| Script | Purpose |
| --- | --- |
| `backup-run.mjs` | Runs the app's backup code (`core.ts`, the same function the server action calls) as the owner, then downloads and unzips the run. With `--run-id` it only downloads. |
| `backup-storage.mjs backup` / `restore-storage` | Copies every object in every bucket to disk with sha256 checksums, then uploads to a target and reads each object back to verify. |
| `backup-restore.mjs` | Loads the in-app JSON export, or a `pg_dump` snapshot, into an empty, migrated database. Ids, hashes and timestamps are kept verbatim. Re-checks every foreign key. |
| `verify-restore.mjs` | Checks a restored stack against the backup it came from and writes `docs/restore-report.json`. |
| `backup-lib.mjs` | Shared helpers: ZIP reader, COPY parser, local-only guard, psql runner. |

All of them refuse a non-local target unless `--target-url <url> --i-understand-remote` is passed. `backup-restore.mjs` also refuses the main dev stack (`supabase_db_alsultan-records` / port 54322).

> **Status: LOCAL restore is proven (see `verification.md` B1 and `restore-report.json`). CLOUD/STAGING restore verification is PENDING** until staging access exists. Nothing in this document has been run against a hosted Supabase project.

## What is covered

| Data | In-app run (`/admin/backups`) | Operator `pg_dump` | `backup-storage.mjs` |
| --- | --- | --- | --- |
| 33 `public` tables | yes (JSON in ZIP) | yes | no |
| `auth.users`, `auth.identities`, `auth.mfa_factors` | **no** (PostgREST cannot read `auth.*`) | yes | no |
| Storage binaries (`public-media`, `private-media`, `backups`) | manifest only (paths, no bytes) | no (`storage.objects` is metadata only) | yes, with sha256 |
| `private.*` (rate limits, bootstrap token, storage cleanup queue) | no | only if dumped explicitly (not recommended) | no |
| Schema | no (the migrations are the only source) | no (data-only) | no |

What is not covered and is deliberately left out:
- `private.rate_limits` (transient).
- `private.bootstrap`, which must stay empty on a restored project so nobody can claim ownership.
- `private.storage_cleanup_queue` (rebuild by re-running cleanup).
- `storage.*` metadata (the objects are re-created by uploading).
- Edge/project settings, auth provider config, SMTP and secrets. Those live in the dashboard or env, not the database.

**A complete backup = one consistent DB snapshot that includes auth + a storage copy taken in the same quiet window.** The in-app run alone is not a complete backup.

## What the in-app backup run does

When the owner clicks **بدء النسخ الآن**, `runBackup` (in `actions.ts`) does the following. It calls `runBackupCore` in `core.ts`.

1. It re-checks the owner role (`requireRole('owner')`, plus aal2 when MFA is required).
2. It inserts a `backup_runs` row (`running`) through the owner's own client.
3. It exports each of the 33 `public` tables, 1,000 rows per page ordered by `id`, with the secret-key client. RLS hides some data even from the owner (`customers.notes`, internal event notes, other users' notifications).
4. It writes `backups/{run_id}/tables/{table}.zip`. Each archive holds `{table}.json` = `{ table, exported_at, count, rows }`. Writes use the owner's client into the owner-only `backups` bucket.
5. It writes `backups/{run_id}/storage-manifest.zip`, which lists every object in `public-media` and `private-media` (no bytes).
6. It records the status. `completed` means every table **and** the manifest succeeded. `partial` means at least one table succeeded but something failed. `failed` means no table succeeded. The UI reports anything other than `completed` as a failure. This behaviour is covered by `core.test.ts`, which injects an unknown table name through the test-only `tables` option. Production always passes `BACKUP_TABLES`.

Known quirks:
- The export is not one transaction: each table is read separately while the app is live, so take runs in a quiet window.
- The `backup_runs` table is exported while its own run row still says `running`.

## Procedure A: local (proven)

Run from `web/`. The main dev stack keeps running; the restore goes into a **second, isolated** stack.

### 1. Take the backup (source = main local stack)

```bash
# DB: the app's backup path as the owner (local dev creds; for MFA-enforced owners use the UI, then --run-id)
node --experimental-strip-types scripts/backup-run.mjs --owner-email owner@dev.local --owner-password '…'
#   -> .cache/restore-env/backup/<run_id>/{tables/*.json, storage-manifest.json, run.json}
RUN=.cache/restore-env/backup/<run_id>

# Auth: in-app export cannot read auth.*; dump it read-only, IMMEDIATELY after the run
docker exec supabase_db_alsultan-records pg_dump -U postgres -d postgres --data-only --disable-triggers \
  --column-inserts -t auth.users -t auth.identities -t auth.mfa_factors > $RUN/auth.sql

# Schema version the backup belongs to
docker exec supabase_db_alsultan-records psql -U postgres -Atc \
  "select version from supabase_migrations.schema_migrations order by 1" > $RUN/schema-migrations.txt

# Storage binaries
node scripts/backup-storage.mjs backup --out $RUN/storage
```

Preferred alternative for the DB: one `pg_dump` for public **and** auth. It is a single consistent snapshot, so there is no export-vs-auth race.

```bash
docker exec supabase_db_alsultan-records pg_dump -U postgres -d postgres --data-only --disable-triggers \
  -t 'public.*' -t auth.users -t auth.identities -t auth.mfa_factors > $SNAP/db.sql
```

`npx supabase db dump --local --data-only` dumps the whole database. It is useful as an archive, but use the table-scoped command above for restores into a migrated project.

### 2. Start the isolated stack

`web/.cache/restore-env/supabase/` holds a copy of `web/supabase/config.toml` and **exactly the source's migrations**. It differs from the main config in these values:
- `project_id = "alsultan-restore"`
- Ports: api 55321, db 55322, shadow 55320, pooler 55329, studio 55323, inbucket 55324, analytics 55327, edge inspector 55383
- `[db.seed] enabled = false`

```bash
mkdir -p .cache/restore-env/supabase && cp supabase/config.toml .cache/restore-env/supabase/ && cp -r supabase/migrations .cache/restore-env/supabase/
# edit config.toml as listed above, then:
npx supabase start --workdir .cache/restore-env
```

### 3. Restore

```bash
# In-app JSON run + auth dump
node scripts/backup-restore.mjs --from $RUN --container supabase_db_alsultan-restore --auth-sql $RUN/auth.sql
# or the single-snapshot pg_dump
node scripts/backup-restore.mjs --from $SNAP --container supabase_db_alsultan-restore --pg-dump $SNAP/db.sql

node scripts/backup-storage.mjs restore-storage --from $RUN/storage --workdir .cache/restore-env
```

`backup-restore.mjs` does the following:
- It refuses a target whose `schema_migrations` differ from `schema-migrations.txt`.
- It refuses a non-empty target unless `--replace` is passed. Migration-seeded singletons and categories are always replaced.
- It loads the data in **one transaction** with `session_replication_role = replica`, so guard, audit, numbering and hash triggers do not fire and stored values (for example `contract_versions.content_hash`) stay verbatim. It runs as `supabase_admin` in the container.
- It inserts tables in `BACKUP_TABLES` order through `jsonb_populate_recordset`, using explicit non-generated columns.
- It re-checks **every** single-column public FK for orphans, because replica mode skips FK triggers.
- It writes `restore-result.json` and exits non-zero on any count mismatch or orphan.

If a profile has no user in the auth dump, it stops. That happens when a user was deleted between the run and the dump. `--skip-orphan-profiles` drops such rows and replays each referencing FK's own `ON DELETE` action. Every affected row is recorded in the report.

### 4. Verify, then tear down

```bash
node scripts/verify-restore.mjs --label <name> --workdir .cache/restore-env --container supabase_db_alsultan-restore \
  --expected $RUN [--pg-dump $SNAP/db.sql] --storage $RUN/storage
npx supabase stop --workdir .cache/restore-env --no-backup
```

The checks:
- Per-table counts, and every row identical to the backup. JSON mode compares `to_jsonb` deep-equal; pg_dump mode compares the exact COPY text.
- Event→customer and media→event links.
- Selection items reference media of the same event.
- Contract version ownership and `content_hash` values.
- Profiles have auth users.
- `event_financials` for every event, called as the restored owner, equals totals recomputed from the backup rows.
- Original passwords work for owner, customer A and customer B.
- RLS is on for every public table. Customer A cannot read B's customer row, payments, private-event media or financials. Anon sees exactly the published and consented events.
- Storage counts per bucket and sha256 for every object.
- Every ready media path and variant resolves.
- A signed URL for a private object works for its owner but not for another customer, and the object is not publicly readable.

The verifier exits non-zero on any failure. It was tested by tampering with a hash, deleting a payment and disabling RLS on one table; it reported 6 failures and exit 1.

## Procedure B: staging / cloud (PENDING, not yet executed)

Use the same scripts with explicit opt-in. Never restore over production; restore into a **fresh project** or a staging copy.

1. **Backup.**
   - Rely on platform daily backups or PITR. They cover `auth` and `storage` schemas, but not the storage object bytes.
   - Run the owner backup from `/admin/backups` (aal2). Then download it: `node --experimental-strip-types scripts/backup-run.mjs --run-id <id> --env-file <staging env> --owner-email … --owner-password … --target-url <url> --i-understand-remote`. This cannot work if the owner needs aal2; in that case download the ZIPs from the dashboard.
   - Snapshot the DB: `npx supabase db dump --linked --data-only -f data.sql`. Or use `pg_dump "$DB_URL" --data-only --disable-triggers -t 'public.*' -t auth.users -t auth.identities -t auth.mfa_factors`.
   - Copy storage: `node scripts/backup-storage.mjs backup --out DIR --url <url> --secret <secret> --target-url <url> --i-understand-remote`.
   - Store everything encrypted off-site.
2. **Target.**
   - Create a new project.
   - Apply exactly the source's migrations: `npx supabase db push`.
   - Do not run the seed.
   - Configure auth (custom access token hook, SMTP, MFA) in the dashboard.
3. **Restore.** Run `backup-restore.mjs --db-url <target> --target-url <target> --i-understand-remote`. This needs `psql` on PATH and a role allowed to set `session_replication_role`. Then run `backup-storage.mjs restore-storage … --i-understand-remote`.
4. **Verify.** `verify-restore.mjs` now has a `--db-url` / `--api-url` mode (keys via `VERIFY_PUBLISHABLE_KEY` / `VERIFY_SECRET_KEY` env). Use the scripted rehearsal below rather than running it by hand.
5. **Post-restore.**
   - Rotate keys if the restore followed an incident (`security-model.md` §10).
   - Keep `private.bootstrap` empty.
   - Re-enable `require_staff_mfa` if a dev dump was used.

## Cloud restore rehearsal (staging → separate empty project)

Script: `web/scripts/cloud-restore-rehearsal.mjs`. **Status: tooling ready and proven by a local simulation (110/110 checks, `docs/cloud-restore-report.json` → `proofs["local-simulation"]`). The cloud run is PENDING the user's approval of a second project.**

It never creates, links, pauses or deletes projects, and never writes to staging except the optional `[RESTORE-TEST]` users (create + delete, both `--apply`). Every command is a dry run unless `--apply` is passed. It refuses when `RESTORE_PROJECT_REF` is missing, equals staging (`dyuixzxmmeiypvawzmty`), equals the old project (`peufggxvklpnaytyklgg`), or when the target database is not empty (`--allow-nonempty` overrides that last check; it can never reach staging because of the ref check). Secrets are masked in output and never put in argv: child processes get `PGPASSWORD`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `VERIFY_*_KEY` through the environment, and DB URLs carry no password.

### Prerequisites (user decisions)

1. **Approve a second FREE project** in the same organization, e.g. name `alsultan-restore-rehearsal`, region `ap-southeast-1` (same as staging). Alternatively reuse an existing **empty** free project. Create it yourself in the dashboard (the script will not). Note its database password.
   - Cost: **$0** on the free plan as long as the org has at most **2 active free projects** (staging + this one). The org has 1 today.
   - Free projects **auto-pause after ~7 days of inactivity**. A paused project must be restored in the dashboard before the script can use it (the script checks `ACTIVE_HEALTHY`).
   - **Delete it after the rehearsal** (see Teardown). It holds a real copy of staging's auth users (password hashes) and data.
2. **Access token.** The script reuses `SUPABASE_ACCESS_TOKEN` from `web/.env.staging.local`. A Supabase personal access token acts with the token owner's org role; that role must be **Owner or Administrator** in the org (Developer cannot change auth config or read secret API keys). If a scoped OAuth/fine-grained token is used instead, it needs on the rehearsal project: **Projects: read**, **Database: read + write** (pooler config, migrations), **Auth: read + write** (`/config/auth` PATCH for the hook + TOTP), and **Secrets: read** (`/api-keys?reveal=true`). Staging needs only **Database: read** for the backup (plus the staging DB password already in `.env.staging.local`).
3. **Tools:** Docker running (the CLI runs `pg_dump` in Docker; `psql` runs as `docker run --rm postgres:17.6-alpine` when no `psql` is on PATH; override with `PSQL_IMAGE`). Node 22. The checkout must be at the commit whose `supabase/migrations` match staging's (the script refuses otherwise).

### `web/.env.restore.local` (gitignored by `web/.gitignore` `.env*`; names only)

| Variable | Required | Meaning |
| --- | --- | --- |
| `RESTORE_PROJECT_REF` | yes | the rehearsal project's ref |
| `RESTORE_DB_PASSWORD` | yes | its database password |
| `RESTORE_DB_URL` | no | override connection string **without password** (default: the project's session pooler from the Management API, port 5432, IPv4) |
| `SUPABASE_ACCESS_TOKEN` | no | only if a different token than staging's should be used |

Backups land in `web/.cache/cloud-rehearsal/<timestamp>/` (gitignored by `/.cache/`; verified with `git check-ignore`). Test-user passwords live only in `web/.cache/cloud-rehearsal/test-users.local.json`.

### Commands, in order (from `web/`)

```bash
S=scripts/cloud-restore-rehearsal.mjs
node $S seed-test-users            # dry run; then --apply: 2 "[RESTORE-TEST]" customers in STAGING, generated passwords → .cache only
node $S backup --apply             # staging READ-ONLY: migrations, schema dump, ONE data-only dump (public+auth+storage), storage copy, counts, manifest
node $S cleanup-test-users --apply # remove the [RESTORE-TEST] users from staging again (they stay in the backup)
# user: create the project, write web/.env.restore.local
node $S restore                    # dry run: guards + plan
node $S restore --apply            # db push --db-url, data load, storage upload, owner metadata, Auth hook + TOTP
node $S verify --apply             # → docs/cloud-restore-report.json
node $S teardown                   # prints the pause/delete steps; deletes nothing
```

What `backup` runs: `npx supabase db dump --linked -s public` (schema, for comparison) and `npx supabase db dump --linked --data-only --use-copy -s public,auth,storage` (one `pg_dump` = one snapshot). From that it derives `db.sql` (auth `users`, `identities`, `mfa_factors` + the 33 public tables) and `storage-meta.json` (`storage.buckets`, `storage.objects` rows), then copies the storage binaries with `backup-storage.mjs backup` right after. It writes `schema-migrations.txt`, `counts.json` and `manifest.json` (sha256 of every file). It requires `supabase/.temp/project-ref` = staging.

What `restore` runs: checks the manifest and that the checkout's migrations equal the backup's, resolves the target (project status, session pooler, API keys), refuses a non-empty target, then `npx supabase db push --db-url postgresql://<user>@<pooler>:5432/postgres --yes` (password via `PGPASSWORD`; the staging link in `supabase/.temp/project-ref` is checked before and after and never changed), then `backup-restore.mjs --pg-dump db.sql --db-url …` (one transaction, `session_replication_role = replica`, every FK re-checked), `backup-storage.mjs restore-storage` (upload + read-back sha256), copies `storage.objects.owner/owner_id` from the snapshot, and finally PATCHes the target's auth config: custom access token hook `pg-functions://postgres/app/custom_access_token_hook`, TOTP enroll/verify, `password_min_length` 10, `jwt_exp` 3600. `site_url`, redirect URLs and SMTP are deliberately left alone.

What `verify` checks (`verify-restore.mjs --db-url` plus extra comparisons): per-table counts and byte-exact rows against the dump; relationships; `contract_versions.content_hash`; `event_financials` for every event (as the restored owner, impersonated in SQL because the owner's password/TOTP are staging's); RLS enabled everywhere; customer A cannot read B's customer row, payments, media or financials; anon sees only published+consented events; the access-token hook puts `app_role` in A's JWT; storage counts and sha256 for every object; every media path resolves; signed URLs (owner-signed when A owns a private object, otherwise a service-signed URL plus "A and B cannot sign" — recorded in `notes`); identical migrations, identical `public` schema dump, identical buckets and object metadata, auth identities/MFA counts, and `private.bootstrap` empty.

### Teardown (destructive, needs explicit user confirmation)

`node $S teardown` prints the steps: pause (Dashboard → Settings → General → Pause project, or `POST /v1/projects/<ref>/pause`) and then delete (Dashboard → Delete project, or `npx supabase projects delete <ref>`). Then delete `web/.env.restore.local`, `web/.cache/cloud-rehearsal/` and `test-users.local.json`, and re-run `cleanup-test-users` to confirm staging has no `[RESTORE-TEST]` users.

### Local simulation (proven 2026-10-16)

Same code path with `--sim`: source = the main local stack (read-only `db dump --db-url`), target = a second stack in `web/.cache/restore-sim` (project `alsultan-restore-sim`, ports 56320-56329/56383, seed off, started **without** migrations so `db push --db-url` is exercised).

```bash
node $S sim-up --sim --apply && node $S backup --sim --apply && node $S restore --sim --apply && node $S verify --sim --apply
node $S sim-down --sim --apply   # stop + remove volumes; then delete web/.cache/restore-sim
```

Result: 11 migrations pushed; auth users 5, identities 5, MFA factors 0; 33/33 public tables match (252 non-seeded rows, e.g. media_assets 208, audit_events 19, events 4); 58 FKs checked, 0 orphans; storage 418/418 objects (3,164,442 bytes) uploaded and sha256-verified; **110/110 checks**. A tamper test (changed a content hash, disabled RLS on `reviews`) produced 4 failures and exit 1. A second restore into the populated sim was refused as non-empty. The CLI link stayed on staging throughout.

### Known limits for the cloud run

- **Free plan upload cap is 50 MB per object** regardless of bucket limits (the migrations set 2 GB for `private-media`/`backups`). `backup` warns and `restore` refuses if any object exceeds it.
- **Egress:** the free plan includes 5 GB egress per month; the dump and the storage copy count against staging's egress, the read-back verification against the target's.
- **Pooler:** direct `db.<ref>.supabase.co` is IPv6-only on free projects; the script uses the session pooler (IPv4). Statement timeouts on the pooler can bite very large loads; current data is tiny.
- **Hosted privileges:** the load runs as `postgres` with `session_replication_role = replica` and inserts into `auth.*`. Both work locally and are what Supabase documents for restores, but they have not yet been exercised on a hosted project. If either is refused, the run stops inside one transaction (nothing half-loaded).
- **Auth versions:** `auth.users` is loaded with an explicit column list; if the target's GoTrue is newer, additive columns are fine; a removed column would fail the load loudly.
- Restored users keep staging's password hashes and TOTP secrets; the owner's MFA keeps working only because the TOTP secret is copied.

## Retention

- Daily platform backups/PITR at the plan's retention.
- Owner JSON runs: keep at least the last 7 completed runs plus one per month for 6 months. Delete older runs from the `backups` bucket manually.
- The operator `pg_dump` + storage copy: weekly and before every migration or release. Keep 4 weekly and 3 monthly copies, encrypted and off-site.
- Run a restore drill (Procedure A against the latest backup) at least once per quarter and after any migration that changes table shapes.
- Access: the `backups` bucket is owner-only (aal2) under migration 0008. The local `.cache/restore-env/` contains real data copies, so never commit it.

## Media and video boundary (for reference)

- Images: originals go to `private-media/events/{event_id}/{folder}/original.{ext}`, uploaded with a signed upload URL. The server generates `thumb.webp` and `display.webp` next to it.
- Publishing an image copies the display and thumb to `public-media`, and only while the event is published with consent. Unpublishing, revoking consent or deleting an event enqueues cleanup in `private.storage_cleanup_queue`.
- Video: only the original is stored, and it is private. Streaming would go through an external provider fed by a short-lived signed URL. No video bytes are ever copied to `public-media`.
