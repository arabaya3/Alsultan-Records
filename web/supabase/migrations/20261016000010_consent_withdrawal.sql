-- 0010 Consent withdrawal (release blocker).
--
-- 1. Immediate revocation: public-media is no longer a public bucket. Objects are readable by
--    anon/authenticated ONLY while the media row that references them is live-public
--    (visibility public + ready + event published with granted consent). The app serves them
--    through /m/[assetId]/[variant] which re-checks this per request. Withdrawal flips
--    is_published (BEFORE trigger) and media visibility (AFTER trigger) in the same transaction,
--    so the next read after COMMIT is denied. No job is involved.
-- 2. No republication after a customer withdrawal: only the owning customer can grant again.
-- 3. Durable, retryable cleanup: attempts/backoff/dead-letter on the queue, service-role worker
--    (Edge Function storage-cleanup) scheduled with pg_cron + pg_net; URL and key come from
--    Vault secrets `storage_cleanup_url` and `storage_cleanup_key` (never in migrations).
-- 4. storage_cleanup_pending(): admin-only read-only counts for the admin overview.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ================================================================ 1. public-media private
update storage.buckets set public = false where id = 'public-media';

-- True while some live-public media row references this object (original or any variant).
create or replace function app.public_object_is_live(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.media_assets m
    where m.bucket = 'public-media'
      and m.visibility = 'public'
      and m.upload_status = 'ready'
      and (m.event_id is null or app.event_is_public(m.event_id))
      and (m.path = p_name
           or exists (select 1 from jsonb_each_text(m.variants) v where v.value = p_name))
  );
$$;
revoke execute on function app.public_object_is_live(text) from public;
grant execute on function app.public_object_is_live(text) to anon, authenticated, service_role;

drop policy "public-media read" on storage.objects;
create policy "public-media read live" on storage.objects for select to anon, authenticated
  using (bucket_id = 'public-media' and app.public_object_is_live(name));
create policy "public-media admin read" on storage.objects for select to authenticated
  using (bucket_id = 'public-media' and app.is_admin());

-- ================================================================ 2. customer withdrawal is sticky
alter table public.events add column consent_revoked_by_customer_at timestamptz;
alter table public.events add constraint events_customer_revoke_blocks_grant
  check (consent_revoked_by_customer_at is null or publication_consent <> 'granted');
grant select (consent_revoked_by_customer_at) on public.events to authenticated;

-- Replaces 0004: records a customer withdrawal; after it, only the owning customer may grant.
create or replace function app.events_publication_trigger()
returns trigger language plpgsql set search_path = '' as $$
declare v_customer boolean;
begin
  -- Consent leaving 'granted' always unpublishes (and un-features).
  if new.publication_consent <> 'granted' then
    new.is_published := false;
    new.featured := false;
  end if;
  if tg_op = 'UPDATE' and new.publication_consent is distinct from old.publication_consent then
    new.consent_at := now();
    new.consent_by := auth.uid();
    v_customer := auth.uid() is not null and app.owns_event(new.id);
    if new.publication_consent = 'revoked' and v_customer then
      new.consent_revoked_by_customer_at := now();
    end if;
    if new.publication_consent = 'granted' and old.consent_revoked_by_customer_at is not null then
      -- Any API caller (staff/admin/owner sessions, service role) is blocked; only direct
      -- database maintenance without a request identity (migrations, superuser ops) may override.
      if not v_customer and (app.is_api_role() or coalesce(auth.role(), '') in ('authenticated', 'service_role')) then
        raise exception 'consent was withdrawn by the customer; only the customer can grant it again'
          using errcode = '42501';
      end if;
      new.consent_revoked_by_customer_at := null;
    end if;
  end if;
  if tg_op = 'UPDATE' and app.is_api_role()
     and new.consent_revoked_by_customer_at is distinct from old.consent_revoked_by_customer_at
     and new.publication_consent is not distinct from old.publication_consent then
    raise exception 'consent_revoked_by_customer_at is set by consent changes only' using errcode = '42501';
  end if;
  if app.is_api_role() and tg_op = 'INSERT' and (new.is_published or new.publication_consent <> 'none'
                                                 or new.consent_revoked_by_customer_at is not null) then
    raise exception 'publication/consent are set via RPC only' using errcode = '42501';
  end if;
  return new;
end $$;

-- Replaces 0006: explicit error for staff after a customer withdrawal (trigger enforces too).
create or replace function public.set_publication_consent(p_event_id uuid, p_status public.consent_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_revoked timestamptz;
begin
  if app.owns_event(p_event_id) then
    if p_status not in ('granted', 'revoked') then
      raise exception 'customers may only grant or revoke consent' using errcode = '42501';
    end if;
  elsif app.is_admin() then
    select consent_revoked_by_customer_at into v_revoked from public.events where id = p_event_id;
    if v_revoked is not null and p_status = 'granted' then
      raise exception 'consent was withdrawn by the customer; only the customer can grant it again'
        using errcode = '42501';
    end if;
  else
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.events set publication_consent = p_status where id = p_event_id;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
end;
$$;

-- ================================================================ 3. durable cleanup queue
alter table private.storage_cleanup_queue
  add column attempts int not null default 0,
  add column last_error text,
  add column next_attempt_at timestamptz not null default now(),
  add column dead_at timestamptz;
drop index if exists private.storage_cleanup_queue_pending_idx;
create index storage_cleanup_queue_pending_idx on private.storage_cleanup_queue (next_attempt_at)
  where done_at is null and dead_at is null;

-- Admin (app) or the service role (Edge Function worker).
create or replace function app.is_cleanup_worker()
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_admin() or coalesce(auth.role(), '') = 'service_role';
$$;
revoke execute on function app.is_cleanup_worker() from public;
grant execute on function app.is_cleanup_worker() to authenticated, service_role;

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
    where q.done_at is null and q.dead_at is null and q.next_attempt_at <= now()
      and (q.claimed_at is null or q.claimed_at < now() - interval '15 minutes')
    order by q.enqueued_at
    limit greatest(1, least(coalesce(p_limit, 100), 1000))
    for update skip locked
  )
  update private.storage_cleanup_queue q set claimed_at = now()
  from c where q.id = c.id
  returning q.id, q.bucket, q.path, q.reason, q.enqueued_at;
