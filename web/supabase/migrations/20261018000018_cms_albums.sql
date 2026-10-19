-- 0018 CMS part 2: album categories, archive/trash (soft delete) + purge, sha256 dedupe,
-- server-side photo processing queue (+ pg_cron worker kick), import manifest.
-- NON-DESTRUCTIVE: new nullable/defaulted columns; existing rows keep their exact behaviour
-- (archived_at/deleted_at null, attempts 0, sha256 null).

-- ================================================================ 1. album_categories
create table public.album_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  title text not null check (char_length(btrim(title)) between 2 and 60),
  sort_order int not null default 100,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index album_categories_pub_sort_idx on public.album_categories (is_published, sort_order);
create trigger set_updated_at before update on public.album_categories
  for each row execute function app.set_updated_at();
create trigger audit after insert or update or delete on public.album_categories
  for each row execute function app.cms_audit_trigger('is_published', 'slug', 'title');

alter table public.album_categories enable row level security;
revoke all on table public.album_categories from anon, authenticated, public;
grant select (id, slug, title, sort_order) on public.album_categories to anon;
grant select on public.album_categories to authenticated;
grant insert (slug, title, sort_order, is_published), update (slug, title, sort_order, is_published), delete
  on public.album_categories to authenticated;
grant all on public.album_categories to service_role;
create policy album_categories_public_read on public.album_categories for select to anon using (is_published);
create policy album_categories_admin_read on public.album_categories for select to authenticated using (app.is_admin());
create policy album_categories_admin_insert on public.album_categories for insert to authenticated with check (app.is_admin());
create policy album_categories_admin_update on public.album_categories for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy album_categories_admin_delete on public.album_categories for delete to authenticated using (app.is_admin());

-- ================================================================ 2. photo_albums / album_photos columns
alter table public.photo_albums
  add column category_id uuid references public.album_categories(id) on delete set null,
  add column archived_at timestamptz,
  add column deleted_at timestamptz;
create index photo_albums_category_idx on public.photo_albums (category_id);

alter table public.album_photos
  add column deleted_at timestamptz,
  add column sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  add column attempts int not null default 0 check (attempts >= 0),
  add column last_error text check (last_error is null or char_length(last_error) <= 2000),
  add column processing_started_at timestamptz;

-- upload_status gains 'processing' (worker claimed). Replace the CHECK; existing values all valid.
alter table public.album_photos drop constraint if exists album_photos_upload_status_check;
alter table public.album_photos add constraint album_photos_upload_status_check
  check (upload_status in ('pending', 'processing', 'ready', 'failed'));

create unique index album_photos_album_sha256_uniq on public.album_photos (album_id, sha256)
  where deleted_at is null and sha256 is not null;
create index album_photos_queue_idx on public.album_photos (upload_status, created_at)
  where deleted_at is null and upload_status in ('pending', 'processing', 'failed');

-- Grants (RLS still admin-only for writes). category_id is a public display column.
grant select (category_id) on public.photo_albums to anon;
grant select (category_id, archived_at, deleted_at) on public.photo_albums to authenticated;
grant insert (category_id, archived_at, deleted_at), update (category_id, archived_at, deleted_at)
  on public.photo_albums to authenticated;
-- album_photos: authenticated already has table-wide SELECT (0015). Processing bookkeeping
-- (attempts, last_error, processing_started_at) is written by the worker RPCs, not by clients.
grant insert (sha256, deleted_at), update (sha256, deleted_at) on public.album_photos to authenticated;

-- Audit (0015 already audits every row change on photo_albums / album_photos / video categories).

-- ================================================================ 3. public predicates: exclude archived/trashed
create or replace function app.album_is_public(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.photo_albums a
                 where a.id = p_id and a.is_published and a.archived_at is null and a.deleted_at is null);
$$;

alter policy photo_albums_public_read on public.photo_albums
  using (is_published and archived_at is null and deleted_at is null);
alter policy album_photos_public_read on public.album_photos
  using (is_published and upload_status = 'ready' and deleted_at is null and app.album_is_public(album_id));

-- Storage policy helper + /p route resolver (originals never public — 0016 rule kept).
create or replace function app.album_object_is_public(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.album_photos p
    join public.photo_albums a on a.id = p.album_id
    where p.is_published and p.upload_status = 'ready' and p.deleted_at is null
      and a.is_published and a.archived_at is null and a.deleted_at is null
      and (p.variants ->> 'thumb' = p_name or p.variants ->> 'display' = p_name)
  );
$$;

create or replace function public.album_photo_object_path(p_photo_id uuid, p_variant text)
returns text language sql stable security definer set search_path = '' as $$
  select p.variants ->> p_variant
  from public.album_photos p
  join public.photo_albums a on a.id = p.album_id
  where p_variant in ('thumb', 'display')
    and p.id = p_photo_id and p.is_published and p.upload_status = 'ready' and p.deleted_at is null
    and a.is_published and a.archived_at is null and a.deleted_at is null;
