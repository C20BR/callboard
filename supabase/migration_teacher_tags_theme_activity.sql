-- Run after migration_custom_tag_groups.sql.
-- Allows teachers to change cast tags, stores the production theme, and adds
-- an authorized, trigger-written activity feed for roster and rehearsal edits.

begin;

-- The production administrator remains able to switch between the original
-- Spotlight look and the Dolly-inspired 9 to 5 palette.
alter table public.callboard_settings
  add column if not exists theme_key text not null default 'nine_to_five';

alter table public.callboard_settings
  drop constraint if exists callboard_settings_theme_key_check;
alter table public.callboard_settings
  add constraint callboard_settings_theme_key_check
  check (theme_key in ('spotlight', 'nine_to_five'));

grant update (theme_key) on public.callboard_settings to authenticated;

-- Teachers can update cast rows, while this trigger guarantees their only
-- mutable field is tags. RLS still decides which authorized roles can update.
drop policy if exists "roster admins can edit cast" on public.cast_members;
drop policy if exists "teachers and admins can edit cast tags" on public.cast_members;
create policy "teachers and admins can edit cast tags"
  on public.cast_members for update to authenticated
  using (public.is_callboard_roster_admin() or public.is_callboard_teacher())
  with check (public.is_callboard_roster_admin() or public.is_callboard_teacher());

create or replace function public.protect_teacher_cast_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Database-owner maintenance outside a signed-in Callboard request remains possible.
  if auth.uid() is null or public.is_callboard_roster_admin() then
    return new;
  end if;
  if not public.is_callboard_teacher()
     or (to_jsonb(new) - 'tags') is distinct from (to_jsonb(old) - 'tags') then
    raise exception 'Teachers may edit cast tags only.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_teacher_cast_updates() from public, anon, authenticated;
drop trigger if exists protect_teacher_cast_updates on public.cast_members;
create trigger protect_teacher_cast_updates
  before update on public.cast_members
  for each row execute function public.protect_teacher_cast_updates();

