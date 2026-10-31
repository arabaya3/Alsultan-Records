-- 0031 Final review of the Facebook queue + album order (0026–0030 stay as published):
--  * a job whose `finish` was already sent is a status check, whatever its status (it can be 'queued' after a
--    reconnection): never limited by the quota; on reconnection it returns to 'processing';
--  * a status check survives a locally deleted clip (reel_video_id set null); a queued job without a clip reaches the
--    worker so it can fail with a reason instead of waiting forever;
--  * connecting another Page also stops 'processing' jobs (they would otherwise never be claimed again);
--  * connect / disconnect withdraw the leases of the jobs they change: a worker still running stops at its next save;
--  * meta_connection_lost: the worker's "token is dead" report counts only while it holds the job's current lease;
--  * the 24 h quota counts per Page, as Meta's limit does;
--  * albums published before 0026 have published_at null: hiding one now stores its created_at (its current listed_at),
--    so showing it again keeps its place instead of being stamped «now».
-- Rollback: restore the 0030 claim_facebook_jobs, the 0029 meta_connect / meta_disconnect and the 0026 trigger function;
-- drop function public.meta_connection_lost(uuid, uuid, text). Data written meanwhile stays valid.

create or replace function app.photo_albums_published_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.published_at := case when new.is_published then now() else null end;
  else
    new.published_at := old.published_at;
    if old.published_at is null then
      if new.is_published and not old.is_published then new.published_at := now();
      elsif old.is_published and not new.is_published then new.published_at := old.created_at;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.meta_connect(p_page_id text, p_page_name text, p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'invalid token' using errcode = '22023'; end if;
  select id into v_id from vault.secrets where name = 'meta_page_token';
  if v_id is null then perform vault.create_secret(p_token, 'meta_page_token', 'Facebook Page token (server only)');
  else perform vault.update_secret(v_id, p_token); end if;
  insert into public.meta_page_connection (id, page_id, page_name, status, connected_at, status_changed_at, last_error)
  values (1, p_page_id, p_page_name, 'connected', now(), now(), null)
  on conflict (id) do update set page_id = excluded.page_id, page_name = excluded.page_name, status = 'connected',
    connected_at = now(), status_changed_at = now(), last_error = null;
  -- waiting jobs of THIS Page go on; a job whose finish was sent only has its status checked
  update public.facebook_reel_posts
     set status = case when finish_requested_at is not null then 'processing' else 'queued' end,
         next_attempt_at = now(), last_error = null, updated_at = now(), lease_token = null, lease_until = null
   where status in ('awaiting_connection', 'page_changed') and page_id = p_page_id;
  -- jobs approved for another Page, or for no Page, are never moved: they stop with a reason
  update public.facebook_reel_posts set status = 'page_changed', updated_at = now(), lease_token = null, lease_until = null,
         last_error = case when page_id is null
           then 'طُلب النشر قبل ربط أي صفحة. أكّد النشر على الصفحة المربوطة الآن من جديد.'
           else 'طُلب النشر على صفحة أخرى غير المربوطة الآن. أعد ربط تلك الصفحة أو أكّد النشر على الصفحة الحالية.' end
   where status in ('awaiting_connection', 'queued', 'publishing', 'processing') and page_id is distinct from p_page_id
     and meta_post_id is null;
end $$;

create or replace function public.meta_disconnect(p_status text default 'disconnected', p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('disconnected', 'expired') then raise exception 'bad status' using errcode = '22023'; end if;
  delete from vault.secrets where name = 'meta_page_token';
  update public.meta_page_connection set status = p_status, status_changed_at = now(), last_error = left(p_error, 500) where id = 1;
  update public.facebook_reel_posts
     set status = 'awaiting_connection', updated_at = now(), lease_token = null, lease_until = null,
         last_error = case when p_status = 'expired' then 'انتهى ربط صفحة فيسبوك أو سُحبت الصلاحية. أعد الربط من الإعدادات.' else last_error end
   where status in ('queued', 'publishing', 'processing') and meta_post_id is null;
end $$;

-- Worker only. false = this worker no longer holds the job's lease: it reports nothing and stops.
create or replace function public.meta_connection_lost(p_job uuid, p_lease uuid, p_error text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.facebook_reel_posts where id = p_job and lease_token = p_lease for update;
  if not found then return false; end if;
  perform public.meta_disconnect('expired', p_error);
  return true;
end $$;
revoke execute on function public.meta_connection_lost(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.meta_connection_lost(uuid, uuid, text) to service_role;

create or replace function public.claim_facebook_jobs(p_limit int default 2)
returns setof public.facebook_reel_posts language plpgsql set search_path = '' as $$
declare v_room int; v_page text; v_lim int := least(greatest(1, coalesce(p_limit, 2)), 10); v_ids uuid[]; v_new uuid[];
begin
  perform pg_advisory_xact_lock(hashtext('public.claim_facebook_jobs'));
  select page_id into v_page from public.meta_page_connection where id = 1 and status = 'connected';
  if v_page is null then return; end if;

  -- 1) no new place needed: finish already sent (status check), a started job, or a job with no clip left (worker fails it)
  select coalesce(array_agg(id), '{}') into v_ids from (
    select f.id from public.facebook_reel_posts f
     where f.meta_post_id is null and f.page_id = v_page and f.next_attempt_at <= now()
       and (f.lease_until is null or f.lease_until < now())
       and (f.status in ('processing', 'publishing')
         or (f.status = 'queued' and (f.finish_requested_at is not null or f.reel_video_id is null)))
     order by f.created_at
     limit v_lim
     for update skip locked) s;

  -- 2) new uploads: at most the places left on this Page in the last 24 h
  select 30 - count(*) into v_room from public.facebook_reel_posts
   where page_id = v_page and (published_at > now() - interval '24 hours' or finish_requested_at > now() - interval '24 hours'
      or (status = 'publishing' and claimed_at > now() - interval '24 hours'));
  select coalesce(array_agg(id), '{}') into v_new from (
    select f.id from public.facebook_reel_posts f
     where f.reel_video_id is not null and f.meta_post_id is null and f.page_id = v_page
       and f.status = 'queued' and f.finish_requested_at is null and f.next_attempt_at <= now()
       and (f.lease_until is null or f.lease_until < now())
     order by f.created_at
     limit greatest(0, least(v_room, v_lim - cardinality(v_ids)))
     for update skip locked) s;

  return query
  update public.facebook_reel_posts q
     set status = case when q.finish_requested_at is not null then 'processing' else 'publishing' end,
         claimed_at = now(), attempts = q.attempts + 1, updated_at = now(),
         lease_token = gen_random_uuid(), lease_until = now() + interval '3 minutes'
   where q.id = any (v_ids || v_new)
  returning q.*;
end $$;
