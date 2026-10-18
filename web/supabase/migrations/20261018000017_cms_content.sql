-- 0017 CMS (owner-managed site content), part 1: settings, brand assets, home sections, nav,
-- slug redirects, services extension + links, process steps, offers, announcements, video roles.
-- Binding contract: docs/cms-contract.md. NON-DESTRUCTIVE: only adds columns/tables/policies/functions;
-- all defaults keep the current public site exactly as it is (nulls = code fallbacks).
--
-- Every new table: RLS on, REVOKE ALL from anon/authenticated/public first, explicit column grants,
-- service_role grants (lesson from 0014), admin writes require app.is_admin() (aal2 rule included).
-- Anon reads display columns only, and only published/active rows.

-- ================================================================ 0. helpers
-- Calendar "today" in the studio's timezone. Offer/announcement windows are inclusive date ranges
-- evaluated against this date, so expiry needs no manual action or job.
create or replace function app.hebron_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Hebron')::date;
$$;

create or replace function app.date_window_ok(p_starts date, p_ends date)
returns boolean language sql stable set search_path = '' as $$
  select (p_starts is null or p_starts <= app.hebron_today())
     and (p_ends is null or p_ends >= app.hebron_today());
$$;

-- Generic updated_by stamp (from the JWT; never client-supplied — column not grantable).
create or replace function app.stamp_updated_by()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_by := coalesce((select auth.uid()), case when tg_op = 'UPDATE' then old.updated_by end);
  return new;
end $$;

-- Narrow audit: INSERT/DELETE always; UPDATE only when one of the watched columns (TG_ARGV) changed.
-- action = 'insert' | 'delete' | 'update:<col>[,<col>]' (e.g. 'update:status', 'update:deleted_at').
create or replace function app.cms_audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_changed text[] := '{}';
  v_col text;
  v_id uuid;
begin
  if tg_op = 'UPDATE' then
    foreach v_col in array tg_argv loop
      if (v_before -> v_col) is distinct from (v_after -> v_col) then
        v_changed := v_changed || v_col;
      end if;
    end loop;
    if cardinality(v_changed) = 0 then
      return null;
    end if;
  end if;
  begin
    v_id := coalesce(v_after ->> 'id', v_before ->> 'id')::uuid;
  exception when others then v_id := null;
  end;
  insert into public.audit_events (actor, action, entity_type, entity_id, before, after)
  values (auth.uid(),
          case when tg_op = 'UPDATE' then 'update:' || array_to_string(v_changed, ',') else lower(tg_op) end,
          tg_table_name, v_id, v_before, v_after);
  return null;
end $$;

revoke execute on function app.hebron_today(), app.date_window_ok(date, date) from public;
grant execute on function app.hebron_today(), app.date_window_ok(date, date) to anon, authenticated, service_role;
revoke execute on function app.stamp_updated_by(), app.cms_audit_trigger() from public, anon, authenticated;