create table if not exists public.callboard_activity (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null,
  event_type text not null,
  summary text not null,
  target_type text not null,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists callboard_activity_recent_idx
  on public.callboard_activity (created_at desc, id desc);

alter table public.callboard_activity enable row level security;
drop policy if exists "authorized users can read callboard activity"
  on public.callboard_activity;
create policy "authorized users can read callboard activity"
  on public.callboard_activity for select to authenticated
  using (public.is_callboard_user());

revoke all on table public.callboard_activity from public, anon, authenticated;
grant select on table public.callboard_activity to authenticated;

-- Internal trigger helper. Browser users can read the feed but cannot insert,
-- edit, or delete entries. The username is snapshotted so entries stay useful
-- even if a team member later leaves the production.
create or replace function public.write_callboard_activity(
  p_event_type text,
  p_summary text,
  p_target_type text,
  p_target_id uuid,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_name text;
begin
  if auth.uid() is null then
    return;
  end if;

  select coalesce(
    p.username,
    nullif(split_part(coalesce(auth.jwt()->>'email', ''), '@', 1), ''),
    'Production team'
  )
  into v_actor_name
  from (select 1) seed
  left join public.callboard_profiles p on p.user_id = auth.uid();

  insert into public.callboard_activity (
    actor_id, actor_name, event_type, summary, target_type, target_id, details
  ) values (
    auth.uid(), v_actor_name, p_event_type, p_summary, p_target_type,
    p_target_id, coalesce(p_details, '{}'::jsonb)
  );

  delete from public.callboard_activity
  where id not in (
    select id from public.callboard_activity order by id desc limit 500
  );
end;
$$;

revoke all on function public.write_callboard_activity(text, text, text, uuid, jsonb)
  from public, anon, authenticated;

create or replace function public.audit_cast_member_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_tags text;
  v_after_tags text;
  v_summary text;
begin
  if tg_op = 'INSERT' then
    v_after_tags := coalesce(nullif(array_to_string(new.tags, ', '), ''), 'none');
    perform public.write_callboard_activity(
      'cast_added',
      'Added ' || new.name || ' to the cast with tags: ' || v_after_tags || '.',
      'cast_member', new.id,
      jsonb_build_object('name', new.name, 'characters', new.characters, 'tags_after', new.tags)
    );
    return new;
  elsif tg_op = 'DELETE' then
    perform public.write_callboard_activity(
      'cast_removed', 'Removed ' || old.name || ' from the cast.',
      'cast_member', old.id,
      jsonb_build_object('name', old.name, 'characters', old.characters, 'tags_before', old.tags)
    );
    return old;
  end if;

  if new.tags is distinct from old.tags then
    v_before_tags := coalesce(nullif(array_to_string(old.tags, ', '), ''), 'none');
    v_after_tags := coalesce(nullif(array_to_string(new.tags, ', '), ''), 'none');
    v_summary := 'Changed tags for ' || new.name || ': ' || v_before_tags || ' → ' || v_after_tags || '.';
    if new.name is distinct from old.name then
      v_summary := v_summary || ' Name changed from ' || old.name || ' to ' || new.name || '.';
    end if;
    perform public.write_callboard_activity(
      'roster_tags_changed', v_summary, 'cast_member', new.id,
      jsonb_build_object(
        'name_before', old.name, 'name_after', new.name,
        'tags_before', old.tags, 'tags_after', new.tags,
        'characters_before', old.characters, 'characters_after', new.characters
      )
    );
  elsif new.name is distinct from old.name or new.characters is distinct from old.characters then
    perform public.write_callboard_activity(
      'cast_updated', 'Updated roster details for ' || new.name || '.',
      'cast_member', new.id,
      jsonb_build_object(
        'name_before', old.name, 'name_after', new.name,
        'characters_before', old.characters, 'characters_after', new.characters
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function public.audit_cast_member_activity() from public, anon, authenticated;
drop trigger if exists audit_cast_member_activity on public.cast_members;
create trigger audit_cast_member_activity
  after insert or update or delete on public.cast_members
  for each row execute function public.audit_cast_member_activity();

create or replace function public.audit_rehearsal_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_summary text;
  v_changes text[] := array[]::text[];
  v_date_label text;
begin
  if tg_op = 'INSERT' then
    v_date_label := to_char(new.rehearsal_date, 'FMMonth FMDD, YYYY');
    v_summary := 'Saved ' || new.rehearsal_type || ' rehearsal for ' || v_date_label;
    if new.rehearsal_time is not null then
      v_summary := v_summary || ' at ' || to_char(new.rehearsal_time, 'FMHH12:MI AM');
    end if;
    if nullif(trim(new.location), '') is not null then
      v_summary := v_summary || ' at ' || new.location;
    end if;
    perform public.write_callboard_activity(
      'rehearsal_saved', v_summary || '.', 'rehearsal_session', new.id,
      jsonb_build_object('date', new.rehearsal_date, 'time', new.rehearsal_time,
        'rehearsal_type', new.rehearsal_type, 'location', new.location, 'taker', new.taker)
    );
    return new;
  elsif tg_op = 'DELETE' then
    v_date_label := to_char(old.rehearsal_date, 'FMMonth FMDD, YYYY');
    perform public.write_callboard_activity(
      'rehearsal_deleted', 'Deleted ' || old.rehearsal_type || ' rehearsal scheduled for ' || v_date_label || '.',
      'rehearsal_session', old.id,
      jsonb_build_object('date', old.rehearsal_date, 'rehearsal_type', old.rehearsal_type,
        'location', old.location, 'taker', old.taker)
    );
    return old;
  end if;

  if new.rehearsal_date is distinct from old.rehearsal_date then
    v_changes := array_append(v_changes, 'date ' || to_char(old.rehearsal_date, 'FMMonth FMDD, YYYY') || ' → ' || to_char(new.rehearsal_date, 'FMMonth FMDD, YYYY'));
  end if;
  if new.rehearsal_type is distinct from old.rehearsal_type then
    v_changes := array_append(v_changes, 'type ' || old.rehearsal_type || ' → ' || new.rehearsal_type);
  end if;
  if new.rehearsal_time is distinct from old.rehearsal_time then
    v_changes := array_append(v_changes, 'time updated');
  end if;
  if new.location is distinct from old.location then
    v_changes := array_append(v_changes, 'location ' || coalesce(nullif(old.location, ''), 'not set') || ' → ' || coalesce(nullif(new.location, ''), 'not set'));
  end if;
  if new.taker is distinct from old.taker then
    v_changes := array_append(v_changes, 'attendance taker updated');
  end if;
  if cardinality(v_changes) > 0 then
    v_date_label := to_char(new.rehearsal_date, 'FMMonth FMDD, YYYY');
    v_summary := 'Changed ' || new.rehearsal_type || ' rehearsal for ' || v_date_label || ': ' || array_to_string(v_changes, '; ') || '.';
    perform public.write_callboard_activity(
      'rehearsal_changed', v_summary, 'rehearsal_session', new.id,
      jsonb_build_object(
        'date_before', old.rehearsal_date, 'date_after', new.rehearsal_date,
        'time_before', old.rehearsal_time, 'time_after', new.rehearsal_time,
        'type_before', old.rehearsal_type, 'type_after', new.rehearsal_type,
        'location_before', old.location, 'location_after', new.location,
        'taker_before', old.taker, 'taker_after', new.taker
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function public.audit_rehearsal_activity() from public, anon, authenticated;
drop trigger if exists audit_rehearsal_activity on public.rehearsal_sessions;
create trigger audit_rehearsal_activity
  after insert or update or delete on public.rehearsal_sessions
  for each row execute function public.audit_rehearsal_activity();

create or replace function public.audit_attendance_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_type text;
  v_date date;
  v_changes text[] := array[]::text[];
  v_summary text;
begin
  if tg_op = 'INSERT' then
    if nullif(trim(new.notes), '') is null then
      return new;
    end if;
    select cm.name, rs.rehearsal_type, rs.rehearsal_date
      into v_name, v_type, v_date
      from public.cast_members cm
      join public.rehearsal_sessions rs on rs.id = new.session_id
     where cm.id = new.cast_member_id;
    v_summary := 'Added a note for ' || coalesce(v_name, 'a cast member') ||
      ' during ' || coalesce(v_type, 'a rehearsal') || ' on ' ||
      coalesce(to_char(v_date, 'FMMonth FMDD, YYYY'), 'an unknown date') || '.';
    perform public.write_callboard_activity(
      'attendance_note_added', v_summary, 'attendance_record', new.id,
      jsonb_build_object('cast_member', v_name, 'rehearsal_type', v_type,
        'rehearsal_date', v_date, 'status', new.status, 'note_added', true)
    );
    return new;
  elsif tg_op = 'DELETE' then
    return old;
  end if;

  if new.status is not distinct from old.status and new.notes is not distinct from old.notes then
    return new;
  end if;
  select cm.name, rs.rehearsal_type, rs.rehearsal_date
    into v_name, v_type, v_date
    from public.cast_members cm
    join public.rehearsal_sessions rs on rs.id = new.session_id
   where cm.id = new.cast_member_id;
  if new.status is distinct from old.status then
    v_changes := array_append(v_changes, 'status ' || old.status || ' → ' || new.status);
  end if;
  if new.notes is distinct from old.notes then
    if nullif(trim(new.notes), '') is null then
      v_changes := array_append(v_changes, 'note removed');
    elsif nullif(trim(old.notes), '') is null then
      v_changes := array_append(v_changes, 'note added');
    else
      v_changes := array_append(v_changes, 'note edited');
    end if;
  end if;
  v_summary := 'Updated attendance for ' || coalesce(v_name, 'a cast member') ||
    ' during ' || coalesce(v_type, 'a rehearsal') || ' on ' ||
    coalesce(to_char(v_date, 'FMMonth FMDD, YYYY'), 'an unknown date') || ': ' ||
    array_to_string(v_changes, '; ') || '.';
  perform public.write_callboard_activity(
    'attendance_updated', v_summary, 'attendance_record', new.id,
    jsonb_build_object('cast_member', v_name, 'rehearsal_type', v_type,
      'rehearsal_date', v_date, 'status_before', old.status, 'status_after', new.status,
      'note_before_present', nullif(trim(old.notes), '') is not null,
      'note_after_present', nullif(trim(new.notes), '') is not null)
  );
  return new;
end;
$$;

revoke all on function public.audit_attendance_activity() from public, anon, authenticated;
drop trigger if exists audit_attendance_activity on public.attendance_records;
create trigger audit_attendance_activity
  after insert or update or delete on public.attendance_records
  for each row execute function public.audit_attendance_activity();

create or replace function public.audit_tag_group_assignment_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Skip FK-cascade updates caused by renaming a category; the category event
  -- records that single admin action without generating one entry per tag.
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public.write_callboard_activity(
      'tag_group_assigned', 'Placed tag “' || new.tag_key || '” in the “' || new.group_name || '” group.',
      'tag_group_assignment', null,
      jsonb_build_object('tag', new.tag_key, 'group_after', new.group_name)
    );
    return new;
  elsif tg_op = 'DELETE' then
    perform public.write_callboard_activity(
      'tag_group_unassigned', 'Removed tag “' || old.tag_key || '” from its group.',
      'tag_group_assignment', null,
      jsonb_build_object('tag', old.tag_key, 'group_before', old.group_name)
    );
    return old;
  elsif new.group_name is distinct from old.group_name then
    perform public.write_callboard_activity(
      'tag_group_changed', 'Moved tag “' || new.tag_key || '” from “' || old.group_name || '” to “' || new.group_name || '”.',
      'tag_group_assignment', null,
      jsonb_build_object('tag', new.tag_key, 'group_before', old.group_name, 'group_after', new.group_name)
    );
  end if;
  return new;
end;
$$;

revoke all on function public.audit_tag_group_assignment_activity() from public, anon, authenticated;
drop trigger if exists audit_tag_group_assignment_activity on public.roster_tag_groups;
create trigger audit_tag_group_assignment_activity
  after insert or update or delete on public.roster_tag_groups
  for each row execute function public.audit_tag_group_assignment_activity();

create or replace function public.audit_tag_category_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_callboard_activity('tag_group_created', 'Created the “' || new.name || '” tag group.', 'tag_group', null, jsonb_build_object('name_after', new.name));
    return new;
  elsif tg_op = 'DELETE' then
    perform public.write_callboard_activity('tag_group_deleted', 'Deleted the “' || old.name || '” tag group.', 'tag_group', null, jsonb_build_object('name_before', old.name));
    return old;
  elsif new.name is distinct from old.name then
    perform public.write_callboard_activity('tag_group_renamed', 'Renamed the tag group “' || old.name || '” to “' || new.name || '”.', 'tag_group', null, jsonb_build_object('name_before', old.name, 'name_after', new.name));
  end if;
  return new;
end;
$$;

revoke all on function public.audit_tag_category_activity() from public, anon, authenticated;
drop trigger if exists audit_tag_category_activity on public.roster_tag_categories;
create trigger audit_tag_category_activity
  after insert or update or delete on public.roster_tag_categories
  for each row execute function public.audit_tag_category_activity();

create or replace function public.audit_theme_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_theme_name text;
begin
  if new.theme_key is distinct from old.theme_key then
    v_theme_name := case new.theme_key when 'nine_to_five' then '9 to 5' else 'Spotlight' end;
    perform public.write_callboard_activity(
      'theme_changed', 'Changed the production color theme to ' || v_theme_name || '.',
      'production_settings', null,
      jsonb_build_object('theme_before', old.theme_key, 'theme_after', new.theme_key)
    );
  end if;
  if new.google_calendar_embed_url is distinct from old.google_calendar_embed_url then
    perform public.write_callboard_activity(
      'calendar_changed', 'Updated the production Google Calendar connection.',
      'production_settings', null,
      jsonb_build_object('calendar_connected', new.google_calendar_embed_url <> '')
    );
  end if;
  return new;
end;
$$;

revoke all on function public.audit_theme_activity() from public, anon, authenticated;
drop trigger if exists audit_theme_activity on public.callboard_settings;
create trigger audit_theme_activity
  after update on public.callboard_settings
  for each row execute function public.audit_theme_activity();

commit;
