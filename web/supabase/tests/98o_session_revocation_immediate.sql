-- 0039 A revoked token is signed out at once (not when it expires); a fresh sign-in works; disabling revokes too;
-- the service role cannot clear the customer's "withdrawn" flag.
-- Seed: owner a1, customer b1 (customer A: events e1, e2), staff a3 (assigned to e1).
begin;
select plan(12);

create function pg_temp.as_user(p_sub uuid, p_iat_offset int, p_aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'aal', p_aal,
    'iat', extract(epoch from now())::bigint + p_iat_offset)::text, true);
$$;

-- before: the customer's token (issued a minute ago) sees their events
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1', -60);
select ok((select count(*) from public.events where id in ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2')) > 0, 'before: the customer sees their events');
reset role;

-- the owner revokes the customer's sessions
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', -60, 'aal2');
select lives_ok($$select public.admin_revoke_user_sessions('00000000-0000-4000-8000-0000000000b1')$$, 'owner revokes the customer''s sessions');
reset role;

-- the SAME token, straight after: signed out everywhere
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1', -60);
select is((select count(*)::int from public.events where id in ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2')), 0, 'revoked token: no events');
select is((select count(*)::int from public.profiles where id = '00000000-0000-4000-8000-0000000000b1'), 0, 'revoked token: no own profile (the app treats it as signed out)');
select is(app.customer_id(), null, 'revoked token: no customer identity');
select ok(not app.is_active(), 'revoked token: not active');
-- a token from a new sign-in (issued after the revocation) works
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1', 5);
select ok((select count(*) from public.events where id in ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2')) > 0, 'a fresh sign-in sees their events again');
reset role;

-- disabling revokes too: the staff member's old token loses staff rights at once, also after re-enabling
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1', -60, 'aal2');
select lives_ok($$select public.admin_set_user_disabled('00000000-0000-4000-8000-0000000000a3', true)$$, 'owner disables the staff account');
select lives_ok($$select public.admin_set_user_disabled('00000000-0000-4000-8000-0000000000a3', false)$$, 'and enables it again');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a3', -60);
select ok(not app.is_staff(), 'the token issued before the disable has no staff rights');
reset role;

-- the customer's withdrawal flag cannot be cleared directly by the service role
update public.events set publication_consent = 'revoked', consent_revoked_by_customer_at = now() where id = '00000000-0000-4000-8000-0000000000e2';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$update public.events set consent_revoked_by_customer_at = null where id = '00000000-0000-4000-8000-0000000000e2'$$,
  '42501', null, 'service role cannot clear the customer''s withdrawal flag');
select throws_ok($$update public.events set publication_consent = 'granted' where id = '00000000-0000-4000-8000-0000000000e2'$$,
  '42501', null, 'nor grant consent again over it');
reset role;

select * from finish();
rollback;
