/**
 * Reset the LOCAL stack to a known state before a full e2e run (several suites mutate shared seed rows — accepted
 * quotes, approved contracts, submitted selections, cleanup-queue rows — so a second run on the same database is not
 * a clean run). LOCAL ONLY: refuses unless .env.local points at a local Supabase.
 *
 *   npm run e2e:reset      # then (re)start `next start`, then run playwright
 *
 * Steps: supabase db reset (migrations + seed) → storage seed → content import (videos/categories/settings) →
 * Facebook albums (from web/.cache/fb-import, gitignored) → the owner's 10 packages. Never prints secrets.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
const url = /^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m.exec(env)?.[1]?.trim() ?? "";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) {
  console.error("refusing: .env.local NEXT_PUBLIC_SUPABASE_URL is not a local Supabase");
  process.exit(2);
}

const run = (cmd, args) => {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
};
const waitApi = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, { headers: { apikey: "health" } });
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("local API did not come back after reset");
};

run("npx", ["supabase", "db", "reset"]);
await waitApi();
run("npm", ["run", "seed:storage"]);
run("node", ["scripts/import-content.mjs", "--target", "local", "--apply"]);
run("node", ["scripts/import-fb-albums.mjs", "--target", "local", "--apply", "--publish"]);
run("node", ["scripts/seed-packages.mjs", "--target", "local", "--apply"]);
console.log("\n✓ local stack reset — restart `next start` so its cache starts empty, then run the suites");
