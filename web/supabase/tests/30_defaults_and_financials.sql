-- Column defaults usable by API roles; event_financials balance semantics.
begin;
select plan(8);
update public.app_settings set require_staff_mfa = true where id = 1;

-- admin inserts a quote through the authenticated role (quote_no default)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok($$insert into public.quotes (customer_id, event_id)
  select id, '00000000-0000-4000-8000-0000000000e3'
  from public.customers where user_id = '00000000-0000-4000-8000-0000000000b2'$$, 'admin can insert a quote (quote_no default)');
select matches((select quote_no from public.quotes where event_id = '00000000-0000-4000-8000-0000000000e3' and status = 'draft' limit 1), '^Q-[A-Z2-9]{8}$', 'quote_no generated');
reset role;

-- customer inserts a support request (tracking_code default)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok($$insert into public.support_requests (customer_id, subject) values (app.customer_id(), 'help')$$,
  'customer can open a support request (tracking_code default)');

-- balance before acceptance: no basis, deposit shows as credit
select is((select balance_basis from public.event_financials('00000000-0000-4000-8000-0000000000e1')), 'none', 'no accepted quote/contract -> basis none');
select lives_ok($$select public.customer_accept_quote('00000000-0000-4000-8000-0000000001c1')$$, 'customer accepts seeded quote');
select is((select quoted from public.event_financials('00000000-0000-4000-8000-0000000000e1')), 1250000::bigint, 'quoted = accepted quote total');
select is((select balance from public.event_financials('00000000-0000-4000-8000-0000000000e1')), 950000::bigint,
  'balance = accepted quote total - paid (before contract approval)');
reset role;

-- after contract approval, contract total is the basis
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select public.customer_approve_contract(v.id, v.content_hash) from public.contract_versions v
 where v.contract_id = '00000000-0000-4000-8000-0000000001d1';
select is((select balance_basis from public.event_financials('00000000-0000-4000-8000-0000000000e1')), 'contract', 'approved contract becomes basis');
reset role;

select * from finish();
rollback;
