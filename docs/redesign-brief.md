# Public-site redesign — shared brief (all agents read this first)

Project: «ستوديو وتسجيلات السلطان», Next.js 16 app in `web/` (read `web/AGENTS.md`: this Next.js has breaking changes —
check `web/node_modules/next/dist/docs/` before using an API you are not sure about). Branch `redesign/cinematic`.
Cache Components are on (`"use cache"`, `cacheTag`); `export const runtime` is NOT allowed in route files.

## Direction (approved): black cinematic
Charcoal/near-black backgrounds, ivory text, calm gold for buttons and details, big real imagery, clear headings with a
short gold rule under them, compact footer. RTL Arabic. Reference mockups (visual reference ONLY — never copy their
images, names, durations, emails, badges, ratings or any text that is not in our data):
`C:\Users\UnclePC\AppData\Local\Temp\claude\c--Users-UnclePC-Desktop-Snorkel--proj-Alsultan-Site\09ad232e-c855-4246-b348-8d77cb865140\images\`
`4.png` من نحن/تواصل · `5.png` الخدمات · `6.png` العروض (empty state) · `7.png` البكجات · `8.png` تفاصيل فيديو · `9.png` ألبوم · `10.png` أعمالنا.
The home page keeps its current composition (hero «فرحتك إلها حكاية», the self-hosted promo film, works + categories)
re-themed to this direction, plus a packages preview.

## Hard rules
- Content comes from the database/CMS (existing queries in `src/features/public-content/*`). No hardcoded texts, prices,
  works, services or packages in place of the existing data flow. Fallbacks that already exist stay as they are.
- Real assets only: the ORIGINAL logo file already in the project (`src/components/brand/Logo.tsx` / active logo route),
  real album photos via `/p/<id>/thumb|display`, real YouTube videos with their saved original titles. A page hero may
  use ONE real photo chosen in the CMS (`business_settings.hero_cover_photo_id`) or the promo poster; otherwise the
  CSS ink texture. Never generated/stock images, never invented names/durations/emails/badges/ratings.
- Phone: +970598677477 (from settings). WhatsApp/YouTube/Facebook links from settings.
- Services cover men AND women; keep the groom / men's occasions presence in the identity.
- Images: album photos and covers show the WHOLE image with `object-contain` on a dark surface — no crop, no stretch,
  no hiding the watermark, keep the original aspect ratio (portrait and landscape). No hover zoom that crops.
- Never expose originals or storage paths; do not change RLS, grants, migrations or server queries' security. Keep
  publication-consent behaviour.
- YouTube: never autoplay with sound, never mount every player on page load (click-to-load / lite embed, as today).
- Motion: subtle fade/rise reveals, smooth category transitions, calm hover/press states, smooth open/close of the
  lightbox/video dialog, limited motion on home that never blocks content or waits for an intro. Respect
  `prefers-reduced-motion` (disable non-essential motion). No layout shift while reading, no custom cursor, no scroll
  hijacking, no heavy effects.
- Mobile-first for real: 320, 390, 768, 1440, 1920 px — no horizontal scroll, no clipped text, touch targets ≥ 44px,
  visible focus, AA contrast, keyboard navigation.
- Footer compact; do not repeat huge booking CTAs on every page.
- Keep routes/URLs/SEO metadata/JSON-LD as they are; do not add duplicate routes.
- Do NOT bring back the client portal, booking forms, SMTP or Turnstile to the visitor UI.
- KEEP every existing `data-*` attribute and `data-testid` used by tests (e.g. `data-package-card`, `data-package-group`,
  `data-package-items`, `data-package-price`, `data-package-gift`, `data-package-featured`, `data-offer-card`,
  `data-offer-price`, `data-offer-period`, `data-offer-package`, `data-offer-items`, `data-offer-terms`, `data-offer-dates`,
  `data-work-tab`, `data-whatsapp-cta`, `data-site-footer`, `data-announcement-link`, `data-home-section`, gallery/lightbox
  testids, header nav `aria-label="القائمة الرئيسية"`, mobile menu button «فتح القائمة» and dialog «القائمة»). Grep
  `tests/e2e` for selectors touching your files before changing markup. If a test assumption must change, say so in
  your report — never weaken a test just to pass.
- Admin (`src/app/admin`, `src/features/*-admin`), auth, portal, APIs, DB: OUT OF SCOPE. Do not touch.
- Do not commit, push, deploy or run migrations. The lead integrates, tests and deploys.
- Only edit the files your task owns. If you need a change in another agent's file, describe it in your report.

## Shared foundation (Agent A provides; B and C use it)
Tokens in `src/app/globals.css` (+ `@theme`), and components in `src/components/ui/` such as `Section`,
`SectionHeading` (title + gold rule + optional lead), `PageHero` (title, lead, optional real photo, breadcrumb),
`Button`/`ButtonLink` variants (gold primary, outline ivory, ghost), `Card` (dark surface, hairline border),
`Reveal` motion wrapper honouring reduced motion. Read their source before use.