end $$;

-- Marks items done and drops the (already non-public) public-media rows whose object is gone.
create or replace function public.complete_storage_cleanup(p_ids uuid[])
returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if not app.is_cleanup_worker() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  with d as (
    update private.storage_cleanup_queue set done_at = now(), claimed_at = coalesce(claimed_at, now())
    where id = any(p_ids) and done_at is null
    returning bucket, path
  ), gone as (
    delete from public.media_assets m using d
    where d.bucket = 'public-media' and m.bucket = 'public-media' and m.visibility = 'private' and m.path = d.path
    returning m.id
  )
  select count(*) into v_n from d;
  return v_n;
end $$;

-- Failure: attempts+1, exponential backoff (30s, 60s, 120s, ... capped at 1h),
-- dead-letter after 5 attempts (kept for inspection, never claimed again).
create or replace function public.fail_storage_cleanup(p_ids uuid[], p_error text)
returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if not app.is_cleanup_worker() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update private.storage_cleanup_queue
     set attempts = attempts + 1,
         last_error = left(coalesce(p_error, 'error'), 500),
         claimed_at = null,
         next_attempt_at = now() + least(interval '1 hour', interval '30 seconds' * power(2, attempts)),
         dead_at = case when attempts + 1 >= 5 then now() end
   where id = any(p_ids) and done_at is null and dead_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Admin overview: read-only counts.
create or replace function public.storage_cleanup_pending()
returns table (pending int, failing int, dead int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  select count(*) filter (where q.done_at is null and q.dead_at is null)::int,
         count(*) filter (where q.done_at is null and q.dead_at is null and q.attempts > 0)::int,
         count(*) filter (where q.dead_at is not null and q.done_at is null)::int
  from private.storage_cleanup_queue q;
end $$;

revoke execute on function public.claim_storage_cleanup(int), public.complete_storage_cleanup(uuid[]),
  public.fail_storage_cleanup(uuid[], text), public.storage_cleanup_pending() from public, anon;
grant execute on function public.claim_storage_cleanup(int), public.complete_storage_cleanup(uuid[]),
  public.fail_storage_cleanup(uuid[], text) to authenticated, service_role;
grant execute on function public.storage_cleanup_pending() to authenticated;

-- A re-published copy cancels any pending deletion of the same path (re-grant then re-publish
-- before the worker ran must not lose the new object).
create or replace function app.media_cancel_pending_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.bucket = 'public-media' and new.visibility = 'public' then
    update private.storage_cleanup_queue
       set done_at = now(), last_error = 'superseded by re-publication'
     where bucket = 'public-media' and done_at is null
       and path in (select p from app.media_paths(new.path, new.variants) p);
  end if;
  return null;
end $$;
revoke execute on function app.media_cancel_pending_cleanup() from public;
create trigger media_cancel_pending_cleanup after insert or update of visibility on public.media_assets
for each row execute function app.media_cancel_pending_cleanup();

-- ================================================================ scheduler (pg_cron + pg_net)
-- Calls the storage-cleanup Edge Function when there is due work. Best-effort: never raises.
-- Operator-provided Vault secrets (see docs/security-model.md "Consent withdrawal"):
--   storage_cleanup_url : https://<project-ref>.supabase.co/functions/v1/storage-cleanup
--   storage_cleanup_key : bearer accepted by the function (service role key or STORAGE_CLEANUP_SECRET)
create or replace function app.invoke_storage_cleanup(p_reason text default 'cron')
returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_key text; v_id bigint;
begin
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'storage_cleanup_url';
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'storage_cleanup_key';
  if v_url is null or v_key is null then
    return null;
  end if;
  if not exists (select 1 from private.storage_cleanup_queue q
                 where q.done_at is null and q.dead_at is null and q.next_attempt_at <= now()
                   and (q.claimed_at is null or q.claimed_at < now() - interval '15 minutes')) then
    return null;
  end if;
  select net.http_post(
    url := v_url,
    body := jsonb_build_object('reason', p_reason),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 20000
  ) into v_id;
  return v_id;
exception when others then
  raise warning 'storage cleanup invoke failed: %', sqlerrm;
  return null;
end $$;
revoke execute on function app.invoke_storage_cleanup(text) from public, anon, authenticated;

-- Replaces 0008: enqueue public copies, hide them, and kick the worker (after COMMIT, via pg_net).
create or replace function app.events_unpublish_media()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if old.is_published and not new.is_published then
    insert into private.storage_cleanup_queue (bucket, path, reason)
    select 'public-media', p, 'unpublished:' || new.id::text
    from public.media_assets m, app.media_paths(m.path, m.variants) p
    where m.event_id = new.id and m.bucket = 'public-media';
    get diagnostics v_n = row_count;
    update public.media_assets set visibility = 'private'
    where event_id = new.id and visibility = 'public';
    if v_n > 0 then
      perform app.invoke_storage_cleanup('unpublished');
    end if;
  end if;
  return null;
end $$;

-- Every minute (cron.schedule upserts by name).
select cron.schedule('storage-cleanup', '* * * * *', $$select app.invoke_storage_cleanup('cron')$$);
