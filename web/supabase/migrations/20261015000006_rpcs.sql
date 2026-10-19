-- 0006 SECURITY DEFINER RPCs. Every function: search_path = '', explicit
-- caller/ownership checks, EXECUTE revoked from public and granted narrowly.

-- ================================================================ rate limiting (private)
create or replace function private.rate_limit_hit(p_bucket text, p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into private.rate_limits as r (bucket, key, window_start, hits)
  values (p_bucket, coalesce(p_key, 'unknown'), v_window, 1)
  on conflict (bucket, key, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  -- opportunistic cleanup of old windows
  if random() < 0.01 then
    delete from private.rate_limits where window_start < now() - interval '2 days';
  end if;
  return v_hits <= p_max;
end;
$$;
revoke execute on function private.rate_limit_hit(text, text, int, int) from public, anon, authenticated;

create or replace function app.digits(p text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(coalesce(p, ''), '\D', '', 'g');
$$;

-- ================================================================ bootstrap / user admin
-- Operator sets the token hash once (SQL editor / psql, never committed):
--   insert into private.bootstrap (id, token_hash)
--   values (1, encode(sha256(convert_to('<long random token>', 'UTF8')), 'hex'))
--   on conflict (id) do update set token_hash = excluded.token_hash, used_at = null;
create or replace function public.bootstrap_initial_owner(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row private.bootstrap%rowtype;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  -- serialize concurrent attempts
  select * into v_row from private.bootstrap where id = 1 for update;
  if not found or v_row.used_at is not null then
    raise exception 'bootstrap not available' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where role = 'owner') then
    raise exception 'bootstrap not available' using errcode = '42501';
  end if;
  if p_token is null or length(p_token) < 32
     or encode(sha256(convert_to(p_token, 'UTF8')), 'hex') <> v_row.token_hash then
    raise exception 'invalid bootstrap token' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = v_uid and disabled) then
    raise exception 'account disabled' using errcode = '42501';
  end if;
  update public.profiles set role = 'owner', mfa_required = true where id = v_uid;
  update private.bootstrap set used_at = now(), used_by = v_uid, token_hash = 'consumed' where id = 1;
end;
$$;

create or replace function public.admin_set_user_role(p_user_id uuid, p_role public.app_role)
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
    raise exception 'owners cannot change their own role' using errcode = '42501';
  end if;
  update public.profiles
     set role = p_role,
         mfa_required = (p_role in ('owner', 'admin', 'staff')) or mfa_required
   where id = p_user_id;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;
end;
$$;

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
end;
$$;

create or replace function public.admin_link_customer_user(p_customer_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_user_id is not null and not exists (select 1 from public.profiles where id = p_user_id and role = 'customer') then
    raise exception 'target user must be a customer account' using errcode = '22023';
  end if;
  update public.customers set user_id = p_user_id where id = p_customer_id;
  if not found then raise exception 'customer not found' using errcode = 'P0002'; end if;
  insert into public.audit_events (actor, action, entity_type, entity_id, after)
  values (auth.uid(), 'link_user', 'customers', p_customer_id, jsonb_build_object('user_id', p_user_id));
end;
$$;

-- ================================================================ public forms (server-only)
-- Called by Next.js server actions with the service-role client AFTER the
-- action verified Turnstile and computed p_ip_hash (HMAC of client IP).
create or replace function public.public_submit_booking(
  p_contact_name text,
  p_contact_phone text,
  p_event_type text,
  p_idempotency_key text,
  p_ip_hash text,
  p_contact_email text default null,
  p_event_date date default null,
  p_city text default null,
  p_venue text default null,
  p_guests int default null,
  p_services text[] default '{}',
  p_message text default null,
  p_customer_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  select tracking_code into v_code from public.booking_requests where idempotency_key = p_idempotency_key;
  if found then return v_code; end if;

  if not private.rate_limit_hit('booking_ip', p_ip_hash, 5, 3600)
     or not private.rate_limit_hit('booking_phone', app.digits(p_contact_phone), 5, 86400) then
    raise exception 'rate limited' using errcode = 'P0001', hint = 'rate_limited';
  end if;
  if length(app.digits(p_contact_phone)) < 7 then
    raise exception 'invalid phone' using errcode = '22023';
  end if;
  if p_event_date is not null and p_event_date < current_date then
    raise exception 'event date in the past' using errcode = '22023';
  end if;

  insert into public.booking_requests (
    contact_name, contact_phone, contact_email, event_type, event_date, city, venue, guests,
    services, message, idempotency_key, source_ip_hash, customer_id)
  values (
    btrim(p_contact_name), btrim(p_contact_phone), nullif(btrim(p_contact_email), ''), p_event_type, p_event_date,
    p_city, p_venue, p_guests, coalesce(p_services, '{}'), p_message, p_idempotency_key, p_ip_hash, p_customer_id)
  on conflict (idempotency_key) do nothing
  returning tracking_code into v_code;

  if v_code is null then
    select tracking_code into v_code from public.booking_requests where idempotency_key = p_idempotency_key;
  end if;
  return v_code;
end;
$$;

create or replace function public.public_track_booking(p_tracking_code text, p_phone_last4 text, p_ip_hash text)
returns table (status public.booking_status, event_date date, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.rate_limit_hit('track_booking', p_ip_hash, 20, 3600) then
    raise exception 'rate limited' using errcode = 'P0001', hint = 'rate_limited';
  end if;
  if p_phone_last4 !~ '^\d{4}$' then
    return;
  end if;
  return query
    select b.status, b.event_date, b.updated_at
    from public.booking_requests b
    where b.tracking_code = upper(btrim(p_tracking_code))
      and right(app.digits(b.contact_phone), 4) = p_phone_last4;
end;
$$;

create or replace function public.public_submit_support(
  p_contact_name text,
  p_contact_phone text,
  p_subject text,
  p_message text,
  p_idempotency_key text,
  p_ip_hash text,
  p_contact_email text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_code text;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  select tracking_code into v_code from public.support_requests where idempotency_key = p_idempotency_key;
  if found then return v_code; end if;
  if not private.rate_limit_hit('support_ip', p_ip_hash, 5, 3600) then
    raise exception 'rate limited' using errcode = 'P0001', hint = 'rate_limited';
  end if;
  if length(app.digits(p_contact_phone)) < 7 or coalesce(length(btrim(p_message)), 0) = 0 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into public.support_requests (contact_name, contact_phone, contact_email, subject, idempotency_key, source_ip_hash)
  values (btrim(p_contact_name), btrim(p_contact_phone), nullif(btrim(p_contact_email), ''), btrim(p_subject), p_idempotency_key, p_ip_hash)
  returning id, tracking_code into v_id, v_code;
  insert into public.support_messages (request_id, body) values (v_id, p_message);
  return v_code;
end;
$$;

create or replace function public.public_track_support(p_tracking_code text, p_phone_last4 text, p_ip_hash text)
returns table (status public.support_status, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.rate_limit_hit('track_support', p_ip_hash, 20, 3600) then
    raise exception 'rate limited' using errcode = 'P0001', hint = 'rate_limited';
  end if;
  if p_phone_last4 !~ '^\d{4}$' then
    return;
  end if;
  return query
    select s.status, s.updated_at from public.support_requests s
    where s.tracking_code = upper(btrim(p_tracking_code))
      and right(app.digits(s.contact_phone), 4) = p_phone_last4;
end;
$$;

-- ================================================================ bookings / events (admin)
create or replace function public.transition_booking(p_booking_id uuid, p_to public.booking_status, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  perform set_config('app.transition_note', coalesce(p_note, ''), true);
  update public.booking_requests set status = p_to where id = p_booking_id;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  perform set_config('app.transition_note', '', true);
end;
$$;

create or replace function public.set_publication_consent(p_event_id uuid, p_status public.consent_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_admin() then
    null; -- admins record consent obtained offline (audited)
  elsif app.owns_event(p_event_id) then
    if p_status not in ('granted', 'revoked') then
      raise exception 'customers may only grant or revoke consent' using errcode = '42501';
    end if;
  else
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.events set publication_consent = p_status where id = p_event_id;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.set_event_publication(
  p_event_id uuid, p_publish boolean, p_featured boolean default false, p_featured_order int default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_event public.events%rowtype;
begin
  if not app.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = p_event_id for update;
  if not found then raise exception 'event not found' using errcode = 'P0002'; end if;
  if p_publish and v_event.publication_consent <> 'granted' then
    raise exception 'cannot publish without granted consent' using errcode = '42501';
  end if;
  if p_publish and v_event.public_slug is null then
    raise exception 'public_slug required before publishing' using errcode = '22023';
  end if;
  update public.events
     set is_published = p_publish,
         featured = p_publish and coalesce(p_featured, false),
         featured_order = case when p_publish and coalesce(p_featured, false) then p_featured_order end
   where id = p_event_id;
end;
$$;

-- ================================================================ customer actions
create or replace function public.submit_album_selection(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sel public.album_selections%rowtype;
  v_items jsonb;
  v_count int;
  v_snapshot uuid;
begin
  if not app.owns_event(p_event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_sel from public.album_selections where event_id = p_event_id for update;
  if not found then raise exception 'no selection' using errcode = 'P0002'; end if;
  if v_sel.status <> 'draft' then
    raise exception 'selection already submitted' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('media_asset_id', i.media_asset_id, 'note', i.note) order by i.created_at), '[]'::jsonb),
         count(*)
    into v_items, v_count
    from public.album_selection_items i where i.selection_id = v_sel.id;
  if v_count = 0 then
    raise exception 'selection is empty' using errcode = '22023';
  end if;
  insert into public.album_selection_snapshots (selection_id, event_id, items, item_count, submitted_by)
  values (v_sel.id, p_event_id, v_items, v_count, auth.uid())
  returning id into v_snapshot;
  update public.album_selections set status = 'submitted', submitted_at = now() where id = v_sel.id;
  return v_snapshot;
end;
$$;

create or replace function public.customer_accept_quote(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_q public.quotes%rowtype;
begin
  select * into v_q from public.quotes where id = p_quote_id for update;
  if not found or v_q.customer_id is distinct from app.customer_id() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_q.status <> 'sent' then
    raise exception 'quote is not open for acceptance' using errcode = '22023';
  end if;
  if v_q.valid_until is not null and v_q.valid_until < current_date then
    update public.quotes set status = 'expired' where id = p_quote_id;
    raise exception 'quote expired' using errcode = '22023';
  end if;
  update public.quotes set status = 'accepted', accepted_at = now(), accepted_by = auth.uid() where id = p_quote_id;
end;
$$;

create or replace function public.customer_approve_contract(p_version_id uuid, p_content_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_v public.contract_versions%rowtype;
  v_c public.contracts%rowtype;
begin
  select * into v_v from public.contract_versions where id = p_version_id;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_c from public.contracts where id = v_v.contract_id for update;
  if v_c.customer_id is distinct from app.customer_id() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_c.status <> 'sent' then
    raise exception 'contract is not awaiting approval' using errcode = '22023';
  end if;
  if v_c.current_version_id is distinct from p_version_id then
    raise exception 'only the current version can be approved' using errcode = '22023';
  end if;
  if p_content_hash is null or lower(p_content_hash) <> v_v.content_hash then
    raise exception 'content hash mismatch' using errcode = '22023';
  end if;
  update public.contracts
     set status = 'approved', approved_version_id = p_version_id, approved_at = now(), approved_by = auth.uid()
   where id = v_c.id;
end;
$$;

create or replace function public.customer_request_revision(p_deliverable_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_d public.deliverables%rowtype;
begin
  select * into v_d from public.deliverables where id = p_deliverable_id for update;
  if not found or not app.owns_event(v_d.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_d.status <> 'review' then
    raise exception 'deliverable is not in review' using errcode = '22023';
  end if;
  if p_note is null or length(btrim(p_note)) = 0 or length(p_note) > 4000 then
    raise exception 'note required' using errcode = '22023';
  end if;
  update public.deliverables set status = 'revision_requested' where id = p_deliverable_id;
  insert into public.notifications (recipient_id, kind, payload)
  select p.id, 'revision_requested',
         jsonb_build_object('deliverable_id', p_deliverable_id, 'event_id', v_d.event_id, 'note', p_note, 'by', auth.uid())
  from public.profiles p where p.role in ('owner', 'admin') and not p.disabled;
end;
$$;

-- ================================================================ money
create or replace function public.record_payment(
  p_customer_id uuid,
  p_amount bigint,
  p_method text,
  p_idempotency_key text,
  p_kind public.payment_kind default 'payment',
  p_event_id uuid default null,
  p_contract_id uuid default null,
  p_received_at timestamptz default now(),
  p_reference text default null,
  p_currency char(3) default 'ILS'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.payments%rowtype;
  v_id uuid;
begin
  if not app.is_owner() then
    raise exception 'owner only' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  if p_event_id is not null and not exists (select 1 from public.events where id = p_event_id and customer_id = p_customer_id) then
    raise exception 'event does not belong to customer' using errcode = '22023';
  end if;
  if p_contract_id is not null and not exists (select 1 from public.contracts where id = p_contract_id and customer_id = p_customer_id) then
    raise exception 'contract does not belong to customer' using errcode = '22023';
  end if;

  select * into v_existing from public.payments where idempotency_key = p_idempotency_key;
  if found then
    -- exact replay => same id; anything else => reject
    if (v_existing.customer_id, v_existing.amount, v_existing.kind, v_existing.currency)
       = (p_customer_id, p_amount, p_kind, p_currency) then
      return v_existing.id;
    end if;
    raise exception 'idempotency key already used for a different payment' using errcode = '23505';
  end if;

  insert into public.payments (customer_id, event_id, contract_id, kind, amount, currency, method, received_at,
                               reference, idempotency_key, recorded_by)
  values (p_customer_id, p_event_id, p_contract_id, p_kind, p_amount, p_currency, p_method,
          coalesce(p_received_at, now()), p_reference, p_idempotency_key, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.event_financials(p_event_id uuid)
returns table (event_id uuid, currency char(3), contracted bigint, paid bigint, refunded bigint, expenses bigint, balance bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_is_admin boolean := app.is_admin();
begin
  if not (v_is_admin or app.owns_event(p_event_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  with c as (
    select coalesce(sum(v.total), 0)::bigint as contracted
    from public.contracts k join public.contract_versions v on v.id = k.approved_version_id
    where k.event_id = p_event_id and k.status = 'approved'
  ), p as (
    select coalesce(sum(amount) filter (where kind = 'payment'), 0)::bigint as paid,
           coalesce(sum(amount) filter (where kind = 'refund'), 0)::bigint as refunded
    from public.payments where payments.event_id = p_event_id
  ), x as (
    select coalesce(sum(amount), 0)::bigint as expenses from public.expenses where expenses.event_id = p_event_id
  )
  select p_event_id, 'ILS'::char(3), c.contracted, p.paid, p.refunded,
         case when v_is_admin then x.expenses end,
         (c.contracted - p.paid + p.refunded)::bigint
  from c, p, x;
end;
$$;

create or replace function public.admin_financial_summary(p_from date, p_to date)
returns table (currency char(3), contracted bigint, paid bigint, refunded bigint, expenses bigint, net_cash bigint, outstanding bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  return query
  with c as (
    select coalesce(sum(v.total), 0)::bigint as contracted
    from public.contracts k join public.contract_versions v on v.id = k.approved_version_id
    where k.status = 'approved' and k.approved_at >= p_from and k.approved_at < p_to + 1
  ), p as (
    select coalesce(sum(amount) filter (where kind = 'payment'), 0)::bigint as paid,
           coalesce(sum(amount) filter (where kind = 'refund'), 0)::bigint as refunded
    from public.payments where received_at >= p_from and received_at < p_to + 1
  ), x as (
    select coalesce(sum(amount), 0)::bigint as expenses from public.expenses where spent_at between p_from and p_to
  ), o as (
    -- all-time outstanding across approved contracts
    select coalesce(sum(v.total), 0)::bigint
         - coalesce((select sum(case when kind = 'payment' then amount else -amount end)
                     from public.payments where contract_id is not null), 0)::bigint as outstanding
    from public.contracts k join public.contract_versions v on v.id = k.approved_version_id
    where k.status = 'approved'
  )
  select 'ILS'::char(3), c.contracted, p.paid, p.refunded, x.expenses,
         (p.paid - p.refunded - x.expenses)::bigint, o.outstanding
  from c, p, x, o;
end;
$$;

-- Whether the caller's session must be aal2 to use staff privileges.
create or replace function public.staff_mfa_required()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.require_mfa();
$$;

-- ================================================================ grants
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.staff_mfa_required() to authenticated;

grant execute on function
  public.bootstrap_initial_owner(text),
  public.admin_set_user_role(uuid, public.app_role),
  public.admin_set_user_disabled(uuid, boolean),
  public.admin_link_customer_user(uuid, uuid),
  public.transition_booking(uuid, public.booking_status, text),
  public.set_publication_consent(uuid, public.consent_status),
  public.set_event_publication(uuid, boolean, boolean, int),
  public.submit_album_selection(uuid),
  public.customer_accept_quote(uuid),
  public.customer_approve_contract(uuid, text),
  public.customer_request_revision(uuid, text),
  public.record_payment(uuid, bigint, text, text, public.payment_kind, uuid, uuid, timestamptz, text, char),
  public.event_financials(uuid),
  public.admin_financial_summary(date, date)
to authenticated;

-- Public forms: server-only (service_role). Turnstile is verified in the
-- Next.js server action, which then calls these with the admin client.
grant execute on function
  public.public_submit_booking(text, text, text, text, text, text, date, text, text, int, text[], text, uuid),
  public.public_track_booking(text, text, text),
  public.public_submit_support(text, text, text, text, text, text, text),
  public.public_track_support(text, text, text)
to service_role;

grant execute on all functions in schema public to service_role;
grant execute on function private.rate_limit_hit(text, text, int, int) to service_role;
grant execute on function app.digits(text) to service_role;
