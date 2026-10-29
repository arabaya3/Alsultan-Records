-- 0027 (LOCAL ONLY until the owner decides): native reel files + a durable "also post to Facebook" queue.
--
-- Nothing here talks to Meta. The worker route (/api/jobs/facebook-reels) does, and only when ALL of these exist:
-- a connected Page (token in Vault), a queued job, and the Vault secrets facebook_jobs_url + jobs_secret.
-- Without them every piece is inert, and the admin shows «غير مربوط».
--
-- reel_videos          — a short vertical clip the owner uploads as a FILE (YouTube links cannot be posted to
--                        Facebook as a reel, and we never download from YouTube). Private bucket `reel-media`.
--                        The upload UI is a separate, later step (see docs/album-publishing-reels.md §Storage).
-- facebook_reel_posts  — one row per clip (unique reel_video_id) = idempotency: a double click or a retry can
--                        never create a second Facebook post. States:
--                          awaiting_connection → queued → publishing → published | failed
--                        meta_video_id is stored right after Meta's "start" phase, so a retry resumes the SAME
--                        Meta upload instead of starting another. meta_post_id is kept once published.
--                        Deleting the local clip keeps this row (reel_video_id set null) and never deletes the
--                        Facebook post.
-- meta_page_connection — the one Page the owner connected. The access token is NEVER in a table column: it lives
--                        in Vault (secret name 'meta_page_token'), readable only by service_role through
--                        public.meta_page_token(). Owners see page name/status only.
--
-- Rollback (local): drop the cron job 'facebook-reels', then the functions, tables and bucket below; delete the
-- Vault secret 'meta_page_token' if one was stored.

