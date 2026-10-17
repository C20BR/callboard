-- Run after migration_security_advisor.sql.
-- Organizes attendance tags and automatically authorizes accounts created by
-- Supabase's admin invitation flow. Public sign-ups remain disabled.

begin;

create table if not exists public.roster_tag_groups (
  tag_key text primary key check (tag_key = lower(trim(tag_key)) and length(trim(tag_key)) > 0),
  group_name text not null check (group_name in ('Song', 'Scene', 'Other')),
  updated_at timestamptz not null default now()
);

alter table public.roster_tag_groups enable row level security;

drop policy if exists "authorized users can read roster tag groups"
  on public.roster_tag_groups;
create policy "authorized users can read roster tag groups"
  on public.roster_tag_groups
  for select to authenticated
  using (public.is_callboard_user());

drop policy if exists "roster admins can manage roster tag groups"
  on public.roster_tag_groups;
create policy "roster admins can manage roster tag groups"
  on public.roster_tag_groups
  for all to authenticated
  using (public.is_callboard_roster_admin())
  with check (public.is_callboard_roster_admin());

revoke all on table public.roster_tag_groups from public, anon, authenticated;
grant select, insert, update on table public.roster_tag_groups to authenticated;

-- Supabase creates auth.users rows for Dashboard invitations before the user
-- accepts the email. Only rows marked as invited are added to Callboard's
-- allowlist; open sign-ups do not receive access through this trigger.
create or replace function public.authorize_callboard_invites()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.invited_at is not null and nullif(trim(new.email), '') is not null then
    insert into public.authorized_users (email)
    values (lower(trim(new.email)))
    on conflict (email) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.authorize_callboard_invites() from public, anon, authenticated;

drop trigger if exists callboard_allowlist_invited_users on auth.users;
create trigger callboard_allowlist_invited_users
  after insert or update of invited_at on auth.users
  for each row execute function public.authorize_callboard_invites();

commit;
