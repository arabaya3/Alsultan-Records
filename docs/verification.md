# Verification (independent QA)

Date: 2026-10-16. Local stack only (Supabase in Docker, `127.0.0.1:54321`). Main pass against the **production build** (`npm run build && npx next start -p 3400`).

Setup used for every run: `npx supabase db reset && npm run seed:storage` (output: `208 media rows, 418 objects uploaded, 0 failed`).

Re-run:
```
cd web
npx supabase db reset && npm run seed:storage
npm run build && npx next start -p 3400        # separate shell
npx playwright test tests/e2e/qa-              # QA suite (chromium + mobile project)
npx supabase db reset && npm run seed:storage
npx playwright test tests/e2e/admin.spec.ts tests/e2e/portal.spec.ts tests/e2e/public.spec.ts --project=chromium
```
The QA suite and the older specs both mutate seed data (selection submit, contract approval), so run each on a fresh reset.

## Q1: build, lint, types, pgTAP
| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, no output |
| `npm run lint` | exit 0, no findings |
| `npm run build` | exit 0. Only warning: Next ignored a stray `C:\Users\UnclePC\package-lock.json` outside the repo (set `outputFileTracingRoot`) |
| `npx supabase test db` right after reset | **PASS**: 3 files, 92 tests |
| `npx supabase test db` after `seed:storage` | **FAIL** 1/74: `10_rls_and_rpcs.sql` test 10 "A reads own storage objects" has 403, wants 1. This is a fixture flaw: the test counts *all* objects under A's event and assumes it inserted the only one. It isn't a security failure, but the test should count its own object only. Not fixed (outside QA ownership). |

## Q2: secrets scan of the build output
I grepped `.next/static/**` and `.next/server/app/**/*.html|*.rsc` (57 HTML files):

| Pattern | static | html/rsc |
|---|---|---|
| `SUPABASE_SECRET_KEY` value (41 chars) | 0 | 0 |
| `IP_HASH_SECRET` value (64 chars) | 0 | 0 |
| `service_role` | 0 | 0 |
| env var names `SUPABASE_SECRET_KEY` / `IP_HASH_SECRET` | 0 | 0 |
| `sb_secret_` | 1 | 0 |

The one `sb_secret_` hit is supabase-js's key-prefix check (`e.startsWith("sb_publishable_")||e.startsWith("sb_secret_")`) in `chunks/0rbnq33bprnuu.js`. It isn't a key. **PASS.**

## Results by matrix ID
Spec files are in `web/tests/e2e/`. Final QA run: **44 passed, 1 failed** (the failure is the A4 quote-creation bug below). Older specs on a fresh reset against the prod build: **31/31 passed**.

