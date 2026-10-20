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

-- Supabase creates this (empty) publication in every project; Realtime reads it.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- Supabase Storage, as far as a policy and our functions can see it. Mirrors what
-- the storage-api's own migrations create (github.com/supabase/storage,
-- migrations/tenant, read 20.10.2026): storage.buckets and storage.objects with
-- the columns those migrations give them (0002 storage-schema, 0003 path_tokens,
-- 0008 public, 0013/0014 file_size_limit + allowed_mime_types, 0016 version,
-- 0018 owner_id — `owner` is deprecated — and 0062 object-versioning-core:
-- archived_at, is_delete_marker; 0066 the one live row per name), RLS on both
-- (0002, 0007), the API roles' grants on both (0046, minus 0073's TRUNCATE,
-- REFERENCES and TRIGGER), storage.foldername (0002), and the statement trigger
-- that refuses a DELETE from SQL unless storage.allow_delete_query is set
-- (0055 prevent-direct-deletes: deletes go through the Storage API, which also
-- removes the bytes). On Supabase the tables belong to supabase_storage_admin;
-- `postgres` may still CREATE/DROP POLICY on storage.objects (supautils
-- policy_grants) and INSERT into storage.buckets (0046/0049: ALL WITH GRANT
-- OPTION) — the two things schema.sql does there.
-- What is NOT here: the bytes (S3), the API itself. A test "uploads" as the
-- Storage API does: its permission probe INSERTs the row AS THE CALLER (role
-- authenticated, the caller's claims — Uploader.authorizeUpload), so the
-- INSERT policies decide; the real row is then written as owner with the
-- caller's sub in owner_id and the file's size and type in metadata. A delete
-- runs AS THE CALLER too (SELECT and DELETE policies), with
-- storage.allow_delete_query set, as the API sets it.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  public             boolean default false,
  avif_autodetection boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  owner_id           text,
  versioning_status  text not null default 'DISABLED'
);
create unique index if not exists bname on storage.buckets (name);

create table if not exists storage.objects (
  id               uuid not null default gen_random_uuid() primary key,
  bucket_id        text references storage.buckets (id),
  name             text,
  owner            uuid,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata         jsonb,
  path_tokens      text[] generated always as (string_to_array(name, '/')) stored,
  version          text,
  owner_id         text,
  user_metadata    jsonb,
  archived_at      timestamptz,
  is_delete_marker boolean not null default false,
  is_versioned     boolean not null default false
);
create unique index if not exists idx_objects_current_version on storage.objects (bucket_id, name collate "C") where archived_at is null;

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
revoke truncate, references, trigger on storage.objects, storage.buckets from anon, authenticated;

create or replace function storage.foldername(name text) returns text[]
  language plpgsql
  as $$
  declare _parts text[];
  begin
    select string_to_array(name, '/') into _parts;
    return _parts[1:array_length(_parts, 1) - 1];
  end
  $$;

create or replace function storage.protect_delete() returns trigger
  language plpgsql
  as $$
  begin
    if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
      raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
        using hint = 'This prevents accidental data loss from orphaned objects.', errcode = '42501';
    end if;
    return null;
  end
  $$;
drop trigger if exists protect_objects_delete on storage.objects;
create trigger protect_objects_delete before delete on storage.objects
  for each statement execute function storage.protect_delete();
grant execute on all functions in schema storage to anon, authenticated, service_role;
