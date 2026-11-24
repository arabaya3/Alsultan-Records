/**
 * Single source of cache tag names. Public reads tag with these (`cacheTag`), and every admin action that
 * changes public content calls `updateTag(...)` for each affected tag, so edits appear without a deploy.
 * Public reads use cacheLife("days") to stay inside the Vercel Hobby CPU allowance: these tags are the freshness
 * mechanism; the daily revalidation (Hebron midnight for date-bound offers) is only a safety net for changes made outside the app (SQL, date-bound offers).
 * Projects and their published photos (TAGS.projects, TAGS.media): every write goes through expirePublicProjects()
 * in features/publishing/public-cache.ts, which also repeats the expiry once renders in flight have settled.
 */
export const TAGS = {
  business: "business-settings",
  siteContent: "site-content",
  nav: "site-nav",
  sections: "site-sections",
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
