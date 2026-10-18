-- 0021 Events: recoverable trash + agreed price for the admin list. Additive only.
--
-- * events.deleted_at / deleted_by: «حذف» from the admin moves an event to the trash (restorable). Nothing is
--   removed: media, deliverables, quotes, contracts, payments and expenses stay attached. A trashed event is not
--   public (events_public_read + app.event_is_public, which also gates public media and storage reads).
--   Customer/staff member access to their own event is unchanged (contracts and payments remain reachable).
-- * trash_event / restore_event: admin-only RPCs (aal2 via app.is_admin), audited by the existing events
--   update trigger. deleted_at/deleted_by have NO direct update grant.
-- * admin_event_prices(ids): agreed price per event with the SAME rule as event_financials.balance_basis:
--   approved contract total, else accepted quote total, else null («غير محدد»). Read-only, admin-only.

alter table public.events
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles(id) on delete set null;
create index events_deleted_idx on public.events (deleted_at) where deleted_at is not null;
create index events_deleted_by_idx on public.events (deleted_by);
grant select (deleted_at, deleted_by) on public.events to authenticated;

-- Public = published + consented + not in the trash.
create or replace function app.event_is_public(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id and e.is_published and e.publication_consent = 'granted' and e.deleted_at is null
  );
$$;

drop policy events_public_read on public.events;
create policy events_public_read on public.events for select to anon, authenticated
  using (is_published and publication_consent = 'granted' and deleted_at is null);

create or replace function public.trash_event(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.events set deleted_at = now(), deleted_by = auth.uid() where id = p_id and deleted_at is null;
  if not found then
    raise exception 'event not found or already in trash' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.restore_event(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.events set deleted_at = null, deleted_by = null where id = p_id and deleted_at is not null;
  if not found then
    raise exception 'event not found in trash' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.admin_event_prices(p_ids uuid[])
returns table (event_id uuid, amount bigint, basis text, currency char(3))
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select e.id,
         case when c.n > 0 then c.total when q.n > 0 then q.total end,
         case when c.n > 0 then 'contract' when q.n > 0 then 'quote' else 'none' end,
         'ILS'::char(3)
  from unnest(p_ids) as e(id)
  cross join lateral (
    select coalesce(sum(v.total), 0)::bigint as total, count(*) as n
    from public.contracts k join public.contract_versions v on v.id = k.approved_version_id
    where k.event_id = e.id and k.status = 'approved'
  ) c
  cross join lateral (
    select coalesce(sum(qq.total), 0)::bigint as total, count(*) as n
    from public.quotes qq where qq.event_id = e.id and qq.status = 'accepted'
  ) q;
end $$;

revoke execute on function public.trash_event(uuid), public.restore_event(uuid), public.admin_event_prices(uuid[]) from public, anon;
grant execute on function public.trash_event(uuid), public.restore_event(uuid), public.admin_event_prices(uuid[]) to authenticated, service_role;

-- Audit: event updates were recorded only for consent/publication changes; trash/restore (deleted_at) is now
-- recorded too. Same function as 0004 with deleted_at added to the compared fields.
create or replace function app.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_id uuid;
begin
  -- events: only audit consent/publication/trash changes
  if tg_table_name = 'events' and tg_op = 'UPDATE' then
    if (v_before -> 'publication_consent', v_before -> 'is_published', v_before -> 'featured', v_before -> 'public_slug', v_before -> 'deleted_at')
       is not distinct from (v_after -> 'publication_consent', v_after -> 'is_published', v_after -> 'featured', v_after -> 'public_slug', v_after -> 'deleted_at') then
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
