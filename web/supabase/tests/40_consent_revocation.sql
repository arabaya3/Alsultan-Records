-- Consent withdrawal (migration 0010): immediate revocation, sticky customer withdrawal,
-- durable cleanup queue, originals preserved.
begin;
select plan(26);

-- Fixture: one published copy (display + thumb) of a private e2 image, as the app creates it.
insert into public.media_assets (id, event_id, bucket, path, kind, mime, visibility, upload_status, variants)
values ('00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000000e2', 'public-media',
        'events/00000000-0000-4000-8000-0000000000e2/00000000-0000-4000-8000-0000000004a0/display.webp',
        'image', 'image/webp', 'public', 'ready',
        '{"display":"events/00000000-0000-4000-8000-0000000000e2/00000000-0000-4000-8000-0000000004a0/display.webp",
          "thumb":"events/00000000-0000-4000-8000-0000000000e2/00000000-0000-4000-8000-0000000004a0/thumb.webp"}');
insert into storage.objects (bucket_id, name) values
  ('public-media', 'events/00000000-0000-4000-8000-0000000000e2/00000000-0000-4000-8000-0000000004a0/display.webp'),
  ('public-media', 'events/00000000-0000-4000-8000-0000000000e2/00000000-0000-4000-8000-0000000004a0/thumb.webp'),
  ('public-media', 'events/00000000-0000-4000-8000-0000000000e2/stray/unreferenced.webp'),
  ('private-media', 'events/00000000-0000-4000-8000-0000000000e2/00000000-0000-4000-8000-0000000004a0/original.jpg');

create temp table t_private as
  select (select count(*) from public.media_assets where event_id = '00000000-0000-4000-8000-0000000000e2' and bucket = 'private-media') as rows,
         (select count(*) from storage.objects where bucket_id = 'private-media' and name like 'events/00000000-0000-4000-8000-0000000000e2/%') as objects;
grant select on t_private to anon, authenticated;

select is((select public from storage.buckets where id = 'public-media'), false, 'public-media is not a public bucket');
select isnt_empty($$select 1 from cron.job where jobname = 'storage-cleanup' and schedule = '* * * * *'$$, 'cleanup cron job scheduled every minute');

-- anon while published
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'public-media' and name like 'events/00000000-0000-4000-8000-0000000000e2/%'),
  2, 'anon reads only the live published objects (not unreferenced ones)');
select is((select count(*)::int from public.media_assets where id = '00000000-0000-4000-8000-0000000004a1'), 1, 'anon sees the public media row');
select is((select count(*)::int from storage.objects where bucket_id = 'private-media'), 0, 'anon never reads private-media');
reset role;

-- customer A withdraws: everything below runs in the SAME transaction, no worker involved
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok($$select public.set_publication_consent('00000000-0000-4000-8000-0000000000e2', 'revoked')$$, 'customer withdraws consent');
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'public-media'), 0, 'immediately: anon can no longer read the published objects');
select is((select count(*)::int from public.media_assets where id = '00000000-0000-4000-8000-0000000004a1'), 0, 'immediately: media row no longer public');
select is((select count(*)::int from public.events where id = '00000000-0000-4000-8000-0000000000e2'), 0, 'immediately: project no longer public');
reset role;

select ok((select consent_revoked_by_customer_at is not null and consent_by = '00000000-0000-4000-8000-0000000000b1'
           from public.events where id = '00000000-0000-4000-8000-0000000000e2'), 'withdrawal recorded (who/when)');
select is((select count(*)::int from private.storage_cleanup_queue
           where bucket = 'public-media' and done_at is null and path like 'events/00000000-0000-4000-8000-0000000000e2/00000000-0000-4000-8000-0000000004a0/%'),
  2, 'published copies enqueued for deletion (display + thumb)');
select is((select count(*)::int from private.storage_cleanup_queue where bucket = 'private-media'), 0, 'no private object enqueued');
select ok((select rows = (select count(*) from public.media_assets where event_id = '00000000-0000-4000-8000-0000000000e2' and bucket = 'private-media')
              and objects = (select count(*) from storage.objects where bucket_id = 'private-media' and name like 'events/00000000-0000-4000-8000-0000000000e2/%')
           from t_private), 'private originals + variants untouched');

-- staff/admin cannot republish
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.set_publication_consent('00000000-0000-4000-8000-0000000000e2', 'granted')$$, '42501', null,
  'admin cannot re-grant after customer withdrawal');
select throws_ok($$select public.set_event_publication('00000000-0000-4000-8000-0000000000e2', true)$$, '42501', null,
  'admin cannot publish after customer withdrawal');
select throws_ok($$update public.events set consent_revoked_by_customer_at = null where id = '00000000-0000-4000-8000-0000000000e2'$$, '42501', null,
  'admin cannot clear the withdrawal flag directly');
select lives_ok($$select public.set_publication_consent('00000000-0000-4000-8000-0000000000e2', 'requested')$$, 'admin may ask again (requested)');
select throws_ok($$select public.set_publication_consent('00000000-0000-4000-8000-0000000000e2', 'granted')$$, '42501', null,
  'still no admin grant after requested');
select is((select count(*)::int from public.storage_cleanup_pending() where pending >= 2), 1, 'admin reads pending cleanup count');
reset role;

-- owner role cannot bypass either
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.set_publication_consent('00000000-0000-4000-8000-0000000000e2', 'granted')$$, '42501', null,
  'owner cannot re-grant after customer withdrawal');
reset role;

-- customer cannot read the queue counts
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select * from public.storage_cleanup_pending()$$, '42501', null, 'customer cannot read cleanup counts');
-- customer re-grants
select lives_ok($$select public.set_publication_consent('00000000-0000-4000-8000-0000000000e2', 'granted')$$, 'customer can re-grant');
reset role;
select ok((select consent_revoked_by_customer_at is null and publication_consent = 'granted' and consent_by = '00000000-0000-4000-8000-0000000000b1'
           from public.events where id = '00000000-0000-4000-8000-0000000000e2'), 're-grant recorded (who/when), flag cleared');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok($$select public.set_event_publication('00000000-0000-4000-8000-0000000000e2', true)$$, 'admin can publish after customer re-grant');
reset role;

-- worker: service role claims; failures back off and dead-letter after 5 attempts
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((select count(*)::int from public.claim_storage_cleanup(100)), 2, 'service role claims due items');
reset role;
do $$
declare i int; v uuid := (select id from private.storage_cleanup_queue where path like '%4a0/thumb.webp');
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  for i in 1..5 loop
    perform public.fail_storage_cleanup(array[v], 'forced');
    update private.storage_cleanup_queue set next_attempt_at = now() where id = v; -- skip the backoff wait
  end loop;
end $$;
select ok((select attempts = 5 and dead_at is not null and last_error = 'forced'
           from private.storage_cleanup_queue where path like '%4a0/thumb.webp'), 'dead-lettered after 5 failed attempts');

select * from finish();
rollback;