| ID | Verdict | Evidence |
|---|---|---|
| P1 | PASS (layout) / visual mismatches | `qa-responsive`: home has 0px overflow at 320/360/390/430/768/1024/1440. Screenshots in `docs/screenshots/qa-home-*.png`. Reference comparison below. |
| P2 | PASS | `qa-journeys` P2: `/work` lists only `/work/dev-sample-published-project`. No other customer titles, phone numbers, emails or `customer_id` in the HTML. Anon REST `events` returns only that slug, and anon cannot select `customer_id` (`qa-security` S6). |
| P3 | PASS with a note | Unknown service and project slugs render the 404 UI with `noindex`, but return **HTTP 200** (streamed PPR route). A truly unknown path returns 404. Soft 404, minor. |
| P4 | PASS | Two steps. Success shows the tracking code and the "not a confirmed booking" copy. Two synchronous clicks on submit gave exactly **1** `booking_requests` row (DB check). A forced server-side error (per-phone rate limit) kept all 7 inputs. Can be completed keyboard-only. Turnstile is not configured locally, so it was not verified. |
| P5 | PASS | Right code + last4 shows the status only (no name or phone). Wrong last4 shows a generic message. Rate limit exists in the RPC (20/h); I did not drive it to the limit. |
| P6 | PASS | All public pages return 200 with `lang="ar" dir="rtl"`. Every form control on /book, /track, /contact and /login has a label. **A11y:** axe (WCAG 2.0/2.1 A+AA, 2.2 AA) found 0 violations at any impact on 24 public scans (12 screens × 1440/390, including book step 2, book errors and track not-found). Keyboard-only booking, skip link, error focus, bidi and 200% zoom all pass. See "A11y (release blocker)". |
| P7 | PASS | robots has `Disallow: /admin /portal /auth /login /api /track` and `Sitemap: http://localhost:3100/sitemap.xml`. Every sitemap `<loc>` starts with `NEXT_PUBLIC_SITE_URL` (it includes the published project, no private routes). Canonical = SITE_URL + path on /, /work, /book and the project page. No emails, phones, keys or other customers' data in `<head>`. |
| M1 | PASS with a note | With reduced motion there are no inline transform/opacity/clip styles on /, /work or the project page, before or after scroll. With normal motion, h1 is fully opaque by about 1.17 s after `goto` (the first entrance animation is not blocking). Styles are stable once idle, and no inline motion styles linger after client navigation. Video: `docs/motion/home-motion.webm`. **Note:** about 65 rAF calls/s continue while idle on every public page, in both motion modes. This is ScrollTrigger's internal loop (`function t(){return i2&&requestAnimationFrame(t)}`), started because `gsap.ts` registers the plugin when the module loads. `/login` (no GSAP) has 0. GSAP is bundled, so `gsap.globalTimeline` is not reachable from the page. There are no `<video>` elements on the prod home (no media), so the "offscreen video paused" check was vacuous. |
| S1 | PASS (pgTAP) | 92/92 on a fresh reset (see Q1 caveat). |
| S2 | PASS | `qa-security`, direct API with A's session: no B rows in events, media_assets, album_selections, quotes, quote_items, contracts or payments. Positive controls pass. Writes to B's quote or selection are refused, `customer_accept_quote(B)` errors, and `event_financials(B event)` returns 42501. |
| S3 | PASS | A cannot update `role` or `disabled`, call `admin_set_user_role`, or relink `customers.user_id`. The DB is unchanged afterwards. `full_name` update works. |
| S4 | PASS (2026-10-16) | Enrollment, challenge, wrong code, logout, aal1 vs aal2 direct API, customer not forced, disabled account. See "S4: MFA" below. |
| S5 | PASS | A cannot download, list or sign B's object. B can (control). Anon cannot download, and the public URL of the private bucket returns ≥400. A signed URL with a 2 s TTL returned 200 at first and ≥400 after 4 s. |
| S6 | PASS | `set_event_publication` without consent errors. A direct `is_published` update errors, and the DB is unchanged. |
| S6 consent withdrawal (2026-10-16) | PASS | Release blocker closed (migration 0010, `/m` route, `storage-cleanup` function). See "S6: consent withdrawal" below. |
| S7 | NOT VERIFIED directly | Covered only by pgTAP. |
| C1 | PASS (+ a11y) | **A11y:** axe found 0 violations on 7 portal scans (home, event, gallery with the lightbox open, selection review, video, contracts, payments). Keyboard login, the lightbox (RTL arrows, trap, Esc and focus return) and keyboard selection submit all pass. Clearing cookies leads to `/login?next=/portal/events/…/files`. Logout removes all `sb-*` cookies, and back+reload stays on /login. A garbage cookie redirects to login. With `expires_at` set to the past and a valid refresh token, the session is refreshed: portal renders and the access token changes. |
| C2 | PASS | `portal.spec` (2 own event cards, B's event shows not-found). |
| C3 | PASS | All 200 tiles load. Every `<img>` has `complete && naturalWidth>0`, and every `currentSrc` is a signed `thumb.webp`. Lightbox keyboard nav and Esc focus restore work. Screenshot `qa-portal-gallery-1440.png`. |
| C4 | PASS | 3 picks on A1 and 2 on A2 (DB counts). Submitting A1 leaves A2 as draft. The snapshot has `item_count=3`. Customer update/delete of the snapshot changes nothing, inserting an item into the submitted selection errors, and an admin update of the snapshot changes nothing. |
| C5 | PASS | The real test video loads (duration >1 s), plays (currentTime >0.2) and seeks to 2.5 s. The comment saved with `timecode_ms=2500` on **revision 2**. Switching 13 times rapidly, then 3 times under 800 ms latency, always ends showing only the final revision's comments. |
| C6 | PARTIAL | Signed URL expiry was proven at the API level. I did not verify the UI renewing URLs. |
| C7 | PASS | Quote accepted (DB `accepted`). Contract approved through the UI, and `approved_version_id` equals the current version. A tampered hash, B approving A's contract, an old version, and a mismatched hash are all rejected. The portal totals equal `event_financials` exactly (formatted ar-PS). |
| A1 | PASS | Overview at 7 widths, 0 overflow. Older admin spec passes. **A11y:** axe found 0 violations on 10 admin scans (overview, customers, booking, event, event media, users, settings, the open confirm dialog, finance with a payment error, and 390 with the nav open). The confirm dialog is modal and labelled, Esc and "تراجع" return focus to the trigger, and the skip link works. |
| A2 | PASS (older spec) | Invalid booking transition is rejected. |
| A3 | PASS (older spec) | Upload creates variants, and publish is blocked without consent. |
| A4 | **FAIL** | **Admins cannot create quotes** (see Bug 1). Contract versioning passes: a new version moves the contract to draft, the customer can't approve while it's draft, the admin resends v2, approving v1 or a mismatched hash is rejected, v2 is approved and the admin page shows "النسخة 2". Versions can't be updated or deleted. |
| A5 | PARTIAL | Only console-clean checks on /admin/production. |
| A6 | PASS | A ₪1,000 refund recorded through the owner UI: `refunded +100000`, `paid` unchanged, `balance +100000`, summary `net_cash −100000`, and the portal shows the same totals. Staff get an error on `admin_financial_summary` and see no payments. Admin gets an error on `record_payment`. Idempotent payment is covered by the older spec. |
| A7 | NOT VERIFIED | |
| A8 | PASS | Staff are denied 8 admin URLs and allowed 4. Admin is denied /users and /backups. Owner is allowed all. A customer gets nothing on /admin/finance. Staff see A1 and none of B's events. |
| B1 | PASS (local) / PENDING (cloud) | Admin cannot download, list or sign in the `backups` bucket; owner can. Backup recovery is proven into an isolated local stack: the in-app run passes 92/92 checks and the pg_dump + storage snapshot passes 101/101 (see "B1: backup recovery" below). Cloud restore has not been run yet because there is no staging access. |
| Q1 | PASS | See above. |
| Q2 | PASS | See above. |

## S6: consent withdrawal (2026-10-16, local, production build on :3500)

Setup: `npx supabase db reset && npm run seed:storage`, `npx supabase functions serve` (edge runtime serves `storage-cleanup`), `npm run build && npx next start -p 3500`.

| Command | Result |
|---|---|
| `npx supabase test db` | **126/126 PASS**, 5 files. The new `40_consent_revocation.sql` has 26 tests: anon objects drop to 0 in the same transaction as the withdrawal; admin and owner cannot re-grant or publish (42501); only the customer can re-grant; 2 queue rows are created; private originals and variants are untouched; the service role claims work; items dead-letter after 5 failures; the cron job is scheduled. |
| `BASE_URL=http://localhost:3500 npx playwright test tests/e2e/consent-revocation.spec.ts` | **6/6 PASS** |
| same + `admin.spec.ts qa-security.spec.ts qa-journeys.spec.ts public.spec.ts` (one run, fresh reset) | **46/46 PASS** (3.2m) |
| `npx tsc --noEmit` / `npm run lint` / `npm run build` | clean / clean / OK (`ƒ /m/[assetId]/[variant]`) |
| `grep -rn "storage/v1/object/public\|getPublicUrl" web/src` | only a stale snippet in `components/layout/security-headers.md` (doc, not code) |

What the spec proves:
- Before: `GET /m/{id}/display` returns 200 `image/webp` with `Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=0, stale-if-error=0`, and the homepage links the project and its `/m` URL.
- The customer clicks "سحب الموافقة على النشر" in the portal. The **same URL** returns **404 with `no-store`** on the next request, and so does a cache-busted copy (`?cb=`, `Cache-Control: no-cache`). The thumb also returns 404. `/work/{slug}` returns 404, and neither `/` nor `/work` lists the project.
- The old direct URL `/storage/v1/object/public/public-media/...` fails, and an anon `storage.download` fails.
- Admin `set_publication_consent(granted)` and `set_event_publication(true)` both fail with 42501.
- `app.invoke_storage_cleanup()` triggers pg_net, which calls the Edge Function. The queue rows are done, both objects are gone and the stale row is removed. In this run, the immediate kick from the withdrawal trigger had already deleted the objects: the edge log shows `{"claimed":2,"completed":2}`.
- Forced failure: a queue row was pointed at the bucket `public-media-wrong`. Result: `attempts=1`, `last_error` "invalid bucket…", `next_attempt_at` in the future, and the object still present. After the bucket was fixed and the backoff elapsed, the next run marked it done and the object was gone.
- The private original, display and thumb still exist. Customer A's signed URL for the original returns 200. The customer re-grants in the portal, and the admin can publish again.

CDN note: a shared cache that already holds a 200 for a `/m` URL may serve it for up to **60 s** after withdrawal. The origin returns 404 from the first request after the commit, and `no-store` means the 404 itself is never cached as a 200.

## B1: backup recovery (2026-10-16, local)

Procedure: `docs/backup-restore.md`. Machine report: `docs/restore-report.json`.

The isolated stack was `web/.cache/restore-env`, with `project_id` `alsultan-restore` on ports 5532x and seed disabled. It ran next to the main stack, which was never stopped or reset by this work. It was torn down afterwards with `npx supabase stop --workdir .cache/restore-env --no-backup`, and main kept running.

**Unit tests (failure honesty).** `npx vitest run src/features/backups` passes 6/6:
- All tables succeed: `completed`.
- An unknown table is injected: `partial`, with `errors=[table:no_such_table_for_test]`.
- Only unknown tables: `failed`.
- The manifest fails: `partial`.
- Uploads fail: `failed`.

`tsc --noEmit` and eslint are clean.

**Proof A: in-app JSON run.**
- The run used the app's own code path (`runBackupCore`) as the owner: `node --experimental-strip-types scripts/backup-run.mjs`. Run `5bb78afd-6bbf-417c-afde-8bdcc5cb3178` finished `completed` with 33/33 tables and 34 archives downloaded.
- auth was taken with `pg_dump` from the source container (read-only): 5 users and 5 identities.
- Restore: `backup-restore.mjs --auth-sql`.
  - The **first attempt exited 1**, as designed. Profile `4e46c53d…` ("MFA QA", created and deleted by a QA spec) was in the export, but its user was already gone 11 s later when the auth dump ran.
  - The rerun with `--skip-orphan-profiles` passed. It dropped that profile and set its 1 `customers` row's `user_id` and `created_by` to null, which replays the FK `ON DELETE SET NULL`. Both actions are recorded.
  - Result: 33/33 counts and 58 FKs checked, with 0 orphans.
- `verify-restore.mjs`: **92/92 passed**.
  - Restored rows include 211 media, 5 album selection items, 2 payments and 34 audit events.
  - Every row is deep-equal to the backup, except the explained customers row.
  - The contract hash is intact.
  - `event_financials` equals the backup-derived totals for all 4 events.
  - Restored passwords work.
  - RLS checks: A cannot read B's customer row, payments, private media or financials, and anon sees exactly the 1 published+consented event.
- Storage for this run was **not** verified. Another agent reset and reseeded the main stack between the run and the storage copy. Only 16 of the run's 425 manifest paths still existed, and the run's archives in `backups` were wiped too.

**Proof B: single `pg_dump` (public + auth) and storage copy taken back to back.**
- The first restore **failed loudly** because of schema drift. Main had gained migration `20261016000010_consent_withdrawal` after the isolated stack was created (`column "consent_revoked_by_customer_at" … does not exist`). The restore script now refuses a target whose `schema_migrations` differ from the backup's `schema-migrations.txt`.
- After syncing the migrations and running `db reset` on the isolated stack only:
  - The restore matched 33/33 tables, with 5 auth users and 0 orphaned FKs.
  - `restore-storage` uploaded 418/418 objects (3,163,266 bytes) and checksum-verified 418/418.
- `verify-restore.mjs`: **101/101 passed**.
  - Every row is byte-identical to the dump's COPY text.
  - 418 objects in private-media (0 in public-media and backups), sha256 match 418/418, and every ready media path/variant resolves.
  - Customer A's signed URL for `events/…e1/…/display.jpg` returns 200 with a matching hash. Customer B cannot sign it, and the public URL is refused.
  - RLS, financials and auth checks are as in proof A.

**Negative control.** In the restored DB, one `content_hash` was tampered, one payment deleted and RLS disabled on `reviews`. `verify-restore` then reported 86/92 with 6 FAILs and exited 1.

Not proven:
- Cloud/staging restore.
- A storage restore that matches the same in-app run (proof A); only B covers storage.
- `public-media` objects: the snapshot had 0, so the anon public-media check passed with no rows.
- Restoring MFA factors: the source had 0.

## Console, CSP, failed requests
`qa-console` covers 12 public pages, 9 portal pages, 17 owner admin pages and 4 staff pages: **0** console errors, CSP violations, failed requests or 5xx responses. One environment artifact is excluded explicitly: the prod CSP's `upgrade-insecure-requests` upgrades the prefetch redirect of the header's `/portal` link (307 to `/login`) to `https://localhost:3400`, which gives `ERR_SSL_PROTOCOL_ERROR`. This only happens when serving the prod build over plain http and cannot occur on https. The server log also prints supabase-ssr's `getSession()` insecurity warning repeatedly. No direct `getSession()` call exists in `src/`; the warning appears to come from library internals.

## Accessibility
`@axe-core/playwright` is not installed, and QA may not run `npm install`. So I wrote checks for labels, visible focus, keyboard-only booking, focus trap/restore (mobile menu and lightbox) and a WCAG contrast estimator for text on solid backgrounds (text over images or gradients is skipped). All passed. A full axe run is still outstanding.

Observations:
- The gold focus ring `rgb(233,185,73)` on cream fields probably falls below 3:1 non-text contrast. I did not measure it formally.
- After "التالي", focus is not moved into step 2. Keyboard users must Tab from wherever focus was left.

## A11y (release blocker)
2026-10-16, local, production build on :3900, `@axe-core/playwright` 4.14.0. Details, the fix list and the human follow-up are in `docs/a11y/notes.md`. Raw results are in `docs/a11y/axe-results.json`.

| Spec | Result |
|---|---|
| `a11y-axe.spec.ts` (41 scans: public 24, portal 7, admin 10) | **4/4 passed.** Before fixes: serious `color-contrast` ×8 nodes (home step numbers 2.04:1, at 1440 and 390), serious `scrollable-region-focusable` ×1 (admin tables), serious `aria-prohibited-attr` ×1 (lightbox loading div), critical `label` ×1 (selection note textarea), and serious `label-content-name-mismatch` ×1 (introduced and fixed during the pass). After fixes: **0 critical / 0 serious / 0 moderate / 0 minor**. |
| `a11y-manual.spec.ts` | **10/10 passed**: lang/dir, skip link (public/portal/admin), keyboard booking with focus visible on every stop, server-error focus to the first invalid field with aria-invalid + describedby, track/login/payment errors announced, the portal lightbox and selection by keyboard, the admin confirm dialog (modal, labelled, trapped, Esc/تراجع restore focus), the public mobile-menu dialog, RTL icons and bidi isolation, 200% zoom on / and /book, and reduced motion with no transform animations. |

Full regression after the a11y fixes (production build on :3900; `db reset` + `seed:storage` before each group):
| Group | Result |
|---|---|
| 1: `qa-*.spec.ts` (chromium + mobile) | 45 passed, 0 failed |
| 2: `public` + `portal` + `admin` | 31 passed, 0 failed |
| 3: `a11y-axe` + `a11y-manual` + `consent-revocation` (with `supabase functions serve`) + `empty-states` (non-empty mode only; the stub-Supabase build was not made) + `mfa` | 29 passed, 3 skipped (the empty-states stub mode), 0 failed |
| `npx supabase test db` (fresh reset, and again after `seed:storage`) | PASS, 6 files, 139 tests, both times. On a DB already mutated by the e2e suites it fails (`album_selections_event_id_key` duplicate in `10_*` and `60_*` fixtures): an order dependency in the fixtures, not an app defect |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errors, 1 warning (`scripts/check-bundle-secrets.mjs:28`, existing) |
| `npx vitest run src` | 1 file, 6 tests passed. A bare `npx vitest run` also collects the 15 Playwright specs, which fail under vitest; there is no vitest config to exclude `tests/e2e` |

App fixes are listed in `docs/a11y/notes.md` ("Fixes made"). **No screen reader was run.** NVDA and VoiceOver passes are still needed (list in the notes).

## Visual comparison: `qa-home-1440.png` vs `design/approved-reference.png`
1. No hero photograph (flat black panel). Production hides placeholder media by design, so the page cannot match until real media is published.
2. Selected works shows one tile in the right half with the left half empty. The reference has a full-width row of two equal tiles.
3. The project tile has no image and no gold play badge next to its title.
4. The tile title renders as `Sample published project [DEV]`: the LTR seed text is not bidi-isolated (needs `dir="auto"`/`<bdi>`).
5. The hero is shorter relative to the reference, and the title is a little smaller relative to the viewport.

The header, nav, CTA styles, hero copy and service chips match.

## S4: MFA (2026-10-16, local, production build on :3600)

`web/tests/e2e/mfa.spec.ts`: **5/5 passed** (`BASE_URL=http://localhost:3600 npx playwright test tests/e2e/mfa.spec.ts --project=chromium`). The TOTP codes come from `web/tests/e2e/totp.ts`, an RFC 6238 implementation built on `node:crypto` that reproduces the RFC test vector (T=59 s gives `94287082`). The spec creates a new admin user through the auth admin API and sets `profiles.mfa_required = true` (as postgres). It deletes the user at the end.

| Check | Result |
|---|---|
| Enrollment | Password login sends the user to `/login?step=mfa` with an aal1 cookie JWT. "إعداد تطبيق المصادقة" shows the QR code and the base32 secret as text. The test reads the secret and enters a computed code, and the user lands on `/admin` with JWT `aal=aal2`. |
| Next login | The user gets a challenge, not a second enrollment (no setup button, no secret shown). A wrong code shows `الرمز غير صحيح أو انتهت صلاحيته.`, keeps `step=mfa`, and the JWT stays aal1. The correct code goes to `/admin`, and `/admin/finance` opens. An aal2 session that opens `/login?step=mfa` is sent on to `/admin`. |
| aal1 pages | With aal1, `/admin`, `/admin/finance`, `/admin/bookings`, `/admin/users` and `/admin/settings` all redirect to the MFA step. |
| Logout | The sidebar's "تسجيل الخروج" leaves no `sb-*` cookies. Back, or a direct `/admin/finance`, lands on the password login. |
| Direct API at aal1 (password only, factor enrolled) | `staff_mfa_required()` returns true. `events` returns only the anon-visible rows, and `booking_requests` returns 0 rows. `admin_financial_summary` fails with 42501. `createSignedUrl` on a private-media object fails. An `app_settings` update changes 0 rows. |
| Direct API at aal2 | The same calls succeed: more events than anon sees, bookings > 0, the financial summary, and a signed URL. |
| Customer | Customer A logs in with aal1 and lands on `/portal`. `/login?step=mfa` redirects to `/portal`, so a customer is never forced into MFA. |
| Disabled | The spec sets `disabled = true` while the user holds an aal2 API token and an aal2 browser session. The API then returns only anon events, 0 bookings, financial 42501 and no signed URL. `/admin/finance` bounces to `/login`. |

Bugs fixed:
- `web/src/lib/permissions/index.ts` (`requireRole`): the role check ran before the aal check. An aal1 admin who opened an owner-only page (for example `/admin/users`) got "forbidden" instead of the MFA step. The aal check now runs first, for every staff session. No data leaked, because RLS already denied it.
- `web/src/app/(auth)/login/page.tsx`: `/login?step=mfa` showed the MFA form to customers and to sessions that were already aal2. Both are now redirected to their landing page.

No DB policy bug was found, so there is no new migration.

Leftovers, now covered by `mfa.spec.ts` tests 6 and 7 (2026-10-16, :3900). The global flag is set to `true` as postgres and restored to `false` in afterAll; it read `f` after the run. A new `staff`-role user is created through the auth admin API with a `staff_members` row assigned to B1:
- aal1: `/admin`, `/admin/events/B1` and `/admin/production` all redirect to `step=mfa`. Through the API: `staff_mfa_required()` = true. No events beyond anon's, 0 `event_staff_assignments`, 0 B1 media, 0 deliverables. Insert of a deliverable on B1 gives **42501**. `media_assets` and `events` updates on B1 change 0 rows (re-checked in the DB as postgres).
- After TOTP enrollment at aal2: the visible private events are exactly `[B1]`, and assignments are B1 only. A1 media is 0 and B1 media is >0. `admin_financial_summary` gives 42501, payments 0 rows, and `profiles` only the user's own row. The UI `/admin/finance` and `/admin/users` show `forbidden`. Positive control: the same deliverable insert on B1 now succeeds, while one on A1 is rejected. The user, staff row, assignment and test deliverable are deleted afterwards.
- Server actions were still not POSTed directly. Writes were proven at the RLS layer instead.

Previously not proven (kept for history):
- The `app_settings.require_staff_mfa = true` path was not exercised end to end. Other suites share the DB, so the spec uses the per-profile flag (`mfa_required`) instead. `app.require_mfa()` ORs the two flags.
- No assigned-staff (role `staff`) user was tested. The spec only uses admin.
- Server actions were not called directly at aal1. They use the same `guard()`/`requireRole()`, and RLS denies the data.
- `admin.spec.ts` and `portal.spec.ts` were run on a DB that other agents and earlier runs had already changed: 11/12 passed together, and the one failure (admin "publish is blocked") passed alone. On reruns, portal "selection … submit" failed because A1's selection was already submitted by an earlier run in the same DB. Both depend on DB state and don't use MFA, since the seed keeps MFA off.

## Bugs
| # | Severity | Issue | Repro | Status |
|---|---|---|---|---|
| 1 | **Major** | `quotes.quote_no` defaults to `'Q-' \|\| app.random_code(8)`, but EXECUTE on `app.random_code` is granted to neither `authenticated` nor `service_role`. **Every quote insert through the API fails with 42501**, including `/admin/quotes/new` (`features/quotes/actions.ts:20` uses the user client). Contract-from-quote depends on it. | `qa-admin.spec.ts` "A4: admin can create a quote" | Not fixed. Needs a migration: `grant execute on function app.random_code(int) to authenticated, service_role;` (or a definer wrapper). |
| 2 | Minor | Before a contract is approved, `event_financials.contracted=0`, so the portal shows a **negative remaining balance** (−₪3,000) after the deposit. | Fresh seed, portal → payments | Not fixed (semantics) |
| 3 | Minor | Unknown `/work/[slug]` and `/services/[slug]` return HTTP 200 (soft 404, noindex present). | `curl -o /dev/null -w %{http_code} :3400/work/nope` | Not fixed |
| 4 | Minor (perf) | ScrollTrigger's rAF loop runs at about 60 fps on idle pages, including with reduced motion. | `qa-motion` annotation | Not fixed |
| 5 | Minor (test) | pgTAP test 10 is order-dependent on storage contents. | Run `seed:storage` then `supabase test db` | Not fixed |
| 6 | Minor (a11y) | Focus is not moved to step 2 of the booking form. | Keyboard on /book | Fixed (the step-2 heading gets focus; asserted in `a11y-manual`) |
| 7 | Info | `addContractVersion` inserts the new version while the contract is still `sent`, then sets `draft`. That leaves a tiny window where v2 is approvable before it is re-sent. | `features/contracts/actions.ts:47-52` | Not fixed |

No application code was changed by QA.

## Staging (cloud) verification — project `dyuixzxmmeiypvawzmty`, 2026-10-16

Run by the lead against the new Supabase project. Local app on `http://localhost:3100` (local test origin, not a deployment) built with `web/.env.staging.app.local`; the build references only `dyuixzxmmeiypvawzmty.supabase.co` (0 references to the local stack). Full step log: `docs/staging.md` → "Run log".

| Area | Command | Result |
|---|---|---|
| Preflight | `node scripts/staging-preflight.mjs` | Remote empty before apply; ref verified; old project never targeted |
| Schema | `staging-apply.mjs --apply` | 11/11 migrations; remote history == local; no seed pushed |
| Authorization (direct API + catalog) | `staging-verify.mjs --target staging` | **68/68** → `docs/staging-verify-report.json` |
| Login links + MFA gate (browser) | `scripts/staging-login-check.mjs` | **13/13** |
| Media, consent withdrawal, cron, booking (through the app) | `scripts/staging-app-check.mjs` | **15/15** |
| Scheduled job | `cron.job_run_details`, `private.storage_cleanup_queue` | runs every minute, succeeded; queue drained (pending 0, dead 0) |
| Client bundle secrets | `check-bundle-secrets.mjs` with both staging env files | clean |

Not proven on staging:
- Auth emails actually delivered (no custom SMTP; free-tier default mailer only reaches project team members). Link handling was verified with API-generated `token_hash` links, which is what the custom templates will send once SMTP exists.
- Turnstile (no widget configured; the booking form currently skips verification on staging).
- Cloud backup/restore rehearsal (procedure in `docs/backup-restore.md`; not yet run against staging).
- CDN behaviour (no CDN in front of localhost); cache window bounded by `max-age=60`.
- Owner TOTP enrolment (left for the owner to do with their own authenticator).

## Staging readiness round 2 — 2026-10-16

| Area | Evidence | Result |
|---|---|---|
| Admin flows on cloud (customers, bookings + transitions + convert, calendar, events, staff/equipment + conflicts, media upload + variants, publishing + consent, quotes, contracts + exact-version approval, finance + idempotency + refund, owner-only users/settings/backups, support, reviews, album submissions, staff role limits) | `node scripts/staging-admin-check.mjs` → `docs/staging-admin-report.json` | **93/93**, zero `[STAGING-TEST]` rows left (service-role purge, migration 0012), real owner unchanged (1 verified factor) |
| Test-fixture purge | pgTAP `70_test_purge.sql`; pushed to staging (12/12 migrations) | 156/156 locally; staging residue from earlier runs removed (3 events, 6 customers, 2 contracts, 4 versions, 3 snapshots) |
| Login links | `scripts/staging-login-check.mjs` (temporary admin, never the owner) | 13/13 |
| Cross-device links (local stack + Mailpit) | `tests/e2e/auth-links.spec.ts`, `docs/auth-links.md` | token_hash templates: other browser ✓ (magic link, reset + new password). Default PKCE: other browser ✗ (`/login?error=link`, clear notice), same browser ✓ |
| Turnstile fail-closed | unit `turnstile-policy.test.ts` (6), `tests/e2e/turnstile.spec.ts`, staging rebuild | no keys + cloud → form disabled + server action refused, 0 rows; Cloudflare test keys: pass secret → 1 row, fail secret → refused, 0 rows; local-stack bypass logged once |
| Staging app after rebuild | `scripts/staging-app-check.mjs` | 15/15; booking form refused on staging (no keys); one pre-existing real booking row left untouched |
| Rate-limit IP | `clientIp()` | no longer trusts the client-controlled left-most `X-Forwarded-For`; uses `CLIENT_IP_HEADER` or the right-most entry |
| Cloud restore rehearsal | `scripts/cloud-restore-rehearsal.mjs`, `docs/cloud-restore-report.json` | local simulation 110/110; cloud run PENDING (needs a second free project, see `docs/backup-restore.md`) |

Still not proven: auth email delivery on staging (no SMTP), token_hash templates on staging (blocked by free tier until SMTP), Turnstile with real keys on a real hostname, cloud restore, CDN.

## Content + WhatsApp/YouTube scope — 2026-10-16

Scope approved by the owner: public showcase site; videos from the studio's YouTube channel played in-page; booking/contact via WhatsApp; admin-only login (client portal, tracking and public forms hidden — code and tables kept).

| Area | Evidence | Result |
|---|---|---|
| YouTube channel identity | RSS feed + watch pages: channel `UCpxtdVABBIOaNLne-0_dDmQ` = "ستوديو و تسجيلات السلطان"; 19 public videos, all embeddable (oEmbed 200, playableInEmbed), no Shorts, shortest 539 s | verified |
| WhatsApp | `wa.me/message/I4OXKEUV7DX6L1` resolves to the studio's business profile; `wa.me/970598677477` shows the same business name → number is the studio's WhatsApp Business; buttons use `wa.me/970598677477?text=…` | verified |
| Schema | migrations 0013/0014 (`showcase_videos`, business_settings youtube_url/whatsapp_url); pgTAP | 189/189 (8 files); staging 14/14 migrations |
| Import idempotency | `scripts/import-content.mjs` local + staging, run twice | 2nd run: 0 inserted, 0 updated, 8 settings kept (owner's values never overwritten) |
| Admin videos | `tests/e2e/admin-videos.spec.ts` | 4/4 (URL/ID only — HTML/iframe/other hosts rejected; publish/promo/edit/delete; staff/customer denied) |
| In-page playback | `tests/e2e/public-youtube.spec.ts` | iframe only after click (youtube-nocookie), YouTube `<video>` paused=false and currentTime>0.5 in headless Chromium; Esc closes, focus returns, fullscreen allowed, "شاهد على YouTube" link |
| Public scope | public + footer specs | no portal/track/login links or forms on public pages; `/track` 308 → `/book`; all CTAs → WhatsApp |
| Footer | `footer.spec.ts` | desktop 411 → 318 px (1440 and 1920), mobile 748 → 653 px; booking band 101 px; no overflow at 360/390/768/1440/1920 |
| Accessibility | `a11y-axe.spec.ts`, `a11y-manual.spec.ts` | 0 serious/critical on our pages (YouTube's own iframe excluded — third-party markup); manual 10/10 |
| Regression (local, fresh DB per group) | qa-* 39 passed + 4 skipped (obsolete form/tracking tests, reason in file); portal 8/8; qa-portal 7/7; admin/mfa/public groups pass | ✅ |
| Staging (site on :3100 built against the cloud) | homepage HTML; staging-verify / app / login / admin checks | promo + 5 works rendered from staging; no groom names; 68/68, 15/15, 13/13, 93/93 |

## Production on Vercel — https://sultan-records.vercel.app (2026-10-16, commit ed66278)

| Check | Result |
|---|---|
| Routes | /, /work, /services, /about, /contact, /book, /faq, /privacy, /terms 200; /track 308→/book; /admin, /portal 307→/login?next=; unknown /work/* 404 |
| Content | promo + 5 works from Supabase; WhatsApp `wa.me/970598677477?text=…`; canonical = production URL; no [DEV]/[STAGING-TEST]/placeholder text, no groom names, no portal/track/login links |
| Secrets in published JS (14 files) | none (secret key, IP hash secret, access token, DB password, `sb_secret_`/service_role markers); no local-stack or old-project refs |
| Security headers | CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy present |
| Desktop browser (public-youtube + footer) | 12/12 — real YouTube playback in-page, dialog focus/Esc, every work opens, WhatsApp CTAs, no portal/forms, footer compact, no overflow |
| Mobile browser (Pixel-class, live-mobile.spec) | 2/2 — promo plays in-page, close button, every work opens, menu without portal, LTR phone, no overflow, no console errors |
| Admin login (temporary admin, never the owner) | 13/13 — /admin → login → MFA step; aal1 blocked from finance; redirect allow-list enforced |
| Media + consent withdrawal through the live app | 15/15 — same /m URL 404 `no-store` immediately (after CDN fix) |
| Authorization against the production DB | staging-verify 68/68 |
| Residue | 0 test users/events/customers/bookings; owner unchanged; real bookings/customers untouched |
| TTFB (from this machine) | home ≈0.9 s with functions in sin1 |

## Gallery + albums + animated intro — production (2026-10-16, commit 361d822, dpl_HnHCF6akFfPBmPmVbTYjmvh9zSZh)

| Check | Result |
|---|---|
| Channel inventory | 19/19 public videos (videos/streams/shorts tabs, uploads playlist w/o continuation, RSS, About = 19); 0 inaccessible; classification from title + description (no video watched); log `docs/youtube-import-log.md` |
| Categories (multi-tag) | evening 13 · artists 6 · dabke 5 · wedding 3 · groom_prep 3 · zaffa 2; henna not created (no matching video); needs review: sqU0MDUOTBE |
| Import idempotency | local and staging: 2nd run 0 inserted / 0 changed; 6 existing rows switched to original titles (title_source = youtube) |
| Live titles | 19/19 `/work/v/<id>` pages 200 with h1 exactly equal to the YouTube title |
| Live filters | `/work?cat=` first page counts match inventory (evening paginated 9 of 13) |
| DB (pgTAP) | 238/238 (10 files) locally; staging 16/16 migrations |
| Security fix found in review | 0015 let anon resolve/read album ORIGINALS → 0016 limits anon to thumb/display; pgTAP + staging-verify check |
| staging-verify (production DB) | 69/69 |
| Local regression (fresh DB) | gallery/photos/intro/public/player/footer/admin-videos/admin-albums 53+ passed; admin/mfa/a11y 28/28; qa-* 41 passed + 4 skipped (obsolete form tests) |
| Live browser | desktop: intro, gallery, player, footer 12/12 + 18/18 (one transient navigation timeout on a first run, 2 reruns green); mobile 2/2 (real playback) |
| Live admin / app | login 13/13, app (media + consent) 15/15 |
| Live secrets | 15 JS files: none |
| Intro perf (Pixel 7, 4× CPU, local) | LCP median 1556 ms, TBT ≈ 227 ms, CLS 0; intro ≈ 2.0 s, interactive from first frame |
| Motion evidence | `docs/motion/intro-desktop.webm`, `intro-mobile.webm` (+ posters, reduced-motion still) — intro animation of logo + text, not a works montage |

## CMS round — live verification (2026-10-18, deploy cbdf878)
`node web/scripts/live-cms-check.mjs` against https://sultan-records.vercel.app, temporary `[STAGING-TEST]` admin with TOTP (owner untouched). **16/16 passed**:
identity tagline visible live in ~1.5 s without deploy (restored); service publish → /services (1.6 s) → hide → gone (3.4 s);
offer publish → /offers (1.6 s); announcement links to the offer (1.4 s); offer end date set to yesterday (Asia/Hebron) → gone from /offers and /offers/<slug> 404;
nav rename visible with URL `/services` unchanged (restored); pending photo processed by pg_cron → `/api/jobs/process-photos` with no browser in 62 s.
Cleanup: 0 test rows/users/objects left. Real data after: 7 albums, 128 photos, 19 videos, 6 nav items, 1 user (owner).
Local: pgTAP 309/309, vitest 57/57, tsc clean, lint 0 errors, admin/CMS/albums/pipeline/MFA e2e 35/35, qa-* 40 passed.
Screenshots: `docs/screenshots/cms/`.

## Full e2e suite — cross-spec interference fixed (2026-10-18)
Fresh `db reset` + seed (418 objects) + content/album import, production build on :3600, `npx playwright test` (all specs, one worker).

| Run | Result |
|---|---|
| Before fixes | 143 passed, **6 failed**, 26 did not run (serial blocks after a failure) |
| After fixes | **173 passed, 0 failed**, 10 skipped |

Root causes (no timeouts were raised; each fix removes the shared state):
1. **portal / qa-portal C4** both submitted — and permanently locked — the photo selection of the same seeded events; the second found it locked. New `resetSeedSelections()` (qa-helpers, local stack only, seeded `[DEV]` ids only) resets those fixtures before each test. The `album_snapshots_immutable` trigger is unchanged for every API role.
2. **public.spec console 404 on `/` and `/services`**: admin-cms C4/C6 and cms-public deleted their test video/offer/announcement/service straight in the DB, which does not invalidate the public cache; cached pages kept links/thumbnails to deleted rows → 404 in the console. C4/C6 now delete through the admin UI (which calls `updateTag`) and assert the item left `/`; cms-public's restore also waits for `/services`.
3. **consent-revocation**: expected the test project on the homepage; since the gallery round projects are listed on `/work` («مشاريع مختارة»), not on `/`. Assertion moved to `/work` (the withdrawal half already checked `/work`).
4. **empty-states (current DB)**: required a `/contact` link in main/footer; with real business data the footer shows WhatsApp/phone instead (it falls back to `/contact` only without them, same as before CMS) and the header menu links `/contact`. Assertion accepts either real contact path.
5. **auth-links**: precondition, not interference — in token_hash mode the mailed link uses config.toml `site_url`, which must equal BASE_URL's origin. It now skips with that reason in a full run on another port, and was run separately with `site_url` = `http://localhost:3600` (stack restarted, config restored after): **2/2 passed**.

The 10 skips: auth-links ×2 (above, run separately), empty-states stub mode ×3 (needs a stub build), photos empty state ×1 (needs no published album), qa-journeys/qa-responsive booking-form ×4 (the form was replaced by WhatsApp booking — approved scope).
No production deploy: only tests and docs changed.
