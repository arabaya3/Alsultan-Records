-- 0030 claim lease + quota (sequential part; the CONCURRENT claims are in tests/e2e/facebook-claim.spec.ts).
begin;
select plan(9);

select public.meta_connect('1111111111', 'صفحة أ', 'EAAB-local-test-token-not-real-aaaa');
insert into public.reel_videos (id, title, storage_path, mime, bytes)
  select ('00000000-0000-4000-8000-0000000ee2' || lpad(g::text, 2, '0'))::uuid, 'مقطع ' || g,
         'reels/00000000-0000-4000-8000-0000000ee2' || lpad(g::text, 2, '0') || '.mp4', 'video/mp4', 1000
    from generate_series(1, 4) g;
insert into public.facebook_reel_posts (reel_video_id, status, page_id, finish_requested_at, meta_video_id)
  values ('00000000-0000-4000-8000-0000000ee201', 'processing', '1111111111', now(), '9001');

create temp table c1 as select * from public.claim_facebook_jobs(5);
select ok((select lease_token is not null and lease_until > now() + interval '2 minutes' from c1), 'claim gives a lease for the worker run (> maxDuration)');
select is((select count(*)::int from public.claim_facebook_jobs(5)), 0, 'while the lease is valid no other worker gets the job, even a processing one');
select is((with u as (update public.facebook_reel_posts set last_error = 'x' where lease_token = (select lease_token from c1) returning 1) select count(*)::int from u), 1, 'the lease holder can write');

-- the worker crashed: lease expires → the job is recovered with a NEW lease; the old worker's writes match nothing
update public.facebook_reel_posts set lease_until = now() - interval '1 second';
create temp table c2 as select * from public.claim_facebook_jobs(5);
select is((select count(*)::int from c2), 1, 'expired lease → job recovered');
select isnt((select lease_token from c2), (select lease_token from c1), 'with a new lease');
select is((with u as (update public.facebook_reel_posts set last_error = 'stale' where lease_token = (select lease_token from c1) returning 1) select count(*)::int from u), 0, 'the stale worker cannot overwrite the current one');

-- quota: 28 places used + the processing job = 29 → exactly ONE place left; three new jobs queued
insert into public.facebook_reel_posts (status, page_id, meta_post_id, published_at)
  select 'published', '1111111111', 'p' || g, now() from generate_series(1, 28) g;
insert into public.facebook_reel_posts (reel_video_id, status, page_id)
  select ('00000000-0000-4000-8000-0000000ee2' || lpad(g::text, 2, '0'))::uuid, 'queued', '1111111111' from generate_series(2, 4) g;
update public.facebook_reel_posts set lease_until = now() - interval '1 second', next_attempt_at = now() - interval '1 minute' where status = 'processing';
create temp table c3 as select * from public.claim_facebook_jobs(5);
select is((select count(*)::int from c3 where status = 'publishing'), 1, 'one place left → one new upload, even with p_limit 5');
select is((select count(*)::int from c3 where status = 'processing'), 1, 'the processing status check is still claimed');
select is((select count(*)::int from public.claim_facebook_jobs(5)), 0, 'quota now full: no new upload');

select * from finish();
rollback;
