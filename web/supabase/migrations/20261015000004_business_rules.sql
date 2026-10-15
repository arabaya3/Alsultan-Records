-- 0004 Business-rule triggers: column guards, booking state machine,
-- publication/consent, media visibility, album validation, computed money,
-- immutable contract versions, staff conflicts, audit trail.

-- ================================================================ column guards
-- profiles.role / disabled / mfa_required: never changeable by API roles.
create or replace function app.guard_profiles()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_api_role() and (
       new.role is distinct from old.role
    or new.disabled is distinct from old.disabled
    or new.mfa_required is distinct from old.mfa_required
    or new.id is distinct from old.id) then
    raise exception 'profiles.role/disabled/mfa_required can only be changed by an owner RPC'
      using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_profiles before update on public.profiles
for each row execute function app.guard_profiles();

-- customers.user_id / created_by: never changeable by API roles; notes admin-only.
create or replace function app.guard_customers()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_api_role() then
    if tg_op = 'INSERT' then
      if new.user_id is not null then
        raise exception 'customers.user_id is set only by provisioning or link RPC' using errcode = '42501';
      end if;
      new.created_by := auth.uid();
    else
      if new.user_id is distinct from old.user_id or new.created_by is distinct from old.created_by then
        raise exception 'customers.user_id cannot be changed' using errcode = '42501';
      end if;
      if new.notes is distinct from old.notes and not app.is_admin() then
        raise exception 'customers.notes is staff-only' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger guard_customers before insert or update on public.customers
for each row execute function app.guard_customers();

-- ================================================================ booking state machine
create or replace function app.booking_transition_allowed(p_from public.booking_status, p_to public.booking_status)
returns boolean language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (
    ('new'::public.booking_status, 'contacted'::public.booking_status),
    ('new', 'declined'), ('new', 'cancelled'),
    ('contacted', 'quoted'), ('contacted', 'declined'), ('contacted', 'cancelled'),
    ('quoted', 'confirmed'), ('quoted', 'declined'), ('quoted', 'cancelled'), ('quoted', 'contacted'),
    ('confirmed', 'cancelled')
  );
$$;

