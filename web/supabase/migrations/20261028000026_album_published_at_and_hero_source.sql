-- 0026: albums are listed newest-PUBLISHED first; the home/inner hero can follow the newest published album.
--
-- photo_albums.published_at
--   Set by the database (never by a form) the FIRST time an album becomes published. Afterwards it never moves:
--     * editing the title/description/event date, adding or reordering photos, changing the cover → unchanged
--       (published_at is not in any UPDATE grant and the trigger keeps OLD.published_at);
--     * unpublish → keeps published_at (the album leaves the public list, RLS);
--     * publish again → keeps the ORIGINAL published_at, so hiding/re-showing an album to fix a typo does not
--       push it to the top. A genuinely new album is a new row.
--   Not related to event_date (the occasion, optional, any past/future day) nor created_at (row creation).
--
-- photo_albums.listed_at  (generated, read-only)
--   coalesce(published_at, created_at). Albums published before this migration have no recorded publish time;
--   we do NOT invent one. Their documented fallback is created_at (when the album was added to the site), which
--   is the closest real data available. The column is only an ordering key.
--   Public order everywhere: listed_at desc, id desc (deterministic tie-break, applied in SQL before any limit).
--
-- business_settings.hero_cover_source
--   'manual'       — hero_cover_photo_id as today (default: production keeps its current choice untouched);
--   'latest_album' — cover of the newest published album that has a ready, published photo (resolved at read time
--                    through the anon API, so RLS guarantees no draft/hidden/trashed/private photo is ever chosen).
--   hero_cover_photo_id is kept as is in both modes (switching back restores the manual choice).
--
-- Rollback (local/staging; no data loss beyond the new columns):
--   drop trigger photo_albums_published_at on public.photo_albums;
--   drop function app.photo_albums_published_at();
--   drop index if exists public.photo_albums_listed_idx;
--   alter table public.photo_albums drop column listed_at, drop column published_at;
--   alter table public.business_settings drop column hero_cover_source;

-- ================================================================ 1. publish time
alter table public.photo_albums add column published_at timestamptz;
alter table public.photo_albums
  add column listed_at timestamptz generated always as (coalesce(published_at, created_at)) stored;
create index photo_albums_listed_idx on public.photo_albums (listed_at desc, id desc);

create or replace function app.photo_albums_published_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.published_at := case when new.is_published then now() else null end;
  else
    -- Never editable: keep the stored value; stamp it once, on the first false→true transition.
    new.published_at := old.published_at;
    if new.is_published and not old.is_published and old.published_at is null then
      new.published_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger photo_albums_published_at before insert or update on public.photo_albums
  for each row execute function app.photo_albums_published_at();

grant select (published_at, listed_at) on public.photo_albums to anon, authenticated;

-- ================================================================ 2. hero source
alter table public.business_settings
  add column hero_cover_source text not null default 'manual' check (hero_cover_source in ('manual', 'latest_album'));
grant select (hero_cover_source) on public.business_settings to anon, authenticated;
