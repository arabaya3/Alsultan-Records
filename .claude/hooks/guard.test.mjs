// Run: node --test .claude/hooks/guard.test.mjs   Nothing here executes the commands; they are only given to the guard.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const GUARD = fileURLToPath(new URL("./guard.mjs", import.meta.url));
const run = (command, cwd, raw) =>
  spawnSync("node", [GUARD], { input: raw ?? JSON.stringify({ tool_input: { command }, cwd }), encoding: "utf8" }).status;

function checkout(projectId, guard) {
  const top = mkdtempSync(join(tmpdir(), "guard-"));
  mkdirSync(join(top, "web/supabase"), { recursive: true });
  mkdirSync(join(top, "web/scripts/lib"), { recursive: true });
  writeFileSync(join(top, "web/supabase/config.toml"), `project_id = "${projectId}"\n`);
  if (guard) writeFileSync(join(top, "web/scripts/lib/reset-guard.mjs"), "");
  return top;
}
const shared = checkout("alsultan-records", false);
const sharedWithGuard = checkout("alsultan-records", true);
const isolatedOld = checkout("alsultan-iso", false);
const isolated = checkout("alsultan-iso", true);

const BLOCKED = [
  "supabase --workdir ../x db push", "npx supabase --debug db push", "supabase --experimental --workdir x unlink", "git -C ../x reset --hard", 'git -c a=b -C "../x y" push -f origin z', "git --no-pager clean -fd",
  "gh pr merge 13", 'bash -c "gh pr merge 13"', "gh api -X PUT repos/a/b/pulls/13/merge",
  "npx --yes vercel@latest deploy --prod", "npx vercel promote dpl_x", "vercel env pull",
  "git push -f origin x", "git push origin +x", "git push --force-with-lease", "git reset --hard", "git clean -fd", "git checkout -- .", "git restore .",
  "cd web && npx supabase db push", "supabase db pull", "supabase db dump", "supabase db reset --linked", "supabase db reset --db-url postgres://x",
  "supabase test db --linked", "supabase migration list --linked", "supabase migration repair 1", "supabase link --project-ref x", "supabase unlink", "supabase secrets list",
  "supabase stop --no-backup", "npm run backup", "node scripts/import-content.mjs --target staging --apply", "node scripts/staging-apply.mjs",
  "psql postgres://x@aws-0.pooler.supabase.com/postgres", "curl https://dyuixzxmmeiypvawzmty.supabase.co/rest/v1/",
  "docker volume rm supabase_db_x", "docker system prune -a", "docker stop supabase_db_alsultan-records",
  'docker exec supabase_db_alsultan-records psql -U postgres -c "delete from public.photo_albums"',
  "cat web/.env.local", "grep KEY .env.staging.app.local", "Get-Content web\\.env", "cp .env.local /tmp/x", "type .env.production", "node -e \"require('fs').readFileSync('.env.local')\"",
  "cat web/supabase/.temp/pooler-url", "printenv", "env | sort", "Get-ChildItem env:", "gh auth token",
  "echo $SUPABASE_SECRET_KEY", "select * from vault.decrypted_secrets",
];
const ALLOWED = [
  "gh pr view 13", "gh pr checks 13", "git status", "git log --oneline -3", "git push origin chore/x", "npx playwright test public", "npx vitest run",
  "cat web/.env.example", "supabase start", "supabase status", "supabase test db", "docker ps",
  'docker exec supabase_db_alsultan-records psql -U postgres -tAc "select count(*) from public.photo_albums"', "environment-check", "node scripts/env-check.mjs",
];

for (const c of BLOCKED) test(`blocked: ${c}`, () => assert.equal(run(c, shared), 2));
for (const c of ALLOWED) test(`allowed: ${c}`, () => assert.equal(run(c, shared), 0));

test("bad input fails closed", () => assert.equal(run("", shared, "not json"), 2));

test("db reset: shared project refused, isolated project allowed, unknown refused", () => {
  assert.equal(run("npx supabase db reset", shared), 2);
  assert.equal(run("npx supabase db reset", isolated), 0);
  assert.equal(run("npx supabase db reset", join(shared, "nowhere")), 2);
  assert.equal(run("npx supabase --workdir ../x db reset", isolated), 2);
});

test("db reset: `cd` is followed, in either direction", () => {
  assert.equal(run(`cd "${shared}" && npx supabase db reset`, isolated), 2);
  assert.equal(run(`cd "${isolated}" && npx supabase db reset`, shared), 0);
  assert.equal(run(`Set-Location "${shared}"; npx supabase db reset`, isolated), 2);
  assert.equal(run('cd "$X" && npx supabase db reset', isolated), 2);
});

test("supabase stop: shared project refused, isolated allowed", () => {
  assert.equal(run("npx supabase stop", shared), 2);
  assert.equal(run("npx supabase stop", isolated), 0);
});

test("e2e:reset: needs the guard script AND a non-shared project", () => {
  assert.equal(run("npm run e2e:reset", shared), 2);
  assert.equal(run("npm run e2e:reset", isolatedOld), 2);
  assert.equal(run("npm run e2e:reset", sharedWithGuard), 2);
  assert.equal(run("npm run e2e:reset", isolated), 0);
  assert.equal(run(`cd "${shared}" && npm run e2e:reset`, isolated), 2);
  assert.equal(run("node scripts/e2e-reset-local.mjs", shared), 2);
  assert.equal(run("npm --prefix ../x run e2e:reset", isolated), 2);
  assert.equal(run("node scripts/e2e-reset-local.mjs --check", sharedWithGuard), 0);
});
