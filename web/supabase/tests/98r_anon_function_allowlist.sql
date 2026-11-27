-- Which functions in `public` an anonymous visitor may execute (technical audit SEC-20). Default privileges in 0001 do
-- not remove PostgreSQL's global EXECUTE-to-PUBLIC on new functions, so every function has to revoke it itself. This
-- pins the allow-list: a new function that forgets the revoke (or an anon grant added by mistake) fails here.
-- Functions owned by an extension (pgTAP, etc.) are not ours and are left out.
begin;
select plan(1);

select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  array['active_logo_path', 'album_photo_object_path', 'album_photo_object_ref', 'reel_file_ref', 'reel_files']::text[],
  'anon may execute exactly the public read helpers'
);

select * from finish();
rollback;
