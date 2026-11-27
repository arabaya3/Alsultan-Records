-- 0041 Database hygiene (technical audit OPS-07, OPS-08, OPS-09).
--
-- 1. photo_albums / showcase_videos stamp triggers: the 0033 fix (ON DELETE SET NULL must not be undone) was applied
--    to app.stamp_updated_by only. These two own copies still put the old updated_by back when a user is deleted,
--    leaving rows that point at a deleted user and breaking the FK check on any restore. Same fix + the same one-off
--    data repair (only references to users that no longer exist are cleared).
-- 2. app.daily_hygiene(), scheduled once a day (03:17 UTC):
--    - quotes still 'sent' after valid_until (Asia/Hebron date) become 'expired'. customer_accept_quote set 'expired'
--      and then raised, so the update was rolled back and expiry was never saved.
--    - cron.job_run_details older than 7 days are deleted (three jobs run every minute: ~4,300 rows a day, never purged).
--    - private.storage_cleanup_queue rows finished (done_at) more than 30 days ago are deleted. Pending rows are never
--      touched.
--    audit_events is NOT trimmed here: its retention is the owner's decision (see docs/owner-decisions.md).

-- ---------------------------------------------------------------- 1. stamp triggers
create or replace function app.photo_albums_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.updated_by is null and old.updated_by is not null then
    return new; -- the foreign key clearing a deleted user (0033)
  end if;
  new.updated_by := coalesce((select auth.uid()), case when tg_op = 'UPDATE' then old.updated_by end);
  return new;
end $$;

create or replace function app.showcase_videos_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.updated_by is null and old.updated_by is not null then
    return new; -- the foreign key clearing a deleted user (0033)
  end if;
  new.updated_by := coalesce((select auth.uid()), case when tg_op = 'UPDATE' then old.updated_by end);
  return new;
end $$;

update public.photo_albums a set updated_by = null
 where a.updated_by is not null and not exists (select 1 from public.profiles p where p.id = a.updated_by);
update public.showcase_videos v set updated_by = null
 where v.updated_by is not null and not exists (select 1 from public.profiles p where p.id = v.updated_by);

-- ---------------------------------------------------------------- 2. daily hygiene
create or replace function app.daily_hygiene()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_quotes int; v_cron int := 0; v_queue int;
begin
  update public.quotes set status = 'expired'
   where status = 'sent' and valid_until is not null and valid_until < (now() at time zone 'Asia/Hebron')::date;
  get diagnostics v_quotes = row_count;

  if to_regclass('cron.job_run_details') is not null then
    delete from cron.job_run_details where end_time < now() - interval '7 days';
    get diagnostics v_cron = row_count;
  end if;

  delete from private.storage_cleanup_queue where done_at is not null and done_at < now() - interval '30 days';
  get diagnostics v_queue = row_count;

  return jsonb_build_object('quotes_expired', v_quotes, 'cron_runs_deleted', v_cron, 'cleanup_rows_deleted', v_queue);
end $$;
revoke all on function app.daily_hygiene() from public;

select cron.schedule('daily-hygiene', '17 3 * * *', $$select app.daily_hygiene()$$);
