# Accessibility notes (release blocker)

Date: 2026-10-16. Local stack, production build (`npm run build && npx next start -p 3900`), Chromium (Playwright 1.64), `@axe-core/playwright` 4.14.0.

**No screen reader was run.** Everything below was checked by automation (axe-core and Playwright keyboard/DOM assertions). Announcements are inferred from roles and ARIA attributes; nobody listened to them.

## What automation checked

### axe-core (`web/tests/e2e/a11y-axe.spec.ts`)
- Tags: `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`. Best-practice-only rules (`region`, `heading-order`, `landmark-*`) are not in these tags and were not asserted.
- 41 scans (full JSON with every node: `docs/a11y/axe-results.json`):
  - Public at 1440 and 390: `/`, `/work`, `/work/<published slug>`, `/services`, `/faq`, `/contact`, `/login`, 404, `/book` step 1, `/book` step 2, `/book` with server field errors, and `/track` with a not-found result.
  - Portal (customer A): `/portal`, event overview, gallery with the lightbox open, selection review step, video page, contracts, payments.
  - Admin (owner): overview, customers, booking detail, event detail, event media, users, settings, an open confirm dialog, finance with a payment-form error, and overview at 390 with the nav open.
- Scans run with `prefers-reduced-motion: reduce`, so scroll-reveal fades can't produce half-faded contrast results. Colours are the same in both modes.
- Final result: **0 critical, 0 serious, 0 moderate, 0 minor** on all 41 scans.

### Keyboard, focus, dialogs, forms, RTL, zoom, motion (`web/tests/e2e/a11y-manual.spec.ts`)
| Check | How it is verified |
|---|---|
| `lang="ar" dir="rtl"` | `<html>` attributes on public, portal and admin. |
| Skip link | On `/`, `/book`, `/portal` and `/admin`, the first Tab focuses "تخطَّ إلى المحتوى" (visible with a ring). Enter moves focus to `<main id="main">`, and the next Tab lands inside `main`. |
| Keyboard-only booking | Tab, typing and Enter only: step 1 (select via ArrowDown, date typed), then "التالي" moves focus to the step-2 heading, then city, then "أرسل الطلب". Success is shown in `role=status aria-live=polite`. |
| Form errors | Booking with server field errors: focus goes to the first invalid field, which has `aria-invalid="true"` and `aria-describedby` pointing to its error text, and a `role=alert` summary is present. The phone hint is linked with `aria-describedby`. Track not-found is in an `aria-live=polite` region. A login failure and an admin payment error are `role=alert`. |
| Portal keyboard | Keyboard login, Tab to "عرض الصورة 1", Enter. The lightbox opens with `role=dialog aria-modal=true` and an accessible name, and focus is on "إغلاق". ArrowLeft goes to the next image and ArrowRight to the previous (RTL). Tab stays trapped. Esc closes it and focus returns to the tile. |
| Selection | Tab to the first select toggle (accessible name "اختيار الصورة 1", state in `aria-pressed`), then Enter toggles it and the count updates. In review, "إرسال الاختيار" moves focus to "تأكيد الإرسال", "تراجع" moves it back to "إرسال الاختيار", and the confirmed submit locks the selection. |
| Admin confirm dialog | Native `<dialog>` opened with `showModal()` (`:modal`), with `aria-labelledby` pointing to the title (unique ids). Focus starts inside and stays there for 6 Tabs. Esc and "تراجع" both close it with focus back on the trigger. Nothing is removed. |
| Mobile navs | Public menu: `role=dialog aria-modal=true`, labelled "القائمة", trapped, Esc restores focus to the opener. Admin nav toggle: `aria-expanded` changes and the labelled `<nav>` becomes visible. |
| Focus visible | Every focus stop in the booking, portal and admin keyboard flows has a non-`none` outline or box-shadow. Elements with tabindex=-1 and the date input's internal segments are excluded. |
| RTL icons | Home "see all" chevrons use the left-pointing path (forward in RTL). In the lightbox, "السابقة" sits on the right showing →, and "التالية" sits on the left showing ←. |
| Bidi | Every occurrence of the LTR seed title on `/`, `/work` and the project page is inside `<bdi>`/`dir=auto`. Portal event titles and the event-page `h1` use `<bdi dir=auto>`. Phone, email and code inputs are `dir=ltr`. |
| 200% zoom | Viewports 720×500 and 640×400 at DPR 2 on `/` and `/book`: no horizontal scroll, and no text element is clipped by overflow or pushed off-screen. |
| Reduced motion | `/`, `/work`, `/services`, `/book` scrolled through: 0 running Web Animations that animate transform/translate/scale/rotate, and no `[data-reveal]`/`h1` with a non-identity transform. |

