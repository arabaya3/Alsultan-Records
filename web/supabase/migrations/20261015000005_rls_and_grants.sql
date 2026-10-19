-- 0005 Row Level Security + least-privilege grants.
--
-- Pattern: REVOKE ALL from anon/authenticated on every public table first
-- (cloud auto-expose is ON), then grant only the statements/columns needed,
-- and let RLS policies decide rows. Business invariants that depend on the
-- caller's role live in the 0004 guard triggers.

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on table public.%I from anon, authenticated', t.tablename);
  end loop;
end $$;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated, public;

-- ================================================================ content & settings
grant select on public.business_settings, public.services, public.service_categories to anon, authenticated;
grant update on public.business_settings to authenticated;
grant insert, update, delete on public.services, public.service_categories to authenticated;

create policy business_settings_read on public.business_settings for select to anon, authenticated using (true);
create policy business_settings_admin_update on public.business_settings for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

create policy services_read on public.services for select to anon, authenticated
  using (is_published or app.is_admin());
create policy services_admin_insert on public.services for insert to authenticated with check (app.is_admin());
create policy services_admin_update on public.services for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy services_admin_delete on public.services for delete to authenticated using (app.is_admin());

create policy categories_read on public.service_categories for select to anon, authenticated using (true);
create policy categories_admin_insert on public.service_categories for insert to authenticated with check (app.is_admin());
create policy categories_admin_update on public.service_categories for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy categories_admin_delete on public.service_categories for delete to authenticated using (app.is_admin());

grant select, update on public.app_settings to authenticated;
create policy app_settings_owner_read on public.app_settings for select to authenticated using (app.is_owner());
create policy app_settings_owner_update on public.app_settings for update to authenticated using (app.is_owner()) with check (app.is_owner());

-- ================================================================ people
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or app.is_admin());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()) and app.is_active()) with check (id = (select auth.uid()));

-- customers.notes is staff-only: not selectable by API roles; read via customer_internal_notes view.
grant select (id, user_id, full_name, phone, email, city, created_by, created_at, updated_at) on public.customers to authenticated;
grant insert (full_name, phone, email, city, notes) on public.customers to authenticated;
grant update (full_name, phone, email, city, notes) on public.customers to authenticated;
grant delete on public.customers to authenticated;
create policy customers_read on public.customers for select to authenticated
  using (id = app.customer_id() or app.is_admin()
         or (app.is_staff() and exists (select 1 from public.events e where e.customer_id = customers.id and app.is_assigned(e.id))));
create policy customers_admin_insert on public.customers for insert to authenticated with check (app.is_admin());
create policy customers_update on public.customers for update to authenticated
  using (id = app.customer_id() or app.is_admin()) with check (id = app.customer_id() or app.is_admin());
create policy customers_owner_delete on public.customers for delete to authenticated using (app.is_owner());

grant select, insert, update, delete on public.staff_members to authenticated;
create policy staff_members_read on public.staff_members for select to authenticated
  using (app.is_admin() or (app.is_staff() and profile_id = (select auth.uid())));
create policy staff_members_admin_insert on public.staff_members for insert to authenticated with check (app.is_admin());
create policy staff_members_admin_update on public.staff_members for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy staff_members_admin_delete on public.staff_members for delete to authenticated using (app.is_admin());

-- ================================================================ bookings
-- Public submissions go through public_submit_booking (service_role). Status
-- changes go through transition_booking (or a direct update, still checked by trigger).
grant select on public.booking_requests to authenticated;
grant update (customer_id, contact_name, contact_phone, contact_email, event_type, event_date, city, venue, guests, services, message, status)
  on public.booking_requests to authenticated;
create policy bookings_read on public.booking_requests for select to authenticated
  using (app.is_admin() or (customer_id is not null and customer_id = app.customer_id()));
create policy bookings_admin_update on public.booking_requests for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

grant select on public.booking_stage_history to authenticated;
create policy booking_history_read on public.booking_stage_history for select to authenticated using (app.is_admin());

-- ================================================================ events
-- Anon gets only public-safe columns; rows limited to published+consented.
grant select (id, title, event_type, event_date, city, status, public_slug, publication_consent, is_published,
              featured, featured_order, seo_title, seo_description, highlight, coverage_notes, created_at, updated_at)
  on public.events to anon;
