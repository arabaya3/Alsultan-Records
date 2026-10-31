# Album photos on Hetzner Object Storage

Supabase keeps accounts, permissions and the database. Album objects can live on Supabase Storage or S3, per photo (`album_photos.storage_provider`). Only `album-media` is covered: on 2026-10-31 production held objects in no other bucket. `public-media`, `private-media`, `site-media` and reel videos stay on Supabase.

Nothing changes until `ALBUM_STORAGE_WRITE=s3` is set. Existing rows stay `supabase` until a verified copy switches them.

## How it works

- **Upload:** the server reserves the photo and fixes its key. The browser gets 15-minute URLs, each for one part and one exact length, and sends parts directly to the bucket (8 MiB, 4 at a time per file). No file passes through Vercel.
- **Every step re-checks the admin role** and that the reservation is open. The upload id and key stay on the server.
- **Completion:** the server reads the part list from S3, assembles the object and checks its size. The worker then checks the sha256 and the real format.
- **Reading:** `/p/<id>/<thumb|display>` checks publication first, on every request, including revalidation. Same `private, no-cache`. Originals are never served.
- **Deleting:** the queue records the store. The Edge Function claims Supabase items only; `/api/jobs/process-photos` and the admin button handle S3 items.

## Setup

1. Apply migration `20261031000032_album_storage_provider.sql`. It is additive, and the code currently deployed keeps working with it. Deploy the app only after this, because `/p` needs the new function.
2. Set server-only Vercel variables: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Never with `NEXT_PUBLIC_`. They are also read at build time for the CSP, which gets the bucket host only.
3. Check the bucket. This uses only a unique test prefix and removes it:
   ```
   cd web
   S3_ENV_FILE=<file with the S3_ values> node scripts/s3-check.mjs
   ```
4. Set CORS (PUT only) and the rule that drops unfinished uploads after 7 days, naming exact origins:
   ```
   S3_ENV_FILE=<file> node scripts/s3-check.mjs --apply-cors https://sultan-records.vercel.app,http://localhost:3000
   ```
5. Redeploy with `ALBUM_STORAGE_WRITE=s3`, then upload one test album before anything else.

## Moving existing photos

Supabase must be readable first: a plan restriction (HTTP 402) stops the script, by design. Nothing is deleted from Supabase.

```
cd web
export ENV_FILE=<file> MIGRATE_TARGET=<project ref>
node scripts/migrate-album-media-to-s3.mjs --manifest <file>                  # dry run
node scripts/migrate-album-media-to-s3.mjs --manifest <file> --copy           # copy and verify
node scripts/migrate-album-media-to-s3.mjs --manifest <file> --copy --switch  # also switch verified photos
```

- Safe to stop and rerun. The manifest records path, source, destination, size and sha256. Failures go to `<manifest>.failed`.
- Objects are streamed and read back from S3 to hash them. ETags are not treated as MD5.
- A different file at the destination stops that photo and is not overwritten.
- Only `ready` photos are copied. Unfinished rows are counted and stay on Supabase.
- Objects with no photo row are not copied. Compare the manifest with `storage.objects` before ever deleting the source.

## Going back

- **New uploads:** remove `ALBUM_STORAGE_WRITE` and redeploy. Photos already on S3 keep serving, so keep the `S3_*` variables.
- **Migrated photos:** the Supabase copies are still there, so set those rows back to `storage_provider = 'supabase'` (a production data change that needs approval). Photos uploaded directly to S3 have no Supabase copy and must stay.
- **The code:** old code cannot read S3 photos. Before rolling it back, return every migrated row and stop S3 uploads.
- Leave the migration in place; it is additive.

## Costs (check the live price pages)

| Item | Estimate |
|---|---|
| Hetzner base fee | About €6.49/month before VAT, including 1 TB storage and 1 TB egress. Older sources say €4.99. |
| Hetzner storage for 27.5 GB | Within the included 1 TB |
| Copying existing photos | Upload into Hetzner is free. Reading back about 27.5 GB counts as Hetzner egress unless the script runs inside Hetzner's network. It is also about 27.5 GB of Supabase egress. |
| Public photos | Each `/p` image passes through Vercel, so it counts as both Hetzner egress and Vercel bandwidth, as Supabase and Vercel do today |
| Extra Hetzner egress | About €1/TB |

Supabase's quota must be cleared before the copy, and the copy itself uses that quota. Keeping both copies means paying both until the Supabase copy is removed in a later, separately approved step.

## Limits

- Admin previews use 10-minute signed URLs directly from the bucket. Only thumb and display are signed.
- The emulator used in the automated tests does not enforce bucket privacy or signed part lengths. `s3-check.mjs` proves those on the real bucket.
