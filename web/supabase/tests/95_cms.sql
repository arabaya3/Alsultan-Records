-- 0017/0018 CMS: offers/announcements windows (Asia/Hebron), drafts invisible, nav/sections,
-- slug redirects, soft delete + purge, dedupe, processing queue, grants, audit.
-- Dates are relative to app.hebron_today(), so the boundaries hold on any run date.
-- Users (LOCAL DEV seed): admin a2 (aal2), customer b1.
begin;
select plan(71);

update public.app_settings set require_staff_mfa = true where id = 1;

-- ------------------------------------------------------------------ fixtures (postgres)
insert into public.offers (id, slug, title, status, starts_on, ends_on, price_minor, show_price) values
  ('00000000-0000-4000-8000-0000000c0f01', 'active-offer',  'عرض فعال',   'published', app.hebron_today() - 3, app.hebron_today(),     150000, true),
  ('00000000-0000-4000-8000-0000000c0f02', 'expired-offer', 'عرض منتهي',  'published', app.hebron_today() - 9, app.hebron_today() - 1, null, false),
  ('00000000-0000-4000-8000-0000000c0f03', 'future-offer',  'عرض قادم',   'published', app.hebron_today() + 1, null,                    null, false),
  ('00000000-0000-4000-8000-0000000c0f04', 'draft-offer',   'مسودة عرض',  'draft',     null, null,                                      null, false),
  ('00000000-0000-4000-8000-0000000c0f05', 'archived-offer','عرض مؤرشف',  'archived',  null, null,                                      null, false),
  ('00000000-0000-4000-8000-0000000c0f06', 'open-offer',    'عرض مفتوح',  'published', app.hebron_today(), null,                       99000, false);
insert into public.offer_items (offer_id, label) values
  ('00000000-0000-4000-8000-0000000c0f01', 'بند فعال'),
  ('00000000-0000-4000-8000-0000000c0f04', 'بند مسودة');
insert into public.announcements (id, text, is_visible, starts_on, ends_on) values
  ('00000000-0000-4000-8000-0000000ca001', 'إعلان فعال', true, app.hebron_today(), app.hebron_today()),
  ('00000000-0000-4000-8000-0000000ca002', 'إعلان مخفي', false, null, null),
  ('00000000-0000-4000-8000-0000000ca003', 'إعلان منتهي', true, null, app.hebron_today() - 1);

insert into public.photo_albums (id, slug, title, is_published) values
  ('00000000-0000-4000-8000-0000000cab01', 'cms-live-album', 'ألبوم حي', true),
  ('00000000-0000-4000-8000-0000000cab02', 'cms-trash-album', 'ألبوم محذوف', true),
  ('00000000-0000-4000-8000-0000000cab03', 'cms-arch-album', 'ألبوم مؤرشف', true);
insert into public.album_photos (id, album_id, storage_path_original, variants, mime, upload_status, is_published, sha256)
select ('00000000-0000-4000-8000-0000000cad0' || n)::uuid, a::uuid,
       'albums/' || a || '/00000000-0000-4000-8000-0000000cad0' || n || '/original.jpg',
       jsonb_build_object('thumb', 'albums/' || a || '/00000000-0000-4000-8000-0000000cad0' || n || '/thumb.webp',
                          'display', 'albums/' || a || '/00000000-0000-4000-8000-0000000cad0' || n || '/display.webp'),
       'image/jpeg', 'ready', true, repeat(n::text, 64)
from (values (1, '00000000-0000-4000-8000-0000000cab01'),
             (2, '00000000-0000-4000-8000-0000000cab02'),
             (3, '00000000-0000-4000-8000-0000000cab03')) v(n, a);
update public.photo_albums set deleted_at = now() where id = '00000000-0000-4000-8000-0000000cab02';
update public.photo_albums set archived_at = now() where id = '00000000-0000-4000-8000-0000000cab03';
-- a soft-deleted photo inside a live album
insert into public.album_photos (id, album_id, storage_path_original, variants, mime, upload_status, is_published, deleted_at)
values ('00000000-0000-4000-8000-0000000cad09', '00000000-0000-4000-8000-0000000cab01',
        'albums/00000000-0000-4000-8000-0000000cab01/00000000-0000-4000-8000-0000000cad09/original.jpg',
        '{"thumb":"albums/00000000-0000-4000-8000-0000000cab01/00000000-0000-4000-8000-0000000cad09/thumb.webp"}',
        'image/jpeg', 'ready', true, now());

