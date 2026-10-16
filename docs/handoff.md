# Handoff — Sultan Records rebuild

Branch `rebuild/nextjs` · original site preserved on `master` (commit `1477294`) and untouched at the repo root.
Old Supabase project `peufggxvklpnaytyklgg` was never read or written. The new project `dyuixzxmmeiypvawzmty` now holds the full schema (migrated 2026-10-16) and one owner account; no demo or seed data.

## Status at a glance (2026-10-16)

| Area | Implemented | Tested locally | Verified against new backend | Blocked by account access | Deployed |
|---|---|---|---|---|---|
| Database: 11 migrations, RLS, RPCs, storage, cron | ✅ | ✅ pgTAP 139/139 | ✅ 11/11 pushed; catalog + authorization 68/68 | — | — |
| Public site, motion, empty states | ✅ | ✅ | ✅ local app on :3100 against staging | — | ❌ not authorized |
| Client portal | ✅ | ✅ | ✅ login, portal consent withdrawal | — | ❌ |
| Administration | ✅ | ✅ | ◑ owner reaches MFA gate; full admin flows not re-run on staging | — | ❌ |
| Consent withdrawal (gated media + durable cleanup) | ✅ | ✅ | ✅ same URL 404 immediately; cron deleted the copy | — | — |
| MFA | ✅ | ✅ | ✅ aal1 denied / aal2 allowed (staff + admin); owner gate in browser | — | — |
| Accessibility | ✅ | ✅ axe 0 violations, 41 scans | — | — | — |
| Backup / restore | ✅ | ✅ isolated local restore 101/101 | ❌ cloud restore rehearsal not yet run | — | — |
| Auth emails (magic link / reset) | ✅ callback + templates ready | ✅ | ◑ links verified via token_hash; delivery needs SMTP | ✅ SMTP (you) | — |
| Turnstile | ✅ server-side verify | — | ❌ not configured | ✅ widget keys (you) | — |

## Release blockers — evidence
| Blocker | Result | Evidence |
|---|---|---|
| Consent withdrawal | Public media is no longer served from a public bucket. `GET /m/{asset}/{variant}` re-checks consent + publication on every request (RLS + storage policy). Withdrawal unpublishes in the same transaction; **the same URL returns 404 `no-store` on the next request**. Cached 200s live at most **60 s** (`max-age=60, s-maxage=60`, `stale-while-revalidate=0`); a CDN purge of `/m/{asset}/` can shorten that. Admin/staff cannot re-grant consent or republish after a customer withdrawal (DB-enforced). Published copies are deleted by a durable queue: pg_cron every minute → `storage-cleanup` Edge Function with backoff, 5 attempts, dead-letter; plus an immediate best-effort call. Private originals are preserved. | pgTAP `40_consent_revocation.sql` (26), `consent-revocation.spec.ts` 6/6, `docs/security-model.md` §13 |
| MFA | Enrollment, challenge, wrong code, correct code, logout in a real browser. aal1 staff/admin sessions: pages redirect to the MFA step; direct API reads return nothing private, admin RPCs 42501, writes rejected; same calls succeed at aal2. Global `require_staff_mfa` switch + real `staff` user verified. Disabled account denied even with an aal2 token. | `mfa.spec.ts` 7 tests, `verification.md` S4 |
| Accessibility | axe (WCAG 2.0/2.1/2.2 A+AA) on 41 public/portal/admin scans → 0 violations at every impact after fixing 5 serious/critical. Keyboard, focus, dialogs, form errors, RTL, 200% zoom, reduced motion: 10/10 checks. | `a11y-axe.spec.ts`, `a11y-manual.spec.ts`, `docs/a11y/` |
| Backup recovery | Restored into a second, isolated local Supabase stack: rows byte-identical, relationships and contract hashes intact, `event_financials` equal, passwords work, RLS still isolates customers, 418/418 storage objects with matching sha256, signed URLs work for owners only. Tampered restore → 6 failures, exit 1. | `docs/restore-report.json`, `docs/backup-restore.md`, `verification.md` B1 |
| Production empty states | With no media/projects/reviews/services the homepage keeps the original logo, headline, booking action, services, process and contact; the works section is hidden, no placeholders or generated images render. | `empty-states.spec.ts` (stub run 3/3), `docs/screenshots/empty-home-*.png` |