## Fixes made (app)
| Issue (axe impact / manual) | Fix |
|---|---|
| serious `color-contrast`: home "كيف نشتغل" step numbers `#d6a63a` on cream measured 2.04:1 | New token `--color-gold-text: #8a6514` (4.8:1 on cream) in `web/src/styles/tokens.css:15` and `web/src/app/globals.css:13`. Used at `web/src/app/(public)/page.tsx:222`. Review stars use it too (`page.tsx:239`, now `role="img"` so the `aria-label` is allowed). |
| serious `scrollable-region-focusable`: admin tables (`overflow-x-auto`) not keyboard-scrollable | `web/src/features/admin/ui.tsx:79`: `role="region" tabIndex={0}` plus an `aria-label` built from the column heads. |
| serious `aria-prohibited-attr`: lightbox loading placeholder `div[aria-label]` | `web/src/components/media/gallery/Lightbox.tsx:152` `role="status"`. The same latent issue in 4 skeletons (`app/portal/page.tsx`, `components/ui/States.tsx`, `features/admin/ui.tsx`, `features/portal/components/PortalUi.tsx`) also got `role="status"`. |
| critical `label`: the selection-review note `<textarea>` had a `<label>` with no `for` | `web/src/features/galleries/components/EventGallery.tsx:476` `htmlFor={useId()}`. |
| serious `label-content-name-mismatch` (caught after an intermediate fix) / select toggles all named "اختيار" | `EventGallery.tsx:375`: visible text plus an sr-only " الصورة N", so the name contains the visible label and is unique. |
| Duplicate `id="confirm-title"` when a page has several confirm dialogs (event detail has 4+) | `web/src/features/admin/ActionForm.tsx:50-51,106-114`: `useId()` for the title, and `aria-describedby` for the body. |
| No skip link in admin | `web/src/app/admin/layout.tsx:33-38`. Every `<main id="main">` now has `tabIndex={-1}` so the skip link really moves focus (6 layouts). `globals.css:51` hides the ring on that programmatic focus. |
| Focus lost when a confirm row replaces the pressed button (selection submit, quote/contract approve) | `EventGallery.tsx:49-56` and `web/src/features/portal/components/ConfirmAction.tsx:21-28`: focus moves to the replacing button, back on "تراجع", and to the result status. |
| Booking: server errors did not move focus; city/venue/message errors had no `aria-invalid` | `web/src/features/bookings/public/BookingForm.tsx:77-82` focuses the first `[aria-invalid]`, else the `role=alert` summary. `aria()` is applied to all fields, and the phone hint is linked. |
| LTR user content not bidi-isolated in portal/admin | `<bdi dir="auto">` on portal event titles (`app/portal/page.tsx:31`, `events/[eventId]/layout.tsx:24`), deliverable titles (videos list, video page, files), video comment bodies (`VideoReview.tsx:272`), and every admin `RowLink` (`features/admin/ui.tsx:102`). |

## Remaining (moderate/minor and not covered)
- axe reports nothing at any impact on the scanned states. That doesn't cover unscanned screens: admin quotes, contracts, production, calendar, equipment, staff, support, reviews, backups, customer edit, and the portal files/quotes tabs.
- After "تأكيد الإرسال" in the selection, the pressed button is disabled while saving, so focus drops to `<body>` until the locked message appears. The status is announced (`role=status`), but focus is not moved there. Minor.
- Admin text uses literal "←"/"→" between values (booking history, equipment out/return). They point the right way for RTL, but a screen reader may read them as "left arrow". Minor.
- The contract body (`portal/.../contracts`) is not bidi-isolated as a whole. It is long Arabic legal text, and isolating it could flip alignment.
- Admin forms (`ActionForm`, `PaymentForm`) announce errors through `role=alert` but leave focus on the submit button. Acceptable but different from the public booking form.
- Turnstile (when configured) was not tested. Its widget accessibility is the vendor's.

## Still needs a human (screen-reader pass)
Run NVDA + Firefox/Chrome on Windows and VoiceOver + Safari on iOS/macOS, in Arabic:
1. Booking: field labels and hints read in order, step change announced, error summary and field errors read, and the success tracking code read digit by digit (LTR run inside RTL).
2. Track: the not-found and status results are announced without moving focus.
3. Portal: the event card reading order, the lightbox announcing "N من M" on arrow keys, the toggle state ("مضغوط"/pressed) read for select toggles, and the video player controls and comment timecodes.
4. Admin: table regions (the `aria-label` lists the column heads, which may be verbose), the confirm dialog title and body read on open, and the nav toggle state.
5. Mixed Arabic/Latin strings (customer names, `[DEV]` titles, phone numbers) read in a sensible order.
6. Real browser zoom to 200% and 400% (we only emulated it with half-width viewports) and Windows High Contrast / forced colours.
