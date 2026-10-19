-- 0022 Enabled admin modules: allow-list check, owner-only update, staff-roles-only read RPC, audit.
-- Users (LOCAL DEV seed): owner a1, admin a2, customer b1, staff s1.
begin;
select plan(12);
update public.app_settings set require_staff_mfa = false where id = 1;

select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'app_settings' and column_name = 'enabled_modules'), '''{customers,events,calendar}''::text[]', 'default = customers, events, calendar');
select throws_ok($$update public.app_settings set enabled_modules = '{customers,bogus}' where id = 1$$, '23514', null, 'unknown module rejected by check');
select throws_ok($$update public.app_settings set enabled_modules = array['events', null] where id = 1$$, '23514', null, 'null element rejected');
select ok(not has_function_privilege('anon', 'public.admin_enabled_modules()', 'execute'), 'anon cannot execute admin_enabled_modules');

-- owner: update + read
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
update public.app_settings set enabled_modules = '{customers,events,calendar,finance}' where id = 1;
select is(public.admin_enabled_modules(), '{customers,events,calendar,finance}'::text[], 'owner updates and reads modules');
reset role;
select is((select count(*)::int from public.audit_events where entity_type = 'app_settings' and after ->> 'enabled_modules' like '%finance%'), 1, 'owner change audited');

-- admin: read via RPC only, cannot update, cannot read app_settings row
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(public.admin_enabled_modules(), '{customers,events,calendar,finance}'::text[], 'admin reads modules via RPC');
update public.app_settings set enabled_modules = '{bookings}' where id = 1;
select is((select count(*)::int from public.app_settings), 0, 'admin still cannot read the app_settings row');
reset role;
select is((select enabled_modules from public.app_settings where id = 1), '{customers,events,calendar,finance}'::text[], 'admin update had no effect');

-- staff: read via RPC, cannot update
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(public.admin_enabled_modules(), '{customers,events,calendar,finance}'::text[], 'staff reads modules (their nav follows the flags)');
update public.app_settings set enabled_modules = '{}' where id = 1;
reset role;
select is((select enabled_modules from public.app_settings where id = 1), '{customers,events,calendar,finance}'::text[], 'staff update had no effect');

-- customer: forbidden
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.admin_enabled_modules()$$, '42501', null, 'customer cannot read modules');
reset role;

select * from finish();
rollback;
