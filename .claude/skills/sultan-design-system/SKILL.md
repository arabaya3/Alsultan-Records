---
name: sultan-design-system
description: Sultan Records component and token map. Use when building or changing UI (galleries, video cards, buttons, forms, navigation, admin or portal screens) so it reuses what exists.
---

# Sultan Records design system

The source of truth is the code. Read it before styling; do not import another brand's design.

## Tokens: `web/src/app/globals.css`

- Public (dark): `night-deep`, `night`, `surface`, `surface-2`, `hairline`, `hairline-gold`, `ivory`, `ivory-muted`, `gold`.
- Admin and portal (light): `cream`, `cream-2`, `cream-line`, `on-cream`, `on-cream-muted`, `gold-press`.
- Type: `font-display` (Alexandria), `font-sans` (IBM Plex Arabic), sizes `text-display`, `text-h1`, `text-h2`, `text-h3`.
- Radius: `radius-sm`, `radius-md`, `radius-lg`. Never hard-code a colour a token already covers.

## Components: `web/src/components`

| Need | Use |
|---|---|
| Buttons, links | `ui/Button`, `ui/IconLink`, `ui/WhatsAppCta` |
| Page frame | `ui/Layout` (`Section`), `ui/PageHero`, `layout/` |
| Cards, states | `ui/Card`, `ui/States` |
| Owner's text | `ui/PlainTextBlocks`, `ui/ExpandableText`, `offers/OfferDetails` |
| Filters | `ui/ChipScroller` |
| Albums, viewer | `media/gallery/AlbumCard`, `AlbumGallery`, `Lightbox` |
| Video | `media/youtube/YouTubeCard` |
| Offers, packages | `offers/`, `packages/` |
| Admin UI | `src/features/admin/ui` (`Card`, `Table`, `Badge`, `Notice`, `PageHeader`) |

## Rules

- Search for an existing component first; extend it with a prop rather than duplicating it.
- Public and admin keep separate palettes but the same spacing, focus and form behaviour.
- Album covers: whole image in a reserved 2:3 frame, never cropped. `object-cover` only for the decorative hero backdrop.
- Images come from real albums through `photoUrl()`. Never stock or generated.
- Use logical properties (`ms-`, `pe-`, `start`, `end`). Wrap Latin text and numbers with `dir="ltr"` only where the order breaks.
