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

Encoding settings: H.264 High, CRF 18, preset slow, yuv420p, 30 fps, BT.709 tags, `+faststart`. `render.mjs` writes a **silent** video, so run the audio step afterwards.
See `docs/promo/storyboard.md` and `docs/promo/assets-log.md`.

## Audio (original soundtrack)

```sh
bash promo/audio/build.sh
```

1. `node promo/audio/generate.mjs` synthesises a dry 28 s stereo WAV. It is deterministic and uses no third-party material.
2. The first run copies the silent renders to `docs/promo/silent/`. Muxing always starts from those copies.
3. FFmpeg processes the dry WAV: aecho, low-pass/high-pass, 0.5 s fade-in, 2.5 s fade-out, and two-pass loudnorm (−14 LUFS, TP −1.5). It encodes AAC-LC 192k 48 kHz stereo to `promo/assets/audio/sultan-promo-mix.m4a`.
4. The audio is muxed into both MP4s with `-c:v copy -movflags +faststart`. Video is not re-encoded.
5. The script writes `docs/promo/review/audio-waveform.png` (waveform + spectrogram) and deletes the intermediate WAV.

If you re-render the video, delete `docs/promo/silent/*.mp4` first so the new silent render gets copied and used for the mux.
