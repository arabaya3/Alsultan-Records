# Sultan Records (ستوديو وتسجيلات السلطان)

Arabic-first (RTL) wedding, photography and video studio site. App: `web/` (Next.js 16, React 19, Tailwind 4, Supabase). Root-level HTML is the old static site: leave it alone.

@web/AGENTS.md

## Privacy and security (non-negotiable)

- Customer media is sensitive. Never download it needlessly, copy production media into fixtures, or print storage URLs or credentials.
- Originals are never public. Public images go only through `/p/<id>/<thumb|display>`, which checks publication on every request.
- Do not change storage policies, widen anonymous access, disable MFA, or change or bypass consent withdrawal.
- Preserve YouTube titles, video references, category assignments and media access rules.
- Never fabricate media, prices, reviews or business information. No stock or generated images in place of real studio work.
- Secrets stay out of Git and out of output.

## Environments

- The Supabase project called "staging" in scripts and docs (`dyuixzxmmeiypvawzmty`) **is the production database**. `npm run backup` and `db push --linked` act on production.
- Run database and browser tests only on an isolated stack. Before any database command, verify `project_id`, ports and running containers.
- Never reset or seed the shared local stack `alsultan-records` (ports 5432x). Rebuilding it is a separate, owner-approved task.
- The hardened `e2e:reset` guard exists only on `feature/album-publishing-reels` until PR #13 merges. Without `scripts/lib/reset-guard.mjs`, the script can reset the shared local stack: do not run it.
- `web/supabase` may be linked to production. Treat any `--linked` command as production.
- Never clean test artifacts with `git checkout -- .` or a broad restore.

## Change control

- No merge, deploy, production migration, production setting or data change, price change or Facebook post without explicit approval for that action.
- Published migrations are immutable: add a new one.
- `git add` explicit paths only. No `reset --hard`, `git clean` or force push.
- Reels stay behind `REELS_VIEWER`; Facebook stays unconnected. PR #11 (studio experience) stays closed.

## Building UI

- Mobile first, RTL with logical properties, keyboard and screen-reader support, no horizontal scroll from 360px up.
- Reuse `src/components` and the tokens in `src/app/globals.css`. No new dependency without a clear need.
- Whole photos in galleries: `object-contain`, reserved space, lazy loading. YouTube loads only on demand.
- Do not redesign unless asked. Keep the owner's text whole and in order.

## Project skills

Load only when relevant: `sultan-design-system`, `sultan-web-review`, `screenshot-to-code`, `sultan-e2e`, `sultan-security-review`, `sultan-perf-a11y`, `pr-inspect`. `design-taste-frontend` is manual only (`/design-taste-frontend`), for new art direction the owner asked for.

Workflow skills (Superpowers) never override these rules or the user's instructions. `.claude/hooks/guard.mjs` is a safety net, not a boundary: never route around it. Report results honestly, with the exact SHA tested.