-- production_note / equipment_note are internal: read via event_internal_notes view.
grant select (id, customer_id, booking_request_id, title, event_type, event_date, venue, city, status, public_slug,
              publication_consent, consent_at, consent_by, is_published, featured, featured_order, seo_title,
              seo_description, highlight, coverage_notes, created_at, updated_at)
  on public.events to authenticated;
grant insert (customer_id, booking_request_id, title, event_type, event_date, venue, city, status, public_slug,
              seo_title, seo_description, highlight, coverage_notes, production_note, equipment_note)
  on public.events to authenticated;
-- is_published / publication_consent / consent_* / featured are RPC-only (set_event_publication, set_publication_consent).
grant update (customer_id, booking_request_id, title, event_type, event_date, venue, city, status, public_slug,
              featured_order, seo_title, seo_description, highlight, coverage_notes, production_note, equipment_note)
  on public.events to authenticated;
grant delete on public.events to authenticated;

create policy events_public_read on public.events for select to anon, authenticated
  using (is_published and publication_consent = 'granted');
create policy events_member_read on public.events for select to authenticated
  using (app.is_admin() or customer_id = app.customer_id() or app.is_assigned(id));
create policy events_admin_insert on public.events for insert to authenticated with check (app.is_admin());
create policy events_admin_update on public.events for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy events_owner_delete on public.events for delete to authenticated using (app.is_owner());

-- ================================================================ media
grant select on public.media_assets to anon, authenticated;
grant insert (event_id, bucket, path, kind, mime, bytes, width, height, duration_s, variants, visibility, sort_order, upload_status)
  on public.media_assets to authenticated;
grant update (bytes, width, height, duration_s, variants, visibility, sort_order, upload_status) on public.media_assets to authenticated;
grant delete on public.media_assets to authenticated;

create policy media_public_read on public.media_assets for select to anon, authenticated
  using (visibility = 'public' and bucket = 'public-media' and upload_status = 'ready'
         and (event_id is null or app.event_is_public(event_id)));
create policy media_member_read on public.media_assets for select to authenticated
  using (app.is_admin()
         or (event_id is not null and app.is_assigned(event_id))
         or (event_id is not null and upload_status = 'ready' and app.owns_event(event_id)));
create policy media_staff_insert on public.media_assets for insert to authenticated
  with check (app.is_admin() or (event_id is not null and bucket = 'private-media' and app.is_assigned(event_id)));
create policy media_staff_update on public.media_assets for update to authenticated
  using (app.is_admin() or (event_id is not null and app.is_assigned(event_id)))
  with check (app.is_admin() or (event_id is not null and bucket = 'private-media' and app.is_assigned(event_id)));
create policy media_admin_delete on public.media_assets for delete to authenticated using (app.is_admin());

grant select, insert, update, delete on public.deliverables to authenticated;
create policy deliverables_read on public.deliverables for select to authenticated
  using (app.can_work_event(event_id) or app.owns_event(event_id));
create policy deliverables_staff_insert on public.deliverables for insert to authenticated with check (app.can_work_event(event_id));
create policy deliverables_staff_update on public.deliverables for update to authenticated
  using (app.can_work_event(event_id)) with check (app.can_work_event(event_id));
create policy deliverables_admin_delete on public.deliverables for delete to authenticated using (app.is_admin());

grant select, insert, update, delete on public.deliverable_revisions to authenticated;
create policy revisions_read on public.deliverable_revisions for select to authenticated
  using (exists (select 1 from public.deliverables d where d.id = deliverable_id
                 and (app.can_work_event(d.event_id) or app.owns_event(d.event_id))));
create policy revisions_staff_insert on public.deliverable_revisions for insert to authenticated
  with check (exists (select 1 from public.deliverables d where d.id = deliverable_id and app.can_work_event(d.event_id)));
create policy revisions_staff_update on public.deliverable_revisions for update to authenticated
  using (exists (select 1 from public.deliverables d where d.id = deliverable_id and app.can_work_event(d.event_id)))
  with check (exists (select 1 from public.deliverables d where d.id = deliverable_id and app.can_work_event(d.event_id)));
