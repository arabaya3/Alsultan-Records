-- 0015: video categories + links, photo albums + photos, album-media storage policy.
begin;
select plan(44);

update public.app_settings set require_staff_mfa = true where id = 1;

-- ---- fixtures (postgres)
delete from public.showcase_videos;
insert into public.showcase_videos (id, youtube_id, source_url, title, is_published, review_note, youtube_title)
values
  ('00000000-0000-4000-8000-0000000009a1', 'BBBBBBBBBB1', 'https://www.youtube.com/watch?v=BBBBBBBBBB1', 'حفل العريس فلان', true, 'internal', 'حفل العريس فلان'),
  ('00000000-0000-4000-8000-0000000009a2', 'BBBBBBBBBB2', 'https://www.youtube.com/watch?v=BBBBBBBBBB2', 'مخفي', false, null, null);
insert into public.video_categories (id, slug, title, is_published) values
  ('00000000-0000-4000-8000-0000000009c1', 'weddings', 'أعراس', true),
  ('00000000-0000-4000-8000-0000000009c2', 'hidden_cat', 'مخفي', false);
insert into public.showcase_video_categories (video_id, category_id, is_primary) values
  ('00000000-0000-4000-8000-0000000009a1', '00000000-0000-4000-8000-0000000009c1', true),
  ('00000000-0000-4000-8000-0000000009a1', '00000000-0000-4000-8000-0000000009c2', false),
  ('00000000-0000-4000-8000-0000000009a2', '00000000-0000-4000-8000-0000000009c1', true);

insert into public.photo_albums (id, slug, title, is_published, rights_note) values
  ('00000000-0000-4000-8000-0000000009b1', 'pub-album', 'ألبوم منشور', true, 'rights'),
  ('00000000-0000-4000-8000-0000000009b2', 'hidden-album', 'ألبوم مخفي', false, null);
insert into public.album_photos (id, album_id, storage_path_original, variants, mime, is_published, upload_status) values
  ('00000000-0000-4000-8000-0000000009d1', '00000000-0000-4000-8000-0000000009b1',
   'albums/00000000-0000-4000-8000-0000000009b1/00000000-0000-4000-8000-0000000009d1/original.jpg',
   '{"thumb":"albums/00000000-0000-4000-8000-0000000009b1/00000000-0000-4000-8000-0000000009d1/thumb.webp"}', 'image/jpeg', true, 'ready'),
  ('00000000-0000-4000-8000-0000000009d2', '00000000-0000-4000-8000-0000000009b1',
   'albums/00000000-0000-4000-8000-0000000009b1/00000000-0000-4000-8000-0000000009d2/original.jpg', '{}', 'image/jpeg', false, 'ready'),
  ('00000000-0000-4000-8000-0000000009d3', '00000000-0000-4000-8000-0000000009b2',
   'albums/00000000-0000-4000-8000-0000000009b2/00000000-0000-4000-8000-0000000009d3/original.jpg', '{}', 'image/jpeg', true, 'ready');
update public.photo_albums set cover_photo_id = '00000000-0000-4000-8000-0000000009d1' where id = '00000000-0000-4000-8000-0000000009b1';
insert into storage.objects (bucket_id, name) values
  ('album-media', 'albums/00000000-0000-4000-8000-0000000009b1/00000000-0000-4000-8000-0000000009d1/original.jpg'),
  ('album-media', 'albums/00000000-0000-4000-8000-0000000009b1/00000000-0000-4000-8000-0000000009d1/thumb.webp'),
  ('album-media', 'albums/00000000-0000-4000-8000-0000000009b1/00000000-0000-4000-8000-0000000009d2/original.jpg'),
  ('album-media', 'albums/00000000-0000-4000-8000-0000000009b2/00000000-0000-4000-8000-0000000009d3/original.jpg');

