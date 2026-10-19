import type { MetadataRoute } from "next";
import { siteUrl } from "@/features/public-content/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/portal", "/auth", "/login", "/api", "/track"] }],
    sitemap: new URL("/sitemap.xml", siteUrl()).toString(),
  };
}
