#!/usr/bin/env node
// PreToolUse guard for Bash and PowerShell. Scans the whole command text, so compounds and `bash -c` wrappers are
// covered. It fails closed on bad input. A safety net, NOT a security boundary: a script file, an encoded or built-up
// command, or anything run outside Claude Code gets past it.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const block = (reason) => {
  console.error(`Blocked by .claude/hooks/guard.mjs: ${reason}. This needs the owner's explicit approval and must be run by the owner.`);
  process.exit(2);
};

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  block("unreadable hook input");
}
const raw = String(input.tool_input?.command ?? "");
// Global flags before the subcommand must not hide it: `supabase --workdir x db reset`, `git -C x reset --hard`.
const indirect = /\bsupabase\b.*\s--workdir\b|--prefix\b|--cwd\b/.test(raw);
const cmd = raw
  .replace(/\bsupabase((?:\s+--?[\w-]+(?:[= ](?!db\b|link\b|unlink\b|stop\b|migration\b|secrets\b|projects\b|functions\b|config\b|storage\b|status\b|test\b)[^\s-]\S*)?)+)(?=\s)/g, "supabase")
  .replace(/\bgit((?:\s+(?:-C|-c)\s+(?:"[^"]*"|'[^']*'|\S+)|\s+--[\w-]+(?:=\S+)?)+)(?=\s)/g, "git");
const startDir = String(input.cwd ?? process.cwd());

const RULES = [
  // Change control
  [/\bgh\s+pr\s+merge\b/, "merging a PR"],
  [/\bgh\s+api\b.*\/merge\b/, "merging through the GitHub API"],
  [/\bvercel(@\S+)?\b.*\b(deploy|promote|rollback|redeploy|remove|rm|alias)\b/, "changing a Vercel deployment"],
  [/\bvercel(@\S+)?\b.*\s--prod\b/, "a production deploy"],
  [/\bgit\s+push\b.*(\s-f\b|--force|\s\+\S)/, "a force push"],
  [/\bgit\s+reset\s+--hard\b/, "git reset --hard"],
  [/\bgit\s+clean\b/, "git clean"],
  [/\bgit\s+checkout\s+--\s+\.(\s|$)/, "a broad restore"],
  [/\bgit\s+restore\s+\.(\s|$)/, "a broad restore"],
  // Remote databases: production is what "staging" and the linked project mean here
  [/dyuixzxmmeiypvawzmty|pooler\.supabase\.com|db\.[a-z0-9]+\.supabase\.co/, "a command naming the production database"],
  [/\bsupabase\b.*(--linked|--db-url)/, "a Supabase command against a remote database"],
  [/\bsupabase\s+db\s+(push|pull|dump|remote)\b/, "a Supabase command that defaults to or touches the linked project"],
  [/\bsupabase\s+(link|unlink|migration\s+(up|repair|squash)|secrets|projects\s+api-keys|functions\s+deploy|config\s+push|storage\s+(rm|mv|cp))\b/, "changing or reading the linked project"],
  [/\bsupabase\s+stop\b.*--no-backup/, "deleting local database data"],
  [/\bnpm\s+run\s+backup\b|backup-now\.mjs/, "a backup that reads the production database"],
  [/--target\s+staging\b|staging-apply|cloud-restore-rehearsal/, "a script targeting the production database (called staging)"],
  [/--i-understand-remote/, "a remote restore"],
  // Local stacks' data
  [/\bdocker\b.*\b(volume\s+(rm|prune)|system\s+prune|compose\b.*\bdown\b.*-v)\b/, "deleting Docker data"],
  [/\bdocker\s+(rm|stop|kill)\b.*alsultan-records/, "stopping the shared local stack"],
  [/alsultan-records\b.*\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|vacuum|copy)\b/i, "writing to the shared local database"],
  [/alsultan-records\b.*\spsql\b.*\s-f\b/, "running a SQL file on the shared local database"],
  // Secrets, by name. .env.example is fine.
  [/\.env(?!\.example\b)(\.[\w.-]+)?(?![\w-])/, "a command touching an env file"],
  [/\.temp[\\/](pooler-url|start-secrets)|com\.vercel\.cli|\.git-credentials|\.ssh[\\/]/, "a credential file"],
  [/(^|[\s;&|(])(printenv|env)(\s*($|[|>;&]))/, "dumping environment variables"],
  [/\b(Get-ChildItem|gci|dir|ls)\s+env:/i, "dumping environment variables"],
  [/\bgh\s+auth\s+(token|status\s+.*--show-token)|\bgh\s+auth\s+status\s+-t\b/, "printing a GitHub token"],
  [/\bvercel(@\S+)?\s+env\b/, "reading or changing Vercel env"],
  [/\bsupabase\s+status\b.*(-o|--output)/, "printing local Supabase keys"],
  [/vault\.decrypted_secrets|meta_page_token\s*\(/, "reading Vault secrets"],
  [/\b(SUPABASE_(SECRET_KEY|ACCESS_TOKEN|DB_PASSWORD)|IP_HASH_SECRET|JOBS_SECRET)\b/, "a command naming a server secret"],
];

const hit = RULES.find(([re]) => re.test(cmd));
if (hit) block(hit[1]);

// Where the risky part runs: follow `cd` / `Set-Location` before it. Anything we cannot resolve is treated as unsafe.
function dirBefore(index) {
  let dir = startDir;
  const re = /(?:^|[;&|\n(]\s*)(?:cd|Set-Location|sl|pushd)\s+(?:-Path\s+)?("[^"]+"|'[^']+'|[^\s;&|)]+)/g;
  for (const m of cmd.matchAll(re)) {
    if (m.index > index) break;
    const to = m[1].replace(/^["']|["']$/g, "");
    if (/[$`%~]/.test(to)) return null;
    dir = isAbsolute(to) ? to : resolve(dir, to);
  }
  return dir;
}
const webDirOf = (dir) => [dir, join(dir, "web")].find((d) => existsSync(join(d, "supabase/config.toml")));
const projectIdOf = (web) => /^\s*project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(join(web, "supabase/config.toml"), "utf8"))?.[1] ?? null;

const reset = /\bsupabase\s+db\s+reset\b/.exec(cmd);
const stop = /\bsupabase\s+stop\b/.exec(cmd);
for (const m of [reset, stop]) {
  if (!m) continue;
  const what = m === reset ? "resetting" : "stopping";
  if (indirect) block(`${what} a Supabase stack through an indirect path`);
  const dir = dirBefore(m.index);
  const web = dir && webDirOf(dir);
  if (!web) block(`${what} a Supabase stack whose project could not be verified`);
  const id = projectIdOf(web);
  if (!id || id === "alsultan-records") block(`${what} the shared local project (${id ?? "unknown"})`);
}

const e2e = /\be2e:reset\b|e2e-reset-local/.exec(cmd);
if (e2e && !/e2e-reset-local(\.mjs)?\s+--check\b/.test(cmd)) {
  if (indirect) block("e2e:reset through an indirect path");
  const dir = dirBefore(e2e.index);
  const web = dir && webDirOf(dir);
  if (!web) block("e2e:reset from a folder that could not be verified");
  if (!existsSync(join(web, "scripts/lib/reset-guard.mjs"))) block("e2e:reset from a checkout without the reset guard (it can reset the shared local stack)");
  const id = projectIdOf(web);
  if (!id || id === "alsultan-records") block(`e2e:reset with project_id ${id ?? "unknown"} (the shared local project)`);
}
