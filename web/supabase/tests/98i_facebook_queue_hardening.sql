-- 0031: status checks and quota, stuck jobs, leases withdrawn on connect/disconnect, connection_lost, album order.
begin;
select plan(13);

select public.meta_connect('1111111111', 'صفحة أ', 'EAAB-local-test-token-not-real-aaaa');
insert into public.reel_videos (id, title, storage_path, mime, bytes) values
  ('00000000-0000-4000-8000-0000000ee301', 'مقطع', 'reels/00000000-0000-4000-8000-0000000ee301.mp4', 'video/mp4', 1000),
  ('00000000-0000-4000-8000-0000000ee302', 'مقطع', 'reels/00000000-0000-4000-8000-0000000ee302.mp4', 'video/mp4', 1000);
insert into public.facebook_reel_posts (id, reel_video_id, status, page_id, meta_video_id, finish_requested_at, next_attempt_at)
  values ('00000000-0000-4000-8000-0000000ff301', '00000000-0000-4000-8000-0000000ee301', 'queued', '1111111111', '9001', now(), now() - interval '1 minute');
-- quota completely full
insert into public.facebook_reel_posts (status, page_id, meta_post_id, published_at)
  select 'published', '1111111111', 'p' || g, now() from generate_series(1, 30) g;
insert into public.facebook_reel_posts (reel_video_id, status, page_id) values ('00000000-0000-4000-8000-0000000ee302', 'queued', '1111111111');

create temp table c1 as select * from public.claim_facebook_jobs(5);
select is((select count(*)::int from c1), 1, 'quota full: only the job whose finish was sent is claimed');
select is((select status from c1), 'processing', 'as a status check, never publishing');

-- a leased job: disconnect withdraws the lease, so a running worker stops at its next save
select public.meta_disconnect('expired', 'x');
select is((select lease_token from public.facebook_reel_posts where id = '00000000-0000-4000-8000-0000000ff301'), null, 'disconnect withdraws the lease');
select is((select status from public.facebook_reel_posts where id = '00000000-0000-4000-8000-0000000ff301'), 'awaiting_connection', 'and parks the job');
select public.meta_connect('1111111111', 'صفحة أ', 'EAAB-local-test-token-not-real-aaaa');
select is((select status from public.facebook_reel_posts where id = '00000000-0000-4000-8000-0000000ff301'), 'processing', 'reconnect: finish sent → processing, not queued');

-- another Page connected directly: a processing job stops with a reason, it does not wait forever
select public.meta_connect('2222222222', 'صفحة ب', 'EAAB-local-test-token-not-real-bbbb');
select is((select status from public.facebook_reel_posts where id = '00000000-0000-4000-8000-0000000ff301'), 'page_changed', 'processing job + other Page → page_changed');
-- quota is per Page: Page A's 30 posts do not fill Page B
update public.facebook_reel_posts set status = 'queued', page_id = '2222222222', next_attempt_at = now() - interval '1 minute' where reel_video_id = '00000000-0000-4000-8000-0000000ee302';
select is((select count(*)::int from public.claim_facebook_jobs(5) where reel_video_id = '00000000-0000-4000-8000-0000000ee302'), 1, 'Page B has its own quota');

-- clip deleted after finish: status check still claimed; on connection-lost only the lease holder counts
select public.meta_connect('1111111111', 'صفحة أ', 'EAAB-local-test-token-not-real-aaaa');
update public.facebook_reel_posts set reel_video_id = null, next_attempt_at = now() - interval '1 minute' where id = '00000000-0000-4000-8000-0000000ff301';
create temp table c2 as select * from public.claim_facebook_jobs(5);
select is((select id from c2), '00000000-0000-4000-8000-0000000ff301'::uuid, 'clip deleted after finish → status check still runs');
select is(public.meta_connection_lost('00000000-0000-4000-8000-0000000ff301', gen_random_uuid(), 'stale'), false, 'a stale worker cannot report the connection lost');
select is((select status from public.meta_page_connection), 'connected', 'connection stays');
select is(public.meta_connection_lost('00000000-0000-4000-8000-0000000ff301', (select lease_token from c2), 'dead'), true, 'the lease holder can');
select ok(not has_function_privilege('authenticated', 'public.meta_connection_lost(uuid,uuid,text)', 'execute'), 'worker only');

-- album published before 0026 (published_at null): hide + show keeps its place
insert into public.photo_albums (id, slug, title, is_published, created_at)
  values ('00000000-0000-4000-8000-0000000aa301', 'old-album-301', 'ألبوم قديم', false, '2020-01-01');
set local session_replication_role = replica;
update public.photo_albums set is_published = true, published_at = null where id = '00000000-0000-4000-8000-0000000aa301';
set local session_replication_role = origin;
update public.photo_albums set is_published = false where id = '00000000-0000-4000-8000-0000000aa301';
update public.photo_albums set is_published = true where id = '00000000-0000-4000-8000-0000000aa301';
select is((select listed_at from public.photo_albums where id = '00000000-0000-4000-8000-0000000aa301'), '2020-01-01'::timestamptz, 'hide + show keeps the old album in its place');

select * from finish();
rollback;
