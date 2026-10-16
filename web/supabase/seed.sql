-- =====================================================================
--  LOCAL DEV ONLY SEED.  NEVER run against staging or production.
--  Loaded automatically by `npx supabase db reset` on the local stack.
--  Every title is prefixed with [DEV]. No fictional project is published
--  except "[DEV] Sample published project" (consent granted) for UI testing.
--
--  Dev logins (local stack only; these passwords exist nowhere else):
--    owner@dev.local      DevOwner!2026     role owner
--    admin@dev.local      DevAdmin!2026     role admin
--    staff@dev.local      DevStaff!2026     role staff (assigned to customer A's first event)
--    customer.a@dev.local DevCustA!2026     role customer
--    customer.b@dev.local DevCustB!2026     role customer
--
--  app_settings.require_staff_mfa is turned OFF here so staff accounts can
--  sign in locally without TOTP. Staging/production keep the default (ON).
-- =====================================================================

do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-4000-8000-0000000000a1'::uuid, 'owner@dev.local',      'DevOwner!2026', '[DEV] Owner'),
      ('00000000-0000-4000-8000-0000000000a2'::uuid, 'admin@dev.local',      'DevAdmin!2026', '[DEV] Admin'),
      ('00000000-0000-4000-8000-0000000000a3'::uuid, 'staff@dev.local',      'DevStaff!2026', '[DEV] Staff'),
      ('00000000-0000-4000-8000-0000000000b1'::uuid, 'customer.a@dev.local', 'DevCustA!2026', '[DEV] Customer A'),
      ('00000000-0000-4000-8000-0000000000b2'::uuid, 'customer.b@dev.local', 'DevCustB!2026', '[DEV] Customer B')
    ) as t(id, email, pw, name)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
            extensions.crypt(u.pw, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name), now(), now(),
            '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email),
            'email', now(), now(), now());
  end loop;
end $$;

update public.profiles set role = 'owner' where id = '00000000-0000-4000-8000-0000000000a1';
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-0000000000a2';
update public.profiles set role = 'staff' where id = '00000000-0000-4000-8000-0000000000a3';
-- staff accounts are not customers
delete from public.customers where user_id in (
  '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3');

update public.app_settings set require_staff_mfa = false where id = 1;  -- DEV ONLY
update public.business_settings set name = '[DEV] Sultan Records', canonical_base_url = 'http://127.0.0.1:3000' where id = 1;

insert into public.staff_members (id, profile_id, full_name, specialty, phone)
values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a3', '[DEV] Staff Photographer', 'photo', '0500000003');

do $$
declare
  v_cust_a uuid := (select id from public.customers where user_id = '00000000-0000-4000-8000-0000000000b1');
  v_cust_b uuid := (select id from public.customers where user_id = '00000000-0000-4000-8000-0000000000b2');
  v_a1 uuid := '00000000-0000-4000-8000-0000000000e1';
  v_a2 uuid := '00000000-0000-4000-8000-0000000000e2';
  v_b1 uuid := '00000000-0000-4000-8000-0000000000e3';
  v_b2 uuid := '00000000-0000-4000-8000-0000000000e4';
  v_deliv uuid := gen_random_uuid();
  v_vid1 uuid := gen_random_uuid();
  v_vid2 uuid := gen_random_uuid();
  v_asset uuid;
  i int;
