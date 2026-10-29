-- 0029 Facebook queue: a job stays bound to the Page the owner approved; 'processing' is accepted-not-published.
begin;
select plan(13);

insert into public.reel_videos (id, title, storage_path, mime, bytes) values
  ('00000000-0000-4000-8000-00000000ee11', 'مقطع أ', 'reels/00000000-0000-4000-8000-00000000ee11.mp4', 'video/mp4', 1000),
  ('00000000-0000-4000-8000-00000000ee12', 'مقطع ب', 'reels/00000000-0000-4000-8000-00000000ee12.mp4', 'video/mp4', 1000);

-- Page A connected, owner requests clip A → bound to Page A
select public.meta_connect('1111111111', 'صفحة أ', 'EAAB-local-test-token-not-real-aaaa');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.request_facebook_reel_post('00000000-0000-4000-8000-00000000ee11');
reset role;
select is((select page_id from public.facebook_reel_posts where reel_video_id = '00000000-0000-4000-8000-00000000ee11'), '1111111111', 'job bound to the approved Page');

-- disconnect → waits; Page B connected → stops as page_changed, NOT moved to Page B
select public.meta_disconnect('disconnected', null);
select is((select status from public.facebook_reel_posts), 'awaiting_connection', 'disconnect parks the job');
select public.meta_connect('2222222222', 'صفحة ب', 'EAAB-local-test-token-not-real-bbbb');
select is((select status || ' ' || page_id from public.facebook_reel_posts), 'page_changed 1111111111', 'another Page connected → page_changed, page kept');
select is((select count(*)::int from public.claim_facebook_jobs(5)), 0, 'worker never takes a job for another Page');

-- reconnecting the SAME Page A resumes it
select public.meta_connect('1111111111', 'صفحة أ', 'EAAB-local-test-token-not-real-aaaa');
select is((select status from public.facebook_reel_posts), 'queued', 'the approved Page reconnected → queued again');

-- Page B again; owner re-confirms on Page B → re-bound (only because it never reached Meta)
select public.meta_connect('2222222222', 'صفحة ب', 'EAAB-local-test-token-not-real-bbbb');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.request_facebook_reel_post('00000000-0000-4000-8000-00000000ee11');
reset role;
select is((select status || ' ' || page_id from public.facebook_reel_posts), 'queued 2222222222', 'owner re-confirmation re-binds to the connected Page');

-- a job that already has a Meta upload on Page A is never re-bound, even when the owner re-requests
select public.meta_connect('1111111111', 'صفحة أ', 'EAAB-local-test-token-not-real-aaaa');
update public.facebook_reel_posts set page_id = '1111111111', status = 'queued', meta_video_id = '9001';
select public.meta_connect('2222222222', 'صفحة ب', 'EAAB-local-test-token-not-real-bbbb');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.request_facebook_reel_post('00000000-0000-4000-8000-00000000ee11');
reset role;
select is((select status || ' ' || page_id from public.facebook_reel_posts), 'page_changed 1111111111', 'started on Page A → stays on Page A');

-- processing: accepted by Meta, not published; claimable for a status check, counted in the 24 h quota
select public.meta_connect('1111111111', 'صفحة أ', 'EAAB-local-test-token-not-real-aaaa');
update public.facebook_reel_posts set status = 'processing', finish_requested_at = now(), next_attempt_at = now() - interval '1 minute';
select lives_ok($$update public.facebook_reel_posts set status = 'processing'$$, 'processing is a valid status');
select throws_ok($$update public.facebook_reel_posts set status = 'published'$$, '23514', null, 'published still needs meta_post_id');
select is((select status from public.claim_facebook_jobs(5)), 'processing', 'processing job is claimed for a status check, stays processing');
-- fill the quota with 29 other finished jobs today: a processing job is still checked, a new one is not started
insert into public.facebook_reel_posts (status, page_id, meta_post_id, published_at)
  select 'published', '1111111111', 'p' || g, now() from generate_series(1, 29) g;
insert into public.facebook_reel_posts (reel_video_id, status, page_id) values ('00000000-0000-4000-8000-00000000ee12', 'queued', '1111111111');
update public.facebook_reel_posts set next_attempt_at = now() - interval '1 minute', claimed_at = null where status = 'processing';
select is((select array_agg(status order by status) from public.claim_facebook_jobs(5)), array['processing'], 'quota full (29 published + 1 processing): status check yes, new upload no');
select public.meta_disconnect('expired', null);
select is((select count(*)::int from public.facebook_reel_posts where status = 'awaiting_connection'), 2, 'disconnect parks processing and queued jobs');
select ok((select finish_requested_at is not null from public.facebook_reel_posts where reel_video_id = '00000000-0000-4000-8000-00000000ee11'), 'finish marker kept (finish is never re-sent)');

select * from finish();
rollback;
