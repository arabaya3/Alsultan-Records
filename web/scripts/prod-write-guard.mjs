// Guard for every script that WRITES test data to the hosted (production) project dyuixzxmmeiypvawzmty.
// Such scripts create [STAGING-TEST] users/customers/rows; a run by mistake leaves records in the owner's admin lists.
// A write run now needs ALL of:
//   1. the flag  --allow-prod-writes
//   2. the env   CONFIRM_PROD_WRITES=dyuixzxmmeiypvawzmty   (typed on purpose, never stored in an env file)
//   3. .env.staging.app.local pointing at exactly that project
// Otherwise the script stops before any network write. Read-only scripts do not call this.
import fs from "node:fs";
import path from "node:path";

export const PROD_REF = "dyuixzxmmeiypvawzmty";

export function assertProdWriteAllowed(script, { envFile = ".env.staging.app.local" } = {}) {
  const flag = process.argv.includes("--allow-prod-writes");
  const confirm = process.env.CONFIRM_PROD_WRITES === PROD_REF;
  let url = "";
  try {
    const line = fs
      .readFileSync(path.resolve(envFile), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_URL="));
    url = (line ?? "").slice("NEXT_PUBLIC_SUPABASE_URL=".length).trim();
  } catch {
    /* reported below */
  }
  const urlOk = url === `https://${PROD_REF}.supabase.co`;
  if (flag && confirm && urlOk) {
    console.warn(`⚠ ${script}: writing [STAGING-TEST] data to the production project ${PROD_REF} (explicitly allowed for this run).`);
    return;
  }
  console.error(
    [
      `✗ ${script} writes test data to the PRODUCTION project and was not explicitly allowed. Nothing was written.`,
      `  Needed: --allow-prod-writes ${flag ? "✓" : "✗"} · CONFIRM_PROD_WRITES=${PROD_REF} ${confirm ? "✓" : "✗"} · ${envFile} → ${PROD_REF} ${urlOk ? "✓" : "✗"}`,
      "  Prefer the local stack (npm run e2e:reset + Playwright) for anything that creates data.",
    ].join("\n"),
  );
  process.exit(3);
}
