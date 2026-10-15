-- 0001 Foundation: extensions, schemas, enums, generic trigger functions,
-- default-privilege hardening.
--
-- The cloud project has "auto-expose new tables" ON, meaning postgres' default
-- privileges grant ALL on new public objects to anon/authenticated. We strip
-- those defaults here and every later migration REVOKEs explicitly anyway.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- `app`: helper functions used by RLS policies (not exposed via the Data API).
-- `private`: operator-only tables (rate limits, bootstrap token). Not exposed.
create schema if not exists app;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
revoke all on schema app from public, anon, authenticated;
-- Policies evaluate app.* functions as the calling role, so they need USAGE.
grant usage on schema app to anon, authenticated, service_role;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema app revoke execute on functions from public;
alter default privileges for role postgres in schema private revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public;

-- ---------------------------------------------------------------- enums
create type public.app_role as enum ('owner', 'admin', 'staff', 'customer');
create type public.booking_status as enum ('new', 'contacted', 'quoted', 'confirmed', 'cancelled', 'declined');
create type public.event_status as enum ('planned', 'shooting', 'editing', 'delivered', 'archived');
create type public.consent_status as enum ('none', 'requested', 'granted', 'revoked');
create type public.media_bucket as enum ('public-media', 'private-media');
create type public.media_kind as enum ('image', 'video', 'document');
create type public.media_visibility as enum ('private', 'public');
create type public.upload_status as enum ('pending', 'ready', 'failed');
create type public.deliverable_kind as enum ('gallery', 'video', 'album', 'files');
create type public.deliverable_status as enum ('in_progress', 'review', 'revision_requested', 'approved', 'delivered');
create type public.selection_status as enum ('draft', 'submitted', 'locked');
create type public.quote_status as enum ('draft', 'sent', 'accepted', 'rejected', 'expired');
create type public.contract_status as enum ('draft', 'sent', 'approved', 'void');
create type public.payment_kind as enum ('payment', 'refund');
create type public.equipment_status as enum ('available', 'assigned', 'maintenance', 'retired');
create type public.support_status as enum ('open', 'pending', 'resolved', 'closed');
create type public.review_status as enum ('pending', 'approved', 'rejected');
create type public.backup_status as enum ('running', 'completed', 'partial', 'failed');

-- ---------------------------------------------------------------- generic triggers
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Random human-friendly code (no 0/O/1/I). Used for tracking codes.
create or replace function app.random_code(p_len int default 10)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(p_len);
  result text := '';
  i int;
begin
  for i in 0 .. p_len - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end;
$$;

-- True when the current statement runs as an end-user API role (not as the
-- table owner / a SECURITY DEFINER function / service_role).
create or replace function app.is_api_role()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('anon', 'authenticated');
$$;
