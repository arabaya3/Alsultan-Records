/**
 * Safety gate for scripts/e2e-reset-local.mjs (incident 2026-10-29: the old guard only read .env.local, while
 * `supabase db reset` picks its target from supabase/config.toml — a reverted config.toml reset the SHARED local
 * project). This module only DECIDES; the script gathers the facts. Any mismatch → refuse before anything destructive.
 *
 * Rules (all must hold):
 *  1. the shared project is never reset (SHARED_PROJECTS), whatever else says;
 *  2. E2E_RESET_PROJECT names the target explicitly and equals config.toml project_id;
 *  3. the script runs from the web/ folder of the worktree it lives in (cwd === scriptWebDir, and git toplevel is its
 *     parent) — so the config.toml read is the one `supabase` will use;
 *  4. config.toml [api] port === the port of .env.local NEXT_PUBLIC_SUPABASE_URL (the URL the app and tests use);
 *     that URL is a loopback address;
 *  5. the target containers really exist and are running under that project id: supabase_db_<id> publishes the
 *     config [db] port and supabase_kong_<id> publishes the [api] port;
 *  6. E2E_DB_CONTAINER (used by the tests' psql), when set, === supabase_db_<id>;
 *  7. no OTHER running project publishes the same api/db ports.
 */
export const SHARED_PROJECTS = ["alsultan-records"];

/** Minimal TOML reads for the keys we need (project_id, [api] port, [db] port). */
export function readConfigToml(text) {
  let projectId = null;
  const ports = {};
  let current = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const sec = /^\[([^\]]+)\]$/.exec(line);
    if (sec) {
      current = sec[1];
      continue;
    }
    const pid = current === "" ? /^project_id\s*=\s*"([^"]+)"/.exec(line) : null;
    if (pid) projectId = pid[1];
    const port = /^port\s*=\s*(\d+)/.exec(line);
    if (port && (current === "api" || current === "db") && ports[current] == null) ports[current] = Number(port[1]);
  }
  return { projectId, apiPort: ports.api ?? null, dbPort: ports.db ?? null };
}

export function readEnvUrl(text) {
  const url = /^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m.exec(text)?.[1]?.trim() ?? "";
  const m = /^https?:\/\/(127\.0\.0\.1|localhost)(?::(\d+))?\/?$/.exec(url);
  return { url, loopback: Boolean(m), port: m?.[2] ? Number(m[2]) : null };
}

const norm = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * @param {{
 *   cwd: string, scriptWebDir: string, gitTop: string | null,
 *   config: { projectId: string | null, apiPort: number | null, dbPort: number | null },
 *   env: { url: string, loopback: boolean, port: number | null },
 *   requested: string | undefined, dbContainerEnv: string | undefined,
 *   containers: { name: string, running: boolean, ports: number[] }[]
 * }} f
 * @returns {{ ok: boolean, reasons: string[], projectId: string | null }}
 */
export function checkResetTarget(f) {
  const reasons = [];
  const id = f.config.projectId;
  if (!id) reasons.push("config.toml has no project_id");
  if (id && SHARED_PROJECTS.includes(id)) reasons.push(`config.toml project_id "${id}" is the SHARED local project: never reset by tests`);
  if (f.requested && SHARED_PROJECTS.includes(f.requested)) reasons.push(`E2E_RESET_PROJECT "${f.requested}" is the SHARED local project`);
  if (!f.requested) reasons.push("E2E_RESET_PROJECT is not set (name the isolated project to reset explicitly)");
  else if (id && f.requested !== id) reasons.push(`E2E_RESET_PROJECT "${f.requested}" ≠ config.toml project_id "${id}"`);

  if (norm(f.cwd) !== norm(f.scriptWebDir)) reasons.push(`run from ${f.scriptWebDir} (cwd is ${f.cwd})`);
  if (!f.gitTop || norm(f.gitTop) !== norm(f.scriptWebDir.replace(/[\\/]+web[\\/]*$/i, ""))) {
    reasons.push(`script is not inside the expected worktree (git toplevel ${f.gitTop ?? "?"})`);
  }

  if (!f.env.loopback) reasons.push(`.env.local NEXT_PUBLIC_SUPABASE_URL is not a loopback address (${f.env.url || "missing"})`);
  if (f.config.apiPort == null || f.config.dbPort == null) reasons.push("config.toml [api]/[db] port missing");
  if (f.env.port !== f.config.apiPort) reasons.push(`.env.local API port ${f.env.port} ≠ config.toml [api] port ${f.config.apiPort}`);

  if (id) {
    const db = f.containers.find((c) => c.name === `supabase_db_${id}`);
    const kong = f.containers.find((c) => c.name === `supabase_kong_${id}`);
    if (!db?.running) reasons.push(`container supabase_db_${id} is not running`);
    else if (!db.ports.includes(f.config.dbPort)) reasons.push(`supabase_db_${id} publishes ${db.ports.join(",") || "nothing"}, not [db] port ${f.config.dbPort}`);
    if (!kong?.running) reasons.push(`container supabase_kong_${id} is not running`);
    else if (!kong.ports.includes(f.config.apiPort)) reasons.push(`supabase_kong_${id} publishes ${kong.ports.join(",") || "nothing"}, not [api] port ${f.config.apiPort}`);
    for (const c of f.containers) {
      if (!c.running || c.name.endsWith(`_${id}`)) continue;
      if (c.ports.includes(f.config.apiPort) || c.ports.includes(f.config.dbPort)) {
        reasons.push(`another container (${c.name}) publishes the same port — the target is ambiguous`);
      }
    }
    if (f.dbContainerEnv && f.dbContainerEnv !== `supabase_db_${id}`) {
      reasons.push(`E2E_DB_CONTAINER "${f.dbContainerEnv}" ≠ supabase_db_${id}`);
    }
  }
  return { ok: reasons.length === 0, reasons, projectId: id };
}
