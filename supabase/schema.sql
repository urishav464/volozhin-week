-- =============================================================================
-- שבוע וולוז'ין — the whole database, in one file.
--
-- How to run: Supabase → SQL Editor → paste this file → Run. Run it again after
-- every change: it is idempotent (IF NOT EXISTS / CREATE OR REPLACE / guarded
-- seeds), and a second run must never fail or overwrite what people edited.
--
-- Permission model (read this before touching anything):
--   * The browser holds the project's PUBLISHABLE key, so `anon` and
--     `authenticated` can reach anything they are granted. The end of this file
--     REVOKEs everything from them and grants back exactly what is listed there.
--   * Every table has RLS enabled. Policies call app.my_role(...), which reads
--     public.members. RLS is ENABLED but not FORCED: the owner (Supabase's
--     `postgres`, i.e. the SQL Editor) and the SECURITY DEFINER helpers it owns
--     are exempt, which is what keeps members → my_role → members from recursing.
--   * Only Google sign-ins count (app.my_email() returns NULL otherwise), and
--     only addresses listed in public.members see any row at all.
--   * Helpers live in schema `app`, which PostgREST does not expose. Functions a
--     browser may call live in `public` and are granted one by one at the end.
--
-- Personal data (phones, e-mails, addresses) lives only in the database, never
-- in this file or anywhere in git. The first admin is added by hand:
--     select app.add_admin('your.address@example.org');   -- your real Gmail, typed in the SQL Editor only
-- =============================================================================

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto   with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm    with schema extensions;

create schema if not exists app;

-- -----------------------------------------------------------------------------
-- Schema version. The app compares it with EXPECTED_SCHEMA_VERSION
-- (src/lib/schema.ts) and shows «צריך להריץ שוב את schema.sql» on a mismatch.
-- Bump BOTH in the same commit as any structural change.
-- -----------------------------------------------------------------------------
create or replace function public.schema_version() returns integer
  language sql immutable
  as $$ select 1 $$;

