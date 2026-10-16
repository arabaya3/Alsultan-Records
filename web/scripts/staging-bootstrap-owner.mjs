#!/usr/bin/env node
/**
 * One-shot first-owner bootstrap for STAGING (the app has no sign-up page).
 *
 *   OWNER_EMAIL=... node scripts/staging-bootstrap-owner.mjs     # password asked on stdin (hidden)
 *   (or OWNER_EMAIL + OWNER_PASSWORD set in the operator's shell, never in a file in the repo)
 *
 * Needs: web/.env.staging.local (Management API, to delete the hash row),
 *        web/.env.staging.app.local (URL + keys, written by staging-apply),
 *        web/.cache/bootstrap-token.local.txt (written by staging-apply --apply, step bootstrap).
 * Steps: create the owner auth user if missing (email confirmed, via secret key) → sign in with the
 * password → rpc bootstrap_initial_owner(token) → verify profiles.role = owner and mfa_required →
 * delete the token file and the private.bootstrap row. Next login on the app enforces TOTP enrolment.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { EXPECTED_REF, StepError, WEB_ROOT, loadStagingEnv, mgmt, ok, parseArgs, parseEnvFile, resolvePath } from "./staging-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const envPath = args["env-file"] ? resolvePath(args["env-file"]) : resolve(WEB_ROOT, ".env.staging.local");
const APP_ENV = resolve(WEB_ROOT, ".env.staging.app.local");
const TOKEN_FILE = resolve(WEB_ROOT, ".cache/bootstrap-token.local.txt");

function askHidden(question) {
  return new Promise((res, rej) => {
    if (!process.stdin.isTTY) return rej(new StepError("no TTY: set OWNER_PASSWORD in your shell instead"));
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let buf = "";
    const onData = (d) => {
      for (const ch of d.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off("data", onData);
          process.stdout.write("\n"); return res(buf);
        }
        if (ch === "\u0003") { process.stdout.write("\n"); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1); else buf += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function main() {
  const env = loadStagingEnv(envPath);
  const m = mgmt(env);
  if (!existsSync(APP_ENV)) throw new StepError("web/.env.staging.app.local missing — run staging-apply --apply first");
  if (!existsSync(TOKEN_FILE)) throw new StepError(`token file missing (${TOKEN_FILE}) — run staging-apply --apply --only bootstrap`);
  const app = parseEnvFile(APP_ENV);
  if (app.NEXT_PUBLIC_SUPABASE_URL !== `https://${EXPECTED_REF}.supabase.co`) throw new StepError("app env URL is not the staging project");
  const token = readFileSync(TOKEN_FILE, "utf8").trim();

  const email = process.env.OWNER_EMAIL;
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new StepError("set OWNER_EMAIL in your shell");
  const password = process.env.OWNER_PASSWORD || (await askHidden("Owner password (min 10 chars, hidden): "));
  if (password.length < 10) throw new StepError("password must be at least 10 characters");

  const admin = createClient(app.NEXT_PUBLIC_SUPABASE_URL, app.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Owner" } });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) throw new StepError(`create user: ${created.error.message}`);
  ok(created.error ? "owner account already exists — signing in" : "owner account created (email confirmed)");

  const user = createClient(app.NEXT_PUBLIC_SUPABASE_URL, app.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const si = await user.auth.signInWithPassword({ email, password });
  if (si.error) throw new StepError(`sign-in failed: ${si.error.message}`);
  const uid = si.data.user.id;
  const rpc = await user.rpc("bootstrap_initial_owner", { p_token: token });
  if (rpc.error) throw new StepError(`bootstrap_initial_owner: ${rpc.error.code} ${rpc.error.message}`);

  const { data: prof, error } = await admin.from("profiles").select("role, mfa_required").eq("id", uid).single();
  if (error || prof.role !== "owner" || !prof.mfa_required) throw new StepError("verification failed: profile is not owner with mfa_required");
  ok("profile role = owner, mfa_required = true");

  rmSync(TOKEN_FILE);
  ok("token file deleted");
  await m.write("delete from private.bootstrap where id = 1");
  const left = await m.read("select count(*)::int as n from private.bootstrap");
  if (left[0].n !== 0) throw new StepError("private.bootstrap row still present");
  ok("private.bootstrap row deleted (token is one-shot)");
  console.log("Next: sign in on the staging app → you will be asked to enrol TOTP (MFA) before /admin opens.");
}

main().catch((e) => {
  console.error(`✗ ${e instanceof StepError ? e.message : e?.message ?? e}`);
  process.exit(1);
});
