-- Backups bucket, cleanup queue, explicit media ids.
begin;
select plan(13);

update public.app_settings set require_staff_mfa = true where id = 1;
insert into storage.objects (bucket_id, name) values
  ('backups', 'run-1/manifest.json'),
  ('private-media', 'backups/run-0/legacy.zip');
-- a public copy of the published sample project
insert into public.media_assets (id, event_id, bucket, path, kind, mime, visibility, upload_status, variants)
values ('00000000-0000-4000-8000-0000000002a1', '00000000-0000-4000-8000-0000000000e2', 'public-media',
        'events/00000000-0000-4000-8000-0000000000e2/00000000-0000-4000-8000-0000000002a1/original.jpg',
        'image', 'image/jpeg', 'public', 'ready',
        '{"thumb":"events/00000000-0000-4000-8000-0000000000e2/00000000-0000-4000-8000-0000000002a1/thumb.webp"}');

-- admin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'backups'), 0, 'admin cannot read backups bucket');
select is((select count(*)::int from storage.objects where name like 'backups/%'), 0, 'admin cannot read backups/* in private-media');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('backups', 'run-2/x.json')$$, '42501', null, 'admin cannot write backups bucket');
select lives_ok($$insert into public.media_assets (id, event_id, bucket, path, kind, mime)
  values ('00000000-0000-4000-8000-0000000002b1', '00000000-0000-4000-8000-0000000000e1', 'private-media',
          'events/00000000-0000-4000-8000-0000000000e1/00000000-0000-4000-8000-0000000002b1/original.jpg', 'image', 'image/jpeg')$$,
  'admin can insert media with explicit id');
reset role;

-- owner
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'backups'), 1, 'owner can read backups bucket');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('backups', 'run-2/x.json')$$, 'owner can write backups bucket');
reset role;

-- customer A revokes consent -> public copies queued
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$insert into public.media_assets (id, event_id, bucket, path, kind, mime)
  values ('00000000-0000-4000-8000-0000000002b2', '00000000-0000-4000-8000-0000000000e1', 'private-media',
          'events/00000000-0000-4000-8000-0000000000e1/00000000-0000-4000-8000-0000000002b2/original.jpg', 'image', 'image/jpeg')$$,
  '42501', null, 'customer cannot insert media');
select public.set_publication_consent('00000000-0000-4000-8000-0000000000e2', 'revoked');
select throws_ok($$select * from public.claim_storage_cleanup(10)$$, '42501', null, 'customer cannot claim cleanup');
select throws_ok($$select public.complete_storage_cleanup(array[gen_random_uuid()])$$, '42501', null, 'customer cannot complete cleanup');
reset role;
select is((select count(*)::int from private.storage_cleanup_queue where bucket = 'public-media' and done_at is null), 2,
  'revoking consent enqueues public object + variants');

-- staff cannot claim
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select * from public.claim_storage_cleanup(10)$$, '42501', null, 'staff cannot claim cleanup');
reset role;

-- admin claims and completes
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select public.complete_storage_cleanup(array_agg(id)) from public.claim_storage_cleanup(10)), 2, 'admin claims and completes cleanup');
reset role;

-- event delete enqueues private objects
insert into public.media_assets (event_id, bucket, path, kind, mime, variants)
values ('00000000-0000-4000-8000-0000000000e4', 'private-media',
        'events/00000000-0000-4000-8000-0000000000e4/x/original.jpg', 'image', 'image/jpeg',
        '{"thumb":"events/00000000-0000-4000-8000-0000000000e4/x/thumb.webp","display":"events/00000000-0000-4000-8000-0000000000e4/x/display.webp"}');
delete from public.events where id = '00000000-0000-4000-8000-0000000000e4';
select is((select count(*)::int from private.storage_cleanup_queue
           where bucket = 'private-media' and reason = 'event_deleted:00000000-0000-4000-8000-0000000000e4'), 3,
  'event delete enqueues private objects (original + variants)');

select * from finish();
rollback;
