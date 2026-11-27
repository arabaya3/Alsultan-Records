-- 0038 Path integrity for media cleanup, and a fixture prefix nobody can adopt (technical audit SEC-02, SEC-03).
--
-- 1. media_assets: an event's row may only name storage objects under that event's folder.
--    Staff assigned to an event can write media_assets.variants (free jsonb). When the event is deleted or purged,
--    every variant path goes to the storage cleanup queue (0008/0012), so a variant pointing at ANOTHER event's
--    original (events/<other>/…/original.jpg) would have that customer's file deleted. The CHECK below keeps path and
--    every variant value under events/<event_id>/ (no "..", strings only). NOT VALID: new and changed rows are checked
--    at once; rows written before this migration are left as they are. Before VALIDATE on a hosted project, run
--      select count(*) from public.media_assets where not app.media_paths_in_event(event_id, path, variants);
--    and only `alter table public.media_assets validate constraint media_assets_paths_in_event;` when it is 0.
--    The cleanup Edge Function also refuses event-bucket paths outside events/<uuid>/ (supabase/functions/storage-cleanup).
--
-- 2. customers: purge_test_fixtures (0012) treats a customer whose name starts with [STAGING-TEST] / [RESTORE-TEST]
--    as a test fixture and deletes their payments, quotes and contracts. A customer can edit their own name, and a
--    self sign-up takes its name from user metadata, so a real customer could get their records deleted by the next
--    staging run on the shared ("staging" = production) project. Those two prefixes are now reserved: a customer row
--    may carry one only when written with the service role (fixture scripts), from a direct database session that is
--    not an API request (session_user postgres and no request.jwt.claims: migrations, maintenance), or when its
--    account was created by the admin API with app_metadata.test_fixture = true (user-editable metadata cannot set
--    app_metadata). API requests (PostgREST always sets request.jwt.claims, even for anon) and sign-ups (GoTrue
--    connects as supabase_auth_admin) without that flag are refused.
--    Existing rows are untouched; only an insert, or a change of the name, is checked.

-- ---------------------------------------------------------------- 1. media paths stay in their event
create or replace function app.media_paths_in_event(p_event uuid, p_path text, p_variants jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p_event is null or (
    left(coalesce(p_path, ''), 44) = 'events/' || p_event::text || '/'
    and position('..' in p_path) = 0
    and not exists (
      select 1 from jsonb_each(coalesce(p_variants, '{}'::jsonb)) e
      where jsonb_typeof(e.value) <> 'string'
         or left(e.value #>> '{}', 44) <> 'events/' || p_event::text || '/'
         or position('..' in (e.value #>> '{}')) > 0
    )
  );
$$;
revoke all on function app.media_paths_in_event(uuid, text, jsonb) from public;
grant execute on function app.media_paths_in_event(uuid, text, jsonb) to authenticated, service_role;

alter table public.media_assets
  add constraint media_assets_paths_in_event check (app.media_paths_in_event(event_id, path, variants)) not valid;

-- ---------------------------------------------------------------- 2. reserved fixture prefixes
create or replace function app.customers_reserved_prefix()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if left(coalesce(new.full_name, ''), 14) in ('[STAGING-TEST]', '[RESTORE-TEST]')
     and (tg_op = 'INSERT' or old.full_name is distinct from new.full_name)
     and coalesce(auth.role(), '') <> 'service_role'
     and not (session_user = 'postgres' and coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}') = '{}')
     and not exists (
       select 1 from auth.users u
       where u.id = new.user_id and coalesce(u.raw_app_meta_data ->> 'test_fixture', '') = 'true'
     ) then
    raise exception 'this name prefix is reserved for test fixtures' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function app.customers_reserved_prefix() from public;

create trigger customers_reserved_prefix before insert or update of full_name on public.customers
  for each row execute function app.customers_reserved_prefix();
