-- =====================================================================
-- OPTIONAL: wipe the ERP so you can re-run 01_full_setup.sql
-- (e.g. the night before the demo, so sales history ends "yesterday").
-- Logins (auth.users) are kept; demo logins are re-created by the seed.
-- Run in Supabase → SQL Editor.
-- =====================================================================
drop trigger if exists on_auth_user_created on auth.users;
drop schema if exists public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on all tables in schema public to postgres, anon, authenticated, service_role;
grant all on all routines in schema public to postgres, anon, authenticated, service_role;
grant all on all sequences in schema public to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on routines to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role;
