# Security model: Sultan Records rebuild

Owner: Backend & Security. Implements `docs/architecture.md` contract v1. The schema source is `web/supabase/migrations/*`, and `web/supabase/tests/*` (pgTAP) proves the behaviour.

## 1. Roles

| Role | Source | Notes |
|---|---|---|
| `owner` | `profiles.role` | Owns users/roles, settings, backups, payments, expenses. The first owner comes from the one-shot bootstrap. |
| `admin` | `profiles.role` | Runs the business: content, customers, bookings, events, media, quotes, contracts, staff, equipment. Has read-only finance. |
| `staff` | `profiles.role` + `staff_members.profile_id` | Sees only events they are assigned to through `event_staff_assignments`. |
| `customer` | `profiles.role` + `customers.user_id` | Sees only their own records. |
| `anon` | none | Can read published content only. |

Authorization always comes from `public.profiles`, read by SECURITY DEFINER helpers in the unexposed `app` schema. The JWT claim `app_role` is added by `app.custom_access_token_hook` and is only a UI hint. A role change or a disable takes effect on the next query, even if the user still holds an old token.

Helpers (`app` schema, `stable security definer`, `search_path=''`):
- `current_role()` returns NULL when the profile is disabled.
- `is_active()`
- `require_mfa()` returns true when `app_settings.require_staff_mfa` or `profiles.mfa_required` is set.
- `mfa_ok()` returns true when MFA is not required or the JWT `aal = aal2`.
- `is_staff()`, `is_admin()` and `is_owner()` combine the role with `mfa_ok()`.
- `customer_id()` returns NULL when the user is disabled or not a customer.
- `owns_event(id)`, `is_assigned(id)`, `can_work_event(id)` (admin or assigned), `event_is_public(id)`, `path_event_id(storage_name)`.

## 2. Permission matrix (as implemented)

| Table / area | anon | customer | staff (aal2) | admin (aal2) | owner (aal2) |
|---|---|---|---|---|---|
| business_settings, service_categories | R | R | R | R/W | R/W |
| services | R (published) | R (published) | R (published) | R/W | R/W |
| app_settings | none | none | none | none | R/W |
| profiles | none | R own, W own `full_name, phone` | same as customer | R all | R all. Role and disable go through RPCs. |
| customers (`notes` hidden) | none | R/W own contact fields | R customers of assigned events | R/W | R/W/D |
| customer_internal_notes / event_internal_notes (views) | none | none | assigned | all | all |
| booking_requests | none (RPC only) | R own | none | R/W, transitions checked | same |
| booking_stage_history | none | none | none | R | R |
| events | R published+consented, public columns only | R own | R assigned | R/W (publication via RPC) | R/W/D |
| media_assets | R public+ready on public events | R own events (ready) | R/W assigned (private bucket) | R/W/D | R/W/D |
| deliverables, deliverable_revisions | none | R own | R/W assigned | R/W/D | R/W/D |
| video_comments | none | R own events, W own comments | R/W assigned | R/W/D | R/W/D |
| album_selections / items / snapshots | none | R own; draft items W; submit via RPC | R assigned | R, lock | same |
| quotes, quote_items | none | R own non-draft; accept via RPC | none | R/W (items only while draft) | same |
| contracts, contract_versions | none | R own non-draft; approve via RPC | none | R/W, versions insert-only | same |
| payments | none | R own | none | R | R; insert only via `record_payment` |
| expenses | none | none | none | R | R/W/D |
| event_staff_assignments | none | none | R own | R/W/D | R/W/D |
| equipment / equipment_assignments | none | none | R for assigned events | R/W/D | R/W/D |
| equipment_maintenance | none | none | none | R/W/D | R/W/D |
| support_requests / messages | none (RPC only) | R own, W messages | none | R/W | R/W |
| reviews | R approved (no customer_id) | R own + approved, insert pending | R approved | moderate | moderate |
| notifications | none | R own, set `read_at` | same | same | same |
| audit_events | none | none | none | R | R (append-only, written by triggers) |
| backup_runs | none | none | none | none | R/W |

"R/W" means select, insert and update. "D" means delete. Every staff-role privilege also needs `aal2` when MFA is required. Without `aal2`, a staff user only gets public (anon-level) reads.

## 3. RLS approach

