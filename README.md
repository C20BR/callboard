# Callboard

A mobile-friendly attendance tracker for rehearsal teams. It runs as a static site on GitHub Pages and stores shared records in Supabase. The source `.xlsm` workbook was not included in this project folder; the referenced conversation contained a workbook-derived specification, which informed the fields, built-in rehearsal types, and call-in rules implemented here. The original workbook has not been modified.

## What is included

- One shared cast roster; multiple characters are stored together on each actor.
- Here, Late, and Absent statuses, with bulk actions and a date helper.
- Shared roster tags such as Ensemble, Soloist, and Main character. The production administrator can create, rename, and delete custom tag groups, assign tags to them, bulk-add a tag to people found by name/character or an existing tag, and attendance takers can filter by one or more grouped tags or select cast members by name without changing saved tags. Teachers can edit cast members’ attendance tags without changing names or characters.
- One chronological production history combines rehearsal records with tag, roster-name, theme, and attendance changes. Each entry shows the team member and time; note text is never copied into the activity log. Only the production administrator can delete individual activity entries.
- Saved color palettes: the new Dolly-inspired 9 to 5 look and the original Spotlight look can be switched by the production administrator.
- Any authorized team member can search the roster or overview by student or character name. The roster shows each match's tags; the overview shows matching absence, lateness, and call-in totals.
- Music, Full Cast, and Scene(s) built-in types, plus custom types.
- Confirmed rehearsal saves, duplicate date/type review, attendance notes, and editable history.
- Corrections update the underlying attendance record, so late, absence, and call-in totals stay synchronized.
- An optional start-time checkbox distinguishes multiple practices on one date; the time appears in history and recent rehearsals.
- A switchable late-versus-absence or call-ins chart, cast summary, and JSON backup download.
- Invite-only Supabase sign-in, user-chosen usernames and passwords, database Row Level Security, and an installable PWA shell.
- The production administrator is the only account that can add or remove cast members or edit their names and characters. Teachers can edit attendance tags. Every authorized member can take attendance; their username is recorded as the attendance taker.
- The production administrator can assign teacher roles to already-invited, authorized accounts. Everyone else is a stage manager by default. Teachers can edit attendance tags, delete individual rehearsals, and change rehearsal locations. They cannot access the Admin tab, edit cast names or characters, assign roles, or clear all history.
- Rehearsal locations are visible to the whole team. The production administrator and teachers can change a location; each rehearsal type remembers its latest default so stage managers see it when taking attendance.
- An optional, read-only Google Calendar embed is visible to signed-in Callboard users. Google Calendar still controls its own sharing permissions; calendar events are not copied into attendance records.
- An administrator-only tab can assign/remove teacher roles, delete individual activity log entries, clear rehearsal history, or, after history is cleared, clear the cast roster.

Call-ins count one Here, Late, or Absent attendance record per person per rehearsal. The tag or name selection determines who has a record on each new attendance sheet; cast members outside the selection are left off that session. Name selection is temporary and does not edit roster tags. Older Exempt records remain in history and are excluded from call-in totals. There is no separate expected-rehearsal schedule, so an actor without a record in a session is not counted.

## 1. Create the private database

1. Create a Supabase project and keep its database password private.
2. In the Supabase SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql) once. If it reports that a policy already exists, do not rerun it; continue with the migration below.
3. In the SQL Editor, run [`supabase/migration_accounts_and_roster_admin.sql`](supabase/migration_accounts_and_roster_admin.sql).
4. In the SQL Editor, run [`supabase/migration_admin_tools_and_times.sql`](supabase/migration_admin_tools_and_times.sql). This adds the optional time field and admin-only bulk actions; old rehearsals keep their dates and records.
5. In the SQL Editor, run [`supabase/migration_security_advisor.sql`](supabase/migration_security_advisor.sql). This changes the authorization helpers to run with caller permissions and restricts the admin-status lookup to the signed-in user's own email. It does not change rehearsal, attendance, or cast records.
6. In the SQL Editor, run [`supabase/migration_roster_tags.sql`](supabase/migration_roster_tags.sql). It adds an empty tags field to each existing cast member without changing roster or attendance data.
7. In the SQL Editor, run [`supabase/migration_teacher_roles_and_locations.sql`](supabase/migration_teacher_roles_and_locations.sql). Existing accounts stay stage managers; it adds blank location fields and the calendar setting without changing attendance or assigning anyone elevated access.
8. In the SQL Editor, run [`supabase/migration_invite_allowlist_and_tag_groups.sql`](supabase/migration_invite_allowlist_and_tag_groups.sql). It adds tag-assignment storage and automatically adds newly invited accounts to Callboard's allowlist. It does not change existing cast or attendance data.
9. In the SQL Editor, run [`supabase/migration_custom_tag_groups.sql`](supabase/migration_custom_tag_groups.sql). It allows the production administrator to create, rename, and delete tag groups in Callboard. Existing tags and attendance records stay in place; old fixed-group assignments become unassigned.
10. In the SQL Editor, run [`supabase/migration_teacher_tags_theme_activity.sql`](supabase/migration_teacher_tags_theme_activity.sql). This lets teachers edit tags only, adds the saved production palette, and creates an activity feed readable by authorized production accounts. The feed is trigger-written, capped at 500 stored entries, and does not copy note text into the activity log.
11. In the SQL Editor, run [migration_activity_log_admin_delete.sql](supabase/migration_activity_log_admin_delete.sql). This allows only roster administrators to delete individual activity entries and refreshes the API schema cache.
12. In **Authentication → Providers → Email**, disable public sign-ups. Keep email/password sign-in enabled.
13. In **Authentication → URL Configuration**, set Site URL and add the GitHub Pages site URL to the allowed redirect URLs (including the site root).
14. Invite each production team member under **Authentication → Users**. New dashboard invitations are automatically added to `public.authorized_users` by the migration, so you no longer need to add the same email manually. The invited person opens the email link at Callboard and chooses a username and password. Only invited accounts can read production data; never enable public sign-ups for this project.

   Accounts invited before this migration are not automatically backfilled. If an existing invited account is missing from the allowlist, add just that account once from the SQL Editor, in lowercase:

   ```sql
   insert into public.authorized_users (email) values ('person@example.com');
   ```

   Do not grant team members SQL Editor or project-owner access unless they need database administration.
