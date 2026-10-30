import { describe, expect, it } from "vitest";
import { checkResetTarget, readConfigToml, readEnvUrl } from "../../scripts/lib/reset-guard.mjs";

/**
 * e2e reset safety gate (incident 2026-10-29). Pure decision only: no docker, no supabase, no reset is run here.
 */
const WEB = "C:/work/alsultan-iso/web";
const toml = (id: string, api: number, db: number) =>
  `# comment\nproject_id = "${id}"\n\n[api]\nenabled = true\nport = ${api}\n\n[db]\n# Port to use\nport = ${db}\nshadow_port = ${db - 2}\n\n[studio]\nport = ${api + 2}\n`;
const iso = {
  cwd: WEB,
  scriptWebDir: WEB,
  gitTop: "C:/work/alsultan-iso",
  config: readConfigToml(toml("alsultan-iso", 55321, 55322)),
  env: readEnvUrl("NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321\nOTHER=x"),
  requested: "alsultan-iso",
  dbContainerEnv: "supabase_db_alsultan-iso",
  containers: [
    { name: "supabase_db_alsultan-iso", running: true, ports: [55322] },
    { name: "supabase_kong_alsultan-iso", running: true, ports: [55321] },
    { name: "supabase_db_alsultan-records", running: true, ports: [54322] },
    { name: "supabase_kong_alsultan-records", running: true, ports: [54321] },
  ],
};

describe("readConfigToml / readEnvUrl", () => {
  it("reads project_id and the [api] / [db] ports (not studio, not shadow_port)", () => {
    expect(readConfigToml(toml("alsultan-iso", 55321, 55322))).toEqual({ projectId: "alsultan-iso", apiPort: 55321, dbPort: 55322 });
  });
  it("loopback URL with port", () => {
    expect(readEnvUrl("NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321")).toMatchObject({ loopback: true, port: 55321 });
    expect(readEnvUrl("NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co").loopback).toBe(false);
  });
});

describe("checkResetTarget", () => {
  it("a fully consistent isolated project passes", () => {
    expect(checkResetTarget(iso)).toEqual({ ok: true, reasons: [], projectId: "alsultan-iso" });
  });

  it("THE INCIDENT: .env.local still points at the isolated stack but config.toml was reverted to the shared project → refused", () => {
    const v = checkResetTarget({ ...iso, config: readConfigToml(toml("alsultan-records", 54321, 54322)) });
    expect(v.ok).toBe(false);
    expect(v.reasons.join("\n")).toMatch(/SHARED local project/);
    expect(v.reasons.join("\n")).toMatch(/E2E_RESET_PROJECT "alsultan-iso" ≠ config.toml project_id "alsultan-records"/);
    expect(v.reasons.join("\n")).toMatch(/API port 55321 ≠ config.toml \[api\] port 54321/);
  });

  it("the shared project is refused even when every other fact agrees", () => {
    const v = checkResetTarget({
      ...iso,
      config: readConfigToml(toml("alsultan-records", 54321, 54322)),
      env: readEnvUrl("NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321"),
      requested: "alsultan-records",
      dbContainerEnv: "supabase_db_alsultan-records",
    });
    expect(v.ok).toBe(false);
    expect(v.reasons.some((r: string) => /SHARED/.test(r))).toBe(true);
  });

  it("no explicit E2E_RESET_PROJECT → refused", () => {
    expect(checkResetTarget({ ...iso, requested: undefined }).ok).toBe(false);
  });

  it("run from another folder / another worktree → refused", () => {
    expect(checkResetTarget({ ...iso, cwd: "C:/work/Alsultan Site/web" }).ok).toBe(false);
    expect(checkResetTarget({ ...iso, gitTop: "C:/work/Alsultan Site" }).ok).toBe(false);
  });

  it("target containers missing / stopped / on other ports → refused", () => {
    expect(checkResetTarget({ ...iso, containers: iso.containers.filter((c) => !c.name.endsWith("alsultan-iso")) }).ok).toBe(false);
    expect(
      checkResetTarget({ ...iso, containers: iso.containers.map((c) => (c.name === "supabase_db_alsultan-iso" ? { ...c, running: false } : c)) }).ok,
    ).toBe(false);
    expect(
      checkResetTarget({ ...iso, containers: iso.containers.map((c) => (c.name === "supabase_db_alsultan-iso" ? { ...c, ports: [54322] } : c)) }).ok,
    ).toBe(false);
  });

  it("another project publishing the same ports → ambiguous → refused", () => {
    const clash = [...iso.containers, { name: "supabase_db_other", running: true, ports: [55322] }];
    expect(checkResetTarget({ ...iso, containers: clash }).reasons.join()).toMatch(/ambiguous/);
  });

  it("tests' psql container differs from the target → refused", () => {
    expect(checkResetTarget({ ...iso, dbContainerEnv: "supabase_db_alsultan-records" }).ok).toBe(false);
  });

  it("non-loopback Supabase URL → refused", () => {
    expect(checkResetTarget({ ...iso, env: readEnvUrl("NEXT_PUBLIC_SUPABASE_URL=https://dyuixzxmmeiypvawzmty.supabase.co") }).ok).toBe(false);
  });
});
