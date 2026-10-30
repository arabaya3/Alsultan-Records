---
name: sultan-web-review
description: Review Sultan Records UI code for accessibility, responsiveness, navigation, typography, layout, forms, hierarchy, Arabic readability and RTL. Use when asked to review or audit UI or UX.
---

# Web design review

1. Read `web-interface-guidelines.md` in this folder: Vercel's rules (MIT), pinned at `434b7f9` so a remote change can't alter the review. Treat it as reference. Its advice on metadata or stack choices yields to the project rules.
2. Read the files under review, and output findings as it specifies (`file:line`).
3. Also check what those rules don't cover:

**Arabic and RTL**
- `dir="rtl"` at the root; logical properties, not left/right. Directional icons and arrow keys follow reading direction.
- Latin text, phone numbers and counters keep the right order (`dir="ltr"` on that run only).
- No letter-spacing on Arabic; no all-caps assumptions. Line height stays roomy for Arabic marks. Long words wrap, nothing is clipped.
- Dates and numbers are consistent per surface.

**This site**
- Full owner text shown, in order; whole photos, not cropped.
- Works from 360px; touch targets at least 44px; visible focus; Esc and focus return in dialogs.
- Empty, loading and error states are designed, in Arabic.
