-- 0011 User deletion vs immutable rows.
--
-- Problem: immutable tables reference profiles with ON DELETE SET NULL. Deleting an
-- auth user cascades auth.users -> profiles -> SET NULL on those columns, and the
-- blanket block_mutation() trigger rejected that update, so the delete failed.
--
-- Audit (tables guarded by block_mutation):
--   album_selection_snapshots.submitted_by -> profiles  SET NULL   (conflict, fixed)
--   contract_versions.created_by           -> profiles  SET NULL   (conflict, fixed)
--   audit_events.actor                     -> no FK                (no conflict)
-- Not immutable (no guard, SET NULL is fine): payments.recorded_by, booking_stage_history.changed_by,
--   expenses.recorded_by, quotes.accepted_by, contracts.approved_by, reviews.moderated_by, etc.
--   (their UPDATE triggers ignore non-API callers; payments/quotes/contracts audit the change.)
--
-- Semantics: content stays immutable. The ONLY permitted update is the listed
-- actor column(s) going to NULL, with every other column unchanged. Losing the
-- link to a deleted account is acceptable; the audit_events trail keeps the
-- historical actor uuid. DELETE stays blocked.
-- updated_at triggers are dropped on these tables so the permitted update does
-- not touch any other column.

create or replace function app.block_mutation_except_null_fk()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_col text;
begin
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
revoke execute on function app.block_mutation_except_null_fk() from public;

drop trigger album_snapshots_immutable on public.album_selection_snapshots;
create trigger album_snapshots_immutable before update or delete on public.album_selection_snapshots
for each row execute function app.block_mutation_except_null_fk('submitted_by');
drop trigger if exists set_updated_at on public.album_selection_snapshots;

drop trigger contract_versions_immutable on public.contract_versions;
create trigger contract_versions_immutable before update or delete on public.contract_versions
for each row execute function app.block_mutation_except_null_fk('created_by');
drop trigger if exists set_updated_at on public.contract_versions;

-- audit_events has no FK; keep the blanket guard, but drop its updated_at trigger for consistency.
drop trigger if exists set_updated_at on public.audit_events;
