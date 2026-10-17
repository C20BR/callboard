-- Run after migration_invite_allowlist_and_tag_groups.sql.
-- Replaces fixed tag categories with production-admin-managed group names.
-- Existing roster tags and attendance records are not changed.

begin;

create table if not exists public.roster_tag_categories (
  name text primary key check (name = trim(name) and length(name) > 0),
  created_at timestamptz not null default now()
);

create unique index if not exists roster_tag_categories_name_lower_idx
  on public.roster_tag_categories (lower(name));

alter table public.roster_tag_categories enable row level security;

drop policy if exists "authorized users can read roster tag categories"
  on public.roster_tag_categories;
create policy "authorized users can read roster tag categories"
  on public.roster_tag_categories
  for select to authenticated
  using (public.is_callboard_user());

drop policy if exists "roster admins can manage roster tag categories"
  on public.roster_tag_categories;
create policy "roster admins can manage roster tag categories"
  on public.roster_tag_categories
  for all to authenticated
  using (public.is_callboard_roster_admin())
  with check (public.is_callboard_roster_admin());

revoke all on table public.roster_tag_categories from public, anon, authenticated;
grant select, insert, update, delete on table public.roster_tag_categories to authenticated;

-- Clear only the old fixed-category assignments. Tags and attendance records
-- remain untouched, and administrators can reassign tags to custom groups.
delete from public.roster_tag_groups
where group_name in ('Song', 'Scene', 'Other');

alter table public.roster_tag_groups
  drop constraint if exists roster_tag_groups_group_name_check;
alter table public.roster_tag_groups
  drop constraint if exists roster_tag_groups_group_name_fkey;
alter table public.roster_tag_groups
  add constraint roster_tag_groups_group_name_fkey
  foreign key (group_name)
  references public.roster_tag_categories(name)
  on update cascade
  on delete cascade;

grant select, insert, update, delete on table public.roster_tag_groups to authenticated;

commit;