1. Migration 0005 revokes **all** table privileges from `anon` and `authenticated` on every public table. The cloud project has auto-expose ON. Default privileges for `postgres` are stripped in 0001.
2. Grants then name exact statements and, where it matters, exact columns:
   - anon can read only the public columns of `events` and `reviews`.
   - `customers.notes`, `events.production_note` and `events.equipment_note` cannot be selected by `authenticated`. Staff read them through the filtered views `customer_internal_notes` and `event_internal_notes`.
   - The publication columns of `events` cannot be updated directly.
   - **Frontend consequence:** `select('*')` on `events` or `customers` fails with 42501. Always list the columns.
3. RLS is enabled on every public table. Policies are written per command and per role, and use the `app.*` helpers.
4. Guard triggers enforce caller-dependent invariants that column grants cannot express:
   - Customers cannot change `user_id`, `role`, `disabled` or `notes`.
   - New rows start in their initial status.
   - System-managed fields are overwritten: totals, `created_by`, `author_id`, `revision_no`, `version_no`, `content_hash`.

   They detect API callers with `current_user in ('anon','authenticated')`. SECURITY DEFINER RPCs run as `postgres` and are trusted.
5. The `private` schema (`rate_limits`, `bootstrap`) has no grants to API roles, and `app` and `private` are not in `[api].schemas`.

## 4. Business invariants (triggers and constraints)

- **Booking state machine:** `new→contacted|declined|cancelled`, `contacted→quoted|declined|cancelled`, `quoted→confirmed|declined|cancelled|contacted`, `confirmed→cancelled`. Any other transition raises 22023. Every change writes `booking_stage_history`, including the note passed to `transition_booking`.
- **Publication:**
  - The CHECK constraint is `is_published ⇒ consent = 'granted'`, with slug required and `featured ⇒ published`.
  - A BEFORE trigger forces unpublished and unfeatured whenever consent is not `granted`, so revoking consent unpublishes immediately.
  - An AFTER trigger flips the event's media to `private`.
  - Public media is only allowed for publishable events.
- **Album:** an item's media must be an `image` of the selection's event (23514). Items are frozen once the selection is not `draft`. Snapshots are immutable.
- **Money:**
  - `quote_items.line_total = round(qty × unit_price)`.
  - `quotes.subtotal = Σ line_total` and `total = subtotal − discount`. Client values are ignored.
  - Amounts can only change while a quote is `draft`.
  - Status `accepted` is reachable only through the customer RPC.
- **Contracts:**
  - On insert of a version, the trigger assigns `version_no`.
  - It sets `content_hash = sha256(body ‖ currency ‖ total ‖ deposit)`.
  - It points `contracts.current_version_id` at the new version.
  - UPDATE and DELETE on versions are blocked for everyone.
  - Approval is RPC-only, for the current version and an exact hash. An approved contract can only be voided.
- **Staff conflict:** the same staff member on two events with the same `event_date` raises 23P01 unless `override_reason` is set.
- **Equipment:** a btree_gist exclusion on `(equipment_id, tstzrange(out_at, coalesce(returned_at,'infinity')))` rejects overlaps.
- **Audit:** `app.audit_trigger` writes `audit_events` for `profiles` (roles, disable, MFA), `payments`, `expenses`, `contracts`, `contract_versions`, `quotes`, `staff_members`, `app_settings`, and the consent/publication changes on `events`. `audit_events` is append-only.

## 5. RPCs

All RPCs are `SECURITY DEFINER`, use `set search_path = ''`, and have EXECUTE revoked from `public` and `anon` (granted as listed).

