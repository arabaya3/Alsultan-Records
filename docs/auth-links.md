# Auth email links and Turnstile: local proof

Run on 2026-10-16 against the **local** Supabase stack (`alsultan-records`) only. The app was a production
build (`next build && next start`) in a scratch copy of `web/` on ports 4100 and 4101. No remote Supabase
project was contacted. The only outside network calls were to Cloudflare, for the public Turnstile test keys.

Specs:
- `web/tests/e2e/auth-links.spec.ts`: set `AUTH_LINK_TEMPLATES=token_hash|default`.
- `web/tests/e2e/turnstile.spec.ts`: skipped unless `TURNSTILE_TEST_MODE=bypass|unavailable|pass|fail` is set.

## 1. Auth links across devices

The app sends magic links with `signInWithOtp` and reset links with `resetPasswordForEmail`, using
`@supabase/ssr` (PKCE). `/auth/callback` accepts two kinds of link:
- `?code=`, completed with `exchangeCodeForSession`. This needs the PKCE `code_verifier` cookie, which exists
  only in the browser that asked for the link.
- `?token_hash=&type=`, completed with `verifyOtp`. This needs no cookie.

Method: browser context A requested the link from `/login`. The email was read through the Mailpit API. The
link was then opened in a **fresh** context B with no cookies, or back in A.

| # | Templates | Flow | Opened in | Expected | Result |
|---|---|---|---|---|---|
| 1 | token_hash (`supabase/templates/*.html`) | magic link | fresh B | `/portal`, signed in | **PASS** |
| 2 | token_hash | password reset | fresh B | `/auth/reset` with a session. A new password is saved, then a fresh context C signs in with it and reaches `/portal` | **PASS** |
| 3 | default (`{{ .ConfirmationURL }}`, PKCE) | magic link | fresh B | `/login?error=link` plus the Arabic "another device or browser" notice | **PASS** (fails as expected) |
| 4 | default | magic link | same browser A | `/portal` | **PASS** |
| 5 | default | password reset | fresh B | `/login?error=link` plus the notice | **PASS** (fails as expected) |
| 6 | default | password reset | same browser A | `/auth/reset` with the form | **PASS** |

Totals: token_hash 2/2, default 4/4. After case 2, the seed password of `customer.b@dev.local` was restored
with the secret-key admin API, and a password sign-in confirmed it.

**Conclusion:**
- With the default templates, magic links and reset links work **only in the browser that requested them**.
- With the token_hash templates, they work **across devices and browsers**.
- Invite links come from the same template mechanism (`invite.html`, token_hash). They were not exercised here
  because no invite UI flow exists in this spec.

### What staging needs
1. **Custom SMTP** on the staging project. On the free plan, email templates cannot be customised without it.
2. Then push the templates: `node scripts/staging-apply.mjs --apply --only auth-config`.
3. **SMTP alone does NOT make links cross-device.** If the templates stay at the default
   `{{ .ConfirmationURL }}`, links remain same-browser-only (cases 3 and 5). The templates must change too.
4. `site_url` on staging must be the real app origin, because `{{ .SiteURL }}` builds the token_hash link.
   The app origins also belong in the redirect allow-list.

### Post-SMTP staging test procedure: **PENDING**
1. After steps 1 and 2 above, start the app built against staging on `http://localhost:3100`.
2. Request a magic link for a test customer from `/login`.
3. Open the email on a **different device or browser**. The link must start with `{{ .SiteURL }}/auth/callback?token_hash=`.
4. Expect `/portal`, signed in.
5. Repeat for "forgot password". Expect `/auth/reset`, set a password, then sign in with it.
6. Record the results here.

### Local stack notes
- Templates load only when the stack starts: run `npx supabase stop && npx supabase start`.
- GoTrue allows **one OTP or recovery email per user per 60 s**. A second request within that window gets a
  429, but the app still shows its generic "sent" message (anti-enumeration), so no email arrives. The spec
  waits 61 s between requests.
- For this proof, `site_url` was set to `http://localhost:4100` temporarily and then restored to
  `http://127.0.0.1:3000`. `additional_redirect_urls` now also lists `http://localhost:4100` and
  `http://localhost:4100/**`. That is the only lasting change to `config.toml`.
- With the local `site_url` of `http://127.0.0.1:3000`, local token_hash links point to port 3000. To use them
  against another local origin, set `site_url` to that origin.

## 2. Turnstile fail-closed policy

`turnstile-policy.ts` was tested with a separate production build for each mode, all against the local stack.

| Mode | Build/run env | Expected | Result |
|---|---|---|---|
| bypass-local-stack | no keys, `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` | UI booking succeeds with 1 row. A hand-built direct server-action POST also succeeds with 1 row (positive control for the POST technique). The server logs `[turnstile] bypass-local-stack: missing …` exactly once. | **PASS** 2/2, log line ×1 |
| unavailable (cloud simulation) | no keys, `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.2:54321`. 127.0.0.2 reaches the local stack through Windows loopback (health 200), but the policy treats it as non-local. | `/book` renders `data-testid="booking-unavailable"` and no form inputs. A direct POST to `submitBooking` returns "النموذج غير متاح حالياً" and creates 0 rows. The log says `[turnstile] unavailable … public forms are refused`. | **PASS** 2/2 |
| enforce, passing secret | site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA` | The widget loads from challenges.cloudflare.com (allowed by the CSP) and issues a token. The submission succeeds with 1 row. | **PASS** 1/1 |
| enforce, failing secret | same site key, secret `2x0000000000000000000000000000000AA` | The submission is refused with "تعذّر التحقق من النموذج. أعد المحاولة." and creates 0 rows. | **PASS** 1/1 |

The Cloudflare dummy keys were checked against developers.cloudflare.com/turnstile/troubleshooting/testing/.
The direct POST uses React's reply encoding: the fields are `_1_<name>` and the root `0` is
`[prevState,"$K1"]`. The root must be the **last** multipart part, because Next decodes the body as a stream.
