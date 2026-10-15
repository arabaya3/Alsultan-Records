# Feature matrix

Status: ☐ todo · ◐ in progress · ☑ implemented · ✅ verified · ⛔ blocked. Evidence IDs refer to `docs/verification.md`.

| # | Feature | Owner | Status | Acceptance criteria | Evidence |
|---|---|---|---|---|---|
| P1 | Homepage per reference | public | ◐ | Matches reference hierarchy at 1440/390; original logo hash unchanged; no overflow 320–1440 | |
| P2 | Selected works + project page | public | ◐ | Only events with consent=granted ∧ published appear; empty DB hides section; API error shows error state | |
| P3 | Services + detail | public | ◐ | Published services only; slug 404 for unknown | |
| P4 | Booking inquiry | public+backend | ◐ | 2 steps; input kept on error; double click = one row (idempotency); Turnstile verified server-side when configured; tracking code shown; copy says not a confirmed booking | |
| P5 | Booking tracking | public+backend | ◐ | Code + phone last 4 → status only; wrong combo → generic not-found; rate limited | |
| P6 | FAQ/privacy/terms/about/contact/404/error | public | ◐ | Arabic, RTL, no technical labels | |
| P7 | SEO | public | ◐ | canonical from SITE_URL; sitemap has only public pages; robots blocks /admin /portal; no private data in metadata | |
| M1 | Motion system | public | ◐ | Entrance ≤600ms non-blocking; reduced-motion = static; no letter-splitting of Arabic; contexts reverted on unmount; offscreen video paused | |
| S1 | Schema + RLS on all tables | backend | ◐ | pgTAP: RLS enabled on every public table; anon/authenticated grants explicit | |
| S2 | Customer isolation | backend | ◐ | pgTAP + e2e: A cannot read/alter B rows or files via direct API | |
| S3 | Role integrity | backend | ◐ | Users cannot change role/disabled/customer link; bootstrap owner one-shot | |
| S4 | Staff MFA + disabled enforcement | backend | ◐ | Policies deny staff at aal1 when required; disabled user denied | |
| S5 | Private storage + signed URLs | backend+portal | ☐ | Private bucket not publicly readable; signed URL TTL ≤ 10 min; other customer's path denied | |
| S6 | Publication consent | backend+admin | ◐ | Publishing without consent rejected; revoking consent unpublishes | |
| S7 | Audit events | backend | ◐ | Role/payment/contract/consent changes produce audit rows; no direct insert | |
| C1 | Portal auth + session | portal | ☐ | Login, reset, logout clears state; expired session redirects | |
| C2 | Event-centered navigation | portal | ☐ | Customer sees only own events | |
| C3 | Gallery (>160) | portal | ☐ | 200-image event loads fully via pagination; thumbnails not originals; keyboard + swipe lightbox | |
| C4 | Album selection | portal+backend | ☐ | Per-event count correct across 2 events; notes separate; review step; submit creates immutable snapshot | |
| C5 | Video review | portal+backend | ☐ | Comment stored with revision id + timecode; switching video quickly never shows stale comments | |
| C6 | Deliverables/downloads | portal | ☐ | Signed URLs renewed on expiry | |
| C7 | Quotes/contracts/payments (customer) | portal+backend | ☐ | Approve exact version (hash); totals from backend | |
| A1 | Admin shell + overview | admin | ☐ | Section-level lazy loading; nothing fetched globally at login | |
| A2 | Customers, bookings, calendar | admin | ☐ | Server pagination/search; only valid stage transitions offered and enforced | |
| A3 | Events, media upload, publishing | admin | ☐ | Upload reports partial failures; variants generated; publish blocked without consent | |
| A4 | Quotes/contracts | admin | ☐ | Versions immutable; sent version is what customer approves | |
| A5 | Production/deliverables, reviews, album submissions | admin | ☐ | | |
| A6 | Finance | admin+backend | ☐ | Totals from backend; payment idempotent; staff denied | |
| A7 | Staff/equipment | admin+backend | ☐ | Conflict rules enforced and explained | |
| A8 | Support, users/permissions, settings | admin | ☐ | Owner-only user management | |
| B1 | Backups | admin+backend | ☐ | Paginated export; partial/failed status accurate; storage covered separately; restore doc | |
| Q1 | Build/lint/types | lead | ☐ | `tsc`, `lint`, `build` clean | |
| Q2 | Secrets scan | QA | ☐ | No secret key strings in `.next/static` | |
| D1 | Staging deploy | lead | ⛔ | Needs access token from user | |
