-- 0036 Owner request (2026-11-27): three counters in the home hero — videos filmed, photos taken, events covered.
-- The OWNER types each number in the admin (الصفحة الرئيسية ← الواجهة). Nothing is counted automatically: the site
-- holds only part of the studio's work, so a computed figure would understate it. A null number is not shown, and
-- the block is not rendered at all when all three are null (the default), so production looks the same until the
-- owner fills them in. Additive only.
--
-- Rollback: alter table public.business_settings drop column hero_stat_videos, drop column hero_stat_photos,
--           drop column hero_stat_events;

alter table public.business_settings
  add column hero_stat_videos integer check (hero_stat_videos is null or hero_stat_videos between 1 and 10000000),
  add column hero_stat_photos integer check (hero_stat_photos is null or hero_stat_photos between 1 and 10000000),
  add column hero_stat_events integer check (hero_stat_events is null or hero_stat_events between 1 and 10000000);

-- Public numbers on the home page (same as the other hero_* columns). Updates use the existing table grant + RLS.
grant select (hero_stat_videos, hero_stat_photos, hero_stat_events) on public.business_settings to anon, authenticated;