| Function | Returns | Callable by | Checks |
|---|---|---|---|
| `bootstrap_initial_owner(p_token text)` | void | authenticated | Signed in; row locked; no owner exists; not used; sha256(token) matches `private.bootstrap.token_hash`; token ≥32 chars. Consumes the token and sets `mfa_required`. |
| `admin_set_user_role(p_user_id uuid, p_role app_role)` | void | authenticated → owner only | Not self. |
| `admin_set_user_disabled(p_user_id uuid, p_disabled bool)` | void | authenticated → owner only | Not self. |
| `admin_link_customer_user(p_customer_id uuid, p_user_id uuid)` | void | authenticated → admin | Target must be a customer account. Audited. |
| `public_submit_booking(p_contact_name, p_contact_phone, p_event_type, p_idempotency_key, p_ip_hash, p_contact_email?, p_event_date?, p_city?, p_venue?, p_guests?, p_services?, p_message?, p_customer_id?)` | text (tracking code) | **service_role only** | Idempotency key (replay returns the same code); rate limit 5/h per ip hash and 5/day per phone; phone/date validation. |
| `public_track_booking(p_tracking_code, p_phone_last4, p_ip_hash)` | table(status, event_date, updated_at) | service_role only | Rate limit 20/h; empty result on mismatch. |
| `public_submit_support(p_contact_name, p_contact_phone, p_subject, p_message, p_idempotency_key, p_ip_hash, p_contact_email?)` | text | service_role only | Same pattern as booking. |
| `public_track_support(p_tracking_code, p_phone_last4, p_ip_hash)` | table(status, updated_at) | service_role only | Rate limit. |
| `transition_booking(p_booking_id, p_to booking_status, p_note?)` | void | admin | The state-machine trigger. |
| `set_publication_consent(p_event_id, p_status consent_status)` | void | admin (any status), or the owning customer (`granted`/`revoked`) | Audited. |
| `set_event_publication(p_event_id, p_publish bool, p_featured bool = false, p_featured_order int = null)` | void | admin | Consent `granted` and slug required. |
| `submit_album_selection(p_event_id)` | uuid (snapshot id) | owning customer | Draft and non-empty. Writes an immutable snapshot. |
| `customer_accept_quote(p_quote_id)` | void | owning customer | Status `sent`; not expired (expires it if past `valid_until`). |
| `customer_approve_contract(p_version_id, p_content_hash)` | void | owning customer | Contract `sent`; version is current; hash matches exactly. |
| `customer_request_revision(p_deliverable_id, p_note)` | void | owning customer | Deliverable in `review`. Notifies admins. |
| `record_payment(p_customer_id, p_amount, p_method, p_idempotency_key, p_kind='payment', p_event_id?, p_contract_id?, p_received_at=now(), p_reference?, p_currency='ILS')` | uuid | owner | Amount > 0; event/contract belong to the customer. An exact replay returns the existing id; the same key with a different payload raises 23505. |
| `event_financials(p_event_id)` | table(event_id, currency, contracted, paid, refunded, expenses, balance, quoted, balance_basis) | admin, or owning customer (`expenses` is null for customers) | `balance = basis − paid + refunded`. The basis is the approved contract total if one exists (`balance_basis='contract'`), else the accepted quote total (`'quote'`), else 0 (`'none'`, so a deposit shows as a negative balance, i.e. credit). |
| `admin_financial_summary(p_from date, p_to date)` | table(currency, contracted, paid, refunded, expenses, net_cash, outstanding) | admin/owner | |
| `staff_mfa_required()` | bool | authenticated | Used by `requireAal2ForStaff()`. |

### Server usage of public forms

1. The Next server action validates input with Zod.
2. It verifies Turnstile with `TURNSTILE_SECRET_KEY`, when set.
3. It computes `p_ip_hash = HMAC_SHA256(IP_HASH_SECRET, client_ip)`.
4. It calls the RPC with `createAdminClient()`.

Anon cannot call these RPCs at all, so the Turnstile check cannot be bypassed and the ip hash cannot be spoofed.

## 6. Storage

| Bucket | Public | Limit | MIME | Read | Write |
|---|---|---|---|---|---|
| `public-media` | yes | 50 MiB | jpeg/png/webp/avif, mp4/webm | anyone (CDN) | admin/owner |
| `private-media` | no | 2 GiB (bounded by the global storage limit in config.toml) | images incl. heic, mp4/mov/webm, pdf, zip | admin; staff assigned to the event; customer who owns the event | admin; assigned staff (insert/update); delete admin only |

- Private paths must match `events/{event_id}/...`. `app.path_event_id()` parses the event id, and a malformed path matches no policy.
- `media_assets` has a CHECK that private-media paths start with `events/{event_id}/`.
- Downloads use short-lived signed URLs minted server-side after an RLS-checked query.
- Published copies: `public-media` is a **private** bucket since migration 0010 and is served only through `/m/{assetId}/{variant}` (see section 13).

