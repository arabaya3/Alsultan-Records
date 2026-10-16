import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { publicSlugExists, type PublicSlugKind } from "@/features/public-content/slug-guard";

/**
 * Refreshes the Supabase session cookie on authenticated areas only, so public pages stay
 * statically cacheable. Authorization is NOT decided here: every admin/portal page and action
 * re-checks the user server-side, and RLS enforces access in the database.
 */
export async function proxy(request: NextRequest) {
  // Real 404 for unknown public slugs: with Cache Components the shell streams 200 before notFound().
  const nested = request.nextUrl.pathname.match(/^\/work\/(v|albums)\/([^/]+)\/?$/);
  const slug = nested ?? request.nextUrl.pathname.match(/^\/(work|services)\/([^/]+)\/?$/);
  if (slug) {
    const kind: PublicSlugKind = nested ? (nested[1] === "v" ? "video" : "album") : (slug[1] as "work" | "services");
    let value: string;
    try {
      value = decodeURIComponent(slug[2]);
    } catch {
      value = "";
    }
    if (!(await publicSlugExists(kind, value))) {
      return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
    }
    return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let response = NextResponse.next({ request });
  if (!url || !key) return response;

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  if (!data?.claims && (path.startsWith("/portal") || path.startsWith("/admin"))) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ["/work/:slug", "/work/v/:id", "/work/albums/:slug", "/services/:slug", "/portal/:path*", "/admin/:path*", "/login", "/auth/:path*"],
};
