# CMS contract (owner-managed site content) — v1, 2026-10-18

Binding for all agents. Extends existing tables; **no competing tables** for content that already exists
(`business_settings`, `services`, `showcase_videos`, `video_categories`, `photo_albums`, `album_photos`).
One migration series starting `20261018000017_cms_*.sql`. All new tables: RLS on, `REVOKE ALL` from anon/authenticated
first, explicit grants (+ `service_role` grants — lesson from 0014), admin writes require `app.is_admin()` (aal2 rule
included), audit triggers on publish/identity/delete-relevant tables, `updated_at`/`updated_by` triggers.
Anon reads only what is published/active and only display columns (never drafts, rights notes, storage paths).

## Gap analysis (state on 2026-10-18, before this work)

| Requirement | Exists | Gap | Change | Acceptance test |
|---|---|---|---|---|
| Edit business identity | `business_settings` + admin settings page (name, tagline, phone, whatsapp, address, facebook, youtube_url, whatsapp_url) | Admin save doesn't invalidate public cache (`business-settings` tag) → change waits for cache expiry; no home texts; no logo control | updateTag on save; home text columns; logo versions | Edit tagline in admin → visible on live `/` within seconds |
| Home texts/buttons | Hard-coded in `features/public-content/home-content.ts` | Not editable | `site_content` columns (below) with code fallbacks | Change hero title → live |
| Hero cover / intro video choice | Static self-hosted promo; `is_promo` unused | No choice in admin | `hero_promo_source` + optional YouTube promo id + cover photo id | Switch promo source → live |
| Logo replacement (future) | Static `/brand/logo-main.webp` | No upload/preview/rollback | `brand_assets` versions, active pointer; current static logo stays default | Upload → preview → activate → rollback |
| Services CRUD | Table `services` exists; public reads it; **no admin UI**; fallback copy shown | No admin, no cover, no links to works | Admin CRUD + cover + `service_links` | Create/edit/reorder/hide → live |
| «طريقة شغلنا» | Hard-coded `STEPS` | Not editable | `process_steps` | Add/reorder step → live |
| Offers/packages | None (old site had `offers`) | Everything | `offers`, `offer_items`; `/offers` page + home section | Create, pin, expire by date (Asia/Hebron) → disappears automatically |
| Announcement bar/banner | None | Everything | `announcements` (fixed templates) | Schedule + link to offer → live |
| Nav & home sections | Hard-coded | Not editable | `nav_items`, `site_sections` (allow-listed keys) | Rename/reorder/hide without breaking URLs |
| Slug changes | Slugs editable for albums/services (DB) | Old links break | `slug_redirects` + proxy lookup | Rename slug → old URL 308 → new |
| Video role vs category | `showcase_videos` + categories; `is_promo` single flag | Role not separate; no pin | `role` (work/promo/both), `pinned`, `custom_cover_photo_id` | Add YouTube link, set role promo, pin → live |
| Albums | Albums, photos, admin bulk upload, cover, order, publish | No album categories; no archive/trash/restore; variants generated only while admin browser stays on page (step 2 called from browser); no retry queue; no dedupe | `album_categories`, soft delete, server-side processing queue + cron worker, sha256 dedupe | Close browser mid-upload → processing still completes; duplicate flagged |
| FB independence | Photos stored in `album-media` (own storage); `source_url` = FB link (metadata only) | Not proven explicitly | Check no fbcdn refs; import manifest table | All 128 photos served from `/p/…`; zero fbcdn URLs |
| Import manifest | `content/facebook-albums.json` + local cache | Not in DB; not resumable as a manifest | `import_items` | Re-run import → 0 dup, resumes failures |
| Backup/export | In-app JSON export to `backups` bucket (same Supabase project); local scripts for DB dump + storage copy | Not independent; originals export not a single resumable tool | Local resumable export tool (data + all files incl. originals + manifest + checksums) + restore into isolated env | Export → restore sample in separate local stack → checksums match |
| Admin UX | Operational admin (dense) | No "محتوى الموقع" area; no draft/preview pattern; no unsaved-changes guard | Content area with drafts, preview, publish/hide, ordering (drag + buttons) | Owner flows on phone width |

## Schema (new / extended)

### `business_settings` (extend, single row id=1, public read as today)
`hero_title text`, `hero_subtitle text`, `hero_primary_label text`, `hero_secondary_label text`,
`booking_message text` (default WhatsApp text), `hero_cover_photo_id uuid → album_photos on delete set null`,
`hero_promo_source text check in ('site','youtube') default 'site'`, `hero_promo_video_id uuid → showcase_videos on delete set null`,
`active_logo_id uuid → brand_assets on delete set null` (null = built-in static logo, which stays the default).
All text columns: plain text, length-capped (titles ≤ 120, paragraphs ≤ 600), no HTML rendering anywhere.

