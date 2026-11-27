-- The /p route authorizes a public photo with ONE call, public.album_photo_object_ref (0032), and no longer reads the
-- row through the anon RLS policy album_photos_public_read first. That is only safe while the two agree, so this pins
-- it: for every photo state × album state, the function returns a row exactly when anon RLS shows the photo. If either
-- side is changed alone (e.g. a new publication condition in the policy), this fails.
-- 4 album states × 5 photo states, all created here and rolled back.
begin;
select plan(5);

do $$
declare
  a int; p int; aid uuid; pid uuid;
begin
  for a in 1..4 loop
    aid := ('00000000-0000-4000-8000-0000000ca' || a || '00')::uuid;
    -- 1 published · 2 not published · 3 published but archived · 4 published but in the trash
    insert into public.photo_albums (id, slug, title, is_published) values (aid, 'pgtap-ref-rls-' || a, 'pgTAP ref/RLS ' || a, a <> 2);
    for p in 1..5 loop
      pid := ('00000000-0000-4000-8000-0000000c' || a || p || '00')::uuid;
      -- 1 published+ready · 2 hidden · 3 published, still processing · 4 published, failed · 5 published+ready but deleted
      insert into public.album_photos (id, album_id, storage_path_original, mime, bytes, upload_status, is_published, deleted_at, variants)
      values (
        pid, aid, 'albums/' || aid || '/' || pid || '/original.jpg', 'image/jpeg', 10,
        case p when 3 then 'processing' when 4 then 'failed' else 'ready' end,
        p <> 2,
        case when p = 5 then now() end,
        jsonb_build_object('thumb', 'albums/' || aid || '/' || pid || '/thumb.webp', 'display', 'albums/' || aid || '/' || pid || '/display.webp')
      );
    end loop;
  end loop;
  update public.photo_albums set archived_at = now() where id = '00000000-0000-4000-8000-0000000ca300';
  update public.photo_albums set deleted_at = now() where id = '00000000-0000-4000-8000-0000000ca400';
end $$;

-- The 20 ids (no table data: anon reads nothing through it).
create temporary view ref_rls_ids as
  select ('00000000-0000-4000-8000-0000000c' || a || p || '00')::uuid as id from generate_series(1, 4) a, generate_series(1, 5) p;
grant select on ref_rls_ids to anon;

set local role anon;

select is(
  (select count(*)::int from pg_temp.ref_rls_ids t
    where exists (select 1 from public.album_photos x where x.id = t.id)
          is distinct from exists (select 1 from public.album_photo_object_ref(t.id, 'thumb'))),
  0, 'thumb: for every photo × album state the function returns a row exactly when anon RLS shows the photo');
select is(
  (select count(*)::int from pg_temp.ref_rls_ids t
    where exists (select 1 from public.album_photos x where x.id = t.id)
          is distinct from exists (select 1 from public.album_photo_object_ref(t.id, 'display'))),
  0, 'display: same agreement');
-- Not vacuous: exactly the published, ready, live photo of the published, live album passes, on both sides.
select is((select count(*)::int from pg_temp.ref_rls_ids t where exists (select 1 from public.album_photos x where x.id = t.id)), 1, 'anon RLS shows exactly one of the 20 photos');
select is((select count(*)::int from pg_temp.ref_rls_ids t where exists (select 1 from public.album_photo_object_ref(t.id, 'thumb'))), 1, 'the function answers for exactly one of the 20 photos');
select is((select count(*)::int from pg_temp.ref_rls_ids t where exists (select 1 from public.album_photo_object_ref(t.id, 'original'))), 0, 'the original is never returned, whatever the state');

reset role;
select * from finish();
rollback;