-- -----------------------------------------------------------------------------
-- Editions — one per year's week (and practice/demo sandboxes, and archived
-- past years). Everything that belongs to one week hangs off an edition.
-- -----------------------------------------------------------------------------
create table if not exists public.editions (
  id             bigint generated always as identity primary key,
  label          text not null unique check (btrim(label) <> ''),
  kind           text not null default 'real' check (kind in ('real', 'practice', 'demo', 'archive')),
  start_date     date,                          -- the Sunday the week opens; NULL = TBD
  first_day_from integer check (first_day_from between 390 and 1830),   -- Sunday's opening minute; NULL = TBD
  last_day_until integer not null default 1140 check (last_day_until between 390 and 1830), -- Thursday ends 19:00
  status         text not null default 'planning' check (status in ('planning', 'active', 'archived')),
  settings       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Members — who may sign in, and as what. An e-mail is stored lower-case (the
-- CHECK) so the comparison in app.my_email() needs no case-folding operator.
-- edition_id NULL = every edition (meant for admins); otherwise one edition, so
-- last year's team loses access when a new week starts.
-- -----------------------------------------------------------------------------
create table if not exists public.members (
  id           bigint generated always as identity primary key,
  email        text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  display_name text not null default '',
  gender       text check (gender in ('m', 'f')),
  role         text not null check (role in ('admin', 'content', 'logistics')),
  edition_id   bigint references public.editions (id) on delete cascade,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index if not exists members_email_edition_key
  on public.members (email, coalesce(edition_id, 0));

-- -----------------------------------------------------------------------------
-- Identity helpers (schema app — never exposed over the API).
-- -----------------------------------------------------------------------------

-- The signed-in address, lower-cased — but only for a Google sign-in. Anything
-- else (an e-mail/password account, an anonymous session, no session) is NULL,
-- so it matches no member and sees nothing.
create or replace function app.my_email() returns text
  language sql stable security definer set search_path = ''
  as $$
    select case
      when coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google'
        or coalesce(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'google'
      then nullif(lower(btrim(auth.jwt() ->> 'email')), '')
    end
  $$;

-- My role in an edition: an admin row wins, then an all-editions row.
create or replace function app.my_role(p_edition bigint) returns text
  language sql stable security definer set search_path = ''
  as $$
    select m.role
      from public.members m
     where m.active
       and m.email = app.my_email()
       and (m.edition_id is null or m.edition_id = p_edition)
     order by (m.role = 'admin') desc, (m.edition_id is null) desc
     limit 1
  $$;

-- An admin of every edition (settings that are not per-year: categories,
-- the speaker pool's vetting, the fallen, templates).
create or replace function app.is_global_admin() returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1 from public.members m
       where m.active and m.role = 'admin' and m.edition_id is null
         and m.email = app.my_email())
  $$;

-- Any active membership at all.
create or replace function app.is_member() returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1 from public.members m
       where m.active and m.email = app.my_email())
  $$;

-- The editions I can see: every edition for an all-editions member, else mine.
create or replace function app.can_see_edition(p_edition bigint) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select app.my_role(p_edition) is not null $$;

-- First admin (and any later one): run by hand in the SQL Editor. Not
-- executable by any API role, so an address never has to be written in git.
create or replace function app.add_admin(p_email text) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_email text := lower(btrim(p_email));
  begin
    if v_email is null or v_email not like '%_@_%' then
      raise exception 'כתובת לא תקינה: %', p_email;
    end if;
    update public.members
       set role = 'admin', active = true
     where email = v_email and edition_id is null;
    if not found then
      insert into public.members (email, role, edition_id) values (v_email, 'admin', null);
    end if;
  end
  $$;

-- -----------------------------------------------------------------------------
-- Row-level security.
-- -----------------------------------------------------------------------------
alter table public.editions enable row level security;
alter table public.members  enable row level security;

drop policy if exists editions_select on public.editions;
create policy editions_select on public.editions
  for select to authenticated
  using ((select app.can_see_edition(id)));

drop policy if exists editions_admin_write on public.editions;
create policy editions_admin_write on public.editions
  for all to authenticated
  using ((select app.is_global_admin()))
  with check ((select app.is_global_admin()));

-- A member reads their own row; an admin reads (and manages) the rows of the
-- editions they administer. Everyone else's names come from public.team(),
-- which never returns an e-mail address.
drop policy if exists members_select on public.members;
create policy members_select on public.members
  for select to authenticated
  using (
    email = (select app.my_email())
    or (select app.is_global_admin())
    or (edition_id is not null and app.my_role(edition_id) = 'admin')
  );

drop policy if exists members_admin_write on public.members;
create policy members_admin_write on public.members
  for all to authenticated
  using (
    (select app.is_global_admin())
    or (edition_id is not null and app.my_role(edition_id) = 'admin')
  )
  with check (
    (select app.is_global_admin())
    or (edition_id is not null and role <> 'admin' and app.my_role(edition_id) = 'admin')
  );

-- -----------------------------------------------------------------------------
-- Functions a browser calls.
-- -----------------------------------------------------------------------------

-- The keep-alive ping (GitHub Actions, daily) — the only thing anon may run
-- before the escort and sign-up links exist.
create or replace function public.ping() returns text
  language sql stable security definer set search_path = ''
  as $$ select 'ok'::text $$;

-- Who am I? One round trip that decides which screen a signed-in browser
-- shows: «ok» (with my roles), «wrong_provider» (signed in, but not with
-- Google), «not_member» (Google, but not on the list).
create or replace function public.whoami() returns jsonb
  language sql stable security definer set search_path = ''
  as $$
    select case
      when auth.jwt() ->> 'email' is null then
        jsonb_build_object('status', 'signed_out', 'schema_version', public.schema_version())
      when app.my_email() is null then
        jsonb_build_object('status', 'wrong_provider', 'schema_version', public.schema_version())
      when not app.is_member() then
        jsonb_build_object('status', 'not_member', 'schema_version', public.schema_version())
      else jsonb_build_object(
        'status', 'ok',
        'schema_version', public.schema_version(),
        'email', app.my_email(),
        'display_name', (select m.display_name from public.members m
                          where m.active and m.email = app.my_email()
                          order by (m.role = 'admin') desc, (m.edition_id is null) desc limit 1),
        'global_admin', app.is_global_admin(),
        'memberships', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'edition_id', m.edition_id, 'role', m.role)
                                 order by m.edition_id nulls first), '[]'::jsonb)
                          from public.members m
                         where m.active and m.email = app.my_email()))
    end
  $$;

-- The team of an edition — names and roles, never e-mail addresses. Raises for
-- anyone who is not a member of that edition.
create or replace function public.team(p_edition bigint)
  returns table (id bigint, display_name text, gender text, role text)
  language plpgsql stable security definer set search_path = ''
  as $$
  begin
    if app.my_role(p_edition) is null then
      raise exception 'not_member' using errcode = '42501';
    end if;
    return query
      select m.id, m.display_name, m.gender, m.role
        from public.members m
       where m.active and (m.edition_id = p_edition or m.edition_id is null)
       order by m.display_name;
  end
  $$;

-- -----------------------------------------------------------------------------
-- Privileges — LAST, so they cover everything above on every run.
-- A new Supabase project may hand the public roles everything (older projects)
-- or nothing (projects since mid-2026); either way, this is the full list.
-- -----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema app    from public, anon, authenticated;
revoke all on schema app from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant usage on schema app to authenticated;          -- policies call app.*; not exposed by PostgREST

grant execute on function app.my_email()             to authenticated;
grant execute on function app.my_role(bigint)        to authenticated;
grant execute on function app.is_global_admin()      to authenticated;
grant execute on function app.is_member()            to authenticated;
grant execute on function app.can_see_edition(bigint) to authenticated;

grant select, insert, update, delete on public.editions to authenticated;
grant select, insert, update, delete on public.members  to authenticated;

grant execute on function public.ping()           to anon, authenticated;
grant execute on function public.schema_version() to authenticated;
grant execute on function public.whoami()         to authenticated;
grant execute on function public.team(bigint)     to authenticated;

commit;
