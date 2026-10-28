-- 0026 Albums: newest PUBLISHED first (published_at, set once by the database) + hero source setting.
begin;
select plan(17);

-- draft: no publish time; the list key falls back to created_at
insert into public.photo_albums (slug, title, event_date, is_published, created_at)
  values ('pa-draft', 'Draft album', '2025-10-28', false, '2026-10-01T08:00:00Z');
select is((select published_at from public.photo_albums where slug = 'pa-draft'), null, 'a new draft has no publish time');
select is((select listed_at from public.photo_albums where slug = 'pa-draft'), '2026-10-01T08:00:00Z'::timestamptz, 'listed_at falls back to created_at');
select is((select event_date from public.photo_albums where slug = 'pa-draft'), '2025-10-28'::date, 'an occasion a year ago is accepted');

-- first publish stamps it
update public.photo_albums set is_published = true where slug = 'pa-draft';
select is((select published_at from public.photo_albums where slug = 'pa-draft'), now(), 'first publish stamps published_at = now()');
select is((select listed_at from public.photo_albums where slug = 'pa-draft'), now(), 'listed_at follows the publish time, not the event date');

-- give it an older stored publish time (bypassing the trigger, as a restore would) to observe later changes
alter table public.photo_albums disable trigger photo_albums_published_at;
update public.photo_albums set published_at = '2026-10-02T09:00:00Z' where slug = 'pa-draft';
alter table public.photo_albums enable trigger photo_albums_published_at;

update public.photo_albums set title = 'Renamed album', description = 'new text', event_date = '2024-05-05' where slug = 'pa-draft';
select is((select published_at from public.photo_albums where slug = 'pa-draft'), '2026-10-02T09:00:00Z'::timestamptz, 'editing title/description/event date does not move it');
update public.photo_albums set is_published = false where slug = 'pa-draft';
select is((select published_at from public.photo_albums where slug = 'pa-draft'), '2026-10-02T09:00:00Z'::timestamptz, 'unpublish keeps the original publish time');
update public.photo_albums set is_published = true where slug = 'pa-draft';
select is((select published_at from public.photo_albums where slug = 'pa-draft'), '2026-10-02T09:00:00Z'::timestamptz, 'publish again keeps the ORIGINAL publish time (no jump to the top)');
update public.photo_albums set published_at = '2030-01-01T00:00:00Z' where slug = 'pa-draft';
select is((select published_at from public.photo_albums where slug = 'pa-draft'), '2026-10-02T09:00:00Z'::timestamptz, 'published_at cannot be written directly (trigger keeps it)');

-- inserted already published (import script path) → stamped; a value supplied by the caller is ignored
insert into public.photo_albums (slug, title, is_published, published_at) values ('pa-direct', 'Direct', true, '2001-01-01T00:00:00Z');
select is((select published_at from public.photo_albums where slug = 'pa-direct'), now(), 'insert as published stamps now(), ignoring a supplied value');
insert into public.photo_albums (slug, title, is_published, published_at) values ('pa-draft2', 'Draft 2', false, '2001-01-01T00:00:00Z');
select is((select published_at from public.photo_albums where slug = 'pa-draft2'), null, 'insert as draft ignores a supplied publish time');

-- grants: readable, never writable by the app roles
select ok(has_column_privilege('anon', 'public.photo_albums', 'published_at', 'select')
      and has_column_privilege('anon', 'public.photo_albums', 'listed_at', 'select'), 'anon reads published_at and listed_at (ordering)');
select ok(not has_column_privilege('authenticated', 'public.photo_albums', 'published_at', 'update')
      and not has_column_privilege('authenticated', 'public.photo_albums', 'published_at', 'insert'), 'admins cannot set published_at from the API');

-- deterministic order with equal publish times: listed_at desc, id desc
insert into public.photo_albums (id, slug, title, is_published) values
  ('00000000-0000-4000-8000-00000000aa01', 'pa-tie-1', 'Tie 1', true),
  ('00000000-0000-4000-8000-00000000aa02', 'pa-tie-2', 'Tie 2', true);
select is((select array_agg(slug order by listed_at desc, id desc) from public.photo_albums where slug like 'pa-tie-%'),
  array['pa-tie-2', 'pa-tie-1'], 'equal publish times tie-break on id');

-- hero source
select is((select hero_cover_source from public.business_settings where id = 1), 'manual', 'hero source defaults to manual (production choice unchanged)');
select throws_ok($$update public.business_settings set hero_cover_source = 'random' where id = 1$$, '23514', null, 'only manual | latest_album');
select ok(has_column_privilege('anon', 'public.business_settings', 'hero_cover_source', 'select'), 'anon reads the hero source');

select * from finish();
rollback;
