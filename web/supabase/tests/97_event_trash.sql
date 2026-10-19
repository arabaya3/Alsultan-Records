-- 0021 Event trash (recoverable, nothing removed, not public while trashed) + admin_event_prices
-- (same basis as event_financials: approved contract > accepted quote > none). Server-enforced permissions.
-- Users (LOCAL DEV seed): admin a2 (aal2), customer b1 (owns e1), staff s1.
begin;
select plan(24);
update public.app_settings set require_staff_mfa = true where id = 1;

create temp table before_counts as
select (select count(*) from public.media_assets where event_id = '00000000-0000-4000-8000-0000000000e2') as media_e2,
       (select count(*) from public.media_assets where event_id = '00000000-0000-4000-8000-0000000000e1') as media_e1,
       (select count(*) from public.payments where event_id = '00000000-0000-4000-8000-0000000000e1') as pay_e1,
       (select count(*) from public.quotes where event_id = '00000000-0000-4000-8000-0000000000e1') as quotes_e1,
       (select count(*) from public.contracts where event_id = '00000000-0000-4000-8000-0000000000e1') as contracts_e1;
grant select on before_counts to anon, authenticated;

-- ------------------------------------------------------------------ prices (admin)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select amount from public.admin_event_prices(array['00000000-0000-4000-8000-0000000000e1'::uuid])), null::bigint,
  'no accepted quote/contract -> price null («غير محدد»), not 0');
select is((select basis from public.admin_event_prices(array['00000000-0000-4000-8000-0000000000e1'::uuid])), 'none', 'basis none');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select public.customer_accept_quote('00000000-0000-4000-8000-0000000001c1');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select amount || ':' || basis from public.admin_event_prices(array['00000000-0000-4000-8000-0000000000e1'::uuid])),
  (select quoted || ':quote' from public.event_financials('00000000-0000-4000-8000-0000000000e1')), 'accepted quote -> same amount as event_financials.quoted');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select public.customer_approve_contract(v.id, v.content_hash) from public.contract_versions v where v.contract_id = '00000000-0000-4000-8000-0000000001d1';
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select amount || ':' || basis from public.admin_event_prices(array['00000000-0000-4000-8000-0000000000e1'::uuid])),
  (select contracted || ':contract' from public.event_financials('00000000-0000-4000-8000-0000000000e1')), 'approved contract -> contract total (same as event_financials)');
reset role;

-- prices are admin-only
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select * from public.admin_event_prices(array['00000000-0000-4000-8000-0000000000e1'::uuid])$$, '42501', null, 'customer cannot call admin_event_prices');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select * from public.admin_event_prices(array['00000000-0000-4000-8000-0000000000e1'::uuid])$$, '42501', null, 'admin without MFA (aal1) cannot read prices');
select throws_ok($$select public.trash_event('00000000-0000-4000-8000-0000000000e2')$$, '42501', null, 'admin without MFA (aal1) cannot trash');
reset role;
select ok(not has_function_privilege('anon', 'public.trash_event(uuid)', 'execute') and not has_function_privilege('anon', 'public.admin_event_prices(uuid[])', 'execute'),
  'anon cannot execute trash/prices');

-- ------------------------------------------------------------------ trash permissions
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.trash_event('00000000-0000-4000-8000-0000000000e1')$$, '42501', null, 'customer cannot trash');
select throws_ok($$update public.events set deleted_at = now() where id = '00000000-0000-4000-8000-0000000000e1'$$, '42501', null,
  'deleted_at has no direct update grant');
reset role;

-- ------------------------------------------------------------------ trash e2 (published) as admin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok($$select public.trash_event('00000000-0000-4000-8000-0000000000e2')$$, 'admin trashes the published event');
select throws_ok($$select public.trash_event('00000000-0000-4000-8000-0000000000e2')$$, 'P0002', null, 'trashing twice is refused');
reset role;
select ok((select deleted_at is not null and deleted_by = '00000000-0000-4000-8000-0000000000a2' and is_published from public.events where id = '00000000-0000-4000-8000-0000000000e2'),
  'trashed: deleted_at/by set, publication flag untouched');
select is((select count(*) from public.media_assets where event_id = '00000000-0000-4000-8000-0000000000e2'), (select media_e2 from before_counts), 'media rows kept');
select ok(exists (select 1 from public.audit_events where entity_id = '00000000-0000-4000-8000-0000000000e2'::uuid and entity_type = 'events'), 'trash is audited');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*)::int from public.events where id = '00000000-0000-4000-8000-0000000000e2'), 0, 'anon cannot see a trashed event');
select is((select count(*)::int from public.media_assets where event_id = '00000000-0000-4000-8000-0000000000e2'), 0, 'anon cannot see media of a trashed event');
reset role;
select ok(not app.event_is_public('00000000-0000-4000-8000-0000000000e2'), 'event_is_public false while trashed');

-- ------------------------------------------------------------------ restore
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok($$select public.restore_event('00000000-0000-4000-8000-0000000000e2')$$, 'admin restores');
select throws_ok($$select public.restore_event('00000000-0000-4000-8000-0000000000e2')$$, 'P0002', null, 'restoring a non-trashed event is refused');
reset role;
select is((select count(*)::int from public.audit_events where entity_id = '00000000-0000-4000-8000-0000000000e2'::uuid and entity_type = 'events' and (before ->> 'deleted_at') is not null and (after ->> 'deleted_at') is null), 1, 'restore is audited');
select ok(app.event_is_public('00000000-0000-4000-8000-0000000000e2'), 'restored event is public again (consent + publication were untouched)');

-- ------------------------------------------------------------------ trash e1 (customer event with money): nothing removed, customer keeps access
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.trash_event('00000000-0000-4000-8000-0000000000e1');
reset role;
select is((select count(*) from public.payments where event_id = '00000000-0000-4000-8000-0000000000e1') || '/' ||
          (select count(*) from public.quotes where event_id = '00000000-0000-4000-8000-0000000000e1') || '/' ||
          (select count(*) from public.contracts where event_id = '00000000-0000-4000-8000-0000000000e1') || '/' ||
          (select count(*) from public.media_assets where event_id = '00000000-0000-4000-8000-0000000000e1'),
  (select pay_e1 || '/' || quotes_e1 || '/' || contracts_e1 || '/' || media_e1 from before_counts), 'payments, quotes, contracts and media all kept');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from public.contracts where event_id = '00000000-0000-4000-8000-0000000000e1'), (select contracts_e1::int from before_counts),
  'customer still reaches their contracts');
reset role;

select * from finish();
rollback;
