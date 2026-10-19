// Deterministic frame renderer: seeks the paused GSAP master timeline frame by frame and screenshots.
// Usage: node promo/render.mjs --format landscape|portrait [--cover] [--no-encode]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../web/package.json'));
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const format = args[args.indexOf('--format') + 1] === 'portrait' ? 'portrait' : 'landscape';
const cover = args.includes('--cover');
const [W, H] = format === 'portrait' ? [1080, 1920] : [1920, 1080];
const FPS = 30;
const outDir = path.join(here, '../docs/promo');
const tag = `${W}x${H}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('pageerror', e));
const url = pathToFileURL(path.join(here, 'composition.html')).href + `?format=${format}${cover ? '&cover=1' : ''}`;
await page.goto(url, { waitUntil: 'load', timeout: 60000 });
console.log('loaded'); await page.evaluate(() => window.ready.then(() => true)); console.log('ready');
const DUR = await page.evaluate(() => window.DUR);

if (cover) {
  await page.evaluate(() => { window.tl.seek(0); });
  await page.screenshot({ path: path.join(outDir, `sultan-promo-${tag}-cover.jpg`), type: 'jpeg', quality: 92 });
  await browser.close();
  console.log('cover written');
  process.exit(0);
}

const frameDir = path.join(here, 'frames', format);
fs.rmSync(frameDir, { recursive: true, force: true });
fs.mkdirSync(frameDir, { recursive: true });
const N = Math.round(DUR * FPS);
for (let f = 0; f < N; f++) {
  await page.evaluate(t => { window.tl.seek(t, false); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }, f / FPS);
  await page.screenshot({ path: path.join(frameDir, `f${String(f).padStart(5, '0')}.png`), type: 'png' });
  if (f % 60 === 0) console.log(`${format} frame ${f}/${N}`);
}
await browser.close();

if (!args.includes('--no-encode')) {
  const out = path.join(outDir, `sultan-promo-${tag}.mp4`);
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', path.join(frameDir, 'f%05d.png'),
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv', '-movflags', '+faststart', '-an', out], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log('wrote', out);
}
