-- 0022 Enabled admin modules («الأقسام المفعّلة»).
-- UX only: decides which operational sections the admin sidebar lists. Data and
-- routes are untouched; every page keeps its own role guard.
--
-- Access: app_settings stays owner-only at the row level (existing 0005 policies:
-- owner read + owner update, audited by the 0004 audit trigger). Admins/staff need
-- the list to build their sidebar, so they read ONLY this column through
-- public.admin_enabled_modules() (security definer, staff roles only). No anon grant.

alter table public.app_settings
  add column enabled_modules text[] not null default '{customers,events,calendar}';

alter table public.app_settings
  add constraint app_settings_enabled_modules_allowed check (
    enabled_modules <@ array['bookings','customers','calendar','events','media','production',
                             'reviews','quotes','contracts','finance','staff','equipment','support']::text[]
    and array_position(enabled_modules, null) is null
  );

create or replace function public.admin_enabled_modules()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((select s.enabled_modules from public.app_settings s where s.id = 1), '{}'::text[]);
end;
$$;

revoke all on function public.admin_enabled_modules() from public, anon;
grant execute on function public.admin_enabled_modules() to authenticated;