create policy revisions_admin_delete on public.deliverable_revisions for delete to authenticated using (app.is_admin());

create or replace function app.revision_event_id(p_revision_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select d.event_id from public.deliverable_revisions r join public.deliverables d on d.id = r.deliverable_id
  where r.id = p_revision_id;
$$;
revoke execute on function app.revision_event_id(uuid) from public;
grant execute on function app.revision_event_id(uuid) to authenticated, service_role;

grant select, insert, delete on public.video_comments to authenticated;
grant update (body, timecode_ms, resolved) on public.video_comments to authenticated;
create policy video_comments_read on public.video_comments for select to authenticated
  using (app.can_work_event(app.revision_event_id(revision_id)) or app.owns_event(app.revision_event_id(revision_id)));
create policy video_comments_insert on public.video_comments for insert to authenticated
  with check (app.can_work_event(app.revision_event_id(revision_id)) or app.owns_event(app.revision_event_id(revision_id)));
create policy video_comments_update on public.video_comments for update to authenticated
  using (app.can_work_event(app.revision_event_id(revision_id))
         or (author_id = (select auth.uid()) and app.owns_event(app.revision_event_id(revision_id))))
  with check (app.can_work_event(app.revision_event_id(revision_id))
         or (author_id = (select auth.uid()) and app.owns_event(app.revision_event_id(revision_id))));
create policy video_comments_delete on public.video_comments for delete to authenticated
  using (app.is_admin() or (author_id = (select auth.uid()) and app.owns_event(app.revision_event_id(revision_id))));

-- ================================================================ album selections
grant select on public.album_selections to authenticated;
grant insert (event_id, customer_id) on public.album_selections to authenticated;
grant update (status) on public.album_selections to authenticated;
create policy selections_read on public.album_selections for select to authenticated
  using (app.can_work_event(event_id) or (customer_id = app.customer_id() and app.owns_event(event_id)));
create policy selections_customer_insert on public.album_selections for insert to authenticated
  with check (app.owns_event(event_id) or app.is_admin());
-- admins may lock / reopen; customers submit via RPC.
create policy selections_admin_update on public.album_selections for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

create or replace function app.selection_event_id(p_selection_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select s.event_id from public.album_selections s where s.id = p_selection_id;
$$;
create or replace function app.owns_draft_selection(p_selection_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.album_selections s
                 where s.id = p_selection_id and s.status = 'draft'
                   and s.customer_id = app.customer_id() and app.owns_event(s.event_id));
$$;
revoke execute on function app.selection_event_id(uuid), app.owns_draft_selection(uuid) from public;
grant execute on function app.selection_event_id(uuid), app.owns_draft_selection(uuid) to authenticated, service_role;

grant select, delete on public.album_selection_items to authenticated;
grant insert (selection_id, media_asset_id, note) on public.album_selection_items to authenticated;
grant update (note) on public.album_selection_items to authenticated;
create policy selection_items_read on public.album_selection_items for select to authenticated
  using (app.can_work_event(app.selection_event_id(selection_id)) or app.owns_event(app.selection_event_id(selection_id)));
create policy selection_items_insert on public.album_selection_items for insert to authenticated
  with check (app.owns_draft_selection(selection_id));
create policy selection_items_update on public.album_selection_items for update to authenticated
  using (app.owns_draft_selection(selection_id)) with check (app.owns_draft_selection(selection_id));
create policy selection_items_delete on public.album_selection_items for delete to authenticated
  using (app.owns_draft_selection(selection_id));

grant select on public.album_selection_snapshots to authenticated;
create policy snapshots_read on public.album_selection_snapshots for select to authenticated
  using (app.can_work_event(event_id) or app.owns_event(event_id));

-- ================================================================ commercial
grant select, delete on public.quotes to authenticated;
grant insert (customer_id, event_id, status, currency, discount, valid_until) on public.quotes to authenticated;
grant update (event_id, status, currency, discount, valid_until) on public.quotes to authenticated;
create policy quotes_read on public.quotes for select to authenticated
  using (app.is_admin() or (customer_id = app.customer_id() and status <> 'draft'));
create policy quotes_admin_insert on public.quotes for insert to authenticated with check (app.is_admin());
create policy quotes_admin_update on public.quotes for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy quotes_admin_delete on public.quotes for delete to authenticated using (app.is_admin() and status = 'draft');

grant select, delete on public.quote_items to authenticated;
grant insert (quote_id, description, qty, unit_price, sort_order) on public.quote_items to authenticated;
grant update (description, qty, unit_price, sort_order) on public.quote_items to authenticated;
create policy quote_items_read on public.quote_items for select to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id
                 and (app.is_admin() or (q.customer_id = app.customer_id() and q.status <> 'draft'))));
