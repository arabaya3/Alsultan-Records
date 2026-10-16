-- 0013 Showcase videos (public YouTube clips from the studio's own channel) +
-- business_settings youtube_url / whatsapp_url.
--
-- Only an 11-char YouTube video ID is stored and rendered; no HTML/iframe is ever
-- accepted. Anon sees published rows and only the display columns. The admin record
-- (source_url, original_title, source, verification_notes, updated_by) is read via the
-- admin-only showcase_video_admin_details view, like customer_internal_notes.

create table public.showcase_videos (
  id uuid primary key default gen_random_uuid(),
  youtube_id text not null unique check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  source_url text not null
    check (source_url ~ '^https://(www\.|m\.)?(youtube\.com|youtu\.be)/[^\s<>"'']*$' and length(source_url) <= 300),
  original_title text check (original_title is null or length(original_title) <= 300),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  description text check (description is null or char_length(description) <= 500),
  category text not null
    check (category in ('wedding', 'evening', 'groom_prep', 'folk', 'engagement', 'graduation', 'festival', 'dj', 'other')),
  duration_seconds int check (duration_seconds is null or duration_seconds >= 0),
  published_at date,
  is_promo boolean not null default false,
  sort_order int not null default 100,
  is_published boolean not null default true,
  source text not null default 'youtube_channel' check (length(source) <= 60),
  verification_notes text check (verification_notes is null or length(verification_notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create unique index showcase_videos_one_promo on public.showcase_videos (is_promo) where is_promo;
create index showcase_videos_published_sort_idx on public.showcase_videos (is_published, sort_order);
create index showcase_videos_updated_by_idx on public.showcase_videos (updated_by);

create trigger set_updated_at before update on public.showcase_videos
  for each row execute function app.set_updated_at();
create trigger audit after insert or update or delete on public.showcase_videos
  for each row execute function app.audit_trigger();

-- updated_by is stamped from the JWT (never trusted from the client; not grantable).
create or replace function app.showcase_videos_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_by := coalesce((select auth.uid()), case when tg_op = 'UPDATE' then old.updated_by end);
  return new;
end $$;
create trigger showcase_videos_stamp before insert or update on public.showcase_videos
  for each row execute function app.showcase_videos_stamp();

-- ---------------------------------------------------------------- RLS + grants
alter table public.showcase_videos enable row level security;
revoke all on table public.showcase_videos from anon, authenticated;

grant select (id, youtube_id, title, description, category, duration_seconds, published_at, is_promo, sort_order)
  on public.showcase_videos to anon;
grant select (id, youtube_id, title, description, category, duration_seconds, published_at, is_promo, sort_order,
              is_published, created_at, updated_at)
  on public.showcase_videos to authenticated;
grant insert (youtube_id, source_url, original_title, title, description, category, duration_seconds, published_at,
              is_promo, sort_order, is_published, source, verification_notes)
  on public.showcase_videos to authenticated;
grant update (youtube_id, source_url, original_title, title, description, category, duration_seconds, published_at,
              is_promo, sort_order, is_published, source, verification_notes)
  on public.showcase_videos to authenticated;
grant delete on public.showcase_videos to authenticated;

create policy showcase_public_read on public.showcase_videos for select to anon, authenticated using (is_published);
create policy showcase_admin_read on public.showcase_videos for select to authenticated using (app.is_admin());
create policy showcase_admin_insert on public.showcase_videos for insert to authenticated with check (app.is_admin());
create policy showcase_admin_update on public.showcase_videos for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy showcase_admin_delete on public.showcase_videos for delete to authenticated using (app.is_admin());

create view public.showcase_video_admin_details with (security_barrier = true) as
  select v.id as video_id, v.source_url, v.original_title, v.source, v.verification_notes, v.updated_by
  from public.showcase_videos v
  where app.is_admin();
revoke all on public.showcase_video_admin_details from anon, authenticated;
grant select on public.showcase_video_admin_details to authenticated;

-- Atomic promo switch: unsets the previous promo and sets the new one in one transaction.
-- SECURITY INVOKER: the caller's grants + RLS apply (only admins can update rows).
create or replace function public.set_showcase_promo(p_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not app.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.showcase_videos where id = p_id) then
    raise exception 'video not found' using errcode = 'P0002';
  end if;
  update public.showcase_videos set is_promo = false where is_promo and id <> p_id;
  update public.showcase_videos set is_promo = true where id = p_id;
end $$;
revoke all on function public.set_showcase_promo(uuid) from public, anon;
grant execute on function public.set_showcase_promo(uuid) to authenticated;

-- ---------------------------------------------------------------- business_settings links
alter table public.business_settings
  add column youtube_url text
    check (youtube_url is null or (youtube_url ~ '^https://(www\.|m\.)?(youtube\.com|youtu\.be)/[^\s<>"'']*$' and length(youtube_url) <= 300)),
  add column whatsapp_url text
    check (whatsapp_url is null or (whatsapp_url ~ '^https://(wa\.me|api\.whatsapp\.com)/[^\s<>"'']*$' and length(whatsapp_url) <= 300));
-- 0005 grants table-wide SELECT on business_settings to anon/authenticated (and UPDATE to
-- authenticated, RLS: admin only), so the new columns are covered. Re-grant explicitly so
-- the public read survives any future narrowing to column grants.
grant select (youtube_url, whatsapp_url) on public.business_settings to anon, authenticated;