-- ------------------------------------------------------------------ seeds
select is((select count(*)::int from public.process_steps where is_published), 4, 'process_steps seeded with the 4 current steps');
select is((select title from public.process_steps order by sort_order limit 1), 'راسلنا على واتساب', 'first step verbatim');
select is((select string_agg(target, ',' order by sort_order) from public.nav_items where is_visible), 'work,services,about',
  'nav seeded with the current header');
select is((select string_agg(key, ',' order by sort_order) from public.site_sections where is_visible), 'works,services,process',
  'visible home sections match today''s homepage');

-- ------------------------------------------------------------------ anon
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is((select string_agg(slug, ',' order by slug) from public.offers), 'active-offer,open-offer',
  'anon sees only active offers (today inclusive end, today start)');
select is((select count(*)::int from public.offers where slug = 'expired-offer'), 0, 'offer that ended yesterday is hidden automatically');
select is((select count(*)::int from public.offers where slug = 'future-offer'), 0, 'offer starting tomorrow is hidden');
select is((select count(*)::int from public.offers where slug in ('draft-offer', 'archived-offer')), 0, 'draft/archived offers invisible');
select is((select display_price_minor from public.offers where slug = 'active-offer'), 150000::bigint, 'shown price visible');
select is((select display_price_minor from public.offers where slug = 'open-offer'), null::bigint, 'hidden price not exposed');
select throws_ok($$select price_minor from public.offers$$, '42501', null, 'anon cannot select raw price_minor');
select throws_ok($$select status from public.offers$$, '42501', null, 'anon cannot select offers.status');
select is((select count(*)::int from public.offer_items), 1, 'anon sees items of active offers only');
select is((select string_agg(text, ',') from public.announcements), 'إعلان فعال', 'announcements: active only');
select is((select count(*)::int from public.nav_items), 6, 'anon reads nav items');
select is((select count(*)::int from public.site_sections), 8, 'anon reads home sections');
select throws_ok($$select updated_by from public.site_sections$$, '42501', null, 'site_sections.updated_by not anon-readable');
select is((select count(*)::int from public.process_steps), 4, 'anon reads published steps');
select is((select count(*)::int from public.photo_albums where id in ('00000000-0000-4000-8000-0000000cab02', '00000000-0000-4000-8000-0000000cab03')), 0,
  'trashed/archived albums invisible to anon');
select is((select count(*)::int from public.photo_albums where id = '00000000-0000-4000-8000-0000000cab01'), 1, 'live album visible (control)');
select is((select count(*)::int from public.album_photos where album_id in ('00000000-0000-4000-8000-0000000cab02', '00000000-0000-4000-8000-0000000cab03')), 0,
  'photos of trashed/archived albums invisible');
select is((select count(*)::int from public.album_photos where id = '00000000-0000-4000-8000-0000000cad09'), 0, 'soft-deleted photo invisible');
select is(public.album_photo_object_path('00000000-0000-4000-8000-0000000cad02', 'display'), null, 'trashed album: variant path not resolvable');
select is(public.album_photo_object_path('00000000-0000-4000-8000-0000000cad03', 'thumb'), null, 'archived album: variant path not resolvable');
select is(public.album_photo_object_path('00000000-0000-4000-8000-0000000cad09', 'thumb'), null, 'soft-deleted photo: path not resolvable');
select ok(public.album_photo_object_path('00000000-0000-4000-8000-0000000cad01', 'display') is not null, 'live photo variant resolvable (control)');
select is(public.album_photo_object_path('00000000-0000-4000-8000-0000000cad01', 'original'), null, 'originals still private');
select ok(not app.album_object_is_public('albums/00000000-0000-4000-8000-0000000cab02/00000000-0000-4000-8000-0000000cad02/thumb.webp'),
  'storage policy refuses variants of a trashed album');
