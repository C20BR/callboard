# Callboard

A mobile-friendly attendance tracker for rehearsal teams. It runs as a static site on GitHub Pages and stores shared records in Supabase. The source `.xlsm` workbook was not included in this project folder; the referenced conversation contained a workbook-derived specification, which informed the fields, built-in rehearsal types, and call-in rules implemented here. The original workbook has not been modified.

## What is included

- One shared cast roster; multiple characters are stored together on each actor.
- Here, Late, Absent, and Exempt statuses, with bulk actions and date helper.
- Music, Full Cast, and Scene(s) built-in types, plus custom types.
- Confirmed rehearsal saves, duplicate date/type review, attendance notes, and editable history.
- Corrections update the underlying attendance record, so late, absence, and call-in totals stay synchronized.
- A late-versus-absence chart, cast summary, and JSON backup download.
- Invite-only Supabase sign-in, database Row Level Security, and an installable PWA shell.

Call-ins follow the workbook: Here + Late + Absent are counted; Exempt is excluded. The app stores Exempt rows too, so each session retains every cast member's marked status. There is no separate expected-rehearsal schedule, so an actor not yet marked in a session is not counted.

## 1. Create the private database

1. Create a Supabase project and keep its database password private.
2. In the Supabase SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql).
3. In **Authentication → Providers → Email**, disable public sign-ups. Keep email/password sign-in enabled.
4. In **Authentication → URL Configuration**, add the GitHub Pages site URL to the allowed redirect URLs (including the site root).
5. Invite each production team member under **Authentication → Users**. Add each invited email to `public.authorized_users` from the SQL Editor, in lowercase:

   ```sql
   insert into public.authorized_users (email) values ('person@example.com');
   ```

   Only authorized emails can read production data. Authenticated accounts without an allowlist entry see no cast or attendance data. Do not grant team members SQL editor or project-owner access unless they need database administration.

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

The history page allows a rehearsal to be deleted only after an explicit confirmation. Deletion removes its attendance records. A cast member with saved records cannot be removed, which protects historical links; edit their name/characters instead.

## Notes for maintainers

- This is a static front end. It does not include secrets or a server-side API.
- Authorization is enforced by PostgreSQL Row Level Security, not just by hiding the sign-in form.
- `authorized_users` is intended to be maintained by a production administrator in the Supabase SQL Editor; the app does not provide a user-management screen.
- The service worker caches only same-origin app files and never caches Supabase API responses.
- Do not publish real attendance data, Supabase database passwords, or service-role keys in this repository.
