-- 0024 Owner requests (2026-10-20). Additive / relaxing only: no row is deleted, no existing value becomes invalid.
--
-- 1. Long texts: every owner-written DESCRIPTIVE text (descriptions, details, terms, intros, WhatsApp messages,
--    gift line, included-item lines, internal notes) accepts up to 10,000 characters (was 120–2,000). Short labels —
--    titles, slugs, nav/category labels, button labels, the announcement banner — keep their limits (layout).
-- 2. Home "stats" section: a counter the OWNER fills in from the admin (site_sections.stat_value). Hidden by default
--    and never rendered without a number, so the site never shows a figure nobody entered.
-- 3. Home order requested by the owner: latest offers → 4 newest albums → counter → 3 videos → services → process.

-- ------------------------------------------------------------------ 1. long texts (10,000)
alter table public.business_settings drop constraint if exists business_settings_hero_subtitle_check;
alter table public.business_settings add constraint business_settings_hero_subtitle_check
  check (hero_subtitle is null or char_length(hero_subtitle) <= 10000);
alter table public.business_settings drop constraint if exists business_settings_booking_message_check;
alter table public.business_settings add constraint business_settings_booking_message_check
  check (booking_message is null or char_length(booking_message) <= 10000);

alter table public.site_sections drop constraint if exists site_sections_intro_check;
alter table public.site_sections add constraint site_sections_intro_check
  check (intro is null or char_length(intro) <= 10000);

alter table public.process_steps drop constraint if exists process_steps_description_check;
alter table public.process_steps add constraint process_steps_description_check
  check (description is null or char_length(description) <= 10000);

alter table public.offers drop constraint if exists offers_description_check;
alter table public.offers add constraint offers_description_check
  check (description is null or char_length(description) <= 10000);
alter table public.offers drop constraint if exists offers_terms_check;
alter table public.offers add constraint offers_terms_check
  check (terms is null or char_length(terms) <= 10000);
alter table public.offers drop constraint if exists offers_whatsapp_message_check;
alter table public.offers add constraint offers_whatsapp_message_check
  check (whatsapp_message is null or char_length(whatsapp_message) <= 10000);
alter table public.offer_items drop constraint if exists offer_items_label_check;
alter table public.offer_items add constraint offer_items_label_check
  check (char_length(btrim(label)) between 1 and 10000);

alter table public.packages drop constraint if exists packages_description_check;
alter table public.packages add constraint packages_description_check
  check (description is null or char_length(description) <= 10000);
alter table public.packages drop constraint if exists packages_whatsapp_message_check;
alter table public.packages add constraint packages_whatsapp_message_check
  check (whatsapp_message is null or char_length(whatsapp_message) <= 10000);
alter table public.packages drop constraint if exists packages_gift_check;
alter table public.packages add constraint packages_gift_check
  check (gift is null or char_length(btrim(gift)) between 1 and 10000);
alter table public.packages drop constraint if exists packages_internal_note_check;
alter table public.packages add constraint packages_internal_note_check
  check (internal_note is null or char_length(internal_note) <= 10000);
alter table public.package_items drop constraint if exists package_items_label_check;
alter table public.package_items add constraint package_items_label_check
  check (char_length(btrim(label)) between 1 and 10000);

alter table public.photo_albums drop constraint if exists photo_albums_description_check;
alter table public.photo_albums add constraint photo_albums_description_check
  check (description is null or char_length(description) <= 10000);

alter table public.showcase_videos drop constraint if exists showcase_videos_description_check;
alter table public.showcase_videos add constraint showcase_videos_description_check
  check (description is null or char_length(description) <= 10000);

-- ------------------------------------------------------------------ 2. stats section
alter table public.site_sections drop constraint if exists site_sections_key_check;
alter table public.site_sections add constraint site_sections_key_check
  check (key in ('works', 'services', 'offers', 'promos', 'albums', 'process', 'about', 'contact', 'stats'));

alter table public.site_sections
  add column if not exists stat_value integer check (stat_value is null or stat_value between 1 and 10000000);
comment on column public.site_sections.stat_value is
  'stats section only: the number the owner enters (e.g. celebrations documented). NULL = section not rendered.';
grant select (stat_value) on public.site_sections to anon;
-- Same column-level model as the section's other editable columns (0017): admins write it through the existing
-- RLS policy (app.is_admin()); no table-wide grant.
grant update (stat_value) on public.site_sections to authenticated;

insert into public.site_sections (key, title, intro, is_visible, sort_order)
values ('stats', 'فرحة وثّقناها', null, false, 30)
on conflict (key) do nothing;

-- ------------------------------------------------------------------ 3. owner-requested home order
update public.site_sections set sort_order = 10, is_visible = true where key = 'offers';
update public.site_sections set sort_order = 20, is_visible = true, item_limit = 4 where key = 'albums';
update public.site_sections set sort_order = 30 where key = 'stats';
update public.site_sections set sort_order = 40, is_visible = true, item_limit = 3 where key = 'works';
update public.site_sections set sort_order = 50 where key = 'services';
update public.site_sections set sort_order = 60 where key = 'process';
update public.site_sections set sort_order = 70 where key = 'promos';
update public.site_sections set sort_order = 80 where key = 'about';
update public.site_sections set sort_order = 90 where key = 'contact';
