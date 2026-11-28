-- 0040 Indexes for lookups that run on every public image or upload, and grow with the number of photos
-- (technical audit PERF-06). Additive only; no data, policy or function changes.
--
-- app.album_object_is_public(name) (0018) is evaluated by the album-media storage policy on every anonymous object
-- read (each /p request reaching Supabase storage): it matched `variants->>'thumb' = name or variants->>'display' =
-- name` with no index, i.e. a scan of album_photos per image. Two expression indexes let it use a bitmap OR.
-- The upload policy (0025) matches storage_path_original = name; find_duplicate_photo (0018) looks up by sha256
-- across albums, which the (album_id, sha256) unique index cannot serve. booking_stage_history.changed_by is a
-- foreign key without an index (slow deletes of a profile).
create index if not exists album_photos_variant_thumb_idx on public.album_photos ((variants ->> 'thumb'));
create index if not exists album_photos_variant_display_idx on public.album_photos ((variants ->> 'display'));
create index if not exists album_photos_storage_path_original_idx on public.album_photos (storage_path_original);
create index if not exists album_photos_sha256_live_idx on public.album_photos (sha256) where deleted_at is null;
create index if not exists booking_stage_history_changed_by_idx on public.booking_stage_history (changed_by);
