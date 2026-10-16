-- showcase_videos: public read surface, admin-only writes, promo uniqueness, input constraints;
-- business_settings youtube_url / whatsapp_url.
begin;
select plan(33);

update public.app_settings set require_staff_mfa = true where id = 1;

-- ---- fixtures (postgres); start from an empty table (imported content is rolled back with the test)
delete from public.showcase_videos;
insert into public.showcase_videos (id, youtube_id, source_url, original_title, title, category, is_promo, is_published, verification_notes)
values
  ('00000000-0000-4000-8000-0000000008a1', 'AAAAAAAAAA1', 'https://www.youtube.com/watch?v=AAAAAAAAAA1', 'Groom Name Original', 'فيديو منشور', 'wedding', true, true, 'internal note'),
  ('00000000-0000-4000-8000-0000000008a2', 'AAAAAAAAAA2', 'https://www.youtube.com/watch?v=AAAAAAAAAA2', null, 'فيديو مخفي', 'evening', false, false, null);

-- ---- constraints (postgres)
select throws_ok($$insert into public.showcase_videos (youtube_id, source_url, title, category, is_promo)
  values ('AAAAAAAAAA3', 'https://youtu.be/AAAAAAAAAA3', 'برومو ثاني', 'other', true)$$,
  '23505', null, 'a second promo is rejected');
select throws_ok($$insert into public.showcase_videos (youtube_id, source_url, title, category)
  values ('bad id!', 'https://youtu.be/x', 'عنوان', 'other')$$,
  '23514', null, 'malformed youtube_id rejected');
select throws_ok($$insert into public.showcase_videos (youtube_id, source_url, title, category)
  values ('<iframe src=', 'https://youtu.be/x', 'عنوان', 'other')$$,
  '23514', null, 'HTML in youtube_id rejected');
select throws_ok($$insert into public.showcase_videos (youtube_id, source_url, title, category)
  values ('AAAAAAAAAA4', 'https://evil.example/watch?v=AAAAAAAAAA4', 'عنوان', 'other')$$,
  '23514', null, 'non-YouTube source_url rejected');
select throws_ok($$insert into public.showcase_videos (youtube_id, source_url, title, category)
  values ('AAAAAAAAAA4', 'http://www.youtube.com/watch?v=AAAAAAAAAA4', 'عنوان', 'other')$$,
  '23514', null, 'non-https source_url rejected');
select throws_ok($$insert into public.showcase_videos (youtube_id, source_url, title, category)
  values ('AAAAAAAAAA4', 'https://www.youtube.com/watch?v=AAAAAAAAAA4', 'عنوان', 'cats')$$,
  '23514', null, 'unknown category rejected');
select throws_ok($$insert into public.showcase_videos (youtube_id, source_url, title, category)
  values ('AAAAAAAAAA4', 'https://www.youtube.com/watch?v=AAAAAAAAAA4', 'ع', 'other')$$,
  '23514', null, 'too-short title rejected');
select throws_ok($$insert into public.showcase_videos (youtube_id, source_url, title, category)
  values ('AAAAAAAAAA1', 'https://www.youtube.com/watch?v=AAAAAAAAAA1', 'مكرر', 'other')$$,
  '23505', null, 'duplicate youtube_id rejected');
select throws_ok($$update public.business_settings set youtube_url = 'https://evil.example/channel/x' where id = 1$$,
  '23514', null, 'business_settings.youtube_url must be a YouTube https URL');
select throws_ok($$update public.business_settings set whatsapp_url = 'https://wa.evil.example/x' where id = 1$$,
  '23514', null, 'business_settings.whatsapp_url must be wa.me / api.whatsapp.com');
select throws_ok($$update public.business_settings set whatsapp_url = 'javascript:alert(1)' where id = 1$$,
  '23514', null, 'business_settings.whatsapp_url rejects javascript:');
update public.business_settings
   set youtube_url = 'https://www.youtube.com/channel/UCpxtdVABBIOaNLne-0_dDmQ/videos',
       whatsapp_url = 'https://wa.me/message/I4OXKEUV7DX6L1'
 where id = 1;

