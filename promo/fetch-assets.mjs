// Downloads the studio's own YouTube thumbnails and captures real UI screenshots of the live site.
// Usage: node promo/fetch-assets.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../web/package.json'));
const { chromium } = require('playwright');

const IDS = ['bY-HEOQVEZA','A7Bby0aFuz0','31fqUFYa_LI','gUhswny61EY','GTa4oM-TLw0','1HyF-9dPZno','y0-ajKb7Umw','LKpD2MqUoF0'];
const SITE = 'https://sultan-records.vercel.app';
const thumbs = path.join(here, 'assets/thumbs'); const ui = path.join(here, 'assets/ui');
fs.mkdirSync(thumbs, { recursive: true }); fs.mkdirSync(ui, { recursive: true });

for (const id of IDS) {
  for (const q of ['maxresdefault', 'hqdefault']) {
    const r = await fetch(`https://i.ytimg.com/vi/${id}/${q}.jpg`);
    if (r.ok) { fs.writeFileSync(path.join(thumbs, `${id}.jpg`), Buffer.from(await r.arrayBuffer())); console.log(id, q); break; }
  }
}

const browser = await chromium.launch();
const info = {};
for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, reducedMotion: 'reduce', locale: 'ar', isMobile: name === 'mobile', hasTouch: name === 'mobile' });
  const page = await ctx.newPage();
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1500); };
  const shot = async (f) => { await page.screenshot({ path: path.join(ui, `${name}-${f}.png`) }); console.log(name, f); };
  await page.goto(SITE + '/', { waitUntil: 'domcontentloaded' }); await settle();
  info.tel = await page.$eval('a[href^="tel:"]', a => a.getAttribute('href')).catch(() => null);
  await shot('home');
  await page.goto(SITE + '/work', { waitUntil: 'domcontentloaded' }); await settle();
  // record chip position for the animated tap ring
  info[name + 'Chip'] = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a,button')].find(e => /wedding|أعراس|عرس|زفاف/.test((e.getAttribute('href') || '') + e.textContent) && e.getBoundingClientRect().top < innerHeight && e.getBoundingClientRect().width < 300);
    if (!a) return null; const r = a.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: a.textContent.trim(), href: a.getAttribute('href') };
  });
  await shot('work');
  await page.goto(SITE + '/work?cat=wedding', { waitUntil: 'domcontentloaded' }); await settle();
  info[name + 'Card'] = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/work/v/"],button')].find(e => e.querySelector('img') && e.getBoundingClientRect().top > 0 && e.getBoundingClientRect().top < innerHeight - 100);
    if (!a) return null; const r = a.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, href: a.getAttribute('href') };
  });
  await shot('cat');
  // open video dialog by clicking the card
  const vid = (info[name + 'Card'] && info[name + 'Card'].href) || null;
  if (info[name + 'Card']) { await page.mouse.click(info[name + 'Card'].x, info[name + 'Card'].y); await page.waitForTimeout(3500); await shot('dialog'); }
  info[name + 'DialogUrl'] = page.url();
  const vpath = vid && vid.includes('/work/v/') ? vid : '/work/v/bY-HEOQVEZA';
  await page.goto(SITE + vpath, { waitUntil: 'domcontentloaded' }); await settle(); await page.waitForTimeout(2500);
  await shot('video');
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(ui, 'capture-info.json'), JSON.stringify(info, null, 2));
console.log(info);
