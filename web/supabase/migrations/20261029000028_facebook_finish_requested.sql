-- 0028 (LOCAL ONLY): Facebook queue — remember that «finish» was sent, so a lost reply never causes a second post.
--
-- facebook_reel_posts.finish_requested_at is stored BEFORE the worker sends Meta's «finish» call. Once set, «finish»
-- is never sent again for that row: a retry only reads the reel's status (published → recorded; still processing →
-- check again later; error or no confirmation after 5 checks → «failed» for the owner to check the Page by hand).
-- Kept separate from 0027 because 0027 was already published on the branch (PR #13).
--
-- Rollback (local): alter table public.facebook_reel_posts drop column finish_requested_at;

alter table public.facebook_reel_posts add column finish_requested_at timestamptz;
