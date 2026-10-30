-- 0030 Facebook queue claim (review of 97ccbbf):
--  * a claim is a LEASE for the whole worker run, not just the SQL transaction: lease_token + lease_until. A job is
--    claimable again only after its lease expired (worker crashed / timed out). Every worker write must match the
--    job's current lease_token, so a stale worker can never overwrite the current one (checked in src/features/facebook/save.ts);
--  * the 24 h quota (30 per Page) limits NEW uploads: with N places left, at most N queued jobs are claimed, also when
--    workers claim concurrently (claims are serialized by a transaction advisory lock). Status checks of jobs whose
--    finish was already sent ('processing') and the resumption of a started job do not take a new place.
-- Rollback: drop the two columns and restore the 0029 definition of claim_facebook_jobs.

alter table public.facebook_reel_posts
  add column lease_token uuid,
  add column lease_until timestamptz;

-- Lease > the worker's maxDuration (60 s) + the pg_net timeout, so a live worker never loses its job.
create or replace function public.claim_facebook_jobs(p_limit int default 2)
returns setof public.facebook_reel_posts language plpgsql set search_path = '' as $$
declare v_room int; v_page text; v_lim int := least(greatest(1, coalesce(p_limit, 2)), 10); v_ids uuid[]; v_new uuid[];
begin
  -- one claimer at a time: the quota count below must see the jobs another worker just claimed
  perform pg_advisory_xact_lock(hashtext('public.claim_facebook_jobs'));
  select page_id into v_page from public.meta_page_connection where id = 1 and status = 'connected';
  if v_page is null then return; end if;

  -- 1) jobs already started (status checks / resumption): never take a new place in the quota
  select coalesce(array_agg(id), '{}') into v_ids from (
    select f.id from public.facebook_reel_posts f
     where f.reel_video_id is not null and f.meta_post_id is null and f.page_id = v_page
       and f.status in ('processing', 'publishing') and f.next_attempt_at <= now()
       and (f.lease_until is null or f.lease_until < now())
     order by f.created_at
     limit v_lim
     for update skip locked) s;

  -- 2) new uploads, at most the places left in the last 24 h (published, finish sent, or an upload under way)
  select 30 - count(*) into v_room from public.facebook_reel_posts
   where published_at > now() - interval '24 hours' or finish_requested_at > now() - interval '24 hours'
      or (status = 'publishing' and claimed_at > now() - interval '24 hours');
  select coalesce(array_agg(id), '{}') into v_new from (
    select f.id from public.facebook_reel_posts f
     where f.reel_video_id is not null and f.meta_post_id is null and f.page_id = v_page
       and f.status = 'queued' and f.next_attempt_at <= now()
       and (f.lease_until is null or f.lease_until < now())
     order by f.created_at
     limit greatest(0, least(v_room, v_lim - cardinality(v_ids)))
     for update skip locked) s;

  return query
  update public.facebook_reel_posts q
     set status = case when q.status = 'processing' then 'processing' else 'publishing' end,
         claimed_at = now(), attempts = q.attempts + 1, updated_at = now(),
         lease_token = gen_random_uuid(), lease_until = now() + interval '3 minutes'
   where q.id = any (v_ids || v_new)
  returning q.*;
end $$;
revoke execute on function public.claim_facebook_jobs(int) from public, anon, authenticated;
grant execute on function public.claim_facebook_jobs(int) to service_role;