### `brand_assets` (new)
`id, kind ('logo'), storage_path (bucket site-media, private), mime, width, height, bytes, sha256, note, created_by, created_at`.
Only admins read; public gets the active logo through route `/a/<id>` (anon RPC returns path only when it is the active logo).

### `site_sections` (new) — home sections config
`key text pk check in ('works','services','offers','promos','albums','process','about','contact')`,
`title text`, `intro text`, `is_visible bool default true`, `sort_order int`, `item_limit int check between 1 and 12 default 6`,
`featured_ids uuid[] default '{}'` (validated in admin by section type). Seeded with the current home order & copy.

### `nav_items` (new)
`id, label text (≤ 30), target text check in ('home','work','services','offers','promos','albums','about','contact','book','faq')`,
`sort_order, is_visible`. Admin/login are never nav items (cannot be disabled through this). Targets map to fixed internal paths in code.

### `slug_redirects` (new)
`from_path text pk check (from_path ~ '^/(services|offers|work/albums)/[a-z0-9-]+$')`, `to_path text same check`, `created_at`.
Written automatically by trigger when a slug changes on services/offers/photo_albums. Anon read (paths only).

### `services` (extend)
`cover_photo_id uuid → album_photos set null`, keep `summary`, `body`, `sort_order`, `is_published`.
`service_links` (new): `service_id → services cascade, kind ('video','album'), target_id uuid, sort_order, pk(service_id,kind,target_id)`; anon reads links whose target is public.

### `process_steps` (new)
`id, title (≤ 80), description (≤ 300), photo_id uuid → album_photos set null, sort_order, is_published`.

### `offers` (new) + `offer_items`
`offers`: `id, slug unique, title, description, image_photo_id → album_photos set null, price_minor bigint null check >=0, currency char(3) default 'ILS', show_price bool default false, starts_on date null, ends_on date null (inclusive, check ends_on >= starts_on), terms text, whatsapp_message text, status ('draft','published','archived') default 'draft', pinned_home bool, sort_order`.
Active = `status='published' and (starts_on is null or starts_on <= hebron_today) and (ends_on is null or ends_on >= hebron_today)` where `hebron_today = (now() at time zone 'Asia/Hebron')::date` via `app.hebron_today()`. Anon RLS returns only active offers (expiry needs no manual action).
`offer_items`: `offer_id cascade, label (≤ 120), sort_order`.

### `announcements` (new)
`id, template ('bar','banner'), text (≤ 140), link_kind ('none','offer','page'), link_offer_id → offers set null, link_page text (same allow-list as nav targets), starts_on, ends_on, is_visible, dismissible bool, sort_order`. Anon sees active only (same Hebron rule).

### `showcase_videos` (extend)
`role text check in ('work','promo','both') default 'work'` (categories stay separate = occasion type), `pinned bool default false`,
`custom_cover_photo_id → album_photos set null`. Existing `is_promo` stays as "main promo" flag. Anon gets `role, pinned` (+ cover id).

### Albums (extend)
`album_categories` (id, slug, title, sort_order, is_published) + `photo_albums.category_id`.
Soft delete: `photo_albums.archived_at`, `photo_albums.deleted_at` (trash), `album_photos.deleted_at`; anon never sees archived/deleted;
hard delete only via admin RPC `purge_album(id, confirm_slug)` that enqueues storage cleanup.
Dedupe: `album_photos.sha256 text`, unique `(album_id, sha256)` where not deleted; admin RPC `find_duplicate_photo(sha256)` returns album ids/titles only (no paths).
Processing: `upload_status` adds `'processing'`; columns `attempts int default 0`, `last_error text`, `processing_started_at`.
Worker: Next route `POST /api/jobs/process-photos` (secret header `JOBS_SECRET`, server-only) claims pending/failed(attempts<5)/stale-processing rows, generates variants with sharp (480/q76, 1600/q82 — same as now), marks ready/failed. pg_cron every minute via pg_net (Vault secrets `jobs_url`, `jobs_secret`), plus admin "إعادة المعالجة".

### `import_items` (new, admin-only)
`id, source ('facebook','folder','zip'), source_ref text, album_id, file_name, sha256, bytes, status ('pending','uploaded','processed','failed','skipped_duplicate'), error, photo_id, created_at, updated_at, unique(source, source_ref)`.

## Code contracts
- Cache tags: `web/src/lib/cache-tags.ts` (`TAGS`). Public queries `cacheTag(TAGS.x)`; admin actions `updateTag(TAGS.x)` for every affected tag.
- Public allow-listed paths for nav/sections/announcements: `web/src/lib/site-targets.ts` (target → path, label default) — created by the public agent; admin imports it.
- WhatsApp: `web/src/lib/whatsapp.ts` (`whatsappHref`, `projectText`); offers use `whatsapp_message` or `«مرحباً، بدي أستفسر عن عرض: <title>»`.
- YouTube: `web/src/lib/youtube.ts` only (no iframes from admin input).
- Text is rendered as text; URLs only via allow-list (internal targets) or validated https (social links).
