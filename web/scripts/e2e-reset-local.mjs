/**
 * Reset an ISOLATED local stack to a known state before a full e2e run (several suites mutate shared seed rows —
 * accepted quotes, approved contracts, submitted selections, cleanup-queue rows — so a second run on the same
 * database is not a clean run).
 *
 *   E2E_RESET_PROJECT=<isolated project_id> npm run e2e:reset      # then (re)start `next start`, then run playwright
 *
 * SAFETY (incident 2026-10-29): `supabase db reset` targets whatever supabase/config.toml says, so before anything
 * destructive this script checks — via scripts/lib/reset-guard.mjs — that the folder, config.toml project_id and
 * ports, .env.local URL, E2E_DB_CONTAINER and the RUNNING containers all name the same isolated project, and it
 * never resets the shared project (alsultan-records). Any mismatch → exit 2, nothing touched. `--check` only checks.
 *
 * Steps: supabase db reset (migrations + seed) → storage seed → content import (videos/categories/settings) →
 * Facebook albums (from web/.cache/fb-import, gitignored) → the owner's 10 packages. Never prints secrets.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkResetTarget, readConfigToml, readEnvUrl } from "./lib/reset-guard.mjs";

const scriptWebDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function containers() {
  try {
    return sh("docker", ["ps", "-a", "--format", "{{.Names}}\t{{.State}}\t{{.Ports}}"])
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [name, state, ports = ""] = l.split("\t");
        const published = [...ports.matchAll(/:(\d+)->/g)].map((m) => Number(m[1]));
        return { name, running: state === "running", ports: [...new Set(published)] };
      });
  } catch {
    return [];
  }
}

let gitTop = null;
try {
  gitTop = sh("git", ["-C", scriptWebDir, "rev-parse", "--show-toplevel"]);
} catch {
  /* not a git worktree */
}
const read = (p) => {
  try {
    return readFileSync(path.join(scriptWebDir, p), "utf8");
  } catch {
    return "";
  }
};
const config = readConfigToml(read("supabase/config.toml"));
const env = readEnvUrl(read(".env.local"));
const verdict = checkResetTarget({
  cwd: process.cwd(),
  scriptWebDir,
  gitTop,
  config,
  env,
  requested: process.env.E2E_RESET_PROJECT,
  dbContainerEnv: process.env.E2E_DB_CONTAINER,
  containers: containers(),
});
if (!verdict.ok) {
  console.error("refusing to reset — the target is not a verified isolated project:");
  for (const r of verdict.reasons) console.error(`  - ${r}`);
  process.exit(2);
}
console.log(`✓ target verified: project ${verdict.projectId}, api :${config.apiPort}, db :${config.dbPort}, folder ${scriptWebDir}`);
if (process.argv.includes("--check")) process.exit(0);

const url = env.url;
const run = (cmd, args) => {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", cwd: scriptWebDir });
};
const waitApi = async () => {
  for (let i = 0; i < 180; i++) {
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
