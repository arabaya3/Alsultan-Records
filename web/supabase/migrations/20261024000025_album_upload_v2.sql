-- 0025 Album upload v2: resumable direct uploads (TUS), large JPEG + RAW, explicit «uploading» state.
-- Additive / relaxing only: no row is deleted or rewritten; existing values all stay valid.
--
-- Root cause of the 2026-10-20 incident (67 of 95 photos «original not found»): rows were created `pending` for a
-- whole batch up front and uploaded one by one; the worker claims `pending` rows older than 2 minutes, so it
-- processed photos whose upload had not even started, failed them 5 times, and gave up. Now:
--   uploading  — reserved by the server, the browser is sending the original; NEVER claimed by the worker;
--   pending    — the server confirmed the original is stored (size checked); claimed immediately;
--   processing / ready / failed — unchanged.

-- ------------------------------------------------------------------ 1. album_photos
alter table public.album_photos drop constraint if exists album_photos_upload_status_check;
alter table public.album_photos add constraint album_photos_upload_status_check
  check (upload_status in ('uploading', 'pending', 'processing', 'ready', 'failed'));

alter table public.album_photos drop constraint if exists album_photos_mime_check;
alter table public.album_photos add constraint album_photos_mime_check
  check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff',
                  'image/x-canon-cr2', 'image/x-canon-cr3', 'image/x-nikon-nef', 'image/x-nikon-nrw', 'image/x-sony-arw',
                  'image/x-adobe-dng', 'image/x-fuji-raf', 'image/x-olympus-orf', 'image/x-panasonic-rw2',
                  'image/x-pentax-pef', 'image/x-samsung-srw'));

alter table public.album_photos drop constraint if exists album_photos_storage_path_original_check;
alter table public.album_photos add constraint album_photos_storage_path_original_check
  check (storage_path_original ~ ('^albums/' || album_id::text || '/' || id::text
         || '/original\.(jpg|png|webp|avif|tif|cr2|cr3|nef|nrw|arw|dng|raf|orf|rw2|pef|srw)$'));

-- Real format detected by the worker from the bytes (jpeg, png, …, cr3, nef, …). Admin-only (no anon grant).
alter table public.album_photos add column if not exists format text
  check (format is null or format ~ '^[a-z0-9]{2,6}$');

-- ------------------------------------------------------------------ 2. queue: never claim an unfinished upload
create or replace function app.photo_job_claimable(p public.album_photos)
returns boolean language sql stable set search_path = '' as $$
  select p.deleted_at is null and (
       p.upload_status = 'pending'
    or (p.upload_status = 'failed' and p.attempts < 5)
    or (p.upload_status = 'processing' and p.processing_started_at < now() - interval '10 minutes'));
$$;

-- ------------------------------------------------------------------ 3. bucket: real limit + formats
-- 50 MB = the project's global Storage upload cap (Supabase setting). Larger files need that cap raised first.
update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff',
                                  'image/x-canon-cr2', 'image/x-canon-cr3', 'image/x-nikon-nef', 'image/x-nikon-nrw',
                                  'image/x-sony-arw', 'image/x-adobe-dng', 'image/x-fuji-raf', 'image/x-olympus-orf',
                                  'image/x-panasonic-rw2', 'image/x-pentax-pef', 'image/x-samsung-srw']
 where id = 'album-media';

-- ------------------------------------------------------------------ 4. upload permission scoped to a reservation
-- Browsers upload straight to Storage (TUS, the user's own JWT — no service key in the browser, nothing through
-- Vercel). An admin may create an object ONLY at the exact path of a photo row the server reserved
-- (`uploading`, not deleted, album not deleted). Workers (thumb/display) use the service role and bypass RLS.
drop policy if exists "album-media admin insert" on storage.objects;
create policy "album-media admin insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'album-media' and app.is_admin()
    and exists (
      select 1 from public.album_photos p join public.photo_albums a on a.id = p.album_id
      where p.storage_path_original = name and p.upload_status = 'uploading'
        and p.deleted_at is null and a.deleted_at is null
    )
  );

