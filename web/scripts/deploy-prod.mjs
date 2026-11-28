#!/usr/bin/env node
/**
 * Production deploy WITH provenance (technical audit OPS-03). Production deployments were CLI uploads with no git
 * metadata, so nobody could tell which commit was live, and whatever was on the operator's disk was uploaded.
 *
 *   node scripts/deploy-prod.mjs          checks, then PRINTS the deploy command (nothing is deployed)
 *   node scripts/deploy-prod.mjs --go     checks, then deploys (owner approval required for every production deploy)
 *
 * Refuses unless: the checkout is on `master`, has no uncommitted or untracked changes outside ignored files, and HEAD
 * equals origin/master after a fetch (so CI has run on exactly this commit). The deployment carries gitCommitSha /
 * gitCommitRef metadata: `npx vercel inspect <url>` or the dashboard then shows the commit. Never prints secrets.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...a) => {
  const r = spawnSync("git", a, { cwd: WEB, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")} failed`);
  return r.stdout.trim();
};
const fail = (m) => {
  console.error(`✗ ${m}`);
  process.exit(2);
};

const top = git("rev-parse", "--show-toplevel");
const branch = git("branch", "--show-current");
if (branch !== "master") fail(`on branch "${branch || "(detached)"}": deploy only from master`);
const dirty = git("status", "--porcelain");
if (dirty) fail(`uncommitted or untracked changes:\n${dirty}`);
git("fetch", "origin", "master", "--quiet");
const head = git("rev-parse", "HEAD");
const remote = git("rev-parse", "origin/master");
if (head !== remote) fail(`HEAD ${head.slice(0, 7)} is not origin/master ${remote.slice(0, 7)}: pull or push first`);

const args = ["vercel", "deploy", "--prod", "--meta", `gitCommitSha=${head}`, "--meta", "gitCommitRef=master", "--meta", "gitDirty=0"];
console.log(`✓ clean master at ${head.slice(0, 7)} = origin/master`);
if (!process.argv.includes("--go")) {
  console.log(`deploy command (run from ${top}):\n  npx ${args.join(" ")}\nor: node web/scripts/deploy-prod.mjs --go`);
  process.exit(0);
}
const r = spawnSync("npx", args, { cwd: top, stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
