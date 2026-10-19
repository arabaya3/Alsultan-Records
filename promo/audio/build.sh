#!/usr/bin/env bash
# Builds the original promo soundtrack and muxes it into both videos
# (video stream copied, never re-encoded). Run from repo root: bash promo/audio/build.sh
set -euo pipefail
A=promo/assets/audio
mkdir -p "$A" docs/promo/silent docs/promo/review
node promo/audio/generate.mjs "$A/sultan-promo-dry.wav"

# Keep the silent masters (first run only) and always mux from them.
for s in 1920x1080 1080x1920; do
  [ -f "docs/promo/silent/sultan-promo-$s.mp4" ] || cp "docs/promo/sultan-promo-$s.mp4" docs/promo/silent/
done

FX="aecho=0.8:0.6:60|130:0.25|0.15,lowpass=f=9000,highpass=f=35,afade=t=in:d=0.5,afade=t=out:st=25.5:d=2.5,atrim=0:28"
LN="I=-14:TP=-1.5:LRA=11"
M=$(ffmpeg -hide_banner -nostats -i "$A/sultan-promo-dry.wav" -af "$FX,loudnorm=$LN:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
j() { echo "$M" | sed -n "s/.*\"$1\" : \"\([^\"]*\)\".*/\1/p"; }
ffmpeg -y -hide_banner -loglevel error -i "$A/sultan-promo-dry.wav" \
  -af "$FX,loudnorm=$LN:measured_I=$(j input_i):measured_TP=$(j input_tp):measured_LRA=$(j input_lra):measured_thresh=$(j input_thresh):offset=$(j target_offset):linear=true,aresample=48000,atrim=0:28" \
  -ac 2 -ar 48000 -c:a aac -profile:a aac_low -b:a 192k "$A/sultan-promo-mix.m4a"

for s in 1920x1080 1080x1920; do
  ffmpeg -y -hide_banner -loglevel error -i "docs/promo/silent/sultan-promo-$s.mp4" -i "$A/sultan-promo-mix.m4a" \
    -map 0:v:0 -map 1:a:0 -c:v copy -c:a copy -movflags +faststart "docs/promo/sultan-promo-$s.mp4"
done

ffmpeg -y -hide_banner -loglevel error -i "$A/sultan-promo-mix.m4a" -filter_complex \
  "[0:a]asplit[a1][a2];[a1]showwavespic=s=1680x320:split_channels=1:colors=0xd4a24c|0xd4a24c[w];[a2]showspectrumpic=s=1400x300:legend=1:scale=log[s];[s]scale=1680:-1[s2];[w][s2]vstack" \
  -frames:v 1 docs/promo/review/audio-waveform.png
rm -f "$A/sultan-promo-dry.wav"   # intermediate, regenerated on each run
echo "audio build done"
