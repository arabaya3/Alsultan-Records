-- 0037 Audit the two tables 0027/0034/0035 left out: facebook_album_posts (a public post on the studio's Page) and
-- reel_videos (studio reel files, whose status/store columns admins can write). Same trigger as every other audited
-- table (app.audit_trigger: actor, action, before/after). Additive only: no data, policy or grant changes.
create trigger audit after insert or update or delete on public.facebook_album_posts
  for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.reel_videos
  for each row execute function app.audit_trigger();
