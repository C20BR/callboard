-- Run after migration_security_advisor.sql.
-- Adds optional attendance tags to cast members without changing existing roster or attendance rows.

alter table public.cast_members
  add column if not exists tags text[] not null default '{}'::text[];
