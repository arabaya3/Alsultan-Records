# Staging runbook: Supabase project `dyuixzxmmeiypvawzmty`

Target is the **new** project only: `dyuixzxmmeiypvawzmty` (ap-southeast-1, free plan). Every script refuses any other ref, and refuses the old project `peufggxvklpnaytyklgg` explicitly.

**Out of scope until explicitly authorized:** public hosting or deployment of the Next.js app, DNS changes, and anything that touches the live site. These scripts only prepare the database, auth, storage and the Edge Function, and write local env files for running the app against staging.

## 1. What you (the account owner) do once

1. Create a personal access token at supabase.com → Account → Access Tokens. Give it a name like `sultan-staging-cli`.
2. Find or reset the database password at Project `dyuixzxmmeiypvawzmty` → Project Settings → Database.
3. Create the file `web/.env.staging.local`. It is gitignored by the `.env*` rule; `git check-ignore web/.env.staging.local` confirms it. Put these **4 variable names** in it with your values:

   ```
   SUPABASE_ACCESS_TOKEN=
   SUPABASE_DB_PASSWORD=
   SUPABASE_PROJECT_REF=dyuixzxmmeiypvawzmty
   STAGING_SITE_URL=http://localhost:3100
   ```
   plus, only when you run the owner bootstrap (step 4 below), set these in your **shell**, not in a file:
   `OWNER_EMAIL` (and optionally `OWNER_PASSWORD`; otherwise the script asks for it with hidden input).

   `STAGING_SITE_URL` is the URL the staging app is served from. Use `http://localhost:3100` to run the local app against the cloud database, or the staging host once hosting is authorized.

   **Never paste these values into chat, issues or commits.**

## 2. Commands, in order (from `web/`)

| # | Command | Touches | Writes? |
|---|---|---|---|
| 1 | `node scripts/staging-preflight.mjs` | Management API: project GET plus read-only SQL (tables, migrations, buckets, auth user count, extensions) | no |
| 2 | `node scripts/staging-apply.mjs` | Same reads as preflight, plus auth config GET, functions list and API key names (no `reveal`). Prints the plan. If already linked, runs `db push --dry-run`. | no |
| 3 | `node scripts/staging-apply.mjs --apply` | See the step table below | **yes** |
| 4 | `OWNER_EMAIL=you@example.com node scripts/staging-bootstrap-owner.mjs` | Auth (creates and confirms the owner user), RPC `bootstrap_initial_owner`, deletes the `private.bootstrap` row and the token file | yes |
| 5 | `node scripts/staging-verify.mjs --target staging` | Creates temporary `[STAGING-TEST] <run>` users and rows, runs the checks, deletes them, writes `docs/staging-verify-report.json` | yes (temporary, self-cleaning) |
| 6 | `npm run build` with the staging env, then `node scripts/check-bundle-secrets.mjs --env-file .env.staging.app.local` | Reads `.next/static` | no |

Preflight exit codes: 0 means empty, 2 means not empty (review the report), 1 means error.

To run the app locally against staging, load `web/.env.staging.app.local` in place of `.env.local`, for example by copying it to `.env.production.local` for `npm run build && npm start -- -p 3100`. Remove the copy afterwards.

### `staging-apply.mjs` steps

Dry run is the default; `--apply` is required for any write.

- Resume with `--apply --from <step>`, or run one step with `--only <step>`. The read-only `preflight` step always runs first.
- `--env-file <path>` overrides the env file location.
- `--allow-nonempty` continues on a database that holds objects these migrations did not create. A database created by an earlier run of this script is recognised and resumed without the flag.
- Every step is idempotent. It exits non-zero on the first failure.

