import type { MetadataRoute } from "next";

/**
 * Installable app (Android «تثبيت التطبيق» / iOS «إضافة إلى الشاشة الرئيسية»).
 * Opens on /login, which sends a signed-in user straight to the admin (staff) or portal (customer).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/login",
    name: "ستوديو وتسجيلات السلطان",
    short_name: "السلطان",
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
}
