// Original soundtrack for the Sultan Records promo (28 s). No third-party material.
// Deterministic (fixed PRNG seed). Output: 32-bit float WAV, 48 kHz stereo, dry
// (reverb, fades and loudness are applied by promo/audio/build.sh).
// Usage: node promo/audio/generate.mjs <out.wav>
import { writeFileSync } from 'node:fs';

const SR = 48000, DUR = 28.0, N = Math.round(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N);
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const add = (i, v, pan = 0) => {
  if (i >= 0 && i < N) { L[i] += v * (1 - pan) * 0.7071; R[i] += v * (1 + pan) * 0.7071; }
};

// Maqam Hijaz on D: D Eb F# G A Bb C. Chords (MIDI notes).
const chords = [
  { t: 0.0,  e: 8.6,  n: [50, 57, 62, 66] },     // D      logo + tagline
  { t: 8.6,  e: 13.6, n: [43, 55, 58, 62] },     // Gm     services (rise)
  { t: 13.6, e: 16.1, n: [48, 55, 60, 63] },     // Cm
  { t: 16.1, e: 23.0, n: [45, 57, 61, 64] },     // A      website
  { t: 23.0, e: 28.0, n: [38, 50, 57, 62, 66] }, // D      resolve + tail
];
// Warm pad: three soft harmonics, slow attack/release, slight L/R detune.
for (const c of chords) {
  const s0 = Math.round(c.t * SR), s1 = Math.min(N, Math.round((c.e + 0.8) * SR));
  const len = (s1 - s0) / SR;
  for (const m of c.n) {
    const f = hz(m);
    for (let i = s0; i < s1; i++) {
      const t = (i - s0) / SR;
      const env = Math.min(1, t / 0.9) * Math.min(1, (len - t) / 0.8);
      const ph = 2 * Math.PI * f * t;
      L[i] += (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph)) * env * 0.045;
      R[i] += (Math.sin(ph * 1.003) + 0.35 * Math.sin(2 * ph * 1.003)) * env * 0.045;
    }
  }
}

// Swelling low-passed noise that peaks at tEnd (whoosh into a wipe).
function whoosh(tEnd, dur, gain) {
  let lp = 0; const s0 = Math.round((tEnd - dur) * SR);
  for (let k = 0; k < (dur + 0.3) * SR; k++) {
    const t = k / SR, x = t / dur;
    const env = x <= 1 ? x * x : Math.exp(-(t - dur) * 14);
    lp += (0.02 + 0.12 * Math.min(1, x)) * (rnd() - lp);
    add(s0 + k, lp * env * gain, Math.sin(t * 3) * 0.6);
  }
}
// Karplus-Strong pluck (oud-like).
function pluck(t0, midi, gain, pan = 0, dur = 1.6) {
  const p = Math.round(SR / hz(midi)); const buf = new Float32Array(p);
  for (let k = 0; k < p; k++) buf[k] = rnd();
  let idx = 0; const s0 = Math.round(t0 * SR), n = dur * SR;
  for (let k = 0; k < n; k++) {
    const nx = (idx + 1) % p; const v = buf[idx];
    buf[idx] = 0.4985 * (buf[idx] + buf[nx]); idx = nx;
    add(s0 + k, v * gain * Math.min(1, (n - k) / (0.2 * SR)), pan);
  }
}
// Darbuka: doum (low pitch-drop sine) and tek (short high-passed noise).
function doum(t0, g) {
  const s0 = Math.round(t0 * SR);
  for (let k = 0; k < 0.35 * SR; k++) { const t = k / SR; add(s0 + k, Math.sin(2 * Math.PI * (70 + 60 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9) * g); }
}
function tek(t0, g, pan = 0.2) {
  const s0 = Math.round(t0 * SR); let hp = 0, prev = 0;
  for (let k = 0; k < 0.08 * SR; k++) { const t = k / SR, x = rnd(); hp = 0.7 * (hp + x - prev); prev = x; add(s0 + k, hp * Math.exp(-t * 60) * g, pan); }
}
// Soft bell (inharmonic partials) for accents.
function bell(t0, midi, g, pan = 0) {
  const f = hz(midi), s0 = Math.round(t0 * SR);
  for (let k = 0; k < 2.5 * SR; k++) {
    const t = k / SR;
    const v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 2) + 0.4 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 4) + 0.2 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t * 7);
    add(s0 + k, v * g * Math.min(1, k / 48), pan);
  }
}

const B = 0.625; // beat at 96 BPM
// 1) Logo hit.
bell(0.3, 74, 0.10); doum(0.3, 0.35);
// 2) Hijaz melody on plucks during logo/tagline.
const mel = [62, 63, 66, 67, 69, 67, 66, 63, 62, 63, 66, 69];
mel.forEach((m, i) => pluck(1.25 + i * B * (i < 8 ? 1 : 0.9), m, 0.22, i % 2 ? 0.3 : -0.3));
// 3) Rise into services + whooshes/hits on the wipes.
whoosh(8.6, 2.2, 0.55); whoosh(11.1, 0.9, 0.35); whoosh(13.6, 0.9, 0.35);
for (const t of [8.6, 11.1, 13.6]) { doum(t, 0.6); bell(t, 81, 0.05, 0.3); }
// 4) Darbuka groove (maqsum-like) 8.6-23 s.
const pat = [['D', 0], ['T', 1], ['T', 3], ['D', 4], ['T', 6], ['t', 7]];
for (let bar = 8.6; bar < 22.9; bar += 4 * B) {
  for (const [k, s] of pat) {
    const t = bar + s * B * 0.5; if (t >= 23) continue;
    if (k === 'D') doum(t, 0.4); else tek(t, k === 'T' ? 0.18 : 0.1, k === 't' ? -0.3 : 0.3);
  }
}
// Plucked counter-line.
[[9.85, 69], [10.5, 70], [12.35, 67], [13.0, 66], [14.85, 63], [15.5, 62], [17.0, 64], [18.25, 66], [20.0, 69], [21.25, 67]]
  .forEach(([t, m], i) => pluck(t, m, 0.17, i % 2 ? 0.4 : -0.4));
// 5) Website tap moments.
bell(17.55, 86, 0.07, 0.2); bell(19.0, 86, 0.07, -0.2); tek(17.55, 0.12); tek(19.0, 0.12);
// 6) Resolve at 23 s and tail.
doum(23.0, 0.7); bell(23.0, 74, 0.12);
[62, 66, 69, 74].forEach((m, i) => pluck(23.0 + i * 0.18, m, 0.18, (i - 1.5) * 0.25, 3));

// Peak-normalise to 0.7 and write 32-bit float WAV.
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = 0.7 / peak; const data = Buffer.alloc(N * 8);
for (let i = 0; i < N; i++) { data.writeFloatLE(L[i] * g, i * 8); data.writeFloatLE(R[i] * g, i * 8 + 4); }
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24);
h.writeUInt32LE(SR * 8, 28); h.writeUInt16LE(8, 32); h.writeUInt16LE(32, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
const out = process.argv[2] || 'sultan-promo-dry.wav';
writeFileSync(out, Buffer.concat([h, data]));
console.log('wrote', out, '(raw peak', peak.toFixed(3) + ')');