create policy quote_items_admin_insert on public.quote_items for insert to authenticated with check (app.is_admin());
create policy quote_items_admin_update on public.quote_items for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy quote_items_admin_delete on public.quote_items for delete to authenticated using (app.is_admin());

grant select on public.contracts to authenticated;
grant insert (quote_id, customer_id, event_id, status) on public.contracts to authenticated;
grant update (quote_id, event_id, status) on public.contracts to authenticated;
create policy contracts_read on public.contracts for select to authenticated
  using (app.is_admin() or (customer_id = app.customer_id() and status <> 'draft'));
create policy contracts_admin_insert on public.contracts for insert to authenticated with check (app.is_admin());
create policy contracts_admin_update on public.contracts for update to authenticated using (app.is_admin()) with check (app.is_admin());

grant select on public.contract_versions to authenticated;
grant insert (contract_id, body, currency, total, deposit_required) on public.contract_versions to authenticated;
create policy contract_versions_read on public.contract_versions for select to authenticated
  using (exists (select 1 from public.contracts c where c.id = contract_id
                 and (app.is_admin() or (c.customer_id = app.customer_id() and c.status <> 'draft'))));
create policy contract_versions_admin_insert on public.contract_versions for insert to authenticated with check (app.is_admin());

-- payments: insert ONLY via record_payment (owner). Read: owner/admin, customer own.
grant select on public.payments to authenticated;
create policy payments_read on public.payments for select to authenticated
  using (app.is_admin() or customer_id = app.customer_id());

grant select, delete on public.expenses to authenticated;
grant insert (event_id, category, amount, currency, spent_at, note) on public.expenses to authenticated;
grant update (event_id, category, amount, currency, spent_at, note) on public.expenses to authenticated;
create policy expenses_read on public.expenses for select to authenticated using (app.is_admin());
create policy expenses_owner_insert on public.expenses for insert to authenticated with check (app.is_owner());
create policy expenses_owner_update on public.expenses for update to authenticated using (app.is_owner()) with check (app.is_owner());
create policy expenses_owner_delete on public.expenses for delete to authenticated using (app.is_owner());

-- ================================================================ operations
grant select, insert, update, delete on public.event_staff_assignments to authenticated;
create policy esa_read on public.event_staff_assignments for select to authenticated
  using (app.is_admin() or (app.is_staff() and exists (
    select 1 from public.staff_members s where s.id = staff_id and s.profile_id = (select auth.uid()))));
create policy esa_admin_insert on public.event_staff_assignments for insert to authenticated with check (app.is_admin());
create policy esa_admin_update on public.event_staff_assignments for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy esa_admin_delete on public.event_staff_assignments for delete to authenticated using (app.is_admin());

grant select, insert, update, delete on public.equipment, public.equipment_assignments, public.equipment_maintenance to authenticated;
create policy equipment_read on public.equipment for select to authenticated
  using (app.is_admin() or exists (select 1 from public.equipment_assignments ea
                                   where ea.equipment_id = equipment.id and app.is_assigned(ea.event_id)));
create policy equipment_admin_insert on public.equipment for insert to authenticated with check (app.is_admin());
create policy equipment_admin_update on public.equipment for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy equipment_admin_delete on public.equipment for delete to authenticated using (app.is_admin());

create policy equipment_assignments_read on public.equipment_assignments for select to authenticated
  using (app.is_admin() or app.is_assigned(event_id));
