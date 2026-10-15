-- RLS / RPC behaviour tests. Relies on the LOCAL DEV seed users:
--   owner a1, admin a2, staff a3 (assigned to e1), customer A b1 (events e1, e2), customer B b2 (events e3, e4)
begin;
select plan(74);

-- ------------------------------------------------------------------ fixtures (as postgres)
update public.app_settings set require_staff_mfa = true where id = 1;

insert into public.media_assets (id, event_id, bucket, path, kind, mime, upload_status) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e3', 'private-media',
   'events/00000000-0000-4000-8000-0000000000e3/f1/display.jpg', 'image', 'image/jpeg', 'ready'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000e2', 'private-media',
   'events/00000000-0000-4000-8000-0000000000e2/f2/display.jpg', 'image', 'image/jpeg', 'ready');

insert into public.album_selections (id, event_id, customer_id) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e3',
   (select id from public.customers where user_id = '00000000-0000-4000-8000-0000000000b2'));

insert into public.quotes (id, customer_id, event_id, status) values
  ('00000000-0000-4000-8000-000000000071', (select id from public.customers where user_id = '00000000-0000-4000-8000-0000000000b2'),
   '00000000-0000-4000-8000-0000000000e3', 'sent');

insert into public.payments (customer_id, event_id, amount, method, idempotency_key) values
  ((select id from public.customers where user_id = '00000000-0000-4000-8000-0000000000b2'),
   '00000000-0000-4000-8000-0000000000e3', 50000, 'cash', 'fixture-pay-b-0001');

insert into storage.objects (bucket_id, name) values
  ('private-media', 'events/00000000-0000-4000-8000-0000000000e3/f1/display.jpg'),
  ('private-media', 'events/00000000-0000-4000-8000-0000000000e1/zz/display.jpg');

insert into public.reviews (customer_id, rating, body, status) values
  ((select id from public.customers where user_id = '00000000-0000-4000-8000-0000000000b1'), 5, 'approved one', 'approved'),
  ((select id from public.customers where user_id = '00000000-0000-4000-8000-0000000000b1'), 4, 'pending one', 'pending');

insert into public.contracts (id, customer_id, event_id) values
  ('00000000-0000-4000-8000-000000000081', (select id from public.customers where user_id = '00000000-0000-4000-8000-0000000000b2'),
   '00000000-0000-4000-8000-0000000000e3');
insert into public.contract_versions (contract_id, body, total, deposit_required)
  values ('00000000-0000-4000-8000-000000000081', 'Contract body v1', 1000000, 200000);
update public.contracts set status = 'sent' where id = '00000000-0000-4000-8000-000000000081';

insert into public.equipment (id, name, serial) values ('00000000-0000-4000-8000-000000000091', 'Camera', 'SN-1');
insert into public.equipment_assignments (equipment_id, event_id, out_at, returned_at) values
  ('00000000-0000-4000-8000-000000000091', '00000000-0000-4000-8000-0000000000e1', '2026-11-01 08:00+00', '2026-11-01 20:00+00');

-- ================================================================== customer A
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;

select is((select count(*)::int from public.events where customer_id <> app.customer_id()), 0, 'A cannot read B events');
select is((select count(*)::int from public.events), 2, 'A sees exactly own 2 events');
select is((select count(*)::int from public.media_assets where event_id = '00000000-0000-4000-8000-0000000000e3'), 0, 'A cannot read B media');
select is((select count(*)::int from public.media_assets where event_id = '00000000-0000-4000-8000-0000000000e1'), 202, 'A reads own event media (200 images + 2 videos)');
select is((select count(*)::int from public.album_selections where id = '00000000-0000-4000-8000-0000000000d1'), 0, 'A cannot read B selection');
select is((select count(*)::int from public.quotes where customer_id <> app.customer_id()), 0, 'A cannot read B quotes');
select is((select count(*)::int from public.payments where customer_id <> app.customer_id()), 0, 'A cannot read B payments');
select is((select count(*)::int from public.contracts where customer_id <> app.customer_id()), 0, 'A cannot read B contracts');
select is((select count(*)::int from storage.objects where name like 'events/00000000-0000-4000-8000-0000000000e3/%'), 0, 'A cannot read B storage objects');
select is((select count(*)::int from storage.objects where name like 'events/00000000-0000-4000-8000-0000000000e1/%'), 1, 'A reads own storage objects');
select is((select count(*)::int from public.deliverables), 1, 'A sees own deliverable only');