## 7. MFA and disabled accounts

- `profiles.disabled = true` makes `current_role()` and `customer_id()` return NULL. Every policy then fails closed, effective on the next request. `getSessionProfile()` also returns null.
- MFA:
  - `app_settings.require_staff_mfa` defaults to **true**. The local dev seed turns it off.
  - Promotion to a staff role through `admin_set_user_role` sets `mfa_required`, as does bootstrap.
  - Staff privileges in RLS require `aal2`. The app's `requireAal2ForStaff()` redirects to `/login?step=mfa`.
  - `requireRole()` runs the aal check before the role check. A staff session below aal2 is therefore sent to the MFA step on any staff page, including pages its role cannot open.
  - `/login?step=mfa` enrolls TOTP when the user has no verified factor (QR plus a text secret) and otherwise shows a challenge. Customers and sessions that are already aal2 are redirected to their landing page.
  - Verified end to end in `web/tests/e2e/mfa.spec.ts` (see `docs/verification.md`, S4).
  - TOTP enroll/verify is enabled in `config.toml`. On the cloud project it must also be enabled in Auth settings.

## 8. Bootstrap procedure (initial owner)

1. The operator generates a token of at least 32 random characters offline and keeps it secret.
2. In the SQL editor of the target project, as `postgres`:
   ```sql
   insert into private.bootstrap (id, token_hash)
   values (1, encode(sha256(convert_to('<TOKEN>', 'UTF8')), 'hex'))
   on conflict (id) do update set token_hash = excluded.token_hash, used_at = null;
   ```
3. The future owner signs up and signs in, then calls `rpc('bootstrap_initial_owner', { p_token })`.
4. The token is consumed (`token_hash = 'consumed'`). The function refuses while any owner exists, so it cannot be reused later for self-promotion. More staff are promoted with `admin_set_user_role` by the owner.

## 9. Threats and mitigations

| Threat | Mitigation |
|---|---|
| IDOR across customers | RLS via `customer_id()`/`owns_event()` on every customer-facing table and storage path. Covered by pgTAP. |
| Privilege escalation (role/disabled/ownership edits) | Column grants plus guard triggers. Owner-only RPCs. Bootstrap is one-shot. |
| Stale or forged JWT role claim | Roles are read from `profiles`, not the claim. The JWT signature is verified by PostgREST and `getClaims()`. |
| Compromised staff password | MFA (aal2) is required for staff privileges in RLS. Owner can disable accounts instantly. |
| Publishing without consent | CHECK constraint, trigger, RPC check. Revoking consent unpublishes. |
| Contract tampering / approving the wrong text | Versions are immutable. Approval binds the version id and sha256 hash and only the current version. |
| Double payments | Unique idempotency key. RPC replay semantics. Audited. |
| Client-side total manipulation | Totals computed in triggers. Client values ignored. |
| Form spam / brute-force tracking | Service-role-only RPCs behind Turnstile. Rate limits per ip hash and phone. 10-char random codes (32^10) plus last-4 phone. |
| SQL injection via `search_path` | All definer functions pin `search_path=''` and fully qualify names. Checked by test. |
| Data API exposure of new tables (auto-expose ON) | Explicit REVOKE ALL plus default-privilege revoke. Checked by test (RLS on every table). |
| Audit log tampering | No write grants. UPDATE/DELETE blocked by trigger. |
| Secret leakage | `admin.ts` and `env/server.ts` import `server-only`. Env errors print names only. `.env.example` holds placeholders. |

## 10. Key rotation

- **Publishable/secret API keys:** In the dashboard (Project Settings → API Keys), create a new secret key. Deploy it as `SUPABASE_SECRET_KEY`, then delete the old key. Use the same steps for the publishable key (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, which needs a rebuild). Prefer the new `sb_publishable_`/`sb_secret_` keys over legacy JWT keys, and disable the legacy keys.
- **JWT signing keys:** Under Auth → JWT Signing Keys, add a standby key, rotate, then revoke the previous key after the token lifetime. Sessions refresh automatically.
- **Turnstile secret:** Rotate in Cloudflare and update `TURNSTILE_SECRET_KEY`.
- **`IP_HASH_SECRET`:** Rotating resets rate-limit buckets, which is harmless.
- **Bootstrap token:** Single use and consumed. Re-issuing it only works while no owner exists.
- After any suspected leak, rotate the keys, check `audit_events` for the window, and disable affected accounts with `admin_set_user_disabled`.

