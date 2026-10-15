-- 0003 Role/identity helpers used by RLS policies, profile provisioning and
-- the custom access token hook.
--
-- Authorization source of truth is public.profiles (read here as SECURITY
-- DEFINER, so policies never recurse). The JWT `app_role` claim is a UI hint
-- only; a role change or disable takes effect on the very next query even if
-- the user still holds an old token.

create or replace function app.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and not p.disabled;
$$;

create or replace function app.is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and not p.disabled);
$$;

-- MFA gate for staff roles: when app_settings.require_staff_mfa (or the
-- profile's own mfa_required) is set, staff/admin/owner privileges apply only
-- to sessions with aal2.
create or replace function app.require_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.require_staff_mfa from public.app_settings s where s.id = 1), true)
      or coalesce((select p.mfa_required from public.profiles p where p.id = (select auth.uid())), false);
$$;

create or replace function app.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not app.require_mfa() or coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2';
$$;

create or replace function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() in ('owner', 'admin', 'staff'), false) and app.mfa_ok();
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() in ('owner', 'admin'), false) and app.mfa_ok();
$$;

create or replace function app.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() = 'owner', false) and app.mfa_ok();
$$;

-- Customer row linked to the caller. NULL for disabled or non-customer users.
create or replace function app.customer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.customers c
  join public.profiles p on p.id = c.user_id
  where c.user_id = (select auth.uid()) and not p.disabled and p.role = 'customer';
$$;

-- Event owned by the calling customer?
create or replace function app.owns_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id and e.customer_id = app.customer_id()
  );
$$;

-- Calling staff member assigned to the event (active staff row, staff role, MFA ok).
create or replace function app.is_assigned(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_staff() and exists (
    select 1 from public.event_staff_assignments a
    join public.staff_members s on s.id = a.staff_id
    where a.event_id = p_event_id and s.profile_id = (select auth.uid()) and s.active
  );
$$;

-- Admin, or staff assigned to the event.
create or replace function app.can_work_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin() or app.is_assigned(p_event_id);
$$;

-- Public project predicate.
create or replace function app.event_is_public(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id and e.is_published and e.publication_consent = 'granted'
  );
$$;

-- Extract the event id from a storage path `events/{uuid}/...` (NULL if malformed).
create or replace function app.path_event_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^events/[0-9a-fA-F-]{36}/.+'
    then substring(p_name from '^events/([0-9a-fA-F-]{36})/')::uuid
  end;
$$;

revoke execute on all functions in schema app from public;
grant execute on function
  app.current_role(), app.is_active(), app.require_mfa(), app.mfa_ok(), app.is_staff(),
  app.is_admin(), app.is_owner(), app.customer_id(), app.owns_event(uuid), app.is_assigned(uuid),
  app.can_work_event(uuid), app.event_is_public(uuid), app.path_event_id(text), app.is_api_role()
to anon, authenticated, service_role;

-- ---------------------------------------------------------------- provisioning
-- New auth user -> profile (role customer) + linked customers row.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1));
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, v_name, new.phone);
  insert into public.customers (user_id, full_name, email, phone, created_by)
  values (new.id, coalesce(nullif(v_name, ''), 'Customer'), new.email, new.phone, new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------- access token hook
-- Adds `app_role` (and `disabled`) claims. Configured in config.toml:
--   [auth.hook.custom_access_token] uri = "pg-functions://postgres/app/custom_access_token_hook"
-- NOTE: contract named it auth.custom_access_token_hook; the auth schema is
-- owned by supabase_auth_admin on hosted projects, so it lives in `app`.
create or replace function app.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_role public.app_role;
  v_disabled boolean;
begin
  select p.role, p.disabled into v_role, v_disabled
  from public.profiles p where p.id = (event ->> 'user_id')::uuid;

  v_claims := jsonb_set(v_claims, '{app_role}', to_jsonb(coalesce(v_role::text, 'customer')));
  v_claims := jsonb_set(v_claims, '{disabled}', to_jsonb(coalesce(v_disabled, false)));
  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

grant usage on schema app to supabase_auth_admin;
revoke execute on function app.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin;