begin
  insert into public.events (id, customer_id, title, event_type, event_date, venue, city, status) values
    (v_a1, v_cust_a, '[DEV] Customer A wedding', 'wedding', current_date + 30, '[DEV] Hall', '[DEV] City', 'editing'),
    (v_b1, v_cust_b, '[DEV] Customer B engagement', 'engagement', current_date + 45, '[DEV] Garden', '[DEV] City', 'planned'),
    (v_b2, v_cust_b, '[DEV] Customer B graduation', 'graduation', current_date - 20, '[DEV] Campus', '[DEV] City', 'delivered');

  insert into public.events (id, customer_id, title, event_type, event_date, city, status, public_slug,
                             publication_consent, consent_at, consent_by, is_published, seo_title, highlight)
  values (v_a2, v_cust_a, '[DEV] Sample published project', 'festival', current_date - 60, '[DEV] City', 'delivered',
          'dev-sample-published-project', 'granted', now(), '00000000-0000-4000-8000-0000000000b1', true,
          '[DEV] Sample published project', '[DEV] For UI testing only');

  insert into public.event_staff_assignments (event_id, staff_id, role_label)
  values (v_a1, '00000000-0000-4000-8000-0000000000c1', 'photographer');

  -- 200 private images (tests >160 galleries)
  for i in 1..200 loop
    v_asset := gen_random_uuid();
    insert into public.media_assets (id, event_id, bucket, path, kind, mime, bytes, width, height, variants,
                                     visibility, sort_order, upload_status, uploaded_by)
    values (v_asset, v_a1, 'private-media', format('events/%s/%s/display.jpg', v_a1, v_asset), 'image', 'image/jpeg',
            350000, 2048, 1365,
            jsonb_build_object('thumb', format('events/%s/%s/thumb.webp', v_a1, v_asset),
                               'display', format('events/%s/%s/display.jpg', v_a1, v_asset)),
            'private', i, 'ready', '00000000-0000-4000-8000-0000000000a3');
  end loop;

  -- video deliverable with 2 revisions
  insert into public.media_assets (id, event_id, bucket, path, kind, mime, bytes, duration_s, visibility, upload_status, uploaded_by) values
    (v_vid1, v_a1, 'private-media', format('events/%s/%s/video.mp4', v_a1, v_vid1), 'video', 'video/mp4', 250000000, 240, 'private', 'ready', '00000000-0000-4000-8000-0000000000a3'),
    (v_vid2, v_a1, 'private-media', format('events/%s/%s/video.mp4', v_a1, v_vid2), 'video', 'video/mp4', 255000000, 236, 'private', 'ready', '00000000-0000-4000-8000-0000000000a3');
  insert into public.deliverables (id, event_id, kind, title, status, due_at)
  values (v_deliv, v_a1, 'video', '[DEV] Wedding highlight film', 'review', now() + interval '14 days');
  insert into public.deliverable_revisions (deliverable_id, revision_no, media_asset_id, notes, created_by) values
    (v_deliv, 1, v_vid1, '[DEV] First cut', '00000000-0000-4000-8000-0000000000a3'),
    (v_deliv, 2, v_vid2, '[DEV] Second cut after feedback', '00000000-0000-4000-8000-0000000000a3');
  insert into public.video_comments (revision_id, author_id, timecode_ms, body)
  select r.id, '00000000-0000-4000-8000-0000000000b1', 42000, '[DEV] Please trim this part'
  from public.deliverable_revisions r where r.deliverable_id = v_deliv and r.revision_no = 1;

  insert into public.booking_requests (contact_name, contact_phone, event_type, event_date, city, message, customer_id, idempotency_key)
  values ('[DEV] Customer A', '0500000011', 'wedding', current_date + 30, '[DEV] City', '[DEV] booking', v_cust_a, 'dev-seed-booking-0001');
end $$;

-- =====================================================================
--  [DEV] storage-independent fixtures for e2e specs.
--  Rows only; objects are uploaded by a separate script at these paths:
--    events/{event_id}/{asset_id}/original.{jpg|pdf}   (media_assets.path)
--    events/{event_id}/{asset_id}/thumb.webp           (variants.thumb, images)
--    events/{event_id}/{asset_id}/display.webp         (variants.display, images)
--  Fixed ids:
--    images on customer A event e2: 00000000-0000-4000-8000-0000000001a1 .. 01a5
--    document on customer B event e3: 00000000-0000-4000-8000-0000000001b1
--    quote (sent) for A/e1: 00000000-0000-4000-8000-0000000001c1
--    contract (sent, 1 version) for A/e1: 00000000-0000-4000-8000-0000000001d1
--    payment for A/e1: idempotency_key dev-seed-payment-0001
-- =====================================================================
do $$
declare
  v_cust_a uuid := (select id from public.customers where user_id = '00000000-0000-4000-8000-0000000000b1');
  v_e1 uuid := '00000000-0000-4000-8000-0000000000e1';
  v_e2 uuid := '00000000-0000-4000-8000-0000000000e2';
  v_e3 uuid := '00000000-0000-4000-8000-0000000000e3';
  v_id uuid;
  i int;
