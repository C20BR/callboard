# Callboard

A mobile-friendly attendance tracker for rehearsal teams. It runs as a static site on GitHub Pages and stores shared records in Supabase. The source `.xlsm` workbook was not included in this project folder; the referenced conversation contained a workbook-derived specification, which informed the fields, built-in rehearsal types, and call-in rules implemented here. The original workbook has not been modified.

## What is included

- One shared cast roster; multiple characters are stored together on each actor.
- Here, Late, Absent, and Exempt statuses, with bulk actions and date helper.
- Music, Full Cast, and Scene(s) built-in types, plus custom types.
- Confirmed rehearsal saves, duplicate date/type review, attendance notes, and editable history.
- Corrections update the underlying attendance record, so late, absence, and call-in totals stay synchronized.
- An optional start-time checkbox distinguishes multiple practices on one date; the time appears in history and recent rehearsals.
- A late-versus-absence chart, cast summary, and JSON backup download.
- Invite-only Supabase sign-in, user-chosen usernames and passwords, database Row Level Security, and an installable PWA shell.
- The production administrator is the only account that can add, edit, or remove cast members. Every authorized member can take attendance; their username is recorded as the attendance taker.
- An administrator-only tab can clear rehearsal history or, after history is cleared, clear the cast roster.

Call-ins follow the workbook: Here + Late + Absent are counted; Exempt is excluded. The app stores Exempt rows too, so each session retains every cast member's marked status. There is no separate expected-rehearsal schedule, so an actor not yet marked in a session is not counted.

## 1. Create the private database

1. Create a Supabase project and keep its database password private.
2. In the Supabase SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql) once. If it reports that a policy already exists, do not rerun it; continue with the migration below.
3. In the SQL Editor, run [`supabase/migration_accounts_and_roster_admin.sql`](supabase/migration_accounts_and_roster_admin.sql).
4. In the SQL Editor, run [`supabase/migration_admin_tools_and_times.sql`](supabase/migration_admin_tools_and_times.sql). This adds the optional time field and admin-only bulk actions; old rehearsals keep their dates and records.
5. In **Authentication → Providers → Email**, disable public sign-ups. Keep email/password sign-in enabled.
6. In **Authentication → URL Configuration**, set Site URL and add the GitHub Pages site URL to the allowed redirect URLs (including the site root).
7. Invite each production team member under **Authentication → Users**. Add each invited email to `public.authorized_users` from the SQL Editor, in lowercase:

   ```sql
   insert into public.authorized_users (email) values ('person@example.com');
   ```

   The invited person opens the email link at Callboard and chooses a username and password. They must be on the allowlist before finishing setup. Only authorized emails can read production data. Authenticated accounts without an allowlist entry see no cast or attendance data. Do not grant team members SQL Editor or project-owner access unless they need database administration.
8. Add only the production administrator's email to `public.callboard_roster_admins`, in lowercase. Run this in SQL Editor after inviting and allowlisting that person:

   ```sql
   insert into public.callboard_roster_admins (email)
   values ('admin@example.com')
   on conflict (email) do nothing;
   ```

   Do not add other users to this table. Other authorized users can take attendance and see the shared roster but cannot change its cast members. The admin table is separate from the general authorized-user allowlist.

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

Only the production administrator can delete rehearsal history. The Admin tab can clear all history while keeping the roster, or clear the roster after history is empty. Each action requires confirmation and is permanent. Individual cast members with saved records cannot be removed, which protects historical links; edit their name/characters instead.

## Notes for maintainers

- This is a static front end. It does not include secrets or a server-side API.
- Authorization is enforced by PostgreSQL Row Level Security, not just by hiding the sign-in form.
- `authorized_users` and `callboard_roster_admins` are maintained by the production administrator in the Supabase SQL Editor; the app does not provide a user-management screen.
- The service worker caches only same-origin app files and never caches Supabase API responses.
- Do not publish real attendance data, Supabase database passwords, or service-role keys in this repository.
