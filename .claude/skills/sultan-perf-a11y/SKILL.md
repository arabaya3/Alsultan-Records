---
name: sultan-perf-a11y
description: Measure Sultan Records performance, Core Web Vitals, image and video loading, and accessibility using existing tooling. Use for performance or accessibility checks.
---

# Performance and accessibility

No new dependency: axe and Playwright are already in `web/`. Lighthouse runs on demand through a pinned `npx`.

```bash
cd web
# Accessibility and page checks, isolated stack:
BASE_URL=http://127.0.0.1:<port> npx playwright test a11y-axe a11y-manual qa-responsive
# LCP, CLS and long tasks on a throttled Pixel 7:
BASE_URL=http://127.0.0.1:<port> npx playwright test intro -g "mobile perf"
# Lighthouse, public pages only; output outside the repo:
CHROME_PATH="$(node -e "console.log(require('playwright').chromium.executablePath())")" \
  npx --yes lighthouse@13.6.0 <url> --quiet --chrome-flags="--headless=new" --only-categories=performance,accessibility,best-practices,seo --output=json --output-path=<scratch>/lh.json
```

Run Lighthouse on a production build, never `next dev`, and never on signed-in admin or portal pages against production.

Check:
- **Images:** covers use `srcset` and `sizes`; below-the-fold is lazy; space is reserved (no CLS); galleries don't load `display` when `thumb` is enough.
- **Video:** no YouTube iframe or script before the visitor asks; poster only; one player at a time.
- **Targets:** LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, axe with no serious or critical issue.

Lab numbers are not field data. Say which device profile and URL were measured.