-- ---- constraints (postgres)
select throws_ok($$insert into public.showcase_video_categories (video_id, category_id, is_primary)
  values ('00000000-0000-4000-8000-0000000009a2', '00000000-0000-4000-8000-0000000009c2', true)$$,
  '23505', null, 'at most one primary category per video');
select throws_ok($$insert into public.video_categories (slug, title) values ('Bad-Slug', 'عنوان')$$, '23514', null, 'category slug format enforced');
select throws_ok($$insert into public.photo_albums (slug, title, source_url) values ('x-album', 'عنوان', 'javascript:alert(1)')$$,
  '23514', null, 'album source_url must be https');
select throws_ok($$insert into public.album_photos (album_id, storage_path_original, mime)
  values ('00000000-0000-4000-8000-0000000009b1', 'elsewhere/original.jpg', 'image/jpeg')$$, '23514', null, 'photo path must follow albums/{album}/{photo}/original.ext');
select throws_ok($$insert into public.album_photos (id, album_id, storage_path_original, mime)
  values ('00000000-0000-4000-8000-0000000009d9', '00000000-0000-4000-8000-0000000009b1',
          'albums/00000000-0000-4000-8000-0000000009b1/00000000-0000-4000-8000-0000000009d9/original.gif', 'image/gif')$$,
  '23514', null, 'gif rejected');
select throws_ok($$update public.photo_albums set cover_photo_id = '00000000-0000-4000-8000-0000000009d3'
  where id = '00000000-0000-4000-8000-0000000009b1'; set constraints all immediate$$, '23514', null, 'cover must belong to the album');
select is((select public from storage.buckets where id = 'album-media'), false, 'album-media bucket is private');

-- ---- anon
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select results_eq($$select slug from public.video_categories order by slug$$, array['weddings'], 'anon sees only published categories');
select results_eq($$select video_id::text || '/' || category_id::text from public.showcase_video_categories$$,
  array['00000000-0000-4000-8000-0000000009a1/00000000-0000-4000-8000-0000000009c1'],
  'anon sees links only when video and category are published');
select results_eq($$select slug from public.photo_albums order by slug$$, array['pub-album'], 'anon sees only published albums');
select results_eq($$select id::text from public.album_photos order by id$$, array['00000000-0000-4000-8000-0000000009d1'],
  'anon sees only published photos of published albums');
select throws_ok($$select rights_note from public.photo_albums$$, '42501', null, 'anon cannot read rights_note');
select throws_ok($$select storage_path_original from public.album_photos$$, '42501', null, 'anon cannot read storage paths');
select throws_ok($$select needs_review from public.showcase_videos$$, '42501', null, 'anon cannot read needs_review');
select throws_ok($$select review_note, youtube_title, youtube_description from public.showcase_videos$$, '42501', null, 'anon cannot read youtube_* / review_note');
select lives_ok($$select id, slug, title, description, event_date, source_label, source_url, cover_photo_id, sort_order from public.photo_albums$$,
  'anon reads the public album columns');
select lives_ok($$select id, album_id, width, height, alt_text, sort_order from public.album_photos$$, 'anon reads the public photo columns');
select results_eq($$select name from storage.objects where bucket_id = 'album-media' order by name$$,
  array['albums/00000000-0000-4000-8000-0000000009b1/00000000-0000-4000-8000-0000000009d1/original.jpg',
        'albums/00000000-0000-4000-8000-0000000009b1/00000000-0000-4000-8000-0000000009d1/thumb.webp'],
  'anon storage read only for published photo paths (original + variants)');
select is(public.album_photo_object_path('00000000-0000-4000-8000-0000000009d1', 'thumb'),
  'albums/00000000-0000-4000-8000-0000000009b1/00000000-0000-4000-8000-0000000009d1/thumb.webp', 'path helper returns published variant');
