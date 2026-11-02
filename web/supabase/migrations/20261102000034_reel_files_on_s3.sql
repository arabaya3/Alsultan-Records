-- 0034 Original video files for the reels viewer, stored on S3 (Hetzner) and linked to a showcase video.
-- Additive. A video without a ready file keeps playing from YouTube, exactly as before.

alter table public.reel_videos
  add column storage_provider text not null default 's3' check (storage_provider in ('supabase', 's3')),
  add column upload_status text not null default 'uploading' check (upload_status in ('uploading', 'ready')),
  add column s3_upload_id text,
  add column showcase_video_id uuid unique references public.showcase_videos(id) on delete set null;

-- Public: which published videos have a ready file, and its shape (no paths).
create or replace function public.reel_files()
returns table (video_id uuid, width int, height int) language sql stable security definer set search_path = '' as $$
  select r.showcase_video_id, r.width, r.height
  from public.reel_videos r join public.showcase_videos s on s.id = r.showcase_video_id
  where r.upload_status = 'ready' and s.is_published;
$$;

-- Public: where the file of ONE published video is. The route signs a short-lived link only after this answers.
create or replace function public.reel_file_ref(p_video_id uuid)
returns table (provider text, path text, mime text) language sql stable security definer set search_path = '' as $$
  select r.storage_provider, r.storage_path, r.mime
  from public.reel_videos r join public.showcase_videos s on s.id = r.showcase_video_id
  where r.showcase_video_id = p_video_id and r.upload_status = 'ready' and s.is_published;
$$;

revoke all on function public.reel_files(), public.reel_file_ref(uuid) from public;
grant execute on function public.reel_files(), public.reel_file_ref(uuid) to anon, authenticated, service_role;
