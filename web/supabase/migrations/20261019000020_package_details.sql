-- 0020 Package details: display group, gift line, admin-only internal note. Additive only.
--
-- * group_label: owner-editable heading the /packages page groups by (e.g. «العرسان», «DJ»). Plain text.
-- * gift: optional «الهدية» line shown on the card (e.g. «برومو مميز»).
-- * internal_note: admin-only note (e.g. an open question to the owner). NEVER granted to anon.

alter table public.packages
  add column group_label text check (group_label is null or char_length(btrim(group_label)) between 1 and 40),
  add column gift text check (gift is null or char_length(btrim(gift)) between 1 and 200),
  add column internal_note text check (internal_note is null or char_length(internal_note) <= 1000);

grant select (group_label, gift) on public.packages to anon;
grant insert (group_label, gift, internal_note), update (group_label, gift, internal_note) on public.packages to authenticated;
-- internal_note: no anon grant (admin reads it through the authenticated table grant + admin-only RLS).
