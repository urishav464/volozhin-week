-- What a Supabase database already has before supabase/schema.sql runs: the API
-- roles, the `auth` helpers that read the request's JWT claims, and the
-- `extensions` schema. Tests impersonate a browser with
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claims', '<json>', true);
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists auth;
create or replace function auth.jwt() returns jsonb
  language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create or replace function auth.email() returns text
  language sql stable
  as $$ select auth.jwt() ->> 'email' $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
