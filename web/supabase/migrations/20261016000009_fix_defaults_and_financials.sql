-- 0009 Fixes from QA.
-- (1) Column defaults that call app.* run as the INVOKING role. Audit result:
--     quotes.quote_no, booking_requests.tracking_code, support_requests.tracking_code
--     -> app.random_code(), which in turn calls extensions.gen_random_bytes().
--     Trigger functions are exempt from EXECUTE checks; the app.* helpers they
--     call as invoker (is_api_role, is_admin, is_staff, customer_id,
--     event_is_public) were already granted in 0003.
--     Fix: make random_code SECURITY DEFINER (so the extension call runs as
--     owner) and grant EXECUTE to API roles. It only returns random text.
create or replace function app.random_code(p_len int default 10)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(least(greatest(p_len, 1), 64));
  result text := '';
  i int;
begin
  for i in 0 .. length(bytes) - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end;
$$;
revoke execute on function app.random_code(int) from public;
grant execute on function app.random_code(int) to authenticated, service_role;

-- (3) event_financials: add `quoted` (accepted quote totals) and base balance on
--     the approved contract total when one exists, otherwise the accepted quote
--     total, otherwise 0. Return type changes, so drop + recreate.
drop function if exists public.event_financials(uuid);
create function public.event_financials(p_event_id uuid)
returns table (event_id uuid, currency char(3), contracted bigint, paid bigint, refunded bigint,
               expenses bigint, balance bigint, quoted bigint, balance_basis text)
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
    select coalesce(sum(v.total), 0)::bigint as contracted, count(*) as n
    from public.contracts k join public.contract_versions v on v.id = k.approved_version_id
    where k.event_id = p_event_id and k.status = 'approved'
  ), q as (
    select coalesce(sum(total), 0)::bigint as quoted, count(*) as n
    from public.quotes where quotes.event_id = p_event_id and status = 'accepted'
  ), p as (
    select coalesce(sum(amount) filter (where kind = 'payment'), 0)::bigint as paid,
           coalesce(sum(amount) filter (where kind = 'refund'), 0)::bigint as refunded
    from public.payments where payments.event_id = p_event_id
  ), x as (
    select coalesce(sum(amount), 0)::bigint as expenses from public.expenses where expenses.event_id = p_event_id
  )
  select p_event_id, 'ILS'::char(3), c.contracted, p.paid, p.refunded,
         case when v_is_admin then x.expenses end,
         ((case when c.n > 0 then c.contracted when q.n > 0 then q.quoted else 0 end) - p.paid + p.refunded)::bigint,
         q.quoted,
         case when c.n > 0 then 'contract' when q.n > 0 then 'quote' else 'none' end
  from c, q, p, x;
end;
$$;
revoke execute on function public.event_financials(uuid) from public, anon;
grant execute on function public.event_financials(uuid) to authenticated, service_role;
