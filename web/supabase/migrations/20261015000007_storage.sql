-- 0007 Storage buckets and storage.objects policies.
--   public-media : public read (CDN URLs), write admin/owner only.
--   private-media: no public access. Path convention events/{event_id}/{asset_id}/{variant}.{ext}
--                  write: admin, or staff assigned to the event.
--                  read : admin, assigned staff, or the customer who owns the event
--                         (the app mints short-lived signed URLs server-side).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('public-media', 'public-media', true, 52428800,          -- 50 MiB
   array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4', 'video/webm']),
  ('private-media', 'private-media', false, 2147483648,     -- 2 GiB
   array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic',
         'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf', 'application/zip'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- public-media
create policy "public-media read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'public-media');
create policy "public-media admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'public-media' and app.is_admin());
create policy "public-media admin update" on storage.objects for update to authenticated
  using (bucket_id = 'public-media' and app.is_admin())
  with check (bucket_id = 'public-media' and app.is_admin());
create policy "public-media admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'public-media' and app.is_admin());

-- private-media
create policy "private-media read" on storage.objects for select to authenticated
  using (bucket_id = 'private-media' and (
    app.is_admin()
    or app.is_assigned(app.path_event_id(name))
    or app.owns_event(app.path_event_id(name))));
create policy "private-media staff insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'private-media' and app.path_event_id(name) is not null
              and app.can_work_event(app.path_event_id(name)));
create policy "private-media staff update" on storage.objects for update to authenticated
  using (bucket_id = 'private-media' and app.can_work_event(app.path_event_id(name)))
  with check (bucket_id = 'private-media' and app.path_event_id(name) is not null
              and app.can_work_event(app.path_event_id(name)));
create policy "private-media admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'private-media' and app.is_admin());
