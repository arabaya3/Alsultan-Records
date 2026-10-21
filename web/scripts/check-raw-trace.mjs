// Build-output check (run after `next build`): every server entry that can decode RAW must ship libraw-wasm's
// package.json ("type": "module") next to dist/libraw.js — without it Node loads libraw.js as CommonJS on Vercel
// («Cannot use 'import.meta' outside a module»). `next start` locally reads node_modules directly, so only the
// traced file lists (*.nft.json) show the problem.
//   node scripts/check-raw-trace.mjs
import fs from "node:fs";
import path from "node:path";

const ENTRIES = [
  ".next/server/app/api/jobs/process-photos/route.js.nft.json", // cron worker
  ".next/server/app/admin/albums/[id]/page.js.nft.json", // completeAlbumUpload → after(runPhotoJobs), retryPhoto
];
let bad = 0;
for (const e of ENTRIES) {
  const files = JSON.parse(fs.readFileSync(e, "utf8")).files.map((f) => f.replaceAll("\\", "/"));
  const need = ["libraw-wasm/package.json", "libraw-wasm/dist/libraw.js", "libraw-wasm/dist/libraw.wasm"];
  const missing = need.filter((n) => !files.some((f) => f.endsWith(`node_modules/${n}`)));
  console.log(`${missing.length ? "✗" : "✓"} ${path.dirname(e).replace(".next/server/app", "") || "/"}${missing.length ? `: missing ${missing.join(", ")}` : ""}`);
  bad += missing.length ? 1 : 0;
}
process.exit(bad ? 1 : 0);
