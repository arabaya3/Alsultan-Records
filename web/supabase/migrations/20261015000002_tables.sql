-- 0002 Tables, constraints, indexes, updated_at triggers.
-- Money is bigint minor units (agorot/cents) + currency char(3) default 'ILS'.

-- ================================================================ content & settings
create table public.business_settings (
  id smallint primary key default 1 check (id = 1),
  name text not null default '',
  tagline text,
  phone text,
  whatsapp text,
  email text,
  address text,
  instagram text,
  facebook text,
  hero_media_id uuid,
  canonical_base_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  require_staff_mfa boolean not null default true,
  turnstile_enabled boolean not null default false,
  booking_rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug in ('wedding','engagement','graduation','festival','commercial','dj','livestream','production')),
  title text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category_id uuid references public.service_categories(id) on delete set null,
  title text not null,
  summary text,
  body text,
  cover_media_id uuid,
  sort_order int not null default 0,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index services_category_idx on public.services(category_id);
create index services_published_idx on public.services(is_published, sort_order);

-- ================================================================ people
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role public.app_role not null default 'customer',
  disabled boolean not null default false,
  mfa_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_role_idx on public.profiles(role);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles(id) on delete set null,
  full_name text not null,
  phone text,
  email text,
  city text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_created_by_idx on public.customers(created_by);
create index customers_phone_idx on public.customers(phone);