## Final regression (fresh DB before each group, production build)
- `npx tsc --noEmit` exit 0 · `npm run lint` 0 errors (1 pre-existing warning) · `npm run build` OK · `npm run test:unit` 6/6.
- `npx supabase test db` → **6 files, 139 tests, PASS** (on a fresh reset; the suite assumes seed state).
- Playwright: `qa-*` **45 passed** · `public/portal/admin` **31 passed** · `a11y-*`, `consent-revocation`, `empty-states`, `mfa` **29 passed, 3 skipped** (the skipped 3 are empty-states stub mode, which needs a separate stub build; it passed 3/3 in its own run).
- Secret scan of the client bundle (`scripts/check-bundle-secrets.mjs`): clean.

## Staging — done on 2026-10-16
- Local site against the cloud project: `http://localhost:3100` (test origin only; run instructions in `docs/staging.md`).
- Owner login: email = the `OWNER_EMAIL` you put in `web/.env.staging.local`; temporary password in `web/.cache/owner-credentials.local.txt` (gitignored, never printed). First login → enrol TOTP with your authenticator → `/admin`. Then change the password and delete that file.
- Cloud results: authorization 68/68, login 13/13, app/media/consent/cron/booking 15/15. Details in `docs/verification.md` → "Staging (cloud) verification".
- Remaining manual steps: custom SMTP (then `staging-apply.mjs --apply --only auth-config` for the token_hash email templates), Turnstile widget keys, cloud backup/restore rehearsal.

## Staging migration (how it was run)
Runbook: `docs/staging.md`. Minimum account steps for you:
1. Create a personal access token at supabase.com/dashboard/account/tokens.
2. Create `web/.env.staging.local` (gitignored — verified) with these **names** (values never in chat):
   `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` (= `dyuixzxmmeiypvawzmty`), `STAGING_SITE_URL`.
3. Tell me it exists. I will then run, in order: `staging-preflight.mjs` (read-only: verifies the ref, refuses the old project, reports remote state) → `staging-apply.mjs` dry run → `--apply` (migrations only, no seed; Auth site URL/redirects, access-token hook, TOTP; buckets check; Edge Function + secret + Vault; cron check; app env file) → owner bootstrap (you set `OWNER_EMAIL` in your shell; the one-shot token lives only in a gitignored file and is deleted after use) → `staging-verify.mjs --target staging` (authorization checks against the cloud with temporary `[STAGING-TEST]` data, then cleanup).
4. Manual dashboard items that remain: custom SMTP (free plan only emails project members), Turnstile widget hostnames.
Local results do not prove cloud configuration; staging is verified only when `staging-verify` passes against it.

## Remaining limitations (honest)
- No screen-reader pass (NVDA/VoiceOver) yet; some admin/portal tabs not axe-scanned (list in `docs/a11y/notes.md`).
- CDN behaviour for consent withdrawal not tested behind a real CDN; bounded by the 60 s max-age.
- Server actions at aal1 not POSTed directly; proven at the RLS layer and page guards.
- Free plan: 50 MB global upload cap despite 2 GiB bucket limits; large videos need a paid tier or an external video provider (boundary documented, not integrated).
- Deleting an event that has a submitted album selection is blocked on purpose (immutable record).
- Edge Function uses the platform `SUPABASE_SERVICE_ROLE_KEY`; disabling legacy keys would break cleanup (`cron-verify` step detects it).
- CSP keeps `'unsafe-inline'` for scripts (static rendering).
- Privacy/terms copy is a draft pending legal review.
- Real studio media is required before launch; nothing fictional is published.

## Run locally
```bash
cd web
npm ci && npx playwright install chromium
npx supabase start                     # Docker
npx supabase db reset && npm run seed:storage
cp .env.example .env.local             # fill from `npx supabase status -o env`; IP_HASH_SECRET 32+ chars
npm run dev -- -p 3100                 # port 8080 belongs to another project on this machine
npx supabase functions serve           # for the consent cleanup function locally
```
Dev logins: comments at the top of `web/supabase/seed.sql` (local only).

## Rollback
The new app lives entirely in `web/`; the live site is untouched. On staging: pause the project, or reset it (destructive — explicit confirmation required). Migrations are forward-only; restore procedure in `docs/backup-restore.md`.

No public hosting deploy and no replacement of the current website until you explicitly authorize it.
