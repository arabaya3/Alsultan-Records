-- 0032 Album storage provider: rows default to Supabase, the columns stay private, the public ref obeys publication,
-- and each cleanup worker only ever claims its own store's items.
-- Users (LOCAL DEV seed): owner a1, admin a2, customer b1.
begin;
select plan(19);

insert into public.photo_albums (id, slug, title, is_published) values
  ('00000000-0000-4000-8000-00000000ba01', 'pgtap-s3-album', 'pgTAP S3', true);
insert into public.album_photos (id, album_id, storage_path_original, mime, bytes, upload_status, storage_provider, is_published, variants) values
  ('00000000-0000-4000-8000-00000000bb01', '00000000-0000-4000-8000-00000000ba01', 'albums/00000000-0000-4000-8000-00000000ba01/00000000-0000-4000-8000-00000000bb01/original.jpg', 'image/jpeg', 10, 'ready', 's3', true, '{"thumb":"albums/00000000-0000-4000-8000-00000000ba01/00000000-0000-4000-8000-00000000bb01/thumb.webp","display":"albums/00000000-0000-4000-8000-00000000ba01/00000000-0000-4000-8000-00000000bb01/display.webp"}'),
  ('00000000-0000-4000-8000-00000000bb02', '00000000-0000-4000-8000-00000000ba01', 'albums/00000000-0000-4000-8000-00000000ba01/00000000-0000-4000-8000-00000000bb02/original.jpg', 'image/jpeg', 10, 'uploading', 's3', false, '{}');
insert into public.album_photos (id, album_id, storage_path_original, mime, bytes, upload_status) values
  ('00000000-0000-4000-8000-00000000bb03', '00000000-0000-4000-8000-00000000ba01', 'albums/00000000-0000-4000-8000-00000000ba01/00000000-0000-4000-8000-00000000bb03/original.jpg', 'image/jpeg', 10, 'uploading');

select is((select storage_provider from public.album_photos where id = '00000000-0000-4000-8000-00000000bb03'), 'supabase', 'a row names no store: it stays on Supabase');
select throws_ok($$update public.album_photos set storage_provider = 'gcs' where id = '00000000-0000-4000-8000-00000000bb03'$$, '23514', null, 'unknown store refused');

-- anonymous: columns unreadable, ref only while published
set local role anon;
select throws_ok($$select storage_provider from public.album_photos$$, '42501', null, 'anon cannot read storage_provider');
select throws_ok($$select s3_upload_id from public.album_photos$$, '42501', null, 'anon cannot read s3_upload_id');
select is((select provider from public.album_photo_object_ref('00000000-0000-4000-8000-00000000bb01', 'thumb')), 's3', 'published: store returned');
select ok((select path is null from public.album_photo_object_ref('00000000-0000-4000-8000-00000000bb01', 'display')) is false, 'display path returned');
select is((select count(*)::int from public.album_photo_object_ref('00000000-0000-4000-8000-00000000bb01', 'original')), 0, 'the original is never returned');
select throws_ok($$select public.album_s3_upload_set('00000000-0000-4000-8000-00000000bb02', 'x')$$, '42501', null, 'anon cannot set an upload id');
select throws_ok($$select * from public.claim_s3_cleanup(1)$$, '42501', null, 'anon cannot claim S3 cleanup');
reset role;

update public.album_photos set is_published = false where id = '00000000-0000-4000-8000-00000000bb01';
set local role anon;
select is((select count(*)::int from public.album_photo_object_ref('00000000-0000-4000-8000-00000000bb01', 'thumb')), 0, 'withdrawn photo: nothing returned');
reset role;

-- customer: no upload id
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select throws_ok($$select public.album_s3_upload_set('00000000-0000-4000-8000-00000000bb02', 'x')$$, '42501', null, 'a customer cannot set an upload id');
reset role;

-- admin: first upload wins, only on an open S3 reservation
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select is(public.album_s3_upload_set('00000000-0000-4000-8000-00000000bb02', 'first'), 'first', 'first upload recorded');
select is(public.album_s3_upload_set('00000000-0000-4000-8000-00000000bb02', 'second'), 'first', 'a second tab gets the first upload');
select is(public.album_s3_upload_set('00000000-0000-4000-8000-00000000bb02', 'third', 'first'), 'third', 'an expired upload can be replaced by naming it');
select is(public.album_s3_upload_set('00000000-0000-4000-8000-00000000bb03', 'x'), null, 'not an S3 reservation: nothing recorded');
reset role;

-- deleting enqueues on the photo's own store; each worker claims only its own
delete from private.storage_cleanup_queue;
delete from public.album_photos where id in ('00000000-0000-4000-8000-00000000bb01', '00000000-0000-4000-8000-00000000bb03');
select is((select count(*)::int from private.storage_cleanup_queue where provider = 's3'), 3, 'S3 photo: original and both variants queued for S3');
select is((select count(*)::int from private.storage_cleanup_queue where provider = 'supabase'), 1, 'Supabase photo queued for Supabase');
set local role service_role;
select is((select count(*)::int from public.claim_storage_cleanup(100)), 1, 'the Edge Function worker never claims an S3 item');
select is((select count(*)::int from public.claim_s3_cleanup(100)), 3, 'the app worker claims the S3 items');
reset role;

select * from finish();
rollback;