update public.events set title = 'hacked' where id = '00000000-0000-4000-8000-0000000000e3';
update public.events set title = 'hacked' where id = '00000000-0000-4000-8000-0000000000e1';
select throws_ok($$update public.profiles set role = 'owner' where id = '00000000-0000-4000-8000-0000000000b1'$$, '42501', null, 'customer cannot change own role');
select throws_ok($$update public.profiles set disabled = false where id = '00000000-0000-4000-8000-0000000000b1'$$, '42501', null, 'customer cannot change disabled flag');
select throws_ok($$update public.customers set user_id = null where user_id = '00000000-0000-4000-8000-0000000000b1'$$, '42501', null, 'customer cannot change customer ownership');
select throws_ok($$update public.customers set notes = 'x' where user_id = '00000000-0000-4000-8000-0000000000b1'$$, '42501', null, 'customer cannot write staff notes');
select throws_ok($$select notes from public.customers$$, '42501', null, 'customer cannot read customers.notes');
select lives_ok($$update public.profiles set full_name = 'A renamed' where id = '00000000-0000-4000-8000-0000000000b1'$$, 'customer can edit own name');
select throws_ok($$insert into public.payments (customer_id, amount, method, idempotency_key) values (app.customer_id(), 1, 'x', 'self-pay-0001')$$, '42501', null, 'customer cannot insert payments');
select throws_ok($$select * from public.admin_financial_summary('2026-01-01', '2026-12-31')$$, '42501', null, 'customer cannot read financial summary');
select throws_ok($$select public.customer_approve_contract((select current_version_id from public.contracts where id = '00000000-0000-4000-8000-000000000081'), 'x')$$, '42501', null, 'A cannot approve B contract');
select throws_ok($$select public.customer_accept_quote('00000000-0000-4000-8000-000000000071')$$, '42501', null, 'A cannot accept B quote');
select throws_ok($$insert into public.album_selection_items (selection_id, media_asset_id) values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f1')$$, '42501', null, 'A cannot add items to B selection');

-- album item from another event rejected
insert into public.album_selections (event_id, customer_id) values ('00000000-0000-4000-8000-0000000000e1', app.customer_id());
select throws_ok($$insert into public.album_selection_items (selection_id, media_asset_id)
  select s.id, '00000000-0000-4000-8000-0000000000f2' from public.album_selections s where s.event_id = '00000000-0000-4000-8000-0000000000e1'$$,
  '23514', null, 'album item from another event rejected');
select lives_ok($$insert into public.album_selection_items (selection_id, media_asset_id)
  select s.id, m.id from public.album_selections s, public.media_assets m
  where s.event_id = '00000000-0000-4000-8000-0000000000e1' and m.event_id = s.event_id and m.kind = 'image' limit 3$$,
  'album items from same event accepted');
select isnt(public.submit_album_selection('00000000-0000-4000-8000-0000000000e1'), null, 'submit_album_selection returns snapshot');
delete from public.album_selection_items;
select is((select count(*)::int from public.album_selection_items), 3, 'submitted selection items cannot be deleted');

-- consent revocation unpublishes
select lives_ok($$select public.set_publication_consent('00000000-0000-4000-8000-0000000000e2', 'revoked')$$, 'customer can revoke consent');
reset role;
select is((select is_published from public.events where id = '00000000-0000-4000-8000-0000000000e2'), false, 'revoking consent unpublishes');
select is((select title from public.events where id = '00000000-0000-4000-8000-0000000000e3'), '[DEV] Customer B engagement', 'A update on B event had no effect');
select is((select title from public.events where id = '00000000-0000-4000-8000-0000000000e1'), '[DEV] Customer A wedding', 'customer cannot update even own event');
select is((select count(*)::int from public.audit_events where entity_type = 'events' and entity_id = '00000000-0000-4000-8000-0000000000e2'), 1, 'consent change audited');

-- ================================================================== anon
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is((select count(*)::int from public.events), 0, 'anon sees no projects after consent revoked');
reset role;
update public.events set publication_consent = 'granted' where id = '00000000-0000-4000-8000-0000000000e2';
update public.events set is_published = true where id = '00000000-0000-4000-8000-0000000000e2';
update public.events set is_published = true where id = '00000000-0000-4000-8000-0000000000e3';
select is((select is_published from public.events where id = '00000000-0000-4000-8000-0000000000e3'), false, 'event without consent cannot become published');
set local role anon;
select is((select count(*)::int from public.events), 1, 'anon sees only published+consented project');
select is((select count(*)::int from public.reviews), 1, 'anon sees approved reviews only');
select is((select count(*)::int from public.media_assets), 0, 'anon sees no private media');
select throws_ok($$select customer_id from public.events$$, '42501', null, 'anon cannot read events.customer_id');
select throws_ok($$select * from public.payments$$, '42501', null, 'anon has no access to payments');
reset role;

-- ================================================================== public forms (server-only via service_role)
set local role service_role;
select is(
  public.public_submit_booking('Test', '050-123-4567', 'wedding', 'idem-key-test-0001', 'iphash1'),
  public.public_submit_booking('Test', '050-123-4567', 'wedding', 'idem-key-test-0001', 'iphash1'),
  'public_submit_booking is idempotent (same tracking code)');
select is((select status::text from public.public_track_booking((select tracking_code from public.booking_requests where idempotency_key = 'idem-key-test-0001'), '4567', 'iphash1')),
  'new', 'public_track_booking returns status with matching last-4');
select is((select count(*)::int from public.public_track_booking((select tracking_code from public.booking_requests where idempotency_key = 'idem-key-test-0001'), '0000', 'iphash1')),
  0, 'public_track_booking returns nothing on wrong last-4');
reset role;
set local role anon;
select throws_ok($$select public.public_submit_booking('x', '0501234567', 'w', 'idem-key-anon-0001', 'h')$$, '42501', null, 'anon cannot call public_submit_booking directly');
reset role;

-- ================================================================== customer B: contract approval
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.customer_approve_contract((select current_version_id from public.contracts where id = '00000000-0000-4000-8000-000000000081'), repeat('0', 64))$$,
  '22023', 'content hash mismatch', 'approval requires matching hash');
