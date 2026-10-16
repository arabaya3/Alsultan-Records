-- Album originals are never public. 0015 let anon resolve and read `original` paths of published
-- photos (RPC branch + storage policy), which bypassed the served variants. Public access is now
-- limited to the thumb/display variants; admins keep full access through their own storage policies.

create or replace function app.album_object_is_public(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.album_photos p
    join public.photo_albums a on a.id = p.album_id
    where p.is_published and p.upload_status = 'ready' and a.is_published
      and (p.variants ->> 'thumb' = p_name or p.variants ->> 'display' = p_name)
  );
$$;

create or replace function public.album_photo_object_path(p_photo_id uuid, p_variant text)
returns text language sql stable security definer set search_path = '' as $$
  select p.variants ->> p_variant
  from public.album_photos p
  join public.photo_albums a on a.id = p.album_id
  where p_variant in ('thumb', 'display')
    and p.id = p_photo_id and p.is_published and p.upload_status = 'ready' and a.is_published;
$$;
