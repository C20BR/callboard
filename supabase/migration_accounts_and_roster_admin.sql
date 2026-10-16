-- Run after schema.sql. This adds invited-user profiles and a single-admin
-- roster permission model without changing existing attendance records.

create table if not exists public.callboard_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,24}$'),
  created_at timestamptz not null default now()
);

create unique index if not exists callboard_profiles_username_ci_idx
  on public.callboard_profiles (lower(username));

create table if not exists public.callboard_roster_admins (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

create or replace function public.is_callboard_roster_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.callboard_roster_admins a
    where a.email = lower(coalesce(auth.jwt()->>'email', ''))
  )
  and public.is_callboard_user();
$$;

alter table public.callboard_profiles enable row level security;
alter table public.callboard_roster_admins enable row level security;

drop policy if exists "profiles readable by owner" on public.callboard_profiles;
create policy "profiles readable by owner" on public.callboard_profiles
  for select to authenticated
  using (user_id = auth.uid() and public.is_callboard_user());

drop policy if exists "users create own profile" on public.callboard_profiles;
create policy "users create own profile" on public.callboard_profiles
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_callboard_user());

drop policy if exists "users update own profile" on public.callboard_profiles;
create policy "users update own profile" on public.callboard_profiles
  for update to authenticated
  using (user_id = auth.uid() and public.is_callboard_user())
  with check (user_id = auth.uid() and public.is_callboard_user());

-- The admin allowlist is maintained only in Supabase SQL Editor by the project owner.
-- Do not grant table access to browser users.
revoke all on public.callboard_roster_admins from anon, authenticated;
grant select, insert, update, delete on public.callboard_profiles to authenticated;

revoke all on function public.is_callboard_roster_admin() from public, anon;
grant execute on function public.is_callboard_roster_admin() to authenticated;

-- Existing policies let every authorized user change cast. Replace them with
-- read access for the team and insert/update/delete access for roster admins only.
drop policy if exists "authorized users can manage cast" on public.cast_members;
drop policy if exists "roster admins can add cast" on public.cast_members;
drop policy if exists "roster admins can edit cast" on public.cast_members;
drop policy if exists "roster admins can remove cast" on public.cast_members;

create policy "roster admins can add cast" on public.cast_members
  for insert to authenticated
  with check (public.is_callboard_roster_admin());
create policy "roster admins can edit cast" on public.cast_members
  for update to authenticated
  using (public.is_callboard_roster_admin())
  with check (public.is_callboard_roster_admin());
create policy "roster admins can remove cast" on public.cast_members
  for delete to authenticated
  using (public.is_callboard_roster_admin());

-- IMPORTANT: after you have invited yourself and added your email to
-- authorized_users, replace the example below and run it once to become the
-- only roster manager. Use the same email as your Callboard sign-in.
-- insert into public.callboard_roster_admins (email)
-- values ('you@example.com')
-- on conflict (email) do nothing;
