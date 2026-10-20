import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabase = supabaseUrl ? new URL(supabaseUrl) : null;
const supabaseOrigin = supabase?.origin ?? "";
const supabaseWs = supabaseOrigin.replace(/^http/, "ws");
// Hosted projects: album uploads use the direct storage hostname (<ref>.storage.supabase.co, recommended for large
// files) — see src/features/albums-admin/upload-engine.ts. Only that exact host is allowed, never a wildcard.
const storageDirect = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(supabaseOrigin) ? supabaseOrigin.replace(".supabase.co", ".storage.supabase.co") : "";

// Next injects inline bootstrap scripts; moving to a nonce-based CSP via proxy.ts would allow
// dropping 'unsafe-inline' at the cost of disabling static rendering. Tracked in docs/security-model.md.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://i.ytimg.com ${supabaseOrigin}`,
  `media-src 'self' blob: ${supabaseOrigin}`,
  "font-src 'self'",
  `connect-src 'self' ${supabaseOrigin} ${storageDirect} ${supabaseWs} https://challenges.cloudflare.com`.replace(/\s+/g, " "),
  "frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  // RAW decoding (src/features/photo-processing/raw.ts): LibRaw as WebAssembly, loaded at runtime from
  // node_modules; its .wasm must ship with every function that runs the photo worker.
  serverExternalPackages: ["libraw-wasm"],
  outputFileTracingIncludes: {
    "/api/jobs/process-photos": ["./node_modules/libraw-wasm/dist/**"],
    "/admin/albums/[id]": ["./node_modules/libraw-wasm/dist/**"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  images: {
    // Published media is served same-origin by app/m/[assetId]/[variant]/route.ts, which re-checks
    // consent per request (public-media is a private bucket). Media components render it
    // `unoptimized`, so the optimizer cache is not in the revocation path; if it ever is, its
    // TTL is pinned to the route's max-age (60 s) so it cannot widen the documented window.
    localPatterns: [
      { pathname: "/m/**", search: "" },
      { pathname: "/brand/**", search: "" },
    ],
    remotePatterns: [{ protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" }],
    minimumCacheTTL: 60,
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/(admin|portal|login|auth)/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        // Legacy service-worker kill switch (public/sw.js): browsers must always fetch the current file.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // Studio promo: content-hashed filenames written by scripts/sync-promo.mjs (new file → new URL),
        // so long-lived immutable caching is safe. Range requests are served by the static file server/CDN.
        source: "/promo/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
