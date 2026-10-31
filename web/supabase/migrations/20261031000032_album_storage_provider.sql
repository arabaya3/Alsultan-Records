-- 0032 Album photos can live on Supabase Storage or on an S3-compatible store (Hetzner Object Storage).
-- Additive only: every existing row stays `supabase`, and only a verified copy may switch a row to `s3`.
-- The Edge Function worker keeps claiming Supabase items only; S3 items are claimed by the app, which holds the S3 keys.

-- ------------------------------------------------------------------ 1. which store holds this photo's objects
alter table public.album_photos
  add column storage_provider text not null default 'supabase' check (storage_provider in ('supabase', 's3')),
  add column s3_upload_id text;
grant insert (storage_provider) on public.album_photos to authenticated;
-- anon's column grants are unchanged: neither column is readable anonymously.

-- Remember the open multipart upload of a reservation. The first upload wins; the browser never sees the id.
create or replace function public.album_s3_upload_set(p_photo_id uuid, p_upload_id text, p_replace text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_id text;
begin
  if not app.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  update public.album_photos
     set s3_upload_id = p_upload_id
   where id = p_photo_id and deleted_at is null and upload_status = 'uploading' and storage_provider = 's3'
     and s3_upload_id is not distinct from p_replace
  returning s3_upload_id into v_id;
  if v_id is null then
    select s3_upload_id into v_id from public.album_photos
     where id = p_photo_id and deleted_at is null and upload_status = 'uploading' and storage_provider = 's3';
  end if;
  return v_id;
end $$;
revoke all on function public.album_s3_upload_set(uuid, text, text) from public, anon;
grant execute on function public.album_s3_upload_set(uuid, text, text) to authenticated;

-- ------------------------------------------------------------------ 2. public read: where a published variant is
-- Same publication checks as album_photo_object_path, plus the store. Nothing is returned for an unpublished photo.
create or replace function public.album_photo_object_ref(p_photo_id uuid, p_variant text)
returns table (provider text, path text) language sql stable security definer set search_path = '' as $$
  select p.storage_provider, p.variants ->> p_variant
  from public.album_photos p
  join public.photo_albums a on a.id = p.album_id
  where p_variant in ('thumb', 'display')
    and p.id = p_photo_id and p.is_published and p.upload_status = 'ready' and p.deleted_at is null
    and a.is_published and a.archived_at is null and a.deleted_at is null;
$$;
revoke all on function public.album_photo_object_ref(uuid, text) from public;
grant execute on function public.album_photo_object_ref(uuid, text) to anon, authenticated, service_role;

-- ------------------------------------------------------------------ 3. cleanup queue knows the store
alter table private.storage_cleanup_queue
  add column provider text not null default 'supabase' check (provider in ('supabase', 's3'));

create or replace function app.album_photos_delete_enqueue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.storage_cleanup_queue (bucket, path, reason, provider)
  select 'album-media', p, 'album_photo_deleted:' || old.id::text, old.storage_provider
  from app.media_paths(old.storage_path_original, old.variants) p;
  return old;
end $$;

-- Supabase items only: an S3 item handed to the Edge Function would count as "already absent" and never be deleted.
create or replace function public.claim_storage_cleanup(p_limit int default 100)
returns table (id uuid, bucket text, path text, reason text, enqueued_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_cleanup_worker() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  with c as (
    select q.id from private.storage_cleanup_queue q
    where q.provider = 'supabase' and q.done_at is null and q.dead_at is null and q.next_attempt_at <= now()
      and (q.claimed_at is null or q.claimed_at < now() - interval '15 minutes')
    order by q.enqueued_at
    limit greatest(1, least(coalesce(p_limit, 100), 1000))
    for update skip locked
  )
  update private.storage_cleanup_queue q set claimed_at = now()
  from c where q.id = c.id
  returning q.id, q.bucket, q.path, q.reason, q.enqueued_at;
end $$;

create or replace function public.claim_s3_cleanup(p_limit int default 100)
returns table (id uuid, bucket text, path text, reason text, enqueued_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_cleanup_worker() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  with c as (
    select q.id from private.storage_cleanup_queue q
    where q.provider = 's3' and q.done_at is null and q.dead_at is null and q.next_attempt_at <= now()
      and (q.claimed_at is null or q.claimed_at < now() - interval '15 minutes')
    order by q.enqueued_at
    limit greatest(1, least(coalesce(p_limit, 100), 1000))
    for update skip locked
  )
  update private.storage_cleanup_queue q set claimed_at = now()
  from c where q.id = c.id
  returning q.id, q.bucket, q.path, q.reason, q.enqueued_at;
end $$;
revoke all on function public.claim_s3_cleanup(int) from public, anon;
grant execute on function public.claim_s3_cleanup(int) to authenticated, service_role;
