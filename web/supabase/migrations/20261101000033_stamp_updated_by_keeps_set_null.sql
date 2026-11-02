-- 0033 Deleting a user no longer leaves rows pointing at that user.
-- ON DELETE SET NULL runs an UPDATE with no user session; stamp_updated_by put the old value straight back, and Postgres
-- does not re-check a key it sees as unchanged. That left one nav_items row pointing at a deleted user, which breaks
-- nav_items_updated_by_fkey on any restore.
create or replace function app.stamp_updated_by()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.updated_by is null and old.updated_by is not null then
    return new; -- the foreign key clearing a deleted user
  end if;
  new.updated_by := coalesce((select auth.uid()), case when tg_op = 'UPDATE' then old.updated_by end);
  return new;
end $$;

-- The one row found on 2026-10-31. Clears only a reference to a user who no longer exists.
update public.nav_items n set updated_by = null
 where n.updated_by is not null and not exists (select 1 from public.profiles p where p.id = n.updated_by);