-- Allow-listed internal page targets (nav items, announcement links). Paths live in code
-- (web/src/lib/site-targets.ts); admin/login are never targets.
create or replace function app.is_site_target(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p in ('home', 'work', 'services', 'offers', 'promos', 'albums', 'about', 'contact', 'book', 'faq');
$$;
revoke execute on function app.is_site_target(text) from public;
grant execute on function app.is_site_target(text) to anon, authenticated, service_role;

-- ================================================================ 1. brand_assets + site-media bucket
create table public.brand_assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'logo' check (kind in ('logo')),
  storage_path text not null unique
    check (storage_path ~ '^brand/[0-9a-f-]{36}/[a-z0-9_-]{1,40}\.(png|webp|jpg|avif)$'),
  mime text not null check (mime in ('image/png', 'image/webp', 'image/jpeg', 'image/avif')),
  width int check (width is null or width > 0),
  height int check (height is null or height > 0),
  bytes int check (bytes is null or bytes >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint brand_assets_path_id_check check (storage_path like 'brand/' || id::text || '/%')
);
create index brand_assets_created_by_idx on public.brand_assets (created_by);

create or replace function app.brand_assets_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_by := (select auth.uid());
  return new;
end $$;
revoke execute on function app.brand_assets_stamp() from public, anon, authenticated;
create trigger brand_assets_stamp before insert on public.brand_assets
  for each row execute function app.brand_assets_stamp();
create trigger audit after insert or update or delete on public.brand_assets
  for each row execute function app.audit_trigger();

-- Deleting an asset enqueues its object (orphan prevention); the FK on business_settings
-- (on delete set null) falls back to the built-in static logo.
create or replace function app.brand_assets_delete_enqueue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.storage_cleanup_queue (bucket, path, reason)
  values ('site-media', old.storage_path, 'brand_asset_deleted:' || old.id::text);
  return old;
end $$;
revoke execute on function app.brand_assets_delete_enqueue() from public, anon, authenticated;
create trigger brand_assets_delete_enqueue after delete on public.brand_assets
  for each row execute function app.brand_assets_delete_enqueue();

alter table public.brand_assets enable row level security;
revoke all on table public.brand_assets from anon, authenticated, public;
grant select on public.brand_assets to authenticated;
grant insert (id, kind, storage_path, mime, width, height, bytes, sha256, note),
      update (note, width, height),
      delete
  on public.brand_assets to authenticated;
grant all on public.brand_assets to service_role;
create policy brand_assets_admin_read on public.brand_assets for select to authenticated using (app.is_admin());
create policy brand_assets_admin_insert on public.brand_assets for insert to authenticated with check (app.is_admin());
create policy brand_assets_admin_update on public.brand_assets for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy brand_assets_admin_delete on public.brand_assets for delete to authenticated using (app.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', false, 5242880,  -- 5 MiB
        array['image/png', 'image/webp', 'image/jpeg', 'image/avif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ================================================================ 2. business_settings extension
alter table public.business_settings
  add column hero_title text check (hero_title is null or char_length(hero_title) <= 120),
  add column hero_subtitle text check (hero_subtitle is null or char_length(hero_subtitle) <= 600),
  add column hero_primary_label text check (hero_primary_label is null or char_length(hero_primary_label) <= 60),
  add column hero_secondary_label text check (hero_secondary_label is null or char_length(hero_secondary_label) <= 60),
  add column booking_message text check (booking_message is null or char_length(booking_message) <= 600),
  add column hero_cover_photo_id uuid references public.album_photos(id) on delete set null,
  add column hero_promo_source text not null default 'site' check (hero_promo_source in ('site', 'youtube')),
  add column hero_promo_video_id uuid references public.showcase_videos(id) on delete set null,
  add column active_logo_id uuid references public.brand_assets(id) on delete set null;
create index business_settings_hero_cover_idx on public.business_settings (hero_cover_photo_id);
create index business_settings_hero_promo_idx on public.business_settings (hero_promo_video_id);
create index business_settings_logo_idx on public.business_settings (active_logo_id);
-- 0005 grants table-wide SELECT (anon, authenticated) and UPDATE (authenticated; RLS admin only),
-- which already covers these display columns. Explicit grants document the intent.
grant select (hero_title, hero_subtitle, hero_primary_label, hero_secondary_label, booking_message,
              hero_cover_photo_id, hero_promo_source, hero_promo_video_id, active_logo_id)
  on public.business_settings to anon, authenticated;

-- Every settings change (identity texts, hero choice, logo activation/rollback) is audited.
create trigger audit after insert or update or delete on public.business_settings
  for each row execute function app.audit_trigger();

-- Public logo route (/a/<id>): returns the object path only while that asset is the ACTIVE logo.
create or replace function app.site_media_is_public(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_settings s
    join public.brand_assets b on b.id = s.active_logo_id
    where s.id = 1 and b.storage_path = p_name
  );
$$;
revoke execute on function app.site_media_is_public(text) from public;
grant execute on function app.site_media_is_public(text) to anon, authenticated, service_role;

create or replace function public.active_logo_path(p_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select b.storage_path
  from public.business_settings s
  join public.brand_assets b on b.id = s.active_logo_id
  where s.id = 1 and b.id = p_id;
$$;
revoke all on function public.active_logo_path(uuid) from public, anon, authenticated;
grant execute on function public.active_logo_path(uuid) to anon, authenticated, service_role;

create policy "site-media read active logo" on storage.objects for select to anon, authenticated
  using (bucket_id = 'site-media' and app.site_media_is_public(name));
create policy "site-media admin read" on storage.objects for select to authenticated
  using (bucket_id = 'site-media' and app.is_admin());
create policy "site-media admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-media' and app.is_admin());
create policy "site-media admin update" on storage.objects for update to authenticated
  using (bucket_id = 'site-media' and app.is_admin())
  with check (bucket_id = 'site-media' and app.is_admin());
create policy "site-media admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'site-media' and app.is_admin());

-- ================================================================ 3. site_sections (home sections)
create table public.site_sections (
  key text primary key
    check (key in ('works', 'services', 'offers', 'promos', 'albums', 'process', 'about', 'contact')),
  title text check (title is null or char_length(title) <= 120),
  intro text check (intro is null or char_length(intro) <= 600),
  is_visible boolean not null default true,
  sort_order int not null default 100,
  item_limit int not null default 6 check (item_limit between 1 and 12),
  featured_ids uuid[] not null default '{}' check (cardinality(featured_ids) <= 24),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
create index site_sections_updated_by_idx on public.site_sections (updated_by);
create trigger set_updated_at before update on public.site_sections
  for each row execute function app.set_updated_at();
create trigger stamp_updated_by before insert or update on public.site_sections
  for each row execute function app.stamp_updated_by();
create trigger audit after insert or update or delete on public.site_sections
  for each row execute function app.audit_trigger();

-- Seed = today's homepage: works, services, process visible in that order; the rest hidden
-- until the owner adds content and switches them on (homepage looks exactly the same).
insert into public.site_sections (key, title, is_visible, sort_order) values
  ('works',    'من أعمالنا',     true,  10),
  ('services', 'الخدمات',        true,  20),
  ('process',  'كيف نشتغل',      true,  30),
  ('offers',   'العروض',         false, 40),
  ('promos',   'فيديوهات ترويجية', false, 50),
  ('albums',   'ألبومات الصور',   false, 60),
  ('about',    'من نحن',          false, 70),
  ('contact',  'تواصل معنا',      false, 80)
on conflict (key) do nothing;

alter table public.site_sections enable row level security;
revoke all on table public.site_sections from anon, authenticated, public;
-- Section config is structural (not draft content): anon reads every row incl. is_visible so the
-- public code never mistakes a hidden section for a missing one. updated_by stays admin-only.
grant select (key, title, intro, is_visible, sort_order, item_limit, featured_ids) on public.site_sections to anon;
grant select on public.site_sections to authenticated;
grant update (title, intro, is_visible, sort_order, item_limit, featured_ids) on public.site_sections to authenticated;
grant all on public.site_sections to service_role;
create policy site_sections_public_read on public.site_sections for select to anon, authenticated using (true);
create policy site_sections_admin_update on public.site_sections for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ================================================================ 4. nav_items
create table public.nav_items (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 1 and 30),
  target text not null unique check (app.is_site_target(target)),
  sort_order int not null default 100,
  is_visible boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
create index nav_items_updated_by_idx on public.nav_items (updated_by);
create trigger set_updated_at before update on public.nav_items
  for each row execute function app.set_updated_at();
create trigger stamp_updated_by before insert or update on public.nav_items
  for each row execute function app.stamp_updated_by();
create trigger audit after insert or update or delete on public.nav_items
  for each row execute function app.audit_trigger();

-- Seed = today's header (أعمالنا, الخدمات, من نحن) + hidden entries for the new pages.
insert into public.nav_items (label, target, sort_order, is_visible) values
  ('أعمالنا', 'work',     10, true),
  ('الخدمات', 'services', 20, true),
  ('من نحن',  'about',    30, true),
  ('العروض',  'offers',   40, false),
  ('الألبومات', 'albums', 50, false),
  ('تواصل',   'contact',  60, false)
on conflict (target) do nothing;

alter table public.nav_items enable row level security;
revoke all on table public.nav_items from anon, authenticated, public;
grant select (id, label, target, sort_order, is_visible) on public.nav_items to anon;
grant select on public.nav_items to authenticated;
grant insert (label, target, sort_order, is_visible), update (label, target, sort_order, is_visible), delete
  on public.nav_items to authenticated;
grant all on public.nav_items to service_role;
create policy nav_items_public_read on public.nav_items for select to anon, authenticated using (true);
create policy nav_items_admin_insert on public.nav_items for insert to authenticated with check (app.is_admin());
create policy nav_items_admin_update on public.nav_items for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy nav_items_admin_delete on public.nav_items for delete to authenticated using (app.is_admin());

-- ================================================================ 5. slug_redirects
create table public.slug_redirects (
  from_path text primary key check (from_path ~ '^/(services|offers|work/albums)/[a-z0-9-]+$'),
  to_path text not null check (to_path ~ '^/(services|offers|work/albums)/[a-z0-9-]+$'),
  created_at timestamptz not null default now(),
  constraint slug_redirects_not_self check (from_path <> to_path)
);
create index slug_redirects_to_idx on public.slug_redirects (to_path);

-- Written by trigger only. Keeps redirects flat (no chains) and removes a redirect whose source
-- path becomes live again (slug renamed back).
create or replace function app.record_slug_redirect(p_from text, p_to text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_from = p_to then
    return;
  end if;
  delete from public.slug_redirects where from_path = p_to;
  update public.slug_redirects set to_path = p_to where to_path = p_from;
  insert into public.slug_redirects (from_path, to_path) values (p_from, p_to)
  on conflict (from_path) do update set to_path = excluded.to_path, created_at = now();
end $$;
revoke execute on function app.record_slug_redirect(text, text) from public, anon, authenticated;

create or replace function app.slug_change_redirect()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_prefix text := tg_argv[0];
begin
  if new.slug is distinct from old.slug then
    perform app.record_slug_redirect(v_prefix || old.slug, v_prefix || new.slug);
  end if;
  return null;
end $$;
revoke execute on function app.slug_change_redirect() from public, anon, authenticated;

create trigger slug_change_redirect after update of slug on public.services
  for each row execute function app.slug_change_redirect('/services/');
create trigger slug_change_redirect after update of slug on public.photo_albums
  for each row execute function app.slug_change_redirect('/work/albums/');

alter table public.slug_redirects enable row level security;
revoke all on table public.slug_redirects from anon, authenticated, public;
grant select (from_path, to_path) on public.slug_redirects to anon;
grant select, delete on public.slug_redirects to authenticated;
grant all on public.slug_redirects to service_role;
create policy slug_redirects_public_read on public.slug_redirects for select to anon, authenticated using (true);
create policy slug_redirects_admin_delete on public.slug_redirects for delete to authenticated using (app.is_admin());

-- ================================================================ 6. services extension + links
alter table public.services
  add column cover_photo_id uuid references public.album_photos(id) on delete set null;
create index services_cover_photo_idx on public.services (cover_photo_id);
-- 0005 grants table-wide SELECT/INSERT/UPDATE on services (RLS: published or admin) — covers it.

create trigger audit after insert or update or delete on public.services
  for each row execute function app.cms_audit_trigger('is_published', 'slug', 'title');

create table public.service_links (
  service_id uuid not null references public.services(id) on delete cascade,
  kind text not null check (kind in ('video', 'album')),
  target_id uuid not null,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  primary key (service_id, kind, target_id)
);
create index service_links_target_idx on public.service_links (kind, target_id);

create or replace function app.service_links_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.kind = 'video' and not exists (select 1 from public.showcase_videos v where v.id = new.target_id))
     or (new.kind = 'album' and not exists (select 1 from public.photo_albums a where a.id = new.target_id)) then
    raise exception 'service link target not found' using errcode = '23503';
  end if;
  return new;
end $$;
create trigger service_links_check before insert or update on public.service_links
  for each row execute function app.service_links_check();

-- Polymorphic target: drop links when the target row is deleted.
create or replace function app.service_links_target_deleted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.service_links
  where target_id = old.id and kind = case tg_table_name when 'showcase_videos' then 'video' else 'album' end;
  return old;
end $$;
create trigger service_links_target_deleted after delete on public.showcase_videos
  for each row execute function app.service_links_target_deleted();
create trigger service_links_target_deleted after delete on public.photo_albums
  for each row execute function app.service_links_target_deleted();
revoke execute on function app.service_links_check(), app.service_links_target_deleted() from public, anon, authenticated;

create or replace function app.service_is_public(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.services s where s.id = p_id and s.is_published);
$$;
revoke execute on function app.service_is_public(uuid) from public;
grant execute on function app.service_is_public(uuid) to anon, authenticated, service_role;

alter table public.service_links enable row level security;
revoke all on table public.service_links from anon, authenticated, public;
grant select (service_id, kind, target_id, sort_order) on public.service_links to anon;
grant select on public.service_links to authenticated;
grant insert (service_id, kind, target_id, sort_order), update (sort_order), delete on public.service_links to authenticated;
grant all on public.service_links to service_role;
-- app.album_is_public is redefined in 0018 to also exclude archived/trashed albums.
create policy service_links_public_read on public.service_links for select to anon, authenticated
  using (app.service_is_public(service_id)
         and ((kind = 'video' and app.video_is_public(target_id))
              or (kind = 'album' and app.album_is_public(target_id))));
create policy service_links_admin_read on public.service_links for select to authenticated using (app.is_admin());
create policy service_links_admin_insert on public.service_links for insert to authenticated with check (app.is_admin());
create policy service_links_admin_update on public.service_links for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy service_links_admin_delete on public.service_links for delete to authenticated using (app.is_admin());

-- ================================================================ 7. process_steps
create table public.process_steps (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  description text check (description is null or char_length(description) <= 300),
  photo_id uuid references public.album_photos(id) on delete set null,
  sort_order int not null default 100,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
create index process_steps_pub_sort_idx on public.process_steps (is_published, sort_order);
create index process_steps_photo_idx on public.process_steps (photo_id);
create index process_steps_updated_by_idx on public.process_steps (updated_by);
create trigger set_updated_at before update on public.process_steps
  for each row execute function app.set_updated_at();
create trigger stamp_updated_by before insert or update on public.process_steps
  for each row execute function app.stamp_updated_by();
create trigger audit after insert or update or delete on public.process_steps
  for each row execute function app.cms_audit_trigger('is_published');

-- Seed = home-content.ts STEPS verbatim (only when the table is empty).
insert into public.process_steps (title, description, sort_order)
select v.title, v.description, v.sort_order
from (values
  ('راسلنا على واتساب', 'اكتب نوع المناسبة وتاريخها ومكانها والخدمات اللي بتحتاجها.', 10),
  ('نتفق على التفاصيل', 'نرد عليك على واتساب أو بالهاتف ونتفق على الموعد والتفاصيل.', 20),
  ('يوم المناسبة', 'فريقنا يكون حاضراً في الوقت ويوثّق اليوم كما هو.', 30),
  ('التسليم', 'نتفق معك على طريقة وموعد استلام صورك وفيلمك.', 40)
) as v(title, description, sort_order)
where not exists (select 1 from public.process_steps);

alter table public.process_steps enable row level security;
revoke all on table public.process_steps from anon, authenticated, public;
grant select (id, title, description, photo_id, sort_order) on public.process_steps to anon;
grant select on public.process_steps to authenticated;
grant insert (title, description, photo_id, sort_order, is_published),
      update (title, description, photo_id, sort_order, is_published), delete
  on public.process_steps to authenticated;
grant all on public.process_steps to service_role;
create policy process_steps_public_read on public.process_steps for select to anon using (is_published);
create policy process_steps_admin_read on public.process_steps for select to authenticated using (app.is_admin());
create policy process_steps_admin_insert on public.process_steps for insert to authenticated with check (app.is_admin());
create policy process_steps_admin_update on public.process_steps for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy process_steps_admin_delete on public.process_steps for delete to authenticated using (app.is_admin());

-- ================================================================ 8. offers + offer_items
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  description text check (description is null or char_length(description) <= 1000),
  image_photo_id uuid references public.album_photos(id) on delete set null,
  price_minor bigint check (price_minor is null or price_minor >= 0),
  currency char(3) not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  show_price boolean not null default false,
  -- What anon may see: the price only when the owner chose to show it.
  display_price_minor bigint generated always as (case when show_price then price_minor end) stored,
  starts_on date,
  ends_on date,
  terms text check (terms is null or char_length(terms) <= 2000),
  whatsapp_message text check (whatsapp_message is null or char_length(whatsapp_message) <= 600),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  pinned_home boolean not null default false,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint offers_window_check check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index offers_status_sort_idx on public.offers (status, sort_order);
create index offers_image_idx on public.offers (image_photo_id);
create index offers_updated_by_idx on public.offers (updated_by);
create trigger set_updated_at before update on public.offers
  for each row execute function app.set_updated_at();
create trigger stamp_updated_by before insert or update on public.offers
  for each row execute function app.stamp_updated_by();
create trigger audit after insert or update or delete on public.offers
  for each row execute function app.cms_audit_trigger('status', 'slug', 'starts_on', 'ends_on', 'pinned_home');
create trigger slug_change_redirect after update of slug on public.offers
  for each row execute function app.slug_change_redirect('/offers/');

-- Active = published and today (Asia/Hebron) within the inclusive window.
create or replace function app.offer_is_active(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.offers o
                 where o.id = p_id and o.status = 'published' and app.date_window_ok(o.starts_on, o.ends_on));
$$;
revoke execute on function app.offer_is_active(uuid) from public;
grant execute on function app.offer_is_active(uuid) to anon, authenticated, service_role;

alter table public.offers enable row level security;
revoke all on table public.offers from anon, authenticated, public;
grant select (id, slug, title, description, image_photo_id, display_price_minor, currency, show_price,
              starts_on, ends_on, terms, whatsapp_message, pinned_home, sort_order)
  on public.offers to anon;
grant select on public.offers to authenticated;
grant insert (slug, title, description, image_photo_id, price_minor, currency, show_price, starts_on, ends_on,
              terms, whatsapp_message, status, pinned_home, sort_order),
      update (slug, title, description, image_photo_id, price_minor, currency, show_price, starts_on, ends_on,
              terms, whatsapp_message, status, pinned_home, sort_order),
      delete
  on public.offers to authenticated;
grant all on public.offers to service_role;
create policy offers_public_read on public.offers for select to anon using (app.offer_is_active(id));
create policy offers_admin_read on public.offers for select to authenticated using (app.is_admin());
create policy offers_admin_insert on public.offers for insert to authenticated with check (app.is_admin());
create policy offers_admin_update on public.offers for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy offers_admin_delete on public.offers for delete to authenticated using (app.is_admin());

create table public.offer_items (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index offer_items_offer_sort_idx on public.offer_items (offer_id, sort_order);
create trigger set_updated_at before update on public.offer_items
  for each row execute function app.set_updated_at();

alter table public.offer_items enable row level security;
revoke all on table public.offer_items from anon, authenticated, public;
grant select (id, offer_id, label, sort_order) on public.offer_items to anon;
grant select on public.offer_items to authenticated;
grant insert (offer_id, label, sort_order), update (label, sort_order), delete on public.offer_items to authenticated;
grant all on public.offer_items to service_role;
create policy offer_items_public_read on public.offer_items for select to anon using (app.offer_is_active(offer_id));
create policy offer_items_admin_read on public.offer_items for select to authenticated using (app.is_admin());
create policy offer_items_admin_insert on public.offer_items for insert to authenticated with check (app.is_admin());
create policy offer_items_admin_update on public.offer_items for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy offer_items_admin_delete on public.offer_items for delete to authenticated using (app.is_admin());

-- ================================================================ 9. announcements
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  template text not null default 'bar' check (template in ('bar', 'banner')),
  text text not null check (char_length(btrim(text)) between 1 and 140),
  link_kind text not null default 'none' check (link_kind in ('none', 'offer', 'page')),
  link_offer_id uuid references public.offers(id) on delete set null,
  link_page text check (link_page is null or app.is_site_target(link_page)),
  starts_on date,
  ends_on date,
  is_visible boolean not null default false,
  dismissible boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint announcements_window_check check (ends_on is null or starts_on is null or ends_on >= starts_on),
  constraint announcements_page_link_check check (link_kind <> 'page' or link_page is not null)
  -- link_kind 'offer' with a NULL/inactive offer renders without a link (offer may be deleted/expired).
);
create index announcements_visible_sort_idx on public.announcements (is_visible, sort_order);
create index announcements_offer_idx on public.announcements (link_offer_id);
create index announcements_updated_by_idx on public.announcements (updated_by);
create trigger set_updated_at before update on public.announcements
  for each row execute function app.set_updated_at();
create trigger stamp_updated_by before insert or update on public.announcements
  for each row execute function app.stamp_updated_by();
create trigger audit after insert or update or delete on public.announcements
  for each row execute function app.cms_audit_trigger('is_visible', 'starts_on', 'ends_on', 'text');

create or replace function app.announcement_is_active(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.announcements a
                 where a.id = p_id and a.is_visible and app.date_window_ok(a.starts_on, a.ends_on));
$$;
revoke execute on function app.announcement_is_active(uuid) from public;
grant execute on function app.announcement_is_active(uuid) to anon, authenticated, service_role;

alter table public.announcements enable row level security;
revoke all on table public.announcements from anon, authenticated, public;
grant select (id, template, text, link_kind, link_offer_id, link_page, starts_on, ends_on, dismissible, sort_order)
  on public.announcements to anon;
grant select on public.announcements to authenticated;
grant insert (template, text, link_kind, link_offer_id, link_page, starts_on, ends_on, is_visible, dismissible, sort_order),
      update (template, text, link_kind, link_offer_id, link_page, starts_on, ends_on, is_visible, dismissible, sort_order),
      delete
  on public.announcements to authenticated;
grant all on public.announcements to service_role;
create policy announcements_public_read on public.announcements for select to anon using (app.announcement_is_active(id));
create policy announcements_admin_read on public.announcements for select to authenticated using (app.is_admin());
create policy announcements_admin_insert on public.announcements for insert to authenticated with check (app.is_admin());
create policy announcements_admin_update on public.announcements for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy announcements_admin_delete on public.announcements for delete to authenticated using (app.is_admin());

-- ================================================================ 10. showcase_videos: role / pinned / cover
alter table public.showcase_videos
  add column role text not null default 'work' check (role in ('work', 'promo', 'both')),
  add column pinned boolean not null default false,
  add column custom_cover_photo_id uuid references public.album_photos(id) on delete set null;
create index showcase_videos_cover_idx on public.showcase_videos (custom_cover_photo_id);
-- Backfill: the current main promo is both a work and a promo (is_promo itself is unchanged).
update public.showcase_videos set role = 'both' where is_promo and role = 'work';

grant select (role, pinned, custom_cover_photo_id) on public.showcase_videos to anon, authenticated;
grant insert (role, pinned, custom_cover_photo_id), update (role, pinned, custom_cover_photo_id)
  on public.showcase_videos to authenticated;
-- showcase_videos already has the full audit trigger (0013): publish/unpublish/delete are audited.
