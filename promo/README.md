# Sultan Records promo: source

This is a deterministic motion-graphics render. `composition.html` takes `?format=landscape|portrait` and holds one paused GSAP master timeline (28 s). `render.mjs` seeks that timeline for each frame at 30 fps, screenshots PNGs into `frames/` (gitignored), and encodes them with FFmpeg.

Run all commands from the repo root. You need Node 22 and FFmpeg with libx264. Playwright and GSAP are loaded from `web/node_modules`, and the fonts come from Google Fonts, so a network connection is needed.

```sh
node promo/fetch-assets.mjs                      # optional: re-download thumbnails + recapture live-site UI
node promo/render.mjs --format landscape         # -> docs/promo/sultan-promo-1920x1080.mp4
node promo/render.mjs --format portrait          # -> docs/promo/sultan-promo-1080x1920.mp4
node promo/render.mjs --format landscape --cover # -> docs/promo/sultan-promo-1920x1080-cover.jpg
node promo/render.mjs --format portrait --cover  # -> docs/promo/sultan-promo-1080x1920-cover.jpg
cd docs/promo && bash ../../promo/review.sh      # contact sheets (1 frame/s) + mean-luma jump check
```

Encoding settings: H.264 High, CRF 18, preset slow, yuv420p, 30 fps, BT.709 tags, `+faststart`, no audio.
See `docs/promo/storyboard.md` and `docs/promo/assets-log.md`.
