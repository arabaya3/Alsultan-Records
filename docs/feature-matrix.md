# Feature matrix

Final status 2026-10-16 (lead re-run: pgTAP 100/100, e2e 76/76 on production build). ◑ = verified at DB level only. Status: ☐ todo · ◐ in progress · ☑ implemented · ✅ verified · ⛔ blocked. Evidence IDs refer to `docs/verification.md`.

| # | Feature | Owner | Status | Acceptance criteria | Evidence |
|---|---|---|---|---|---|
| P1 | Homepage per reference | public | ✅ | Matches reference hierarchy at 1440/390; original logo hash unchanged; no overflow 320–1440 | verification.md#P1 |
| P2 | Selected works + project page | public | ✅ | Only events with consent=granted ∧ published appear; empty DB hides section; API error shows error state | verification.md#P2 |
| P3 | Services + detail | public | ✅ | Published services only; slug 404 for unknown | verification.md#P3 |
| P4 | Booking inquiry | public+backend | ✅ | 2 steps; input kept on error; double click = one row (idempotency); Turnstile verified server-side when configured; tracking code shown; copy says not a confirmed booking | verification.md#P4 |
| P5 | Booking tracking | public+backend | ✅ | Code + phone last 4 → status only; wrong combo → generic not-found; rate limited | verification.md#P5 |
| P6 | FAQ/privacy/terms/about/contact/404/error | public | ✅ | Arabic, RTL, no technical labels | verification.md#P6 |
| P7 | SEO | public | ✅ | canonical from SITE_URL; sitemap has only public pages; robots blocks /admin /portal; no private data in metadata | verification.md#P7 |
| M1 | Motion system | public | ✅ | Entrance ≤600ms non-blocking; reduced-motion = static; no letter-splitting of Arabic; contexts reverted on unmount; offscreen video paused | verification.md#M1 |
| S1 | Schema + RLS on all tables | backend | ✅ | pgTAP: RLS enabled on every public table; anon/authenticated grants explicit | verification.md#S1 |
| S2 | Customer isolation | backend | ✅ | pgTAP + e2e: A cannot read/alter B rows or files via direct API | verification.md#S2 |
| S3 | Role integrity | backend | ✅ | Users cannot change role/disabled/customer link; bootstrap owner one-shot | verification.md#S3 |
| S4 | Staff MFA + disabled enforcement | backend | ◑ pgTAP only | Policies deny staff at aal1 when required; disabled user denied | verification.md#S4 |
| S5 | Private storage + signed URLs | backend+portal | ✅ | Private bucket not publicly readable; signed URL TTL ≤ 10 min; other customer's path denied | verification.md#S5 |
| S6 | Publication consent | backend+admin | ✅ | Publishing without consent rejected; revoking consent unpublishes | verification.md#S6 |
| S7 | Audit events | backend | ◑ pgTAP only | Role/payment/contract/consent changes produce audit rows; no direct insert | verification.md#S7 |
| C1 | Portal auth + session | portal | ✅ | Login, reset, logout clears state; expired session redirects | verification.md#C1 |
| C2 | Event-centered navigation | portal | ✅ | Customer sees only own events | verification.md#C2 |
| C3 | Gallery (>160) | portal | ✅ | 200-image event loads fully via pagination; thumbnails not originals; keyboard + swipe lightbox | verification.md#C3 |
| C4 | Album selection | portal+backend | ✅ | Per-event count correct across 2 events; notes separate; review step; submit creates immutable snapshot | verification.md#C4 |
| C5 | Video review | portal+backend | ✅ | Comment stored with revision id + timecode; switching video quickly never shows stale comments | verification.md#C5 |
| C6 | Deliverables/downloads | portal | ◑ API only | Signed URLs renewed on expiry | verification.md#C6 |
| C7 | Quotes/contracts/payments (customer) | portal+backend | ✅ | Approve exact version (hash); totals from backend | verification.md#C7 |
| A1 | Admin shell + overview | admin | ✅ | Section-level lazy loading; nothing fetched globally at login | verification.md#A1 |
| A2 | Customers, bookings, calendar | admin | ✅ | Server pagination/search; only valid stage transitions offered and enforced | verification.md#A2 |
| A3 | Events, media upload, publishing | admin | ✅ | Upload reports partial failures; variants generated; publish blocked without consent | verification.md#A3 |
| A4 | Quotes/contracts | admin | ✅ | Versions immutable; sent version is what customer approves | verification.md#A4 |
| A5 | Production/deliverables, reviews, album submissions | admin | ◑ partial | | verification.md#A5 |
| A6 | Finance | admin+backend | ✅ | Totals from backend; payment idempotent; staff denied | verification.md#A6 |
| A7 | Staff/equipment | admin+backend | ◑ pgTAP only | Conflict rules enforced and explained | verification.md#A7 |
| A8 | Support, users/permissions, settings | admin | ✅ | Owner-only user management | verification.md#A8 |
| B1 | Backups | admin+backend | ✅ | Paginated export; partial/failed status accurate; storage covered separately; restore doc | verification.md#B1 |
| Q1 | Build/lint/types | lead | ✅ | `tsc`, `lint`, `build` clean | verification.md#Q1 |
| Q2 | Secrets scan | QA | ✅ | No secret key strings in `.next/static` | verification.md#Q2 |
| D1 | Staging deploy | lead | ⛔ | Needs access token from user | |
