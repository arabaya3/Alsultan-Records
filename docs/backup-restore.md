# Backup and restore

Owner: Administration. Code: `web/src/features/backups/*`, UI at `/admin/backups` (owner only).

## What a backup run produces

When the owner clicks **بدء النسخ الآن**, the server action `runBackup` does the following:

1. It re-checks the owner role (`requireRole('owner')` plus aal2 when MFA is required).
2. It inserts a `backup_runs` row with `status = 'running'` through the owner's own client, so RLS attributes the row to the owner.
3. It exports each of the 33 `public` tables page by page, 1,000 rows per `range()` call ordered by `id`, until a short page comes back. It reads with the secret-key client because RLS hides some data even from the owner (`customers.notes`, `events.production_note`/`equipment_note`, other users' `notifications`). This use of the secret key is documented in `actions.ts` and happens only after the owner check.
4. It writes `private-media/backups/{run_id}/tables/{table}.zip`. Each archive is a standard ZIP that holds `{table}.json` = `{ table, exported_at, count, rows }`. The files are ZIP because the `private-media` bucket's MIME allow-list only accepts `application/zip` among non-media types.
5. It lists every object in `public-media` and `private-media` (recursively, skipping `backups/`) into `private-media/backups/{run_id}/storage-manifest.zip`. Each entry records `bucket, path, size, mimetype, updated_at`. **The binaries themselves are not copied**, so storage needs its own backup (see below).
6. It updates the run with these fields:
   - `table_counts` (rows per table)
   - `object_counts` (objects per bucket)
   - `errors` (per table or manifest)
   - `location`
   - `finished_at`
   - `status`, which is `completed` only if every table **and** the manifest succeeded. It is `partial` if at least one table succeeded and something failed, and `failed` otherwise.

Not included:
- `auth.*` (users, identities, MFA factors), `storage.*` metadata, and `private.*` (rate limits, bootstrap token).
- `auth.users` is covered by the platform's own database backups (see "Full-database backups").

## Storage binaries (separate coverage)

The manifest lists every object a full restore needs. Copy the binaries with the S3-compatible endpoint, for example from a trusted operator machine:

```bash
# Local stack: STORAGE_S3_URL and keys from `npx supabase status`. Cloud: Project Settings → Storage → S3.
aws s3 sync s3://private-media ./storage/private-media --endpoint-url "$STORAGE_S3_URL" --exclude "backups/*"
aws s3 sync s3://public-media  ./storage/public-media  --endpoint-url "$STORAGE_S3_URL"
```

Compare the result against `storage-manifest.json`. The counts must match `backup_runs.object_counts`.

## Full-database backups (recommended alongside)

- **Cloud project (`dyuixzxmmeiypvawzmty`):** daily backups are included with the plan. Enable PITR if available. These cover `auth` and `storage` schemas too.
- **Manual:** run `npx supabase db dump --linked -f schema.sql` and `npx supabase db dump --linked --data-only -f data.sql`, then store them encrypted off-site.

## Restore procedure (table-level JSON backup)

> Restore into a **fresh** project or a staging copy first. Never restore over production without a dump of its current state.

1. **Schema.** Apply the migrations: `npx supabase db push` (cloud) or `npx supabase db reset` without seed (local). The migrations are the only source of schema.
2. **Download the run.** Fetch `private-media/backups/{run_id}/tables/*.zip` and unzip. Each file gives `{table}.json`.
3. **Auth users first.** `profiles.id` references `auth.users.id`. Restore `auth.users`/`auth.identities` from a platform backup or `db dump`, or re-invite users so the ids exist. Skip `profiles` rows whose user is gone.
4. **Load data as `postgres` (SQL editor or psql), not through the API.** Guard triggers treat API roles specially, and several columns cannot be written through the API. Inside one transaction:
   ```sql
   begin;
   set session_replication_role = replica;  -- skip triggers (audit, guards, numbering, hashing) so stored values are kept verbatim
   -- for each table, in the order listed in BACKUP_TABLES (parents first):
   insert into public.<table> select * from jsonb_populate_recordset(null::public.<table>, '<rows json>'::jsonb)
     on conflict (id) do update set <cols> = excluded.<cols>;  -- or truncate first on an empty project
   set session_replication_role = origin;
   commit;
   ```
   Notes on the load:
   - The singletons `business_settings` and `app_settings` already exist from the migration. Use `on conflict (id) do update`.
   - `contracts.current_version_id`/`approved_version_id` reference `contract_versions`, which references `contracts`. With replicas mode, foreign keys are still checked, so insert `contracts` with those two columns null, then `contract_versions`, then update the two columns.
   - `contract_versions.content_hash` is restored verbatim. Do not recompute it, because customers approved those exact hashes.
   - `audit_events` and `album_selection_snapshots` are immutable by trigger. Load them only in replica mode.
5. **Storage.** Upload the synced binaries back to the same bucket and path (`aws s3 sync ./storage/private-media s3://private-media ...`). Every `media_assets.path` and `variants.*` must resolve.
6. **Verify.**
   - Row counts per table must equal `backup_runs.table_counts` for the run.
   - Object counts must equal `object_counts`.
   - Check that the public `/work` lists only consented, published events.
   - Sign in as owner, admin, staff and customer, then spot-check one event's gallery and one contract version.
7. **Post-restore.**
   - Rotate keys if the restore followed an incident (see `security-model.md` §10).
   - Re-enable `require_staff_mfa` if a dev dump was used.

## Retention and access

- Backups live under `private-media/backups/`, which has no public URL. Today, **admins (not only the owner) can read `private-media/*`** under the storage policy. A dedicated owner-only bucket is requested from the lead (see the admin report).
- Delete old runs manually from storage. Keep at least the last 7 completed runs.

## Media and video boundary (for reference)

- Images: originals go to `private-media/events/{event_id}/{folder}/original.{ext}`, uploaded straight from the browser with a signed upload URL. The server then generates `thumb.webp` (about 480 px) and `display.webp` (about 1,600 px) next to it with sharp.
- Publishing an image copies the display and thumb into `public-media`, and only while the event is published with consent. Unpublishing, revoking consent, or deleting the event removes the public copies (the app does this; the database only flips visibility).
- Video: only the original is stored, private. Public or streamed playback is out of scope here. The integration point is an external provider (for example Mux or Cloudflare Stream). It would be fed from a short-lived signed URL of the original, with the provider's asset/playback id stored in `media_assets.variants.stream` by a future migration or server route. No video bytes are ever copied to `public-media`.