create table public.staff_members (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  full_name text not null,
  specialty text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ================================================================ booking & events
create table public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  tracking_code text not null unique default app.random_code(10),
  customer_id uuid references public.customers(id) on delete set null,
  contact_name text not null check (length(contact_name) between 1 and 200),
  contact_phone text not null check (length(contact_phone) between 4 and 32),
  contact_email text check (contact_email is null or length(contact_email) <= 320),
  event_type text not null,
  event_date date,
  city text,
  venue text,
  guests int check (guests is null or guests between 0 and 100000),
  services text[] not null default '{}',
  message text check (message is null or length(message) <= 5000),
  status public.booking_status not null default 'new',
  idempotency_key text unique,
  source_ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index booking_requests_customer_idx on public.booking_requests(customer_id);
create index booking_requests_status_idx on public.booking_requests(status, created_at desc);
create index booking_requests_event_date_idx on public.booking_requests(event_date);

create table public.booking_stage_history (
  id uuid primary key default gen_random_uuid(),
  booking_request_id uuid not null references public.booking_requests(id) on delete cascade,
  from_status public.booking_status,
  to_status public.booking_status not null,
  note text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index booking_stage_history_booking_idx on public.booking_stage_history(booking_request_id, created_at);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  booking_request_id uuid references public.booking_requests(id) on delete set null,
  title text not null,
  event_type text,
  event_date date,
  venue text,
  city text,
  status public.event_status not null default 'planned',
  public_slug text unique check (public_slug is null or public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  publication_consent public.consent_status not null default 'none',
  consent_at timestamptz,
  consent_by uuid references public.profiles(id) on delete set null,
  is_published boolean not null default false,
  featured boolean not null default false,
  featured_order int,
  seo_title text,
  seo_description text,
  highlight text,
  coverage_notes text,
  production_note text,
  equipment_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Public project = published AND consent granted. Never otherwise.
  constraint events_publish_requires_consent check (not is_published or publication_consent = 'granted'),
  constraint events_publish_requires_slug check (not is_published or public_slug is not null),
  constraint events_featured_requires_published check (not featured or is_published)
);
create index events_customer_idx on public.events(customer_id);
create index events_booking_idx on public.events(booking_request_id);
create index events_date_idx on public.events(event_date);
create index events_status_idx on public.events(status);
create index events_public_idx on public.events(is_published, featured, featured_order) where is_published;
create index events_consent_by_idx on public.events(consent_by);

-- ================================================================ media
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete cascade,
  bucket public.media_bucket not null,
  path text not null unique,
  kind public.media_kind not null,
  mime text not null,
  bytes bigint check (bytes is null or bytes >= 0),
  width int check (width is null or width > 0),
  height int check (height is null or height > 0),
  duration_s numeric check (duration_s is null or duration_s >= 0),
  variants jsonb not null default '{}'::jsonb,
  visibility public.media_visibility not null default 'private',
  sort_order int not null default 0,
  upload_status public.upload_status not null default 'pending',
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_private_bucket_private check (bucket = 'public-media' or visibility = 'private'),
  constraint media_private_path check (bucket <> 'private-media' or (event_id is not null and path like 'events/' || event_id::text || '/%'))
);
create index media_assets_event_idx on public.media_assets(event_id, sort_order);
create index media_assets_uploaded_by_idx on public.media_assets(uploaded_by);
create index media_assets_visibility_idx on public.media_assets(visibility) where visibility = 'public';

alter table public.business_settings add constraint business_settings_hero_fk foreign key (hero_media_id) references public.media_assets(id) on delete set null;
alter table public.services add constraint services_cover_fk foreign key (cover_media_id) references public.media_assets(id) on delete set null;
create index services_cover_idx on public.services(cover_media_id);
create index business_settings_hero_idx on public.business_settings(hero_media_id);

create table public.deliverables (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  kind public.deliverable_kind not null,
  title text not null,
  status public.deliverable_status not null default 'in_progress',
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deliverables_event_idx on public.deliverables(event_id);
create index deliverables_status_idx on public.deliverables(status);

create table public.deliverable_revisions (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  revision_no int not null check (revision_no > 0),
  media_asset_id uuid references public.media_assets(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deliverable_id, revision_no)
);
create index deliverable_revisions_media_idx on public.deliverable_revisions(media_asset_id);
create index deliverable_revisions_created_by_idx on public.deliverable_revisions(created_by);

create table public.video_comments (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.deliverable_revisions(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  timecode_ms int not null check (timecode_ms >= 0),
  body text not null check (length(body) between 1 and 4000),
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index video_comments_revision_idx on public.video_comments(revision_id, timecode_ms);
create index video_comments_author_idx on public.video_comments(author_id);

create table public.album_selections (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  status public.selection_status not null default 'draft',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index album_selections_customer_idx on public.album_selections(customer_id);

create table public.album_selection_items (
  id uuid primary key default gen_random_uuid(),
  selection_id uuid not null references public.album_selections(id) on delete cascade,
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (selection_id, media_asset_id)
);
create index album_selection_items_media_idx on public.album_selection_items(media_asset_id);

create table public.album_selection_snapshots (
  id uuid primary key default gen_random_uuid(),
  selection_id uuid not null references public.album_selections(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  items jsonb not null,
  item_count int not null,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index album_selection_snapshots_selection_idx on public.album_selection_snapshots(selection_id);
create index album_selection_snapshots_event_idx on public.album_selection_snapshots(event_id);
create index album_selection_snapshots_by_idx on public.album_selection_snapshots(submitted_by);

-- ================================================================ commercial
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  quote_no text not null unique default ('Q-' || app.random_code(8)),
  customer_id uuid not null references public.customers(id) on delete restrict,
  event_id uuid references public.events(id) on delete set null,
  status public.quote_status not null default 'draft',
  currency char(3) not null default 'ILS',
  subtotal bigint not null default 0,
  discount bigint not null default 0 check (discount >= 0),
  total bigint not null default 0 check (total >= 0),
  valid_until date,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quotes_customer_idx on public.quotes(customer_id);
create index quotes_event_idx on public.quotes(event_id);
create index quotes_status_idx on public.quotes(status);
create index quotes_accepted_by_idx on public.quotes(accepted_by);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  description text not null,
  qty numeric(12,3) not null default 1 check (qty > 0),
  unit_price bigint not null check (unit_price >= 0),
  line_total bigint not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quote_items_quote_idx on public.quote_items(quote_id);

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references public.quotes(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  event_id uuid references public.events(id) on delete set null,
  status public.contract_status not null default 'draft',
  current_version_id uuid,
  approved_version_id uuid,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contracts_quote_idx on public.contracts(quote_id);
create index contracts_customer_idx on public.contracts(customer_id);
create index contracts_event_idx on public.contracts(event_id);
create index contracts_approved_by_idx on public.contracts(approved_by);

create table public.contract_versions (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete restrict,
  version_no int not null,
  body text not null,
  currency char(3) not null default 'ILS',
  total bigint not null check (total >= 0),
  deposit_required bigint not null default 0 check (deposit_required >= 0),
  content_hash text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id, version_no)
);
create index contract_versions_created_by_idx on public.contract_versions(created_by);
alter table public.contracts add constraint contracts_current_version_fk foreign key (current_version_id) references public.contract_versions(id);
alter table public.contracts add constraint contracts_approved_version_fk foreign key (approved_version_id) references public.contract_versions(id);
create index contracts_current_version_idx on public.contracts(current_version_id);
create index contracts_approved_version_idx on public.contracts(approved_version_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  event_id uuid references public.events(id) on delete set null,
  contract_id uuid references public.contracts(id) on delete set null,
  kind public.payment_kind not null default 'payment',
  amount bigint not null check (amount > 0),
  currency char(3) not null default 'ILS',
  method text not null,
  received_at timestamptz not null default now(),
  reference text,
  idempotency_key text not null unique,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_customer_idx on public.payments(customer_id);
create index payments_event_idx on public.payments(event_id);
create index payments_contract_idx on public.payments(contract_id);
create index payments_received_idx on public.payments(received_at);
create index payments_recorded_by_idx on public.payments(recorded_by);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete set null,
  category text not null,
  amount bigint not null check (amount > 0),
  currency char(3) not null default 'ILS',
  spent_at date not null default current_date,
  note text,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_event_idx on public.expenses(event_id);
create index expenses_spent_idx on public.expenses(spent_at);
create index expenses_recorded_by_idx on public.expenses(recorded_by);

-- ================================================================ operations
create table public.event_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  staff_id uuid not null references public.staff_members(id) on delete cascade,
  role_label text,
  override_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, staff_id)
);
create index event_staff_assignments_staff_idx on public.event_staff_assignments(staff_id);

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  serial text unique,
  status public.equipment_status not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index equipment_status_idx on public.equipment(status);

create table public.equipment_assignments (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  out_at timestamptz not null,
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint equipment_assignments_range check (returned_at is null or returned_at > out_at),
  constraint equipment_assignments_no_overlap exclude using gist (
    equipment_id with =,
    tstzrange(out_at, coalesce(returned_at, 'infinity'::timestamptz), '[)') with &&
  )
);
create index equipment_assignments_event_idx on public.equipment_assignments(event_id);

create table public.equipment_maintenance (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  description text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cost bigint check (cost is null or cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index equipment_maintenance_equipment_idx on public.equipment_maintenance(equipment_id);

create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  tracking_code text not null unique default app.random_code(10),
  customer_id uuid references public.customers(id) on delete set null,
  contact_name text,
  contact_phone text,
  contact_email text,
  subject text not null check (length(subject) between 1 and 300),
  status public.support_status not null default 'open',
  idempotency_key text unique,
  source_ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_requests_customer_idx on public.support_requests(customer_id);
create index support_requests_status_idx on public.support_requests(status, created_at desc);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.support_requests(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  is_staff_reply boolean not null default false,
  body text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_messages_request_idx on public.support_messages(request_id, created_at);
create index support_messages_author_idx on public.support_messages(author_id);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  display_name text,
  rating int not null check (rating between 1 and 5),
  body text not null check (length(body) between 1 and 4000),
  status public.review_status not null default 'pending',
  moderated_by uuid references public.profiles(id) on delete set null,
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reviews_customer_idx on public.reviews(customer_id);
create index reviews_event_idx on public.reviews(event_id);
create index reviews_status_idx on public.reviews(status);
create index reviews_moderated_by_idx on public.reviews(moderated_by);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications(recipient_id, created_at desc);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_events_entity_idx on public.audit_events(entity_type, entity_id);
create index audit_events_at_idx on public.audit_events(at desc);
create index audit_events_actor_idx on public.audit_events(actor);

create table public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  status public.backup_status not null default 'running',
  table_counts jsonb,
  object_counts jsonb,
  errors jsonb,
  location text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ================================================================ private
create table private.rate_limits (
  bucket text not null,
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, key, window_start)
);

create table private.bootstrap (
  id smallint primary key default 1 check (id = 1),
  token_hash text not null,           -- hex sha256 of the operator token
  used_at timestamptz,
  used_by uuid
);

-- ================================================================ singletons
insert into public.business_settings (id, name) values (1, 'Sultan Records');
insert into public.app_settings (id) values (1);
insert into public.service_categories (slug, title, sort_order) values
  ('wedding', 'أعراس', 1), ('engagement', 'خطوبة', 2), ('graduation', 'تخرج', 3),
  ('festival', 'مهرجانات', 4), ('commercial', 'تجاري', 5), ('dj', 'دي جي', 6),
  ('livestream', 'بث مباشر', 7), ('production', 'إنتاج', 8);

-- ================================================================ updated_at triggers
do $$
declare t record;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'updated_at' and tb.table_type = 'BASE TABLE'
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function app.set_updated_at()', t.table_name);
  end loop;
end $$;
