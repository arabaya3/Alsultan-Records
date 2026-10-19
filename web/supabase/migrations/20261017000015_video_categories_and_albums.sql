-- 0015 Video categories (many-to-many, admin-owned) + photo albums (private bucket album-media).
--
-- Owner decision: the public video `title` is the ORIGINAL YouTube title verbatim (may name grooms;
-- rendered as text only). `title_source` says whether the import may refresh it ('youtube') or an
-- admin owns it ('manual'). Import bookkeeping columns (youtube_title, youtube_description,
-- needs_review, review_note, reviewed_at) are admin-only: they are not column-granted and are read
-- through the showcase_video_admin_details view.
--
-- Albums: rows are public only while published; photo bytes live in the PRIVATE bucket
-- `album-media` and are readable with the anon key only while the photo AND its album are
-- published (storage policy via app.album_object_is_public), mirroring 0010's /m route.

-- ================================================================ 1. video categories
create table public.video_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9_]{2,30}$'),
  title text not null check (char_length(btrim(title)) between 2 and 60),
  sort_order int not null default 100,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index video_categories_pub_sort_idx on public.video_categories (is_published, sort_order);
create trigger set_updated_at before update on public.video_categories
  for each row execute function app.set_updated_at();
create trigger audit after insert or update or delete on public.video_categories
  for each row execute function app.audit_trigger();

