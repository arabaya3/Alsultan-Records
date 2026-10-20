-- 0025 Album upload v2: «uploading» state never claimed, fair queue + retry backoff, upload permission scoped to a
-- reservation, processing columns not writable by admins, admin-only state RPCs.
-- Users (LOCAL DEV seed): owner a1, admin a2, customer b1.
begin;
select plan(22);

insert into public.photo_albums (id, slug, title, is_published) values
  ('00000000-0000-4000-8000-00000000aa01', 'pgtap-upload-v2', 'pgTAP upload v2', false);
insert into public.album_photos (id, album_id, storage_path_original, mime, bytes, sha256, upload_status, created_at) values
  ('00000000-0000-4000-8000-00000000ab01', '00000000-0000-4000-8000-00000000aa01', 'albums/00000000-0000-4000-8000-00000000aa01/00000000-0000-4000-8000-00000000ab01/original.cr3', 'image/x-canon-cr3', 1000, repeat('a', 64), 'uploading', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-00000000ab02', '00000000-0000-4000-8000-00000000aa01', 'albums/00000000-0000-4000-8000-00000000aa01/00000000-0000-4000-8000-00000000ab02/original.jpg', 'image/jpeg', 1000, repeat('b', 64), 'pending', now()),
  ('00000000-0000-4000-8000-00000000ab03', '00000000-0000-4000-8000-00000000aa01', 'albums/00000000-0000-4000-8000-00000000aa01/00000000-0000-4000-8000-00000000ab03/original.nef', 'image/x-nikon-nef', 1000, repeat('c', 64), 'failed', now() - interval '2 hours');
update public.album_photos set attempts = 1, last_error = 'variant upload failed' where id = '00000000-0000-4000-8000-00000000ab03';

-- formats / paths
select lives_ok($$insert into public.album_photos (id, album_id, storage_path_original, mime, upload_status) values ('00000000-0000-4000-8000-00000000ab04', '00000000-0000-4000-8000-00000000aa01', 'albums/00000000-0000-4000-8000-00000000aa01/00000000-0000-4000-8000-00000000ab04/original.raf', 'image/x-fuji-raf', 'uploading')$$, 'RAW mime + path accepted');
select throws_ok($$insert into public.album_photos (id, album_id, storage_path_original, mime, upload_status) values ('00000000-0000-4000-8000-00000000ab05', '00000000-0000-4000-8000-00000000aa01', 'albums/00000000-0000-4000-8000-00000000aa01/00000000-0000-4000-8000-00000000ab05/original.exe', 'image/jpeg', 'uploading')$$, '23514', null, 'unknown extension rejected');
select is((select file_size_limit from storage.buckets where id = 'album-media'), 52428800::bigint, 'bucket limit = 50 MB (project cap)');
select ok((select 'image/x-sony-arw' = any(allowed_mime_types) from storage.buckets where id = 'album-media'), 'bucket accepts RAW types');

-- queue
select ok(not app.photo_job_claimable((select p from public.album_photos p where id = '00000000-0000-4000-8000-00000000ab01')), 'uploading is never claimed (even after an hour)');
select ok(app.photo_job_claimable((select p from public.album_photos p where id = '00000000-0000-4000-8000-00000000ab02')), 'pending (upload confirmed) is claimed at once');
update public.album_photos set updated_at = now() where id = '00000000-0000-4000-8000-00000000ab03';
select ok(not app.photo_job_claimable((select p from public.album_photos p where id = '00000000-0000-4000-8000-00000000ab03')), 'a just-failed photo waits (backoff)');
update public.album_photos set last_error = 'requeued by admin' where id = '00000000-0000-4000-8000-00000000ab03';
select ok(app.photo_job_claimable((select p from public.album_photos p where id = '00000000-0000-4000-8000-00000000ab03')), 'admin requeue is immediate');
-- the oldest photo (failed+requeued, 2 h) comes AFTER a fresh pending one
set local role service_role;
select is((select id from public.claim_photo_jobs(1)), '00000000-0000-4000-8000-00000000ab02'::uuid, 'fresh pending work is claimed before retries');
reset role;

-- admin (a2): processing columns are not writable; inserts must start uploading
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$update public.album_photos set upload_status = 'ready' where id = '00000000-0000-4000-8000-00000000ab01'$$, '42501', null, 'admin cannot set upload_status directly');
select throws_ok($$update public.album_photos set variants = '{"thumb":"x"}' where id = '00000000-0000-4000-8000-00000000ab01'$$, '42501', null, 'admin cannot write variants');
select throws_ok($$insert into public.album_photos (id, album_id, storage_path_original, mime, upload_status) values ('00000000-0000-4000-8000-00000000ab06', '00000000-0000-4000-8000-00000000aa01', 'albums/00000000-0000-4000-8000-00000000aa01/00000000-0000-4000-8000-00000000ab06/original.jpg', 'image/jpeg', 'ready')$$, '42501', null, 'admin cannot insert a «ready» photo');
select lives_ok($$update public.album_photos set alt_text = 'نص بديل' where id = '00000000-0000-4000-8000-00000000ab01'$$, 'admin still edits editorial fields');

-- storage: upload only at a reserved `uploading` path
select lives_ok($$insert into storage.objects (bucket_id, name) values ('album-media', 'albums/00000000-0000-4000-8000-00000000aa01/00000000-0000-4000-8000-00000000ab01/original.cr3')$$, 'admin may upload at a reserved uploading path');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('album-media', 'albums/00000000-0000-4000-8000-00000000aa01/00000000-0000-4000-8000-00000000ab02/original.jpg')$$, '42501', null, 'not at a path that is no longer uploading');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('album-media', 'albums/00000000-0000-4000-8000-00000000aa01/anything/evil.jpg')$$, '42501', null, 'not at an unreserved path');

-- state RPCs
select is(public.album_upload_complete('00000000-0000-4000-8000-00000000ab01'), true, 'complete: uploading → pending');
select is(public.album_upload_complete('00000000-0000-4000-8000-00000000ab01'), false, 'complete is idempotent (second call is a no-op)');
select is(public.album_upload_reopen('00000000-0000-4000-8000-00000000ab03', 2000), true, 'reopen: failed → uploading');
reset role;
select is((select upload_status || ':' || attempts || ':' || bytes from public.album_photos where id = '00000000-0000-4000-8000-00000000ab03'), 'uploading:0:2000', 'reopen resets attempts and size');

-- customer / anon
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.album_upload_complete('00000000-0000-4000-8000-00000000ab02')$$, '42501', null, 'customer cannot complete uploads');
reset role;
select ok(not has_function_privilege('anon', 'public.album_upload_reopen(uuid, bigint)', 'execute'), 'anon cannot call the upload RPCs');

select * from finish();
rollback;