select lives_ok($$select public.customer_approve_contract(v.id, v.content_hash) from public.contract_versions v where v.contract_id = '00000000-0000-4000-8000-000000000081'$$,
  'approval with exact version hash succeeds');
select is((select status::text from public.contracts where id = '00000000-0000-4000-8000-000000000081'), 'approved', 'contract approved');
select is((select count(*)::int from public.payments), 1, 'B reads own payment');
select is((select balance from public.event_financials('00000000-0000-4000-8000-0000000000e3')), 950000::bigint, 'event_financials balance = contracted - paid');
reset role;
select throws_ok($$update public.contract_versions set body = 'tampered'$$, '42501', null, 'contract versions immutable (update)');
select throws_ok($$delete from public.contract_versions$$, '42501', null, 'contract versions immutable (delete)');

-- ================================================================== staff
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from public.events), 1, 'staff without aal2 sees only public projects (MFA enforced)');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2"}', true);
select is((select count(*)::int from public.events where id <> '00000000-0000-4000-8000-0000000000e2'), 1, 'staff (aal2) sees assigned event only');
select throws_ok($$select * from public.admin_financial_summary('2026-01-01', '2026-12-31')$$, '42501', null, 'staff cannot read financial summary');
select throws_ok($$select public.admin_set_user_role('00000000-0000-4000-8000-0000000000b1', 'admin')$$, '42501', null, 'staff cannot manage users');
select is((select count(*)::int from public.payments), 0, 'staff cannot read payments');
reset role;

