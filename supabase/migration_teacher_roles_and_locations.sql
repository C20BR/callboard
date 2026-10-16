-- Run after migration_security_advisor.sql and migration_roster_tags.sql.
-- Adds teacher permissions, controlled rehearsal locations, and a Google
-- Calendar embed setting. Existing users
-- remain stage managers unless the production administrator assigns teacher.

begin;

-- Location defaults are attached to rehearsal types; each saved session also
-- keeps its own location so later edits do not rewrite historical sessions.
alter table public.rehearsal_types
  add column if not exists default_location text not null default '';

alter table public.rehearsal_sessions
  add column if not exists location text not null default '';

-- Teachers are selected by the production administrator from the existing
-- authorized-user allowlist. Removing an authorized user removes their role.
create table if not exists public.callboard_teachers (
  email text primary key references public.authorized_users(email) on delete cascade,
  added_at timestamptz not null default now(),
  constraint callboard_teachers_email_lowercase check (email = lower(email))
);

alter table public.callboard_teachers enable row level security;

create or replace function public.is_callboard_teacher()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.callboard_teachers t
    where t.email = lower(coalesce(auth.jwt()->>'email', ''))
  ) and public.is_callboard_user();
$$;

revoke all on function public.is_callboard_teacher() from public, anon;
grant execute on function public.is_callboard_teacher() to authenticated;

drop policy if exists "teachers can read their own role" on public.callboard_teachers;
create policy "teachers can read their own role"
  on public.callboard_teachers for select to authenticated
  using (email = lower(coalesce(auth.jwt()->>'email', '')));

drop policy if exists "production administrator can read teacher roles" on public.callboard_teachers;
create policy "production administrator can read teacher roles"
  on public.callboard_teachers for select to authenticated
  using (public.is_callboard_roster_admin());

drop policy if exists "production administrator can assign teachers" on public.callboard_teachers;
create policy "production administrator can assign teachers"
  on public.callboard_teachers for insert to authenticated
  with check (public.is_callboard_roster_admin());

drop policy if exists "production administrator can remove teachers" on public.callboard_teachers;
create policy "production administrator can remove teachers"
  on public.callboard_teachers for delete to authenticated
  using (public.is_callboard_roster_admin());

revoke all on table public.callboard_teachers from public, anon, authenticated;
grant select, insert, delete on table public.callboard_teachers to authenticated;

-- Store only the Google Calendar embed URL. Google still enforces whether the
-- calendar is private or public; the URL itself does not grant private access.
create table if not exists public.callboard_settings (
  id text primary key check (id = 'global'),
  google_calendar_embed_url text not null default '',
  constraint callboard_google_calendar_embed_url_check check (
    google_calendar_embed_url = ''
    or google_calendar_embed_url ~ '^https://calendar[.]google[.]com/calendar/embed[?]'
  )
);

insert into public.callboard_settings (id, google_calendar_embed_url)
values ('global', '')
on conflict (id) do nothing;

alter table public.callboard_settings enable row level security;

drop policy if exists "authorized users can view calendar settings" on public.callboard_settings;
create policy "authorized users can view calendar settings"
  on public.callboard_settings for select to authenticated
  using (public.is_callboard_user());

drop policy if exists "production administrator can update calendar settings" on public.callboard_settings;
create policy "production administrator can update calendar settings"
  on public.callboard_settings for update to authenticated
  using (public.is_callboard_roster_admin())
  with check (public.is_callboard_roster_admin());

revoke all on table public.callboard_settings from public, anon, authenticated;
grant select on table public.callboard_settings to authenticated;
grant update (google_calendar_embed_url) on table public.callboard_settings to authenticated;

-- Only the production administrator and teachers may add rehearsal types or
-- change a type's default location. Stage managers can still use those types.
drop policy if exists "authorized users can add custom types" on public.rehearsal_types;
drop policy if exists "teachers and admins can add custom types" on public.rehearsal_types;
create policy "teachers and admins can add custom types"
  on public.rehearsal_types for insert to authenticated
  with check (
    not is_builtin
    and (public.is_callboard_roster_admin() or public.is_callboard_teacher())
  );

drop policy if exists "teachers and admins can update rehearsal type locations" on public.rehearsal_types;
create policy "teachers and admins can update rehearsal type locations"
  on public.rehearsal_types for update to authenticated
  using (public.is_callboard_roster_admin() or public.is_callboard_teacher())
  with check (public.is_callboard_roster_admin() or public.is_callboard_teacher());