## 11. Addendum (migration 0008): backups bucket, cleanup queue, media ids

- **`backups` bucket**:
  - Private, 2 GiB, `application/zip` and `application/json` only.
  - Only the owner (`app.is_owner()`, aal2) can read, write, update or delete.
  - Backup objects go in bucket `backups` at `{run_id}/...`. Writing to `private-media/backups/*` is no longer used.
  - private-media policies now require an `events/{uuid}/...` path for every operation, so any non-event path is unreachable for API roles, admins included.
- **Media id**: `authenticated` may supply `media_assets.id` on insert. Uploaders use the same uuid for the storage folder: `events/{event_id}/{id}/original.*`, `thumb.webp`, `display.webp`. RLS is unchanged: admin, or assigned staff on private-media.
- **Storage cleanup queue** (`private.storage_cleanup_queue`):
  - When an event is unpublished (including through consent revoke), every public-media path of that event is enqueued: the original and every variant.
  - When an event is deleted, every stored path of its media in either bucket is enqueued.
  - The app processes the queue with `claim_storage_cleanup(p_limit int = 100)` (returns id, bucket, path, reason, enqueued_at). It marks rows as claimed; a claim older than 15 min can be claimed again; at most 1000 rows per call; rows locked by another worker are skipped.
  - After removing the objects through the Storage API with the admin client, the app calls `complete_storage_cleanup(p_ids uuid[])`, which returns the count marked done.
  - Both RPCs are admin/owner only (42501 otherwise).
  - Superseded by section 13 (immediate revocation + scheduled worker).

## 12. Addendum (migration 0009)

- Column defaults run as the invoking role. The audit found three that call `app.random_code()`: `quotes.quote_no`, `booking_requests.tracking_code` and `support_requests.tracking_code`. `random_code` is now SECURITY DEFINER with EXECUTE granted to authenticated and service_role; it is harmless and returns random text. Trigger functions are exempt from EXECUTE checks, and the app.* helpers they call as the invoker were already granted.
- `event_financials` adds `quoted` and `balance_basis` (see section 5).

## 13. Consent withdrawal (migration 0010)

**Guarantee.** Withdrawing consent stops public serving in the **same transaction**. No job is involved. The only remaining exposure is caches that already hold a 200 response, for at most **60 seconds**.

**Serving model.**
- The `public-media` bucket is private (`storage.buckets.public = false`).
- Published media URLs are same-origin: `/m/{assetId}/{display|thumb|poster|original}` (`web/src/app/m/[assetId]/[variant]/route.ts`).
- Each request is checked twice with the anonymous publishable key:
  - The `media_public_read` RLS policy returns the row only if `visibility = public`, it is ready, and the event is published with consent granted.
  - The `"public-media read live"` storage policy calls `app.public_object_is_live(name)`, which applies the same condition to the object.
- The route then streams the bytes, with Range support.
- A 200 carries `Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=0, stale-if-error=0`. A 404 carries `Cache-Control: no-store`.
- Media components render with `unoptimized`, so the next/image optimizer cache is not in the path. `images.minimumCacheTTL` is pinned to 60 anyway, and `localPatterns` allows only `/m/**` and `/brand/**`.
- No app code builds `/storage/v1/object/public/` URLs.

**Sequence when the customer withdraws (portal "سحب الموافقة على النشر" → `set_publication_consent(event, 'revoked')`).**
1. The `events_publication` BEFORE trigger sets `is_published = false` and `featured = false`, records `consent_at` and `consent_by`, and sets `consent_revoked_by_customer_at = now()`.
2. The `events_unpublish_media` AFTER trigger:
   - enqueues every public-media path of the event in `private.storage_cleanup_queue`;
   - sets those rows to `visibility = private`;
   - calls `app.invoke_storage_cleanup('unpublished')`, a pg_net request that is sent only after COMMIT.
