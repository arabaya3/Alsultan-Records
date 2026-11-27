-- 0037 facebook_album_posts and reel_videos are audited like every other business table.
begin;
select plan(4);

insert into public.reel_videos (id, title, storage_path, mime, bytes)
values ('00000000-0000-4000-8000-00000000dd01', 'pgTAP reel', 'reels/00000000-0000-4000-8000-00000000dd01.mp4', 'video/mp4', 10);
select is((select count(*)::int from public.audit_events where entity_type = 'reel_videos' and entity_id = '00000000-0000-4000-8000-00000000dd01' and action = 'insert'), 1, 'reel insert audited');
update public.reel_videos set title = 'pgTAP reel 2' where id = '00000000-0000-4000-8000-00000000dd01';
select is((select count(*)::int from public.audit_events where entity_type = 'reel_videos' and entity_id = '00000000-0000-4000-8000-00000000dd01' and action = 'update'), 1, 'reel update audited');

insert into public.facebook_album_posts (id, page_id, page_name, title, photo_ids)
values ('00000000-0000-4000-8000-00000000dd02', '1234567890', 'pgTAP Page', 'pgTAP album', array['00000000-0000-4000-8000-00000000dd03']::uuid[]);
select is((select count(*)::int from public.audit_events where entity_type = 'facebook_album_posts' and entity_id = '00000000-0000-4000-8000-00000000dd02' and action = 'insert'), 1, 'Facebook album post insert audited');
update public.facebook_album_posts set status = 'published', fb_album_id = '900100' where id = '00000000-0000-4000-8000-00000000dd02';
select is((select after ->> 'status' from public.audit_events where entity_type = 'facebook_album_posts' and entity_id = '00000000-0000-4000-8000-00000000dd02' and action = 'update'), 'published', 'its status change is audited with the new value');

select * from finish();
rollback;
