-- 0014 service_role grants for the 0013 objects.
-- 0005's `grant all on all tables in schema public to service_role` only covered tables that
-- existed then; on the hosted project new tables are not auto-granted to service_role
-- (local default privileges masked this). The import script and server-side jobs need them.
grant all on table public.showcase_videos to service_role;
grant select on public.showcase_video_admin_details to service_role;
grant execute on function public.set_showcase_promo(uuid) to service_role;
