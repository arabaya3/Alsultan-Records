# Facebook photo import — log (2026-10-16)

**Source:** https://www.facebook.com/Sultan.Rec0rds2 (page title "ستوديو وتسجيلات السلطان"); share link https://www.facebook.com/share/19hW2P1nv9/ resolves to this page.
**Access:** the owner signed in to Facebook in a browser window on their own machine (owner-authorized session). Nothing was posted or changed on Facebook; the session was used read-only.
**Method:** Owner-authorized logged-in browser session (owner signed in); full-size images from each photo page; candidates = first 40 photos per album; visual selection by contact sheet; near-duplicates (dHash ≤ 5) excluded.
**Rights:** Published on the studio's own Facebook page; imported at the owner's request; watermarks kept, no cropping/editing.
**Storage:** originals in the private bucket `album-media` (never public — migration 0016); visitors get thumb (480 px) / display (1600 px) WebP variants only through `/p/<id>/<variant>`.
**Not imported:** the generic "Photos" album (329 mixed items: profile/cover/posts), page profile & cover photos, casual guest-only photos, near-duplicates and close repeats. Album dates left empty (titles only give the year 2026).

| Album (title as on Facebook) | Site slug | Photos imported / available on FB | Cover | Facebook album |
|---|---|---|---|---|
| حفل زفاف العريس داود جهاد نعيرات - ميثلون - 2026 | `wedding-dawood-nairat-2026` | 22 / 1,150 | fbid 1086549614123902 | https://www.facebook.com/media/set/?set=a.1086537544125109 |
| حفل زفاف العريس ليث الحج علي جرار - ميثلون - 2026 | `wedding-laith-jarrar-2026` | 19 / 2,015 | fbid 1088525793926284 | https://www.facebook.com/media/set/?set=a.1088508273928036 |
| حفل زفاف العريس عماد حمدان ربايعة - ميثلون - 2026 | `wedding-emad-rabaya-2026` | 20 / 1,527 | fbid 1090050343773829 | https://www.facebook.com/media/set/?set=a.1090011230444407 |
| حمّام وزينة العريس عماد حمدان ربايعة | 2026 | `groom-prep-emad-rabaya-2026` | 13 / 131 | fbid 1091793336932863 | https://www.facebook.com/media/set/?set=a.1091801640265366 |
| خطوبة العريس احمد عبدالعزيز ربايعة - 2026 ميثلون | `engagement-ahmad-rabaya-2026` | 16 / 350 | fbid 1092684360177094 | https://www.facebook.com/media/set/?set=a.1092704030175127 |
| حفل زفاف العريس احمد فتحي ربايعة - ميثلون - 2026 | `wedding-ahmad-fathi-rabaya-2026` | 18 / 1,567 | fbid 1094340660011464 | https://www.facebook.com/media/set/?set=a.1094286983350165 |
| حفل زفاف العريس يوسف جهاد فرح - ميثلون - 2026 | `wedding-yousef-farah-2026` | 20 / 515 | fbid 1099391022839761 | https://www.facebook.com/media/set/?set=a.1099378066174390 |

**Total:** 128 photos in 7 albums. Per-photo source URLs are stored on each `album_photos.source_url` and in `web/content/facebook-albums.json`.

**Import:** `node scripts/import-fb-albums.mjs --target local|staging --apply --publish` — idempotent (albums by slug, photos by source_url); second run on staging: 0 added, 128 kept.

**Verification (live):** 7/7 covers and all album thumbnails load on desktop and mobile, no overflow; lightbox ←/→ (RTL) and Esc work; anon download of an original → denied; `/p/<id>/original` → 404; staging-verify 69/69.

To add more photos later: use `/admin/albums` (bulk upload) or extend `content/facebook-albums.json` and re-run the import.