-- ---- anon
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select results_eq($$select youtube_id from public.showcase_videos order by youtube_id$$,
  array['AAAAAAAAAA1'], 'anon sees only published videos');
select ok(not has_column_privilege('anon', 'public.showcase_videos', 'original_title', 'select'), 'anon cannot select original_title');
select ok(not has_column_privilege('anon', 'public.showcase_videos', 'verification_notes', 'select'), 'anon cannot select verification_notes');
select throws_ok($$select original_title from public.showcase_videos$$, '42501', null, 'anon query on original_title denied');
select throws_ok($$select * from public.showcase_video_admin_details$$, '42501', null, 'anon cannot read admin details view');
select throws_ok($$insert into public.showcase_videos (youtube_id, source_url, title, category)
  values ('AAAAAAAAAA5', 'https://youtu.be/AAAAAAAAAA5', 'عنوان', 'other')$$, '42501', null, 'anon cannot insert');
select throws_ok($$update public.showcase_videos set title = 'x x' $$, '42501', null, 'anon cannot update');
select results_eq($$select youtube_url, whatsapp_url from public.business_settings where id = 1$$,
  $$values ('https://www.youtube.com/channel/UCpxtdVABBIOaNLne-0_dDmQ/videos'::text, 'https://wa.me/message/I4OXKEUV7DX6L1'::text)$$,
  'anon reads business_settings youtube_url / whatsapp_url');

-- ---- customer (aal1)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from public.showcase_videos), 1, 'customer sees only published videos');
select is((select count(*)::int from public.showcase_video_admin_details), 0, 'customer sees no admin details');
select throws_ok($$select verification_notes from public.showcase_videos$$, '42501', null, 'customer cannot select verification_notes');
select throws_ok($$insert into public.showcase_videos (youtube_id, source_url, title, category)
  values ('AAAAAAAAAA5', 'https://youtu.be/AAAAAAAAAA5', 'عنوان', 'other')$$, '42501', null, 'customer cannot insert (RLS)');
update public.showcase_videos set title = 'تعديل من عميل' where id = '00000000-0000-4000-8000-0000000008a1';
select throws_ok($$select public.set_showcase_promo('00000000-0000-4000-8000-0000000008a2')$$, '42501', null, 'customer cannot switch promo');

-- ---- staff (aal2)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$insert into public.showcase_videos (youtube_id, source_url, title, category)
  values ('AAAAAAAAAA5', 'https://youtu.be/AAAAAAAAAA5', 'عنوان', 'other')$$, '42501', null, 'staff cannot insert (RLS)');
delete from public.showcase_videos;
update public.showcase_videos set title = 'تعديل من طاقم';

-- ---- admin aal1 (MFA required) cannot write
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal1"}', true);
select throws_ok($$insert into public.showcase_videos (youtube_id, source_url, title, category)
  values ('AAAAAAAAAA5', 'https://youtu.be/AAAAAAAAAA5', 'عنوان', 'other')$$, '42501', null, 'admin without aal2 cannot insert');

-- ---- admin aal2
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select lives_ok($$insert into public.showcase_videos (youtube_id, source_url, title, category)
  values ('AAAAAAAAAA5', 'https://youtu.be/AAAAAAAAAA5', 'فيديو جديد', 'dj')$$, 'admin aal2 can insert');
select is((select count(*)::int from public.showcase_video_admin_details), 3, 'admin reads admin details for all rows');
select lives_ok($$select public.set_showcase_promo((select id from public.showcase_videos where youtube_id = 'AAAAAAAAAA5'))$$, 'admin switches promo');
select results_eq($$select youtube_id from public.showcase_videos where is_promo$$, array['AAAAAAAAAA5'],
  'promo moved atomically (exactly one promo)');
select lives_ok($$delete from public.showcase_videos where id = '00000000-0000-4000-8000-0000000008a2'$$, 'admin aal2 can delete');

reset role;
select ok(has_table_privilege('service_role', 'public.showcase_videos', 'select, insert, update, delete'),
  'service_role has full table privileges (import script / server jobs)');
select is((select title from public.showcase_videos where id = '00000000-0000-4000-8000-0000000008a1'), 'فيديو منشور',
  'customer/staff updates and deletes affected nothing');

select * from finish();
rollback;
