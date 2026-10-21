// SEO check (read-only) against a running build or the live site — docs/seo-launch.md.
//   node scripts/seo-check.mjs [BASE] [--expect-origin https://sultan-records.vercel.app] [--audit]
// Checks: robots.txt (sitemap link, private paths), sitemap.xml (every URL on the expected origin, returns 200,
// is indexable, has a self canonical, no admin/portal/storage URLs), per-page head (title, description, canonical,
// og:url/og:image on the expected origin, JSON-LD parses), private pages noindex. --audit prints every page's head.
const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:\/\//.test(a)) ?? "https://sultan-records.vercel.app").replace(/\/+$/, "");
const ORIGIN = args.includes("--expect-origin") ? args[args.indexOf("--expect-origin") + 1] : "https://sultan-records.vercel.app";
const AUDIT = args.includes("--audit");
// --forbid <path>: a draft / unpublished path that must appear in neither the sitemap nor any JSON-LD (repeatable)
const FORBID = args.flatMap((a, i) => (a === "--forbid" ? [args[i + 1]] : []));
const imageOk = (u) => !u || u.startsWith(ORIGIN) || u.startsWith("https://i.ytimg.com/"); // own origin or YouTube thumbnail
const PRIVATE = ["/admin", "/portal", "/login", "/auth", "/api", "/track"];
const STORAGE = /supabase\.co|\/storage\/v1\/|original\.(jpg|jpeg|png|webp|avif|tiff?|cr2|cr3|nef|nrw|arw|dng|raf|orf|rw2|pef|srw)/i;

let fails = 0;
const ok = (c, msg) => {
  console.log(`${c ? "✓" : "✗"} ${msg}`);
  if (!c) fails++;
};

async function head(path) {
  const r = await fetch(BASE + path, { redirect: "manual" });
  const h = await r.text();
  const g = (re) => (h.match(re) || [])[1];
  const ld = [...h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => {
    try {
      return JSON.parse(m[1]);
    } catch {
      return "BAD";
    }
  });
  return {
    status: r.status,
    xrobots: r.headers.get("x-robots-tag"),
    html: h,
    title: g(/<title>([^<]*)<\/title>/),
    desc: g(/<meta name="description" content="([^"]*)"/),
    canonical: g(/<link rel="canonical" href="([^"]*)"/),
    robots: g(/<meta name="robots" content="([^"]*)"/),
    ogUrl: g(/<meta property="og:url" content="([^"]*)"/),
    ogImage: g(/<meta property="og:image" content="([^"]*)"/),
    verification: g(/<meta name="google-site-verification" content="([^"]*)"/),
    ld,
  };
}
const types = (ld) => ld.flatMap((j) => (j === "BAD" ? ["BAD"] : [].concat(j["@graph"] ?? j).map((x) => x["@type"])));

// robots.txt
const robots = await (await fetch(BASE + "/robots.txt")).text();
ok(robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`), `robots.txt links ${ORIGIN}/sitemap.xml`);
for (const p of ["/admin", "/portal", "/login", "/api"]) ok(robots.includes(`Disallow: ${p}`), `robots.txt disallows ${p}`);

// sitemap.xml
const sm = await (await fetch(BASE + "/sitemap.xml")).text();
const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const lastmods = [...sm.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
ok(urls.length > 0, `sitemap has ${urls.length} URLs (${lastmods.length} with lastmod)`);
ok(urls.every((u) => u === ORIGIN || u.startsWith(ORIGIN + "/")), "every sitemap URL is on the canonical origin (no localhost / preview)");
ok(!urls.some((u) => PRIVATE.some((p) => new URL(u).pathname.startsWith(p)) || STORAGE.test(u)), "no private, admin or storage URLs in the sitemap");
ok(new Set(urls).size === urls.length, "no duplicate sitemap URLs");
for (const f of FORBID) ok(!urls.some((u) => u.includes(f)), `sitemap does not contain ${f}`);
const today = new Date().toISOString().slice(0, 10);
ok(lastmods.filter((d) => d.startsWith(today)).length < Math.max(2, lastmods.length / 2), "lastmod is not blanket-stamped with today");

for (const u of urls) {
  const p = new URL(u).pathname;
  const m = await head(p);
  const indexable = !/noindex/i.test(m.robots ?? "") && !/noindex/i.test(m.xrobots ?? "");
  const ldBad = types(m.ld).includes("BAD");
  const leaks = STORAGE.test(JSON.stringify(m.ld)) || (m.ogImage && STORAGE.test(m.ogImage));
  const good = m.status === 200 && indexable && m.canonical === u && !!m.title && !!m.desc && (!m.ogUrl || m.ogUrl.startsWith(ORIGIN)) && imageOk(m.ogImage) && !ldBad && !leaks;
  const t = types(m.ld);
  const needs = p.startsWith("/work/v/") ? ["VideoObject", "BreadcrumbList"] : /^\/(work\/albums|offers|services|work)\/[^/]+$/.test(p) ? ["BreadcrumbList"] : [];
  const missing = needs.filter((n) => !t.includes(n));
  const forbidden = FORBID.filter((f) => m.html.includes(f));
  ok(good && !missing.length && !forbidden.length, `${missing.length ? `MISSING ${missing.join("+")} ` : ""}${forbidden.length ? `FORBIDDEN ${forbidden.join(",")} ` : ""}${p} → ${m.status}${indexable ? "" : " NOINDEX"}${m.canonical === u ? "" : ` canonical=${m.canonical}`}${m.title ? "" : " NO TITLE"}${m.desc ? "" : " NO DESC"}${ldBad ? " BAD JSON-LD" : ""}${leaks ? " STORAGE URL" : ""} [${types(m.ld).join(",")}]`);
  if (AUDIT) console.log(`    title: ${m.title}\n    desc: ${(m.desc ?? "").slice(0, 110)}\n    og:image: ${m.ogImage}`);
}

// private pages stay out of the index (the real protection is the auth check on each route)
for (const p of ["/login", "/admin", "/portal"]) {
  const m = await head(p);
  ok(/noindex/i.test(m.robots ?? "") || /noindex/i.test(m.xrobots ?? ""), `${p} is noindex (${m.status})`);
}

// tab variants of /work point their canonical at /work (no duplicate index entries)
for (const q of ["?tab=photos", "?tab=videos"]) {
  const m = await head(`/work${q}`);
  ok(m.canonical === `${ORIGIN}/work` || m.canonical === `${ORIGIN}/work${q}`, `/work${q} canonical = ${m.canonical}`);
}

const home = await head("/");
console.log(`  google-site-verification: ${home.verification ? "present" : "absent (set GOOGLE_SITE_VERIFICATION to emit it)"}`);
console.log(fails ? `\n${fails} check(s) failed` : "\nall SEO checks passed");
process.exit(fails ? 1 : 0);
