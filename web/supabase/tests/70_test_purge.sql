-- purge_test_fixtures: service-role only, prefix-scoped bypass of append-only guards.
begin;
select plan(17);

-- ---- fixtures (postgres)
insert into public.customers (id, full_name) values ('00000000-0000-4000-8000-0000000007c1', '[STAGING-TEST] Customer');
insert into public.events (id, customer_id, title) values
  ('00000000-0000-4000-8000-0000000007e1', '00000000-0000-4000-8000-0000000007c1', '[STAGING-TEST] Event');
insert into public.media_assets (id, event_id, bucket, path, kind, mime, upload_status, variants) values
  ('00000000-0000-4000-8000-0000000007a1', '00000000-0000-4000-8000-0000000007e1', 'private-media',
   'events/00000000-0000-4000-8000-0000000007e1/00000000-0000-4000-8000-0000000007a1/original.jpg', 'image', 'image/jpeg', 'ready',
   '{"thumb":"events/00000000-0000-4000-8000-0000000007e1/00000000-0000-4000-8000-0000000007a1/thumb.webp"}');
insert into public.album_selections (id, event_id, customer_id, status) values
  ('00000000-0000-4000-8000-0000000007d1', '00000000-0000-4000-8000-0000000007e1', '00000000-0000-4000-8000-0000000007c1', 'submitted');
insert into public.album_selection_items (selection_id, media_asset_id) values
  ('00000000-0000-4000-8000-0000000007d1', '00000000-0000-4000-8000-0000000007a1');
insert into public.album_selection_snapshots (selection_id, event_id, items, item_count) values
  ('00000000-0000-4000-8000-0000000007d1', '00000000-0000-4000-8000-0000000007e1', '[]', 1);
insert into public.contracts (id, customer_id, event_id) values
  ('00000000-0000-4000-8000-0000000007f1', '00000000-0000-4000-8000-0000000007c1', '00000000-0000-4000-8000-0000000007e1');
insert into public.contract_versions (contract_id, body, total) values ('00000000-0000-4000-8000-0000000007f1', 'v1', 100);
insert into public.contract_versions (contract_id, body, total) values ('00000000-0000-4000-8000-0000000007f1', 'v2', 200);
update public.contracts set status = 'approved', approved_version_id = current_version_id, approved_at = now()
 where id = '00000000-0000-4000-8000-0000000007f1';
insert into public.payments (customer_id, event_id, contract_id, amount, method, idempotency_key) values
  ('00000000-0000-4000-8000-0000000007c1', '00000000-0000-4000-8000-0000000007e1', '00000000-0000-4000-8000-0000000007f1',
   100, 'cash', 'staging-test-pay-0001');
-- non-prefixed event with a snapshot
insert into public.album_selections (id, event_id, customer_id, status)
  select '00000000-0000-4000-8000-0000000007d2', '00000000-0000-4000-8000-0000000000e3', customer_id, 'submitted'
  from public.events where id = '00000000-0000-4000-8000-0000000000e3';
insert into public.album_selection_snapshots (selection_id, event_id, items, item_count) values
  ('00000000-0000-4000-8000-0000000007d2', '00000000-0000-4000-8000-0000000000e3', '[]', 0);

-- ---- guards hold without the purge GUC
select throws_ok($$delete from public.album_selection_snapshots where event_id = '00000000-0000-4000-8000-0000000007e1'$$,
  '42501', null, 'prefixed snapshot not deletable without purge');
select throws_ok($$delete from public.contract_versions where contract_id = '00000000-0000-4000-8000-0000000007f1'$$,
  '42501', null, 'prefixed contract version not deletable without purge');
-- GUC alone does not unlock non-prefixed rows
select set_config('app.purge_test_fixtures', 'on', true), set_config('app.purge_prefix', '[STAGING-TEST]', true);
select throws_ok($$delete from public.album_selection_snapshots where event_id = '00000000-0000-4000-8000-0000000000e3'$$,
  '42501', null, 'GUC does not unlock non-prefixed snapshots');
select set_config('app.purge_test_fixtures', 'off', true), set_config('app.purge_prefix', '', true);

-- ---- callers
select ok(not has_function_privilege('authenticated', 'public.purge_test_fixtures(text)', 'execute'), 'authenticated cannot execute');
select ok(not has_function_privilege('anon', 'public.purge_test_fixtures(text)', 'execute'), 'anon cannot execute');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.purge_test_fixtures('[STAGING-TEST]')$$, '42501', null, 'owner session cannot execute');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok($$select public.purge_test_fixtures('[STAGING-TEST]')$$, '42501', null, 'admin session cannot execute');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok($$select public.purge_test_fixtures('[DEV]')$$, '22023', 'invalid purge prefix', 'invalid prefix rejected');
select is((public.purge_test_fixtures('[STAGING-TEST]') ->> 'events')::int, 1, 'service_role purge removes the prefixed event');
reset role;

-- ---- results
select is((select count(*)::int from public.events where id = '00000000-0000-4000-8000-0000000007e1'), 0, 'event gone');
select is((select count(*)::int from public.album_selection_snapshots where event_id = '00000000-0000-4000-8000-0000000007e1'), 0, 'snapshot gone');
select is((select count(*)::int from public.contract_versions where contract_id = '00000000-0000-4000-8000-0000000007f1'), 0, 'contract versions gone');
select is((select count(*)::int from public.payments where idempotency_key = 'staging-test-pay-0001'), 0, 'payment gone');
select is((select count(*)::int from public.customers where id = '00000000-0000-4000-8000-0000000007c1'), 0, 'prefixed customer gone');
select is((select count(*)::int from private.storage_cleanup_queue where reason = 'test_purge'
           and path like 'events/00000000-0000-4000-8000-0000000007e1/%'), 2, 'media paths enqueued (original + variant)');
select is((select count(*)::int from public.album_selection_snapshots where event_id = '00000000-0000-4000-8000-0000000000e3'), 1,
  'non-prefixed snapshot untouched');
select is((select count(*)::int from public.audit_events where action = 'purge_test_fixtures'), 1, 'summary audit row written');

select * from finish();
rollback;