begin
  for i in 1..5 loop
    v_id := ('00000000-0000-4000-8000-0000000001a' || i)::uuid;
    insert into public.media_assets (id, event_id, bucket, path, kind, mime, bytes, width, height, variants,
                                     visibility, sort_order, upload_status, uploaded_by)
    values (v_id, v_e2, 'private-media', format('events/%s/%s/original.jpg', v_e2, v_id), 'image', 'image/jpeg',
            400000, 2048, 1365,
            jsonb_build_object('thumb', format('events/%s/%s/thumb.webp', v_e2, v_id),
                               'display', format('events/%s/%s/display.webp', v_e2, v_id)),
            'private', i, 'ready', '00000000-0000-4000-8000-0000000000a2');
  end loop;

  v_id := '00000000-0000-4000-8000-0000000001b1';
  insert into public.media_assets (id, event_id, bucket, path, kind, mime, bytes, visibility, upload_status, uploaded_by)
  values (v_id, v_e3, 'private-media', format('events/%s/%s/original.pdf', v_e3, v_id), 'document', 'application/pdf',
          120000, 'private', 'ready', '00000000-0000-4000-8000-0000000000a2');

  insert into public.quotes (id, customer_id, event_id, status, valid_until)
  values ('00000000-0000-4000-8000-0000000001c1', v_cust_a, v_e1, 'draft', current_date + 30);
  insert into public.quote_items (quote_id, description, qty, unit_price, sort_order) values
    ('00000000-0000-4000-8000-0000000001c1', '[DEV] Photography coverage', 1, 800000, 1),
    ('00000000-0000-4000-8000-0000000001c1', '[DEV] Highlight film', 1, 450000, 2);
  update public.quotes set status = 'sent' where id = '00000000-0000-4000-8000-0000000001c1';

  insert into public.contracts (id, quote_id, customer_id, event_id)
  values ('00000000-0000-4000-8000-0000000001d1', '00000000-0000-4000-8000-0000000001c1', v_cust_a, v_e1);
  insert into public.contract_versions (contract_id, body, total, deposit_required)
  values ('00000000-0000-4000-8000-0000000001d1', '[DEV] Sample contract body. Not a real agreement.', 1250000, 300000);
  update public.contracts set status = 'sent' where id = '00000000-0000-4000-8000-0000000001d1';

  insert into public.payments (customer_id, event_id, contract_id, amount, method, reference, idempotency_key, recorded_by)
  values (v_cust_a, v_e1, '00000000-0000-4000-8000-0000000001d1', 300000, 'bank_transfer', '[DEV] deposit',
          'dev-seed-payment-0001', '00000000-0000-4000-8000-0000000000a1');
end $$;

-- LOCAL ONLY: scheduler target for the storage-cleanup Edge Function (migration 0010).
-- `kong` is the API gateway inside the local Docker network; the key is the well-known
-- `supabase start` demo service-role JWT (public, local-only). Staging/production set these
-- two Vault secrets by hand (docs/security-model.md, "Consent withdrawal"). Never commit real keys.
select vault.create_secret('http://kong:8000/functions/v1/storage-cleanup', 'storage_cleanup_url',
                           'LOCAL storage-cleanup function URL')
where not exists (select 1 from vault.secrets where name = 'storage_cleanup_url');
select vault.create_secret('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
                           'storage_cleanup_key', 'LOCAL demo service-role JWT (supabase start default)')
where not exists (select 1 from vault.secrets where name = 'storage_cleanup_key');
