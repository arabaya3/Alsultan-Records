-- 0023 Audit gaps + owner session revocation (review of PR #1). Additive and non-destructive: no data is changed.
--
-- 1. Audit coverage for destructive / publishing decisions that were not recorded:
--    - events: creation and HARD delete (updates were already audited, filtered to publish/trash fields);
--    - media_assets: visibility (publish/unpublish of a single asset) and deletes;
--    - reviews: status changes (approval publishes customer text) and deletes;
--    - customers: deletes — recorded WITHOUT the row content (id only): customers.notes is private and the audit
--      table is readable by admins.
-- 2. public.admin_revoke_user_sessions(uuid): owner-only; ends every session (refresh tokens) of ANOTHER user, used
--    right after the owner sets a new password for that account. Audited. Access tokens already issued stay valid
--    until they expire (≤ 1 h); every server request re-reads the profile, and disabling the account is immediate.

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
  -- customers: never copy private fields (notes, contact data) into the admin-readable audit table
  if tg_table_name = 'customers' then
    v_before := case when v_before is null then null else jsonb_build_object('id', v_id) end;
    v_after := case when v_after is null then null else jsonb_build_object('id', v_id) end;
  end if;
  insert into public.audit_events (actor, action, entity_type, entity_id, before, after)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id, v_before, v_after);
  return null;
end $$;

drop trigger if exists audit on public.events;
create trigger audit after insert or update or delete on public.events
  for each row execute function app.audit_trigger();

-- Only real value changes (other triggers re-assign visibility in bulk; unchanged values are not decisions).
drop trigger if exists audit on public.media_assets;
drop trigger if exists audit_visibility on public.media_assets;
create trigger audit_visibility after update of visibility on public.media_assets
  for each row when (old.visibility is distinct from new.visibility) execute function app.audit_trigger();
create trigger audit after delete on public.media_assets
  for each row execute function app.audit_trigger();

drop trigger if exists audit on public.reviews;
drop trigger if exists audit_status on public.reviews;
create trigger audit_status after update of status on public.reviews
  for each row when (old.status is distinct from new.status) execute function app.audit_trigger();
create trigger audit after delete on public.reviews
  for each row execute function app.audit_trigger();

drop trigger if exists audit on public.customers;
create trigger audit after delete on public.customers
  for each row execute function app.audit_trigger();

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
  delete from auth.sessions where user_id = p_user_id; -- refresh tokens cascade with their session
  get diagnostics v_count = row_count;
  insert into public.audit_events (actor, action, entity_type, entity_id, after)
  values (auth.uid(), 'sessions_revoked', 'auth.users', p_user_id, jsonb_build_object('sessions', v_count));
  return v_count;
end;
$$;

revoke all on function public.admin_revoke_user_sessions(uuid) from public, anon;
grant execute on function public.admin_revoke_user_sessions(uuid) to authenticated;
