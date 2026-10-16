-- 0012 Test-fixture purge for staging verification runs.
--
-- public.purge_test_fixtures(p_prefix) (service_role only) removes rows whose
-- names start with '[STAGING-TEST]' or '[RESTORE-TEST]' together with everything
-- that hangs off them. Append-only rows (album_selection_snapshots,
-- contract_versions) may only be deleted when BOTH:
--   * the transaction-local GUC app.purge_test_fixtures = 'on' (set only by this
--     function, with the prefix in app.purge_prefix), the caller is not an API role, AND
--   * the row belongs to a prefixed event / contract / customer.
-- audit_events are never deleted; one summary audit row is written instead.
-- Storage objects are enqueued in private.storage_cleanup_queue (reason 'test_purge').

create or replace function app.purge_allows(p_table text, p_row jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prefix text := current_setting('app.purge_prefix', true);
begin
  if coalesce(current_setting('app.purge_test_fixtures', true), '') <> 'on'
     or v_prefix not in ('[STAGING-TEST]', '[RESTORE-TEST]') then
    return false;
  end if;
  if p_table = 'album_selection_snapshots' then
    return exists (select 1 from public.events e
                   where e.id = (p_row ->> 'event_id')::uuid and left(e.title, length(v_prefix)) = v_prefix);
  elsif p_table = 'contract_versions' then
    return exists (select 1 from public.contracts k
                   left join public.events e on e.id = k.event_id
                   join public.customers c on c.id = k.customer_id
                   where k.id = (p_row ->> 'contract_id')::uuid
                     and (left(coalesce(e.title, ''), length(v_prefix)) = v_prefix
                          or left(c.full_name, length(v_prefix)) = v_prefix));
  end if;
  return false;
end;
$$;
revoke execute on function app.purge_allows(text, jsonb) from public, anon, authenticated;

-- Replaces 0011: adds the narrow purge bypass for DELETE.
create or replace function app.block_mutation_except_null_fk()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_col text;
begin
  if tg_op = 'DELETE' and not app.is_api_role() and app.purge_allows(tg_table_name, to_jsonb(old)) then
    return old;
  end if;
  if tg_op = 'UPDATE' and not app.is_api_role() and tg_nargs > 0 then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    foreach v_col in array tg_argv loop
      if v_new -> v_col <> 'null'::jsonb and (v_new -> v_col) is distinct from (v_old -> v_col) then
        raise exception '% rows are immutable (only % may be cleared)', tg_table_name, v_col using errcode = '42501';
      end if;
      v_old := v_old - v_col;
      v_new := v_new - v_col;
    end loop;
    if v_old = v_new then
      return new;
    end if;
  end if;
  raise exception '% rows are immutable', tg_table_name using errcode = '42501';
end $$;

create or replace function public.purge_test_fixtures(p_prefix text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_events uuid[];
  v_customers uuid[];
  v_contracts uuid[];
  v_counts jsonb := '{}'::jsonb;
  v_n int;
begin
  if p_prefix is null or p_prefix not in ('[STAGING-TEST]', '[RESTORE-TEST]') then
    raise exception 'invalid purge prefix' using errcode = '22023';
  end if;
  perform set_config('app.purge_test_fixtures', 'on', true);
  perform set_config('app.purge_prefix', p_prefix, true);

  select coalesce(array_agg(id), '{}') into v_events
  from public.events where left(title, length(p_prefix)) = p_prefix;

  -- prefixed customers that have no remaining non-prefixed events
  select coalesce(array_agg(c.id), '{}') into v_customers
  from public.customers c
  where left(c.full_name, length(p_prefix)) = p_prefix
    and not exists (select 1 from public.events e where e.customer_id = c.id and not (e.id = any(v_events)));

  select coalesce(array_agg(id), '{}') into v_contracts
  from public.contracts where event_id = any(v_events) or customer_id = any(v_customers);

  -- storage objects -> cleanup queue (media rows deleted now so the event delete trigger enqueues nothing twice)
  insert into private.storage_cleanup_queue (bucket, path, reason)
  select m.bucket::text, p, 'test_purge'
  from public.media_assets m, app.media_paths(m.path, m.variants) p
  where m.event_id = any(v_events);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('storage_paths_enqueued', v_n);

  delete from public.media_assets where event_id = any(v_events);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('media_assets', v_n);

  delete from public.payments
  where event_id = any(v_events) or contract_id = any(v_contracts) or customer_id = any(v_customers);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('payments', v_n);

  delete from public.expenses where event_id = any(v_events);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('expenses', v_n);

  update public.contracts set current_version_id = null, approved_version_id = null where id = any(v_contracts);
  delete from public.contract_versions where contract_id = any(v_contracts);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('contract_versions', v_n);
  delete from public.contracts where id = any(v_contracts);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('contracts', v_n);

  delete from public.quotes where event_id = any(v_events) or customer_id = any(v_customers);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('quotes', v_n);

  delete from public.album_selection_snapshots where event_id = any(v_events);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('album_selection_snapshots', v_n);
  delete from public.album_selections where event_id = any(v_events);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('album_selections', v_n);

  delete from public.reviews where event_id = any(v_events) or customer_id = any(v_customers)
     or left(coalesce(display_name, ''), length(p_prefix)) = p_prefix or left(body, length(p_prefix)) = p_prefix;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('reviews', v_n);

  -- deliverables/revisions/comments, staff & equipment assignments cascade with the event
  delete from public.events where id = any(v_events);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('events', v_n);

  delete from public.support_requests
  where customer_id = any(v_customers)
     or left(subject, length(p_prefix)) = p_prefix
     or left(coalesce(contact_name, ''), length(p_prefix)) = p_prefix;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('support_requests', v_n);

  delete from public.booking_requests
  where customer_id = any(v_customers) or left(contact_name, length(p_prefix)) = p_prefix;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('booking_requests', v_n);

  delete from public.customers where id = any(v_customers);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('customers', v_n);

  delete from public.staff_members where left(full_name, length(p_prefix)) = p_prefix;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('staff_members', v_n);

  delete from public.equipment where left(name, length(p_prefix)) = p_prefix;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('equipment', v_n);

  insert into public.audit_events (actor, action, entity_type, entity_id, after)
  values (auth.uid(), 'purge_test_fixtures', 'test_fixtures', null,
          jsonb_build_object('prefix', p_prefix, 'counts', v_counts));

  perform set_config('app.purge_test_fixtures', 'off', true);
  perform set_config('app.purge_prefix', '', true);
  return v_counts;
end;
$$;

revoke execute on function public.purge_test_fixtures(text) from public, anon, authenticated;
grant execute on function public.purge_test_fixtures(text) to service_role;
