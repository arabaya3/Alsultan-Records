# Recommended security headers (for the lead to apply in `next.config.ts`)

`next.config.ts` is lead-owned, so this is a proposal. It covers what the public site actually loads:
self-hosted fonts (next/font), Supabase (REST + public storage), Cloudflare Turnstile, and GSAP (bundled).

```ts
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const csp = [
  "default-src 'self'",
  // Next injects inline bootstrap scripts; move to a nonce via proxy.ts to drop 'unsafe-inline'
  // (see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com" +
    (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${SUPABASE}`,
  `media-src 'self' blob: ${SUPABASE}`,
  "font-src 'self'",
  `connect-src 'self' ${SUPABASE} ${SUPABASE.replace(/^https/, "wss")}`,
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

export const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// in nextConfig:
// async headers() { return [{ source: "/:path*", headers: securityHeaders }]; },
```

Also recommended for the same file:

```ts
images: {
  remotePatterns: [{ protocol: "https", hostname: "<project-ref>.supabase.co", pathname: "/storage/v1/object/public/public-media/**" }],
},
```

Once that is in place, the `unoptimized` prop can be removed from `MediaFrame` / `ProjectTile` / hero image.

## Real 404 for unknown public slugs (proxy.ts, lead-owned)

With Cache Components/PPR the shell streams with 200 before `notFound()` runs, so unknown slugs are soft 404s (they do carry `noindex`). Next 16 docs (`file-conventions/loading.md` → "Status codes") prescribe a Proxy check. Add to the existing `proxy.ts` before the auth logic:

```ts
import { publicSlugExists } from "@/features/public-content/slug-guard";

const m = request.nextUrl.pathname.match(/^\/(work|services)\/([^/]+)\/?$/);
if (m && !(await publicSlugExists(m[1] as "work" | "services", decodeURIComponent(m[2])))) {
  return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
}
```
and include `/work/:slug*` and `/services/:slug*` in the matcher.
