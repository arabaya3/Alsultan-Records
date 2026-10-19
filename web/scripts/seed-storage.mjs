// LOCAL DEV ONLY. Uploads placeholder objects for every seeded media_assets row so
// galleries, thumbnails, documents and video players work after `npx supabase db reset`.
//   npm run seed:storage
// Refuses to run unless NEXT_PUBLIC_SUPABASE_URL points at 127.0.0.1/localhost.
// Placeholders are neutral solid tiles with the text "DEV" (never studio artwork).
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const env = { ...process.env };
  const file = path.join(root, ".env.local");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.");
  process.exit(1);
}
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  console.error(`Refusing to seed storage on non-local host "${host}". This script is for the local stack only.`);
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const TONES = ["#d9d4ca", "#c9c3b8", "#bdb6aa", "#e2ddd3", "#b0a99c"];

async function tile(w, h, i, format) {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${TONES[i % TONES.length]}"/>` +
      `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${Math.round(h / 5)}" fill="#6b655b">DEV</text></svg>`,
  );
  const img = sharp(svg);
  return format === "webp" ? img.webp({ quality: 70 }).toBuffer() : format === "png" ? img.png().toBuffer() : img.jpeg({ quality: 70 }).toBuffer();
}

function tinyPdf() {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length 36 >>\nstream\nBT /F1 24 Tf 70 40 Td (DEV) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function testVideo() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "seed-video-")), "dev.mp4");
  try {
    execFileSync(
      "ffmpeg",
      ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0xc9c3b8:s=640x360:d=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
        "-vf", "drawtext=text=DEV:fontcolor=0x6b655b:fontsize=96:x=(w-text_w)/2:y=(h-text_h)/2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", file],
      { stdio: "pipe" },
    );
  } catch {
    try {
      // drawtext needs a font backend; fall back to a plain tile.
      execFileSync(
        "ffmpeg",
        ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0xc9c3b8:s=640x360:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file],
        { stdio: "pipe" },
      );
    } catch {
      return null;
    }
  }
  return fs.readFileSync(file);
}

const CT = { jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", png: "image/png", pdf: "application/pdf", mp4: "video/mp4" };

async function main() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("media_assets")
      .select("id, bucket, path, kind, mime, width, height, variants")
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const cache = new Map();
  const pdf = tinyPdf();
  let video;
  let videoSkipped = false;
  let ok = 0;
  let failed = 0;
  let i = 0;

  for (const r of rows) {
    i++;
    const v = r.variants && typeof r.variants === "object" ? r.variants : {};
    const targets = [];
    if (r.kind === "image") {
      const w = r.width ?? 2048;
      const h = r.height ?? 1365;
      for (const p of new Set([r.path, v.display, v.thumb].filter((x) => typeof x === "string"))) {
        const isThumb = p === v.thumb;
        const scale = Math.min(1, (isThumb ? 480 : 1600) / Math.max(w, h));
        targets.push({ p, w: Math.round(w * scale), h: Math.round(h * scale) });
      }
    } else {
      targets.push({ p: r.path });
    }
    for (const t of targets) {
      const ext = t.p.split(".").pop().toLowerCase();
      let body;
      if (r.kind === "image") {
        const ck = `${t.w}x${t.h}.${ext}.${i % TONES.length}`;
        if (!cache.has(ck)) cache.set(ck, await tile(t.w, t.h, i, ext === "jpg" ? "jpeg" : ext));
        body = cache.get(ck);
      } else if (r.kind === "document") {
        body = pdf;
      } else {
        if (video === undefined) {
          video = testVideo();
          if (!video) videoSkipped = true;
        }
        if (!video) continue;
        body = video;
      }
      const { error } = await sb.storage.from(r.bucket).upload(t.p, body, { contentType: CT[ext] ?? r.mime, upsert: true });
      if (error) {
        failed++;
        console.error(`  failed ${r.bucket}/${t.p}: ${error.message}`);
      } else ok++;
    }
  }
  console.log(`seed:storage → ${rows.length} media rows, ${ok} objects uploaded, ${failed} failed.`);
  if (videoSkipped) console.log("Video placeholders SKIPPED: ffmpeg is not available on PATH.");
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