select is(public.album_photo_object_path('00000000-0000-4000-8000-0000000009d3', 'original'), null, 'path helper hides photos of hidden albums');
select throws_ok($$insert into public.video_categories (slug, title) values ('anon_cat', 'عنوان')$$, '42501', null, 'anon cannot insert categories');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('album-media', 'albums/x/y/original.jpg')$$, '42501', null, 'anon cannot upload');

-- ---- customer (aal1)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from public.photo_albums), 0, 'customer sees no album rows (public site reads with anon)');
select throws_ok($$insert into public.photo_albums (slug, title) values ('cust-album', 'عنوان')$$, '42501', null, 'customer cannot insert albums');
update public.video_categories set title = 'تعديل عميل';
select is((select count(*)::int from storage.objects where bucket_id = 'album-media'), 2, 'customer storage read = published only');

-- ---- staff (aal2)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$insert into public.video_categories (slug, title) values ('staff_cat', 'عنوان')$$, '42501', null, 'staff cannot insert categories');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('album-media', 'albums/x/y/original.jpg')$$, '42501', null, 'staff cannot upload');
delete from public.album_photos;
delete from public.showcase_video_categories;

-- ---- admin aal1 (MFA required)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal1"}', true);
select throws_ok($$insert into public.photo_albums (slug, title) values ('aal1-album', 'عنوان')$$, '42501', null, 'admin aal1 cannot insert albums');

-- ---- admin aal2
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select lives_ok($$insert into public.video_categories (slug, title) values ('new_cat', 'جديد')$$, 'admin inserts category');
select lives_ok($$update public.video_categories set sort_order = 5, is_published = false where slug = 'new_cat'$$, 'admin updates category');
select lives_ok($$insert into public.showcase_video_categories (video_id, category_id)
  values ('00000000-0000-4000-8000-0000000009a2', (select id from public.video_categories where slug = 'new_cat'))$$, 'admin links video');
select is((select count(*)::int from public.showcase_video_categories), 4, 'admin sees every link');
select lives_ok($$insert into public.photo_albums (slug, title) values ('new-album', 'ألبوم جديد')$$, 'admin inserts album');
select is((select updated_by::text from public.photo_albums where slug = 'new-album'), '00000000-0000-4000-8000-0000000000a2', 'updated_by stamped');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('album-media', 'albums/a/b/original.jpg')$$, 'admin uploads to album-media');
select is((select count(*)::int from storage.objects where bucket_id = 'album-media'), 5, 'admin reads every album object');
select lives_ok($$update public.showcase_videos set needs_review = true, review_note = 'check' where id = '00000000-0000-4000-8000-0000000009a1'$$,
  'admin sets needs_review');
select isnt((select reviewed_at from public.showcase_video_admin_details where video_id = '00000000-0000-4000-8000-0000000009a1'), null,
  'changing needs_review stamps reviewed_at');
select lives_ok($$update public.album_photos set is_published = false where id = '00000000-0000-4000-8000-0000000009d1'$$, 'admin hides photo');
select lives_ok($$delete from public.photo_albums where id = '00000000-0000-4000-8000-0000000009b2'$$, 'admin deletes album');

reset role;
select is((select count(*)::int from public.album_photos where album_id = '00000000-0000-4000-8000-0000000009b2'), 0, 'album delete cascades photos');
select ok(exists (select 1 from private.storage_cleanup_queue where bucket = 'album-media'
  and path like 'albums/00000000-0000-4000-8000-0000000009b2/%'), 'deleted photos enqueue storage cleanup');
select is((select count(*)::int from public.album_photos), 2, 'staff deletes affected nothing');
select ok(has_table_privilege('service_role', 'public.video_categories', 'select, insert, update, delete')
  and has_table_privilege('service_role', 'public.showcase_video_categories', 'select, insert, update, delete')
  and has_table_privilege('service_role', 'public.photo_albums', 'select, insert, update, delete')
  and has_table_privilege('service_role', 'public.album_photos', 'select, insert, update, delete'),
  'service_role has full privileges on the new tables');

select * from finish();
rollback;