select ok(not app.album_object_is_public('albums/00000000-0000-4000-8000-0000000cab01/00000000-0000-4000-8000-0000000cad01/original.jpg'),
  'storage policy refuses originals');
select throws_ok($$select deleted_at from public.photo_albums$$, '42501', null, 'anon cannot read deleted_at');
select throws_ok($$select sha256 from public.album_photos$$, '42501', null, 'anon cannot read sha256');
select throws_ok($$select * from public.import_items$$, '42501', null, 'import_items not anon-readable');
select throws_ok($$select * from public.brand_assets$$, '42501', null, 'brand_assets not anon-readable');
select throws_ok($$insert into public.nav_items (label, target) values ('x', 'faq')$$, '42501', null, 'anon cannot write nav_items');
select throws_ok($$select public.purge_album('00000000-0000-4000-8000-0000000cab02', 'cms-trash-album')$$, '42501', null, 'anon cannot purge');
select throws_ok($$select * from public.claim_photo_jobs(1)$$, '42501', null, 'anon cannot claim jobs');
reset role;

-- ------------------------------------------------------------------ non-admin (customer b1): writes denied on every new table
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*)::int from public.offers where slug = 'draft-offer'), 0, 'customer cannot see draft offers');
select throws_ok($$insert into public.offers (slug, title) values ('x-offer', 'عرض')$$, '42501', null, 'customer: offers insert denied');
select throws_ok($$insert into public.announcements (text) values ('x')$$, '42501', null, 'customer: announcements insert denied');
select throws_ok($$insert into public.process_steps (title) values ('x')$$, '42501', null, 'customer: process_steps insert denied');
select throws_ok($$insert into public.nav_items (label, target) values ('x', 'faq')$$, '42501', null, 'customer: nav_items insert denied');
select throws_ok($$insert into public.album_categories (slug, title) values ('xx', 'تصنيف')$$, '42501', null, 'customer: album_categories insert denied');
select throws_ok($$insert into public.import_items (source, source_ref) values ('zip', 'x')$$, '42501', null, 'customer: import_items insert denied');
select throws_ok($$insert into public.brand_assets (id, storage_path, mime) values ('00000000-0000-4000-8000-0000000cb001', 'brand/00000000-0000-4000-8000-0000000cb001/logo.png', 'image/png')$$,
  '42501', null, 'customer: brand_assets insert denied');
select throws_ok($$insert into public.offer_items (offer_id, label) values ('00000000-0000-4000-8000-0000000c0f01', 'x')$$, '42501', null, 'customer: offer_items insert denied');
select throws_ok($$insert into public.service_links (service_id, kind, target_id) values (gen_random_uuid(), 'album', '00000000-0000-4000-8000-0000000cab01')$$,
  '42501', null, 'customer: service_links insert denied');
update public.site_sections set title = 'hacked' where key = 'works';
update public.business_settings set hero_title = 'hacked' where id = 1;
select throws_ok($$select public.purge_album('00000000-0000-4000-8000-0000000cab02', 'cms-trash-album')$$, '42501', null, 'customer cannot purge');
select throws_ok($$select * from public.find_duplicate_photo(repeat('1', 64))$$, '42501', null, 'customer cannot run dedupe lookup');
select throws_ok($$select * from public.claim_photo_jobs(1)$$, '42501', null, 'authenticated cannot claim jobs');
reset role;
select isnt((select title from public.site_sections where key = 'works'), 'hacked', 'customer update on site_sections had no effect');
select is((select hero_title from public.business_settings where id = 1), null, 'customer update on business_settings had no effect');