create or replace function app.booking_status_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'new' and app.is_api_role() then
      raise exception 'new bookings start in status new' using errcode = '22023';
    end if;
    insert into public.booking_stage_history (booking_request_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    if not app.booking_transition_allowed(old.status, new.status) then
      raise exception 'invalid booking transition % -> %', old.status, new.status using errcode = '22023';
    end if;
    insert into public.booking_stage_history (booking_request_id, from_status, to_status, note, changed_by)
    values (new.id, old.status, new.status, nullif(current_setting('app.transition_note', true), ''), auth.uid());
  end if;
  return new;
end $$;
create trigger booking_status_insert after insert on public.booking_requests
for each row execute function app.booking_status_trigger();
create trigger booking_status_update before update of status on public.booking_requests
for each row execute function app.booking_status_trigger();

-- ================================================================ publication & consent
create or replace function app.events_publication_trigger()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Consent leaving 'granted' always unpublishes (and un-features).
  if new.publication_consent <> 'granted' then
    new.is_published := false;
    new.featured := false;
  end if;
  if tg_op = 'UPDATE' and new.publication_consent is distinct from old.publication_consent then
    new.consent_at := now();
    new.consent_by := auth.uid();
  end if;
  if app.is_api_role() and tg_op = 'INSERT' and (new.is_published or new.publication_consent <> 'none') then
    raise exception 'publication/consent are set via RPC only' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger events_publication before insert or update on public.events
for each row execute function app.events_publication_trigger();

-- After an event stops being public, its media can no longer be public.
create or replace function app.events_unpublish_media()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.is_published and not new.is_published then
    update public.media_assets set visibility = 'private'
    where event_id = new.id and visibility = 'public';
  end if;
  return null;
end $$;
create trigger events_unpublish_media after update of is_published, publication_consent on public.events
for each row execute function app.events_unpublish_media();

-- Public media only for publishable events (or event-less site media).
create or replace function app.media_visibility_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.visibility = 'public' and new.event_id is not null and not app.event_is_public(new.event_id) then
    raise exception 'media can be public only when its event is published with consent' using errcode = '42501';
  end if;
  if new.event_id is not null and tg_op = 'UPDATE' and new.event_id <> old.event_id and app.is_api_role() then
    raise exception 'media_assets.event_id cannot change' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and app.is_api_role() then
    new.uploaded_by := auth.uid();
  end if;
  return new;
end $$;
create trigger media_visibility before insert or update on public.media_assets
for each row execute function app.media_visibility_trigger();

-- ================================================================ deliverable revisions numbering
create or replace function app.revision_number_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  perform 1 from public.deliverables d where d.id = new.deliverable_id for update;
  select coalesce(max(r.revision_no), 0) + 1 into new.revision_no
  from public.deliverable_revisions r where r.deliverable_id = new.deliverable_id;
  if new.media_asset_id is not null then
    select d.event_id into v_event from public.deliverables d where d.id = new.deliverable_id;
    if not exists (select 1 from public.media_assets m where m.id = new.media_asset_id and m.event_id = v_event) then
      raise exception 'revision media must belong to the deliverable event' using errcode = '23514';
    end if;
  end if;
  if app.is_api_role() then new.created_by := auth.uid(); end if;
  return new;
end $$;
create trigger revision_number before insert on public.deliverable_revisions
for each row execute function app.revision_number_trigger();

create or replace function app.video_comment_author_trigger()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_api_role() then
    if tg_op = 'INSERT' then
      new.author_id := auth.uid();
    elsif new.body is distinct from old.body or new.timecode_ms is distinct from old.timecode_ms
       or new.author_id is distinct from old.author_id or new.revision_id is distinct from old.revision_id then
      if old.author_id is distinct from auth.uid() or new.author_id is distinct from old.author_id
         or new.revision_id is distinct from old.revision_id then
        raise exception 'only the author may edit a comment body' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger video_comment_author before insert or update on public.video_comments
for each row execute function app.video_comment_author_trigger();

-- ================================================================ album selections
create or replace function app.album_item_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_sel record;
begin
  select s.event_id, s.status into v_sel from public.album_selections s where s.id = new.selection_id;
  if not exists (
    select 1 from public.media_assets m
    where m.id = new.media_asset_id and m.event_id = v_sel.event_id and m.kind = 'image'
  ) then
    raise exception 'album item must be an image of the same event' using errcode = '23514';
  end if;
  if v_sel.status <> 'draft' and app.is_api_role() then
    raise exception 'selection is no longer editable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger album_item_validate before insert or update on public.album_selection_items
for each row execute function app.album_item_trigger();

create or replace function app.album_item_delete_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if app.is_api_role() and exists (
    select 1 from public.album_selections s where s.id = old.selection_id and s.status <> 'draft'
  ) then
    raise exception 'selection is no longer editable' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger album_item_delete before delete on public.album_selection_items
for each row execute function app.album_item_delete_trigger();

create or replace function app.album_selection_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_api_role() and tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'selections start as draft' using errcode = '42501';
    end if;
    if not app.is_admin() then
      -- customer_id is always the event's customer
      new.customer_id := app.customer_id();
    end if;
  end if;
  if tg_op = 'INSERT' and not exists (
    select 1 from public.events e where e.id = new.event_id and e.customer_id = new.customer_id
  ) then
    raise exception 'selection customer must own the event' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger album_selection_guard before insert on public.album_selections
for each row execute function app.album_selection_guard();

-- Immutable rows helper (snapshots, contract versions).
create or replace function app.block_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% rows are immutable', tg_table_name using errcode = '42501';
end $$;
create trigger album_snapshots_immutable before update or delete on public.album_selection_snapshots
for each row execute function app.block_mutation();

-- ================================================================ money: quotes
create or replace function app.quote_item_line_total()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.line_total := round(new.qty * new.unit_price)::bigint;
  return new;
end $$;
create trigger quote_item_line_total before insert or update on public.quote_items
for each row execute function app.quote_item_line_total();

create or replace function app.recalc_quote(p_quote_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.quotes q
  set subtotal = coalesce((select sum(i.line_total) from public.quote_items i where i.quote_id = q.id), 0)
  where q.id = p_quote_id;
end $$;

create or replace function app.quote_items_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform app.recalc_quote(old.quote_id); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform app.recalc_quote(new.quote_id); end if;
  return null;
end $$;
create trigger quote_items_after after insert or update or delete on public.quote_items
for each row execute function app.quote_items_after();

create or replace function app.quote_totals()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_api_role() and tg_op = 'UPDATE' and old.status <> 'draft'
     and (new.subtotal, new.discount, new.currency) is distinct from (old.subtotal, old.discount, old.currency)
     and current_setting('app.recalc', true) is distinct from 'on' then
    raise exception 'only draft quotes can change amounts' using errcode = '42501';
  end if;
  if app.is_api_role() then
    -- client-provided subtotal/total are ignored
    if tg_op = 'INSERT' then new.subtotal := 0; else new.subtotal := old.subtotal; end if;
    if new.status = 'accepted' and (tg_op = 'INSERT' or old.status <> 'accepted') then
      raise exception 'quotes are accepted by the customer RPC only' using errcode = '42501';
    end if;
  end if;
  if new.discount > new.subtotal then
    raise exception 'discount exceeds subtotal' using errcode = '23514';
  end if;
  new.total := new.subtotal - new.discount;
  return new;
end $$;
create trigger quote_totals before insert or update on public.quotes
for each row execute function app.quote_totals();

-- quote items only editable while quote is draft
create or replace function app.quote_items_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_quote uuid := coalesce(new.quote_id, old.quote_id);
begin
  if app.is_api_role() and exists (select 1 from public.quotes q where q.id = v_quote and q.status <> 'draft') then
    raise exception 'quote items are editable only while the quote is draft' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger quote_items_guard before insert or update or delete on public.quote_items
for each row execute function app.quote_items_guard();

-- ================================================================ contracts
create or replace function app.contract_version_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.contracts c where c.id = new.contract_id for update;
  if exists (select 1 from public.contracts c where c.id = new.contract_id and c.status in ('approved', 'void')) then
    raise exception 'cannot add versions to an approved/void contract' using errcode = '42501';
  end if;
  select coalesce(max(v.version_no), 0) + 1 into new.version_no
  from public.contract_versions v where v.contract_id = new.contract_id;
  new.content_hash := encode(sha256(convert_to(
    new.body || E'\n' || new.currency || E'\n' || new.total::text || E'\n' || new.deposit_required::text, 'UTF8')), 'hex');
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end $$;
create trigger contract_version_before_insert before insert on public.contract_versions
for each row execute function app.contract_version_before_insert();

create or replace function app.contract_version_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.contracts set current_version_id = new.id where id = new.contract_id;
  return null;
end $$;
create trigger contract_version_after_insert after insert on public.contract_versions
for each row execute function app.contract_version_after_insert();

create trigger contract_versions_immutable before update or delete on public.contract_versions
for each row execute function app.block_mutation();

create or replace function app.contracts_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_api_role() then
    if tg_op = 'INSERT' then
      if new.status not in ('draft') or new.current_version_id is not null or new.approved_version_id is not null then
        raise exception 'contracts start as draft without versions' using errcode = '42501';
      end if;
    else
      if new.status = 'approved' and old.status <> 'approved' then
        raise exception 'contracts are approved by the customer RPC only' using errcode = '42501';
      end if;
      if old.status = 'approved' and new.status not in ('approved', 'void') then
        raise exception 'approved contracts can only be voided' using errcode = '42501';
      end if;
      if (new.current_version_id, new.approved_version_id, new.approved_at, new.approved_by, new.customer_id)
         is distinct from (old.current_version_id, old.approved_version_id, old.approved_at, old.approved_by, old.customer_id) then
        raise exception 'contract version/approval/customer fields are system-managed' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger contracts_guard before insert or update on public.contracts
for each row execute function app.contracts_guard();

-- ================================================================ staff conflicts
create or replace function app.staff_conflict_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_date date;
begin
  select e.event_date into v_date from public.events e where e.id = new.event_id;
  if v_date is not null and nullif(btrim(coalesce(new.override_reason, '')), '') is null and exists (
    select 1 from public.event_staff_assignments a
    join public.events e on e.id = a.event_id
    where a.staff_id = new.staff_id and a.event_id <> new.event_id and e.event_date = v_date
      and a.id <> new.id
  ) then
    raise exception 'staff member already assigned to another event on %', v_date
      using errcode = '23P01', hint = 'Provide override_reason to double-book.';
  end if;
  return new;
end $$;
create trigger staff_conflict before insert or update on public.event_staff_assignments
for each row execute function app.staff_conflict_trigger();

-- ================================================================ reviews
create or replace function app.reviews_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_api_role() and not app.is_admin() then
    if tg_op = 'INSERT' then
      new.status := 'pending';
      new.moderated_by := null;
      new.moderated_at := null;
      new.customer_id := app.customer_id();
    end if;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.moderated_by := auth.uid();
    new.moderated_at := now();
  end if;
  return new;
end $$;
create trigger reviews_guard before insert or update on public.reviews
for each row execute function app.reviews_guard();

-- ================================================================ support / notifications
create or replace function app.support_message_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_api_role() then
    new.author_id := auth.uid();
    new.is_staff_reply := app.is_staff();
  end if;
  return new;
end $$;
create trigger support_message_guard before insert on public.support_messages
for each row execute function app.support_message_guard();

create or replace function app.notifications_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_api_role() and (new.recipient_id, new.kind, new.payload) is distinct from (old.recipient_id, old.kind, old.payload) then
    raise exception 'only read_at can be updated' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger notifications_guard before update on public.notifications
for each row execute function app.notifications_guard();

create or replace function app.expenses_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_api_role() then new.recorded_by := auth.uid(); end if;
  return new;
end $$;
create trigger expenses_guard before insert on public.expenses
for each row execute function app.expenses_guard();

-- ================================================================ audit
create or replace function app.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_id uuid;
begin
  -- events: only audit consent/publication changes
  if tg_table_name = 'events' and tg_op = 'UPDATE' then
    if (v_before -> 'publication_consent', v_before -> 'is_published', v_before -> 'featured', v_before -> 'public_slug')
       is not distinct from (v_after -> 'publication_consent', v_after -> 'is_published', v_after -> 'featured', v_after -> 'public_slug') then
      return null;
    end if;
  end if;
  begin
    v_id := coalesce(v_after ->> 'id', v_before ->> 'id')::uuid;
  exception when others then v_id := null;
  end;
  insert into public.audit_events (actor, action, entity_type, entity_id, before, after)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id, v_before, v_after);
  return null;
end $$;

create trigger audit after insert or update or delete on public.profiles for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.payments for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.expenses for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.contracts for each row execute function app.audit_trigger();
create trigger audit after insert on public.contract_versions for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.quotes for each row execute function app.audit_trigger();
create trigger audit after update on public.events for each row execute function app.audit_trigger();
create trigger audit after update on public.app_settings for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.staff_members for each row execute function app.audit_trigger();

-- audit_events is append-only
create trigger audit_events_immutable before update or delete on public.audit_events
for each row execute function app.block_mutation();

revoke execute on all functions in schema app from public;
-- trigger functions run as table owner/definer; API roles need execute only on policy helpers (granted in 0003).
grant execute on function app.booking_transition_allowed(public.booking_status, public.booking_status) to authenticated, service_role;
