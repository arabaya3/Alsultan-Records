import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { checkProdWrite, PROD_REF, PROD_SUPABASE_URL } from "../../scripts/prod-write-guard.mjs";

/**
 * Production-write guard (docs/ui-audit-followup.md §2.6). Never exercises an ALLOWED run of a real script — every
 * spawned script below must stop with exit 3 before any network write.
 */
const OK_ARGV = ["node", "x.mjs", "--allow-prod-writes"];
const OK_ENV = { CONFIRM_PROD_WRITES: PROD_REF };
const SITE_OK = { url: "https://sultan-records.vercel.app", csp: `connect-src 'self' ${PROD_SUPABASE_URL} https://${PROD_REF}.storage.supabase.co` };

describe("checkProdWrite (rules)", () => {
  it("allows only with flag + confirmation + the production service URL (+ a site wired to it, when one is used)", () => {
    expect(checkProdWrite({ argv: OK_ARGV, env: OK_ENV, serviceUrl: PROD_SUPABASE_URL, site: null })).toEqual([]);
    expect(checkProdWrite({ argv: OK_ARGV, env: OK_ENV, serviceUrl: PROD_SUPABASE_URL + "/", site: SITE_OK })).toEqual([]);
  });
  it("refuses without the flag or the typed confirmation", () => {
    expect(checkProdWrite({ argv: ["node", "x.mjs"], env: OK_ENV, serviceUrl: PROD_SUPABASE_URL, site: null })).toHaveLength(1);
    expect(checkProdWrite({ argv: OK_ARGV, env: {}, serviceUrl: PROD_SUPABASE_URL, site: null })).toHaveLength(1);
    expect(checkProdWrite({ argv: OK_ARGV, env: { CONFIRM_PROD_WRITES: "yes" }, serviceUrl: PROD_SUPABASE_URL, site: null })).toHaveLength(1);
  });
  it("refuses a missing or different service URL (another project, local, look-alike host)", () => {
    for (const serviceUrl of [null, "http://127.0.0.1:54321", "https://peufggxvklpnaytyklgg.supabase.co", `https://${PROD_REF}.supabase.co.evil.example`]) {
      const p = checkProdWrite({ argv: OK_ARGV, env: OK_ENV, serviceUrl, site: null });
      expect(p.length, String(serviceUrl)).toBe(1);
    }
  });
  it("refuses a site that is not wired to the same project, or does not answer", () => {
    expect(checkProdWrite({ argv: OK_ARGV, env: OK_ENV, serviceUrl: PROD_SUPABASE_URL, site: { url: "http://localhost:3100", csp: "connect-src 'self' http://127.0.0.1:54321" } })).toHaveLength(1);
    expect(checkProdWrite({ argv: OK_ARGV, env: OK_ENV, serviceUrl: PROD_SUPABASE_URL, site: { url: "http://localhost:3100", error: "ECONNREFUSED" } })).toHaveLength(1);
    expect(checkProdWrite({ argv: OK_ARGV, env: OK_ENV, serviceUrl: PROD_SUPABASE_URL, site: { url: "x", csp: "" } })).toHaveLength(1);
  });
});

// The 11 entry points that write test data to production (+ the args that select the production target).
const SCRIPTS: [string, string[]][] = [
  ["staging-admin-check", []],
  ["staging-app-check", []],
  ["staging-login-check", []],
  ["live-admin-ux-check", []],
  ["live-cms-check", []],
  ["live-events-check", []],
  ["live-packages-check", []],
  ["admin-screenshots", []],
  ["prod-upload-check", ["dummy.jpg"]],
  ["verify-packages", ["--target", "staging"]],
  ["staging-verify", ["--target", "staging"]],
];
const SCRIPTS_DIR = path.resolve(__dirname, "../../scripts");

function run(script: string, args: string[], cwd: string, env: Record<string, string>) {
  // BASE_URL points at a closed port: even a wrongly-allowed run could not reach any site.
  return spawnSync(process.execPath, [path.join(SCRIPTS_DIR, `${script}.mjs`), ...args], {
    cwd,
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", BASE_URL: "http://127.0.0.1:9", ...env } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 60_000,
  });
}

describe.each(SCRIPTS)("%s stops before writing", (script, args) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guard-"));
  const writeEnv = (url: string) => {
    fs.writeFileSync(path.join(tmp, ".env.staging.app.local"), `NEXT_PUBLIC_SUPABASE_URL=${url}\nSUPABASE_SECRET_KEY=not-a-key\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=not-a-key\n`);
    fs.writeFileSync(path.join(tmp, ".env.staging.local"), `SUPABASE_ACCESS_TOKEN=x\nSUPABASE_DB_PASSWORD=x\nSUPABASE_PROJECT_REF=${PROD_REF}\n`);
  };

  it("without --allow-prod-writes / CONFIRM_PROD_WRITES", () => {
    writeEnv(PROD_SUPABASE_URL);
    const r = run(script, args, tmp, {});
    expect(r.status, r.stderr).toBe(3);
    expect(r.stderr).toContain("Nothing was written");
  });
  it("with the opt-in but a service URL of ANOTHER project", () => {
    writeEnv("https://peufggxvklpnaytyklgg.supabase.co");
    const r = run(script, [...args, "--allow-prod-writes"], tmp, { CONFIRM_PROD_WRITES: PROD_REF });
    expect(r.status, r.stderr).toBe(3);
    expect(r.stderr).toContain("not the production project");
  });
  it("with the opt-in but no env file", () => {
    fs.rmSync(path.join(tmp, ".env.staging.app.local"), { force: true });
    const r = run(script, [...args, "--allow-prod-writes"], tmp, { CONFIRM_PROD_WRITES: PROD_REF });
    expect(r.status, r.stderr).toBe(3);
  });
});


describe("site wiring is checked against the live site's CSP (harness that only calls the guard, never writes)", () => {
  it("a local site wired to the LOCAL database is refused even with the opt-in and the production service URL", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guard-site-"));
    fs.writeFileSync(path.join(tmp, ".env.staging.app.local"), ["NEXT_PUBLIC_SUPABASE_URL=" + PROD_SUPABASE_URL, ""].join("\n"));
    const harness = path.join(tmp, "harness.mjs");
    const guardUrl = pathToFileURL(path.join(SCRIPTS_DIR, "prod-write-guard.mjs")).href;
    fs.writeFileSync(
      harness,
      [
        `import { assertProdWriteAllowed } from ${JSON.stringify(guardUrl)};`,
        `await assertProdWriteAllowed("harness", { siteDefault: "http://localhost:3600" });`,
        `console.log("ALLOWED");`,
      ].join("\n"),
    );
    const r = spawnSync(process.execPath, [harness, "--allow-prod-writes"], {
      cwd: tmp,
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", CONFIRM_PROD_WRITES: PROD_REF } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(r.stdout).not.toContain("ALLOWED");
    expect(r.status, r.stderr).toBe(3);
    expect(r.stderr).toMatch(/not wired|did not answer/);
  });
});
