# Implementation plan

Branch: `rebuild/nextjs` (baseline of the original site committed on `master`).
Status legend: ☐ todo · ◐ in progress · ☑ implemented · ✅ verified (evidence in verification.md) · ⛔ blocked

## Discovery findings (2026-10-15)
- Original: 22 static HTML pages duplicated as `x.html` + `x/index.html`, vanilla JS with global `window.SULTAN_CMS`, version override files (v25–v28), inline `onclick` handlers interpolating data, ~58KB single admin script.
- Backend source missing entirely: code calls ~30 tables, 6 RPCs, 5 Edge Functions but no SQL/migrations/function source exists in the package → backend rebuilt from the contract.
- Original logo: `assets/logo-main.webp`, `assets/logo-round.webp` (copied byte-identical to `web/public/brand/`).
- No real portfolio media in the package besides `cover.webp` (old banner) → public work is DB-driven; placeholders only in development.
- Tooling: Node 22.15, npm 10.9, Docker 28.5, git 2.51. No Supabase MCP; Supabase CLI added as a pinned dev dependency.
- New Supabase project: ref `dyuixzxmmeiypvawzmty`, ap-southeast-1, created by the user. No access token yet → remote writes blocked (see handoff).

## Agent map
| Workstream | Agent | Owns |
|---|---|---|
| Architecture, integration, conflicts, final verification | Lead | `docs/architecture.md`, `docs/*plan/matrix/verification/handoff`, `web/next.config.ts`, `web/package.json`, proxy |
| Backend & security | backend agent | `web/supabase/**`, `src/lib/{supabase,env,permissions}`, `src/types/database.ts`, `docs/security-model.md` |
| Design system, public site, motion | public agent | layout, `(public)`, components, styles, public-content, public booking |
| Client portal + media | portal agent (phase 2) | `app/portal/**`, `(auth)`, features galleries/album-selections/video-reviews/deliverables (customer side), `components/media` gallery/lightbox additions via contract |
| Administration | admin agent (phase 2) | `app/admin/**`, features customers/bookings/projects/quotes/contracts/finance/staff/equipment/support/publishing/users (admin side), upload pipeline |
| QA & integration | QA agent (phase 3) | `web/tests/**`, `docs/verification.md` evidence |

## Phases
1. ☑ Inventory, baseline commit, branch, scaffold Next 16 + deps, local Supabase, contract.
2. ◐ Backend schema/RLS/RPC/storage/pgTAP · ◐ Design system + public site + motion.
3. ☐ Portal (auth, events, gallery >160, selection per event, review & submit snapshot, deliverables, video review w/ timecode per revision, quotes/contracts/payments) · ☐ Admin (overview, customers, bookings+calendar, events/publishing w/ consent, media upload w/ variants, quotes/contracts, production/deliverables, reviews moderation, finance, staff, equipment, support, users, settings, backups).
4. ☐ Security headers/CSP, proxy auth gating, SEO polish, error/empty states.
5. ☐ QA: e2e journeys, isolation via direct API, responsive matrix, reduced motion, secrets scan of `.next` bundles, console errors.
6. ⛔ Staging: push migrations to `dyuixzxmmeiypvawzmty` and deploy preview — needs user-provided access token + DB password (never in chat).
7. ☐ Handoff.
