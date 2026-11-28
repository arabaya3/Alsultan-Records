-- 0039 Revoking sessions takes effect at once; the customer's "withdrawn" flag cannot be cleared by the service role.
-- Technical audit SEC-04, SEC-11.
--
-- 1. Before: admin_revoke_user_sessions (0023) deleted the user's auth.sessions (so no NEW access token can be
--    refreshed), but an access token already issued stayed valid in PostgREST and Storage until it expired (JWT
--    expiry, ≤ 1 h): RLS never asked whether the session still existed. Now every revocation also records
--    private.session_revocations(user_id, revoked_before), and the identity helpers RLS is built on treat a token issued
--    at or before that moment (JWT `iat`) as signed out:
--      app.current_role()  → is_staff / is_admin / is_owner and every staff policy
--      app.is_active()     → notifications, profile self-update, …
--      app.customer_id()   → owns_event and every customer policy (portal, storage)
--      profiles_read       → the app's own session read (getSessionProfile) sees no profile → signed out
--    No access to the auth schema is needed for the check (only our own private table), so it behaves the same on a
--    hosted project. Signing in again after the revocation issues a token with a later `iat` and works normally.
--    Disabling a user (admin_set_user_disabled) now revokes the same way.
-- 2. events_publication_trigger (0010): a direct edit of consent_revoked_by_customer_at was refused for anon and
--    authenticated callers only; the service role could clear it and then grant consent again. The guard now also
--    covers the service role, as docs/security-model.md §13 states. Only direct database maintenance (no request role)
--    may still change it.

-- ---------------------------------------------------------------- 1. revocations
create table private.session_revocations (
  user_id uuid primary key,
  revoked_before timestamptz not null default now()
);
revoke all on private.session_revocations from public, anon, authenticated;

create or replace function app.token_revoked()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.session_revocations r
    where r.user_id = (select auth.uid())
      and coalesce(((select auth.jwt()) ->> 'iat')::numeric, 0) <= extract(epoch from r.revoked_before)
  );
$$;
revoke all on function app.token_revoked() from public;
grant execute on function app.token_revoked() to anon, authenticated, service_role;

create or replace function app.revoke_sessions_now(p_user_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  insert into private.session_revocations (user_id, revoked_before) values (p_user_id, now())
  on conflict (user_id) do update set revoked_before = excluded.revoked_before;
  delete from auth.sessions where user_id = p_user_id; -- refresh tokens cascade with their session
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function app.revoke_sessions_now(uuid) from public;

create or replace function app.current_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and not p.disabled and not app.token_revoked();
$$;

create or replace function app.is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and not p.disabled) and not app.token_revoked();
$$;

create or replace function app.customer_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select c.id from public.customers c
  join public.profiles p on p.id = c.user_id
  where c.user_id = (select auth.uid()) and not p.disabled and p.role = 'customer' and not app.token_revoked();
$$;

alter policy profiles_read on public.profiles
  using ((id = (select auth.uid()) and not app.token_revoked()) or app.is_admin());

create or replace function public.admin_revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not app.is_owner() then
    raise exception 'owner only' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'use sign-out for your own sessions' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  v_count := app.revoke_sessions_now(p_user_id);
  insert into public.audit_events (actor, action, entity_type, entity_id, after)
  values (auth.uid(), 'sessions_revoked', 'auth.users', p_user_id, jsonb_build_object('sessions', v_count));
  return v_count;
end;
$$;
revoke all on function public.admin_revoke_user_sessions(uuid) from public, anon;
grant execute on function public.admin_revoke_user_sessions(uuid) to authenticated;

create or replace function public.admin_set_user_disabled(p_user_id uuid, p_disabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_owner() then
    raise exception 'owner only' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'owners cannot disable themselves' using errcode = '42501';
  end if;
  update public.profiles set disabled = p_disabled where id = p_user_id;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;
  -- A disabled account keeps nothing: its sessions end now (re-enabling then needs a fresh sign-in).
  if p_disabled then perform app.revoke_sessions_now(p_user_id); end if;
end;
$$;

-- ---------------------------------------------------------------- 2. sticky withdrawal (copy of 0010 + one condition)
create or replace function app.events_publication_trigger()
returns trigger language plpgsql set search_path = '' as $$
declare v_customer boolean;
begin
  -- Consent leaving 'granted' always unpublishes (and un-features).
  if new.publication_consent <> 'granted' then
    new.is_published := false;
    new.featured := false;
  end if;
  if tg_op = 'UPDATE' and new.publication_consent is distinct from old.publication_consent then
    new.consent_at := now();
    new.consent_by := auth.uid();
    v_customer := auth.uid() is not null and app.owns_event(new.id);
    if new.publication_consent = 'revoked' and v_customer then
      new.consent_revoked_by_customer_at := now();
    end if;
    if new.publication_consent = 'granted' and old.consent_revoked_by_customer_at is not null then
      -- Any API caller (staff/admin/owner sessions, service role) is blocked; only direct
      -- database maintenance without a request identity (migrations, superuser ops) may override.
      if not v_customer and (app.is_api_role() or coalesce(auth.role(), '') in ('authenticated', 'service_role')) then
        raise exception 'consent was withdrawn by the customer; only the customer can grant it again'
          using errcode = '42501';
      end if;
      new.consent_revoked_by_customer_at := null;
    end if;
  end if;
  -- 0039: the service role is refused too (it was the only API role that could clear the flag directly).
  if tg_op = 'UPDATE' and (app.is_api_role() or coalesce(auth.role(), '') = 'service_role')
     and new.consent_revoked_by_customer_at is distinct from old.consent_revoked_by_customer_at
     and new.publication_consent is not distinct from old.publication_consent then
    raise exception 'consent_revoked_by_customer_at is set by consent changes only' using errcode = '42501';
  end if;
  if app.is_api_role() and tg_op = 'INSERT' and (new.is_published or new.publication_consent <> 'none'
                                                 or new.consent_revoked_by_customer_at is not null) then
    raise exception 'publication/consent are set via RPC only' using errcode = '42501';
  end if;
  return new;
end $$;
