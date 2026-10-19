import type { MetadataRoute } from "next";

/**
 * Installable PUBLIC site (Android «تثبيت التطبيق» / iOS «إضافة إلى الشاشة الرئيسية»), opens on the home page.
 * The dashboard is a separate installable app: /app.webmanifest (linked from the login/admin/portal layouts).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ستوديو وتسجيلات السلطان",
    short_name: "السلطان",
    description: "تصوير فوتوغرافي وأفلام أعراس وتنسيق مناسبات وDJ",
    lang: "ar",
    dir: "rtl",
    start_url: "/",
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
}