3. At COMMIT, RLS and the storage policy deny the rows and objects. The next `/m` request returns 404 `no-store`, and `/work/{slug}` returns 404 (proxy slug check).
4. The server action calls `updateTag('projects')` and `updateTag('media')`, so the homepage and `/work` re-render without the project on the next request.
5. Deletion runs separately and correctness does not depend on it. The `storage-cleanup` Edge Function is called right away (best effort) and every minute by pg_cron. It:
   - claims due items;
   - deletes the objects with the service role;
   - calls `complete_storage_cleanup` for successes, which also deletes the now-private public-media rows;
   - calls `fail_storage_cleanup` for failures. Each failure adds 1 to `attempts` and sets a backoff of 30s·2^n, capped at 1h. Items move to dead-letter (`dead_at`) after 5 attempts.
6. The admin overview shows pending and dead counts from `storage_cleanup_pending()`, which is admin-only and read-only.

Admin withdrawals and unpublishes follow steps 2 to 6. The in-app runner (`processStorageCleanup`) uses the same claim, complete and fail contract.

**No republication after a customer withdrawal.** `consent_revoked_by_customer_at` is set only by the owning customer's revoke. While it is set:
- any API caller who is not the owning customer is refused `granted` (42501), whether admin, owner, staff or service role. This is enforced both in `set_publication_consent` and in the trigger;
- publishing is impossible, because it requires granted consent;
- a CHECK constraint forbids `granted` while the flag is set;
- the flag cannot be edited directly.

Only the customer's own grant clears the flag, and `consent_at` and `consent_by` record who granted and when. Admins may still set `requested`.

**Private originals.** Only `public-media` paths are enqueued on unpublish or withdrawal. Private-media originals and variants stay, and the customer can still get signed URLs for them (tested).

**Operator setup (staging/production).** Never put these values in migrations.
1. Deploy the function: `supabase functions deploy storage-cleanup --no-verify-jwt`. The function checks the bearer token itself.
2. Create the Vault secrets in the SQL editor:
   - `select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/storage-cleanup', 'storage_cleanup_url');`
   - `select vault.create_secret('<key>', 'storage_cleanup_key');`
3. Choose `<key>`:
   - the project's legacy service-role JWT, which the function compares to `SUPABASE_SERVICE_ROLE_KEY`;
   - or, preferably, a random secret that you also set with `supabase secrets set STORAGE_CLEANUP_SECRET=<same value>`.
4. Rotate by updating both. pg_cron and pg_net are enabled by the migration, and the job `storage-cleanup` runs every minute.
5. Check that it works:
   - `select * from cron.job_run_details order by start_time desc limit 5;`
   - `select * from net._http_response order by id desc limit 5;`
   - `select * from public.storage_cleanup_pending();` (run it as an admin)

Locally, `seed.sql` creates both secrets with the well-known `supabase start` demo service-role JWT and `http://kong:8000/...`. The local edge runtime must serve the function: `npx supabase functions serve` (`supabase start` alone does not mount new functions).

**Known limits.**
- A CDN or browser that cached a 200 can serve it for up to 60 s. To get a 0 s window, purge the CDN by URL prefix `/m/{assetId}/` on withdrawal, or lower `MAX_AGE` in the route.
- Re-publishing an image before the worker deleted its old copy cancels the pending deletion of those paths (`media_cancel_pending_cleanup` trigger). The worker can still delete the new copy in the moment between the storage copy and the row insert. If that happens, the image returns 404 and the admin re-publishes it.

## 13. Addendum (migration 0011): user deletion vs immutable rows

- `album_selection_snapshots.submitted_by` and `contract_versions.created_by` use `ON DELETE SET NULL` to `profiles`. Their immutability guard is now `app.block_mutation_except_null_fk(<col>)`. The only update it allows is that column changing to NULL with every other column unchanged, and only for non-API callers (the FK cascade). Every other UPDATE and every DELETE is still rejected.
- The `updated_at` triggers were dropped on these tables and on `audit_events`, so that cascade update touches nothing else.
- Effect: deleting an account removes the link to the deleted person, but content, hashes, items and totals stay as they were. `audit_events.actor` has no FK and keeps the historical uuid.
- Audit result: no other immutable table has this conflict. `payments`, `booking_stage_history`, `expenses`, `quotes` and `contracts` are not immutable, and their SET NULL cascades are allowed. Payments, quotes and contracts write an audit row for the change.
- Tested in `tests/60_user_deletion.sql`.
