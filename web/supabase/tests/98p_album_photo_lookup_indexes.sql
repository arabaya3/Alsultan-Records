-- 0040 The per-image and per-upload lookups have their indexes, and the storage policy's variant match can use them.
begin;
select plan(6);

select has_index('public', 'album_photos', 'album_photos_variant_thumb_idx', 'thumb variant path index');
select has_index('public', 'album_photos', 'album_photos_variant_display_idx', 'display variant path index');
select has_index('public', 'album_photos', 'album_photos_storage_path_original_idx', 'original path index');
select has_index('public', 'album_photos', 'album_photos_sha256_live_idx', 'sha256 index for duplicate checks');
select has_index('public', 'booking_stage_history', 'booking_stage_history_changed_by_idx', 'changed_by foreign key index');

-- The same predicate as app.album_object_is_public: with sequential scans discouraged, the plan uses the new indexes.
create function pg_temp.plan_of_variant_match() returns text language plpgsql as $$
declare r record; t text := '';
begin
  for r in execute $q$explain select 1 from public.album_photos p
    where p.variants ->> 'thumb' = 'albums/x/y/thumb.webp' or p.variants ->> 'display' = 'albums/x/y/thumb.webp'$q$ loop
    t := t || ' ' || r."QUERY PLAN";
  end loop;
  return t;
end $$;
set local enable_seqscan = off;
select matches(pg_temp.plan_of_variant_match(), 'album_photos_variant_(thumb|display)_idx', 'the variant match is served by the expression indexes');

select * from finish();
rollback;
