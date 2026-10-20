-- 0024 Long texts (10,000) + home stats section (owner-entered counter) + owner-requested home order.
begin;
select plan(12);

-- long texts: 10,000 accepted, 10,001 rejected (packages / offers / items)
insert into public.packages (slug, title, description, status) values ('pk-long', 'Long package', repeat('ب', 10000), 'draft');
select is((select char_length(description) from public.packages where slug = 'pk-long'), 10000, 'package description takes 10,000 chars');
select throws_ok($$update public.packages set description = repeat('ب', 10001) where slug = 'pk-long'$$, '23514', null, 'package description > 10,000 rejected');
insert into public.package_items (package_id, label, sort_order) select id, repeat('ت', 10000), 10 from public.packages where slug = 'pk-long';
select is((select char_length(label) from public.package_items i join public.packages p on p.id = i.package_id where p.slug = 'pk-long'), 10000, 'package item line takes 10,000 chars');
update public.packages set gift = repeat('ه', 10000), whatsapp_message = repeat('و', 10000) where slug = 'pk-long';
select is((select char_length(gift) + char_length(whatsapp_message) from public.packages where slug = 'pk-long'), 20000, 'gift + WhatsApp message take 10,000 each');
select throws_ok($$update public.packages set title = repeat('x', 121) where slug = 'pk-long'$$, '23514', null, 'titles keep their short limit');
update public.site_sections set intro = repeat('م', 10000) where key = 'services';
select is((select char_length(intro) from public.site_sections where key = 'services'), 10000, 'section intro takes 10,000 chars');

-- stats section
select is((select is_visible from public.site_sections where key = 'stats'), false, 'stats section exists, hidden by default');
select is((select stat_value from public.site_sections where key = 'stats'), null, 'no number until the owner enters one');
select throws_ok($$update public.site_sections set stat_value = 0 where key = 'stats'$$, '23514', null, 'counter must be ≥ 1');
select ok(has_column_privilege('anon', 'public.site_sections', 'stat_value', 'select'), 'anon can read the counter');

-- owner-requested order: offers → albums → stats → works
select is((select array_agg(key order by sort_order) from (select key, sort_order from public.site_sections order by sort_order limit 4) s),
  array['offers', 'albums', 'stats', 'works'], 'home order: offers, albums, stats, works');
select is((select array[item_limit] || (select item_limit from public.site_sections where key = 'works') from public.site_sections where key = 'albums'), array[4, 3], '4 albums, 3 videos');

select * from finish();
rollback;
