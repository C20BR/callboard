-- Run after migration_teacher_tags_theme_activity.sql.
-- Allows only roster administrators to remove individual activity-log entries.

begin;

grant delete on table public.callboard_activity to authenticated;

drop policy if exists "roster admins can delete callboard activity"
  on public.callboard_activity;
create policy "roster admins can delete callboard activity"
  on public.callboard_activity for delete to authenticated
  using (public.is_callboard_roster_admin());

-- Ensure the app can immediately discover the theme column added by the prior migration.
notify pgrst, 'reload schema';

commit;
