/**
 * Single source of cache tag names. Public reads tag with these (`cacheTag`), and every admin action that
 * changes public content calls `updateTag(...)` for each affected tag, so edits appear without a deploy.
 * Public reads use cacheLife("hours") to stay inside the Vercel Hobby CPU allowance: these tags are the freshness
 * mechanism; the 1 h revalidation is only a safety net for changes made outside the app (SQL, date-bound offers).
 */
export const TAGS = {
  business: "business-settings",
  siteContent: "site-content",
  nav: "site-nav",
  sections: "site-sections",
  services: "services",
  process: "process-steps",
  offers: "offers",
  packages: "packages",
  announcements: "announcements",
  videos: "showcase-videos",
  albums: "photo-albums",
  projects: "projects",
  media: "media",
  reviews: "reviews",
} as const;

export type CacheTag = (typeof TAGS)[keyof typeof TAGS];
