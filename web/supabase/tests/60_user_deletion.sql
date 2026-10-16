-- Deleting auth users must succeed even when they are referenced by immutable rows,
-- and immutable content must stay unchanged.
begin;
select plan(13);
update public.app_settings set require_staff_mfa = true where id = 1;

-- ---- customer A: submitted snapshot + approved contract version (+ seeded payment)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
insert into public.album_selections (event_id, customer_id) values ('00000000-0000-4000-8000-0000000000e1', app.customer_id());
insert into public.album_selection_items (selection_id, media_asset_id)
  select s.id, m.id from public.album_selections s, public.media_assets m
  where s.event_id = '00000000-0000-4000-8000-0000000000e1' and m.event_id = s.event_id and m.kind = 'image'
  order by m.sort_order limit 4;
select public.submit_album_selection('00000000-0000-4000-8000-0000000000e1');
select public.customer_approve_contract(v.id, v.content_hash) from public.contract_versions v
 where v.contract_id = '00000000-0000-4000-8000-0000000001d1';
reset role;

-- ---- admin: authors a contract version for customer B
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
insert into public.contracts (customer_id, event_id)
  select id, '00000000-0000-4000-8000-0000000000e3' from public.customers where user_id = '00000000-0000-4000-8000-0000000000b2';
insert into public.contract_versions (contract_id, body, total)
  select id, 'Admin-authored body', 5000 from public.contracts where event_id = '00000000-0000-4000-8000-0000000000e3';
reset role;
select set_config('request.jwt.claims', '', true);

-- capture immutable content
create temp table before_snap as
  select id, items, item_count, submitted_at, event_id, selection_id from public.album_selection_snapshots;
create temp table before_cv as
  select id, contract_id, version_no, body, total, deposit_required, content_hash, created_at from public.contract_versions;
create temp table before_pay as select id, amount, idempotency_key, customer_id from public.payments;
create temp table before_audit as select id, actor, action, entity_type, entity_id, before, after, at from public.audit_events;

select is((select count(*)::int from before_snap where item_count = 4), 1, 'fixture: one submitted snapshot');
select is((select count(*)::int from public.contracts where id = '00000000-0000-4000-8000-0000000001d1' and status = 'approved'), 1, 'fixture: contract approved');
select ok((select count(*) from public.audit_events where actor = '00000000-0000-4000-8000-0000000000b1') > 0, 'fixture: audit rows by customer A');

-- ---- delete the users
select lives_ok($$delete from auth.users where id = '00000000-0000-4000-8000-0000000000b1'$$, 'deleting customer auth user succeeds');
select lives_ok($$delete from auth.users where id = '00000000-0000-4000-8000-0000000000a2'$$, 'deleting admin auth user (contract version author) succeeds');

select is((select count(*)::int from public.album_selection_snapshots where submitted_by is not null), 0, 'snapshot submitter link cleared');
select is((select count(*)::int from (select id, items, item_count, submitted_at, event_id, selection_id from public.album_selection_snapshots
                                      except select * from before_snap) d), 0, 'snapshot content unchanged');
select is((select count(*)::int from (select id, contract_id, version_no, body, total, deposit_required, content_hash, created_at from public.contract_versions
                                      except select * from before_cv) d), 0, 'contract version content unchanged');
select is((select count(*)::int from (select id, amount, idempotency_key, customer_id from public.payments
                                      except select * from before_pay) d), 0, 'payments unchanged');
select is((select count(*)::int from (select * from before_audit
                                      except select id, actor, action, entity_type, entity_id, before, after, at from public.audit_events) d), 0,
  'audit rows preserved (actor uuid retained)');

-- ---- immutability still enforced for anything else
select throws_ok($$update public.album_selection_snapshots set item_count = 0$$, '42501', null, 'snapshot content still immutable');
select throws_ok($$delete from public.album_selection_snapshots$$, '42501', null, 'snapshots still cannot be deleted');
select throws_ok($$update public.contract_versions set created_by = '00000000-0000-4000-8000-0000000000a1'$$, '42501', null,
  'contract version actor cannot be re-pointed');

select * from finish();
rollback;