-- ================================================================== admin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok($$select * from public.admin_financial_summary('2026-01-01', '2026-12-31')$$, 'admin can read financial summary');
select throws_ok($$select public.admin_set_user_role('00000000-0000-4000-8000-0000000000b1', 'admin')$$, '42501', 'owner only', 'admin cannot change roles (owner-only)');
select throws_ok($$select public.record_payment((select id from public.customers limit 1), 100, 'cash', 'admin-pay-0001')$$, '42501', 'owner only', 'admin cannot record payments (owner-only)');
select is((select count(*)::int from public.app_settings), 0, 'admin cannot read app_settings');
select throws_ok($$select public.set_event_publication('00000000-0000-4000-8000-0000000000e3', true)$$, '42501', 'cannot publish without granted consent', 'set_event_publication refuses without consent');
-- booking transitions
select throws_ok($$update public.booking_requests set status = 'confirmed' where idempotency_key = 'dev-seed-booking-0001'$$, '22023', null, 'invalid booking transition rejected');
select lives_ok($$select public.transition_booking((select id from public.booking_requests where idempotency_key = 'dev-seed-booking-0001'), 'contacted', 'called')$$, 'valid transition accepted');
reset role;
update public.events set event_date = (select event_date from public.events where id = '00000000-0000-4000-8000-0000000000e1')
  where id = '00000000-0000-4000-8000-0000000000e3';
select throws_ok($$insert into public.event_staff_assignments (event_id, staff_id) values ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000c1')$$,
  '23P01', null, 'staff same-day conflict rejected');
select lives_ok($$insert into public.event_staff_assignments (event_id, staff_id, override_reason) values ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000c1', 'two short shoots')$$,
  'same-day assignment allowed with override_reason');
select throws_ok($$insert into public.equipment_assignments (equipment_id, event_id, out_at, returned_at) values
  ('00000000-0000-4000-8000-000000000091', '00000000-0000-4000-8000-0000000000e3', '2026-11-01 12:00+00', '2026-11-02 12:00+00')$$,
  '23P01', null, 'equipment overlap rejected');

-- ================================================================== owner: payments idempotency
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  public.record_payment((select id from public.customers where user_id = '00000000-0000-4000-8000-0000000000b2'), 1000, 'cash', 'owner-pay-0001'),
  public.record_payment((select id from public.customers where user_id = '00000000-0000-4000-8000-0000000000b2'), 1000, 'cash', 'owner-pay-0001'),
  'record_payment exact replay returns same id');
select throws_ok($$select public.record_payment((select id from public.customers where user_id = '00000000-0000-4000-8000-0000000000b2'), 2000, 'cash', 'owner-pay-0001')$$,
  '23505', null, 'duplicate payment idempotency key rejected');
reset role;
select throws_ok($$insert into public.payments (customer_id, amount, method, idempotency_key)
  select customer_id, 5, 'cash', 'owner-pay-0001' from public.payments limit 1$$, '23505', null, 'unique idempotency key enforced at table level');
select is((select count(*)::int from public.audit_events where entity_type = 'payments'), (select count(*)::int from public.payments), 'payments audited');

-- ================================================================== bootstrap
insert into private.bootstrap (id, token_hash)
values (1, encode(sha256(convert_to('dev-bootstrap-token-0123456789abcdef0123', 'UTF8')), 'hex'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.bootstrap_initial_owner('dev-bootstrap-token-0123456789abcdef0123')$$, '42501', 'bootstrap not available', 'bootstrap refused while an owner exists');
reset role;
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-0000000000a1';
set local role authenticated;
select throws_ok($$select public.bootstrap_initial_owner('wrong-token-wrong-token-wrong-token-xx')$$, '42501', 'invalid bootstrap token', 'bootstrap rejects wrong token');
select lives_ok($$select public.bootstrap_initial_owner('dev-bootstrap-token-0123456789abcdef0123')$$, 'bootstrap succeeds once');
reset role;
select is((select role::text from public.profiles where id = '00000000-0000-4000-8000-0000000000b2'), 'owner', 'bootstrap promoted caller to owner');
update public.profiles set role = 'customer' where id = '00000000-0000-4000-8000-0000000000b2';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.bootstrap_initial_owner('dev-bootstrap-token-0123456789abcdef0123')$$, '42501', 'bootstrap not available', 'bootstrap is one-shot (no later self-promotion)');
reset role;

-- ================================================================== disabled accounts
update public.profiles set disabled = true where id = '00000000-0000-4000-8000-0000000000b1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from public.events where customer_id is not null and not is_published), 0, 'disabled customer sees no private events');
reset role;

select * from finish();
rollback;
