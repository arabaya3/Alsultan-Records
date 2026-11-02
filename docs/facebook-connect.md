# Connecting the Facebook Page

The connection code is ready and stays off until the keys below are set. No real call to Meta has been made: tests use simulated responses, so the first real connection is the real test.

## What the owner does

1. On developers.facebook.com, with the owner's account, create a **Business** app and add **Facebook Login for Business**.
2. Under Valid OAuth Redirect URIs, add `https://sultan-records.vercel.app/api/facebook/callback`. It must match exactly.
3. Request `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`. Meta may require App Review and Business Verification before these work for the live Page.
4. On Vercel (Production), add `META_APP_ID` and `META_APP_SECRET`. Add `META_PAGE_ID` only if the account manages several Pages. Never use a `NEXT_PUBLIC_` name.
5. Add the production Vault secret `facebook_jobs_url`, with the value `https://sultan-records.vercel.app/api/jobs/facebook-reels`. Without it the queue does not run.
6. Deploy, open `/admin/settings/facebook` as the owner, and press **ربط صفحة فيسبوك**.

Connecting needs explicit approval, and it posts nothing by itself.

## Still missing

There is no screen yet for uploading a reel file with the "also post to Facebook" option. The queue and `request_facebook_reel_post` are ready for it. Facebook posting needs a real video file, because the site does not download from YouTube.

## Disconnecting

Disconnecting removes the token from Vault and does not delete anything already posted on Facebook. There is no disconnect button yet, so it is done with `public.meta_disconnect()`.
