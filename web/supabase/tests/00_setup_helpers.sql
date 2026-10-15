-- Sanity: RLS on every public table, no anon/authenticated grants on private schema,
-- every SECURITY DEFINER function pins search_path.
begin;
select plan(5);

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0, 'RLS enabled on every public table');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'private' and grantee in ('anon', 'authenticated', 'PUBLIC')),
  0, 'private schema tables have no API-role grants');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app', 'private') and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  0, 'every SECURITY DEFINER function sets search_path');

select ok(
  not has_function_privilege('anon', 'public.public_submit_booking(text, text, text, text, text, text, date, text, text, int, text[], text, uuid)', 'execute'),
  'anon cannot execute public_submit_booking directly');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'audit_events'
     and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0, 'no direct write grants on audit_events');

select * from finish();
rollback;
