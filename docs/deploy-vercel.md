# Vercel deployment — preparation (not deployed)

Status: **prepared, not deployed.** No Vercel project has been created and nothing is published. Deploying and attaching a domain need the owner's explicit go-ahead. The current production site and the old Supabase project are untouched.

## Project settings

| Setting | Value |
|---|---|
| Git repository / branch | this repo, branch `rebuild/nextjs` (Production branch can be set to it, or merge to `main` first) |
| Root Directory | `web` |
| Framework preset | Next.js (auto-detected; `next build`) |
| Node.js | 22.x |
| Install command | `npm ci` (lockfile committed) |
| Plan | Hobby (free) is enough for this scope: no paid add-ons, no Vercel Blob/KV, videos stay on YouTube |

## Environment variables (Production + Preview)

Set in Vercel → Project → Settings → Environment Variables. Copy values from `web/.env.staging.app.local` on the operator's machine — never paste them into chat, issues or commits. Mark the secret ones **Sensitive**.

| Name | Exposure | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | `https://dyuixzxmmeiypvawzmty.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | publishable key (safe in the browser; RLS protects data) |
| `SUPABASE_SECRET_KEY` | **Sensitive**, server only | used only by audited server paths (signed URLs, admin storage cleanup) |
| `NEXT_PUBLIC_SITE_URL` | public | the final `https://` origin (canonical URLs, sitemap). Use the Vercel preview URL until a domain is attached |
| `IP_HASH_SECRET` | **Sensitive** | 32+ random chars (required in production) |
| `CLIENT_IP_HEADER` | optional | leave empty on Vercel: Vercel overwrites `X-Forwarded-For` to prevent spoofing |

Not needed for the approved scope: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` (public forms are not rendered; booking is via WhatsApp), SMTP (admin-only login with password + TOTP).

`NEXT_PUBLIC_*` values are compiled into the client bundle at build time, so changing them requires a redeploy.

## After the first deployment (before announcing)

1. Add the deployed origin to Supabase Auth so admin login/redirects work:
   `cd web && STAGING_SITE_URL=https://<your-domain> node scripts/staging-apply.mjs --apply --only auth-config`
   (adds `<origin>/auth/callback` and `/auth/reset` to the redirect allow-list and sets `site_url`; keeps existing entries).
2. Verify on the deployed URL: `/` shows the promo and works; a video plays in the dialog; WhatsApp buttons open `wa.me/970598677477`; `/admin` redirects to `/login`; owner login → TOTP → `/admin`; `/portal`, `/track`, `/book` form are not reachable from navigation.
3. Run the bundle secret scan against the Vercel build output if downloaded, or rely on the identical local build check (`node scripts/check-bundle-secrets.mjs .env.staging.app.local`).
4. Protect Preview deployments (Vercel Deployment Protection) so previews of unfinished branches aren't public.
5. Only then point a domain at Vercel. The existing site stays where it is until the owner decides to switch DNS.

## Rollback

Vercel keeps every deployment; "Promote" an earlier deployment or remove the domain. No database change is tied to a Vercel deploy.
