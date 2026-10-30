---
name: sultan-e2e
description: Choose and run the right Sultan Records Playwright specs safely. Use when testing the site in a browser, adding an e2e test, or verifying a flow.
---

# Playwright for Sultan Records

Existing setup: `web/playwright.config.ts`, `web/tests/e2e/`, one worker. `PW_WEBKIT=1` adds Safari for the public specs.

## Safety first

- Only on an isolated stack: `.env.local` must point at the isolated API port (not 54321), and `E2E_DB_CONTAINER` at its database container. On a checkout with `scripts/lib/reset-guard.mjs`, run `node scripts/e2e-reset-local.mjs --check` first.
- Never point destructive specs at production. Never use real private media: fixtures are synthetic, or copies within the isolated seed. Remove what a test creates.
- Start the built app (`next start`) after a reset, so its cache starts empty. Set `BASE_URL`.

## Where each flow is covered

| Flow | Specs |
|---|---|
| Homepage | `public`, `home-order-stats`, `site-intro`, `intro` |
| Video gallery, details, category filters | `gallery`, `public-youtube`, `promo-video`, `chip-scroller` |
| Photo galleries, viewer | `photos`, `album-covers`, `ui-audit-followup` |
| Offers, packages | `offers`, `offer-details`, `packages-offers` |
| Mobile, responsive | `qa-responsive`, `live-mobile`, `@mobile` tag |
| Contact and booking forms | `qa-journeys`, `turnstile` |
| Admin login, MFA | `admin`, `mfa`, `auth-links`, `admin-accounts` |
| Client portal | `portal`, `qa-portal` |
| Authorization, privacy | `qa-security`, `consent-revocation` |
| Broken media, console errors | `qa-console`, `empty-states` |
| Accessibility | `a11y-axe`, `a11y-manual` |

## Rules

- Run the affected specs first, then the full suite before reporting done. State the SHA tested.
- Never weaken an expectation or add a skip to get a pass. Diagnose failures with evidence.
- A test that hit no running app proves nothing: check the build and the server first.