| Step | What it does |
|---|---|
| `preflight` | Checks that the env file is gitignored, the variable names, the ref (expected ref, never the old one) and that the project is `ACTIVE_HEALTHY`. It then reads the remote state and classifies it as `empty`, `ours-partial`, `ours-complete` or `foreign`; `foreign` aborts. |
| `link` | `npx supabase link --project-ref dyuixzxmmeiypvawzmty`. The password and token reach the CLI only through the child environment (`SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`), never through argv. It writes `supabase/.temp/project-ref`, which is gitignored. |
| `db-push` | `db push --linked --dry-run`, then `db push --linked`. Only migrations are pushed: there is **no** `--include-seed`, so dev users and fixtures never reach staging. Afterwards it checks that `supabase_migrations.schema_migrations` equals the local migration versions. |
| `extensions` | Checks that `pg_cron`, `pg_net`, `btree_gist`, `pgcrypto` and `supabase_vault` are present. If one is missing, it prints the exact dashboard instruction. |
| `auth-config` | `PATCH /v1/projects/{ref}/config/auth`, sending only the fields that differ, then GET to verify. Fields set: `site_url`; `uri_allow_list` (the existing entries plus `{site}/auth/callback`, `{site}/auth/reset` and `{site}/auth/callback**`); `hook_custom_access_token_enabled=true`; `hook_custom_access_token_uri=pg-functions://postgres/app/custom_access_token_hook`; `mfa_totp_enroll_enabled` and `mfa_totp_verify_enabled` set to true; `jwt_exp=3600`; `password_min_length=10`, which matches the app. |
| `storage` | Checks that `public-media` (private, 50 MiB), `private-media` (private, 2 GiB) and `backups` (private, 2 GiB) exist as the migrations created them. |
| `edge-function` | Runs `functions deploy storage-cleanup --no-verify-jwt --use-api`. It generates `STORAGE_CLEANUP_SECRET` locally and sets it through `POST /v1/projects/{ref}/secrets`, so the value travels only in the request body. It then upserts the Vault secrets `storage_cleanup_url` and `storage_cleanup_key` with parameterized SQL (`$1`/`$2`). |
| `cron-verify` | Checks that `cron.job` `storage-cleanup` is active. It POSTs the function with the bearer secret and expects a 2xx response, then POSTs without it and expects 401. |
| `app-env` | Calls `GET /v1/projects/{ref}/api-keys?reveal=true`, which returns the full `api_key` only with `reveal`. It writes `web/.env.staging.app.local` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SITE_URL` and a generated `IP_HASH_SECRET`. |
| `bootstrap` | If no owner exists, it generates a 43-character token and stores only `sha256` hex in `private.bootstrap`, in the same format as the migration: `encode(sha256(convert_to(token,'UTF8')),'hex')`. It writes the plaintext token to `web/.cache/bootstrap-token.local.txt`. |

Generated secrets are kept only in gitignored files:
- `web/.cache/staging-secrets.local.json` holds `STORAGE_CLEANUP_SECRET` and `IP_HASH_SECRET`.
- `web/.cache/bootstrap-token.local.txt` is deleted after the bootstrap.
- `web/.env.staging.app.local` holds the app env.

The scripts print only `<set, N chars>`.

### First owner

The app has no sign-up page, so `staging-bootstrap-owner.mjs` does the following:
1. Creates the owner account with the secret key and confirms its email.
2. Signs in with the password.
3. Calls `bootstrap_initial_owner(token)`.
4. Verifies `role = owner` and `mfa_required = true`.
5. Deletes the token file and the `private.bootstrap` row.

The token works once only; the RPC also refuses while any owner exists. On the first sign-in to the app, the owner is sent to `/login?step=mfa` to enrol TOTP. More staff are promoted from the admin UI, which calls `admin_set_user_role`.

## 3. What remains manual in the dashboard

- **SMTP (auth emails).** Without custom SMTP, the built-in mailer is heavily rate limited and only delivers to members of the project's team. Magic links and password resets for real customers need Auth → SMTP settings, for example a free tier of a transactional provider. Admin-created users (bootstrap, verify) do not need email.
- **Turnstile.** Create a widget for the staging hostname in Cloudflare and add `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to the app env. Without them, the public forms skip the Turnstile check.
- **Legacy API keys.** The Edge Function talks to PostgREST and Storage with the platform-injected `SUPABASE_SERVICE_ROLE_KEY`. Do **not** disable the legacy JWT keys until the function is moved to a `sb_secret_` key; `cron-verify` would catch the breakage.
- **Upload size (free plan).** The global storage upload limit is 50 MB, so private-media video originals and backup archives above 50 MB are rejected. Raising it requires a paid plan, which is not done here.

## 4. Rollback

Migrations are forward-only. For staging, the options are listed below.

**Both reset and delete are destructive. Run them only after explicit written confirmation from the project owner, and never against any other ref.**

- **Pause** the project (Dashboard → Project Settings → General → Pause). This is reversible and keeps the data.
- **Reset**: `npx supabase db reset --linked` wipes the remote database and re-applies the migrations. It deletes all staging data and users.
- Revert auth settings by PATCHing the previous values, which `auth-config` prints before changing them.
- Delete the function (`npx supabase functions delete storage-cleanup --project-ref dyuixzxmmeiypvawzmty`) and the Vault secrets (`delete from vault.secrets where name in ('storage_cleanup_url','storage_cleanup_key')`).

## 5. Cost

Everything above runs on the free tier: database, auth, storage, one Edge Function, pg_cron and pg_net. No paid add-ons are enabled, and no compute size, PITR, custom domain or branching changes are made. Free projects pause after about a week of inactivity, and pausing does not delete data.