-- ================================================================ 1. native reel files
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reel-media', 'reel-media', false, 524288000, array['video/mp4', 'video/quicktime'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table public.reel_videos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 160),
  storage_path text not null unique check (storage_path ~ '^reels/[0-9a-f-]{36}\.(mp4|mov)$'),
  mime text not null check (mime in ('video/mp4', 'video/quicktime')),
  bytes bigint not null check (bytes > 0 and bytes <= 524288000),
  duration_s numeric(6, 2) check (duration_s is null or duration_s > 0),
  width int check (width is null or width > 0),
  height int check (height is null or height > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.reel_videos enable row level security;
create policy reel_videos_admin on public.reel_videos for all to authenticated using (app.is_admin()) with check (app.is_admin());
grant select, insert, update, delete on public.reel_videos to authenticated;

-- ================================================================ 2. page connection (no token column)
create table public.meta_page_connection (
  id smallint primary key default 1 check (id = 1),
  page_id text not null check (page_id ~ '^[0-9]{5,30}$'),
  page_name text not null check (char_length(page_name) between 1 and 200),
  status text not null default 'connected' check (status in ('connected', 'expired', 'disconnected')),
  graph_version text not null default 'v26.0' check (graph_version ~ '^v[0-9]+\.[0-9]+$'),
  connected_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  last_error text check (last_error is null or char_length(last_error) <= 500)
);
alter table public.meta_page_connection enable row level security;
create policy meta_page_connection_owner_read on public.meta_page_connection for select to authenticated using (app.is_owner());
grant select on public.meta_page_connection to authenticated;

create or replace function public.meta_page_token()
returns text language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'meta_page_token';
$$;
revoke execute on function public.meta_page_token() from public, anon, authenticated;
grant execute on function public.meta_page_token() to service_role;

-- Server-side only (the owner's action calls it with the service client after its own owner check).
create or replace function public.meta_connect(p_page_id text, p_page_name text, p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'invalid token' using errcode = '22023'; end if;
  select id into v_id from vault.secrets where name = 'meta_page_token';
  if v_id is null then perform vault.create_secret(p_token, 'meta_page_token', 'Facebook Page token (server only)');
  else perform vault.update_secret(v_id, p_token); end if;
  insert into public.meta_page_connection (id, page_id, page_name, status, connected_at, status_changed_at, last_error)
  values (1, p_page_id, p_page_name, 'connected', now(), now(), null)
  on conflict (id) do update set page_id = excluded.page_id, page_name = excluded.page_name, status = 'connected',
    connected_at = now(), status_changed_at = now(), last_error = null;
  -- jobs that were waiting for a connection can go now
  update public.facebook_reel_posts set status = 'queued', next_attempt_at = now(), updated_at = now()
   where status = 'awaiting_connection';
end $$;
revoke execute on function public.meta_connect(text, text, text) from public, anon, authenticated;
grant execute on function public.meta_connect(text, text, text) to service_role;

-- Disconnect: forget the token; published posts stay on Facebook; pending jobs wait for a new connection.
create or replace function public.meta_disconnect(p_status text default 'disconnected', p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('disconnected', 'expired') then raise exception 'bad status' using errcode = '22023'; end if;
  delete from vault.secrets where name = 'meta_page_token';
  update public.meta_page_connection set status = p_status, status_changed_at = now(), last_error = left(p_error, 500) where id = 1;
  update public.facebook_reel_posts set status = 'awaiting_connection', updated_at = now()
   where status in ('queued', 'publishing') and meta_post_id is null;
end $$;
revoke execute on function public.meta_disconnect(text, text) from public, anon, authenticated;
grant execute on function public.meta_disconnect(text, text) to service_role;

-- ================================================================ 3. publish queue
create table public.facebook_reel_posts (
  id uuid primary key default gen_random_uuid(),
  reel_video_id uuid unique references public.reel_videos(id) on delete set null,
  caption text check (caption is null or char_length(caption) <= 2200),
  status text not null default 'awaiting_connection'
    check (status in ('awaiting_connection', 'queued', 'publishing', 'published', 'failed')),
  page_id text,
  page_name text,
  meta_video_id text,
  meta_post_id text,
  attempts int not null default 0,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  requested_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check (status <> 'published' or meta_post_id is not null)
);
create index facebook_reel_posts_claim_idx on public.facebook_reel_posts (status, next_attempt_at);
alter table public.facebook_reel_posts enable row level security;
create policy facebook_reel_posts_owner_read on public.facebook_reel_posts for select to authenticated using (app.is_owner());
grant select on public.facebook_reel_posts to authenticated;

-- Owner action: explicit opt-in per clip. Idempotent: returns the existing row on a second call.
create or replace function public.request_facebook_reel_post(p_reel_video_id uuid, p_caption text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_conn public.meta_page_connection%rowtype;
begin
  if not app.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.reel_videos where id = p_reel_video_id) then
    raise exception 'unknown reel' using errcode = '22023';
  end if;
  select * into v_conn from public.meta_page_connection where id = 1;
  insert into public.facebook_reel_posts (reel_video_id, caption, status, page_id, page_name, requested_by)
  values (p_reel_video_id, nullif(btrim(p_caption), ''),
          case when v_conn.status = 'connected' then 'queued' else 'awaiting_connection' end,
          v_conn.page_id, v_conn.page_name, auth.uid())
  on conflict (reel_video_id) do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from public.facebook_reel_posts where reel_video_id = p_reel_video_id; end if;
  return v_id;
end $$;
revoke execute on function public.request_facebook_reel_post(uuid, text) from public, anon;
grant execute on function public.request_facebook_reel_post(uuid, text) to authenticated;

-- Worker claim (service_role): due queued jobs, plus "publishing" jobs whose worker died (> 10 min). Never a
-- published row. Respects Meta's 30 API-published reels per Page per 24 h (docs, checked 2026-10-28).
create or replace function public.claim_facebook_jobs(p_limit int default 2)
returns setof public.facebook_reel_posts language plpgsql set search_path = '' as $$
declare v_room int;
begin
  if not exists (select 1 from public.meta_page_connection where id = 1 and status = 'connected') then return; end if;
  select 30 - count(*) into v_room from public.facebook_reel_posts
   where published_at > now() - interval '24 hours' or (status = 'publishing' and claimed_at > now() - interval '24 hours');
  if v_room <= 0 then return; end if;
  return query
  with c as (
    select f.id from public.facebook_reel_posts f
     where f.reel_video_id is not null and f.meta_post_id is null and f.next_attempt_at <= now()
       and (f.status = 'queued' or (f.status = 'publishing' and f.claimed_at < now() - interval '10 minutes'))
     order by f.created_at
     limit least(greatest(1, coalesce(p_limit, 2)), v_room, 10)
     for update skip locked
  )
  update public.facebook_reel_posts q set status = 'publishing', claimed_at = now(), attempts = q.attempts + 1, updated_at = now()
    from c where q.id = c.id
  returning q.*;
end $$;
revoke execute on function public.claim_facebook_jobs(int) from public, anon, authenticated;
grant execute on function public.claim_facebook_jobs(int) to service_role;

create trigger audit after insert or update or delete on public.facebook_reel_posts
  for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.meta_page_connection
  for each row execute function app.audit_trigger();

-- Scheduler (same pattern as process-photos). No-op until the operator stores Vault secrets
-- facebook_jobs_url (https://<site>/api/jobs/facebook-reels) and jobs_secret, and a job is due.
create or replace function app.invoke_facebook_jobs(p_reason text default 'cron')
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_url text; v_key text; v_id bigint;
begin
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'facebook_jobs_url';
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'jobs_secret';
  if v_url is null or v_key is null then return null; end if;
  if not exists (select 1 from public.facebook_reel_posts where status in ('queued', 'publishing') and next_attempt_at <= now()) then
    return null;
  end if;
  select net.http_post(url := v_url, body := jsonb_build_object('reason', p_reason),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jobs-secret', v_key), timeout_milliseconds := 55000) into v_id;
  return v_id;
exception when others then
  raise warning 'facebook jobs invoke failed: %', sqlerrm;
  return null;
end $$;
revoke execute on function app.invoke_facebook_jobs(text) from public, anon, authenticated;
select cron.schedule('facebook-reels', '* * * * *', $$select app.invoke_facebook_jobs('cron')$$);
