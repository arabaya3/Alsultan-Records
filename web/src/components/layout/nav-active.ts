/**
 * Active nav link (header + mobile menu). Links may carry a query (`/work?tab=photos` = «الألبومات» in the CMS nav):
 *   - a link WITH a query is active only on its path with all of its query values present;
 *   - a plain link is active on its path or a sub-page ("/" only matches itself) — unless a more specific link of the
 *     same nav (same path + matching query) is active, so two links never light up for one page.
 */
export function isActivePath(pathname: string | null, href: string) {
  if (!pathname) return false;
  const path = href.split("?")[0] || "/";
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}

function queryMatches(href: string, search: URLSearchParams): boolean {
  const q = href.split("?")[1];
  if (!q) return true;
  for (const [k, v] of new URLSearchParams(q)) if (search.get(k) !== v) return false;
  return true;
}

export function activeHref(pathname: string | null, search: URLSearchParams | null, hrefs: string[]): string | null {
  const s = search ?? new URLSearchParams();
  const withQuery = hrefs.filter((h) => h.includes("?") && pathname === (h.split("?")[0] || "/") && queryMatches(h, s));
  if (withQuery.length) return withQuery.sort((a, b) => b.length - a.length)[0];
  return hrefs.find((h) => !h.includes("?") && isActivePath(pathname, h)) ?? null;
}
