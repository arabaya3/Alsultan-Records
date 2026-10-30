---
name: sultan-security-review
description: Sultan Records security checklist for auth, MFA, client isolation, private photos, consent and API authorization. Use when reviewing changes that touch these, or before a release. Complements the built-in /security-review.
---

# Security review

Run the built-in `/security-review` for the diff, then check what applies here. Read-only: report findings, and do not change policies without approval. Reference: `docs/security-model.md`.

| Area | Check | Evidence |
|---|---|---|
| Admin auth | Server actions call `guard` with the right roles; the UI hiding a button is not protection | `src/features/admin/guard`, `admin`, `qa-security` specs |
| MFA | aal2 still required where it was; no new bypass | `mfa` spec |
| Client isolation | RLS scopes customers to their own rows; no service client on a customer's request path | `web/supabase/tests`, `qa-portal` spec |
| Private storage | Buckets stay private; no new signed or public URL reaches the wrong person | migrations, `photos` spec |
| Thumbnail vs original | `/p` allows only thumb and display, checks publication before any conditional 304 | `src/app/p/[photoId]/[variant]/route.ts` |
| Consent withdrawal | Withdrawing removes published copies, including through the scheduled worker | `consent-actions.ts`, `consent-revocation` spec |
| Sensitive exposure | Server secrets stay out of the bundle; errors and logs carry no tokens | `node scripts/check-bundle-secrets.mjs` after a build |
| API authorization | Job routes require `x-jobs-secret`; new tables have RLS and narrow grants | `src/app/api/jobs`, pgTAP |
| Dependencies | `npm audit --omit=dev` in `web/`; review before upgrading, never `audit fix --force` | |

Report each finding with file, line, a concrete exploit scenario and severity. Say what you did not check.