create policy equipment_assignments_admin_insert on public.equipment_assignments for insert to authenticated with check (app.is_admin());
create policy equipment_assignments_admin_update on public.equipment_assignments for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy equipment_assignments_admin_delete on public.equipment_assignments for delete to authenticated using (app.is_admin());

create policy equipment_maintenance_read on public.equipment_maintenance for select to authenticated using (app.is_admin());
create policy equipment_maintenance_admin_insert on public.equipment_maintenance for insert to authenticated with check (app.is_admin());
create policy equipment_maintenance_admin_update on public.equipment_maintenance for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy equipment_maintenance_admin_delete on public.equipment_maintenance for delete to authenticated using (app.is_admin());

grant select on public.support_requests to authenticated;
grant insert (customer_id, contact_name, contact_phone, contact_email, subject) on public.support_requests to authenticated;
grant update (status) on public.support_requests to authenticated;
create policy support_read on public.support_requests for select to authenticated
  using (app.is_admin() or (customer_id is not null and customer_id = app.customer_id()));
create policy support_insert on public.support_requests for insert to authenticated
  with check (app.is_admin() or (customer_id is not null and customer_id = app.customer_id()));
create policy support_admin_update on public.support_requests for update to authenticated using (app.is_admin()) with check (app.is_admin());

grant select on public.support_messages to authenticated;
grant insert (request_id, body) on public.support_messages to authenticated;
create policy support_messages_read on public.support_messages for select to authenticated
  using (exists (select 1 from public.support_requests r where r.id = request_id
                 and (app.is_admin() or (r.customer_id is not null and r.customer_id = app.customer_id()))));
create policy support_messages_insert on public.support_messages for insert to authenticated
  with check (exists (select 1 from public.support_requests r where r.id = request_id
                 and (app.is_admin() or (r.customer_id is not null and r.customer_id = app.customer_id()
                                         and r.status not in ('closed')))));

grant select (id, event_id, display_name, rating, body, status, created_at) on public.reviews to anon;
grant select on public.reviews to authenticated;
grant insert (event_id, display_name, rating, body) on public.reviews to authenticated;
grant update (status, display_name) on public.reviews to authenticated;
grant delete on public.reviews to authenticated;
create policy reviews_public_read on public.reviews for select to anon, authenticated using (status = 'approved');
create policy reviews_member_read on public.reviews for select to authenticated
  using (app.is_admin() or customer_id = app.customer_id());
create policy reviews_customer_insert on public.reviews for insert to authenticated
  with check (app.customer_id() is not null and (event_id is null or app.owns_event(event_id)));
create policy reviews_admin_update on public.reviews for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy reviews_admin_delete on public.reviews for delete to authenticated using (app.is_admin());

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_read on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()) and app.is_active());
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid()) and app.is_active()) with check (recipient_id = (select auth.uid()));

-- audit_events: read admin; NO insert/update/delete grants (triggers only).
grant select on public.audit_events to authenticated;
create policy audit_read on public.audit_events for select to authenticated using (app.is_admin());

grant select, insert, update on public.backup_runs to authenticated;
create policy backup_runs_owner_read on public.backup_runs for select to authenticated using (app.is_owner());
create policy backup_runs_owner_insert on public.backup_runs for insert to authenticated with check (app.is_owner());
create policy backup_runs_owner_update on public.backup_runs for update to authenticated using (app.is_owner()) with check (app.is_owner());

-- ================================================================ internal-notes views
-- Views run as their owner (postgres) and filter explicitly; they expose only
-- the internal columns that are column-revoked on the base tables.
create view public.customer_internal_notes with (security_barrier = true) as
  select c.id as customer_id, c.notes
  from public.customers c
  where app.is_admin()
     or (app.is_staff() and exists (select 1 from public.events e where e.customer_id = c.id and app.is_assigned(e.id)));

create view public.event_internal_notes with (security_barrier = true) as
  select e.id as event_id, e.production_note, e.equipment_note
  from public.events e
  where app.can_work_event(e.id);

revoke all on public.customer_internal_notes, public.event_internal_notes from anon, authenticated;
grant select on public.customer_internal_notes, public.event_internal_notes to authenticated;

-- service_role keeps full access (bypasses RLS) for audited server code.
grant all on all tables in schema public to service_role;
