-- Resolve the authenticated SECURITY DEFINER function warnings without
-- breaking the RLS policies that use these helpers.
-- Run after migration_accounts_and_roster_admin.sql.
-- This migration does not modify rehearsal, attendance, or cast records.

begin;

-- Keep the admin allowlist private while allowing each signed-in user to
-- check only whether their own email is in it.
alter table public.callboard_roster_admins enable row level security;

drop policy if exists "roster admins can read own admin status"
  on public.callboard_roster_admins;
create policy "roster admins can read own admin status"
  on public.callboard_roster_admins
  for select to authenticated
  using (email = lower(coalesce(auth.jwt()->>'email', '')));

revoke all on table public.authorized_users from public, anon, authenticated;
grant select on table public.authorized_users to authenticated;
revoke all on table public.callboard_roster_admins from public, anon, authenticated;
grant select on table public.callboard_roster_admins to authenticated;

-- These functions return only the calling user's own authorization status.
-- SECURITY INVOKER makes their table reads obey the RLS policies above.
alter function public.is_callboard_user() security invoker;
alter function public.is_callboard_user() set search_path = '';
alter function public.is_callboard_roster_admin() security invoker;
alter function public.is_callboard_roster_admin() set search_path = '';

-- RLS policies and the save/admin RPCs need authenticated execution. Do not
-- grant these helpers to anonymous callers or PUBLIC.
revoke all on function public.is_callboard_user() from public, anon;
revoke all on function public.is_callboard_roster_admin() from public, anon;
grant execute on function public.is_callboard_user() to authenticated;
grant execute on function public.is_callboard_roster_admin() to authenticated;

commit;