-- ------------------------------------------------------------------ 5. path check: the original constraint name
-- 0015 named it album_photos_path_check (jpg|png|webp|avif only); section 1 added the wider check under the
-- default name, so drop the old one or RAW/TIFF paths stay rejected.
alter table public.album_photos drop constraint if exists album_photos_path_check;

-- ------------------------------------------------------------------ 6. processing state: worker + RPCs only
-- Tightening: admins no longer write processing columns directly (only the worker, service role, and the two
-- admin RPCs below). New rows from admins must start `uploading` with no variants — a row cannot be made to look
-- processed without going through the worker.
revoke update (upload_status, variants, bytes, sha256, width, height) on public.album_photos from authenticated;

drop policy if exists album_photos_admin_insert on public.album_photos;
create policy album_photos_admin_insert on public.album_photos for insert to authenticated
  with check (app.is_admin() and upload_status = 'uploading' and variants = '{}'::jsonb);

-- Reserve again a photo whose upload was interrupted (failed/pending, original never stored — the app checks
-- storage first): back to `uploading` with a fresh attempt budget, same id and path (the TUS upload resumes).
create or replace function public.album_upload_reopen(p_photo_id uuid, p_bytes bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if not app.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_bytes is null or p_bytes <= 0 then raise exception 'invalid size' using errcode = '22023'; end if;
  update public.album_photos
     set upload_status = 'uploading', attempts = 0, last_error = null, processing_started_at = null, bytes = p_bytes
   where id = p_photo_id and deleted_at is null and upload_status in ('failed', 'pending');
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

-- The original is stored and its size checked by the app: hand the photo to the worker (`pending`).
create or replace function public.album_upload_complete(p_photo_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if not app.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  update public.album_photos
     set upload_status = 'pending', attempts = 0, last_error = null, processing_started_at = null
   where id = p_photo_id and deleted_at is null and upload_status = 'uploading';
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

revoke all on function public.album_upload_reopen(uuid, bigint) from public, anon;
revoke all on function public.album_upload_complete(uuid) from public, anon;
grant execute on function public.album_upload_reopen(uuid, bigint) to authenticated;
grant execute on function public.album_upload_complete(uuid) to authenticated;

-- ------------------------------------------------------------------ 7. fair queue: new photos before retries
-- One undecodable file must not starve the rest of an upload (it was retried immediately, oldest first, ahead of
-- fresh uploads). Now: fresh `pending` work first; an automatic retry of a `failed` photo waits 1, 2, 4, 8 min
-- (exponential backoff on its last update); an admin «إعادة المحاولة» (requeue_album_photos) is immediate.
-- Permanent errors (corrupt/unsupported/mismatch/too large) are parked by the worker with attempts = 5.
create or replace function app.photo_job_claimable(p public.album_photos)
returns boolean language sql stable set search_path = '' as $$
  select p.deleted_at is null and (
       p.upload_status = 'pending'
    or (p.upload_status = 'failed' and p.attempts < 5
        and (p.last_error = 'requeued by admin'
             or p.updated_at < now() - make_interval(mins => power(2, greatest(p.attempts - 1, 0))::int)))
    or (p.upload_status = 'processing' and p.processing_started_at < now() - interval '10 minutes'));
$$;

create or replace function public.claim_photo_jobs(p_limit integer default 5)
returns table (id uuid, album_id uuid, storage_path_original text, mime text, attempts integer)
language plpgsql set search_path = '' as $$
begin
  return query
  with c as (
    select p.id from public.album_photos p
    where app.photo_job_claimable(p)
    order by (p.upload_status = 'pending') desc, p.created_at
    limit greatest(1, least(coalesce(p_limit, 5), 50))
    for update skip locked
  )
  update public.album_photos q
     set upload_status = 'processing', processing_started_at = now(), attempts = q.attempts + 1
  from c where q.id = c.id
  returning q.id, q.album_id, q.storage_path_original, q.mime, q.attempts;
end $$;
