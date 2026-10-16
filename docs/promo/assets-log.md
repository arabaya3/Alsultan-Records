# Promo assets log

The videos are **silent**. They contain no audio track (`-an`) and no third-party music or SFX.

| Asset | Source | Owner | License / permission basis | Used in |
|---|---|---|---|---|
| `web/public/brand/logo-main.webp` | Repo brand file | Sultan Records (client) | Client's own logo, used unchanged (only opacity, scale, position and circular-mask animation) | Shot 1, shot 5, covers |
| `web/public/brand/logo-round.webp` | Repo brand file | Sultan Records | Not used: it has a white background, so logo-main is used on charcoal | — |
| Alexandria font | fonts.googleapis.com (loaded at render time) | Google Fonts / designers | SIL Open Font License 1.1 | All display text |
| IBM Plex Sans Arabic font | fonts.googleapis.com | IBM | SIL Open Font License 1.1 | URL text, UI chrome |
| `promo/assets/thumbs/A7Bby0aFuz0.jpg` | https://i.ytimg.com/vi/A7Bby0aFuz0/maxresdefault.jpg | Sultan Records (channel UCpxtdVABBIOaNLne-0_dDmQ) | The studio's own YouTube thumbnail, used to promote the studio. Burned-in watermark kept | Shot 3, slide 1 |
| `promo/assets/thumbs/31fqUFYa_LI.jpg` | i.ytimg.com/vi/31fqUFYa_LI/maxresdefault.jpg | same | Studio's own YouTube thumbnail | Shot 3, slide 2 |
| `promo/assets/thumbs/LKpD2MqUoF0.jpg` | i.ytimg.com/vi/LKpD2MqUoF0/maxresdefault.jpg | same | Studio's own YouTube thumbnail | Shot 3, slide 3 (DJ) |
| `promo/assets/thumbs/GTa4oM-TLw0.jpg` | i.ytimg.com/vi/GTa4oM-TLw0/maxresdefault.jpg | same | Studio's own YouTube thumbnail | Landscape inset on slide 1; background of the covers |
| `promo/assets/thumbs/1HyF-9dPZno.jpg` | i.ytimg.com/vi/1HyF-9dPZno/maxresdefault.jpg | same | Studio's own YouTube thumbnail | Landscape inset on slide 2 |
| `promo/assets/thumbs/gUhswny61EY.jpg` | i.ytimg.com/vi/gUhswny61EY/maxresdefault.jpg | same | Studio's own YouTube thumbnail | Landscape inset on slide 3 |
| `promo/assets/thumbs/bY-HEOQVEZA.jpg` | i.ytimg.com/vi/bY-HEOQVEZA/maxresdefault.jpg | same | Studio's own YouTube thumbnail | Shot 2 blurred background |
| `promo/assets/thumbs/y0-ajKb7Umw.jpg` | i.ytimg.com/vi/y0-ajKb7Umw/maxresdefault.jpg | same | Studio's own YouTube thumbnail | Downloaded, not used |
| `promo/assets/ui/desktop-*.png` (home, work, cat, dialog, video) | Playwright capture of https://sultan-records.vercel.app at 1440×900, DPR 2, reduced motion | Sultan Records (client's own site) | Real screenshots of the client's live website. They are not mockups | Shot 4, landscape (work, cat, dialog, video; home not used) |
| `promo/assets/ui/mobile-*.png` | Same pages at 390×844, DPR 2, mobile/touch | same | same | Shot 4, portrait |
| Phone `+970598677477` | Live homepage `a[href^="tel:"]` → `tel:+970598677477` (confirmed at capture time, stored in `promo/assets/ui/capture-info.json`) | — | — | Shot 5 |
| Film grain | Inline SVG `feTurbulence` (self-generated) | — | Original | Overlay |

No YouTube videos were downloaded, only thumbnails. Nothing was uploaded anywhere.
