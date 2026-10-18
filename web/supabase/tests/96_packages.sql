-- 0019 Packages vs offers: independent sections, anon sees published packages only (no raw price),
-- admin-only writes, offer→package link never changes the package, target period columns, nav target.
-- Users (LOCAL DEV seed): admin a2 (aal2), customer b1.
begin;
select plan(24);

update public.app_settings set require_staff_mfa = true where id = 1;

-- ------------------------------------------------------------------ fixtures (postgres)
insert into public.packages (id, slug, title, status, price_minor, show_price, featured, sort_order) values
  ('00000000-0000-4000-8000-0000000c9a01', 'pk-published', 'بكج منشور', 'published', 300000, true,  true,  10),
  ('00000000-0000-4000-8000-0000000c9a02', 'pk-draft',     'بكج مسودة', 'draft',     null,   false, false, 20),
  ('00000000-0000-4000-8000-0000000c9a03', 'pk-hidden',    'بكج مخفي',  'hidden',    250000, false, false, 30);
insert into public.package_items (package_id, label) values
  ('00000000-0000-4000-8000-0000000c9a01', 'تصوير'),
  ('00000000-0000-4000-8000-0000000c9a02', 'خدمة مسودة');
insert into public.offers (id, slug, title, status, starts_on, ends_on, package_id, target_month, target_year) values
  ('00000000-0000-4000-8000-0000000c9b01', 'pk-offer-active',  'عرض على بكج', 'published', app.hebron_today() - 1, app.hebron_today() + 5, '00000000-0000-4000-8000-0000000c9a01', 10, 2026),
  ('00000000-0000-4000-8000-0000000c9b02', 'pk-offer-expired', 'عرض منتهي',   'published', app.hebron_today() - 9, app.hebron_today() - 1, '00000000-0000-4000-8000-0000000c9a01', 9, 2026);

-- ------------------------------------------------------------------ schema
select throws_ok($$insert into public.offers (slug, title, target_month) values ('pk-bad-period', 'عرض', 10)$$, '23514', null,
  'target month without year is rejected');
select throws_ok($$insert into public.offers (slug, title, target_month, target_year) values ('pk-bad-month', 'عرض', 13, 2026)$$, '23514', null,
  'target month must be 1..12');
select throws_ok($$insert into public.packages (slug, title, status) values ('pk-bad-status', 'بكج', 'archived')$$, '23514', null,
  'package status is draft|published|hidden');
select ok(app.is_site_target('packages'), 'packages is an allow-listed nav target');
select is((select string_agg(target, ',' order by sort_order) from public.nav_items where is_visible), 'work,packages,offers,services,about',
  'visible nav order: أعمالنا | البكجات | العروض | الخدمات | من نحن');

select ok(not has_column_privilege('anon', 'public.packages', 'internal_note', 'SELECT'), 'anon has no grant on packages.internal_note');
select ok(has_column_privilege('anon', 'public.packages', 'gift', 'SELECT') and has_column_privilege('anon', 'public.packages', 'group_label', 'SELECT'), 'anon reads gift + group_label');

-- ------------------------------------------------------------------ anon
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select string_agg(slug, ',' order by sort_order) from public.packages), 'pk-published', 'anon sees published packages only');
select is((select count(*)::int from public.package_items), 1, 'anon sees items of published packages only');
select is((select display_price_minor from public.packages where slug = 'pk-published'), 300000::bigint, 'anon sees the price when shown');
select throws_ok($$select price_minor from public.packages$$, '42501', null, 'anon cannot read the raw price column');
select is((select package_id from public.offers where slug = 'pk-offer-active'), '00000000-0000-4000-8000-0000000c9a01'::uuid,
  'anon reads the offer→package link');
select is((select count(*)::int from public.offers where slug = 'pk-offer-expired'), 0, 'expired offer hidden from anon even when linked to a package');
select throws_ok($$insert into public.packages (slug, title) values ('pk-anon', 'بكج')$$, '42501', null, 'anon cannot insert packages');
reset role;

-- ------------------------------------------------------------------ customer
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from public.packages), 0, 'customer cannot read packages through the authenticated role');
select throws_ok($$insert into public.packages (slug, title) values ('pk-cust', 'بكج')$$, '42501', null, 'customer: packages insert denied');
select throws_ok($$insert into public.package_items (package_id, label) values ('00000000-0000-4000-8000-0000000c9a01', 'x')$$, '42501', null,
  'customer: package_items insert denied');
update public.packages set title = 'hacked' where id = '00000000-0000-4000-8000-0000000c9a01';
reset role;
select is((select title from public.packages where id = '00000000-0000-4000-8000-0000000c9a01'), 'بكج منشور', 'customer update had no effect');

-- ------------------------------------------------------------------ admin + independence
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from public.packages where slug like 'pk-%'), 3, 'admin sees every package (draft/hidden too)');
update public.offers set title = 'عرض معدّل', ends_on = app.hebron_today() - 1, status = 'archived' where id = '00000000-0000-4000-8000-0000000c9b01';
delete from public.offers where id = '00000000-0000-4000-8000-0000000c9b02';
reset role;
select is((select title || '|' || status || '|' || price_minor || '|' || featured from public.packages where id = '00000000-0000-4000-8000-0000000c9a01'),
  'بكج منشور|published|300000|true', 'editing, expiring, archiving and deleting offers never changes the package');
select is((select count(*)::int from public.package_items where package_id = '00000000-0000-4000-8000-0000000c9a01'), 1, 'package items untouched by offer changes');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
delete from public.packages where id = '00000000-0000-4000-8000-0000000c9a01';
reset role;
select is((select package_id from public.offers where id = '00000000-0000-4000-8000-0000000c9b01'), null, 'deleting a package only unlinks its offers');
select is((select title from public.offers where id = '00000000-0000-4000-8000-0000000c9b01'), 'عرض معدّل', 'the unlinked offer itself is kept');
select ok(exists (select 1 from public.audit_events where entity_type = 'packages' and action like '%delete%'), 'package deletion is audited');

select * from finish();
rollback;
