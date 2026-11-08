-- 0035: «نشر على فيسبوك» for a photo album — a real Facebook Page ALBUM (POST /{page-id}/albums, then the photos
-- into it with POST /{album-id}/photos), separate from publishing the album on the site.
--
-- facebook_album_posts — one row per site album (unique album_id) = no duplicates: a double click, a retry or a second
--   admin can never create a second Facebook album for the same site album. Re-running only adds the photos that
--   are not on Facebook yet, into the SAME Facebook album.
--   States: creating → uploading → published | failed
--     creating  : the album request is about to be / was sent; fb_album_id unknown yet. If that response was lost,
--                 the next run looks the album up on the Page by its exact name instead of creating another.
--     uploading : the Facebook album exists (fb_album_id stored before any photo is sent); `done` maps every photo
--                 already on Facebook (site photo id → Facebook photo id), saved after each one.
--   lease_until  : one run at a time (claimed with a conditional update; expires so a crashed run never blocks).
--   The Page token is never stored here (it stays in Vault, read by the server through meta_page_token()).
--   Deleting the site album keeps this row (album_id set null) and never deletes anything on Facebook.
--
-- Rollback: drop table public.facebook_album_posts. Nothing on Facebook is touched by a rollback.

create table public.facebook_album_posts (
  id uuid primary key default gen_random_uuid(),
  album_id uuid unique references public.photo_albums(id) on delete set null,
  page_id text not null check (page_id ~ '^[0-9]{1,32}$'),
  page_name text not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  photo_ids uuid[] not null check (cardinality(photo_ids) between 1 and 100),
  done jsonb not null default '{}'::jsonb check (jsonb_typeof(done) = 'object'),
  fb_album_id text check (fb_album_id is null or fb_album_id ~ '^[0-9_]{1,64}$'),
  fb_album_url text check (fb_album_url is null or fb_album_url ~ '^https://(www\.|m\.)?facebook\.com/'),
  status text not null default 'creating' check (status in ('creating', 'uploading', 'published', 'failed')),
  last_error text check (last_error is null or char_length(last_error) <= 400),
  attempts int not null default 0 check (attempts >= 0),
  lease_until timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check (status not in ('uploading', 'published') or fb_album_id is not null)
);

alter table public.facebook_album_posts enable row level security;
-- Owners/admins read the state in the admin. Every write goes through the server (service role) after the role check.
create policy facebook_album_posts_admin_read on public.facebook_album_posts for select to authenticated using (app.is_admin());
revoke all on public.facebook_album_posts from anon, authenticated;
grant select on public.facebook_album_posts to authenticated;
grant all on public.facebook_album_posts to service_role;
