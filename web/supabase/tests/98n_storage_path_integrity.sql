-- 0038 (1) media_assets paths stay inside their event; (2) the fixture-purge prefixes are reserved.
-- Seed: customer user b1 (customer A, event e1), staff a3 assigned to e1; e2 belongs to customer A too.
begin;
select plan(11);

-- ------------------------------------------------------------------ 1. media paths
select lives_ok($$insert into public.media_assets (id, event_id, bucket, path, kind, mime, variants) values
  ('00000000-0000-4000-8000-00000000ee01', '00000000-0000-4000-8000-0000000000e1', 'private-media',
   'events/00000000-0000-4000-8000-0000000000e1/00000000-0000-4000-8000-00000000ee01/original.jpg', 'image', 'image/jpeg',
   '{"thumb":"events/00000000-0000-4000-8000-0000000000e1/00000000-0000-4000-8000-00000000ee01/thumb.webp"}')$$,
  'a row whose path and variants are inside its event is accepted');
select throws_ok($$update public.media_assets set variants = '{"display":"events/00000000-0000-4000-8000-0000000000e2/x/original.jpg"}'
  where id = '00000000-0000-4000-8000-00000000ee01'$$, '23514', null, 'a variant pointing into another event is refused');
select throws_ok($$update public.media_assets set variants = '{"display":"events/00000000-0000-4000-8000-0000000000e1/../e2/original.jpg"}'
  where id = '00000000-0000-4000-8000-00000000ee01'$$, '23514', null, 'a variant with .. is refused');
select throws_ok($$update public.media_assets set variants = '{"display":{"path":"x"}}'
  where id = '00000000-0000-4000-8000-00000000ee01'$$, '23514', null, 'a non-string variant is refused');
select throws_ok($$insert into public.media_assets (event_id, bucket, path, kind, mime) values
  ('00000000-0000-4000-8000-0000000000e1', 'private-media', 'events/00000000-0000-4000-8000-0000000000e2/y/original.jpg', 'image', 'image/jpeg')$$,
  '23514', null, 'a path in another event is refused');

-- ------------------------------------------------------------------ 2. reserved prefixes
-- An API request (request.jwt.claims set, as PostgREST always does): the customer cannot adopt the prefix…
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","aal":"aal1"}', true);
select throws_ok($$update public.customers set full_name = '[STAGING-TEST] me' where user_id = '00000000-0000-4000-8000-0000000000b1'$$,
  '22023', null, 'a customer cannot give themselves a fixture prefix');
select lives_ok($$update public.customers set full_name = 'Customer A renamed' where user_id = '00000000-0000-4000-8000-0000000000b1'$$,
  'an ordinary rename still works');
reset role;
-- …an admin cannot set it on someone else either…
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$update public.customers set full_name = '[RESTORE-TEST] x' where user_id = '00000000-0000-4000-8000-0000000000b2'$$,
  '22023', null, 'an admin request cannot set the prefix');
reset role;
-- …the service role (fixture scripts) can.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$update public.customers set full_name = '[STAGING-TEST] fixture' where user_id = '00000000-0000-4000-8000-0000000000b2'$$,
  'the service role may write the prefix');
reset role;
-- A direct database session with no request (migrations, maintenance) may.
select set_config('request.jwt.claims', '', true);
select lives_ok($$update public.customers set full_name = '[STAGING-TEST] maintenance' where user_id = '00000000-0000-4000-8000-0000000000b2'$$,
  'a direct session without a request may');
-- An account created by the admin API with app_metadata.test_fixture may carry it even inside a request context.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000ee12', 'pgtap-fixture@example.test', '{"full_name":"Fixture"}', '{"test_fixture":true}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
select lives_ok($$update public.customers set full_name = '[STAGING-TEST] fixture 2' where user_id = '00000000-0000-4000-8000-00000000ee12'$$,
  'a fixture account (app_metadata.test_fixture) may carry the prefix');
reset role;
select set_config('request.jwt.claims', '', true);
-- (The GoTrue sign-up path, session supabase_auth_admin, is covered by e2e fixture-prefix.spec.ts on a real sign-up.)

select * from finish();
rollback;