$$;

-- ================================================================ 4. dedupe lookup (admin)
-- Albums (ids/titles) that already hold a live photo with this content hash. No paths returned.
create or replace function public.find_duplicate_photo(p_sha256 text)
returns table (album_id uuid, album_title text, photo_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
    select a.id, a.title, p.id
    from public.album_photos p join public.photo_albums a on a.id = p.album_id
    where p.sha256 = lower(p_sha256) and p.deleted_at is null
    order by a.title, p.id;
end $$;
revoke all on function public.find_duplicate_photo(text) from public, anon, authenticated;
grant execute on function public.find_duplicate_photo(text) to authenticated, service_role;

-- ================================================================ 5. purge (hard delete, admin)
-- Only an album already in the trash (deleted_at set) and only with its exact slug typed back.
-- Deleting the album cascades to its photos; the 0015 per-photo trigger enqueues every original
-- and variant into private.storage_cleanup_queue (worker removes the objects).
create or replace function public.purge_album(p_id uuid, p_confirm_slug text)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_album public.photo_albums%rowtype;
  v_photos int;
begin
  if not app.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into v_album from public.photo_albums where id = p_id for update;
  if not found then
    raise exception 'album not found' using errcode = 'P0002';
  end if;
  if p_confirm_slug is null or p_confirm_slug <> v_album.slug then
    raise exception 'confirmation slug does not match' using errcode = '22023';
  end if;
  if v_album.deleted_at is null then
    raise exception 'album must be in the trash before it can be purged' using errcode = '55000';
  end if;
  select count(*) into v_photos from public.album_photos where album_id = p_id;
  -- Clear dependants that would block or keep pointing at the album's photos (FKs set null anyway).
  update public.photo_albums set cover_photo_id = null where id = p_id and cover_photo_id is not null;
  delete from public.album_photos where album_id = p_id;  -- per-photo enqueue + audit
  delete from public.photo_albums where id = p_id;        -- audit
  insert into public.audit_events (actor, action, entity_type, entity_id, before, after)
  values (auth.uid(), 'purge', 'photo_albums', p_id,
          jsonb_build_object('slug', v_album.slug, 'title', v_album.title, 'photos', v_photos), null);
  perform app.invoke_storage_cleanup('album_purged');
  return v_photos;
end $$;
revoke all on function public.purge_album(uuid, text) from public, anon, authenticated;
grant execute on function public.purge_album(uuid, text) to authenticated, service_role;

-- ================================================================ 6. processing queue (service_role)
-- Claimable: live (not trashed) photos that are
--   pending for > 2 minutes (the browser may still be uploading the original),
--   failed with attempts < 5,
--   or stuck in processing for > 10 minutes.
create or replace function app.photo_job_claimable(p public.album_photos)
returns boolean language sql stable set search_path = '' as $$
  select p.deleted_at is null and (
       (p.upload_status = 'pending' and p.created_at < now() - interval '2 minutes')
    or (p.upload_status = 'failed' and p.attempts < 5)
    or (p.upload_status = 'processing' and p.processing_started_at < now() - interval '10 minutes'));
$$;
revoke execute on function app.photo_job_claimable(public.album_photos) from public, anon, authenticated;
grant execute on function app.photo_job_claimable(public.album_photos) to service_role;

create or replace function public.claim_photo_jobs(p_limit int default 5)
returns table (id uuid, album_id uuid, storage_path_original text, mime text, attempts int)
language plpgsql security invoker set search_path = '' as $$
begin
  return query
  with c as (
    select p.id from public.album_photos p
    where app.photo_job_claimable(p)
    order by p.created_at
    limit greatest(1, least(coalesce(p_limit, 5), 50))
    for update skip locked
  )
  update public.album_photos q
     set upload_status = 'processing', processing_started_at = now(), attempts = q.attempts + 1
  from c where q.id = c.id
  returning q.id, q.album_id, q.storage_path_original, q.mime, q.attempts;
end $$;
revoke all on function public.claim_photo_jobs(int) from public, anon, authenticated;
grant execute on function public.claim_photo_jobs(int) to service_role;

-- Variants must be this photo's own thumb/display WebP objects.
create or replace function public.complete_photo_job(
  p_id uuid, p_ok boolean, p_error text default null,
  p_width int default null, p_height int default null, p_variants jsonb default null)
returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_row public.album_photos%rowtype;
  v_base text;
begin
  select * into v_row from public.album_photos where id = p_id for update;
  if not found or v_row.upload_status <> 'processing' then
    return false;  -- not claimed (or already completed / requeued): ignore
  end if;
  if p_ok then
    v_base := 'albums/' || v_row.album_id::text || '/' || v_row.id::text || '/';
    if p_variants is null or jsonb_typeof(p_variants) <> 'object'
       or coalesce(p_variants ->> 'thumb', '') <> v_base || 'thumb.webp'
       or coalesce(p_variants ->> 'display', '') <> v_base || 'display.webp'
       or exists (select 1 from jsonb_object_keys(p_variants) k where k not in ('thumb', 'display')) then
      raise exception 'invalid variants' using errcode = '22023';
    end if;
    update public.album_photos
       set upload_status = 'ready', variants = p_variants,
           width = coalesce(p_width, width), height = coalesce(p_height, height),
           last_error = null, processing_started_at = null
     where id = p_id;
  else
    update public.album_photos
       set upload_status = 'failed', last_error = left(coalesce(p_error, 'processing failed'), 2000),
           processing_started_at = null
     where id = p_id;
  end if;
  return true;
end $$;
revoke all on function public.complete_photo_job(uuid, boolean, text, int, int, jsonb) from public, anon, authenticated;
grant execute on function public.complete_photo_job(uuid, boolean, text, int, int, jsonb) to service_role;

-- Admin "إعادة المعالجة": put failed (or all non-ready) photos of an album / one photo back in the queue.
create or replace function public.requeue_album_photos(p_album_id uuid, p_photo_id uuid default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if not app.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.album_photos
     -- failed + attempts reset = claimable on the next worker run (no 2-minute pending grace).
     set upload_status = 'failed', attempts = 0, last_error = 'requeued by admin', processing_started_at = null
   where album_id = p_album_id and (p_photo_id is null or id = p_photo_id)
     and deleted_at is null and upload_status in ('failed', 'pending');
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.requeue_album_photos(uuid, uuid) from public, anon, authenticated;
grant execute on function public.requeue_album_photos(uuid, uuid) to authenticated, service_role;

-- Scheduler: pg_cron (every minute) -> pg_net POST to the Next route /api/jobs/process-photos.
-- Operator-provided Vault secrets (never in migrations):
--   jobs_url    : https://<site>/api/jobs/process-photos
--   jobs_secret : shared secret = the app's JOBS_SECRET env var
-- Without both secrets (or without claimable work) the call is a no-op, so the cron job is
-- harmless until the operator sets them. Best-effort: never raises.
create or replace function app.invoke_photo_jobs(p_reason text default 'cron')
returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_key text; v_id bigint;
begin
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'jobs_url';
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'jobs_secret';
  if v_url is null or v_key is null then
    return null;
  end if;
  if not exists (select 1 from public.album_photos p where app.photo_job_claimable(p)) then
    return null;
  end if;
  select net.http_post(
    url := v_url,
    body := jsonb_build_object('reason', p_reason),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-jobs-secret', v_key,
                                  'Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 55000
  ) into v_id;
  return v_id;
exception when others then
  raise warning 'photo jobs invoke failed: %', sqlerrm;
  return null;
end $$;
revoke execute on function app.invoke_photo_jobs(text) from public, anon, authenticated;

select cron.schedule('process-photos', '* * * * *', $$select app.invoke_photo_jobs('cron')$$);

-- ================================================================ 7. import manifest (admin-only)
create table public.import_items (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('facebook', 'folder', 'zip')),
  source_ref text not null check (char_length(source_ref) between 1 and 500),
  album_id uuid references public.photo_albums(id) on delete set null,
  file_name text check (file_name is null or char_length(file_name) <= 300),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  bytes bigint check (bytes is null or bytes >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'uploaded', 'processed', 'failed', 'skipped_duplicate')),
  error text check (error is null or char_length(error) <= 2000),
  photo_id uuid references public.album_photos(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_ref)
);
create index import_items_album_idx on public.import_items (album_id);
create index import_items_photo_idx on public.import_items (photo_id);
create index import_items_status_idx on public.import_items (status);
create trigger set_updated_at before update on public.import_items
  for each row execute function app.set_updated_at();

alter table public.import_items enable row level security;
revoke all on table public.import_items from anon, authenticated, public;
grant select on public.import_items to authenticated;
grant insert (source, source_ref, album_id, file_name, sha256, bytes, status, error, photo_id),
      update (album_id, file_name, sha256, bytes, status, error, photo_id),
      delete
  on public.import_items to authenticated;
grant all on public.import_items to service_role;
create policy import_items_admin_read on public.import_items for select to authenticated using (app.is_admin());
create policy import_items_admin_insert on public.import_items for insert to authenticated with check (app.is_admin());
create policy import_items_admin_update on public.import_items for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy import_items_admin_delete on public.import_items for delete to authenticated using (app.is_admin());
