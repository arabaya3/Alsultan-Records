-- 0023 Audit gaps (events insert/delete, media visibility, review status, customer delete without content) and
-- owner-only admin_revoke_user_sessions. Users (LOCAL DEV seed): owner a1, admin a2, customer b1.
begin;
select plan(14);

-- media_assets: bulk re-assignments of an unchanged visibility are NOT audited; deleting an asset IS audited
update public.media_assets set visibility = visibility where id in (select id from public.media_assets limit 5);
select is((select count(*)::int from public.audit_events where entity_type = 'media_assets'), 0, 'unchanged visibility not audited');
delete from public.media_assets where id = (select id from public.media_assets where event_id = '00000000-0000-4000-8000-0000000000e2' limit 1);
select is((select count(*)::int from public.audit_events where entity_type = 'media_assets' and action = 'delete'), 1, 'media delete audited');

-- events: hard delete is audited (its media deletes are audited too) (inside this rolled-back transaction)
delete from public.events where id = '00000000-0000-4000-8000-0000000000e1';
select is((select count(*)::int from public.audit_events where entity_type = 'events' and action = 'delete' and entity_id = '00000000-0000-4000-8000-0000000000e1'), 1, 'event hard delete audited');

-- events: creation is audited
insert into public.customers (id, full_name, notes) values ('00000000-0000-4000-8000-00000000c0a7', 'Audit Probe', 'PRIVATE-NOTE-XYZ');
insert into public.events (id, customer_id, title, event_type, event_date)
values ('00000000-0000-4000-8000-00000000e0a7', '00000000-0000-4000-8000-00000000c0a7', 'audit probe', 'wedding', current_date);
select is((select count(*)::int from public.audit_events where entity_type = 'events' and action = 'insert' and entity_id = '00000000-0000-4000-8000-00000000e0a7'), 1, 'event creation audited');

-- reviews: status change (approval) audited
insert into public.reviews (id, customer_id, rating, body) values ('00000000-0000-4000-8000-00000000f0a7', '00000000-0000-4000-8000-00000000c0a7', 5, 'audit probe');
update public.reviews set status = 'approved' where id = '00000000-0000-4000-8000-00000000f0a7';
select is((select count(*)::int from public.audit_events where entity_type = 'reviews' and entity_id = '00000000-0000-4000-8000-00000000f0a7'), 1, 'review approval audited');

-- customers: delete audited WITHOUT private content
delete from public.reviews where customer_id = '00000000-0000-4000-8000-00000000c0a7';
delete from public.events where id = '00000000-0000-4000-8000-00000000e0a7';
delete from public.customers where id = '00000000-0000-4000-8000-00000000c0a7';
select is((select count(*)::int from public.audit_events where entity_type = 'customers' and action = 'delete' and entity_id = '00000000-0000-4000-8000-00000000c0a7'), 1, 'customer delete audited');
select is((select before from public.audit_events where entity_type = 'customers' and entity_id = '00000000-0000-4000-8000-00000000c0a7'), '{"id": "00000000-0000-4000-8000-00000000c0a7"}'::jsonb, 'customer audit row holds the id only');
select ok(not exists (select 1 from public.audit_events where (before::text like '%PRIVATE-NOTE-XYZ%' or after::text like '%PRIVATE-NOTE-XYZ%')), 'customer notes never copied into the audit table');

-- admin_revoke_user_sessions
select ok(not has_function_privilege('anon', 'public.admin_revoke_user_sessions(uuid)', 'execute'), 'anon cannot execute admin_revoke_user_sessions');
insert into auth.sessions (id, user_id) values ('00000000-0000-4000-8000-00000000d0a7', '00000000-0000-4000-8000-0000000000a2');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.admin_revoke_user_sessions('00000000-0000-4000-8000-0000000000b1')$$, '42501', null, 'admin cannot revoke sessions');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.admin_revoke_user_sessions('00000000-0000-4000-8000-0000000000a1')$$, '42501', null, 'owner cannot revoke own sessions this way');
select ok(public.admin_revoke_user_sessions('00000000-0000-4000-8000-0000000000a2') >= 1, 'owner revokes another user''s sessions');
reset role;
select is((select count(*)::int from auth.sessions where user_id = '00000000-0000-4000-8000-0000000000a2'), 0, 'target has no sessions left');
select is((select count(*)::int from public.audit_events where action = 'sessions_revoked' and entity_id = '00000000-0000-4000-8000-0000000000a2'), 1, 'revocation audited');

select * from finish();
rollback;