revoke update on table public.rehearsal_types from public, anon, authenticated;
revoke update (default_location) on table public.rehearsal_types from public, anon, authenticated;
grant update (default_location) on table public.rehearsal_types to authenticated;

-- The session row policy limits who can alter a location. The column grant
-- also prevents clients from changing dates, times, types, or attendance takers.
drop policy if exists "teachers and admins can update rehearsal locations" on public.rehearsal_sessions;
create policy "teachers and admins can update rehearsal locations"
  on public.rehearsal_sessions for update to authenticated
  using (public.is_callboard_roster_admin() or public.is_callboard_teacher())
  with check (public.is_callboard_roster_admin() or public.is_callboard_teacher());

revoke update on table public.rehearsal_sessions from public, anon, authenticated;
revoke update (location) on table public.rehearsal_sessions from public, anon, authenticated;
grant update (location) on table public.rehearsal_sessions to authenticated;

-- A stage manager cannot smuggle a different location through a direct API
-- insert. Their session receives the current default for its rehearsal type.
create or replace function public.apply_callboard_location_permissions()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (public.is_callboard_roster_admin() or public.is_callboard_teacher()) then
    select coalesce(rt.default_location, '')
      into new.location
      from public.rehearsal_types rt
      where rt.name = new.rehearsal_type
      limit 1;
    if not found then
      new.location := '';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists callboard_session_location_permissions on public.rehearsal_sessions;
create trigger callboard_session_location_permissions
  before insert on public.rehearsal_sessions
  for each row execute function public.apply_callboard_location_permissions();

-- Keep the existing 5-argument RPC for older open tabs, while the new app
-- passes the optional location in a separate 6-argument signature.
create or replace function public.save_rehearsal(
  p_date date,
  p_type text,
  p_taker text,
  p_time time,
  p_records jsonb,
  p_location text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session uuid;
begin
  if not public.is_callboard_user() then
    raise exception 'This account is not authorized for Callboard.';
  end if;
  if p_date is null or length(trim(p_type)) = 0 or length(trim(p_taker)) = 0 then
    raise exception 'Date, rehearsal type, and attendance taker are required.';
  end if;
  if not exists (select 1 from public.rehearsal_types where name = trim(p_type)) then
    raise exception 'Choose a rehearsal type that is available to this production.';
  end if;

  insert into public.rehearsal_sessions
    (rehearsal_date, rehearsal_time, rehearsal_type, taker, location)
  values
    (p_date, p_time, trim(p_type), trim(p_taker), coalesce(trim(p_location), ''))
  returning id into v_session;

  insert into public.attendance_records (session_id, cast_member_id, status, notes)
  select v_session, (item->>'cast_member_id')::uuid, item->>'status', coalesce(item->>'notes', '')
  from jsonb_array_elements(p_records) item;

  return v_session;
end;
$$;

revoke all on function public.save_rehearsal(date, text, text, time, jsonb, text) from public, anon;
grant execute on function public.save_rehearsal(date, text, text, time, jsonb, text) to authenticated;

create or replace function public.save_rehearsal(
  p_date date,
  p_type text,
  p_taker text,
  p_time time,
  p_records jsonb
)
returns uuid
language sql
security invoker
set search_path = public
as $$
  select public.save_rehearsal(p_date, p_type, p_taker, p_time, p_records, null::text);
$$;

revoke all on function public.save_rehearsal(date, text, text, time, jsonb) from public, anon;
grant execute on function public.save_rehearsal(date, text, text, time, jsonb) to authenticated;

-- Teachers may delete individual rehearsals, but the bulk clear functions
-- remain production-administrator-only.
drop policy if exists "authorized users can delete sessions" on public.rehearsal_sessions;
drop policy if exists "roster admins can delete sessions" on public.rehearsal_sessions;
drop policy if exists "teachers and admins can delete sessions" on public.rehearsal_sessions;
create policy "teachers and admins can delete sessions"
  on public.rehearsal_sessions for delete to authenticated
  using (public.is_callboard_roster_admin() or public.is_callboard_teacher());

drop policy if exists "authorized users can delete attendance" on public.attendance_records;
drop policy if exists "roster admins can delete attendance" on public.attendance_records;
drop policy if exists "teachers and admins can delete attendance" on public.attendance_records;
create policy "teachers and admins can delete attendance"
  on public.attendance_records for delete to authenticated
  using (public.is_callboard_roster_admin() or public.is_callboard_teacher());

commit;
