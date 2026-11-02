-- 0033 stamp_updated_by must not undo ON DELETE SET NULL, and must keep stamping real edits.
begin;
select plan(3);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000cc01', 'pgtap-stamp@example.test');
insert into public.profiles (id) values ('00000000-0000-4000-8000-00000000cc01') on conflict do nothing;
update public.nav_items set updated_by = '00000000-0000-4000-8000-00000000cc01'
 where id = (select id from public.nav_items order by id limit 1);
-- no session: the trigger keeps the previous value on an ordinary update
select is((select count(*)::int from public.nav_items where updated_by = '00000000-0000-4000-8000-00000000cc01'), 0, 'no session: an update cannot set another user');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000cc01","role":"authenticated"}', true);
update public.nav_items set updated_at = updated_at where id = (select id from public.nav_items order by id limit 1);
select is((select count(*)::int from public.nav_items where updated_by = '00000000-0000-4000-8000-00000000cc01'), 1, 'a signed-in edit is stamped');
select set_config('request.jwt.claims', '', true);

delete from public.profiles where id = '00000000-0000-4000-8000-00000000cc01';
select is((select count(*)::int from public.nav_items n where n.updated_by is not null and not exists (select 1 from public.profiles p where p.id = n.updated_by)), 0, 'deleting the user leaves no row pointing at them');

select * from finish();
rollback;
