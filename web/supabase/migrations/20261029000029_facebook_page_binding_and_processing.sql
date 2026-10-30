-- 0029 Facebook queue (review of e252128):
--  * a job is bound to the Page the owner approved (page_id at request time); a different/missing connection never
--    moves it: it stops as 'page_changed' until the owner re-confirms (re-request) or reconnects that same Page;
--  * a job requested while no Page was connected has no approved Page: on connect it becomes 'page_changed'
--    («أكّد النشر على الصفحة المربوطة»), it is not sent to whatever Page is connected;
--  * 'processing' = Meta accepted `finish`, publication not yet confirmed. 'published' only after Meta's status says so.
-- Rollback: update rows in ('processing','page_changed') to 'failed', then restore the 0027 definitions of the
-- check constraint and of meta_connect / meta_disconnect / request_facebook_reel_post / claim_facebook_jobs /
-- app.invoke_facebook_jobs.

alter table public.facebook_reel_posts drop constraint facebook_reel_posts_status_check;
alter table public.facebook_reel_posts add constraint facebook_reel_posts_status_check
  check (status in ('awaiting_connection', 'queued', 'publishing', 'processing', 'published', 'failed', 'page_changed'));

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
  -- waiting jobs of THIS Page go on (also ones stopped earlier because another Page was connected)
  update public.facebook_reel_posts set status = 'queued', next_attempt_at = now(), last_error = null, updated_at = now()
   where status in ('awaiting_connection', 'page_changed') and page_id = p_page_id;
  -- jobs approved for another Page, or for no Page, are never moved: they stop with a reason
  update public.facebook_reel_posts set status = 'page_changed', updated_at = now(),
         last_error = case when page_id is null
           then 'طُلب النشر قبل ربط أي صفحة. أكّد النشر على الصفحة المربوطة الآن من جديد.'
           else 'طُلب النشر على صفحة أخرى غير المربوطة الآن. أعد ربط تلك الصفحة أو أكّد النشر على الصفحة الحالية.' end
   where status in ('awaiting_connection', 'queued', 'publishing') and page_id is distinct from p_page_id
     and meta_post_id is null;
end $$;

create or replace function public.meta_disconnect(p_status text default 'disconnected', p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('disconnected', 'expired') then raise exception 'bad status' using errcode = '22023'; end if;
  delete from vault.secrets where name = 'meta_page_token';
  update public.meta_page_connection set status = p_status, status_changed_at = now(), last_error = left(p_error, 500) where id = 1;
  update public.facebook_reel_posts set status = 'awaiting_connection', updated_at = now()
   where status in ('queued', 'publishing', 'processing') and meta_post_id is null;
end $$;

-- Owner action. Idempotent. A job stopped as 'page_changed' that never reached Meta (no meta_video_id) is re-bound
-- to the currently connected Page: the owner's explicit re-request IS the approval of that Page.
create or replace function public.request_facebook_reel_post(p_reel_video_id uuid, p_caption text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_conn public.meta_page_connection%rowtype;
begin
  if not app.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.reel_videos where id = p_reel_video_id) then
    raise exception 'unknown reel' using errcode = '22023';
  end if;
  select * into v_conn from public.meta_page_connection where id = 1;
  insert into public.facebook_reel_posts (reel_video_id, caption, status, page_id, page_name, requested_by)
  values (p_reel_video_id, nullif(btrim(p_caption), ''),
          case when v_conn.status = 'connected' then 'queued' else 'awaiting_connection' end,
          case when v_conn.status = 'connected' then v_conn.page_id end,
          case when v_conn.status = 'connected' then v_conn.page_name end, auth.uid())
  on conflict (reel_video_id) do nothing
  returning id into v_id;
  if v_id is null then
    update public.facebook_reel_posts
       set page_id = v_conn.page_id, page_name = v_conn.page_name, status = 'queued', next_attempt_at = now(),
           last_error = null, requested_by = auth.uid(), updated_at = now()
     where reel_video_id = p_reel_video_id and status = 'page_changed' and meta_video_id is null
       and v_conn.status = 'connected';
    select id into v_id from public.facebook_reel_posts where reel_video_id = p_reel_video_id;
  end if;
  return v_id;
end $$;

-- Claim: queued, 'processing' (only a status check, never a new finish) and dead 'publishing' jobs, only for the
-- connected Page. The 24 h quota counts every job whose finish was sent (processing or published) in the window.
create or replace function public.claim_facebook_jobs(p_limit int default 2)
returns setof public.facebook_reel_posts language plpgsql set search_path = '' as $$
declare v_room int; v_page text;
begin
  select page_id into v_page from public.meta_page_connection where id = 1 and status = 'connected';
  if v_page is null then return; end if;
  select 30 - count(*) into v_room from public.facebook_reel_posts
   where published_at > now() - interval '24 hours' or finish_requested_at > now() - interval '24 hours'
      or (status = 'publishing' and claimed_at > now() - interval '24 hours');
  return query
  with c as (
    select f.id from public.facebook_reel_posts f
     where f.reel_video_id is not null and f.meta_post_id is null and f.next_attempt_at <= now()
       and f.page_id = v_page
       and (f.status = 'processing'
         or (v_room > 0 and (f.status = 'queued' or (f.status = 'publishing' and f.claimed_at < now() - interval '10 minutes'))))
     order by f.created_at
     limit least(greatest(1, coalesce(p_limit, 2)), 10)
     for update skip locked
  )
  update public.facebook_reel_posts q
     set status = case when q.status = 'processing' then 'processing' else 'publishing' end,
         claimed_at = now(), attempts = q.attempts + 1, updated_at = now()
    from c where q.id = c.id
  returning q.*;
end $$;

create or replace function app.invoke_facebook_jobs(p_reason text default 'cron')
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_url text; v_key text; v_id bigint;
begin
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'facebook_jobs_url';
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'jobs_secret';
  if v_url is null or v_key is null then return null; end if;
  if not exists (select 1 from public.facebook_reel_posts where status in ('queued', 'publishing', 'processing') and next_attempt_at <= now()) then
    return null;
  end if;
  select net.http_post(url := v_url, body := jsonb_build_object('reason', p_reason),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jobs-secret', v_key), timeout_milliseconds := 55000) into v_id;
  return v_id;
exception when others then
  raise warning 'facebook jobs invoke failed: %', sqlerrm;
  return null;
end $$;
