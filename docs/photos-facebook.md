# Photo albums — Facebook source status (2026-10-16)

Page provided by the owner: https://www.facebook.com/Sultan.Rec0rds2 (title "ستوديو السلطان | Jenin").

## What was checked (read-only, no login)
- The public page HTML loads, but the album list/photos are not present without signing in; `m.facebook.com/…/photos` redirects to the login page.
- No login, scraping workaround or platform restriction bypass was attempted. Nothing was imported.

## What is ready
- `/work?tab=photos` and album pages (`/work/albums/<slug>`) with responsive grid, lightbox (touch, keyboard, Esc), progressive loading, error/empty states, source credit line.
- Admin `/admin/albums`: create album (title, date, source label + URL, rights note), bulk upload (JPEG/PNG/WebP/AVIF ≤ 25 MB each), automatic WebP thumb/display variants, original kept private and untouched (watermarks are never cropped or removed), reorder, set cover, hide/show photo, publish/hide album.
- Originals are never public (migration 0016); visitors only receive thumb/display variants through `/p/<id>/<variant>`.

## What the owner needs to provide
For each album to publish: the original image files (not screenshots), the album title/date, and confirmation the studio may republish them. Easiest sources:
1. The studio's own original files from the shoot (best quality), or
2. Meta Business Suite → the page → Content → Photos/Albums → download, or Facebook "Download your information" for the page (Settings → Your Facebook information → Download your information → Photos and videos, high quality).
Then upload via `/admin/albums` → new album → bulk upload, set the cover, and publish. Keep the Facebook album URL in "source URL".
