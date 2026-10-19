/**
 * Installable DASHBOARD app (separate from the public site's /manifest.webmanifest): opens on /login, which sends a
 * signed-in user straight to the admin (staff) or portal (customer). Linked from the (auth), admin and portal layouts.
 */
const MANIFEST = {
  id: "/login",
  name: "لوحة السلطان",
  short_name: "لوحة السلطان",
  description: "لوحة ستوديو وتسجيلات السلطان",
  lang: "ar",
  dir: "rtl",
  start_url: "/login",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#0b0b0b",
  theme_color: "#0b0b0b",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

export function GET() {
  return new Response(JSON.stringify(MANIFEST), {
    headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
