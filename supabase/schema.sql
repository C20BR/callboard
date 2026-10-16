-- Callboard initial schema for Supabase. Run in the SQL Editor.
-- Invite-only access: disable public signups in Authentication settings, invite
-- each allowed person, then add their normalized email to authorized_users.
create extension if not exists pgcrypto;

create table if not exists public.authorized_users (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

create table if not exists public.cast_members (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  characters text not null default '',
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

create table if not exists public.rehearsal_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  is_builtin boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.rehearsal_types (name, is_builtin) values
  ('Music', true), ('Full Cast', true), ('Scene(s)', true)
on conflict (name) do nothing;

create table if not exists public.rehearsal_sessions (
  id uuid primary key default gen_random_uuid(),
  rehearsal_date date not null,
  rehearsal_time time,
  rehearsal_type text not null,
  taker text not null check (length(trim(taker)) > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.rehearsal_sessions(id) on delete cascade,
  cast_member_id uuid not null references public.cast_members(id) on delete restrict,
  status text not null check (status in ('Here', 'Late', 'Absent', 'Exempt')),
  notes text not null default '',
  updated_at timestamptz not null default now(),
  unique (session_id, cast_member_id)
);

create index if not exists attendance_records_cast_status_idx on public.attendance_records (cast_member_id, status);
create index if not exists rehearsal_sessions_date_idx on public.rehearsal_sessions (rehearsal_date desc);

create or replace function public.is_callboard_user()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.authorized_users au where au.email = lower(coalesce(auth.jwt()->>'email', ''))) $$;

create or replace function public.save_rehearsal(p_date date, p_type text, p_taker text, p_time time, p_records jsonb)
returns uuid language plpgsql security invoker set search_path = public
as $$
declare v_session uuid;
begin
  if not public.is_callboard_user() then raise exception 'This account is not authorized for Callboard.'; end if;
  if p_date is null or length(trim(p_type)) = 0 or length(trim(p_taker)) = 0 then raise exception 'Date, rehearsal type, and attendance taker are required.'; end if;
  insert into public.rehearsal_sessions (rehearsal_date, rehearsal_time, rehearsal_type, taker)
  values (p_date, p_time, trim(p_type), trim(p_taker)) returning id into v_session;
  insert into public.attendance_records (session_id, cast_member_id, status, notes)
  select v_session, (item->>'cast_member_id')::uuid, item->>'status', coalesce(item->>'notes', '')
  from jsonb_array_elements(p_records) item;
  return v_session;
end; $$;

alter table public.authorized_users enable row level security;
alter table public.cast_members enable row level security;
alter table public.rehearsal_types enable row level security;
alter table public.rehearsal_sessions enable row level security;
alter table public.attendance_records enable row level security;

create policy "authorized users can read their own authorization" on public.authorized_users for select to authenticated using (email = lower(coalesce(auth.jwt()->>'email', '')));
create policy "authorized users can read cast" on public.cast_members for select to authenticated using (public.is_callboard_user());
create policy "authorized users can manage cast" on public.cast_members for all to authenticated using (public.is_callboard_user()) with check (public.is_callboard_user());
create policy "authorized users can read types" on public.rehearsal_types for select to authenticated using (public.is_callboard_user());
create policy "authorized users can add custom types" on public.rehearsal_types for insert to authenticated with check (public.is_callboard_user() and not is_builtin);
create policy "authorized users can read sessions" on public.rehearsal_sessions for select to authenticated using (public.is_callboard_user());
create policy "authorized users can create sessions" on public.rehearsal_sessions for insert to authenticated with check (public.is_callboard_user());
create policy "authorized users can delete sessions" on public.rehearsal_sessions for delete to authenticated using (public.is_callboard_user());
create policy "authorized users can read attendance" on public.attendance_records for select to authenticated using (public.is_callboard_user());
create policy "authorized users can add attendance" on public.attendance_records for insert to authenticated with check (public.is_callboard_user());
create policy "authorized users can correct attendance" on public.attendance_records for update to authenticated using (public.is_callboard_user()) with check (public.is_callboard_user());
create policy "authorized users can delete attendance" on public.attendance_records for delete to authenticated using (public.is_callboard_user());

grant usage on schema public to authenticated;
grant select on public.authorized_users to authenticated;
grant select, insert, update, delete on public.cast_members to authenticated;
grant select, insert on public.rehearsal_types to authenticated;
grant select, insert, delete on public.rehearsal_sessions to authenticated;
grant select, insert, update, delete on public.attendance_records to authenticated;
grant execute on function public.is_callboard_user() to authenticated;
grant execute on function public.save_rehearsal(date, text, text, time, jsonb) to authenticated;
revoke all on function public.is_callboard_user() from public, anon;
revoke all on function public.save_rehearsal(date, text, text, time, jsonb) from public, anon;
grant execute on function public.is_callboard_user() to authenticated;
grant execute on function public.save_rehearsal(date, text, text, time, jsonb) to authenticated;

-- Add authorized users manually from the SQL Editor, after inviting them:
-- insert into public.authorized_users (email) values ('person@example.com');
