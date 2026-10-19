-- 0019 Packages (permanent service bundles) separated from offers (time-limited), offer target period.
--
-- * public.packages + public.package_items: owner-managed bundles, status draft|published|hidden.
--   Anon sees published packages only; the raw price only when show_price (display_price_minor).
-- * offers.target_month/target_year: the month an offer is FOR (ordering), independent of its title.
-- * offers.package_id: optional link to a package. ON DELETE SET NULL, and nothing writes from an offer into
--   a package, so editing/expiring/deleting an offer never changes the package.
-- * nav: new allow-listed target 'packages'; nav item added. Order/visibility of the five owner-requested
--   items (أعمالنا | البكجات | العروض | الخدمات | من نحن) is set once here; the owner can change it later.
-- Additive only: no existing row is deleted, no offer data is moved.

-- ================================================================ 1. site target allow-list
create or replace function app.is_site_target(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p in ('home', 'work', 'services', 'offers', 'packages', 'promos', 'albums', 'about', 'contact', 'book', 'faq');
$$;

-- ================================================================ 2. packages
create table public.packages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  description text check (description is null or char_length(description) <= 1000),
  image_photo_id uuid references public.album_photos(id) on delete set null,
  price_minor bigint check (price_minor is null or price_minor >= 0),
  currency char(3) not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  show_price boolean not null default false,
  display_price_minor bigint generated always as (case when show_price then price_minor end) stored,
  whatsapp_message text check (whatsapp_message is null or char_length(whatsapp_message) <= 600),
  status text not null default 'draft' check (status in ('draft', 'published', 'hidden')),
  featured boolean not null default false,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
create index packages_status_sort_idx on public.packages (status, sort_order);
create index packages_image_idx on public.packages (image_photo_id);
create index packages_updated_by_idx on public.packages (updated_by);
create trigger set_updated_at before update on public.packages
  for each row execute function app.set_updated_at();
create trigger stamp_updated_by before insert or update on public.packages
  for each row execute function app.stamp_updated_by();
create trigger audit after insert or update or delete on public.packages
  for each row execute function app.cms_audit_trigger('status', 'slug', 'featured');

create or replace function app.package_is_public(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.packages p where p.id = p_id and p.status = 'published');
$$;
revoke execute on function app.package_is_public(uuid) from public;
grant execute on function app.package_is_public(uuid) to anon, authenticated, service_role;

alter table public.packages enable row level security;
revoke all on table public.packages from anon, authenticated, public;
grant select (id, slug, title, description, image_photo_id, display_price_minor, currency, show_price,
              whatsapp_message, featured, sort_order)
  on public.packages to anon;
grant select on public.packages to authenticated;
grant insert (slug, title, description, image_photo_id, price_minor, currency, show_price, whatsapp_message,
              status, featured, sort_order),
      update (slug, title, description, image_photo_id, price_minor, currency, show_price, whatsapp_message,
              status, featured, sort_order),
      delete
  on public.packages to authenticated;
grant all on public.packages to service_role;
create policy packages_public_read on public.packages for select to anon using (status = 'published');
create policy packages_admin_read on public.packages for select to authenticated using (app.is_admin());
create policy packages_admin_insert on public.packages for insert to authenticated with check (app.is_admin());
create policy packages_admin_update on public.packages for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy packages_admin_delete on public.packages for delete to authenticated using (app.is_admin());

create table public.package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index package_items_package_sort_idx on public.package_items (package_id, sort_order);
create trigger set_updated_at before update on public.package_items
  for each row execute function app.set_updated_at();

alter table public.package_items enable row level security;
revoke all on table public.package_items from anon, authenticated, public;
grant select (id, package_id, label, sort_order) on public.package_items to anon;
grant select on public.package_items to authenticated;
grant insert (package_id, label, sort_order), update (label, sort_order), delete on public.package_items to authenticated;
grant all on public.package_items to service_role;
create policy package_items_public_read on public.package_items for select to anon using (app.package_is_public(package_id));
create policy package_items_admin_read on public.package_items for select to authenticated using (app.is_admin());
create policy package_items_admin_insert on public.package_items for insert to authenticated with check (app.is_admin());
create policy package_items_admin_update on public.package_items for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy package_items_admin_delete on public.package_items for delete to authenticated using (app.is_admin());

-- ================================================================ 3. offers: target period + optional package
alter table public.offers
  add column target_month smallint check (target_month between 1 and 12),
  add column target_year smallint check (target_year between 2000 and 2100),
  add column package_id uuid references public.packages(id) on delete set null,
  add constraint offers_target_period_check check ((target_month is null) = (target_year is null));
create index offers_package_idx on public.offers (package_id);
grant select (target_month, target_year, package_id) on public.offers to anon;
grant insert (target_month, target_year, package_id), update (target_month, target_year, package_id)
  on public.offers to authenticated;

-- ================================================================ 4. slug redirects + nav
alter table public.slug_redirects drop constraint if exists slug_redirects_from_path_check;
alter table public.slug_redirects drop constraint if exists slug_redirects_to_path_check;
alter table public.slug_redirects
  add constraint slug_redirects_from_path_check check (from_path ~ '^/(services|offers|packages|work/albums)/[a-z0-9-]+$'),
  add constraint slug_redirects_to_path_check check (to_path ~ '^/(services|offers|packages|work/albums)/[a-z0-9-]+$');
create trigger slug_change_redirect after update of slug on public.packages
  for each row execute function app.slug_change_redirect('/packages/');

insert into public.nav_items (label, target, sort_order, is_visible) values ('البكجات', 'packages', 20, true)
on conflict (target) do nothing;
-- Owner-requested order: أعمالنا | البكجات | العروض | الخدمات | من نحن (labels are kept as they are).
update public.nav_items set sort_order = 10 where target = 'work';
update public.nav_items set sort_order = 20 where target = 'packages';
update public.nav_items set sort_order = 30, is_visible = true where target = 'offers';
update public.nav_items set sort_order = 40 where target = 'services';
update public.nav_items set sort_order = 50 where target = 'about';
update public.nav_items set sort_order = sort_order + 100
  where target not in ('work', 'packages', 'offers', 'services', 'about') and sort_order < 100;
