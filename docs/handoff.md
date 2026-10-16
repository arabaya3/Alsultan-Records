# Handoff — Sultan Records rebuild

Branch `rebuild/nextjs` · original site preserved on `master` (commit `1477294`) and untouched at the repo root.

## Status at a glance

| Layer | Implemented | Tested locally | Verified against new backend (`dyuixzxmmeiypvawzmty`) | Deployed |
|---|---|---|---|---|
| Database (9 migrations, RLS, RPCs, storage) | ✅ | ✅ pgTAP 100/100 | ⛔ blocked: no access token | — |
| Public site + motion | ✅ | ✅ | ⛔ | — |
| Client portal | ✅ | ✅ | ⛔ | — |
| Administration | ✅ | ✅ | ⛔ | — |
| Staging deploy | — | — | — | ⛔ not authorized/credentials missing |

Old project `peufggxvklpnaytyklgg` was never read or written.

## Final verification (run by the lead on 2026-10-16, production build, fresh DB each suite)
- `npx tsc --noEmit` → clean · `npm run lint` → clean · `npm run build` → success (61 pages).
- `npx supabase db reset && npx supabase test db` → **4 files, 100 tests, PASS**.
- `npm run seed:storage` → 208 media rows, 418 objects, 0 failed.
- `BASE_URL=http://localhost:3400 npx playwright test tests/e2e/qa-` → **45/45 passed**.
- `… tests/e2e/public.spec.ts portal.spec.ts admin.spec.ts` → **31/31 passed**.
- HTTP: `/` `/work` `/services` `/book` 200; unknown `/work/*`, `/services/*`, unknown path 404; `/admin`, `/portal` unauthenticated → 307 to `/login?next=`.
- Secret scan of `.next/static`: secret key value 0, IP hash secret 0, `service_role` 0.
Full per-feature evidence: `docs/verification.md`. Screenshots: `docs/screenshots/` (home-1440-v2, qa-*, portal-*, admin-*). Motion recording: `docs/motion/home-motion.webm`.

## Agent workstreams
| Agent | Result |
|---|---|
| Backend & security | 9 migrations, ~25 RPCs, owner-only backups bucket, storage cleanup queue, pgTAP 100 tests, `docs/security-model.md` |
| Design system, public site & motion | Reference-matched homepage, 12 public routes, booking + tracking, SEO, GSAP motion with reduced-motion/save-data handling |
| Client portal | Auth (password, magic link, reset, TOTP step), event-centred portal, 200+ image gallery, per-event selection + immutable snapshot, video review per revision/timecode, signed URL helper |
| Administration | 31 admin pages, role guards, upload pipeline with WebP variants, publishing with consent, finance, staff/equipment, backups, cleanup worker |
| QA | 8 independent suites; found 1 major bug (quote creation) + 7 minor — all fixed and re-verified |

## Run locally
```bash
cd web
npm ci
npx playwright install chromium        # tests only
npx supabase start                     # Docker required
npx supabase db reset && npm run seed:storage
cp .env.example .env.local             # fill from `npx supabase status -o env`; add IP_HASH_SECRET (32+ chars)
npm run dev -- -p 3100                 # port 8080 is used by another project on this machine
```
Dev logins are listed in comments at the top of `web/supabase/seed.sql` (local only).

## Remaining blockers and exact steps for you
1. **Push the schema to the new project** — create `web/.env.staging.local` with `SUPABASE_ACCESS_TOKEN` (supabase.com/dashboard/account/tokens) and `SUPABASE_DB_PASSWORD`. Never paste them in chat. Then (I can run these once the file exists):
   ```bash
   npx supabase link --project-ref dyuixzxmmeiypvawzmty
   npx supabase db push            # migrations only; seed is NOT pushed
   ```
2. **Dashboard settings on the new project** (Authentication):
   - Custom Access Token hook → `app.custom_access_token_hook`.
   - Enable TOTP MFA.
   - Site URL + redirect allowlist = the staging URL (and later the real domain).
3. **First owner**: set the bootstrap token hash in `private.bootstrap` via SQL editor, sign up, call `bootstrap_initial_owner` once (procedure in `docs/security-model.md`).
4. **Turnstile**: create a widget for the staging/real hostname; set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`.
5. **Real media**: the site hides empty portfolio/hero sections in production. Upload real, consented work from `/admin/events/[id]/media` and publish.
6. **Staging hosting**: choose Vercel or Cloudflare; I will not deploy or replace the production site without your explicit go-ahead.

## Known gaps (honest)
- Staff MFA (aal2) enforcement is pgTAP-tested but not e2e (seed disables MFA locally).
- Storage cleanup is scheduled (pg_cron every minute -> `storage-cleanup` Edge Function). Staging needs the Vault secrets `storage_cleanup_url` and `storage_cleanup_key`, see security-model section 13.
- Video streaming uses signed MP4 URLs; an external streaming provider boundary is documented in `docs/backup-restore.md` but not integrated.
- Axe accessibility audit not run (`@axe-core/playwright` not installed); custom label/focus/contrast checks pass.
- CSP keeps `'unsafe-inline'` for scripts (needed by static rendering); nonce-based CSP would disable static pages.
- Privacy/terms copy is a draft pending local legal review.
- Backups exclude `auth.*`; storage binaries are covered by a manifest + documented S3 sync (`docs/backup-restore.md`). Restore has not been rehearsed against an isolated cloud project.

## Rollback
The new app lives entirely in `web/`; the live site is untouched. Database rollback = restore from backup or `supabase db reset` on a non-production project; migrations are forward-only.
