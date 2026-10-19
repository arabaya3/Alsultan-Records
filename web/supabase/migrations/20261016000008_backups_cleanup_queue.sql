-- 0008 Owner-only backups bucket, private-media tightening, media id insert
-- grant, storage cleanup queue.

-- ================================================================ backups bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backups', 'backups', false, 2147483648, array['application/zip', 'application/json'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "backups owner read" on storage.objects for select to authenticated
  using (bucket_id = 'backups' and app.is_owner());
create policy "backups owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'backups' and app.is_owner());
create policy "backups owner update" on storage.objects for update to authenticated
  using (bucket_id = 'backups' and app.is_owner()) with check (bucket_id = 'backups' and app.is_owner());
create policy "backups owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'backups' and app.is_owner());

-- private-media: only event paths (events/{uuid}/...) are reachable by API roles.
-- Anything else (e.g. legacy backups/*) is invisible even to admins.
drop policy "private-media read" on storage.objects;
drop policy "private-media staff update" on storage.objects;
drop policy "private-media admin delete" on storage.objects;
create policy "private-media read" on storage.objects for select to authenticated
  using (bucket_id = 'private-media' and app.path_event_id(name) is not null and (
    app.is_admin()
    or app.is_assigned(app.path_event_id(name))
    or app.owns_event(app.path_event_id(name))));
create policy "private-media staff update" on storage.objects for update to authenticated
  using (bucket_id = 'private-media' and app.path_event_id(name) is not null and app.can_work_event(app.path_event_id(name)))
  with check (bucket_id = 'private-media' and app.path_event_id(name) is not null
              and app.can_work_event(app.path_event_id(name)));
create policy "private-media admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'private-media' and app.path_event_id(name) is not null and app.is_admin());

-- ================================================================ media id
-- Lets the uploader choose the row id so the storage folder uuid == media_assets.id.
grant insert (id) on public.media_assets to authenticated;

-- ================================================================ cleanup queue
create table private.storage_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  path text not null,
  reason text not null,
  enqueued_at timestamptz not null default now(),
  claimed_at timestamptz,
  done_at timestamptz
);
create index storage_cleanup_queue_pending_idx on private.storage_cleanup_queue (enqueued_at) where done_at is null;
revoke all on private.storage_cleanup_queue from public, anon, authenticated;

-- All storage paths of a media row (original + variants).
create or replace function app.media_paths(p_path text, p_variants jsonb)
returns setof text language sql immutable set search_path = '' as $$
  select p_path
  union
  select v.value from jsonb_each_text(coalesce(p_variants, '{}'::jsonb)) v
  where v.value is not null and v.value <> '';
$$;

-- Replaces 0004 version: also enqueue removal of public copies.
create or replace function app.events_unpublish_media()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.is_published and not new.is_published then
    insert into private.storage_cleanup_queue (bucket, path, reason)
    select 'public-media', p, 'unpublished:' || new.id::text
    from public.media_assets m, app.media_paths(m.path, m.variants) p
    where m.event_id = new.id and m.bucket = 'public-media';
    update public.media_assets set visibility = 'private'
    where event_id = new.id and visibility = 'public';
  end if;
  return null;
end $$;

-- Event deletion: enqueue every stored object of the event (orphan prevention).
create or replace function app.events_delete_enqueue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.storage_cleanup_queue (bucket, path, reason)
  select m.bucket::text, p, 'event_deleted:' || old.id::text
  from public.media_assets m, app.media_paths(m.path, m.variants) p
  where m.event_id = old.id;
  return old;
end $$;
create trigger events_delete_enqueue before delete on public.events
for each row execute function app.events_delete_enqueue();

-- Claim up to p_limit pending items (re-claimable after 15 minutes if never completed).
create or replace function public.claim_storage_cleanup(p_limit int default 100)
returns table (id uuid, bucket text, path text, reason text, enqueued_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  with c as (
    select q.id from private.storage_cleanup_queue q
    where q.done_at is null and (q.claimed_at is null or q.claimed_at < now() - interval '15 minutes')
    order by q.enqueued_at
    limit greatest(1, least(coalesce(p_limit, 100), 1000))
    for update skip locked
  )
  update private.storage_cleanup_queue q set claimed_at = now()
  from c where q.id = c.id
  returning q.id, q.bucket, q.path, q.reason, q.enqueued_at;
end $$;

create or replace function public.complete_storage_cleanup(p_ids uuid[])
returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if not app.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update private.storage_cleanup_queue set done_at = now()
  where id = any(p_ids) and done_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function app.media_paths(text, jsonb), app.events_delete_enqueue() from public;
revoke execute on function public.claim_storage_cleanup(int), public.complete_storage_cleanup(uuid[]) from public, anon;
grant execute on function public.claim_storage_cleanup(int), public.complete_storage_cleanup(uuid[]) to authenticated, service_role;
