-- 0027 Native reel files + "also post to Facebook" queue: owner-only, idempotent, token never readable.
begin;
select plan(16);

insert into public.reel_videos (id, title, storage_path, mime, bytes)
values ('00000000-0000-4000-8000-00000000ee01', 'برومو تجريبي', 'reels/00000000-0000-4000-8000-00000000ee01.mp4', 'video/mp4', 1000);

-- token: no column anywhere, function not callable by app roles
select hasnt_column('public', 'meta_page_connection', 'access_token', 'no token column');
select ok(not has_function_privilege('authenticated', 'public.meta_page_token()', 'execute')
      and not has_function_privilege('anon', 'public.meta_page_token()', 'execute'), 'only service_role can read the token');
select ok(not has_function_privilege('authenticated', 'public.meta_connect(text,text,text)', 'execute'), 'connect is server-only');
select ok(not has_function_privilege('authenticated', 'public.claim_facebook_jobs(int)', 'execute'), 'claim is worker-only');
select is((select public from storage.buckets where id = 'reel-media'), false, 'reel files bucket is private');

-- owner opts in; not connected → awaiting_connection
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok($$select public.request_facebook_reel_post('00000000-0000-4000-8000-00000000ee01', 'نص')$$, 'owner can request a Facebook post');
select is((select status from public.facebook_reel_posts), 'awaiting_connection', 'no Page connected → awaiting_connection (honest state)');
select is(public.request_facebook_reel_post('00000000-0000-4000-8000-00000000ee01', 'again'),
          (select id from public.facebook_reel_posts), 'second request returns the same job (no duplicate)');
select is((select count(*)::int from public.facebook_reel_posts), 1, 'still one job');
reset role;

-- an admin who is not the owner cannot
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.request_facebook_reel_post('00000000-0000-4000-8000-00000000ee01')$$, '42501', null, 'non-owner cannot request');
select is((select count(*)::int from public.facebook_reel_posts), 0, 'non-owner cannot even see the queue');
reset role;

-- connecting (server) stores the token in Vault and releases waiting jobs; the worker claims once
select public.meta_connect('1234567890', 'ستوديو السلطان', 'EAAB-local-test-token-not-real-0000');
select is((select status from public.facebook_reel_posts), 'queued', 'connection releases waiting jobs');
select is(public.meta_page_token(), 'EAAB-local-test-token-not-real-0000', 'token round-trips through Vault (service side)');
select is((select count(*)::int from public.claim_facebook_jobs(5)), 1, 'worker claims the due job');
select is((select count(*)::int from public.claim_facebook_jobs(5)), 0, 'a second worker gets nothing (no double publish)');

-- disconnect forgets the token; unfinished job waits again
select public.meta_disconnect('expired', 'Session has expired');
select ok(public.meta_page_token() is null and (select status from public.facebook_reel_posts) = 'awaiting_connection',
  'expiry forgets the token and parks the job');

select * from finish();
rollback;