15. Add only the production administrator's email to `public.callboard_roster_admins`, in lowercase. Run this in SQL Editor after inviting that person:

   ```sql
   insert into public.callboard_roster_admins (email)
   values ('admin@example.com')
   on conflict (email) do nothing;
   ```

   Do not add teachers to this table. Stage managers can take attendance and see the shared roster but cannot change cast members. Teachers can edit tags only. The admin table is separate from the general authorized-user allowlist.

16. After deployment, sign in as the production administrator and use **Admin → Teacher roles** to assign teacher access to each teacher's exact sign-in email. The email must already have a Supabase invitation. Remove the role there to return someone to stage-manager permissions.
17. To connect a Google Calendar, open its settings on a computer, choose **Integrate calendar**, and copy the calendar's embed URL (the `src` address in the embed code). In Callboard, open **Admin → Google Calendar** and paste that URL. Set sharing in Google Calendar before connecting it: a private calendar requires each viewer to have Google access, while a public calendar may be visible to anyone. Callboard sign-in does not also sign the viewer in to Google. The embed is read-only; attendance takers check it for the call, then save attendance separately in Callboard.

## 2. Configure GitHub Pages

The Supabase project URL and publishable/anon key are browser-visible settings. They are safe to include in a static app **only because** database Row Level Security is enabled. Never use a `service_role` key here.

1. In the repository settings, add Actions secrets named `SUPABASE_URL` and `SUPABASE_ANON_KEY` with the Supabase project URL and publishable/anon key.
2. Push this project to a GitHub repository. The workflow at `.github/workflows/deploy.yml` creates `config.js` during deployment and publishes the static files to GitHub Pages.
3. In **Settings → Pages**, choose **GitHub Actions** as the build and deployment source. The workflow deploys on pushes to `main` and can also be run manually.
4. Wait for the Pages deployment to finish, then open its URL. Invite users only after the final site URL is known and configured as an allowed redirect.

If your default branch is not `main`, change the workflow trigger branch. `config.js` is intentionally ignored by Git, so local or manually uploaded copies should not be committed.

## 3. Install on iPhone

Open the deployed HTTPS Pages site in Safari, sign in, tap **Share**, then **Add to Home Screen**. Launching Callboard from its home screen opens the app-style shell. The service worker caches the app shell only; attendance data and authentication are fetched securely from Supabase when online. The app does not cache private records for offline use.

## Backups and data management

Use **Export backup** while signed in to download a JSON backup to the current device. Store that file somewhere private. This is an export, not an automatic scheduled backup. Supabase project backups and recovery settings should also be configured for the production's retention needs.

Teachers and the production administrator can delete individual rehearsals, with a confirmation prompt; deleting a rehearsal also removes its attendance records. Only the production administrator can delete individual activity-log entries, clear all rehearsal history, or clear the roster. Each bulk action requires confirmation and is permanent. Individual cast members with saved records cannot be removed, which protects historical links; edit their name/characters instead.

## Notes for maintainers

- This is a static front end. It does not include secrets or a server-side API.
- Authorization is enforced by PostgreSQL Row Level Security, not just by hiding the sign-in form.
- `authorized_users` and `callboard_roster_admins` are maintained by the production administrator in the Supabase SQL Editor. Teacher roles are assigned in the app but remain protected by database policies.
- The service worker caches only same-origin app files and never caches Supabase API responses.
- Do not publish real attendance data, Supabase database passwords, or service-role keys in this repository.
