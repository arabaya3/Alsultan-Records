begin;
select plan(5);

-- Fixture: one published album with one ready, published photo (paths only; no objects needed).
insert into public.photo_albums (id, slug, title, is_published)
values ('00000000-0000-4000-8000-00000000a161', 'orig-private-test', 'اختبار الأصل', false);
insert into public.album_photos (id, album_id, storage_path_original, variants, mime, upload_status, is_published)
values ('00000000-0000-4000-8000-00000000a162', '00000000-0000-4000-8000-00000000a161',
        'albums/00000000-0000-4000-8000-00000000a161/00000000-0000-4000-8000-00000000a162/original.jpg',
        jsonb_build_object(
          'thumb',   'albums/00000000-0000-4000-8000-00000000a161/00000000-0000-4000-8000-00000000a162/thumb.webp',
          'display', 'albums/00000000-0000-4000-8000-00000000a161/00000000-0000-4000-8000-00000000a162/display.webp'),
        'image/jpeg', 'ready', true);
update public.photo_albums set is_published = true where id = '00000000-0000-4000-8000-00000000a161';

set local role anon;
select is(public.album_photo_object_path('00000000-0000-4000-8000-00000000a162', 'original'), null,
  'anon cannot resolve the original path');
select is(public.album_photo_object_path('00000000-0000-4000-8000-00000000a162', 'display'),
  'albums/00000000-0000-4000-8000-00000000a161/00000000-0000-4000-8000-00000000a162/display.webp',
  'anon resolves the display variant of a published photo');
select ok(not app.album_object_is_public('albums/00000000-0000-4000-8000-00000000a161/00000000-0000-4000-8000-00000000a162/original.jpg'),
  'storage policy helper refuses the original object');
select ok(app.album_object_is_public('albums/00000000-0000-4000-8000-00000000a161/00000000-0000-4000-8000-00000000a162/thumb.webp'),
  'storage policy helper allows the thumb variant');
select is(public.album_photo_object_path('00000000-0000-4000-8000-00000000a162', 'whatever'), null,
  'unknown variant resolves to nothing');
reset role;

select * from finish();
rollback;