create table public.showcase_video_categories (
  video_id uuid not null references public.showcase_videos(id) on delete cascade,
  category_id uuid not null references public.video_categories(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (video_id, category_id)
);
create unique index showcase_video_categories_one_primary on public.showcase_video_categories (video_id) where is_primary;
create index showcase_video_categories_category_idx on public.showcase_video_categories (category_id);
create trigger audit after insert or update or delete on public.showcase_video_categories
  for each row execute function app.audit_trigger();

-- ================================================================ 2. showcase_videos additions
alter table public.showcase_videos
  add column youtube_title text check (youtube_title is null or length(youtube_title) <= 300),
  add column title_source text not null default 'youtube' check (title_source in ('youtube', 'manual')),
  add column needs_review boolean not null default false,
  add column review_note text check (review_note is null or length(review_note) <= 2000),
  add column youtube_description text check (youtube_description is null or length(youtube_description) <= 10000),
  add column reviewed_at timestamptz;
-- Legacy single category: kept (and its CHECK), no longer meaningful; defaults to 'other'.
alter table public.showcase_videos alter column category set default 'other';
-- Titles are original YouTube titles now (YouTube allows 100 chars; keep headroom).
alter table public.showcase_videos drop constraint if exists showcase_videos_title_check;
alter table public.showcase_videos add constraint showcase_videos_title_check
  check (char_length(btrim(title)) between 2 and 200);

-- An admin (API caller) changing needs_review records the review time; the import (service_role)
-- never flips rows whose reviewed_at is set (enforced in the script).
create or replace function app.showcase_videos_review_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.needs_review is distinct from old.needs_review
     and coalesce(auth.role(), '') = 'authenticated' then
    new.reviewed_at := now();
  end if;
  if app.is_api_role() and tg_op = 'UPDATE' and new.reviewed_at is distinct from old.reviewed_at
     and new.needs_review is not distinct from old.needs_review then
    new.reviewed_at := old.reviewed_at; -- only set via needs_review changes
  end if;
  return new;
end $$;
create trigger showcase_videos_review_stamp before update on public.showcase_videos
  for each row execute function app.showcase_videos_review_stamp();

-- Admin writes on the new columns (RLS: admin only). reviewed_at is trigger-managed.
grant insert (youtube_title, title_source, needs_review, review_note, youtube_description)
  on public.showcase_videos to authenticated;
grant update (youtube_title, title_source, needs_review, review_note, youtube_description)
  on public.showcase_videos to authenticated;

-- Admin view: appended columns (create or replace keeps the existing column order).
create or replace view public.showcase_video_admin_details with (security_barrier = true) as
  select v.id as video_id, v.source_url, v.original_title, v.source, v.verification_notes, v.updated_by,
         v.youtube_title, v.youtube_description, v.title_source, v.needs_review, v.review_note, v.reviewed_at
  from public.showcase_videos v
  where app.is_admin();
revoke all on public.showcase_video_admin_details from anon, authenticated;
grant select on public.showcase_video_admin_details to authenticated;

-- ================================================================ 3. photo albums
create table public.photo_albums (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  title text not null check (char_length(btrim(title)) between 2 and 160),
  description text check (description is null or char_length(description) <= 2000),
  event_date date,
  source_label text check (source_label is null or char_length(source_label) <= 120),
  source_url text check (source_url is null or (source_url ~ '^https://[^\s<>"'']+$' and length(source_url) <= 500)),
  rights_note text check (rights_note is null or length(rights_note) <= 2000),
  cover_photo_id uuid,
  sort_order int not null default 100,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
create index photo_albums_pub_sort_idx on public.photo_albums (is_published, sort_order);
create index photo_albums_updated_by_idx on public.photo_albums (updated_by);

create table public.album_photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.photo_albums(id) on delete cascade,
  storage_path_original text not null,
  variants jsonb not null default '{}'::jsonb check (jsonb_typeof(variants) = 'object'),
  width int check (width is null or width > 0),
  height int check (height is null or height > 0),
  bytes int check (bytes is null or bytes >= 0),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  alt_text text check (alt_text is null or char_length(alt_text) <= 300),
  source_url text check (source_url is null or (source_url ~ '^https://[^\s<>"'']+$' and length(source_url) <= 500)),
  sort_order int not null default 100,
  is_published boolean not null default true,
  upload_status text not null default 'pending' check (upload_status in ('pending', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint album_photos_path_check check (
    storage_path_original ~ ('^albums/' || album_id::text || '/' || id::text || '/original\.(jpg|png|webp|avif)$'))
);
create index album_photos_album_sort_idx on public.album_photos (album_id, sort_order);

alter table public.photo_albums add constraint photo_albums_cover_fk
  foreign key (cover_photo_id) references public.album_photos(id) on delete set null
  deferrable initially deferred;
create index photo_albums_cover_idx on public.photo_albums (cover_photo_id);

-- The cover must be a photo of the same album.
create or replace function app.photo_albums_cover_check()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.cover_photo_id is not null and not exists (
       select 1 from public.album_photos p where p.id = new.cover_photo_id and p.album_id = new.id) then
    raise exception 'cover photo must belong to this album' using errcode = '23514';
  end if;
  return new;
end $$;
create constraint trigger photo_albums_cover_check after insert or update of cover_photo_id on public.photo_albums
  deferrable initially deferred
  for each row execute function app.photo_albums_cover_check();

create or replace function app.photo_albums_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_by := coalesce((select auth.uid()), case when tg_op = 'UPDATE' then old.updated_by end);
  return new;
end $$;
create trigger photo_albums_stamp before insert or update on public.photo_albums
  for each row execute function app.photo_albums_stamp();
create trigger set_updated_at before update on public.photo_albums
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.album_photos
  for each row execute function app.set_updated_at();
create trigger audit after insert or update or delete on public.photo_albums
  for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.album_photos
  for each row execute function app.audit_trigger();

-- Orphan prevention: a deleted photo (directly or via album cascade) enqueues its objects.
-- The admin action also removes them immediately; the worker treats missing objects as done.
create or replace function app.album_photos_delete_enqueue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.storage_cleanup_queue (bucket, path, reason)
  select 'album-media', p, 'album_photo_deleted:' || old.id::text
  from app.media_paths(old.storage_path_original, old.variants) p;
  return old;
end $$;
create trigger album_photos_delete_enqueue after delete on public.album_photos
  for each row execute function app.album_photos_delete_enqueue();

-- ================================================================ 4. RLS + grants
alter table public.video_categories enable row level security;
alter table public.showcase_video_categories enable row level security;
alter table public.photo_albums enable row level security;
alter table public.album_photos enable row level security;
revoke all on table public.video_categories, public.showcase_video_categories,
                    public.photo_albums, public.album_photos from anon, authenticated, public;

-- Publication helpers for policies: anon has no column grant on is_published, so policies must not
-- read it directly (SECURITY DEFINER, boolean only).
create or replace function app.video_is_public(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.showcase_videos v where v.id = p_id and v.is_published);
$$;
create or replace function app.video_category_is_public(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.video_categories c where c.id = p_id and c.is_published);
$$;
create or replace function app.album_is_public(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.photo_albums a where a.id = p_id and a.is_published);
$$;
revoke execute on function app.video_is_public(uuid), app.video_category_is_public(uuid), app.album_is_public(uuid) from public;
grant execute on function app.video_is_public(uuid), app.video_category_is_public(uuid), app.album_is_public(uuid)
  to anon, authenticated, service_role;

-- video_categories
grant select (id, slug, title, sort_order, is_published) on public.video_categories to anon;
grant select on public.video_categories to authenticated;
grant insert (slug, title, sort_order, is_published), update (slug, title, sort_order, is_published), delete
  on public.video_categories to authenticated;
create policy video_categories_public_read on public.video_categories for select to anon, authenticated
  using (is_published);
create policy video_categories_admin_read on public.video_categories for select to authenticated using (app.is_admin());
create policy video_categories_admin_insert on public.video_categories for insert to authenticated with check (app.is_admin());
create policy video_categories_admin_update on public.video_categories for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy video_categories_admin_delete on public.video_categories for delete to authenticated using (app.is_admin());

-- showcase_video_categories
grant select (video_id, category_id, is_primary) on public.showcase_video_categories to anon;
grant select on public.showcase_video_categories to authenticated;
grant insert (video_id, category_id, is_primary), update (is_primary), delete
  on public.showcase_video_categories to authenticated;
create policy svc_public_read on public.showcase_video_categories for select to anon, authenticated
  using (app.video_is_public(video_id) and app.video_category_is_public(category_id));
create policy svc_admin_read on public.showcase_video_categories for select to authenticated using (app.is_admin());
create policy svc_admin_insert on public.showcase_video_categories for insert to authenticated with check (app.is_admin());
create policy svc_admin_update on public.showcase_video_categories for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy svc_admin_delete on public.showcase_video_categories for delete to authenticated using (app.is_admin());

-- photo_albums (rights_note, updated_by, timestamps are admin-only)
grant select (id, slug, title, description, event_date, source_label, source_url, cover_photo_id, sort_order)
  on public.photo_albums to anon;
grant select (id, slug, title, description, event_date, source_label, source_url, cover_photo_id, sort_order,
              is_published, rights_note, created_at, updated_at, updated_by)
  on public.photo_albums to authenticated;
grant insert (slug, title, description, event_date, source_label, source_url, rights_note, cover_photo_id, sort_order, is_published),
      update (slug, title, description, event_date, source_label, source_url, rights_note, cover_photo_id, sort_order, is_published),
      delete
  on public.photo_albums to authenticated;
create policy photo_albums_public_read on public.photo_albums for select to anon
  using (is_published);
create policy photo_albums_admin_read on public.photo_albums for select to authenticated using (app.is_admin());
create policy photo_albums_admin_insert on public.photo_albums for insert to authenticated with check (app.is_admin());
create policy photo_albums_admin_update on public.photo_albums for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy photo_albums_admin_delete on public.photo_albums for delete to authenticated using (app.is_admin());

-- album_photos (storage paths, bytes, mime, source_url, status are admin-only)
grant select (id, album_id, width, height, alt_text, sort_order) on public.album_photos to anon;
grant select on public.album_photos to authenticated;
grant insert (id, album_id, storage_path_original, variants, width, height, bytes, mime, alt_text, source_url,
              sort_order, is_published, upload_status),
      update (variants, width, height, bytes, alt_text, source_url, sort_order, is_published, upload_status),
      delete
  on public.album_photos to authenticated;
create policy album_photos_public_read on public.album_photos for select to anon
  using (is_published and upload_status = 'ready'
         and app.album_is_public(album_id));
create policy album_photos_admin_read on public.album_photos for select to authenticated using (app.is_admin());
create policy album_photos_admin_insert on public.album_photos for insert to authenticated with check (app.is_admin());
create policy album_photos_admin_update on public.album_photos for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy album_photos_admin_delete on public.album_photos for delete to authenticated using (app.is_admin());

-- service_role (hosted projects do not auto-grant new tables; lesson from 0014)
grant all on table public.video_categories, public.showcase_video_categories,
                   public.photo_albums, public.album_photos to service_role;
grant select on public.showcase_video_admin_details to service_role;

-- ================================================================ 5. storage: album-media (private)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('album-media', 'album-media', false, 26214400,  -- 25 MiB
        array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- True while a published, ready photo of a published album references this object.
create or replace function app.album_object_is_public(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.album_photos p
    join public.photo_albums a on a.id = p.album_id
    where p.is_published and p.upload_status = 'ready' and a.is_published
      and (p.storage_path_original = p_name
           or exists (select 1 from jsonb_each_text(p.variants) v where v.value = p_name))
  );
$$;
revoke execute on function app.album_object_is_public(text) from public;
grant execute on function app.album_object_is_public(text) to anon, authenticated, service_role;

-- Object path for the public route (/a/{photoId}/{variant}): returns the stored path only while the
-- photo and album are published; anon has no column grant on the paths themselves.
create or replace function public.album_photo_object_path(p_photo_id uuid, p_variant text)
returns text language sql stable security definer set search_path = '' as $$
  select case when p_variant = 'original' then p.storage_path_original
              when p_variant in ('thumb', 'display') then p.variants ->> p_variant end
  from public.album_photos p
  join public.photo_albums a on a.id = p.album_id
  where p.id = p_photo_id and p.is_published and p.upload_status = 'ready' and a.is_published;
$$;
revoke execute on function public.album_photo_object_path(uuid, text) from public;
grant execute on function public.album_photo_object_path(uuid, text) to anon, authenticated, service_role;

create policy "album-media read published" on storage.objects for select to anon, authenticated
  using (bucket_id = 'album-media' and app.album_object_is_public(name));
create policy "album-media admin read" on storage.objects for select to authenticated
  using (bucket_id = 'album-media' and app.is_admin());
create policy "album-media admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'album-media' and app.is_admin());
create policy "album-media admin update" on storage.objects for update to authenticated
  using (bucket_id = 'album-media' and app.is_admin())
  with check (bucket_id = 'album-media' and app.is_admin());
create policy "album-media admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'album-media' and app.is_admin());
