# Public site notes (design/public owner)

## Legal pages
`/privacy` and `/terms` are DRAFTS pending local legal review (Palestinian law). Marked by a code comment in each page; no customer-facing banner. Owner must approve before launch.

## Placeholders
Media without real assets renders "صورة مؤقتة — بانتظار أعمال الاستوديو" only when NODE_ENV !== production. In production, sections without real content are hidden (hero image, showcase).

## Integration TODOs for lead/backend
- Booking/track server actions use a local service-role client (`features/bookings/public/server.ts`) because the public RPCs are granted to service_role only; switch to `@/lib/supabase/admin` when it exists.
- Env used: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or _ANON_KEY), SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY), TURNSTILE_SECRET_KEY (or TURNSTILE_SECRET), NEXT_PUBLIC_TURNSTILE_SITE_KEY, IP_HASH_SALT, NEXT_PUBLIC_SITE_URL.
- Apply `web/src/components/layout/security-headers.md` (CSP + images.remotePatterns) in next.config.ts.
