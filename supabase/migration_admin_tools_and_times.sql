-- Run after migration_accounts_and_roster_admin.sql.
-- Adds optional session times and admin-only bulk management functions.
-- Existing rehearsal rows retain a NULL time and are not changed.

alter table public.rehearsal_sessions
  add column if not exists rehearsal_time time;

-- Replace the original four-argument save function with the timed version.
drop function if exists public.save_rehearsal(date, text, text, jsonb);

create or replace function public.save_rehearsal(
  p_date date,
  p_type text,
  p_taker text,
  p_time time,
  p_records jsonb
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

  insert into public.rehearsal_sessions (rehearsal_date, rehearsal_time, rehearsal_type, taker)
  values (p_date, p_time, trim(p_type), trim(p_taker))
  returning id into v_session;

  insert into public.attendance_records (session_id, cast_member_id, status, notes)
  select v_session, (item->>'cast_member_id')::uuid, item->>'status', coalesce(item->>'notes', '')
  from jsonb_array_elements(p_records) item;

  return v_session;
end;
$$;

revoke all on function public.save_rehearsal(date, text, text, time, jsonb) from public, anon;
grant execute on function public.save_rehearsal(date, text, text, time, jsonb) to authenticated;

-- Keep already-open older Callboard tabs working; their calls save without a time.
create or replace function public.save_rehearsal(
  p_date date,
  p_type text,
  p_taker text,
  p_records jsonb
)
returns uuid
language sql
security invoker
set search_path = public
as $$
  select public.save_rehearsal(p_date, p_type, p_taker, null::time, p_records);
$$;

revoke all on function public.save_rehearsal(date, text, text, jsonb) from public, anon;
grant execute on function public.save_rehearsal(date, text, text, jsonb) to authenticated;

-- Session deletion is available only to the production administrator.
drop policy if exists "authorized users can delete sessions" on public.rehearsal_sessions;
drop policy if exists "roster admins can delete sessions" on public.rehearsal_sessions;
create policy "roster admins can delete sessions" on public.rehearsal_sessions
  for delete to authenticated
  using (public.is_callboard_roster_admin());

-- Direct attendance deletion is also admin-only. Session deletion removes its
-- attendance rows through the foreign-key cascade.
drop policy if exists "authorized users can delete attendance" on public.attendance_records;
drop policy if exists "roster admins can delete attendance" on public.attendance_records;
create policy "roster admins can delete attendance" on public.attendance_records
  for delete to authenticated
  using (public.is_callboard_roster_admin());

create or replace function public.clear_callboard_history()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if not public.is_callboard_roster_admin() then
    raise exception 'Only the production administrator can clear rehearsal history.';
  end if;
  delete from public.rehearsal_sessions;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.clear_callboard_roster()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if not public.is_callboard_roster_admin() then
    raise exception 'Only the production administrator can clear the cast roster.';
  end if;
  if exists (select 1 from public.rehearsal_sessions) then
    raise exception 'Clear rehearsal history before clearing the cast roster.';
  end if;
  delete from public.cast_members;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.clear_callboard_history() from public, anon;
revoke all on function public.clear_callboard_roster() from public, anon;
grant execute on function public.clear_callboard_history() to authenticated;
grant execute on function public.clear_callboard_roster() to authenticated;