-- ------------------------------------------------------------------ admin a2 (aal2)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*)::int from public.offers where id::text like '00000000-0000-4000-8000-0000000c0f0%'), 6, 'admin sees all offers');
update public.offers set slug = 'active-offer-renamed' where slug = 'active-offer';
update public.photo_albums set slug = 'cms-live-album-2' where id = '00000000-0000-4000-8000-0000000cab01';
select is((select to_path from public.slug_redirects where from_path = '/offers/active-offer'), '/offers/active-offer-renamed', 'offer slug change creates redirect');
select is((select to_path from public.slug_redirects where from_path = '/work/albums/cms-live-album'), '/work/albums/cms-live-album-2', 'album slug change creates redirect');
update public.offers set slug = 'active-offer-v3' where slug = 'active-offer-renamed';
select is((select to_path from public.slug_redirects where from_path = '/offers/active-offer'), '/offers/active-offer-v3', 'redirects stay flat (no chains)');
select is((select string_agg(album_title, ',') from public.find_duplicate_photo(repeat('1', 64))), 'ألبوم حي', 'dedupe lookup returns album title');
select throws_ok($$insert into public.album_photos (id, album_id, storage_path_original, mime, sha256)
  values ('00000000-0000-4000-8000-0000000cad08', '00000000-0000-4000-8000-0000000cab01',
          'albums/00000000-0000-4000-8000-0000000cab01/00000000-0000-4000-8000-0000000cad08/original.jpg', 'image/jpeg', repeat('1', 64))$$,
  '23505', null, 'duplicate sha256 in the same album rejected');
select throws_ok($$select public.purge_album('00000000-0000-4000-8000-0000000cab02', 'cms-trash')$$, '22023', null, 'purge requires the exact slug');
select throws_ok($$select public.purge_album('00000000-0000-4000-8000-0000000cab01', 'cms-live-album-2')$$, '55000', null, 'purge requires the album in trash');
select is(public.purge_album('00000000-0000-4000-8000-0000000cab02', 'cms-trash-album'), 1, 'admin purges a trashed album');
update public.business_settings set hero_title = 'عنوان جديد' where id = 1;
update public.nav_items set sort_order = 11 where target = 'work';
reset role;
select is((select count(*)::int from public.photo_albums where id = '00000000-0000-4000-8000-0000000cab02'), 0, 'purged album row gone');
select is((select count(*)::int from private.storage_cleanup_queue where reason = 'album_photo_deleted:00000000-0000-4000-8000-0000000cad02'), 3,
  'purge enqueued original + 2 variants for cleanup');
select is((select count(*)::int from public.audit_events where action = 'purge' and entity_id = '00000000-0000-4000-8000-0000000cab02'), 1, 'purge audited');
select ok(exists (select 1 from public.audit_events where entity_type = 'business_settings' and after ->> 'hero_title' = 'عنوان جديد'), 'settings change audited');
select ok(exists (select 1 from public.audit_events where entity_type = 'offers' and action = 'update:slug'), 'offer change audited');
select ok(exists (select 1 from public.audit_events where entity_type = 'nav_items'), 'nav_items audited');

-- ------------------------------------------------------------------ processing queue (service_role)
update public.album_photos set upload_status = 'pending', created_at = now() - interval '5 minutes'
where id = '00000000-0000-4000-8000-0000000cad01';
set local role service_role;
select is((select count(*)::int from public.claim_photo_jobs(50) where id = '00000000-0000-4000-8000-0000000cad01'), 1, 'service_role claims a pending job');
select ok(public.complete_photo_job('00000000-0000-4000-8000-0000000cad01', true, null, 1600, 1067,
  jsonb_build_object('thumb', 'albums/00000000-0000-4000-8000-0000000cab01/00000000-0000-4000-8000-0000000cad01/thumb.webp',
                     'display', 'albums/00000000-0000-4000-8000-0000000cab01/00000000-0000-4000-8000-0000000cad01/display.webp')),
  'service_role completes the job');
reset role;
select is((select upload_status || ':' || attempts from public.album_photos where id = '00000000-0000-4000-8000-0000000cad01'), 'ready:1', 'job marked ready');

-- ------------------------------------------------------------------ grants catalog
select ok(not has_function_privilege('authenticated', 'public.complete_photo_job(uuid, boolean, text, int, int, jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.complete_photo_job(uuid, boolean, text, int, int, jsonb)', 'execute'),
  'complete_photo_job is service_role only');
select is((select count(*)::int from unnest(array['brand_assets','site_sections','nav_items','slug_redirects','service_links','process_steps',
                                                  'offers','offer_items','announcements','album_categories','import_items']) t
           where not has_table_privilege('service_role', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE')), 0,
  'service_role has full grants on every new table');

select * from finish();
rollback;
