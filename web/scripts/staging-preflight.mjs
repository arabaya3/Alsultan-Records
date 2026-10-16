#!/usr/bin/env node
/**
 * Staging preflight — READ ONLY. Run before any remote write:
 *   node scripts/staging-preflight.mjs [--env-file <path>]
 *
 * Reads web/.env.staging.local (gitignored) by default. Never prints secret values.
 * 1. Verifies the env file is gitignored and holds the required variable names.
 * 2. Confirms the access token can see EXACTLY the expected project ref and that it is not the old project.
 * 3. Inspects remote state (schemas, tables, migrations history, buckets, auth users count, extensions)
 *    through the Management API read-only SQL endpoint, so we know whether the database is empty.
 * Exit codes: 0 empty/ours, 2 remote not empty (review), 1 failure.
 * Logic lives in staging-lib.mjs (shared with staging-apply.mjs).
 */
import { resolve } from "node:path";
import { loadStagingEnv, parseArgs, resolvePath, runPreflight, StepError, ok, WEB_ROOT } from "./staging-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const envPath = args["env-file"] ? resolvePath(args["env-file"]) : resolve(WEB_ROOT, ".env.staging.local");

try {
  const env = loadStagingEnv(envPath);
  const { report, state } = await runPreflight(env);
  console.log(JSON.stringify(report, null, 2));
  console.log(`  remote state: ${state}`);
  if (state === "empty") ok("remote public schema, migrations and auth.users are empty — safe to push migrations");
  else {
    console.log("! Remote database is NOT empty. Review the report above before `supabase db push`.");
    process.exitCode = 2;
  }
} catch (e) {
  console.error(`✗ ${e instanceof StepError ? e.message : e?.message ?? e}`);
  process.exit(1);
}
