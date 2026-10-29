-- 0028 Facebook queue: finish_requested_at exists, defaults to null, and stays server-written (owners read only).
begin;
select plan(3);
select has_column('public', 'facebook_reel_posts', 'finish_requested_at', 'finish_requested_at exists');
select col_hasnt_default('public', 'facebook_reel_posts', 'finish_requested_at', 'no default (set by the worker only)');
select ok(not has_column_privilege('authenticated', 'public.facebook_reel_posts', 'finish_requested_at', 'update'), 'owners cannot write it');
select * from finish();
rollback;
