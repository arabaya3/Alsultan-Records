-- 0041 stamp triggers keep ON DELETE SET NULL; daily hygiene expires overdue quotes and trims only finished rows.
-- Seed: customer A, event e1.
begin;
select plan(8);

-- 1. deleting a user who edited an album / a video leaves no reference to them
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000ff01', 'pgtap-hygiene@example.test');
insert into public.profiles (id) values ('00000000-0000-4000-8000-00000000ff01') on conflict do nothing;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000ff01","role":"authenticated"}', true);
insert into public.photo_albums (id, slug, title) values ('00000000-0000-4000-8000-00000000ff02', 'pgtap-hygiene', 'pgTAP hygiene');
select set_config('request.jwt.claims', '', true);
select is((select updated_by from public.photo_albums where id = '00000000-0000-4000-8000-00000000ff02'), '00000000-0000-4000-8000-00000000ff01'::uuid, 'the editor is stamped');
delete from public.profiles where id = '00000000-0000-4000-8000-00000000ff01';
select is((select updated_by from public.photo_albums where id = '00000000-0000-4000-8000-00000000ff02'), null, 'deleting the user clears the album''s reference');
select is((select count(*)::int from public.showcase_videos v where v.updated_by is not null and not exists (select 1 from public.profiles p where p.id = v.updated_by)), 0, 'no video points at a deleted user');

-- 2. daily hygiene
insert into public.quotes (id, customer_id, event_id, status, valid_until)
select '00000000-0000-4000-8000-00000000ff03', c.id, '00000000-0000-4000-8000-0000000000e1', 'sent', current_date - 3
from public.customers c where c.user_id = '00000000-0000-4000-8000-0000000000b1';
insert into private.storage_cleanup_queue (bucket, path, reason, done_at, enqueued_at) values
  ('private-media', 'events/00000000-0000-4000-8000-0000000000e1/old/done.jpg', 'pgtap', now() - interval '40 days', now() - interval '41 days'),
  ('private-media', 'events/00000000-0000-4000-8000-0000000000e1/new/done.jpg', 'pgtap', now() - interval '2 days', now() - interval '3 days'),
  ('private-media', 'events/00000000-0000-4000-8000-0000000000e1/old/pending.jpg', 'pgtap', null, now() - interval '90 days');
select lives_ok($$select app.daily_hygiene()$$, 'daily hygiene runs');
select is((select status::text from public.quotes where id = '00000000-0000-4000-8000-00000000ff03'), 'expired', 'an overdue sent quote is now expired');
select is((select count(*)::int from private.storage_cleanup_queue where reason = 'pgtap' and path like '%/old/done.jpg'), 0, 'a cleanup row finished 40 days ago is deleted');
select is((select count(*)::int from private.storage_cleanup_queue where reason = 'pgtap' and (path like '%/new/done.jpg' or path like '%/pending.jpg')), 2, 'recent and pending rows are kept');
select is((select count(*)::int from cron.job where jobname = 'daily-hygiene' and schedule = '17 3 * * *'), 1, 'scheduled once a day');

select * from finish();
rollback;
