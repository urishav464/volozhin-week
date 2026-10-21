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
-- Bump BOTH in the same commit as any structural change. v12: its search_path
-- pinned too (Security Advisor, lint 0011) — every function here pins one
-- (tests/sql/schema.test.ts).
-- -----------------------------------------------------------------------------
create or replace function public.schema_version() returns integer
  language sql immutable set search_path = ''
  as $$ select 12 $$;

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
-- last year's team loses that week's grid when a new week starts. The speaker
-- pool itself (speakers: names, bios, the vetting note) is one list across the
-- years, readable by every active member — deactivate a row to close it too
-- (public/privacy.html says so).
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

-- The signed-in address, lower-cased — but only for an account that signed up
-- with Google. Anything else (an e-mail/password account — even one that also
-- has a Google identity linked — an anonymous session, no session) is NULL, so
-- it matches no member and sees nothing. (`providers` lists every linked
-- identity and says nothing about how THIS session signed in, so it is not
-- consulted.)
create or replace function app.my_email() returns text
  language sql stable security definer set search_path = ''
  as $$
    select case
      when coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google'
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
-- One's own row; a global admin sees every row, an edition's admin that
-- edition's rows. public/privacy.html says e-mails reach admins only — widen
-- this, update that page.
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
    -- an edition's admin manages that edition's non-admin rows only: it can
    -- neither create an admin nor demote or delete a fellow admin
    or (edition_id is not null and role <> 'admin' and app.my_role(edition_id) = 'admin')
  )
  with check (
    (select app.is_global_admin())
    or (edition_id is not null and role <> 'admin' and app.my_role(edition_id) = 'admin')
  );

-- -----------------------------------------------------------------------------
-- Functions a browser calls.
-- -----------------------------------------------------------------------------

-- The keep-alive ping (GitHub Actions, daily). With the public links' six
-- functions (v9, below), the whole of what anon may run. It reads nothing, so
-- since v12 it runs as the caller (SECURITY INVOKER): anon's SECURITY DEFINER
-- functions are exactly the six token-gated link functions.
create or replace function public.ping() returns text
  language sql stable security invoker set search_path = ''
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
                                 'edition_id', m.edition_id, 'role', m.role, 'member_id', m.id)
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

-- =============================================================================
-- Phase 1 — the grid. Semantics: docs/CONTRACT.md (the in-memory twin is
-- src/data/engine.ts; tests/parity holds the two together).
--
-- Every WRITE goes through a SECURITY DEFINER function below that checks who
-- is asking and enforces the contract; the browser gets SELECT only on the
-- tables (RLS-filtered). So no rule can be bypassed by writing a row directly.
-- The hard invariants are also constraints: a room or a speaker is never in
-- two places at once (EXCLUDE), one handler per speaker per edition (UNIQUE).
-- =============================================================================

-- ------------------------------------------------------------- cross-year

-- The grid every new edition copies — the 2026 poster's rows. Seeded once;
-- re-running this file never overwrites edits.
create table if not exists public.grid_template (
  id        bigint generated always as identity primary key,
  start_min integer not null check (start_min between 390 and 1830),
  end_min   integer not null check (end_min between 390 and 1830 and end_min > start_min),
  kind      text not null check (kind in ('lesson', 'fixed', 'kk', 'memorial')),
  label     text not null default '',
  days      smallint[] not null default '{0,1,2,3,4}'
);
insert into public.grid_template (start_min, end_min, kind, label)
select v.* from (values
  (390, 435, 'lesson', 'פתיחת יום'),
  (420, 480, 'fixed', 'ארוחת בוקר / חבורות'),
  (480, 510, 'fixed', 'דרך ארץ — חבורות לימוד בהובלת החניכים'),
  (510, 600, 'lesson', ''),
  (600, 690, 'lesson', ''),
  (690, 780, 'lesson', ''),
  (780, 795, 'memorial', 'זמן זיכרון א'),
  (795, 855, 'fixed', 'ארוחת צהריים / חבורות'),
  (855, 870, 'memorial', 'זמן זיכרון ב'),
  (870, 960, 'lesson', ''),
  (960, 1050, 'lesson', ''),
  (1050, 1140, 'lesson', ''),
  (1140, 1200, 'fixed', 'ארוחת ערב / חבורות'),
  (1200, 1290, 'lesson', ''),
  (1290, 1350, 'kk', 'מכריכה לכריכה'),
  (1350, 1440, 'lesson', ''),
  (1440, 1470, 'fixed', 'ארוחת חצות וניגונים / חבורות'),
  (1470, 1560, 'lesson', ''),
  (1560, 1650, 'lesson', ''),
  (1650, 1740, 'lesson', ''),
  (1740, 1830, 'kk', 'מכריכה לכריכה')
) as v(start_min, end_min, kind, label)
where not exists (select 1 from public.grid_template);

-- The ten study categories approved as the starting list (the instructor edits them).
create table if not exists public.categories (
  id     bigint generated always as identity primary key,
  name   text not null unique check (btrim(name) <> ''),
  color  text not null default '#8a93a8',
  sort   integer not null default 0,
  active boolean not null default true
);
insert into public.categories (name, color, sort)
select v.* from (values
  ('תנ"ך', '#8a5a2b', 1),
  ('תלמוד, הלכה ומדרש', '#5b4a8b', 2),
  ('מחשבת ישראל', '#2f6f73', 3),
  ('חסידות וקבלה', '#7a3e6d', 4),
  ('פילוסופיה', '#3d5a99', 5),
  ('ספרות ואמנות', '#a0522d', 6),
  ('ציונות והיסטוריה', '#5e7a2e', 7),
  ('חברה ואקטואליה', '#9a6b00', 8),
  ('מדע ונפש', '#2e7d5b', 9),
  ('דתות ותרבויות העולם', '#6b6b2e', 10)
) as v(name, color, sort)
where not exists (select 1 from public.categories);

-- A name's comparison key: no title words, no gershayim/geresh differences, no
-- vowel points, one space. IMMUTABLE (it feeds a stored column); if this
-- function ever changes, re-key: update public.speakers set name = name;
create or replace function app.name_key(p text) returns text
  language sql immutable set search_path = ''
  as $$
    select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
             lower(coalesce(p, '')),
             '[֑-ׇ]', '', 'g'),                         -- niqqud and cantillation
             '["״''׳]', '', 'g'),                                   -- gershayim / geresh / quotes
             '^(הרב|הרבנית|ד"?ר|דר|פרופ|פרופסור|פרופ\.)\s+', ''),   -- a leading title
             '[\s\-–־]+', ' ', 'g'))
  $$;

create table if not exists public.speakers (
  id            bigint generated always as identity primary key,
  title         text,
  name          text not null check (btrim(name) <> ''),
  gender        text check (gender in ('m', 'f')),
  affiliation   text,
  bio_short     text,
  topics        text[] not null default '{}',
  contact_pref  text check (contact_pref in ('phone', 'whatsapp', 'email', 'secretary')),
  vetted        text not null default 'pending' check (vetted in ('pending', 'approved', 'rejected')),
  vetted_by     bigint,
  vetted_at     timestamptz,
  vetted_note   text,                          -- the instructor's word on approving/rejecting (the team sees it)
  retired       boolean not null default false,
  source        text not null default 'manual',
  name_key      text generated always as (app.name_key(name)) stored,
  disambiguator text,
  version       integer not null default 1,
  created_by    bigint,
  created_at    timestamptz not null default now()
);
create unique index if not exists speakers_name_key on public.speakers (name_key, coalesce(disambiguator, ''));
alter table public.speakers add column if not exists vetted_note text;   -- v6, on a database from before
-- «ייתכן שזה…» (v6): trigram search over the name's comparison key.
create index if not exists speakers_name_trgm on public.speakers using gin (name_key extensions.gin_trgm_ops);

-- Contact details: their own table, never in Realtime, readable only by a
-- global admin and by whoever handles the speaker in the current real edition
-- (policy speaker_contacts_read).
create table if not exists public.speaker_contacts (
  speaker_id     bigint primary key references public.speakers (id) on delete cascade,
  phone          text,
  email          text,
  secretary_note text,
  notes          text
);

-- ------------------------------------------------------------- per edition

create table if not exists public.grid_rows (
  id         bigint generated always as identity primary key,
  edition_id bigint not null references public.editions (id) on delete cascade,
  start_min  integer not null check (start_min between 390 and 1830),
  end_min    integer not null check (end_min between 390 and 1830 and end_min > start_min),
  kind       text not null check (kind in ('lesson', 'fixed', 'kk', 'memorial')),
  label      text not null default '',
  days       smallint[] not null default '{0,1,2,3,4}'
);
create index if not exists grid_rows_edition on public.grid_rows (edition_id);

create table if not exists public.rooms (
  id         bigint generated always as identity primary key,
  edition_id bigint not null references public.editions (id) on delete cascade,
  name       text not null check (btrim(name) <> ''),
  sort       integer not null default 0,
  is_default boolean not null default false,
  unique (edition_id, name)
);
create unique index if not exists rooms_one_default on public.rooms (edition_id) where is_default;

create table if not exists public.approaches (
  id              bigint generated always as identity primary key,
  edition_id      bigint not null references public.editions (id) on delete cascade,
  speaker_id      bigint not null references public.speakers (id) on delete cascade,
  owner_member_id bigint references public.members (id) on delete set null,
  status          text not null default 'claimed' check (status in ('claimed', 'approached', 'positive', 'declined', 'no_answer')),
  avail_note      text,
  offered_to      bigint references public.members (id) on delete set null,   -- a hand-over waiting for its answer (v6)
  version         integer not null default 1,
  created_at      timestamptz not null default now(),
  unique (edition_id, speaker_id)
);
alter table public.approaches add column if not exists offered_to bigint references public.members (id) on delete set null;   -- v6

create table if not exists public.availability (
  id          bigint generated always as identity primary key,
  approach_id bigint not null references public.approaches (id) on delete cascade,
  day         smallint not null check (day between 0 and 4),
  from_min    integer not null check (from_min between 390 and 1830),
  to_min      integer not null check (to_min between 390 and 1830 and to_min > from_min),
  kind        text not null check (kind in ('can', 'cannot')),
  note        text
);

create table if not exists public.lessons (
  id               bigint generated always as identity primary key,
  edition_id       bigint not null references public.editions (id) on delete cascade,
  kind             text not null default 'lesson' check (kind in ('lesson', 'memorial')),
  state            text not null default 'draft' check (state in ('draft', 'closed', 'cancelled')),
  day              smallint not null check (day between 0 and 4),
  start_min        integer not null,
  end_min          integer not null,
  span             int4range generated always as (int4range(day * 1440 + start_min, day * 1440 + end_min)) stored,
  room_id          bigint not null references public.rooms (id),
  title            text,
  category_id      bigint references public.categories (id) on delete set null,
  audience         text,
  teach_min        integer check (teach_min > 0),
  parallel_reason  text,
  pay_amount       integer check (pay_amount > 0),   -- whole shekels (v7; a database from before is altered below)
  transport        text not null default 'none' check (transport in ('none', 'one_way', 'round_trip')),
  approval         text not null default 'none' check (approval in ('none', 'pending', 'approved', 'rejected')),
  approval_note    text,
  approved_by      bigint,
  approved_at      timestamptz,
  confirm_sent_at  timestamptz,
  confirm_sent_by  bigint,
  needs_reconfirm  boolean not null default false,
  escort_roster_id bigint,
  self_intro       boolean not null default false,
  escort_note      text,
  sources_kind     text not null default 'pending' check (sources_kind in ('pending', 'sheet', 'presentation', 'sheet_presentation', 'sheet_video', 'none', 'other')),
  print_when       text not null default 'none' check (print_when in ('none', 'before', 'same_day')),
  sources_note     text,
  presentation_url text,
  in_reader        boolean not null default false,
  paid_at          timestamptz,
  version          integer not null default 1,
  updated_by       bigint,
  created_at       timestamptz not null default now(),
  check (start_min >= 390 and end_min <= 1830 and start_min < end_min and start_min % 5 = 0 and end_min % 5 = 0),
  constraint lesson_room_excl exclude using gist (edition_id with =, room_id with =, span with &&) where (state <> 'cancelled')
);
create index if not exists lessons_edition on public.lessons (edition_id);

-- Who teaches a lesson. span/active are copied from the lesson (trigger), so
-- the speaker constraint can see them: a speaker is never in two CLOSED
-- lessons at overlapping times, co-teachers included.
create table if not exists public.lesson_speakers (
  lesson_id  bigint not null references public.lessons (id) on delete cascade,
  speaker_id bigint not null references public.speakers (id),
  role       text not null default 'lead' check (role in ('lead', 'co')),
  edition_id bigint not null,
  span       int4range not null,
  active     boolean not null default false,
  primary key (lesson_id, speaker_id),
  constraint speaker_time_excl exclude using gist (edition_id with =, speaker_id with =, span with &&) where (active)
);

create table if not exists public.pitches (
  id          bigint generated always as identity primary key,
  edition_id  bigint not null references public.editions (id) on delete cascade,
  lesson_id   bigint not null references public.lessons (id) on delete cascade,
  approach_id bigint not null references public.approaches (id) on delete cascade,
  state       text not null check (state in ('candidate', 'approached', 'declined', 'accepted', 'withdrawn', 'superseded')),
  proposed_by bigint,
  at          timestamptz not null default now(),
  unique (lesson_id, approach_id)
);

-- What happened, by whom — written only by the triggers below (definer), never
-- by a browser. No personal data in `detail`.
create table if not exists public.activity (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      bigint,
  edition_id bigint,
  entity     text not null,
  entity_id  bigint,
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb
);
create index if not exists activity_edition on public.activity (edition_id, at desc);

-- ------------------------------------------------------------- helpers

-- The caller's member row for an edition: the edition's own row first.
create or replace function app.my_member_id(p_edition bigint) returns bigint
  language sql stable security definer set search_path = ''
  as $$
    select m.id from public.members m
     where m.active and m.email = app.my_email()
       and (m.edition_id is null or m.edition_id = p_edition)
     order by (m.edition_id is null), (m.role = 'admin') desc
     limit 1
  $$;

-- A refusal with one of the contract's codes (src/errors.ts has the Hebrew).
create or replace function app.refuse(p_code text) returns void
  language plpgsql set search_path = ''
  as $$ begin raise exception using message = p_code, errcode = 'P0001'; end $$;

-- May the caller edit the grid of this edition? Returns their member id.
create or replace function app.require_editor(p_edition bigint) returns bigint
  language plpgsql stable security definer set search_path = ''
  as $$
  declare
    v_role text := app.my_role(p_edition);
    v_ed   public.editions;
  begin
    if v_role is null then perform app.refuse('not_member'); end if;
    if v_role = 'logistics' then perform app.refuse('forbidden'); end if;
    select * into v_ed from public.editions where id = p_edition;
    if v_ed.id is null then perform app.refuse('not_member'); end if;
    if (v_ed.kind = 'archive' or v_ed.status = 'archived') and v_role <> 'admin' then perform app.refuse('archived'); end if;
    return app.my_member_id(p_edition);
  end
  $$;

-- Lesson rows of a day, as the edition's window allows them (rowActive in src/grid/layout.ts).
create or replace function app.lesson_rows(p_edition bigint, p_day integer)
  returns setof public.grid_rows
  language sql stable security definer set search_path = ''
  as $$
    select r.* from public.grid_rows r join public.editions e on e.id = r.edition_id
     where r.edition_id = p_edition and r.kind = 'lesson' and p_day = any (r.days)
       and not (p_day = 0 and e.first_day_from is not null and r.end_min <= e.first_day_from)
       and not (p_day = 4 and r.start_min >= e.last_day_until)
     order by r.start_min
  $$;

create or replace function app.default_room(p_edition bigint) returns bigint
  language plpgsql stable security definer set search_path = ''
  as $$
  declare v bigint;
  begin
    select id into v from public.rooms where edition_id = p_edition order by is_default desc, sort, id limit 1;
    if v is null then perform app.refuse('bad_shape'); end if;
    return v;
  end
  $$;

create or replace function app.check_bounds(p_day integer, p_start integer, p_end integer) returns void
  language plpgsql immutable set search_path = ''
  as $$
  begin
    if p_day is null or p_start is null or p_end is null or p_day not between 0 and 4
       or p_start < 390 or p_end > 1830 or p_start >= p_end or p_start % 5 <> 0 or p_end % 5 <> 0 then
      perform app.refuse('bad_shape');
    end if;
  end
  $$;

-- "Just a speaker was pitched here": nothing shaped or written on the draft.
create or replace function app.is_plain(p_lesson bigint) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select l.state = 'draft' and l.title is null and l.parallel_reason is null
       and l.room_id = app.default_room(l.edition_id)
       and not exists (select 1 from public.pitches p where p.lesson_id = l.id and p.state in ('candidate', 'approached'))
       and exists (select 1 from app.lesson_rows(l.edition_id, l.day) r where r.start_min = l.start_min and r.end_min = l.end_min)
      from public.lessons l where l.id = p_lesson
  $$;

create or replace function app.new_draft(p_edition bigint, p_day integer, p_start integer, p_end integer, p_room bigint, p_actor bigint, p_reason text default null)
  returns bigint
  language plpgsql security definer set search_path = ''
  as $$
  declare v bigint;
  begin
    insert into public.lessons (edition_id, day, start_min, end_min, room_id, parallel_reason, updated_by)
    values (p_edition, p_day, p_start, p_end, p_room, p_reason, p_actor)
    returning id into v;
    return v;
  exception when exclusion_violation then
    perform app.refuse('room_taken');
    return null;
  end
  $$;

-- Live pitches of some lessons, one per approach (the most advanced, then the
-- oldest) — what a reshape carries over before deleting the lessons.
create or replace function app.carry(p_lessons bigint[])
  returns table (approach_id bigint, state text, proposed_by bigint, at timestamptz)
  language sql stable security definer set search_path = ''
  as $$
    select distinct on (p.approach_id) p.approach_id, p.state, p.proposed_by, p.at
      from public.pitches p
     where p.lesson_id = any (p_lessons) and p.state in ('candidate', 'approached')
     order by p.approach_id, (p.state = 'approached') desc, p.id
  $$;

-- Re-home carried pitches onto a lesson, never duplicating an approach there.
create or replace function app.adopt(p_lesson bigint, p_carried jsonb) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    c       record;
    v_ed    bigint;
    v_there public.pitches;
  begin
    select edition_id into v_ed from public.lessons where id = p_lesson;
    for c in select * from jsonb_to_recordset(p_carried) as x(approach_id bigint, state text, proposed_by bigint, at timestamptz) loop
      select * into v_there from public.pitches where lesson_id = p_lesson and approach_id = c.approach_id;
      if v_there.id is null then
        insert into public.pitches (edition_id, lesson_id, approach_id, state, proposed_by, at)
        values (v_ed, p_lesson, c.approach_id, c.state, c.proposed_by, c.at);
      elsif v_there.state not in ('candidate', 'approached') or (c.state = 'approached' and v_there.state = 'candidate') then
        update public.pitches set state = c.state where id = v_there.id;
      end if;
    end loop;
  end
  $$;

-- Serialize structural changes to one day of one edition (propose into a
-- cell, move, reshape): two people dropping into the same empty cell at the
-- same moment get one draft, not two.
create or replace function app.lock_day(p_edition bigint, p_day integer) returns void
  language sql set search_path = ''
  as $$ select pg_advisory_xact_lock(p_edition * 8 + p_day) $$;

-- Map a constraint violation to the contract's code.
create or replace function app.exclusion_code(p_constraint text) returns text
  language sql immutable set search_path = ''
  as $$ select case when p_constraint = 'speaker_time_excl' then 'speaker_busy' else 'room_taken' end $$;

-- ------------------------------------------------------------- triggers

-- lesson_speakers mirrors its lesson's edition, span and closed-ness.
create or replace function app.lesson_speakers_fill() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    select l.edition_id, l.span, l.state = 'closed' into new.edition_id, new.span, new.active
      from public.lessons l where l.id = new.lesson_id;
    return new;
  end
  $$;
drop trigger if exists lesson_speakers_fill on public.lesson_speakers;
create trigger lesson_speakers_fill before insert or update on public.lesson_speakers
  for each row execute function app.lesson_speakers_fill();

create or replace function app.lessons_sync_speakers() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if new.span is distinct from old.span or new.state is distinct from old.state then
      update public.lesson_speakers set span = new.span, active = (new.state = 'closed') where lesson_id = new.id;
    end if;
    return null;
  end
  $$;
drop trigger if exists lessons_sync_speakers on public.lessons;
create trigger lessons_sync_speakers after update on public.lessons
  for each row execute function app.lessons_sync_speakers();

-- The activity log. Ids, states and times only — never a name or a contact.
create or replace function app.log_activity() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_id  bigint;
    v_ed  bigint;
    v_det jsonb;
  begin
    if tg_table_name = 'lessons' then
      if tg_op = 'DELETE' then
        v_id := old.id; v_ed := old.edition_id;
        v_det := jsonb_build_object('state', old.state, 'day', old.day, 'start', old.start_min, 'end', old.end_min, 'room', old.room_id);
      else
        v_id := new.id; v_ed := new.edition_id;
        v_det := jsonb_build_object('state', new.state, 'day', new.day, 'start', new.start_min, 'end', new.end_min, 'room', new.room_id);
      end if;
    elsif tg_table_name = 'pitches' then
      if tg_op = 'DELETE' then
        v_id := old.id; v_ed := old.edition_id; v_det := jsonb_build_object('state', old.state, 'lesson', old.lesson_id, 'approach', old.approach_id);
      else
        v_id := new.id; v_ed := new.edition_id; v_det := jsonb_build_object('state', new.state, 'lesson', new.lesson_id, 'approach', new.approach_id);
      end if;
    else -- approaches
      if tg_op = 'DELETE' then
        v_id := old.id; v_ed := old.edition_id; v_det := jsonb_build_object('status', old.status, 'owner', old.owner_member_id, 'speaker', old.speaker_id);
      else
        v_id := new.id; v_ed := new.edition_id; v_det := jsonb_build_object('status', new.status, 'owner', new.owner_member_id, 'speaker', new.speaker_id);
        -- v6: a hand-over waiting for an answer, and the short note the pool's
        -- commands pass along (app.set_note sets it around their one UPDATE):
        -- the log is the approach's history.
        if new.offered_to is not null then v_det := v_det || jsonb_build_object('offered_to', new.offered_to); end if;
        if coalesce(current_setting('app.note', true), '') <> '' then
          v_det := v_det || jsonb_build_object('note', current_setting('app.note', true));
        end if;
      end if;
    end if;
    insert into public.activity (actor, edition_id, entity, entity_id, kind, detail)
    values (app.my_member_id(v_ed), v_ed, tg_table_name, v_id, lower(tg_op), v_det);
    return null;
  end
  $$;
drop trigger if exists lessons_activity on public.lessons;
create trigger lessons_activity after insert or update or delete on public.lessons for each row execute function app.log_activity();
drop trigger if exists pitches_activity on public.pitches;
create trigger pitches_activity after insert or update or delete on public.pitches for each row execute function app.log_activity();
drop trigger if exists approaches_activity on public.approaches;
create trigger approaches_activity after insert or update or delete on public.approaches for each row execute function app.log_activity();

-- ------------------------------------------------------------- RLS (reads)

alter table public.grid_template    enable row level security;
alter table public.categories       enable row level security;
alter table public.speakers         enable row level security;
alter table public.speaker_contacts enable row level security;
alter table public.grid_rows        enable row level security;
alter table public.rooms            enable row level security;
alter table public.approaches       enable row level security;
alter table public.availability     enable row level security;
alter table public.lessons          enable row level security;
alter table public.lesson_speakers  enable row level security;
alter table public.pitches          enable row level security;
alter table public.activity         enable row level security;

drop policy if exists grid_template_read on public.grid_template;
create policy grid_template_read on public.grid_template for select to authenticated using ((select app.is_member()));
drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select to authenticated using ((select app.is_member()));
drop policy if exists speakers_read on public.speakers;
create policy speakers_read on public.speakers for select to authenticated using ((select app.is_member()));

-- Contacts: a global admin, or whoever handles the speaker in a REAL edition
-- they belong to — and only while it is not archived. A speaker has one
-- contact row across all years, so without the edition check last year's
-- handler would keep reading this year's phone number. Practice and demo
-- editions never get archived (start_edition archives kind 'real' only) and a
-- sandbox member may claim any pool speaker there, so they give no access;
-- an imported 'archive' edition is not real either.
-- public/privacy.html tells users exactly this — widen the policy, update that page.
-- The predicate is app.may_see_contacts (v6): one definition for this policy
-- and for the pool's functions (get_speaker_contacts reads through this
-- policy; set_speaker_contacts writes for the same people). load_week and
-- every other function leave these columns out.

-- The real, non-archived edition in which I handle this speaker (content or
-- admin there), if any — the newest.
create or replace function app.contacts_edition(p_speaker bigint) returns bigint
  language sql stable security definer set search_path = ''
  as $$
    select a.edition_id from public.approaches a
      join public.editions e on e.id = a.edition_id
     where a.speaker_id = p_speaker
       and e.kind = 'real' and e.status <> 'archived'
       and a.owner_member_id = app.my_member_id(a.edition_id)
       and app.my_role(a.edition_id) in ('admin', 'content')
     order by a.edition_id desc
     limit 1
  $$;

create or replace function app.may_see_contacts(p_speaker bigint) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select app.is_global_admin() or app.contacts_edition(p_speaker) is not null $$;

drop policy if exists speaker_contacts_read on public.speaker_contacts;
create policy speaker_contacts_read on public.speaker_contacts for select to authenticated using (
  (select app.is_global_admin()) or app.may_see_contacts(speaker_contacts.speaker_id)
);

drop policy if exists grid_rows_read on public.grid_rows;
create policy grid_rows_read on public.grid_rows for select to authenticated using (app.can_see_edition(edition_id));
drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select to authenticated using (app.can_see_edition(edition_id));
drop policy if exists approaches_read on public.approaches;
create policy approaches_read on public.approaches for select to authenticated using (app.can_see_edition(edition_id));
drop policy if exists availability_read on public.availability;
create policy availability_read on public.availability for select to authenticated using (
  exists (select 1 from public.approaches a where a.id = availability.approach_id and app.can_see_edition(a.edition_id)));
drop policy if exists lessons_read on public.lessons;
create policy lessons_read on public.lessons for select to authenticated using (app.can_see_edition(edition_id));
drop policy if exists lesson_speakers_read on public.lesson_speakers;
create policy lesson_speakers_read on public.lesson_speakers for select to authenticated using (app.can_see_edition(edition_id));
drop policy if exists pitches_read on public.pitches;
create policy pitches_read on public.pitches for select to authenticated using (app.can_see_edition(edition_id));
drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select to authenticated using (edition_id is not null and app.can_see_edition(edition_id));

-- ------------------------------------------------------------- reads

-- load_week (everything the grid needs, in one round trip) is defined in the
-- v9 section below: it reads the roster and the escorts' ticks, created further down.

-- ------------------------------------------------------------- commands (docs/CONTRACT.md)

create or replace function public.propose(
  p_edition bigint, p_speaker bigint, p_lesson bigint, p_day integer, p_start integer, p_end integer, p_room bigint, p_mode text default 'self')
  returns jsonb
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_me      bigint := app.require_editor(p_edition);
    v_speaker public.speakers;
    v_app     public.approaches;
    v_lesson  public.lessons;
    v_room    bigint;
    v_state   text;
    v_pitch   public.pitches;
    v_new     bigint;
  begin
    if p_lesson is null and p_day is not null then perform app.lock_day(p_edition, p_day); end if;
    select * into v_speaker from public.speakers where id = p_speaker;
    if v_speaker.id is null or v_speaker.retired then perform app.refuse('speaker_retired'); end if;

    -- The approach first: a refusal here must not leave a draft behind.
    select * into v_app from public.approaches where edition_id = p_edition and speaker_id = p_speaker for update;
    if v_app.id is not null and v_app.owner_member_id is not null and v_app.owner_member_id <> v_me and coalesce(p_mode, 'self') = 'self' then
      perform app.refuse('approach_owned');
    end if;

    if p_lesson is not null then
      select * into v_lesson from public.lessons where id = p_lesson and edition_id = p_edition for update;
      if v_lesson.id is null or v_lesson.kind <> 'lesson' or v_lesson.state <> 'draft' then perform app.refuse('cell_closed'); end if;
    else
      perform app.check_bounds(p_day, p_start, p_end);
      if not exists (select 1 from app.lesson_rows(p_edition, p_day) r where r.start_min <= p_start and p_end <= r.end_min) then
        perform app.refuse('outside_grid');
      end if;
      -- A room of this edition only (as in move_lesson): another edition's room
      -- would pin it there — its admin could no longer delete it (rooms_guard).
      if p_room is not null and not exists (select 1 from public.rooms where id = p_room and edition_id = p_edition) then
        perform app.refuse('bad_shape');
      end if;
      v_room := coalesce(p_room, app.default_room(p_edition));
      select * into v_lesson from public.lessons
       where edition_id = p_edition and kind = 'lesson' and state = 'draft'
         and day = p_day and start_min = p_start and end_min = p_end and room_id = v_room
       order by id limit 1 for update;
      if v_lesson.id is null then
        v_new := app.new_draft(p_edition, p_day, p_start, p_end, v_room, v_me);
        select * into v_lesson from public.lessons where id = v_new;
      end if;
    end if;

    if v_app.id is null then
      insert into public.approaches (edition_id, speaker_id, owner_member_id, status)
      values (p_edition, p_speaker, v_me, 'approached') returning * into v_app;
    elsif v_app.owner_member_id is null or v_app.owner_member_id = v_me then
      update public.approaches
         set owner_member_id = v_me,
             status = case when status = 'claimed' then 'approached' else status end,
             version = version + case when status = 'claimed' then 1 else 0 end
       where id = v_app.id returning * into v_app;
    end if;

    v_state := case when p_mode = 'offer' and v_app.owner_member_id <> v_me then 'candidate' else 'approached' end;
    if v_speaker.vetted <> 'approved' then v_state := 'candidate'; end if;

    select * into v_pitch from public.pitches where lesson_id = v_lesson.id and approach_id = v_app.id for update;
    if v_pitch.id is null then
      insert into public.pitches (edition_id, lesson_id, approach_id, state, proposed_by)
      values (p_edition, v_lesson.id, v_app.id, v_state, v_me) returning * into v_pitch;
    elsif v_pitch.state in ('candidate', 'approached') then
      if v_state = 'approached' and v_pitch.state = 'candidate' then
        update public.pitches set state = 'approached' where id = v_pitch.id;
      end if;
    else
      update public.pitches set state = v_state, proposed_by = v_me, at = now() where id = v_pitch.id;
    end if;

    return jsonb_build_object('lesson_id', v_lesson.id, 'pitch_id', v_pitch.id);
  end
  $$;

create or replace function public.unpropose(p_pitch bigint) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_p  public.pitches;
    v_a  public.approaches;
    v_me bigint;
  begin
    select * into v_p from public.pitches where id = p_pitch for update;
    if v_p.id is null then perform app.refuse('cell_closed'); end if;
    v_me := app.require_editor(v_p.edition_id);
    select * into v_a from public.approaches where id = v_p.approach_id;
    -- coalesce: an approach nobody holds (owner NULL) is no one's — NULL must not slip past the NOT
    if not (app.my_role(v_p.edition_id) = 'admin' or coalesce(v_a.owner_member_id = v_me, false) or coalesce(v_p.proposed_by = v_me, false)) then
      perform app.refuse('forbidden');
    end if;
    if v_p.state not in ('candidate', 'approached') then return; end if;
    update public.pitches set state = 'withdrawn' where id = v_p.id;
    if app.is_plain(v_p.lesson_id) then
      delete from public.lessons where id = v_p.lesson_id;
    end if;
  end
  $$;

create or replace function public.set_pitch(p_pitch bigint, p_state text) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_p  public.pitches;
    v_a  public.approaches;
    v_me bigint;
  begin
    select * into v_p from public.pitches where id = p_pitch for update;
    if v_p.id is null then perform app.refuse('cell_closed'); end if;
    v_me := app.require_editor(v_p.edition_id);
    if p_state not in ('candidate', 'approached', 'declined') then perform app.refuse('bad_shape'); end if;
    select * into v_a from public.approaches where id = v_p.approach_id;
    if not (app.my_role(v_p.edition_id) = 'admin' or coalesce(v_a.owner_member_id = v_me, false)) then perform app.refuse('forbidden'); end if;
    if (select state from public.lessons where id = v_p.lesson_id) <> 'draft' then perform app.refuse('cell_closed'); end if;
    if v_p.state not in ('candidate', 'approached', 'declined') then return; end if;
    if p_state = 'approached' and (select vetted from public.speakers where id = v_a.speaker_id) <> 'approved' then
      perform app.refuse('not_vetted');
    end if;
    update public.pitches set state = p_state where id = v_p.id;
  end
  $$;

create or replace function public.close_lesson(p_pitch bigint) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_p  public.pitches;
    v_a  public.approaches;
    v_l  public.lessons;
    v_s  public.speakers;
    v_me bigint;
    v_c  text;
  begin
    select * into v_p from public.pitches where id = p_pitch for update;
    if v_p.id is null then perform app.refuse('cell_closed'); end if;
    v_me := app.require_editor(v_p.edition_id);
    select * into v_a from public.approaches where id = v_p.approach_id for update;
    if not (app.my_role(v_p.edition_id) = 'admin' or coalesce(v_a.owner_member_id = v_me, false)) then perform app.refuse('forbidden'); end if;
    select * into v_l from public.lessons where id = v_p.lesson_id for update;
    if v_l.state <> 'draft' or v_p.state not in ('candidate', 'approached') then perform app.refuse('cell_closed'); end if;
    select * into v_s from public.speakers where id = v_a.speaker_id;
    if v_s.retired then perform app.refuse('speaker_retired'); end if;
    if v_s.vetted <> 'approved' then perform app.refuse('not_vetted'); end if;
    if v_s.gender is null then perform app.refuse('gender_unknown'); end if;

    update public.lessons set state = 'closed', version = version + 1, updated_by = v_me where id = v_l.id;
    begin
      insert into public.lesson_speakers (lesson_id, speaker_id, role, edition_id, span) values (v_l.id, v_s.id, 'lead', v_l.edition_id, v_l.span);
    exception when exclusion_violation then
      get stacked diagnostics v_c = constraint_name;
      perform app.refuse(app.exclusion_code(v_c));
    end;
    update public.pitches set state = 'accepted' where id = v_p.id;
    update public.pitches set state = 'superseded' where lesson_id = v_l.id and id <> v_p.id and state in ('candidate', 'approached');
    update public.pitches set state = 'withdrawn' where approach_id = v_a.id and lesson_id <> v_l.id and state in ('candidate', 'approached');
    update public.approaches set status = 'positive', version = version + 1 where id = v_a.id;
  end
  $$;

create or replace function public.reopen_lesson(p_lesson bigint) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_l     public.lessons;
    v_me    bigint;
    v_owner bigint;
    v_admin boolean;
  begin
    select * into v_l from public.lessons where id = p_lesson for update;
    if v_l.id is null then perform app.refuse('cell_closed'); end if;
    v_me := app.require_editor(v_l.edition_id);
    if v_l.state <> 'closed' then return; end if;
    v_admin := app.my_role(v_l.edition_id) = 'admin';
    select a.owner_member_id into v_owner from public.lesson_speakers x
      join public.approaches a on a.speaker_id = x.speaker_id and a.edition_id = v_l.edition_id
     where x.lesson_id = v_l.id and x.role = 'lead';
    if not v_admin and v_owner is distinct from v_me then perform app.refuse('forbidden'); end if;
    if v_l.approval = 'approved' and not v_admin then perform app.refuse('approved_locked'); end if;
    -- money that went out is not erased with the speaker: «שולם» is undone first (v7)
    if v_l.paid_at is not null then perform app.refuse('paid_locked'); end if;
    delete from public.lesson_speakers where lesson_id = v_l.id;
    update public.pitches set state = 'approached' where lesson_id = v_l.id and state = 'accepted';
    -- The stages belonged to the speaker who leaves (v7): the amount and transport
    -- asked and the instructor's word on them, the pickup and driver, the message
    -- sent, the escort, the sources. Whoever closes the lesson next starts them over,
    -- and the next handler never reads the last speaker's pickup address.
    delete from public.transport_details where lesson_id = v_l.id;
    update public.lessons
       set state = 'draft',
           pay_amount = null, transport = 'none', approval = 'none', approval_note = null, approved_by = null, approved_at = null,
           confirm_sent_at = null, confirm_sent_by = null, needs_reconfirm = false,
           escort_roster_id = null, self_intro = false, escort_note = null,
           sources_kind = 'pending', print_when = 'none', sources_note = null, presentation_url = null, in_reader = false,
           version = version + 1, updated_by = v_me
     where id = v_l.id;
  end
  $$;

create or replace function public.move_lesson(p_lesson bigint, p_day integer, p_start integer, p_end integer, p_room bigint) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_l     public.lessons;
    v_me    bigint;
    v_owner bigint;
    v_c     text;
  begin
    select * into v_l from public.lessons where id = p_lesson for update;
    if v_l.id is null or v_l.state = 'cancelled' then perform app.refuse('cell_closed'); end if;
    v_me := app.require_editor(v_l.edition_id);
    -- v11: a memorial slot stays in its memorial row (a plan moves between slots instead)
    if v_l.kind = 'memorial' then perform app.refuse('memorial_slot'); end if;
    if v_l.state = 'closed' and app.my_role(v_l.edition_id) <> 'admin' then
      select a.owner_member_id into v_owner from public.lesson_speakers x
        join public.approaches a on a.speaker_id = x.speaker_id and a.edition_id = v_l.edition_id
       where x.lesson_id = v_l.id and x.role = 'lead';
      if v_owner is distinct from v_me then perform app.refuse('forbidden'); end if;
    end if;
    perform app.check_bounds(p_day, p_start, p_end);
    perform app.lock_day(v_l.edition_id, least(v_l.day, p_day));
    perform app.lock_day(v_l.edition_id, greatest(v_l.day, p_day));
    if not exists (select 1 from app.lesson_rows(v_l.edition_id, p_day) r where r.start_min <= p_start and p_start < r.end_min)
       or not exists (select 1 from app.lesson_rows(v_l.edition_id, p_day) r where r.start_min < p_end and p_end <= r.end_min) then
      perform app.refuse('outside_grid');
    end if;
    if not exists (select 1 from public.rooms where id = p_room and edition_id = v_l.edition_id) then perform app.refuse('bad_shape'); end if;
    begin
      update public.lessons
         set day = p_day, start_min = p_start, end_min = p_end, room_id = p_room,   -- needs_reconfirm: app.lessons_reconfirm (v7)
             version = version + 1, updated_by = v_me
       where id = v_l.id;
    exception when exclusion_violation then
      get stacked diagnostics v_c = constraint_name;
      perform app.refuse(app.exclusion_code(v_c));
    end;
  end
  $$;

create or replace function public.reshape(
  p_edition bigint, p_day integer, p_row_start integer, p_op text, p_count integer default null, p_reason text default null, p_parts integer[] default null)
  returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_me      bigint := app.require_editor(p_edition);
    v_row     public.grid_rows;
    v_ids     bigint[];
    v_carried jsonb;
    v_need    integer;
    v_room    record;
    v_l       public.lessons;
    v_next    public.grid_rows;
    v_first   bigint;
    v_t       integer;
    v_part    integer;
    v_c       text;
    v_new_end integer;
  begin
    -- One day at a time: two people reshaping the same day queue up.
    perform app.lock_day(p_edition, p_day);
    select * into v_row from app.lesson_rows(p_edition, p_day) r where r.start_min = p_row_start;
    if v_row.id is null then perform app.refuse('outside_grid'); end if;

    -- the non-cancelled lessons touching the row
    select coalesce(array_agg(id order by id), '{}') into v_ids from public.lessons
     where edition_id = p_edition and day = p_day and state <> 'cancelled'
       and int4range(start_min, end_min) && int4range(v_row.start_min, v_row.end_min);

    if p_op = 'split_parallel' then
      if p_count not in (2, 3) or btrim(coalesce(p_reason, '')) = '' then perform app.refuse('bad_shape'); end if;
      select p_count - count(*) into v_need from public.lessons
       where id = any (v_ids) and start_min = v_row.start_min and end_min = v_row.end_min;
      if v_need <= 0 then return; end if;
      if (select count(*) from public.rooms r where r.edition_id = p_edition
            and r.id not in (select room_id from public.lessons where id = any (v_ids))) < v_need then
        perform app.refuse('room_taken');
      end if;
      for v_room in select r.id from public.rooms r where r.edition_id = p_edition
                      and r.id not in (select room_id from public.lessons where id = any (v_ids))
                     order by r.sort, r.id limit v_need loop
        perform app.new_draft(p_edition, p_day, v_row.start_min, v_row.end_min, v_room.id, v_me, btrim(p_reason));
      end loop;

    elsif p_op = 'split_time' then
      if p_parts is null or cardinality(p_parts) < 2
         or exists (select 1 from unnest(p_parts) x where x < 15 or x % 5 <> 0)
         or (select sum(x) from unnest(p_parts) x) <> v_row.end_min - v_row.start_min then
        perform app.refuse('bad_shape');
      end if;
      if exists (select 1 from public.lessons where id = any (v_ids) and (state = 'closed' or kind = 'memorial')) then perform app.refuse('cell_closed'); end if;
      select coalesce(jsonb_agg(to_jsonb(c)), '[]') into v_carried from app.carry(v_ids) c;
      delete from public.lessons where id = any (v_ids);
      v_t := v_row.start_min;
      foreach v_part in array p_parts loop
        if v_first is null then
          v_first := app.new_draft(p_edition, p_day, v_t, v_t + v_part, app.default_room(p_edition), v_me);
        else
          perform app.new_draft(p_edition, p_day, v_t, v_t + v_part, app.default_room(p_edition), v_me);
        end if;
        v_t := v_t + v_part;
      end loop;
      perform app.adopt(v_first, v_carried);

    elsif p_op = 'merge_next' then
      if cardinality(v_ids) > 1 then perform app.refuse('bad_shape'); end if;
      if cardinality(v_ids) = 0 then
        v_first := app.new_draft(p_edition, p_day, v_row.start_min, v_row.end_min, app.default_room(p_edition), v_me);
        select * into v_l from public.lessons where id = v_first;
      else
        select * into v_l from public.lessons where id = v_ids[1] for update;
      end if;
      select * into v_next from app.lesson_rows(p_edition, p_day) r where r.start_min >= v_l.end_min order by r.start_min limit 1;
      if v_next.id is null then perform app.refuse('outside_grid'); end if;
      v_new_end := v_next.end_min;
      select coalesce(array_agg(id), '{}') into v_ids from public.lessons
       where edition_id = p_edition and day = p_day and state <> 'cancelled' and id <> v_l.id
         and int4range(start_min, end_min) && int4range(v_l.end_min, v_new_end);
      -- v11: a memorial slot is never swallowed (its plan, liaison and files would go with it)
      if exists (select 1 from public.lessons where id = any (v_ids) and (state = 'closed' or kind = 'memorial')) then perform app.refuse('merge_blocked'); end if;
      select coalesce(jsonb_agg(to_jsonb(c)), '[]') into v_carried from app.carry(v_ids) c;
      delete from public.lessons where id = any (v_ids);
      begin
        update public.lessons
           set end_min = v_new_end, version = version + 1, updated_by = v_me   -- needs_reconfirm: app.lessons_reconfirm (v7)
         where id = v_l.id;
      exception when exclusion_violation then
        get stacked diagnostics v_c = constraint_name;
        perform app.refuse(app.exclusion_code(v_c));
      end;
      perform app.adopt(v_l.id, v_carried);

    elsif p_op = 'reset' then
      if exists (select 1 from public.lessons where id = any (v_ids) and (state = 'closed' or kind = 'memorial')) then perform app.refuse('cell_closed'); end if;
      select coalesce(jsonb_agg(to_jsonb(c)), '[]') into v_carried from app.carry(v_ids) c;
      delete from public.lessons where id = any (v_ids);
      if jsonb_array_length(v_carried) > 0 then
        perform app.adopt(app.new_draft(p_edition, p_day, v_row.start_min, v_row.end_min, app.default_room(p_edition), v_me), v_carried);
      end if;

    else
      perform app.refuse('bad_shape');
    end if;
  end
  $$;

create or replace function public.update_lesson(p_lesson bigint, p_version integer, p_patch jsonb) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_l  public.lessons;
    v_me bigint;
    v_t  integer;
  begin
    select * into v_l from public.lessons where id = p_lesson for update;
    if v_l.id is null or v_l.state = 'cancelled' then perform app.refuse('cell_closed'); end if;
    v_me := app.require_editor(v_l.edition_id);
    -- v11: a memorial slot's title, category and minutes are not the team's to write
    -- (its title reaches the anon links: schedule_view, escort_view) — no screen edits one
    if v_l.kind = 'memorial' then perform app.refuse('memorial_slot'); end if;
    if v_l.version <> p_version then perform app.refuse('stale'); end if;
    if p_patch ? 'teach_min' and p_patch ->> 'teach_min' is not null then
      v_t := (p_patch ->> 'teach_min')::integer;
      if v_t <= 0 or v_t > v_l.end_min - v_l.start_min then perform app.refuse('bad_shape'); end if;
    end if;
    if p_patch ? 'category_id' and p_patch ->> 'category_id' is not null
       and not exists (select 1 from public.categories where id = (p_patch ->> 'category_id')::bigint) then
      perform app.refuse('bad_shape');
    end if;
    update public.lessons set
      title       = case when p_patch ? 'title' then nullif(btrim(p_patch ->> 'title'), '') else title end,
      category_id = case when p_patch ? 'category_id' then (p_patch ->> 'category_id')::bigint else category_id end,
      audience    = case when p_patch ? 'audience' then nullif(btrim(p_patch ->> 'audience'), '') else audience end,
      teach_min   = case when p_patch ? 'teach_min' then (p_patch ->> 'teach_min')::integer else teach_min end,
      version     = version + 1,
      updated_by  = v_me
    where id = v_l.id;
  end
  $$;

-- A new real edition, from the template: rows copied, the default room, the
-- previous real edition archived (read-only for non-admins). Admin only.
-- v12: p_deactivate_team — the editions archived here lose their non-admin
-- members (content, logistics: active = false, never deleted — their history
-- stays); their admins and every all-editions member stay. The screen offers it
-- on by default («הצעה»: the instructor has not decided — DECISIONS «אבן דרך 6»);
-- here it is off unless asked. public.start_edition_preview (Milestone 6, below)
-- answers what this would do, writing nothing.
drop function if exists public.start_edition(text, date, integer, text);   -- v11's signature
create or replace function public.start_edition(
  p_label text, p_start_date date, p_first_day_from integer default null, p_room text default 'בית מדרש', p_deactivate_team boolean default false)
  returns bigint
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v       bigint;
    v_prev  jsonb;
    v_from  bigint;
  begin
    if not app.is_global_admin() then perform app.refuse('forbidden'); end if;
    -- v7: the confirmation template and the escorts' duty phrases are the
    -- instructor's own wording — the live real edition's (the one archived
    -- below; else the newest) carry over. Never a text of ours: the first
    -- edition starts without them. v8: so do its milestones (title and W−n,
    -- none of them done yet) — public.milestones is created further down.
    select id, settings into v_from, v_prev from public.editions where kind = 'real' order by (status <> 'archived') desc, id desc limit 1;
    if coalesce(p_deactivate_team, false) then
      update public.members set active = false
       where active and role <> 'admin'
         and edition_id in (select id from public.editions where kind = 'real' and status <> 'archived');
    end if;
    update public.editions set status = 'archived' where kind = 'real' and status <> 'archived';
    insert into public.editions (label, kind, start_date, first_day_from, settings)
    values (p_label, 'real', p_start_date, p_first_day_from,
            '{"lesson_minutes": 75, "row_minutes": 90}'::jsonb
            || jsonb_strip_nulls(jsonb_build_object('confirm_template', v_prev -> 'confirm_template', 'duty_phrases', v_prev -> 'duty_phrases')))
    returning id into v;
    insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days)
    select v, start_min, end_min, kind, label, days from public.grid_template;
    insert into public.rooms (edition_id, name, sort, is_default) values (v, p_room, 1, true);
    insert into public.milestones (edition_id, title, days_before)
    select v, m.title, m.days_before from public.milestones m where m.edition_id = v_from order by m.days_before desc, m.id;
    return v;
  end
  $$;

-- =============================================================================
-- Settings (v5) — the «הגדרות» screens. A plain setting is a direct write under
-- RLS (an admin of the edition; a global admin for the cross-year
-- categories), like members and editions above. A rule one UPDATE cannot keep
-- is a trigger or a small function:
--   * members    RLS (above) + members_guard: nobody who has done anything is
--                deleted (deactivate instead), and no admin locks themselves
--                out. An admin sets their own name through set_my_profile();
--                a row's address and edition never change (column grants).
--   * roster     RLS only. Names (and gender) of the year's trainees — never a
--                contact detail. Not in Realtime.
--   * rooms      RLS + column grants (name, sort): the default room moves only
--                through set_default_room(); rooms_guard makes the first room
--                the default and refuses deleting the default or a used room.
--   * categories RLS (global admin) + categories_guard: a category a lesson
--                uses is deactivated, never deleted (lessons.category_id would
--                silently go NULL); categories_color checks a colour when
--                it is written or changed.
-- docs/DECISIONS.md has the reasons; src/errors.ts the Hebrew for each code.
-- =============================================================================

-- ------------------------------------------------------------- members

create index if not exists activity_actor on public.activity (actor);

-- Has this member done anything in the system? Every grid change is logged
-- with its actor; the columns below name a member directly. (plpgsql, so it may
-- read the tables created further down: notes, milestones, export_snapshots (v8),
-- share_links (v9), source_files (v10), memorial_plans (v11), lesson_reviews (v12).)
create or replace function app.member_has_history(p_member bigint) returns boolean
  language plpgsql stable security definer set search_path = ''
  as $$
  begin
    return exists (select 1 from public.activity where actor = p_member)
        or exists (select 1 from public.approaches where owner_member_id = p_member)
        or exists (select 1 from public.pitches where proposed_by = p_member)
        or exists (select 1 from public.lessons
                    where updated_by = p_member or approved_by = p_member or confirm_sent_by = p_member)
        or exists (select 1 from public.speakers where created_by = p_member or vetted_by = p_member)
        or exists (select 1 from public.notes where created_by = p_member or updated_by = p_member)
        or exists (select 1 from public.milestones where created_by = p_member or done_by = p_member)
        or exists (select 1 from public.export_snapshots where created_by = p_member)
        or exists (select 1 from public.share_links where created_by = p_member)
        or exists (select 1 from public.source_files where uploaded_by = p_member)
        or exists (select 1 from public.memorial_plans where updated_by = p_member)
        or exists (select 1 from public.lesson_reviews where written_by = p_member);   -- v12
  end
  $$;

create or replace function app.members_guard() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_me text := app.my_email();
  begin
    if tg_op = 'DELETE' then
      -- A whole edition being deleted (unseed_gate.sql, the SQL Editor) takes its team with it.
      if old.edition_id is not null and not exists (select 1 from public.editions where id = old.edition_id) then
        return old;
      end if;
      if v_me is not null and old.email = v_me and old.role = 'admin' then perform app.refuse('self_lockout'); end if;
      if app.member_has_history(old.id) then perform app.refuse('member_has_history'); end if;
      return old;
    end if;
    -- UPDATE: an admin's own admin row keeps its role, address, edition and
    -- active flag — nobody locks themselves out. (The SQL Editor has no address.)
    if v_me is not null and old.email = v_me and old.role = 'admin'
       and (new.role <> 'admin' or not new.active or new.email <> old.email
            or new.edition_id is distinct from old.edition_id) then
      perform app.refuse('self_lockout');
    end if;
    return new;
  end
  $$;
drop trigger if exists members_guard on public.members;
create trigger members_guard before update or delete on public.members
  for each row execute function app.members_guard();

-- An admin's own name and gender, on every row of theirs (an admin's row is
-- otherwise out of an edition admin's reach, and app.add_admin sets no name).
-- Admins only, like the screen: a trainee's name is set by the admins, so
-- nobody renames themselves into someone else (e.g. the instructor).
create or replace function public.set_my_profile(p_display_name text, p_gender text) returns void
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if not app.is_member() then perform app.refuse('not_member'); end if;
    if not exists (select 1 from public.members where email = app.my_email() and role = 'admin' and active) then
      perform app.refuse('forbidden');
    end if;
    if btrim(coalesce(p_display_name, '')) = '' then perform app.refuse('name_required'); end if;
    if length(btrim(p_display_name)) > 80 then perform app.refuse('bad_value'); end if;  -- as the screen (cleanName 80)
    if p_gender is not null and p_gender not in ('m', 'f') then perform app.refuse('bad_value'); end if;
    update public.members set display_name = btrim(p_display_name), gender = p_gender
     where email = app.my_email();
  end
  $$;

-- ------------------------------------------------------------- roster

-- The year's trainees (~61), for escorts and מכריכה לכריכה: names only.
create table if not exists public.roster (
  id         bigint generated always as identity primary key,
  edition_id bigint not null references public.editions (id) on delete cascade,
  full_name  text not null check (btrim(full_name) <> '' and length(full_name) <= 120),
  name_key   text generated always as (app.name_key(full_name)) stored,
  gender     text check (gender in ('m', 'f')),
  created_at timestamptz not null default now(),
  unique (edition_id, name_key)
);

alter table public.roster enable row level security;
drop policy if exists roster_read on public.roster;
create policy roster_read on public.roster for select to authenticated using (app.can_see_edition(edition_id));
drop policy if exists roster_insert on public.roster;
create policy roster_insert on public.roster for insert to authenticated with check (app.my_role(edition_id) = 'admin');
drop policy if exists roster_update on public.roster;
create policy roster_update on public.roster for update to authenticated
  using (app.my_role(edition_id) = 'admin') with check (app.my_role(edition_id) = 'admin');
drop policy if exists roster_delete on public.roster;
create policy roster_delete on public.roster for delete to authenticated using (app.my_role(edition_id) = 'admin');

-- ------------------------------------------------------------- rooms

create or replace function app.rooms_guard() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if tg_op = 'INSERT' then
      -- The first room is the default: while an edition has rooms, exactly one is.
      if not new.is_default and not exists (select 1 from public.rooms where edition_id = new.edition_id and is_default) then
        new.is_default := true;
      end if;
      return new;
    end if;
    -- DELETE. A whole edition being deleted takes its rooms with it.
    if not exists (select 1 from public.editions where id = old.edition_id) then return old; end if;
    if old.is_default then perform app.refuse('room_default'); end if;
    if exists (select 1 from public.lessons where room_id = old.id) then perform app.refuse('room_in_use'); end if;
    return old;
  end
  $$;
drop trigger if exists rooms_guard on public.rooms;
create trigger rooms_guard before insert or delete on public.rooms
  for each row execute function app.rooms_guard();

drop policy if exists rooms_insert on public.rooms;
create policy rooms_insert on public.rooms for insert to authenticated with check (app.my_role(edition_id) = 'admin');
drop policy if exists rooms_update on public.rooms;
create policy rooms_update on public.rooms for update to authenticated
  using (app.my_role(edition_id) = 'admin') with check (app.my_role(edition_id) = 'admin');
drop policy if exists rooms_delete on public.rooms;
create policy rooms_delete on public.rooms for delete to authenticated using (app.my_role(edition_id) = 'admin');

-- The default room (where a proposed speaker lands) — one per edition, moved
-- in one transaction: unset the old one, then set the new.
create or replace function public.set_default_room(p_room bigint) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare v_ed bigint;
  begin
    select edition_id into v_ed from public.rooms where id = p_room;
    if v_ed is null or app.my_role(v_ed) is distinct from 'admin' then perform app.refuse('forbidden'); end if;
    perform 1 from public.rooms where edition_id = v_ed for update;   -- two admins at once queue up
    update public.rooms set is_default = false where edition_id = v_ed and is_default and id <> p_room;
    update public.rooms set is_default = true where id = p_room and not is_default;
  end
  $$;

-- ------------------------------------------------------------- categories

-- Colours come from the screen's palette (#rrggbb). Checked only when a colour
-- is written or changed — a trigger, not a CHECK: a NOT VALID check would
-- still re-check a whole row on every later UPDATE, so a category whose colour
-- was typed in the SQL Editor before v5 could not be renamed, moved or
-- deactivated. (An early v5 run added that check; it goes.)
alter table public.categories drop constraint if exists categories_color_hex;

create or replace function app.categories_color() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if (tg_op = 'INSERT' or new.color is distinct from old.color) and new.color !~ '^#[0-9a-fA-F]{6}$' then
      perform app.refuse('bad_color');
    end if;
    return new;
  end
  $$;
drop trigger if exists categories_color on public.categories;
create trigger categories_color before insert or update of color on public.categories
  for each row execute function app.categories_color();

create or replace function app.categories_guard() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if exists (select 1 from public.lessons where category_id = old.id) then perform app.refuse('category_in_use'); end if;
    return old;
  end
  $$;
drop trigger if exists categories_guard on public.categories;
create trigger categories_guard before delete on public.categories
  for each row execute function app.categories_guard();

drop policy if exists categories_insert on public.categories;
create policy categories_insert on public.categories for insert to authenticated with check ((select app.is_global_admin()));
drop policy if exists categories_update on public.categories;
create policy categories_update on public.categories for update to authenticated
  using ((select app.is_global_admin())) with check ((select app.is_global_admin()));
drop policy if exists categories_delete on public.categories;
create policy categories_delete on public.categories for delete to authenticated using ((select app.is_global_admin()));

-- =============================================================================
-- Milestone 2 (v6) — the speaker pool. Semantics: docs/CONTRACT.md «The speaker
-- pool»; the in-memory twin is src/data/engine.ts, and tests/parity holds the
-- two together. As in the grid, the browser keeps SELECT only on speakers,
-- speaker_contacts, approaches and availability: every write below is a
-- SECURITY DEFINER function that checks who is asking and refuses with a code
-- src/errors.ts has the Hebrew for.
--   create_speaker        search first: the same name key needs a
--                         disambiguator, a similar one (trigram ≥ 0.6, «הצעה»)
--                         a confirmation
--   update_speaker        a global admin, or in a live real edition its admin
--                         or the speaker's handler there
--   vet_speakers          a global admin, one or many at once, with a note
--   get/set_speaker_contacts   app.may_see_contacts — the contacts policy's people
--   claim_speaker, set_approach_status, hand_over, answer_handover,
--   set_availability      one handler per speaker per edition; every change
--                         is logged, with an optional short note
--   speaker_matches, speaker_history, speaker_activity   reads, never a contact
-- =============================================================================

-- ------------------------------------------------------------- text and lists

-- One line as the pool stores it: runs of ASCII whitespace → one space,
-- trimmed; empty → NULL; longer than p_max characters → bad_value.
-- src/data/speakerRules.ts (cleanLine) is the same rule in the browser.
create or replace function app.clean_line(p text, p_max integer) returns text
  language plpgsql immutable set search_path = ''
  as $$
  declare v text := btrim(regexp_replace(coalesce(p, ''), '[ \t\n\r\f\v]+', ' ', 'g'));
  begin
    if v = '' then return null; end if;
    if char_length(v) > p_max then perform app.refuse('bad_value'); end if;
    return v;
  end
  $$;

-- A note of several lines: CRLF → LF, ASCII whitespace trimmed at both ends (cleanBlock).
create or replace function app.clean_block(p text, p_max integer) returns text
  language plpgsql immutable set search_path = ''
  as $$
  declare v text := regexp_replace(replace(coalesce(p, ''), E'\r\n', E'\n'), '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g');
  begin
    if v = '' then return null; end if;
    if char_length(v) > p_max then perform app.refuse('bad_value'); end if;
    return v;
  end
  $$;

-- The titles a speaker may carry: the edition's settings.titles when it lists
-- any, else the design's four (DEFAULT_TITLES).
create or replace function app.titles(p_edition bigint) returns text[]
  language sql stable security definer set search_path = ''
  as $$
    select coalesce(
      (select array_agg(t.x #>> '{}' order by t.o)
         from public.editions e,
              jsonb_array_elements(case when jsonb_typeof(e.settings -> 'titles') = 'array' then e.settings -> 'titles' else '[]'::jsonb end)
                with ordinality as t(x, o)
        where e.id = p_edition and jsonb_typeof(t.x) = 'string'),
      array['ד״ר', 'פרופ׳', 'הרב', 'הרבנית'])
  $$;

create or replace function app.pick_title(p text, p_edition bigint) returns text
  language plpgsql stable set search_path = ''
  as $$
  declare v text := app.clean_line(p, 40);
  begin
    if v is not null and not (v = any (app.titles(p_edition))) then perform app.refuse('bad_value'); end if;
    return v;
  end
  $$;

-- Gender is what someone typed — m, f, or unknown (NULL). Never guessed.
create or replace function app.pick_gender(p text) returns text
  language plpgsql immutable set search_path = ''
  as $$
  begin
    if p is null or p = '' then return null; end if;
    if p not in ('m', 'f') then perform app.refuse('bad_value'); end if;
    return p;
  end
  $$;

create or replace function app.pick_contact_pref(p text) returns text
  language plpgsql immutable set search_path = ''
  as $$
  begin
    if p is null or p = '' then return null; end if;
    if p not in ('phone', 'whatsapp', 'email', 'secretary') then perform app.refuse('bad_value'); end if;
    return p;
  end
  $$;

-- Free tags: a JSON array of strings, each one line of at most 40 characters;
-- empty ones and repeats (the first is kept) dropped; at most 10.
create or replace function app.clean_topics(p jsonb) returns text[]
  language plpgsql immutable set search_path = ''
  as $$
  declare v text[];
  begin
    if p is null or jsonb_typeof(p) = 'null' then return '{}'; end if;
    if jsonb_typeof(p) <> 'array' or exists (select 1 from jsonb_array_elements(p) x where jsonb_typeof(x) <> 'string') then
      perform app.refuse('bad_value');
    end if;
    select coalesce(array_agg(z.t order by z.o), '{}') into v
      from (select app.clean_line(e.x, 40) as t, min(e.o) as o
              from jsonb_array_elements_text(p) with ordinality as e(x, o) group by 1) z
     where z.t is not null;
    if cardinality(v) > 10 then perform app.refuse('bad_value'); end if;
    return v;
  end
  $$;

-- «ייתכן שזה…»: two name keys this alike (pg_trgm's similarity) are probably
-- the same person. 0.6 is the design's «הצעה». SIMILAR_THRESHOLD
-- (src/data/speakerRules.ts) is the same number and src/domain/trigram.ts is
-- pg_trgm's similarity in the browser; tests/sql/speakers.test.ts holds both equal.
create or replace function app.similar_threshold() returns real
  language sql immutable set search_path = ''
  as $$ select 0.6::real $$;

-- Does the speaker teach a closed lesson in a real edition that is still live
-- (not archived)? Then un-approving, clearing the gender or retiring them would
-- break the closing rule (docs/CONTRACT.md), so those are refused. A practice
-- or demo week never pins a real speaker's vetting: anyone in a sandbox may
-- close a lesson there, and sandboxes are never archived.
create or replace function app.has_live_closed(p_speaker bigint) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (select 1 from public.lesson_speakers x join public.editions e on e.id = x.edition_id
                    where x.speaker_id = p_speaker and x.active and e.kind = 'real' and e.status <> 'archived')
  $$;

-- May the caller rewrite the speaker's own record (one row across all years)?
-- A global admin; or, in a real edition that is not archived, its admin or
-- whoever handles the speaker there. A practice or demo edition (anyone there
-- may claim any pool speaker) and an archived one give no such right — the
-- same editions the contacts rule (app.contacts_edition) counts.
create or replace function app.may_edit_speaker(p_edition bigint, p_speaker bigint, p_me bigint) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select app.is_global_admin()
        or exists (select 1 from public.editions e
                    where e.id = p_edition and e.kind = 'real' and e.status <> 'archived'
                      and (app.my_role(p_edition) = 'admin'
                           or exists (select 1 from public.approaches a
                                       where a.edition_id = p_edition and a.speaker_id = p_speaker and a.owner_member_id = p_me)))
  $$;

-- May this member handle speakers in the edition (the receiving end of a hand-over)?
create or replace function app.can_handle(p_member bigint, p_edition bigint) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (select 1 from public.members m
                    where m.id = p_member and m.active and m.role in ('content', 'admin')
                      and (m.edition_id = p_edition or m.edition_id is null))
  $$;

-- The short note of a pool command, read by the approaches trigger
-- (app.log_activity) for the one UPDATE between two calls: set, update, clear.
create or replace function app.set_note(p_note text) returns void
  language sql set search_path = ''
  as $$ select set_config('app.note', coalesce(p_note, ''), true) $$;

-- A pool event the triggers do not see (a speaker's own changes,
-- availability): ids, states and field names — never a contact value.
create or replace function app.log_event(p_edition bigint, p_entity text, p_id bigint, p_kind text, p_detail jsonb) returns void
  language sql security definer set search_path = ''
  as $$
    insert into public.activity (actor, edition_id, entity, entity_id, kind, detail)
    values (app.my_member_id(p_edition), p_edition, p_entity, p_id, p_kind, coalesce(p_detail, '{}'::jsonb))
  $$;

-- ------------------------------------------------------------- reads

-- Search first: speakers with the same name key («same»), then those whose key
-- is at least app.similar_threshold() alike («similar»). Any member.
create or replace function public.speaker_matches(p_name text) returns jsonb
  language plpgsql security definer set search_path = ''
  as $$
  declare v_key text := app.name_key(p_name);
  begin
    if not app.is_member() then perform app.refuse('not_member'); end if;
    if v_key = '' then return '[]'::jsonb; end if;
    -- lets the trigram index (speakers_name_trgm) answer the % below
    perform set_config('pg_trgm.similarity_threshold', app.similar_threshold()::text, true);
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'title', m.title, 'name', m.name, 'disambiguator', m.disambiguator, 'gender', m.gender,
               'affiliation', m.affiliation, 'vetted', m.vetted, 'retired', m.retired,
               'match', case when m.name_key = v_key then 'same' else 'similar' end, 'similarity', m.sim)
             order by (m.name_key = v_key) desc, m.sim desc, m.name, m.id)
        from (select s.id, s.title, s.name, s.disambiguator, s.gender, s.affiliation, s.vetted, s.retired, s.name_key,
                     extensions.similarity(s.name_key, v_key) as sim
                from public.speakers s
               where s.name_key = v_key
                  or (s.name_key operator(extensions.%) v_key
                      and extensions.similarity(s.name_key, v_key) >= app.similar_threshold())
               order by (s.name_key = v_key) desc, sim desc, s.name, s.id
               limit 20) m), '[]'::jsonb);
  end
  $$;

-- Lessons this speaker taught: closed lessons of real and archive editions —
-- past years (an archive, or an archived real edition) for any member, a live
-- edition only for those who can see it, as lessons_read would. No contact
-- detail, no payment.
create or replace function public.speaker_history(p_speaker bigint) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
  begin
    if not app.is_member() then perform app.refuse('not_member'); end if;
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'edition_id', e.id, 'edition_label', e.label, 'edition_kind', e.kind, 'start_date', e.start_date,
               'day', l.day, 'start_min', l.start_min, 'end_min', l.end_min, 'title', l.title,
               'category', c.name, 'role', x.role)
             order by e.id desc, l.day, l.start_min, l.id)
        from public.lesson_speakers x
        join public.lessons l on l.id = x.lesson_id
        join public.editions e on e.id = l.edition_id
        left join public.categories c on c.id = l.category_id
       where x.speaker_id = p_speaker and l.state = 'closed' and e.kind in ('real', 'archive')
         and (e.kind = 'archive' or e.status = 'archived' or app.can_see_edition(e.id))), '[]'::jsonb);
  end
  $$;

-- The speaker's timeline: their own events (created, edited, vetted, contacts
-- changed — field names only), and the approaches and pitches about them in
-- the editions I can see. Newest first, at most 200.
create or replace function public.speaker_activity(p_speaker bigint) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
  begin
    if not app.is_member() then perform app.refuse('not_member'); end if;
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'at', a.at, 'actor', a.actor, 'edition_id', a.edition_id,
               'entity', a.entity, 'entity_id', a.entity_id, 'kind', a.kind, 'detail', a.detail)
             order by a.at desc, a.id desc)
        from (select * from public.activity a
               where (a.entity = 'speakers' and a.entity_id = p_speaker)
                  or (a.edition_id is not null and app.can_see_edition(a.edition_id) and (
                        (a.entity = 'approaches' and a.detail ->> 'speaker' = p_speaker::text)
                     or (a.entity = 'pitches' and a.detail ->> 'approach' in (
                           select ap.id::text from public.approaches ap where ap.speaker_id = p_speaker))))
               order by a.at desc, a.id desc
               limit 200) a), '[]'::jsonb);
  end
  $$;

-- Contacts, through the policy (invoker): NULL when they are not mine to see.
create or replace function public.get_speaker_contacts(p_speaker bigint) returns jsonb
  language sql stable security invoker set search_path = ''
  as $$
    select case when app.may_see_contacts(p_speaker) then
      coalesce((select jsonb_build_object('phone', c.phone, 'email', c.email, 'secretary_note', c.secretary_note, 'notes', c.notes)
                  from public.speaker_contacts c where c.speaker_id = p_speaker),
               '{"phone": null, "email": null, "secretary_note": null, "notes": null}'::jsonb)
    end
  $$;

-- ------------------------------------------------------------- the pool

create or replace function public.create_speaker(
  p_edition bigint, p_fields jsonb, p_claim boolean default false, p_approve boolean default false, p_confirmed boolean default false)
  returns jsonb
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_me     bigint := app.require_editor(p_edition);
    v_name   text;
    v_key    text;
    v_dis    text;
    v_title  text;
    v_gender text;
    v_aff    text;
    v_bio    text;
    v_topics text[];
    v_pref   text;
    v_ok     boolean := coalesce(p_approve, false);
    v_id     bigint;
    v_app    bigint;
    -- Added from a demo edition (the decision gate): synthetic like the gate's
    -- own speakers, so unseed_gate.sql takes it away with the gate.
    v_source text := case when (select kind from public.editions where id = p_edition) = 'demo' then 'synthetic' else 'manual' end;
  begin
    v_name := app.clean_line(p_fields ->> 'name', 120);
    v_key := app.name_key(v_name);
    if v_name is null or v_key = '' then perform app.refuse('name_required'); end if;
    v_dis    := app.clean_line(p_fields ->> 'disambiguator', 60);
    v_title  := app.pick_title(p_fields ->> 'title', p_edition);
    v_gender := app.pick_gender(p_fields ->> 'gender');
    v_aff    := app.clean_line(p_fields ->> 'affiliation', 120);
    v_bio    := app.clean_block(p_fields ->> 'bio_short', 400);
    v_topics := app.clean_topics(p_fields -> 'topics');
    v_pref   := app.pick_contact_pref(p_fields ->> 'contact_pref');
    if v_ok and not app.is_global_admin() then perform app.refuse('forbidden'); end if;

    -- search first
    if exists (select 1 from public.speakers where name_key = v_key and coalesce(disambiguator, '') = coalesce(v_dis, '')) then
      perform app.refuse('speaker_exists');
    end if;
    if v_dis is null and exists (select 1 from public.speakers where name_key = v_key) then
      perform app.refuse('disambiguator_required');
    end if;
    if not coalesce(p_confirmed, false) and exists (
         select 1 from public.speakers s
          where s.name_key = v_key or extensions.similarity(s.name_key, v_key) >= app.similar_threshold()) then
      perform app.refuse('speaker_similar');
    end if;

    begin
      insert into public.speakers (title, name, disambiguator, gender, affiliation, bio_short, topics, contact_pref,
                                   vetted, vetted_by, vetted_at, created_by, source)
      values (v_title, v_name, v_dis, v_gender, v_aff, v_bio, v_topics, v_pref,
              case when v_ok then 'approved' else 'pending' end,
              case when v_ok then app.my_member_id(null) end,
              case when v_ok then now() end,
              v_me, v_source)
      returning id into v_id;
    exception when unique_violation then
      perform app.refuse('speaker_exists');   -- someone added the same name a moment ago
    end;
    perform app.log_event(p_edition, 'speakers', v_id, 'insert',
                          jsonb_build_object('vetted', case when v_ok then 'approved' else 'pending' end));
    if coalesce(p_claim, false) then
      insert into public.approaches (edition_id, speaker_id, owner_member_id, status)
      values (p_edition, v_id, v_me, 'claimed') returning id into v_app;
    end if;
    return jsonb_build_object('speaker_id', v_id, 'approach_id', v_app);
  end
  $$;

create or replace function public.update_speaker(p_edition bigint, p_speaker bigint, p_version integer, p_patch jsonb)
  returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_me     bigint := app.require_editor(p_edition);
    v_s      public.speakers;
    v_n      public.speakers;
    v_fields text[];
  begin
    select * into v_s from public.speakers where id = p_speaker for update;
    if v_s.id is null then perform app.refuse('stale'); end if;
    if not app.may_edit_speaker(p_edition, p_speaker, v_me) then perform app.refuse('not_handler'); end if;
    if v_s.version <> p_version then perform app.refuse('stale'); end if;
    p_patch := coalesce(p_patch, '{}'::jsonb);
    v_n := v_s;
    if p_patch ? 'name' then
      v_n.name := app.clean_line(p_patch ->> 'name', 120);
      v_n.name_key := app.name_key(v_n.name);
      if v_n.name is null or v_n.name_key = '' then perform app.refuse('name_required'); end if;
    end if;
    if p_patch ? 'disambiguator' then v_n.disambiguator := app.clean_line(p_patch ->> 'disambiguator', 60); end if;
    if p_patch ? 'title' then v_n.title := app.pick_title(p_patch ->> 'title', p_edition); end if;
    if p_patch ? 'gender' then v_n.gender := app.pick_gender(p_patch ->> 'gender'); end if;
    if p_patch ? 'affiliation' then v_n.affiliation := app.clean_line(p_patch ->> 'affiliation', 120); end if;
    if p_patch ? 'bio_short' then v_n.bio_short := app.clean_block(p_patch ->> 'bio_short', 400); end if;
    if p_patch ? 'topics' then v_n.topics := app.clean_topics(p_patch -> 'topics'); end if;
    if p_patch ? 'contact_pref' then v_n.contact_pref := app.pick_contact_pref(p_patch ->> 'contact_pref'); end if;
    if p_patch ? 'retired' then
      if jsonb_typeof(p_patch -> 'retired') <> 'boolean' then perform app.refuse('bad_value'); end if;
      if not app.is_global_admin() then perform app.refuse('forbidden'); end if;
      v_n.retired := (p_patch ->> 'retired')::boolean;
    end if;

    if (v_n.name_key, coalesce(v_n.disambiguator, '')) is distinct from (v_s.name_key, coalesce(v_s.disambiguator, '')) then
      if exists (select 1 from public.speakers where id <> p_speaker and name_key = v_n.name_key
                    and coalesce(disambiguator, '') = coalesce(v_n.disambiguator, '')) then
        perform app.refuse('speaker_exists');
      end if;
      if v_n.disambiguator is null and exists (select 1 from public.speakers where id <> p_speaker and name_key = v_n.name_key) then
        perform app.refuse('disambiguator_required');
      end if;
    end if;
    if ((p_patch ? 'gender' and v_n.gender is null) or (p_patch ? 'retired' and v_n.retired)) and app.has_live_closed(p_speaker) then
      perform app.refuse('lesson_closed');
    end if;

    select coalesce(array_agg(u.f order by u.o), '{}') into v_fields
      from unnest(array[
        case when v_n.title is distinct from v_s.title then 'title' end,
        case when v_n.name is distinct from v_s.name then 'name' end,
        case when v_n.disambiguator is distinct from v_s.disambiguator then 'disambiguator' end,
        case when v_n.gender is distinct from v_s.gender then 'gender' end,
        case when v_n.affiliation is distinct from v_s.affiliation then 'affiliation' end,
        case when v_n.bio_short is distinct from v_s.bio_short then 'bio_short' end,
        case when v_n.topics is distinct from v_s.topics then 'topics' end,
        case when v_n.contact_pref is distinct from v_s.contact_pref then 'contact_pref' end,
        case when v_n.retired is distinct from v_s.retired then 'retired' end]) with ordinality as u(f, o)
     where u.f is not null;
    if cardinality(v_fields) = 0 then return; end if;
    begin
      update public.speakers
         set title = v_n.title, name = v_n.name, disambiguator = v_n.disambiguator, gender = v_n.gender,
             affiliation = v_n.affiliation, bio_short = v_n.bio_short, topics = v_n.topics,
             contact_pref = v_n.contact_pref, retired = v_n.retired, version = version + 1
       where id = p_speaker;
    exception when unique_violation then
      perform app.refuse('speaker_exists');
    end;
    perform app.log_event(p_edition, 'speakers', p_speaker, 'update', jsonb_build_object('fields', to_jsonb(v_fields)));
  end
  $$;

-- The quality gate (DESIGN: אישור מרצים). A global admin only; one tap or a batch.
create or replace function public.vet_speakers(p_speakers bigint[], p_state text, p_note text default null) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_note text;
    v_id   bigint;
    v_s    public.speakers;
  begin
    if not app.is_member() then perform app.refuse('not_member'); end if;
    if not app.is_global_admin() then perform app.refuse('forbidden'); end if;
    if p_state is null or p_state not in ('approved', 'rejected', 'pending') then perform app.refuse('bad_value'); end if;
    v_note := app.clean_line(p_note, 300);
    for v_id in select distinct x from unnest(coalesce(p_speakers, '{}'::bigint[])) as x where x is not null order by 1 loop
      select * into v_s from public.speakers where id = v_id for update;
      if v_s.id is null then perform app.refuse('stale'); end if;
      if p_state <> 'approved' and app.has_live_closed(v_id) then perform app.refuse('lesson_closed'); end if;
      continue when v_s.vetted = p_state and v_s.vetted_note is not distinct from v_note;
      update public.speakers
         set vetted = p_state, vetted_note = v_note, vetted_by = app.my_member_id(null), vetted_at = now(), version = version + 1
       where id = v_id;
      perform app.log_event(null, 'speakers', v_id, 'vet', jsonb_build_object('vetted', p_state, 'note', v_note));
    end loop;
  end
  $$;

-- Contacts, for the people app.may_see_contacts names (the same who read them).
-- All four are replaced; NULL clears one. The log says which fields changed, never to what.
create or replace function public.set_speaker_contacts(
  p_speaker bigint, p_phone text, p_email text, p_secretary_note text default null, p_notes text default null)
  returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_old    public.speaker_contacts;
    v_phone  text;
    v_email  text;
    v_sec    text;
    v_notes  text;
    v_fields text[];
  begin
    if not app.is_member() then perform app.refuse('not_member'); end if;
    if not exists (select 1 from public.speakers where id = p_speaker) then perform app.refuse('stale'); end if;
    if not app.may_see_contacts(p_speaker) then perform app.refuse('contacts_hidden'); end if;
    v_phone := app.clean_line(p_phone, 40);
    if v_phone is not null and char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 6 then perform app.refuse('bad_phone'); end if;
    v_email := app.clean_line(p_email, 120);
    if v_email is not null and v_email !~ '^[^ @]+@[^ @]+\.[^ @]+$' then perform app.refuse('bad_contact_email'); end if;
    v_sec   := app.clean_block(p_secretary_note, 300);
    v_notes := app.clean_block(p_notes, 1000);

    select * into v_old from public.speaker_contacts where speaker_id = p_speaker for update;
    select coalesce(array_agg(u.f order by u.o), '{}') into v_fields
      from unnest(array[
        case when v_phone is distinct from v_old.phone then 'phone' end,
        case when v_email is distinct from v_old.email then 'email' end,
        case when v_sec is distinct from v_old.secretary_note then 'secretary_note' end,
        case when v_notes is distinct from v_old.notes then 'notes' end]) with ordinality as u(f, o)
     where u.f is not null;
    if cardinality(v_fields) = 0 then return; end if;
    insert into public.speaker_contacts (speaker_id, phone, email, secretary_note, notes)
    values (p_speaker, v_phone, v_email, v_sec, v_notes)
    on conflict (speaker_id) do update
      set phone = excluded.phone, email = excluded.email, secretary_note = excluded.secretary_note, notes = excluded.notes;
    perform app.log_event(app.contacts_edition(p_speaker), 'speakers', p_speaker, 'contacts', jsonb_build_object('fields', to_jsonb(v_fields)));
  end
  $$;

-- ------------------------------------------------------------- approaches (one handler per speaker per edition)

-- «אני מטפל/ת»: take a free speaker (or an approach nobody holds) without a cell.
create or replace function public.claim_speaker(p_edition bigint, p_speaker bigint) returns bigint
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_me  bigint := app.require_editor(p_edition);
    v_app public.approaches;
  begin
    if not exists (select 1 from public.speakers where id = p_speaker and not retired) then perform app.refuse('speaker_retired'); end if;
    select * into v_app from public.approaches where edition_id = p_edition and speaker_id = p_speaker for update;
    if v_app.id is null then
      begin
        insert into public.approaches (edition_id, speaker_id, owner_member_id, status)
        values (p_edition, p_speaker, v_me, 'claimed') returning * into v_app;
      exception when unique_violation then
        perform app.refuse('approach_owned');   -- claimed by someone else a moment ago
      end;
    elsif v_app.owner_member_id is null then
      update public.approaches set owner_member_id = v_me, offered_to = null, version = version + 1 where id = v_app.id;
    elsif v_app.owner_member_id <> v_me then
      perform app.refuse('approach_owned');
    end if;
    return v_app.id;
  end
  $$;

create or replace function public.set_approach_status(p_approach bigint, p_version integer, p_status text, p_note text default null)
  returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_a    public.approaches;
    v_me   bigint;
    v_note text;
  begin
    select * into v_a from public.approaches where id = p_approach for update;
    if v_a.id is null then perform app.refuse('stale'); end if;
    v_me := app.require_editor(v_a.edition_id);
    if not (app.my_role(v_a.edition_id) = 'admin' or coalesce(v_a.owner_member_id = v_me, false)) then perform app.refuse('not_handler'); end if;
    if v_a.version <> p_version then perform app.refuse('stale'); end if;
    if p_status is null or p_status not in ('claimed', 'approached', 'positive', 'declined', 'no_answer') then perform app.refuse('bad_value'); end if;
    v_note := app.clean_line(p_note, 200);
    if p_status in ('approached', 'positive') and (select vetted from public.speakers where id = v_a.speaker_id) <> 'approved' then
      perform app.refuse('not_vetted');
    end if;
    if p_status <> 'positive' and exists (select 1 from public.lesson_speakers x
                                           where x.edition_id = v_a.edition_id and x.speaker_id = v_a.speaker_id and x.active) then
      perform app.refuse('lesson_closed');
    end if;
    if p_status = v_a.status and v_note is null then return; end if;
    -- «סירב/ה»: every cell they are still pitched in says so too
    if p_status = 'declined' then
      update public.pitches set state = 'declined' where approach_id = v_a.id and state in ('candidate', 'approached');
    end if;
    perform app.set_note(v_note);
    update public.approaches set status = p_status, version = version + 1 where id = v_a.id;
    perform app.set_note(null);
  end
  $$;

-- «העברה». The handler offers the speaker to another member (NULL withdraws
-- the offer) and that member answers (answer_handover); an admin reassigns at
-- once — to NULL, back to the pool.
create or replace function public.hand_over(p_approach bigint, p_to bigint, p_note text default null) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_a     public.approaches;
    v_me    bigint;
    v_note  text;
    v_owner bigint;
    v_offer bigint;
  begin
    select * into v_a from public.approaches where id = p_approach for update;
    if v_a.id is null then perform app.refuse('stale'); end if;
    v_me := app.require_editor(v_a.edition_id);
    v_note := app.clean_line(p_note, 200);
    if app.my_role(v_a.edition_id) = 'admin' then
      if p_to is not null and not app.can_handle(p_to, v_a.edition_id) then perform app.refuse('bad_member'); end if;
      v_owner := p_to;
      v_offer := null;
    elsif coalesce(v_a.owner_member_id = v_me, false) then
      if p_to is not null and (p_to = v_me or not app.can_handle(p_to, v_a.edition_id)) then perform app.refuse('bad_member'); end if;
      v_owner := v_a.owner_member_id;
      v_offer := p_to;
    else
      perform app.refuse('not_handler');
    end if;
    if (v_owner, v_offer) is not distinct from (v_a.owner_member_id, v_a.offered_to) and v_note is null then return; end if;
    perform app.set_note(v_note);
    update public.approaches set owner_member_id = v_owner, offered_to = v_offer, version = version + 1 where id = v_a.id;
    perform app.set_note(null);
  end
  $$;

create or replace function public.answer_handover(p_approach bigint, p_accept boolean, p_note text default null) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_a    public.approaches;
    v_me   bigint;
    v_note text;
  begin
    select * into v_a from public.approaches where id = p_approach for update;
    if v_a.id is null then perform app.refuse('stale'); end if;
    v_me := app.require_editor(v_a.edition_id);
    v_note := app.clean_line(p_note, 200);
    -- the offer was withdrawn, answered, or is someone else's
    if not coalesce(v_a.offered_to = v_me, false) then perform app.refuse('stale'); end if;
    perform app.set_note(v_note);
    update public.approaches
       set owner_member_id = case when coalesce(p_accept, false) then v_me else owner_member_id end,
           offered_to = null, version = version + 1
     where id = v_a.id;
    perform app.set_note(null);
  end
  $$;

-- Availability chips: a day × a part of it (morning 06:30–13:00, afternoon
-- 13:00–19:00, evening 19:00–24:00, night 00:00–06:30 — DAY_PARTS in
-- src/domain/dayParts.ts) is can / cannot / unknown (NULL), with a note.
-- Rows of that day overlapping the part are cut back to what lies outside it.
create or replace function public.set_availability(
  p_edition bigint, p_speaker bigint, p_day integer, p_part text, p_kind text, p_note text default null)
  returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_me   bigint := app.require_editor(p_edition);
    v_from integer;
    v_to   integer;
    v_note text;
    v_a    public.approaches;
    r      public.availability;
  begin
    if p_day is null or p_day not between 0 and 4 then perform app.refuse('bad_value'); end if;
    select x.f, x.t into v_from, v_to
      from (values ('morning', 390, 780), ('afternoon', 780, 1140), ('evening', 1140, 1440), ('night', 1440, 1830)) as x(p, f, t)
     where x.p = p_part;
    if v_from is null then perform app.refuse('bad_value'); end if;
    if p_kind is not null and p_kind not in ('can', 'cannot') then perform app.refuse('bad_value'); end if;
    v_note := app.clean_line(p_note, 120);
    select * into v_a from public.approaches where edition_id = p_edition and speaker_id = p_speaker for update;
    if v_a.id is null or not (app.my_role(p_edition) = 'admin' or coalesce(v_a.owner_member_id = v_me, false)) then
      perform app.refuse('not_handler');
    end if;
    for r in select * from public.availability
              where approach_id = v_a.id and day = p_day and from_min < v_to and to_min > v_from order by id loop
      if r.from_min < v_from then
        insert into public.availability (approach_id, day, from_min, to_min, kind, note) values (v_a.id, p_day, r.from_min, v_from, r.kind, r.note);
      end if;
      if r.to_min > v_to then
        insert into public.availability (approach_id, day, from_min, to_min, kind, note) values (v_a.id, p_day, v_to, r.to_min, r.kind, r.note);
      end if;
      delete from public.availability where id = r.id;
    end loop;
    if p_kind is not null then
      insert into public.availability (approach_id, day, from_min, to_min, kind, note) values (v_a.id, p_day, v_from, v_to, p_kind, v_note);
    end if;
    perform app.log_event(p_edition, 'approaches', v_a.id, 'availability',
                          jsonb_build_object('speaker', p_speaker, 'day', p_day, 'part', p_part, 'kind', p_kind));
  end
  $$;

-- =============================================================================
-- Milestone 3 (v7) — from placement to arrival. Semantics: docs/CONTRACT.md
-- «From placement to arrival»; the in-memory twin is src/data/engine.ts, and
-- tests/parity holds the two together. lessons stays SELECT-only for a
-- browser: every write below is a SECURITY DEFINER function that checks who is
-- asking and refuses with a code src/errors.ts has the Hebrew for.
--   set_payment           the handler (or an admin) asks for an amount and/or
--                         transport → approval 'pending'; nothing asked → 'none'
--   decide_payments       a global admin approves or rejects — one or a batch,
--                         each at the version they saw, with a note
--   mark_confirm_sent     «סומן כנשלח»: confirm_sent_at/by, clears needs_reconfirm
--   set_escort            any editor: a roster trainee, self_intro, a note
--   set_sources           any editor: kind, print_when, note, presentation URL, in_reader
--   set_paid              logistics (or an admin): paid_at, once a payment is approved
--   get/set_transport_details   pickup and driver — personal data: their own
--                         table, app.may_see_transport, never in load_week or Realtime
--   set_confirm_template, set_duty_phrases   an admin of the edition: the
--                         instructor's own wording, kept in editions.settings
--   lessons_reconfirm     (trigger) a closed lesson whose confirmed details
--                         change after the message was sent → needs_reconfirm
--   editions_reconfirm    (trigger) the week's opening date moved → the same
-- reopen_lesson (above, phase 1) starts every stage over: they are the speaker's.
-- =============================================================================

-- ------------------------------------------------------------- lessons

-- The amount is whole shekels. Before v7 the column was numeric(8,2), as DESIGN
-- has it; nothing ever wrote it, so an older database's column is altered here.
do $$
begin
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'lessons' and column_name = 'pay_amount') <> 'integer' then
    alter table public.lessons alter column pay_amount type integer using round(pay_amount)::integer;
  end if;
end $$;

-- An escort is one of the edition's trainees (roster). Deleting a trainee
-- leaves their lessons without an escort — the screen lists those lessons first.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lessons_escort_roster_fk') then
    update public.lessons l set escort_roster_id = null
     where escort_roster_id is not null and not exists (select 1 from public.roster r where r.id = l.escort_roster_id);
    alter table public.lessons add constraint lessons_escort_roster_fk
      foreign key (escort_roster_id) references public.roster (id) on delete set null;
  end if;
end $$;
create index if not exists lessons_escort on public.lessons (escort_roster_id);

-- needs_reconfirm, in one place: a CLOSED lesson that already had its message
-- sent, and whose confirmed details change — moved (day, time, room), retitled,
-- a new teaching time or amount, or closed again with its message still marked
-- (reopen_lesson clears it, so only a hand edit gets there) — is flagged
-- «לעדכן את המרצה». Marking a new message sent (a new confirm_sent_at) is the
-- one update that does not flag; mark_confirm_sent clears the flag.
create or replace function app.lessons_reconfirm() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if new.state = 'closed' and new.confirm_sent_at is not null
       and new.confirm_sent_at is not distinct from old.confirm_sent_at
       and (old.state <> 'closed'
            or (old.day, old.start_min, old.end_min, old.room_id, old.title, old.teach_min, old.pay_amount)
               is distinct from (new.day, new.start_min, new.end_min, new.room_id, new.title, new.teach_min, new.pay_amount)) then
      new.needs_reconfirm := true;
    end if;
    return new;
  end
  $$;
drop trigger if exists lessons_reconfirm on public.lessons;
create trigger lessons_reconfirm before update of day, start_min, end_min, room_id, title, teach_min, pay_amount, state on public.lessons
  for each row execute function app.lessons_reconfirm();

-- {{תאריך}} and {{יום}} come from the week's opening Sunday: moving it after
-- messages went out changes the date in every one of them, so each closed lesson
-- whose message was sent is flagged too. (A date that was TBD put no date in any
-- message: setting it the first time flags nothing.) Any write path — the «מחזור»
-- tab, the SQL Editor.
create or replace function app.editions_reconfirm() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if old.start_date is not null and new.start_date is distinct from old.start_date then
      update public.lessons
         set needs_reconfirm = true, version = version + 1
       where edition_id = new.id and state = 'closed' and confirm_sent_at is not null and not needs_reconfirm;
    end if;
    return null;
  end
  $$;
drop trigger if exists editions_reconfirm on public.editions;
create trigger editions_reconfirm after update of start_date on public.editions
  for each row execute function app.editions_reconfirm();

-- ------------------------------------------------------------- transport details

-- Pickup and driver: personal data (an address, a driver's phone). Their own
-- table, like speaker_contacts — never in load_week, never in Realtime.
-- (DESIGN's `transport` table; renamed, since lessons.transport is the request.)
create table if not exists public.transport_details (
  lesson_id      bigint primary key references public.lessons (id) on delete cascade,
  pickup_address text,
  pickup_time    text,
  driver_name    text,
  driver_phone   text,
  arranged       boolean not null default false
);
alter table public.transport_details enable row level security;

-- Who handles the lesson: the owner of its lead speaker's approach there.
create or replace function app.lesson_handler(p_lesson bigint) returns bigint
  language sql stable security definer set search_path = ''
  as $$
    select a.owner_member_id
      from public.lesson_speakers x
      join public.lessons l on l.id = x.lesson_id
      join public.approaches a on a.speaker_id = x.speaker_id and a.edition_id = l.edition_id
     where x.lesson_id = p_lesson and x.role = 'lead'
     limit 1
  $$;

-- Who may see (and write) a lesson's transport details: a global admin; in a
-- real edition that is not archived, whoever handles the lesson (content or
-- admin there) — and that edition's logistics members, only once the transport
-- is approved. Practice, demo and archived editions give no access (the rule
-- of app.may_see_contacts). public/privacy.html says exactly this.
create or replace function app.may_see_transport(p_lesson bigint) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select app.is_global_admin() or exists (
      select 1 from public.lessons l join public.editions e on e.id = l.edition_id
       where l.id = p_lesson and e.kind = 'real' and e.status <> 'archived'
         and (   (app.my_role(l.edition_id) in ('admin', 'content')
                  and app.lesson_handler(l.id) = app.my_member_id(l.edition_id))
              or (app.my_role(l.edition_id) = 'logistics' and l.transport <> 'none' and l.approval = 'approved')))
  $$;

drop policy if exists transport_details_read on public.transport_details;
create policy transport_details_read on public.transport_details for select to authenticated
  using (app.may_see_transport(transport_details.lesson_id));

-- ------------------------------------------------------------- helpers

-- The lesson a stage command is about, locked; a missing one is `stale` (it
-- was deleted under the screen).
create or replace function app.stage_lesson(p_lesson bigint) returns public.lessons
  language plpgsql security definer set search_path = ''
  as $$
  declare v public.lessons;
  begin
    select * into v from public.lessons where id = p_lesson for update;
    if v.id is null or v.state = 'cancelled' then perform app.refuse('stale'); end if;
    return v;
  end
  $$;

-- The handler of a closed lesson, or an admin of its edition.
create or replace function app.require_handler(p_lesson public.lessons, p_me bigint) returns void
  language plpgsql stable security definer set search_path = ''
  as $$
  begin
    if p_lesson.state <> 'closed' then perform app.refuse('not_closed'); end if;
    if not (app.my_role(p_lesson.edition_id) = 'admin' or coalesce(app.lesson_handler(p_lesson.id) = p_me, false)) then
      perform app.refuse('not_handler');
    end if;
  end
  $$;

-- Logistics (or an admin) of the edition: paid_at. Content members: forbidden.
create or replace function app.require_logistics(p_edition bigint) returns bigint
  language plpgsql stable security definer set search_path = ''
  as $$
  declare
    v_role text := app.my_role(p_edition);
    v_ed   public.editions;
  begin
    if v_role is null then perform app.refuse('not_member'); end if;
    if v_role = 'content' then perform app.refuse('forbidden'); end if;
    select * into v_ed from public.editions where id = p_edition;
    if v_ed.id is null then perform app.refuse('not_member'); end if;
    if (v_ed.kind = 'archive' or v_ed.status = 'archived') and v_role <> 'admin' then perform app.refuse('archived'); end if;
    return app.my_member_id(p_edition);
  end
  $$;

-- An admin of the edition (its templates and phrases).
create or replace function app.require_edition_admin(p_edition bigint) returns void
  language plpgsql stable security definer set search_path = ''
  as $$
  declare v_role text := app.my_role(p_edition);
  begin
    if v_role is null or not exists (select 1 from public.editions where id = p_edition) then perform app.refuse('not_member'); end if;
    if v_role <> 'admin' then perform app.refuse('forbidden'); end if;
  end
  $$;

-- What a sources note, a URL and a duty phrase may be (src/data/stageRules.ts holds the same).
create or replace function app.pick_url(p text) returns text
  language plpgsql immutable set search_path = ''
  as $$
  declare v text := app.clean_line(p, 500);
  begin
    if v is not null and v !~* '^https?://[^ ]+$' then perform app.refuse('bad_url'); end if;
    return v;
  end
  $$;

-- The escorts' duty phrases: a JSON array of {when, text}; `when` one of the
-- lesson facts below, `text` one line of at most 200 characters; empty texts
-- and repeats (the first kept) dropped; at most 30. Never seeded.
create or replace function app.clean_duty_phrases(p jsonb) returns jsonb
  language plpgsql immutable set search_path = ''
  as $$
  declare
    v_out jsonb := '[]'::jsonb;
    e     jsonb;
    v_t   text;
    v_one jsonb;
  begin
    if p is null or jsonb_typeof(p) = 'null' then return v_out; end if;
    if jsonb_typeof(p) <> 'array' then perform app.refuse('bad_value'); end if;
    for e in select x from jsonb_array_elements(p) with ordinality as t(x, o) order by o loop
      if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'when') is distinct from 'string' or jsonb_typeof(e -> 'text') is distinct from 'string'
         or not (e ->> 'when' = any (array['always', 'self_intro', 'escort_intro', 'transport', 'memorial'])) then
        perform app.refuse('bad_value');
      end if;
      v_t := app.clean_line(e ->> 'text', 200);
      continue when v_t is null;
      v_one := jsonb_build_object('when', e ->> 'when', 'text', v_t);
      continue when v_out @> jsonb_build_array(v_one);
      v_out := v_out || jsonb_build_array(v_one);
    end loop;
    if jsonb_array_length(v_out) > 30 then perform app.refuse('bad_value'); end if;
    return v_out;
  end
  $$;

-- ------------------------------------------------------------- reads

-- load_week (everything the grid needs, in one round trip) is defined in the v9
-- section below: it reads the escorts' ticks, which are created there.

-- Transport details, through the policy (invoker): NULL when they are not mine to see.
create or replace function public.get_transport_details(p_lesson bigint) returns jsonb
  language sql stable security invoker set search_path = ''
  as $$
    select case when app.may_see_transport(p_lesson) then
      coalesce((select jsonb_build_object('pickup_address', t.pickup_address, 'pickup_time', t.pickup_time,
                                          'driver_name', t.driver_name, 'driver_phone', t.driver_phone, 'arranged', t.arranged)
                  from public.transport_details t where t.lesson_id = p_lesson),
               '{"pickup_address": null, "pickup_time": null, "driver_name": null, "driver_phone": null, "arranged": false}'::jsonb)
    end
  $$;

-- ------------------------------------------------------------- commands

-- Payment and transport: what the handler asks the instructor to approve.
-- An amount is whole shekels, 1–100000 (a typo guard, «הצעה»), or NULL: none
-- asked (a volunteer, or not decided yet) — never a default of ours.
create or replace function public.set_payment(p_lesson bigint, p_version integer, p_pay_amount numeric, p_transport text) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_l      public.lessons := app.stage_lesson(p_lesson);
    v_me     bigint := app.require_editor(v_l.edition_id);
    v_amount integer;
  begin
    perform app.require_handler(v_l, v_me);
    if v_l.version <> p_version then perform app.refuse('stale'); end if;
    if p_pay_amount is not null and (p_pay_amount <> trunc(p_pay_amount) or p_pay_amount < 1 or p_pay_amount > 100000) then
      perform app.refuse('bad_amount');
    end if;
    if p_transport is null or p_transport not in ('none', 'one_way', 'round_trip') then perform app.refuse('bad_value'); end if;
    v_amount := p_pay_amount::integer;
    -- a paid amount stays what was paid: «שולם» is undone first (logistics or an admin)
    if v_l.paid_at is not null and v_amount is distinct from v_l.pay_amount then perform app.refuse('paid_locked'); end if;
    -- the same request again: nothing — unless it was rejected (then it is asked again)
    if v_amount is not distinct from v_l.pay_amount and p_transport = v_l.transport and v_l.approval <> 'rejected' then return; end if;
    update public.lessons
       set pay_amount = v_amount, transport = p_transport,
           approval = case when v_amount is null and p_transport = 'none' then 'none' else 'pending' end,
           approval_note = null, approved_by = null, approved_at = null,
           version = version + 1, updated_by = v_me
     where id = v_l.id;
    -- no transport any more: its pickup and driver go too
    if p_transport = 'none' then delete from public.transport_details where lesson_id = v_l.id; end if;
  end
  $$;

-- The instructor's decision: one lesson or a batch, each at the version on the
-- screen (an amount changed since is `stale`, never approved unseen). All or nothing.
create or replace function public.decide_payments(p_lessons bigint[], p_versions integer[], p_decision text, p_note text default null)
  returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_note text;
    v_l    public.lessons;
    x      record;
  begin
    if not app.is_member() then perform app.refuse('not_member'); end if;
    if not app.is_global_admin() then perform app.refuse('forbidden'); end if;
    if p_decision is null or p_decision not in ('approved', 'rejected')
       or coalesce(cardinality(p_lessons), 0) <> coalesce(cardinality(p_versions), 0) then
      perform app.refuse('bad_value');
    end if;
    v_note := app.clean_line(p_note, 300);
    for x in select u.l, u.v from unnest(coalesce(p_lessons, '{}'), coalesce(p_versions, '{}')) as u(l, v) order by u.l, u.v loop
      select * into v_l from public.lessons where id = x.l for update;
      -- a request belongs to a closed lesson's speaker: a draft's is no one's to approve
      if v_l.id is null or v_l.version is distinct from x.v or v_l.approval <> 'pending' or v_l.state <> 'closed' then perform app.refuse('stale'); end if;
      update public.lessons
         set approval = p_decision, approval_note = v_note, approved_by = app.my_member_id(null), approved_at = now(),
             version = version + 1, updated_by = app.my_member_id(v_l.edition_id)
       where id = v_l.id;
    end loop;
  end
  $$;

-- «סומן כנשלח»: the summary message went out. Never while the payment or the
-- transport waits for the instructor (DESIGN, hard constraints) or was rejected.
create or replace function public.mark_confirm_sent(p_lesson bigint, p_version integer) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_l  public.lessons := app.stage_lesson(p_lesson);
    v_me bigint := app.require_editor(v_l.edition_id);
  begin
    perform app.require_handler(v_l, v_me);
    if v_l.version <> p_version then perform app.refuse('stale'); end if;
    if v_l.approval = 'pending' then perform app.refuse('approval_pending'); end if;
    if v_l.approval = 'rejected' then perform app.refuse('approval_rejected'); end if;
    update public.lessons
       set confirm_sent_at = now(), confirm_sent_by = v_me, needs_reconfirm = false,
           version = version + 1, updated_by = v_me
     where id = v_l.id;
  end
  $$;

-- The escort: a trainee of this edition's roster (or none), self-introduction,
-- and a note for the escorts' list. Any editor, on a closed lesson. A memorial
-- slot's escort is the family's liaison (v11): an admin of the edition, on a
-- slot with a plan placed on it (`no_plan`), never a self-introduction.
create or replace function public.set_escort(p_lesson bigint, p_version integer, p_roster bigint, p_self_intro boolean, p_note text default null)
  returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_l    public.lessons := app.stage_lesson(p_lesson);
    v_me   bigint := app.require_editor(v_l.edition_id);
    v_note text;
  begin
    if v_l.kind = 'memorial' then
      if app.my_role(v_l.edition_id) <> 'admin' then perform app.refuse('forbidden'); end if;
      if not exists (select 1 from public.memorial_plans where lesson_id = v_l.id) then perform app.refuse('no_plan'); end if;
    elsif v_l.state <> 'closed' then
      perform app.refuse('not_closed');
    end if;
    if v_l.version <> p_version then perform app.refuse('stale'); end if;
    if p_roster is not null and not exists (select 1 from public.roster where id = p_roster and edition_id = v_l.edition_id) then
      perform app.refuse('bad_escort');
    end if;
    if p_self_intro is null or (p_self_intro and v_l.kind = 'memorial') then perform app.refuse('bad_value'); end if;
    v_note := app.clean_block(p_note, 300);
    if (p_roster, p_self_intro, v_note) is not distinct from (v_l.escort_roster_id, v_l.self_intro, v_l.escort_note) then return; end if;
    update public.lessons
       set escort_roster_id = p_roster, self_intro = p_self_intro, escort_note = v_note,
           version = version + 1, updated_by = v_me
     where id = v_l.id;
  end
  $$;

-- Sources: what arrived, when to print, a presentation link (http/https only)
-- and whether the reader has it. A kind with nothing to print (pending, none,
-- presentation) is never in the reader. Any editor, on a closed lesson.
create or replace function public.set_sources(
  p_lesson bigint, p_version integer, p_kind text, p_print_when text, p_note text, p_url text, p_in_reader boolean)
  returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_l    public.lessons := app.stage_lesson(p_lesson);
    v_me   bigint := app.require_editor(v_l.edition_id);
    v_note text;
    v_url  text;
    v_in   boolean;
  begin
    if v_l.state <> 'closed' then perform app.refuse('not_closed'); end if;
    if v_l.version <> p_version then perform app.refuse('stale'); end if;
    if p_kind is null or p_kind not in ('pending', 'sheet', 'presentation', 'sheet_presentation', 'sheet_video', 'none', 'other') then
      perform app.refuse('bad_value');
    end if;
    if p_print_when is null or p_print_when not in ('none', 'before', 'same_day') then perform app.refuse('bad_value'); end if;
    v_note := app.clean_block(p_note, 500);
    v_url := app.pick_url(p_url);
    if p_in_reader is null then perform app.refuse('bad_value'); end if;
    v_in := p_in_reader and p_kind not in ('pending', 'none', 'presentation');
    if (p_kind, p_print_when, v_note, v_url, v_in)
       is not distinct from (v_l.sources_kind, v_l.print_when, v_l.sources_note, v_l.presentation_url, v_l.in_reader) then
      return;
    end if;
    update public.lessons
       set sources_kind = p_kind, print_when = p_print_when, sources_note = v_note, presentation_url = v_url, in_reader = v_in,
           version = version + 1, updated_by = v_me
     where id = v_l.id;
  end
  $$;

-- Logistics marks an approved payment paid (or not yet).
create or replace function public.set_paid(p_lesson bigint, p_paid boolean) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_l  public.lessons := app.stage_lesson(p_lesson);
    v_me bigint := app.require_logistics(v_l.edition_id);
  begin
    if v_l.pay_amount is null or v_l.approval <> 'approved' then perform app.refuse('payment_not_approved'); end if;
    if p_paid is null then perform app.refuse('bad_value'); end if;
    if (v_l.paid_at is not null) = p_paid then return; end if;
    update public.lessons
       set paid_at = case when p_paid then now() end, version = version + 1, updated_by = v_me
     where id = v_l.id;
  end
  $$;

-- Pickup and driver, for the people app.may_see_transport names (the same who
-- read them). All five replaced; the log says which fields changed, never to what.
create or replace function public.set_transport_details(
  p_lesson bigint, p_pickup_address text, p_pickup_time text, p_driver_name text, p_driver_phone text, p_arranged boolean default false)
  returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_l      public.lessons;
    v_old    public.transport_details;
    v_addr   text;
    v_time   text;
    v_name   text;
    v_phone  text;
    v_arr    boolean := coalesce(p_arranged, false);
    v_fields text[];
  begin
    if not app.is_member() then perform app.refuse('not_member'); end if;
    select * into v_l from public.lessons where id = p_lesson;
    if v_l.id is null then perform app.refuse('stale'); end if;
    if not app.may_see_transport(p_lesson) then perform app.refuse('transport_hidden'); end if;
    if v_l.transport = 'none' then perform app.refuse('no_transport'); end if;
    v_addr  := app.clean_line(p_pickup_address, 200);
    v_time  := app.clean_line(p_pickup_time, 60);
    v_name  := app.clean_line(p_driver_name, 80);
    v_phone := app.clean_line(p_driver_phone, 40);
    if v_phone is not null and char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 6 then perform app.refuse('bad_phone'); end if;

    select * into v_old from public.transport_details where lesson_id = p_lesson for update;
    select coalesce(array_agg(u.f order by u.o), '{}') into v_fields
      from unnest(array[
        case when v_addr is distinct from v_old.pickup_address then 'pickup_address' end,
        case when v_time is distinct from v_old.pickup_time then 'pickup_time' end,
        case when v_name is distinct from v_old.driver_name then 'driver_name' end,
        case when v_phone is distinct from v_old.driver_phone then 'driver_phone' end,
        case when v_arr is distinct from coalesce(v_old.arranged, false) then 'arranged' end]) with ordinality as u(f, o)
     where u.f is not null;
    if cardinality(v_fields) = 0 then return; end if;
    insert into public.transport_details (lesson_id, pickup_address, pickup_time, driver_name, driver_phone, arranged)
    values (p_lesson, v_addr, v_time, v_name, v_phone, v_arr)
    on conflict (lesson_id) do update
      set pickup_address = excluded.pickup_address, pickup_time = excluded.pickup_time, driver_name = excluded.driver_name,
          driver_phone = excluded.driver_phone, arranged = excluded.arranged;
    perform app.log_event(v_l.edition_id, 'lessons', p_lesson, 'transport', jsonb_build_object('fields', to_jsonb(v_fields)));
  end
  $$;

-- The summary message's template (DESIGN «תוצרים» 3): the instructor's own
-- wording, pasted from last year's tracking sheet — never seeded, empty until
-- then. One per edition, in editions.settings (start_edition carries it over).
create or replace function public.set_confirm_template(p_edition bigint, p_body text) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare v text;
  begin
    perform app.require_edition_admin(p_edition);
    v := app.clean_block(p_body, 4000);
    update public.editions
       set settings = case when v is null then settings - 'confirm_template'
                           else settings || jsonb_build_object('confirm_template', v) end
     where id = p_edition;
  end
  $$;

-- The escorts' «משהו שחשוב לדעת» phrases, by the lesson fact each applies to
-- (src/domain/escorts.ts composes a lesson's duty notes from them).
create or replace function public.set_duty_phrases(p_edition bigint, p_phrases jsonb) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare v jsonb;
  begin
    perform app.require_edition_admin(p_edition);
    v := app.clean_duty_phrases(p_phrases);
    update public.editions
       set settings = case when jsonb_array_length(v) = 0 then settings - 'duty_phrases'
                           else settings || jsonb_build_object('duty_phrases', v) end
     where id = p_edition;
  end
  $$;

-- =============================================================================
-- Milestone 4 (v8) — outputs and knowledge. The outputs themselves (the tracking
-- table, the escorts' list, the designer's export, the archive) are made in the
-- browser from the loaded Week (src/exports/); nothing is uploaded. The
-- database adds:
--   export_snapshots   what each export for the designer held — the public
--                      schedule only (a guard trigger lets no other key in) —
--                      so the next one shows what changed since. An edition's
--                      admins read and insert; never updated, never in Realtime.
--   notes              the knowledge base, by section: cross-year (edition_id
--                      NULL — a global admin writes) or one edition's (its
--                      admins write); every member who sees the edition reads.
--   milestones         relative to the week (W−days_before, «הצעה»), per
--                      edition; its admins write, its members read.
--                      start_edition carries the last real edition's over.
--   get_contacts_for   the phones of some lessons' speakers in one call, through
--                      the contacts policy (invoker) — never more than
--                      get_speaker_contacts shows, one speaker at a time.
-- Nothing here is seeded: notes and milestones are the instructor's own.
-- Writes are direct under RLS, like «הגדרות» (DECISIONS, אבן דרך 4): plain
-- rows, column grants, and a guard trigger that stamps who and when and keeps
-- what one statement cannot (a snapshot's keys, a version, done_at's clock).
-- =============================================================================

-- ------------------------------------------------------------- export snapshots

create table if not exists public.export_snapshots (
  id         bigint generated always as identity primary key,
  edition_id bigint not null references public.editions (id) on delete cascade,
  kind       text not null check (kind in ('designer')),
  payload    jsonb not null,
  created_by bigint,
  created_at timestamptz not null default now()
);
create index if not exists export_snapshots_edition on public.export_snapshots (edition_id, kind, created_at desc);
alter table public.export_snapshots enable row level security;

-- A snapshot is the public schedule and nothing else: an array of rows, each
-- with only the keys of a designer row (src/exports/designer.ts, DesignerRow) —
-- a phone, an amount or a note has no key to travel in. Who and when are the
-- database's, never the browser's.
create or replace function app.export_snapshots_guard() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if jsonb_typeof(new.payload) is distinct from 'array' then perform app.refuse('bad_value'); end if;
    if jsonb_array_length(new.payload) > 2000 or pg_column_size(new.payload) > 1000000 then perform app.refuse('bad_value'); end if;
    if exists (select 1 from jsonb_array_elements(new.payload) r where jsonb_typeof(r) <> 'object') then perform app.refuse('bad_value'); end if;
    if exists (select 1 from jsonb_array_elements(new.payload) r, jsonb_each(r) k
                where k.key <> all (array['lesson_id', 'kind', 'day', 'date', 'time', 'speaker', 'title', 'category', 'room', 'parallel'])
                   or jsonb_typeof(k.value) not in ('string', 'number', 'boolean', 'null')) then
      perform app.refuse('bad_value');
    end if;
    new.created_by := app.my_member_id(new.edition_id);
    new.created_at := now();
    return new;
  end
  $$;
drop trigger if exists export_snapshots_guard on public.export_snapshots;
create trigger export_snapshots_guard before insert on public.export_snapshots
  for each row execute function app.export_snapshots_guard();

drop policy if exists export_snapshots_read on public.export_snapshots;
create policy export_snapshots_read on public.export_snapshots for select to authenticated using (app.my_role(edition_id) = 'admin');
drop policy if exists export_snapshots_insert on public.export_snapshots;
create policy export_snapshots_insert on public.export_snapshots for insert to authenticated with check (app.my_role(edition_id) = 'admin');

-- ------------------------------------------------------------- notes (the knowledge base)

create table if not exists public.notes (
  id         bigint generated always as identity primary key,
  edition_id bigint references public.editions (id) on delete cascade,   -- NULL = every year
  section    text not null check (section in ('process', 'lessons_learned', 'challenges', 'templates')),
  title      text not null check (btrim(title) <> '' and char_length(title) <= 120),
  body_md    text not null default '' check (char_length(body_md) <= 20000),
  version    integer not null default 1,
  created_by bigint,
  updated_by bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_edition on public.notes (edition_id);
alter table public.notes enable row level security;

-- The title one line, the body a block (the pool's own cleaning rules); who and
-- when stamped; the version moves on every update (the screen sends the one it
-- saw: a note someone else saved meanwhile is not overwritten unseen).
create or replace function app.notes_guard() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    new.title := app.clean_line(new.title, 120);
    if new.title is null then perform app.refuse('title_required'); end if;
    new.body_md := coalesce(app.clean_block(new.body_md, 20000), '');
    new.updated_by := app.my_member_id(new.edition_id);
    new.updated_at := now();
    if tg_op = 'INSERT' then
      new.version := 1;
      new.created_by := new.updated_by;
      new.created_at := new.updated_at;
    else
      new.edition_id := old.edition_id;
      new.version := old.version + 1;
      new.created_by := old.created_by;
      new.created_at := old.created_at;
    end if;
    return new;
  end
  $$;
drop trigger if exists notes_guard on public.notes;
create trigger notes_guard before insert or update on public.notes
  for each row execute function app.notes_guard();

-- Read: a cross-year note by every member, an edition's by whoever sees it.
-- Write: a cross-year note by a global admin (like the categories), an
-- edition's by its admins.
drop policy if exists notes_read on public.notes;
create policy notes_read on public.notes for select to authenticated
  using (case when edition_id is null then (select app.is_member()) else app.can_see_edition(edition_id) end);
drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes for insert to authenticated
  with check (case when edition_id is null then (select app.is_global_admin()) else app.my_role(edition_id) = 'admin' end);
drop policy if exists notes_update on public.notes;
create policy notes_update on public.notes for update to authenticated
  using (case when edition_id is null then (select app.is_global_admin()) else app.my_role(edition_id) = 'admin' end)
  with check (case when edition_id is null then (select app.is_global_admin()) else app.my_role(edition_id) = 'admin' end);
drop policy if exists notes_delete on public.notes;
create policy notes_delete on public.notes for delete to authenticated
  using (case when edition_id is null then (select app.is_global_admin()) else app.my_role(edition_id) = 'admin' end);

-- ------------------------------------------------------------- milestones

-- What should be done by when, counted back from the week's opening Sunday:
-- days_before 42 is W−42 (a negative one is after the week, W+n). The numbers
-- are the instructor's «הצעה»; the screen shows the real date once the week
-- has one.
create table if not exists public.milestones (
  id          bigint generated always as identity primary key,
  edition_id  bigint not null references public.editions (id) on delete cascade,
  title       text not null check (btrim(title) <> '' and char_length(title) <= 120),
  days_before integer not null check (days_before between -90 and 365),
  done_at     timestamptz,
  done_by     bigint,
  created_by  bigint,
  created_at  timestamptz not null default now()
);
create index if not exists milestones_edition on public.milestones (edition_id);
alter table public.milestones enable row level security;

-- done_at is a toggle: whatever time the browser sends, «done» is the
-- database's now() and the member who marked it; clearing it clears both.
create or replace function app.milestones_guard() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    new.title := app.clean_line(new.title, 120);
    if new.title is null then perform app.refuse('title_required'); end if;
    if tg_op = 'INSERT' then
      new.done_at := null;
      new.done_by := null;
      new.created_by := app.my_member_id(new.edition_id);
      new.created_at := now();
    else
      new.edition_id := old.edition_id;
      new.created_by := old.created_by;
      new.created_at := old.created_at;
      if new.done_at is null then
        new.done_by := null;
      elsif old.done_at is null then
        new.done_at := now();
        new.done_by := app.my_member_id(new.edition_id);
      else
        new.done_at := old.done_at;
        new.done_by := old.done_by;
      end if;
    end if;
    return new;
  end
  $$;
drop trigger if exists milestones_guard on public.milestones;
create trigger milestones_guard before insert or update on public.milestones
  for each row execute function app.milestones_guard();

drop policy if exists milestones_read on public.milestones;
create policy milestones_read on public.milestones for select to authenticated using (app.can_see_edition(edition_id));
drop policy if exists milestones_insert on public.milestones;
create policy milestones_insert on public.milestones for insert to authenticated with check (app.my_role(edition_id) = 'admin');
drop policy if exists milestones_update on public.milestones;
create policy milestones_update on public.milestones for update to authenticated
  using (app.my_role(edition_id) = 'admin') with check (app.my_role(edition_id) = 'admin');
drop policy if exists milestones_delete on public.milestones;
create policy milestones_delete on public.milestones for delete to authenticated using (app.my_role(edition_id) = 'admin');

-- ------------------------------------------------------------- phones for the outputs

-- «כולל טלפונים» in the tracking table and the escorts' list: the phones of
-- these lessons' speakers, in one call. Invoker — lesson_speakers and
-- speaker_contacts are read through their policies, and each row also passes
-- app.may_see_contacts, the very predicate of get_speaker_contacts: a global
-- admin sees every one, a handler only their own speakers', anyone else none.
-- Phones only (no e-mail, no notes); at most 1000 lessons a call.
create or replace function public.get_contacts_for(p_lessons bigint[]) returns jsonb
  language sql stable security invoker set search_path = ''
  as $$
    select coalesce(jsonb_agg(jsonb_build_object('lesson_id', x.lesson_id, 'speaker_id', x.speaker_id, 'phone', c.phone)
                              order by x.lesson_id, x.speaker_id), '[]'::jsonb)
      from public.lesson_speakers x
      join public.speaker_contacts c on c.speaker_id = x.speaker_id
     where x.lesson_id = any ((coalesce(p_lessons, '{}'))[1:1000])
       and c.phone is not null
       and app.may_see_contacts(x.speaker_id)
  $$;

-- =============================================================================
-- Milestone 5a (v9) — links without an account, and מכריכה לכריכה. Semantics:
-- docs/CONTRACT.md «Links and מכריכה לכריכה»; the in-memory twin is
-- src/data/engine.ts, and tests/parity holds the two together.
--
-- The FIRST surface for `anon` (the publishable key, nobody signed in). Its whole
-- reach is ping and the six functions below, each SECURITY DEFINER with a fixed
-- output shape, each keyed by a link's token alone:
--   escort_view, escort_tick, escort_pickup   one trainee's escort link: their
--                     lessons, the four ticks, a pickup address (write-only)
--   kk_form, kk_signup                        the class's sign-up link
--   schedule_view                             the public schedule, read-only
-- An unknown, expired, revoked or wrong-scope token, a token past its rate limit,
-- a lesson that is not that escort's, and a link of an archived edition all get
-- the SAME refusal, `link_invalid` — the links are no oracle. A sign-up answers
-- the same in every case, so the link never tells who signed up.
--
--   share_links      the links: 128 random bits per token (extensions
--                    .gen_random_bytes), returned ONCE to the edition admin who
--                    issues it; only its sha256 is stored, and no browser role
--                    can read even that (column grants). Issue = replace: the
--                    old live link of the same subject is revoked.
--   share_link_hits  the rate limit («הצעה»): an escort's link — one person's —
--                    60 calls in 10 minutes; the class's links (kk, schedule),
--                    which some 60 trainees share, 1200 in 10 minutes per
--                    caller's address (hashed), never one count for the whole
--                    class: one holder can never close a class link for the rest.
--   escort_ticks     הזכרתי · פגשתי בחניה · הצגתי · נתתי מתנה: written through
--                    the escort's link, read by the team in load_week. A lesson
--                    whose escort changes (set_escort, reopen_lesson, a trainee
--                    deleted) loses its ticks: they were the last escort's.
--   kk_tracks …      מכריכה לכריכה: a track per kk grid row occurrence (a day
--                    and a kk row), groups (a book — title and author as typed,
--                    nothing seeded — a room, a capacity the admin entered,
--                    open), their leaders, the sign-ups (one per trainee per
--                    track) and the book orders. Written by the edition's
--                    admins through the functions below (book orders logistics
--                    too); read by its members.
-- None of these tables is ever published to Realtime.
-- =============================================================================

-- ------------------------------------------------------------- tables

-- An escort's link names a trainee of the edition; a kk sign-up names one too.
create unique index if not exists roster_id_edition on public.roster (id, edition_id);

create table if not exists public.share_links (
  id         bigint generated always as identity primary key,
  edition_id bigint not null references public.editions (id) on delete cascade,
  scope      text not null check (scope in ('escort', 'kk_signup', 'schedule')),
  subject_id bigint references public.roster (id) on delete cascade,   -- the escort (scope 'escort'); NULL otherwise
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_by bigint,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check ((scope = 'escort') = (subject_id is not null))
);
-- One live link per subject: issuing again revokes the old one first.
create unique index if not exists share_links_live on public.share_links (edition_id, scope, coalesce(subject_id, 0)) where revoked_at is null;
alter table public.share_links enable row level security;

-- A draft of v9 counted per token alone (token_hash its key). The counts live
-- ten minutes, so an old table is simply replaced.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'share_link_hits')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'share_link_hits' and column_name = 'client_hash') then
    drop table public.share_link_hits;
  end if;
end $$;
create table if not exists public.share_link_hits (
  token_hash   bytea not null references public.share_links (token_hash) on delete cascade,
  client_hash  bytea not null,   -- '' for an escort's link; the sha256 of the caller's address for a class link
  window_start timestamptz not null,
  hits         integer not null,
  primary key (token_hash, client_hash)
);
alter table public.share_link_hits enable row level security;   -- no policy: the definer functions only

create table if not exists public.escort_ticks (
  lesson_id bigint not null references public.lessons (id) on delete cascade,
  item      text not null check (item in ('reminded', 'met', 'introduced', 'gift')),
  at        timestamptz not null default now(),
  primary key (lesson_id, item)
);
alter table public.escort_ticks enable row level security;

create table if not exists public.kk_tracks (
  id         bigint generated always as identity primary key,
  edition_id bigint not null references public.editions (id) on delete cascade,
  day        smallint not null check (day between 0 and 4),
  start_min  integer not null check (start_min between 390 and 1830),
  end_min    integer not null check (end_min between 390 and 1830 and end_min > start_min),
  unique (edition_id, day, start_min),
  unique (id, edition_id)
);
alter table public.kk_tracks enable row level security;

create table if not exists public.kk_groups (
  id         bigint generated always as identity primary key,
  edition_id bigint not null,
  track_id   bigint not null,
  title      text not null check (btrim(title) <> '' and char_length(title) <= 200),
  author     text check (char_length(author) <= 120),
  room_id    bigint references public.rooms (id) on delete set null,
  capacity   integer check (capacity between 1 and 1000),   -- what the admin entered; NULL = not offered yet
  open       boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (track_id, edition_id) references public.kk_tracks (id, edition_id) on delete cascade,
  unique (id, track_id)
);
create index if not exists kk_groups_track on public.kk_groups (track_id);
alter table public.kk_groups enable row level security;

create table if not exists public.kk_leaders (
  id        bigint generated always as identity primary key,
  group_id  bigint not null references public.kk_groups (id) on delete cascade,
  kind      text not null check (kind in ('staff', 'trainee', 'ein_prat')),
  roster_id bigint references public.roster (id) on delete cascade,   -- a trainee leader
  label     text check (char_length(label) <= 80),                    -- anyone else, as typed
  sort      integer not null default 0,
  check ((kind = 'trainee') = (roster_id is not null)),
  check (kind = 'trainee' or btrim(coalesce(label, '')) <> '')
);
create index if not exists kk_leaders_group on public.kk_leaders (group_id);
alter table public.kk_leaders enable row level security;

create table if not exists public.kk_signups (
  id         bigint generated always as identity primary key,
  edition_id bigint not null,
  track_id   bigint not null,
  group_id   bigint not null,
  roster_id  bigint not null,
  via        text not null check (via in ('link', 'staff')),
  created_at timestamptz not null default now(),
  unique (track_id, roster_id),
  foreign key (track_id, edition_id) references public.kk_tracks (id, edition_id) on delete cascade,
  foreign key (group_id, track_id) references public.kk_groups (id, track_id) on delete cascade,
  foreign key (roster_id, edition_id) references public.roster (id, edition_id) on delete cascade
);
create index if not exists kk_signups_group on public.kk_signups (group_id);
alter table public.kk_signups enable row level security;

create table if not exists public.book_orders (
  group_id   bigint primary key references public.kk_groups (id) on delete cascade,
  copies     integer not null check (copies between 0 and 1000),
  ordered_at timestamptz
);
alter table public.book_orders enable row level security;

-- ------------------------------------------------------------- reads under RLS

-- The links: an edition's admins, and never the hash (column grants, at the end).
drop policy if exists share_links_read on public.share_links;
create policy share_links_read on public.share_links for select to authenticated using (app.my_role(edition_id) = 'admin');
drop policy if exists escort_ticks_read on public.escort_ticks;
create policy escort_ticks_read on public.escort_ticks for select to authenticated using (
  exists (select 1 from public.lessons l where l.id = escort_ticks.lesson_id and app.can_see_edition(l.edition_id)));
drop policy if exists kk_tracks_read on public.kk_tracks;
create policy kk_tracks_read on public.kk_tracks for select to authenticated using (app.can_see_edition(edition_id));
drop policy if exists kk_groups_read on public.kk_groups;
create policy kk_groups_read on public.kk_groups for select to authenticated using (app.can_see_edition(edition_id));
drop policy if exists kk_leaders_read on public.kk_leaders;
create policy kk_leaders_read on public.kk_leaders for select to authenticated using (
  exists (select 1 from public.kk_groups g where g.id = kk_leaders.group_id and app.can_see_edition(g.edition_id)));
drop policy if exists kk_signups_read on public.kk_signups;
create policy kk_signups_read on public.kk_signups for select to authenticated using (app.can_see_edition(edition_id));
drop policy if exists book_orders_read on public.book_orders;
create policy book_orders_read on public.book_orders for select to authenticated using (
  exists (select 1 from public.kk_groups g where g.id = book_orders.group_id and app.can_see_edition(g.edition_id)));

-- ------------------------------------------------------------- helpers

-- An instant as JavaScript writes it (toISOString): the window's bounds and the
-- ticks' times read the same in both implementations.
create or replace function app.iso(p timestamptz) returns text
  language sql immutable set search_path = ''
  as $$ select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- A lesson's teaching time ends here: its own teaching time, else
-- min(settings.lesson_minutes ?? 75, the slot) — src/domain/message.ts
-- teachMinutes; a memorial slot is its whole length.
create or replace function app.teach_end(p_lesson public.lessons, p_settings jsonb) returns integer
  language sql immutable set search_path = ''
  as $$
    select case when p_lesson.kind = 'memorial' then p_lesson.end_min
                else p_lesson.start_min + coalesce(p_lesson.teach_min, least(
                       case when jsonb_typeof(p_settings -> 'lesson_minutes') = 'number' then (p_settings ->> 'lesson_minutes')::numeric::integer else 75 end,
                       p_lesson.end_min - p_lesson.start_min)) end
  $$;

-- «ד״ר פלונית אלמונית» (src/domain/names.ts displayName).
create or replace function app.speaker_label(p public.speakers) returns text
  language sql immutable set search_path = ''
  as $$ select case when nullif(p.title, '') is null then p.name else p.title || ' ' || p.name end $$;

-- A lesson's «משהו שחשוב לדעת»: the instructor's duty phrases that apply to it,
-- in their order — the rule of src/domain/escorts.ts (dutyNotes), which
-- tests/parity holds equal to this. Never the amount.
create or replace function app.duty_notes(p_lesson public.lessons, p_phrases jsonb) returns jsonb
  language sql immutable set search_path = ''
  as $$
    select coalesce(jsonb_agg(t.p ->> 'text' order by t.o), '[]'::jsonb)
      from jsonb_array_elements(case when jsonb_typeof(p_phrases) = 'array' then p_phrases else '[]'::jsonb end) with ordinality as t(p, o)
     where jsonb_typeof(t.p) = 'object' and jsonb_typeof(t.p -> 'text') = 'string'
       and case t.p ->> 'when'
             when 'always' then true
             when 'self_intro' then p_lesson.self_intro
             when 'escort_intro' then p_lesson.kind = 'lesson' and not p_lesson.self_intro
             when 'transport' then p_lesson.transport <> 'none' and p_lesson.approval = 'approved'
             when 'memorial' then p_lesson.kind = 'memorial'
             else false
           end
  $$;

-- The four ticks of a lesson: when each was ticked, or null.
create or replace function app.ticks_of(p_lesson bigint) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
    select jsonb_build_object(
      'reminded',   (select app.iso(t.at) from public.escort_ticks t where t.lesson_id = p_lesson and t.item = 'reminded'),
      'met',        (select app.iso(t.at) from public.escort_ticks t where t.lesson_id = p_lesson and t.item = 'met'),
      'introduced', (select app.iso(t.at) from public.escort_ticks t where t.lesson_id = p_lesson and t.item = 'introduced'),
      'gift',       (select app.iso(t.at) from public.escort_ticks t where t.lesson_id = p_lesson and t.item = 'gift'))
  $$;

-- When a link stops working («הצעה», DECISIONS אבן דרך 5א): an escort's and the
-- schedule's at the end of the week — Friday 00:00 Israel time, start_date + 5
-- — or, while the week's date is TBD, 30 days (720 hours) after it was issued;
-- the sign-up link when the sign-up window closes (no window yet: 30 days).
-- Kept in share_links.expires_at, and recomputed when the date or the window
-- moves (app.editions_link_expiry).
create or replace function app.link_expiry(p_edition bigint, p_scope text, p_created timestamptz) returns timestamptz
  language sql stable security definer set search_path = ''
  as $$
    select case
      when p_scope = 'kk_signup' then
        coalesce((e.settings #>> '{kk_window,closes_at}')::timestamptz, p_created + interval '720 hours')
      else
        coalesce(((e.start_date + 5)::timestamp at time zone 'Asia/Jerusalem'), p_created + interval '720 hours')
    end
    from public.editions e where e.id = p_edition
  $$;

create or replace function app.editions_link_expiry() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if new.start_date is distinct from old.start_date or (new.settings -> 'kk_window') is distinct from (old.settings -> 'kk_window') then
      update public.share_links set expires_at = app.link_expiry(new.id, scope, created_at)
       where edition_id = new.id and revoked_at is null;
    end if;
    return null;
  end
  $$;
drop trigger if exists editions_link_expiry on public.editions;
create trigger editions_link_expiry after update of start_date, settings on public.editions
  for each row execute function app.editions_link_expiry();

-- A lesson whose escort changes — another trainee, none (set_escort, reopen_lesson),
-- or the trainee deleted (on delete set null) — loses the last escort's ticks.
create or replace function app.lessons_escort_ticks() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if new.escort_roster_id is distinct from old.escort_roster_id then
      delete from public.escort_ticks where lesson_id = new.id;
    end if;
    return null;
  end
  $$;
drop trigger if exists lessons_escort_ticks on public.lessons;
create trigger lessons_escort_ticks after update of escort_roster_id on public.lessons
  for each row execute function app.lessons_escort_ticks();

-- How many calls a link may make in 10 minutes («הצעה»): an escort's link is one
-- person's, counted as one; a class link (the sign-up, the schedule) is held by
-- some 60 trainees, so it is counted per caller's address (app.link_client) —
-- a whole class behind one Wi-Fi address, some 10 calls each, uses half.
create or replace function app.link_rate(p_scope text) returns integer
  language sql immutable set search_path = ''
  as $$ select case when p_scope = 'escort' then 60 else 1200 end $$;

-- Whose count a call is: an escort's link has one ('' — one person's link); a
-- class link one per caller's address as the API gateway reports it — Cloudflare's
-- cf-connecting-ip, else the first address of X-Forwarded-For (as Supabase's own
-- guide reads it) — kept only as its sha256. No address (a call that did not come
-- through the API) is one count of its own. A caller who makes up addresses
-- escapes their own limit, as anyone may already call with made-up tokens (never
-- counted); the limit is against a runaway page, not an attacker, and there is
-- no count the whole class shares, so nobody can use it up for the others.
create or replace function app.link_client(p_scope text) returns bytea
  language plpgsql stable set search_path = ''
  as $$
  declare
    h jsonb;
  begin
    if p_scope = 'escort' then return '\x'::bytea; end if;
    begin
      h := nullif(current_setting('request.headers', true), '')::jsonb;
    exception when others then
      h := null;
    end;
    if h is null or jsonb_typeof(h) <> 'object' then h := '{}'::jsonb; end if;
    return extensions.digest(coalesce(nullif(btrim(h ->> 'cf-connecting-ip'), ''),
                                      nullif(btrim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''),
                                      ''), 'sha256');
  end
  $$;

-- The link a presented token opens — found by the sha256 of what was presented,
-- never by the plaintext — refused, always with the one code `link_invalid`,
-- when it is unknown, of another scope, revoked, expired or of an archived
-- edition; then counted (app.link_rate, app.link_client) and refused, with the
-- same code, past the limit. A refusal rolls the count back with everything
-- else: only answered calls are counted. Each counted call also clears the
-- link's counts whose window has passed, so made-up addresses do not pile up.
create or replace function app.link_for(p_token text, p_scope text) returns public.share_links
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v        public.share_links;
    v_hash   bytea;
    v_client bytea;
    v_hits   integer;
  begin
    if p_token is null or char_length(p_token) not between 16 and 64 then perform app.refuse('link_invalid'); end if;
    v_hash := extensions.digest(p_token, 'sha256');
    select * into v from public.share_links where token_hash = v_hash;
    if v.id is null or v.scope <> p_scope or v.revoked_at is not null or v.expires_at <= now() then perform app.refuse('link_invalid'); end if;
    if exists (select 1 from public.editions e where e.id = v.edition_id and (e.kind = 'archive' or e.status = 'archived')) then
      perform app.refuse('link_invalid');
    end if;
    v_client := app.link_client(v.scope);
    delete from public.share_link_hits
     where token_hash = v_hash and client_hash <> v_client and window_start <= now() - interval '10 minutes';
    insert into public.share_link_hits as h (token_hash, client_hash, window_start, hits) values (v_hash, v_client, now(), 1)
    on conflict (token_hash, client_hash) do update
      set hits = case when h.window_start <= now() - interval '10 minutes' then 1 else h.hits + 1 end,
          window_start = case when h.window_start <= now() - interval '10 minutes' then now() else h.window_start end
    returning h.hits into v_hits;
    if v_hits > app.link_rate(v.scope) then perform app.refuse('link_invalid'); end if;
    return v;
  end
  $$;

-- A lesson of this escort's link: closed (or a memorial slot — its escort is the
-- family's liaison, v11), in its edition, escorted by its trainee — anything
-- else is `link_invalid`, like a bad token (no oracle).
create or replace function app.escort_lesson(p_link public.share_links, p_lesson bigint) returns public.lessons
  language plpgsql security definer set search_path = ''
  as $$
  declare v public.lessons;
  begin
    select * into v from public.lessons where id = p_lesson for update;
    if v.id is null or v.edition_id <> p_link.edition_id or v.escort_roster_id is distinct from p_link.subject_id
       or v.state = 'cancelled' or (v.state <> 'closed' and v.kind <> 'memorial') then
      perform app.refuse('link_invalid');
    end if;
    return v;
  end
  $$;

-- The sign-up window (editions.settings.kk_window): open from opens_at until closes_at.
create or replace function app.kk_open(p_settings jsonb) returns boolean
  language sql stable set search_path = ''
  as $$
    select coalesce((p_settings #>> '{kk_window,opens_at}')::timestamptz <= now()
                    and now() < (p_settings #>> '{kk_window,closes_at}')::timestamptz, false)
  $$;

-- The kk rows of a day, as the edition's window allows them (rowActive, like app.lesson_rows).
create or replace function app.kk_rows(p_edition bigint, p_day integer)
  returns setof public.grid_rows
  language sql stable security definer set search_path = ''
  as $$
    select r.* from public.grid_rows r join public.editions e on e.id = r.edition_id
     where r.edition_id = p_edition and r.kind = 'kk' and p_day = any (r.days)
       and not (p_day = 0 and e.first_day_from is not null and r.end_min <= e.first_day_from)
       and not (p_day = 4 and r.start_min >= e.last_day_until)
     order by r.start_min, r.end_min
  $$;

-- A track whose kk row is still active that day — the edition's first or last
-- day's hours can move after groups exist (src/screens/kk «מחוץ לרשת»). A track
-- off the grid keeps its groups and sign-ups for the staff, but the link
-- neither offers it nor records a sign-up on it.
create or replace function app.kk_track_on_grid(p public.kk_tracks) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select exists (select 1 from app.kk_rows(p.edition_id, p.day) r where r.start_min = p.start_min) $$;

-- A whole number from a JSON value in [lo, hi]; absent or JSON null → NULL.
create or replace function app.json_int(p jsonb, p_lo integer, p_hi integer) returns integer
  language plpgsql immutable set search_path = ''
  as $$
  begin
    if p is null or jsonb_typeof(p) = 'null' then return null; end if;
    if jsonb_typeof(p) <> 'number' then perform app.refuse('bad_value'); end if;
    if (p #>> '{}')::numeric <> trunc((p #>> '{}')::numeric) or (p #>> '{}')::numeric not between p_lo and p_hi then
      perform app.refuse('bad_value');
    end if;
    return (p #>> '{}')::integer;
  end
  $$;

-- A group's leaders as both sides accept them (src/data/kkRules.ts
-- cleanLeaders): a JSON array of {kind, roster_id | label} — a trainee of the
-- edition's roster (`bad_trainee`), or a name as typed, one line ≤ 80; repeats
-- (the first kept) dropped; at most 6 («הצעה»).
create or replace function app.kk_clean_leaders(p jsonb, p_edition bigint) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
  declare
    v_out jsonb := '[]'::jsonb;
    e     jsonb;
    v_one jsonb;
    v_r   bigint;
  begin
    if p is null or jsonb_typeof(p) = 'null' then return v_out; end if;
    if jsonb_typeof(p) <> 'array' then perform app.refuse('bad_value'); end if;
    for e in select x from jsonb_array_elements(p) with ordinality as t(x, o) order by o loop
      if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'kind') is distinct from 'string'
         or not (e ->> 'kind' = any (array['staff', 'trainee', 'ein_prat'])) then
        perform app.refuse('bad_value');
      end if;
      if e ->> 'kind' = 'trainee' then
        if jsonb_typeof(e -> 'roster_id') is distinct from 'number' then perform app.refuse('bad_trainee'); end if;
        if (e ->> 'roster_id')::numeric <> trunc((e ->> 'roster_id')::numeric) then perform app.refuse('bad_trainee'); end if;
        v_r := (e ->> 'roster_id')::numeric::bigint;
        if not exists (select 1 from public.roster r where r.id = v_r and r.edition_id = p_edition) then perform app.refuse('bad_trainee'); end if;
        v_one := jsonb_build_object('kind', 'trainee', 'roster_id', v_r, 'label', null);
      else
        if jsonb_typeof(e -> 'label') is distinct from 'string' or app.clean_line(e ->> 'label', 80) is null then perform app.refuse('bad_value'); end if;
        v_one := jsonb_build_object('kind', e ->> 'kind', 'roster_id', null, 'label', app.clean_line(e ->> 'label', 80));
      end if;
      continue when v_out @> jsonb_build_array(v_one);
      v_out := v_out || jsonb_build_array(v_one);
    end loop;
    if jsonb_array_length(v_out) > 6 then perform app.refuse('bad_value'); end if;
    return v_out;
  end
  $$;

-- A group's fields from a JSON object (kk_add_group, kk_update_group): only the
-- keys present, cleaned and checked in this order — title (one line ≤ 200,
-- required: `title_required`), author (≤ 120), room_id (a room of the edition),
-- capacity (1–1000 or none), open (a boolean), leaders. Unknown keys ignored.
create or replace function app.kk_clean_group(p jsonb, p_edition bigint) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
  declare
    v_out  jsonb := '{}'::jsonb;
    v_room bigint;
  begin
    if p is null or jsonb_typeof(p) <> 'object' then perform app.refuse('bad_value'); end if;
    if p ? 'title' then
      if jsonb_typeof(p -> 'title') not in ('string', 'null') or app.clean_line(p ->> 'title', 200) is null then perform app.refuse('title_required'); end if;
      v_out := v_out || jsonb_build_object('title', app.clean_line(p ->> 'title', 200));
    end if;
    if p ? 'author' then
      if jsonb_typeof(p -> 'author') not in ('string', 'null') then perform app.refuse('bad_value'); end if;
      v_out := v_out || jsonb_build_object('author', app.clean_line(p ->> 'author', 120));
    end if;
    if p ? 'room_id' then
      v_room := app.json_int(p -> 'room_id', 1, 2147483647);
      if v_room is not null and not exists (select 1 from public.rooms where id = v_room and edition_id = p_edition) then
        perform app.refuse('bad_value');
      end if;
      v_out := v_out || jsonb_build_object('room_id', v_room);
    end if;
    if p ? 'capacity' then
      v_out := v_out || jsonb_build_object('capacity', app.json_int(p -> 'capacity', 1, 1000));
    end if;
    if p ? 'open' then
      if jsonb_typeof(p -> 'open') <> 'boolean' then perform app.refuse('bad_value'); end if;
      v_out := v_out || jsonb_build_object('open', (p ->> 'open')::boolean);
    end if;
    if p ? 'leaders' then
      v_out := v_out || jsonb_build_object('leaders', app.kk_clean_leaders(p -> 'leaders', p_edition));
    end if;
    return v_out;
  end
  $$;

create or replace function app.kk_write_leaders(p_group bigint, p_leaders jsonb) returns void
  language sql security definer set search_path = ''
  as $$
    delete from public.kk_leaders where group_id = p_group;
    insert into public.kk_leaders (group_id, kind, roster_id, label, sort)
    select p_group, x ->> 'kind', (x ->> 'roster_id')::bigint, x ->> 'label', o::integer
      from jsonb_array_elements(p_leaders) with ordinality as t(x, o);
  $$;

-- ------------------------------------------------------------- the anon functions

-- The escort's page: that trainee's closed lessons (and the memorial slots they
-- are the family's liaison for — v11: the slot's facts alone, never the fallen's
-- name, the plan or a family's contact) in that edition, in grid
-- order — day, the day column's date (or null = TBD), the teaching time, room,
-- the lead speaker's name and gender, title, self-introduction, the duty notes,
-- the lesson's note to the escort, the four ticks — and, only from W−7 (Israel
-- time) of a real edition whose week has a date, the lead speaker's phone; the
-- driver's name and phone only once the transport was approved and arranged.
-- Never an amount, an approval, an e-mail, the pickup address, another
-- escort's lesson or anyone else's note.
create or replace function public.escort_view(p_token text) returns jsonb
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v      public.share_links := app.link_for(p_token, 'escort');
    v_ed   public.editions;
    v_r    public.roster;
    v_ph   boolean;
  begin
    select * into v_ed from public.editions where id = v.edition_id;
    select * into v_r from public.roster where id = v.subject_id;
    v_ph := v_ed.kind = 'real' and v_ed.start_date is not null
            and (now() at time zone 'Asia/Jerusalem')::date >= v_ed.start_date - 7;
    return jsonb_build_object(
      'edition', jsonb_build_object('label', v_ed.label, 'start_date', v_ed.start_date),
      'escort', jsonb_build_object('full_name', v_r.full_name, 'gender', v_r.gender),
      'phones_from', case when v_ed.kind = 'real' then v_ed.start_date - 7 end,
      'lessons', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'lesson_id', l.id,
                 'kind', l.kind,
                 'day', l.day,
                 'date', v_ed.start_date + l.day::integer,
                 'start_min', l.start_min,
                 'end_min', app.teach_end(l, v_ed.settings),
                 'room', rm.name,
                 'speaker', case when s.id is not null then jsonb_build_object('name', app.speaker_label(s), 'gender', s.gender) end,
                 'title', l.title,
                 'self_intro', l.self_intro,
                 'duty_notes', app.duty_notes(l, v_ed.settings -> 'duty_phrases'),
                 'escort_note', l.escort_note,
                 'phone', case when v_ph then c.phone end,
                 'transport', l.transport <> 'none' and l.approval = 'approved',
                 'driver', case when v_ed.kind = 'real' and l.transport <> 'none' and l.approval = 'approved' and t.arranged
                                then jsonb_build_object('name', t.driver_name, 'phone', t.driver_phone) end,
                 'ticks', app.ticks_of(l.id))
               order by l.day, l.start_min, rm.sort, l.id)
          from public.lessons l
          join public.rooms rm on rm.id = l.room_id
          left join public.lesson_speakers x on x.lesson_id = l.id and x.role = 'lead'
          left join public.speakers s on s.id = x.speaker_id
          left join public.speaker_contacts c on c.speaker_id = s.id
          left join public.transport_details t on t.lesson_id = l.id
         where l.edition_id = v.edition_id and l.escort_roster_id = v.subject_id
           and l.state <> 'cancelled' and (l.state = 'closed' or l.kind = 'memorial')), '[]'::jsonb));
  end
  $$;

-- One of the four ticks on one of the escort's lessons, on (its first time
-- kept) or off. Answers the lesson's four ticks. They are a speaker's escort's
-- (הזכרתי למרצה, פגשתי בחניה, …): a memorial slot — the liaison's own, on the
-- page already — has none to tick, and answers as an item that does not exist
-- (`bad_value`), after the link's one refusal: no answer the page does not give.
create or replace function public.escort_tick(p_token text, p_lesson bigint, p_item text, p_on boolean) returns jsonb
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v   public.share_links := app.link_for(p_token, 'escort');
    v_l public.lessons := app.escort_lesson(v, p_lesson);
  begin
    if p_item is null or p_item not in ('reminded', 'met', 'introduced', 'gift') or p_on is null or v_l.kind = 'memorial' then
      perform app.refuse('bad_value');
    end if;
    if p_on then
      insert into public.escort_ticks (lesson_id, item) values (v_l.id, p_item) on conflict do nothing;
    else
      delete from public.escort_ticks where lesson_id = v_l.id and item = p_item;
    end if;
    return app.ticks_of(v_l.id);
  end
  $$;

-- «כתובת איסוף»: the escort writes the speaker's pickup address, one line ≤ 200,
-- on a lesson whose transport was approved (`no_transport`). Write-only: it is
-- never read back through the link. The log says the field changed, and how —
-- never the value.
create or replace function public.escort_pickup(p_token text, p_lesson bigint, p_address text) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v      public.share_links := app.link_for(p_token, 'escort');
    v_l    public.lessons := app.escort_lesson(v, p_lesson);
    v_addr text;
  begin
    if not (v_l.transport <> 'none' and v_l.approval = 'approved') then perform app.refuse('no_transport'); end if;
    v_addr := app.clean_line(p_address, 200);
    if v_addr is null then perform app.refuse('bad_value'); end if;
    insert into public.transport_details (lesson_id, pickup_address) values (v_l.id, v_addr)
    on conflict (lesson_id) do update set pickup_address = excluded.pickup_address;
    perform app.log_event(v_l.edition_id, 'lessons', v_l.id, 'transport', '{"fields": ["pickup_address"], "via": "escort_link"}'::jsonb);
  end
  $$;

-- The sign-up page: the window and whether it is open now, the edition's
-- trainees (names only — nothing about who signed up), and the tracks still on
-- the grid (app.kk_track_on_grid) with the groups on offer (open, with a
-- capacity entered): the book, its author, the room, the leaders' names, and
-- whether the group is full.
create or replace function public.kk_form(p_token text) returns jsonb
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v    public.share_links := app.link_for(p_token, 'kk_signup');
    v_ed public.editions;
  begin
    select * into v_ed from public.editions where id = v.edition_id;
    return jsonb_build_object(
      'edition', jsonb_build_object('label', v_ed.label, 'start_date', v_ed.start_date),
      'window', jsonb_build_object('opens_at', v_ed.settings #>> '{kk_window,opens_at}', 'closes_at', v_ed.settings #>> '{kk_window,closes_at}'),
      'open', app.kk_open(v_ed.settings),
      'roster', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'full_name', r.full_name) order by r.full_name, r.id)
                            from public.roster r where r.edition_id = v.edition_id), '[]'::jsonb),
      'tracks', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id, 'day', t.day, 'date', v_ed.start_date + t.day::integer, 'start_min', t.start_min, 'end_min', t.end_min,
                 'groups', (select jsonb_agg(jsonb_build_object(
                                     'id', g.id, 'title', g.title, 'author', g.author, 'room', rm.name,
                                     'leaders', coalesce((select jsonb_agg(jsonb_build_object('kind', k.kind, 'name', coalesce(ro.full_name, k.label)) order by k.sort, k.id)
                                                            from public.kk_leaders k left join public.roster ro on ro.id = k.roster_id
                                                           where k.group_id = g.id), '[]'::jsonb),
                                     'full', (select count(*) from public.kk_signups s where s.group_id = g.id) >= g.capacity)
                                   order by g.title, g.id)
                              from public.kk_groups g left join public.rooms rm on rm.id = g.room_id
                             where g.track_id = t.id and g.open and g.capacity is not null))
               order by t.day, t.start_min)
          from public.kk_tracks t
         where t.edition_id = v.edition_id and app.kk_track_on_grid(t)
           and exists (select 1 from public.kk_groups g where g.track_id = t.id and g.open and g.capacity is not null)), '[]'::jsonb));
  end
  $$;

-- A trainee signs up for a group: recorded only inside the window, for a
-- trainee of the edition, in an open group with a capacity entered, on a track
-- still on the grid, and with a place left (counted under the group's row lock,
-- so two at once — or one while the staff place someone — never overfill it). An existing sign-up for that track is NEVER changed through the link —
-- only the staff move one (kk_place). The answer is the same in every case:
-- the link is no oracle of who signed up.
create or replace function public.kk_signup(p_token text, p_roster bigint, p_group bigint) returns jsonb
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v    public.share_links := app.link_for(p_token, 'kk_signup');
    v_ed public.editions;
    v_g  public.kk_groups;
  begin
    select * into v_ed from public.editions where id = v.edition_id;
    select * into v_g from public.kk_groups where id = p_group and edition_id = v.edition_id for update;
    if v_g.id is not null and v_g.open and v_g.capacity is not null and app.kk_open(v_ed.settings)
       and (select app.kk_track_on_grid(t) from public.kk_tracks t where t.id = v_g.track_id)
       and exists (select 1 from public.roster r where r.id = p_roster and r.edition_id = v.edition_id)
       and (select count(*) from public.kk_signups s where s.group_id = v_g.id) < v_g.capacity then
      insert into public.kk_signups (edition_id, track_id, group_id, roster_id, via)
      values (v.edition_id, v_g.track_id, v_g.id, p_roster, 'link')
      on conflict (track_id, roster_id) do nothing;
    end if;
    return jsonb_build_object('status', 'received');
  end
  $$;

-- The public schedule (src/exports/designer.ts): closed lessons and memorial
-- slots, in grid order — kind, day, the day column's date (or null), the
-- teaching time, the speakers' names, title, category, room, «במקביל». Never a
-- contact, an amount or a note.
create or replace function public.schedule_view(p_token text) returns jsonb
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v    public.share_links := app.link_for(p_token, 'schedule');
    v_ed public.editions;
  begin
    select * into v_ed from public.editions where id = v.edition_id;
    return jsonb_build_object(
      'edition', jsonb_build_object('label', v_ed.label, 'start_date', v_ed.start_date),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'kind', l.kind,
                 'day', l.day,
                 'date', v_ed.start_date + l.day::integer,
                 'start_min', l.start_min,
                 'end_min', app.teach_end(l, v_ed.settings),
                 'speaker', coalesce((select string_agg(app.speaker_label(s), ' · ' order by (x.role <> 'lead'), x.speaker_id)
                                        from public.lesson_speakers x join public.speakers s on s.id = x.speaker_id
                                       where x.lesson_id = l.id), ''),
                 'title', l.title,
                 'category', coalesce(c.name, ''),
                 'room', rm.name,
                 'parallel', l.kind = 'lesson' and exists (
                   select 1 from public.lessons o
                    where o.edition_id = l.edition_id and o.id <> l.id and o.kind = 'lesson' and o.state = 'closed'
                      and o.day = l.day and o.start_min < l.end_min and l.start_min < o.end_min))
               order by l.day, l.start_min, rm.sort, l.id)
          from public.lessons l
          join public.rooms rm on rm.id = l.room_id
          left join public.categories c on c.id = l.category_id
         where l.edition_id = v.edition_id and l.state <> 'cancelled' and (l.kind = 'memorial' or l.state = 'closed')), '[]'::jsonb));
  end
  $$;

-- ------------------------------------------------------------- the links, for the edition's admins

-- Issue a link — and so replace one: the live link of the same edition, scope
-- and subject is revoked in the same transaction. Returns the token ONCE
-- (base64url, 128 random bits); only its sha256 is kept. An escort's link names
-- a trainee of the edition (`bad_escort`); the others name nobody. A link that
-- would already be expired (the week is over, the window closed) → `link_past`.
create or replace function public.issue_link(p_edition bigint, p_scope text, p_subject bigint default null) returns jsonb
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_ed    public.editions;
    v_token text;
    v_exp   timestamptz;
    v_id    bigint;
  begin
    perform app.require_edition_admin(p_edition);
    select * into v_ed from public.editions where id = p_edition for update;   -- two admins at once queue up
    if v_ed.kind = 'archive' or v_ed.status = 'archived' then perform app.refuse('archived'); end if;
    if p_scope is null or p_scope not in ('escort', 'kk_signup', 'schedule') then perform app.refuse('bad_value'); end if;
    if p_scope = 'escort' then
      if p_subject is null or not exists (select 1 from public.roster where id = p_subject and edition_id = p_edition) then perform app.refuse('bad_escort'); end if;
    elsif p_subject is not null then
      perform app.refuse('bad_value');
    end if;
    v_exp := app.link_expiry(p_edition, p_scope, now());
    if v_exp <= now() then perform app.refuse('link_past'); end if;
    update public.share_links set revoked_at = now()
     where edition_id = p_edition and scope = p_scope and subject_id is not distinct from p_subject and revoked_at is null;
    v_token := translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_');
    insert into public.share_links (edition_id, scope, subject_id, token_hash, created_by, expires_at)
    values (p_edition, p_scope, p_subject, extensions.digest(v_token, 'sha256'), app.my_member_id(p_edition), v_exp)
    returning id into v_id;
    return jsonb_build_object('link_id', v_id, 'token', v_token, 'expires_at', app.iso(v_exp));
  end
  $$;

create or replace function public.revoke_link(p_link bigint) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare v public.share_links;
  begin
    select * into v from public.share_links where id = p_link for update;
    if v.id is null then perform app.refuse('stale'); end if;
    perform app.require_edition_admin(v.edition_id);
    if v.revoked_at is null then update public.share_links set revoked_at = now() where id = v.id; end if;
  end
  $$;

-- ------------------------------------------------------------- מכריכה לכריכה, for the edition's admins

-- Everything the «מכריכה לכריכה» screen needs, in one round trip, as the
-- caller's RLS allows (invoker). The window is in the edition's settings.
create or replace function public.load_kk(p_edition bigint) returns jsonb
  language sql stable security invoker set search_path = ''
  as $$
    select jsonb_build_object(
      'tracks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'day', t.day, 'start_min', t.start_min, 'end_min', t.end_min) order by t.day, t.start_min)
                            from public.kk_tracks t where t.edition_id = p_edition), '[]'::jsonb),
      'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'track_id', g.track_id, 'title', g.title, 'author', g.author,
                                                              'room_id', g.room_id, 'capacity', g.capacity, 'open', g.open) order by g.id)
                            from public.kk_groups g where g.edition_id = p_edition), '[]'::jsonb),
      'leaders', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'group_id', k.group_id, 'kind', k.kind, 'roster_id', k.roster_id, 'label', k.label)
                                            order by k.group_id, k.sort, k.id)
                             from public.kk_leaders k join public.kk_groups g on g.id = k.group_id where g.edition_id = p_edition), '[]'::jsonb),
      'signups', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'track_id', s.track_id, 'group_id', s.group_id, 'roster_id', s.roster_id,
                                                               'via', s.via, 'created_at', to_char(s.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by s.id)
                             from public.kk_signups s where s.edition_id = p_edition), '[]'::jsonb),
      'orders', coalesce((select jsonb_agg(jsonb_build_object('group_id', o.group_id, 'copies', o.copies, 'ordered_at', to_char(o.ordered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by o.group_id)
                            from public.book_orders o join public.kk_groups g on g.id = o.group_id where g.edition_id = p_edition), '[]'::jsonb)
    )
    where app.can_see_edition(p_edition)
  $$;

-- A group on a kk occurrence of the grid (a kk row active that day,
-- `outside_grid` otherwise); its track is made on first use.
create or replace function public.kk_add_group(p_edition bigint, p_day integer, p_start integer, p_fields jsonb) returns bigint
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_end   integer;
    v_f     jsonb;
    v_track bigint;
    v_id    bigint;
  begin
    perform app.require_edition_admin(p_edition);
    select r.end_min into v_end from app.kk_rows(p_edition, p_day) r where r.start_min = p_start limit 1;
    if v_end is null then perform app.refuse('outside_grid'); end if;
    v_f := app.kk_clean_group(p_fields, p_edition);
    if not v_f ? 'title' then perform app.refuse('title_required'); end if;
    insert into public.kk_tracks (edition_id, day, start_min, end_min) values (p_edition, p_day, p_start, v_end)
    on conflict (edition_id, day, start_min) do nothing;
    select id into v_track from public.kk_tracks where edition_id = p_edition and day = p_day and start_min = p_start;
    insert into public.kk_groups (edition_id, track_id, title, author, room_id, capacity, open)
    values (p_edition, v_track, v_f ->> 'title', v_f ->> 'author', (v_f ->> 'room_id')::bigint, (v_f ->> 'capacity')::integer,
            coalesce((v_f ->> 'open')::boolean, true))
    returning id into v_id;
    perform app.kk_write_leaders(v_id, coalesce(v_f -> 'leaders', '[]'::jsonb));
    return v_id;
  end
  $$;

-- The keys present in the patch, as kk_add_group cleans them.
create or replace function public.kk_update_group(p_group bigint, p_patch jsonb) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_g public.kk_groups;
    v_f jsonb;
  begin
    select * into v_g from public.kk_groups where id = p_group for update;
    if v_g.id is null then perform app.refuse('stale'); end if;
    perform app.require_edition_admin(v_g.edition_id);
    v_f := app.kk_clean_group(p_patch, v_g.edition_id);
    update public.kk_groups
       set title    = case when v_f ? 'title' then v_f ->> 'title' else title end,
           author   = case when v_f ? 'author' then v_f ->> 'author' else author end,
           room_id  = case when v_f ? 'room_id' then (v_f ->> 'room_id')::bigint else room_id end,
           capacity = case when v_f ? 'capacity' then (v_f ->> 'capacity')::integer else capacity end,
           open     = case when v_f ? 'open' then (v_f ->> 'open')::boolean else open end
     where id = v_g.id;
    if v_f ? 'leaders' then perform app.kk_write_leaders(v_g.id, v_f -> 'leaders'); end if;
  end
  $$;

-- A group nobody signed up for (else `group_has_signups`: move or remove them
-- first); a track left without groups goes with it.
create or replace function public.kk_delete_group(p_group bigint) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare v_g public.kk_groups;
  begin
    select * into v_g from public.kk_groups where id = p_group for update;
    if v_g.id is null then perform app.refuse('stale'); end if;
    perform app.require_edition_admin(v_g.edition_id);
    if exists (select 1 from public.kk_signups where group_id = v_g.id) then perform app.refuse('group_has_signups'); end if;
    delete from public.kk_groups where id = v_g.id;
    delete from public.kk_tracks t where t.id = v_g.track_id and not exists (select 1 from public.kk_groups g where g.track_id = t.id);
  end
  $$;

-- The staff put a trainee in a group — a new sign-up, or a move within the
-- track. Not bound by the capacity or the window: the staff decide.
create or replace function public.kk_place(p_group bigint, p_roster bigint) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_g public.kk_groups;
    v_s public.kk_signups;
  begin
    select * into v_g from public.kk_groups where id = p_group for update;
    if v_g.id is null then perform app.refuse('stale'); end if;
    perform app.require_edition_admin(v_g.edition_id);
    if p_roster is null or not exists (select 1 from public.roster where id = p_roster and edition_id = v_g.edition_id) then
      perform app.refuse('bad_trainee');
    end if;
    select * into v_s from public.kk_signups where track_id = v_g.track_id and roster_id = p_roster for update;
    if v_s.id is null then
      insert into public.kk_signups (edition_id, track_id, group_id, roster_id, via) values (v_g.edition_id, v_g.track_id, v_g.id, p_roster, 'staff');
    elsif v_s.group_id <> v_g.id then
      update public.kk_signups set group_id = v_g.id, via = 'staff' where id = v_s.id;
    end if;
  end
  $$;

-- The staff take a trainee's sign-up for a track away.
create or replace function public.kk_unplace(p_track bigint, p_roster bigint) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare v_ed bigint;
  begin
    select edition_id into v_ed from public.kk_tracks where id = p_track;
    if v_ed is null then perform app.refuse('stale'); end if;
    perform app.require_edition_admin(v_ed);
    delete from public.kk_signups where track_id = p_track and roster_id = p_roster;
  end
  $$;

-- The sign-up window: both bounds (opens before it closes), or neither (closed).
-- In editions.settings.kk_window, as JavaScript writes instants; the sign-up
-- link's expiry follows it (app.editions_link_expiry).
create or replace function public.kk_set_window(p_edition bigint, p_opens timestamptz, p_closes timestamptz) returns void
  language plpgsql security definer set search_path = ''
  as $$
  begin
    perform app.require_edition_admin(p_edition);
    if (p_opens is null) <> (p_closes is null) or p_opens >= p_closes then perform app.refuse('bad_value'); end if;
    update public.editions
       set settings = case when p_opens is null then settings - 'kk_window'
                           else settings || jsonb_build_object('kk_window', jsonb_build_object('opens_at', app.iso(p_opens), 'closes_at', app.iso(p_closes))) end
     where id = p_edition;
  end
  $$;

-- How many copies of a group's book to order (0–1000; null removes the line),
-- and whether they were ordered (the first time kept). Logistics or an admin.
create or replace function public.set_book_order(p_group bigint, p_copies integer, p_ordered boolean) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare v_g public.kk_groups;
  begin
    select * into v_g from public.kk_groups where id = p_group;
    if v_g.id is null then perform app.refuse('stale'); end if;
    perform app.require_logistics(v_g.edition_id);
    if p_ordered is null or (p_copies is null and p_ordered) or p_copies not between 0 and 1000 then perform app.refuse('bad_value'); end if;
    if p_copies is null then
      delete from public.book_orders where group_id = v_g.id;
      return;
    end if;
    insert into public.book_orders as o (group_id, copies, ordered_at) values (v_g.id, p_copies, case when p_ordered then now() end)
    on conflict (group_id) do update
      set copies = excluded.copies,
          ordered_at = case when p_ordered then coalesce(o.ordered_at, now()) end;
  end
  $$;

-- ------------------------------------------------------------- reads

-- =============================================================================
-- Milestone 5ב-1 (v10) — the sources' files and the reader. Semantics:
-- docs/CONTRACT.md «Sources and the reader»; the in-memory twin is
-- src/data/engine.ts (DemoPort's uploads), held to this by tests/parity.
--
-- The files live in Supabase Storage, in a PRIVATE bucket «sources» created
-- below, at <edition>/<lesson>/<uuid>-<safe ascii name> (the poster: at
-- <edition>/cover/<uuid>-<name>) — never the original name, which may be
-- Hebrew; that is kept in source_files.display_name. The browser uploads
-- straight to Storage (the policies on storage.objects decide), then
-- registers the file (register_source_file), which checks the same rule and
-- that the object is there, is the caller's, and is a type and size we take.
-- Removing is the other way round: the stored object first (the Storage API),
-- then remove_source_file, which refuses while the object is still there — so
-- a failure half-way leaves a row whose file is gone (visible, removed again
-- with one tap), never an object nobody can see.
--
-- Who (one function each, app.source_refusal / may_*_source, for both the
-- policies and the functions):
--   upload   the edition's content members and admins (logistics never; an
--            archive is its admins' only), to a CLOSED lesson — the rule of
--            set_sources — or (v11) a memorial slot with a plan placed on it;
--            the poster: the edition's admins; and
--            never at a path a source_files row holds (a path is used once)
--   read     the edition's whole team: content, admins, and logistics (they print)
--   delete   whoever uploaded it, or an admin of the edition
--   update   nobody (a replacement is a delete and an upload); anon: nothing
-- Restrictive policies cap the bucket at exactly that, whatever permissive
-- policy someone adds to storage.objects later (a dashboard template).
--
-- source_files is never published to Realtime (the list at the end). The
-- merged reader is built and downloaded in the browser and never uploaded.
-- reopen_lesson keeps a lesson's files: they belonged to the speaker who
-- leaves, so each row remembers the lead speaker it arrived for (speaker_id);
-- a file whose speaker is no longer the lesson's lead is «מהמרצה הקודם» —
-- shown for removal, never put in the reader. A lesson deleted (a draft
-- reshaped away) leaves its files' rows with lesson_id NULL, for removal too.
-- =============================================================================

-- ------------------------------------------------------------- the bucket and its policies

-- The path convention, in one place (src/data/sourceRules.ts holds the same):
-- edition id / lesson id or 'cover' / a uuid, a dash, a safe ASCII name and
-- one of the accepted extensions.
create or replace function app.source_path_re() returns text
  language sql immutable set search_path = ''
  as $$ select '^([1-9][0-9]{0,17})/([1-9][0-9]{0,17}|cover)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9][A-Za-z0-9_-]{0,59}\.(pdf|png|jpg|jpeg|docx)$' $$;

-- The types the bucket takes (allowed_mime_types below) and the extension each must carry.
create or replace function app.source_mime_ok(p_mime text, p_ext text) returns boolean
  language sql immutable set search_path = ''
  as $$
    select case p_mime
      when 'application/pdf' then p_ext = 'pdf'
      when 'image/png' then p_ext = 'png'
      when 'image/jpeg' then p_ext in ('jpg', 'jpeg')
      when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then p_ext = 'docx'
      else false
    end
  $$;

-- Why the caller may not upload to this path — NULL when they may. The rule
-- of set_sources (app.require_editor on a closed lesson): content or admin of
-- the path's edition, an archive for its admins only; a lesson of that
-- edition, closed — or a memorial slot with a plan placed on it, its materials
-- for the reader (v11; else `no_plan`); the poster (…/cover/…, never a Word
-- file) for the edition's admins.
create or replace function app.source_refusal(p_name text) returns text
  language plpgsql stable security definer set search_path = ''
  as $$
  declare
    m      text[] := regexp_match(p_name, app.source_path_re());
    v_ed   public.editions;
    v_role text;
    v_l    public.lessons;
  begin
    if m is null then return 'bad_path'; end if;
    select * into v_ed from public.editions where id = m[1]::bigint;
    v_role := case when v_ed.id is null then null else app.my_role(v_ed.id) end;
    if v_role is null then return 'not_member'; end if;
    if v_role = 'logistics' then return 'forbidden'; end if;
    if (v_ed.kind = 'archive' or v_ed.status = 'archived') and v_role <> 'admin' then return 'archived'; end if;
    if m[2] = 'cover' then
      if v_role <> 'admin' then return 'forbidden'; end if;
      if m[3] = 'docx' then return 'bad_file'; end if;
      return null;
    end if;
    select * into v_l from public.lessons where id = m[2]::bigint;
    if v_l.id is null or v_l.edition_id <> v_ed.id then return 'bad_path'; end if;
    if v_l.kind = 'memorial' then
      if v_l.state = 'cancelled' or not exists (select 1 from public.memorial_plans p where p.lesson_id = v_l.id) then return 'no_plan'; end if;
      return null;
    end if;
    if v_l.state <> 'closed' then return 'not_closed'; end if;
    return null;
  end
  $$;

-- The policies' predicates (they run as the browser's role: granted to authenticated at the end).
-- Upload: the rule above, and a path is used once — never one a source_files
-- row already holds. Its object may be gone (a removal that stopped half way:
-- the row is still there, for the uploader to remove), and the path is in the
-- whole team's load_week; a new upload there would put someone else's bytes,
-- of any type the bucket takes, behind that row's name, uploader and type.
-- A real upload always has a new uuid in its path, so nothing legitimate is
-- refused. (register_source_file's retry, the same path again, does not
-- upload: it answers the row it made.)
create or replace function app.may_upload_source(p_name text) returns boolean
  language plpgsql stable security definer set search_path = ''
  as $$
  begin
    return app.source_refusal(p_name) is null
       and not exists (select 1 from public.source_files f where f.storage_path = p_name);
  end
  $$;

create or replace function app.may_read_source(p_name text) returns boolean
  language plpgsql stable security definer set search_path = ''
  as $$
  declare m text[] := regexp_match(p_name, app.source_path_re());
  begin
    if m is null or not exists (select 1 from public.editions where id = m[1]::bigint) then return false; end if;
    return app.my_role(m[1]::bigint) is not null;
  end
  $$;

-- Delete: an admin of the edition; else a member of it (an archive: admins
-- only) who uploaded it — by the registered row when there is one
-- (uploaded_by), by the object's owner (the Storage API writes the JWT's sub)
-- for an object never registered (an upload whose registration failed).
create or replace function app.may_delete_source(p_name text, p_owner_id text) returns boolean
  language plpgsql stable security definer set search_path = ''
  as $$
  declare
    m      text[] := regexp_match(p_name, app.source_path_re());
    v_ed   public.editions;
    v_role text;
    v_by   bigint;
  begin
    if m is null then return false; end if;
    select * into v_ed from public.editions where id = m[1]::bigint;
    if v_ed.id is null then return false; end if;
    v_role := app.my_role(v_ed.id);
    if v_role is null then return false; end if;
    if v_role = 'admin' then return true; end if;
    if v_ed.kind = 'archive' or v_ed.status = 'archived' then return false; end if;
    select f.uploaded_by into v_by from public.source_files f where f.storage_path = p_name;
    if found then return v_by is not distinct from app.my_member_id(v_ed.id) and v_by is not null; end if;
    return p_owner_id is not null and p_owner_id = auth.jwt() ->> 'sub';
  end
  $$;

-- The live object at a path in the bucket — its metadata and owner — or NULL.
-- Read through to_jsonb, so a storage schema from before object versioning
-- (no archived_at / is_delete_marker) reads the same.
create or replace function app.source_object(p_name text) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
  begin
    return (select jsonb_build_object('metadata', j -> 'metadata', 'owner_id', j ->> 'owner_id')
              from (select to_jsonb(o) as j from storage.objects o where o.bucket_id = 'sources' and o.name = p_name) x
             where (j ->> 'archived_at') is null and coalesce((j ->> 'is_delete_marker')::boolean, false) = false
             limit 1);
  end
  $$;

-- Two blocks, each with its own handler: a failure in one rolls back that
-- block alone, so the bucket goes private even when the policies cannot be
-- (re)created, and the policies are kept up to date even when the bucket
-- cannot be written. Each warning says it all — the owner sends it to Claude.
do $$
begin
  -- Private, 25 MB, the four types. A re-run never rewrites the size or the
  -- types (the owner may have changed them in the dashboard) — but it always
  -- makes the bucket private again: a public bucket would hand any file to
  -- whoever guesses its address, policies or not.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('sources', 'sources', false, 26214400,
          array['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
  on conflict (id) do nothing;
  update storage.buckets set public = false where id = 'sources' and public is distinct from false;
  if found then
    raise warning 'the «sources» bucket was public — it is private again (a public bucket lets anyone with a file''s address read the file); nothing more to do, but if you did not expect it, send this whole message to Claude';
  end if;
exception
  when insufficient_privilege or undefined_table or invalid_schema_name then
    raise warning 'the «sources» bucket could not be created or made private (%) — it is as it was before this run: if Storage shows it as Public, anyone with a file''s address can read the file; send this whole message to Claude (docs/SETUP.he.md, גרסה 10)', sqlerrm;
end $$;

do $$
begin
  drop policy if exists sources_read on storage.objects;
  create policy sources_read on storage.objects for select to authenticated
    using (bucket_id = 'sources' and app.may_read_source(name));
  drop policy if exists sources_upload on storage.objects;
  create policy sources_upload on storage.objects for insert to authenticated
    with check (bucket_id = 'sources' and app.may_upload_source(name));
  drop policy if exists sources_delete on storage.objects;
  create policy sources_delete on storage.objects for delete to authenticated
    using (bucket_id = 'sources' and app.may_delete_source(name, owner_id));
  -- The ceiling: restrictive policies AND with every permissive one, so no
  -- other policy on storage.objects can widen what this bucket allows.
  drop policy if exists sources_cap_read on storage.objects;
  create policy sources_cap_read on storage.objects as restrictive for select to authenticated
    using (bucket_id is distinct from 'sources' or app.may_read_source(name));
  drop policy if exists sources_cap_upload on storage.objects;
  create policy sources_cap_upload on storage.objects as restrictive for insert to authenticated
    with check (bucket_id is distinct from 'sources' or app.may_upload_source(name));
  drop policy if exists sources_cap_update on storage.objects;
  create policy sources_cap_update on storage.objects as restrictive for update to authenticated
    using (bucket_id is distinct from 'sources') with check (bucket_id is distinct from 'sources');
  drop policy if exists sources_cap_delete on storage.objects;
  create policy sources_cap_delete on storage.objects as restrictive for delete to authenticated
    using (bucket_id is distinct from 'sources' or app.may_delete_source(name, owner_id));
  drop policy if exists sources_cap_anon on storage.objects;
  create policy sources_cap_anon on storage.objects as restrictive for all to anon
    using (bucket_id is distinct from 'sources') with check (bucket_id is distinct from 'sources');
exception
  when insufficient_privilege or undefined_table or invalid_schema_name then
    -- The block rolls back whole: the policies as they were before this run
    -- (on a first run none — nothing is allowed, uploads stay closed); the
    -- rest of the file applies.
    raise warning 'the «sources» policies could not be (re)created (%) — the previous ones, if any, are unchanged (on a first run there are none, and uploads stay closed); send this whole message to Claude (docs/SETUP.he.md, גרסה 10)', sqlerrm;
end $$;

-- ------------------------------------------------------------- source_files

create table if not exists public.source_files (
  id           bigint generated always as identity primary key,
  edition_id   bigint not null references public.editions (id) on delete cascade,
  lesson_id    bigint references public.lessons (id) on delete set null,   -- NULL: the poster, or a lesson deleted since
  cover        boolean not null default false,                             -- the reader's poster (…/cover/…)
  speaker_id   bigint references public.speakers (id) on delete set null,  -- the lesson's lead speaker when it arrived
  storage_path text not null unique,
  display_name text not null,
  mime         text not null check (mime in ('application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  size_bytes   bigint not null check (size_bytes between 0 and 26214400),
  page_count   integer check (page_count between 1 and 5000),             -- read in the browser: a PDF's pages, an image 1; NULL: not readable (or Word)
  uploaded_by  bigint references public.members (id) on delete set null,
  uploaded_at  timestamptz not null default now()
);
create index if not exists source_files_lesson on public.source_files (lesson_id);
create index if not exists source_files_edition on public.source_files (edition_id);

alter table public.source_files enable row level security;
drop policy if exists source_files_read on public.source_files;
create policy source_files_read on public.source_files for select to authenticated
  using (app.my_role(source_files.edition_id) is not null);

-- Register an uploaded file. p_lesson NULL = the poster. The path must be the
-- convention for exactly this edition and lesson (bad_path), the caller may
-- upload there (app.source_refusal), and the object must be in the bucket,
-- uploaded by the caller (no_file), of an accepted type matching its
-- extension and at most 25 MB (bad_file) — from objects.metadata: the size as
-- Storage measured it, the type as the uploader declared it (Content-Type,
-- held by Storage to the bucket's four types; it never sniffs the bytes — the
-- reader checks those). The same path again returns the row it already made,
-- checked before the rest (a retry — the browser lost the first answer — is
-- answered even if the lesson was reopened since; app.may_upload_source
-- refuses a new upload at a registered path).
-- A lesson's file: «טרם התקבלו» becomes «דף מקורות» (a file arrived), and the
-- current speaker's first file puts the lesson in the reader when its kind
-- has something to print (in_reader's own rule — never a presentation alone).
-- The poster: the first one the browser could read (page_count set — the
-- build never fetches a file without one) becomes the cover (settings.reader_cover).
-- A memorial slot's file (v11) remembers the fallen of the plan placed on it
-- (fallen_id; no speaker), and leaves the slot's sources columns alone: a
-- memorial slot is always in the reader.
create or replace function public.register_source_file(p_edition bigint, p_lesson bigint, p_path text, p_display_name text, p_pages integer)
  returns jsonb
  language plpgsql security definer set search_path = ''
  as $$
  declare
    m        text[] := regexp_match(p_path, app.source_path_re());
    v_code   text;
    v_l      public.lessons;
    v_me     bigint;
    v_obj    jsonb;
    v_mime   text;
    v_size   bigint;
    v_name   text;
    v_pages  integer;
    v_spk    bigint;
    v_fallen bigint;
    v_first  boolean;
    v_kind   text;
    v_in     boolean;
    v_row    public.source_files;
  begin
    if app.my_role(p_edition) is null or not exists (select 1 from public.editions where id = p_edition) then perform app.refuse('not_member'); end if;
    if m is null or m[1] <> p_edition::text or m[2] <> coalesce(p_lesson::text, 'cover') then perform app.refuse('bad_path'); end if;
    -- The lesson's row lock before any check: one registration at a time per lesson (its first file), and a
    -- reopen_lesson that commits while this waits is seen by every statement after it (each takes a fresh
    -- snapshot) — a draft refuses (not_closed), never a file and the stages set on the draft reopen just emptied.
    if p_lesson is not null then
      select * into v_l from public.lessons where id = p_lesson and edition_id = p_edition for update;
    end if;
    -- A retry (the browser lost the first answer) answers the row that call made, whatever changed since.
    select * into v_row from public.source_files where storage_path = p_path;
    if v_row.id is not null then
      if v_row.edition_id <> p_edition or v_row.lesson_id is distinct from p_lesson then perform app.refuse('bad_path'); end if;
      return to_jsonb(v_row);
    end if;
    v_code := app.source_refusal(p_path);
    if v_code is not null then perform app.refuse(v_code); end if;
    v_me := app.my_member_id(p_edition);
    v_obj := app.source_object(p_path);
    if v_obj is null or (v_obj ->> 'owner_id') is distinct from (auth.jwt() ->> 'sub') then perform app.refuse('no_file'); end if;
    v_mime := v_obj -> 'metadata' ->> 'mimetype';
    v_size := case when (v_obj -> 'metadata' ->> 'size') ~ '^[0-9]{1,12}$' then (v_obj -> 'metadata' ->> 'size')::bigint end;
    if v_mime is null or not app.source_mime_ok(v_mime, m[3]) or v_size is null or v_size > 26214400 then perform app.refuse('bad_file'); end if;
    v_name := app.clean_line(p_display_name, 200);
    if v_name is null then perform app.refuse('bad_value'); end if;
    if p_pages is not null and (p_pages < 1 or p_pages > 5000) then perform app.refuse('bad_value'); end if;
    -- what the browser read of it as the reader would: a PDF's pages, a picture 1; NULL — it could not (the reader leaves it out)
    v_pages := case when v_mime = 'application/pdf' then p_pages when v_mime like 'image/%' and p_pages is not null then 1 end;
    if p_lesson is not null and v_l.kind = 'memorial' then
      select p.fallen_id into v_fallen from public.memorial_plans p where p.lesson_id = p_lesson;
    elsif p_lesson is not null then
      select x.speaker_id into v_spk from public.lesson_speakers x where x.lesson_id = p_lesson and x.role = 'lead';
      v_first := not exists (select 1 from public.source_files f where f.lesson_id = p_lesson and f.speaker_id is not distinct from v_spk);
    end if;
    insert into public.source_files (edition_id, lesson_id, cover, speaker_id, fallen_id, storage_path, display_name, mime, size_bytes, page_count, uploaded_by)
    values (p_edition, p_lesson, p_lesson is null, v_spk, v_fallen, p_path, v_name, v_mime, v_size, v_pages, v_me)
    returning * into v_row;
    if p_lesson is not null and v_l.kind = 'memorial' then
      null;   -- a memorial slot is always in the reader: nothing of the lesson changes
    elsif p_lesson is not null then
      v_kind := case when v_l.sources_kind = 'pending' then 'sheet' else v_l.sources_kind end;
      v_in := v_l.in_reader or (v_first and v_kind not in ('pending', 'none', 'presentation'));
      if (v_kind, v_in) is distinct from (v_l.sources_kind, v_l.in_reader) then
        update public.lessons set sources_kind = v_kind, in_reader = v_in, version = version + 1, updated_by = v_me where id = p_lesson;
      end if;
    elsif v_pages is not null and not ((select settings from public.editions where id = p_edition) ? 'reader_cover') then
      update public.editions set settings = settings || jsonb_build_object('reader_cover', v_row.id) where id = p_edition;
    end if;
    return to_jsonb(v_row);
  end
  $$;

-- Forget a file whose stored object is gone. The uploader, or an admin of the
-- edition (an archive: its admins); refused while the object is still in the
-- bucket (file_present — the browser deletes it through the Storage API
-- first, under the same rule). A row already gone: nothing to do. The poster
-- marked as cover stops being it.
create or replace function public.remove_source_file(p_file bigint) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_f    public.source_files;
    v_ed   public.editions;
    v_role text;
  begin
    select * into v_f from public.source_files where id = p_file for update;
    if v_f.id is null then return; end if;
    select * into v_ed from public.editions where id = v_f.edition_id;
    v_role := app.my_role(v_f.edition_id);
    if v_role is null then perform app.refuse('not_member'); end if;
    if (v_ed.kind = 'archive' or v_ed.status = 'archived') and v_role <> 'admin' then perform app.refuse('archived'); end if;
    if v_role <> 'admin' and (v_f.uploaded_by is null or v_f.uploaded_by <> app.my_member_id(v_f.edition_id)) then perform app.refuse('not_uploader'); end if;
    if app.source_object(v_f.storage_path) is not null then perform app.refuse('file_present'); end if;
    delete from public.source_files where id = v_f.id;
    update public.editions set settings = settings - 'reader_cover'
     where id = v_f.edition_id and settings ->> 'reader_cover' = v_f.id::text;
  end
  $$;

-- The reader's two running headers, [left, right] — the instructor's own words
-- (last year's are an example in the screen's help, never seeded). One line
-- each, ≤ 120; both empty removes them. An admin of the edition.
create or replace function public.set_reader_headers(p_edition bigint, p_left text, p_right text) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_left  text := app.clean_line(p_left, 120);
    v_right text := app.clean_line(p_right, 120);
  begin
    perform app.require_edition_admin(p_edition);
    update public.editions
       set settings = case when v_left is null and v_right is null then settings - 'reader_headers'
                           else settings || jsonb_build_object('reader_headers', jsonb_build_array(coalesce(v_left, ''), coalesce(v_right, ''))) end
     where id = p_edition;
  end
  $$;

-- The reader's cover: one of the edition's posters (a PDF or an image
-- uploaded as …/cover/…) that the browser could read (page_count — the build
-- never fetches one it could not), or NULL — then the reader opens with a
-- schedule page made from the week. An admin of the edition.
create or replace function public.set_reader_cover(p_edition bigint, p_file bigint) returns void
  language plpgsql security definer set search_path = ''
  as $$
  begin
    perform app.require_edition_admin(p_edition);
    if p_file is not null and not exists (
         select 1 from public.source_files f
          where f.id = p_file and f.edition_id = p_edition and f.cover and f.page_count is not null
            and f.mime <> 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') then
      perform app.refuse('bad_value');
    end if;
    update public.editions
       set settings = case when p_file is null then settings - 'reader_cover' else settings || jsonb_build_object('reader_cover', p_file) end
     where id = p_edition;
  end
  $$;

-- =============================================================================
-- Milestone 5ב-2 (v11) — memorial times, and the logistics screen's one read.
-- Semantics: docs/CONTRACT.md «Memorial times and logistics»; the in-memory
-- twin is src/data/engine.ts, held to this by tests/parity.
--
--   fallen            the fallen the week remembers — one cross-year list (DESIGN
--                     «נשארים בין שנים»): a name, gender, a note, active. Names
--                     are entered in the app only, never in git. A global admin
--                     writes (save_fallen, delete_fallen); read by any admin
--                     (to plan) and by the team of an edition that has a plan
--                     for one (app.may_see_fallen).
--   fallen_contacts   the family's contact person — personal data of a bereaved
--                     family: ADMINS ONLY — a global admin, or an admin of a real,
--                     non-archived edition with a plan for that fallen
--                     (app.may_see_fallen_contacts). Read one fallen at a time
--                     (get_fallen_contacts, invoker, under the policy) — never in
--                     load_week, never in Realtime, never through a link.
--   memorial_plans    one per fallen per edition: the family's status, who
--                     speaks, the planned minutes, a hard stop, the reader's
--                     materials note — and the memorial slot it is PLACED on
--                     (lesson_id, one plan per slot). The edition's admins write
--                     (functions, a version each); its whole team reads it, in
--                     load_week (never a contact).
--   memorial slots    lessons of kind 'memorial', made by an admin inside a
--                     memorial row of the grid (add_memorial_slot). A slot is
--                     never moved by drag (memorial_slot) nor swallowed by a
--                     merge (merge_blocked).
--   the liaison       («בזמני זיכרון, המלווה הוא איש הקשר של המשפחה»): the slot's
--                     escort (lessons.escort_roster_id), set by an admin with
--                     set_escort once a plan is placed; it goes with the plan
--                     when the plan moves, and leaves with it. The escort's link
--                     shows the slot as before — never a family's contact.
--   materials         uploads to a slot with a plan (app.source_refusal), each
--                     file remembering the fallen it came for
--                     (source_files.fallen_id): the reader takes a plan's files
--                     wherever it is placed.
--   settings.memorial the staff meeting's policy {placement, max_minutes,
--                     warn_adjacent_meal} — never seeded (set_memorial_policy).
--   get_transports_for  the logistics screen's transports in one invoker call —
--                     never more than get_transport_details shows, one lesson at
--                     a time.
-- None of the three tables is ever published to Realtime.
-- =============================================================================

-- ------------------------------------------------------------- tables

create table if not exists public.fallen (
  id         bigint generated always as identity primary key,
  name       text not null check (btrim(name) <> '' and char_length(name) <= 120),
  gender     text check (gender in ('m', 'f')),
  note       text check (char_length(note) <= 500),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.fallen enable row level security;

create table if not exists public.fallen_contacts (
  fallen_id    bigint primary key references public.fallen (id) on delete cascade,
  contact_name text,
  relation     text,
  phone        text,
  email        text,
  note         text
);
alter table public.fallen_contacts enable row level security;

create table if not exists public.memorial_plans (
  id              bigint generated always as identity primary key,
  edition_id      bigint not null references public.editions (id) on delete cascade,
  fallen_id       bigint not null references public.fallen (id),   -- a fallen with plans is kept (deactivated), never deleted
  lesson_id       bigint unique references public.lessons (id) on delete set null,   -- the memorial slot it is placed on
  family_status   text not null default 'not_contacted'
                  check (family_status in ('not_contacted', 'invited', 'confirmed', 'cannot_come', 'other_speaker')),
  speaker_text    text check (char_length(speaker_text) <= 200),
  planned_minutes integer check (planned_minutes between 1 and 180),
  hard_stop       boolean not null default false,
  materials_note  text check (char_length(materials_note) <= 500),
  version         integer not null default 1,
  updated_by      bigint,
  created_at      timestamptz not null default now(),
  unique (edition_id, fallen_id)
);
create index if not exists memorial_plans_fallen on public.memorial_plans (fallen_id);
alter table public.memorial_plans enable row level security;

-- A file on a memorial slot remembers the fallen it came for (as a lesson's
-- file remembers its speaker): the reader takes a plan's files wherever the
-- plan is placed now.
alter table public.source_files add column if not exists fallen_id bigint references public.fallen (id) on delete set null;
create index if not exists source_files_fallen on public.source_files (fallen_id);

-- ------------------------------------------------------------- who sees what

-- A fallen's name: a global admin, any admin (they plan), or the team of an
-- edition that has a plan for them.
create or replace function app.may_see_fallen(p_fallen bigint) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select app.is_global_admin()
        or exists (select 1 from public.members m where m.active and m.role = 'admin' and m.email = app.my_email())
        or exists (select 1 from public.memorial_plans p where p.fallen_id = p_fallen and app.can_see_edition(p.edition_id))
  $$;

-- The real, non-archived edition with a plan for this fallen in which I am an
-- admin, if any — the newest (the twin of app.contacts_edition). A change to
-- the family's contact is logged there, as the caller's member row of it.
create or replace function app.fallen_contacts_edition(p_fallen bigint) returns bigint
  language sql stable security definer set search_path = ''
  as $$
    select p.edition_id from public.memorial_plans p join public.editions e on e.id = p.edition_id
     where p.fallen_id = p_fallen and e.kind = 'real' and e.status <> 'archived' and app.my_role(p.edition_id) = 'admin'
     order by p.edition_id desc
     limit 1
  $$;

-- The family's contact person: admins only — a global admin, or an admin of a
-- real edition that is not archived and has a plan for this fallen (the rule
-- of app.may_see_contacts: a practice or demo week, or last year, gives no
-- access). public/privacy.html says exactly this.
create or replace function app.may_see_fallen_contacts(p_fallen bigint) returns boolean
  language sql stable security definer set search_path = ''
  as $$ select app.is_global_admin() or app.fallen_contacts_edition(p_fallen) is not null $$;

drop policy if exists fallen_read on public.fallen;
create policy fallen_read on public.fallen for select to authenticated using (app.may_see_fallen(fallen.id));
drop policy if exists fallen_contacts_read on public.fallen_contacts;
create policy fallen_contacts_read on public.fallen_contacts for select to authenticated using (app.may_see_fallen_contacts(fallen_contacts.fallen_id));
drop policy if exists memorial_plans_read on public.memorial_plans;
create policy memorial_plans_read on public.memorial_plans for select to authenticated using (app.can_see_edition(edition_id));

-- ------------------------------------------------------------- helpers

-- The memorial rows of a day, as the edition's window allows them (rowActive, like app.lesson_rows).
create or replace function app.memorial_rows(p_edition bigint, p_day integer)
  returns setof public.grid_rows
  language sql stable security definer set search_path = ''
  as $$
    select r.* from public.grid_rows r join public.editions e on e.id = r.edition_id
     where r.edition_id = p_edition and r.kind = 'memorial' and p_day = any (r.days)
       and not (p_day = 0 and e.first_day_from is not null and r.end_min <= e.first_day_from)
       and not (p_day = 4 and r.start_min >= e.last_day_until)
     order by r.start_min, r.end_min
  $$;

-- A plan the command is about, locked, and its edition's admin asking.
create or replace function app.memorial_plan(p_plan bigint) returns public.memorial_plans
  language plpgsql security definer set search_path = ''
  as $$
  declare v public.memorial_plans;
  begin
    select * into v from public.memorial_plans where id = p_plan for update;
    if v.id is null then perform app.refuse('stale'); end if;
    perform app.require_edition_admin(v.edition_id);
    return v;
  end
  $$;

-- ------------------------------------------------------------- reads

-- The family's contact person, through the policy (invoker): NULL when it is
-- not the caller's to see; no row yet → five nulls.
create or replace function public.get_fallen_contacts(p_fallen bigint) returns jsonb
  language sql stable security invoker set search_path = ''
  as $$
    select case when app.may_see_fallen_contacts(p_fallen) then
      coalesce((select jsonb_build_object('contact_name', c.contact_name, 'relation', c.relation, 'phone', c.phone, 'email', c.email, 'note', c.note)
                  from public.fallen_contacts c where c.fallen_id = p_fallen),
               '{"contact_name": null, "relation": null, "phone": null, "email": null, "note": null}'::jsonb)
    end
  $$;

-- «הסעות» in the logistics screen: the edition's closed lessons whose transport
-- was asked and approved, each with its details exactly as get_transport_details
-- would show them — invoker: lessons and transport_details are read through
-- their policies, and every lesson also passes app.may_see_transport, the very
-- predicate of get_transport_details. A lesson the caller may not see the
-- details of is not in the list at all. Never in a Week, never in Realtime.
create or replace function public.get_transports_for(p_edition bigint) returns jsonb
  language sql stable security invoker set search_path = ''
  as $$
    select coalesce(jsonb_agg(jsonb_build_object(
             'lesson_id', l.id, 'pickup_address', t.pickup_address, 'pickup_time', t.pickup_time,
             'driver_name', t.driver_name, 'driver_phone', t.driver_phone, 'arranged', coalesce(t.arranged, false))
             order by l.id), '[]'::jsonb)
      from public.lessons l
      left join public.transport_details t on t.lesson_id = l.id
     where l.edition_id = p_edition and l.state = 'closed' and l.transport <> 'none' and l.approval = 'approved'
       and app.may_see_transport(l.id)
  $$;

-- ------------------------------------------------------------- the fallen (a global admin)

-- Add (p_fallen NULL) or rewrite one of the fallen: a name (one line ≤ 120,
-- required), a gender (m, f or unknown — never guessed), a note (≤ 500), active.
create or replace function public.save_fallen(p_fallen bigint, p_name text, p_gender text, p_note text, p_active boolean default true)
  returns bigint
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_name   text;
    v_gender text;
    v_note   text;
    v_id     bigint;
  begin
    if not app.is_member() then perform app.refuse('not_member'); end if;
    if not app.is_global_admin() then perform app.refuse('forbidden'); end if;
    v_name := app.clean_line(p_name, 120);
    if v_name is null then perform app.refuse('name_required'); end if;
    v_gender := app.pick_gender(p_gender);
    v_note := app.clean_block(p_note, 500);
    if p_active is null then perform app.refuse('bad_value'); end if;
    if p_fallen is null then
      insert into public.fallen (name, gender, note, active) values (v_name, v_gender, v_note, p_active) returning id into v_id;
      return v_id;
    end if;
    update public.fallen set name = v_name, gender = v_gender, note = v_note, active = p_active where id = p_fallen returning id into v_id;
    if v_id is null then perform app.refuse('stale'); end if;
    return v_id;
  end
  $$;

-- A fallen no edition planned for (a typo, a duplicate); one with plans is
-- deactivated instead (`in_use`). Their family's contact goes with them.
create or replace function public.delete_fallen(p_fallen bigint) returns void
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if not app.is_member() then perform app.refuse('not_member'); end if;
    if not app.is_global_admin() then perform app.refuse('forbidden'); end if;
    perform 1 from public.fallen where id = p_fallen for update;
    if not found then perform app.refuse('stale'); end if;
    if exists (select 1 from public.memorial_plans where fallen_id = p_fallen) then perform app.refuse('in_use'); end if;
    delete from public.fallen where id = p_fallen;
  end
  $$;

-- The family's contact person, for the people app.may_see_fallen_contacts names
-- (the same who read it). All five are replaced; NULL clears one. The log says
-- which fields changed, never to what. The fallen's row is locked (FOR KEY
-- SHARE, the lock the foreign key takes anyway — a rename does not wait) before
-- the check: a delete_fallen on another connection either finishes first, and
-- the check finds no row: `stale`, never a raw foreign-key error; or waits for
-- this write, and then deletes the fallen with their contact.
create or replace function public.set_fallen_contacts(
  p_fallen bigint, p_contact_name text, p_relation text, p_phone text, p_email text, p_note text default null)
  returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_old    public.fallen_contacts;
    v_name   text;
    v_rel    text;
    v_phone  text;
    v_email  text;
    v_note   text;
    v_fields text[];
  begin
    if not app.is_member() then perform app.refuse('not_member'); end if;
    perform 1 from public.fallen where id = p_fallen for key share;
    if not found then perform app.refuse('stale'); end if;
    if not app.may_see_fallen_contacts(p_fallen) then perform app.refuse('contacts_hidden'); end if;
    v_name  := app.clean_line(p_contact_name, 120);
    v_rel   := app.clean_line(p_relation, 60);
    v_phone := app.clean_line(p_phone, 40);
    if v_phone is not null and char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 6 then perform app.refuse('bad_phone'); end if;
    v_email := app.clean_line(p_email, 120);
    if v_email is not null and v_email !~ '^[^ @]+@[^ @]+\.[^ @]+$' then perform app.refuse('bad_contact_email'); end if;
    v_note  := app.clean_block(p_note, 500);

    select * into v_old from public.fallen_contacts where fallen_id = p_fallen for update;
    select coalesce(array_agg(u.f order by u.o), '{}') into v_fields
      from unnest(array[
        case when v_name is distinct from v_old.contact_name then 'contact_name' end,
        case when v_rel is distinct from v_old.relation then 'relation' end,
        case when v_phone is distinct from v_old.phone then 'phone' end,
        case when v_email is distinct from v_old.email then 'email' end,
        case when v_note is distinct from v_old.note then 'note' end]) with ordinality as u(f, o)
     where u.f is not null;
    if cardinality(v_fields) = 0 then return; end if;
    insert into public.fallen_contacts (fallen_id, contact_name, relation, phone, email, note)
    values (p_fallen, v_name, v_rel, v_phone, v_email, v_note)
    on conflict (fallen_id) do update
      set contact_name = excluded.contact_name, relation = excluded.relation, phone = excluded.phone,
          email = excluded.email, note = excluded.note;
    -- in the edition whose plan gives the caller access, as their member row there
    -- (app.my_member_id(NULL) finds only an every-edition row, and activity_read
    -- hides a row with no edition); a global admin with no such plan: no edition
    perform app.log_event(app.fallen_contacts_edition(p_fallen), 'fallen', p_fallen, 'contacts', jsonb_build_object('fields', to_jsonb(v_fields)));
  end
  $$;

-- ------------------------------------------------------------- memorial slots (an edition's admins)

-- A memorial slot inside one of the day's memorial rows (`outside_grid`
-- otherwise), the whole row or a part of it, in a room of the edition (NULL:
-- the default room; the room invariant may refuse: `room_taken`).
create or replace function public.add_memorial_slot(p_edition bigint, p_day integer, p_start integer, p_end integer, p_room bigint default null)
  returns bigint
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_room bigint;
    v_id   bigint;
  begin
    perform app.require_edition_admin(p_edition);
    perform app.check_bounds(p_day, p_start, p_end);
    perform app.lock_day(p_edition, p_day);
    if not exists (select 1 from app.memorial_rows(p_edition, p_day) r where r.start_min <= p_start and p_end <= r.end_min) then
      perform app.refuse('outside_grid');
    end if;
    if p_room is not null and not exists (select 1 from public.rooms where id = p_room and edition_id = p_edition) then
      perform app.refuse('bad_shape');
    end if;
    v_room := coalesce(p_room, app.default_room(p_edition));
    begin
      insert into public.lessons (edition_id, kind, day, start_min, end_min, room_id, updated_by)
      values (p_edition, 'memorial', p_day, p_start, p_end, v_room, app.my_member_id(p_edition))
      returning id into v_id;
    exception when exclusion_violation then
      perform app.refuse('room_taken');
    end;
    return v_id;
  end
  $$;

-- A memorial slot with no plan on it (`memorial_placed`: take the plan off
-- first). Its files' rows stay, for removal (on delete set null).
create or replace function public.remove_memorial_slot(p_lesson bigint) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare v_l public.lessons;
  begin
    select * into v_l from public.lessons where id = p_lesson for update;
    if v_l.id is null or v_l.kind <> 'memorial' then perform app.refuse('stale'); end if;
    perform app.require_edition_admin(v_l.edition_id);
    if exists (select 1 from public.memorial_plans where lesson_id = v_l.id) then perform app.refuse('memorial_placed'); end if;
    delete from public.lessons where id = v_l.id;
  end
  $$;

-- ------------------------------------------------------------- memorial plans (an edition's admins)

-- A plan for one of the active fallen (`bad_value`), one per fallen per edition
-- (`duplicate`). Adding and deleting one is logged (who, the fallen's id).
-- The fallen's row is locked (FOR SHARE) before the check: a delete_fallen or a
-- deactivation (save_fallen) on another connection either finishes first — and
-- the check sees no active row: `bad_value`, never a raw foreign-key error or a
-- plan for an inactive fallen — or waits for this plan, and then sees it
-- (`in_use` / a deactivation of a planned fallen, as anywhere).
create or replace function public.add_memorial_plan(p_edition bigint, p_fallen bigint) returns bigint
  language plpgsql security definer set search_path = ''
  as $$
  declare v_id bigint;
  begin
    perform app.require_edition_admin(p_edition);
    perform 1 from public.fallen where id = p_fallen and active for share;
    if not found then perform app.refuse('bad_value'); end if;
    insert into public.memorial_plans (edition_id, fallen_id, updated_by) values (p_edition, p_fallen, app.my_member_id(p_edition))
    on conflict (edition_id, fallen_id) do nothing
    returning id into v_id;
    if v_id is null then perform app.refuse('duplicate'); end if;
    -- a plan opens the family's contact to the edition's admins: who opened it, and when, is logged
    perform app.log_event(p_edition, 'memorial_plans', v_id, 'insert', jsonb_build_object('fallen', p_fallen));
    return v_id;
  end
  $$;

-- The keys present in the patch, at the version the screen saw (`stale`), in
-- this order: family_status (one of five), speaker_text (one line ≤ 200),
-- planned_minutes (a whole number 1–180 — a typo guard, «הצעה» — or null),
-- hard_stop (a boolean), materials_note (a block ≤ 500). Unknown keys ignored;
-- nothing changed → nothing; else version + 1.
create or replace function public.update_memorial_plan(p_plan bigint, p_version integer, p_patch jsonb) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_p public.memorial_plans := app.memorial_plan(p_plan);
    v_n public.memorial_plans;
  begin
    if v_p.version <> p_version then perform app.refuse('stale'); end if;
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then perform app.refuse('bad_value'); end if;
    v_n := v_p;
    if p_patch ? 'family_status' then
      if jsonb_typeof(p_patch -> 'family_status') is distinct from 'string'
         or not (p_patch ->> 'family_status' = any (array['not_contacted', 'invited', 'confirmed', 'cannot_come', 'other_speaker'])) then
        perform app.refuse('bad_value');
      end if;
      v_n.family_status := p_patch ->> 'family_status';
    end if;
    if p_patch ? 'speaker_text' then
      if jsonb_typeof(p_patch -> 'speaker_text') not in ('string', 'null') then perform app.refuse('bad_value'); end if;
      v_n.speaker_text := app.clean_line(p_patch ->> 'speaker_text', 200);
    end if;
    if p_patch ? 'planned_minutes' then v_n.planned_minutes := app.json_int(p_patch -> 'planned_minutes', 1, 180); end if;
    if p_patch ? 'hard_stop' then
      if jsonb_typeof(p_patch -> 'hard_stop') is distinct from 'boolean' then perform app.refuse('bad_value'); end if;
      v_n.hard_stop := (p_patch ->> 'hard_stop')::boolean;
    end if;
    if p_patch ? 'materials_note' then
      if jsonb_typeof(p_patch -> 'materials_note') not in ('string', 'null') then perform app.refuse('bad_value'); end if;
      v_n.materials_note := app.clean_block(p_patch ->> 'materials_note', 500);
    end if;
    if (v_n.family_status, v_n.speaker_text, v_n.planned_minutes, v_n.hard_stop, v_n.materials_note)
       is not distinct from (v_p.family_status, v_p.speaker_text, v_p.planned_minutes, v_p.hard_stop, v_p.materials_note) then
      return;
    end if;
    update public.memorial_plans
       set family_status = v_n.family_status, speaker_text = v_n.speaker_text, planned_minutes = v_n.planned_minutes,
           hard_stop = v_n.hard_stop, materials_note = v_n.materials_note,
           version = version + 1, updated_by = app.my_member_id(v_p.edition_id)
     where id = v_p.id;
  end
  $$;

-- Place a plan on a memorial slot of its edition (`bad_value`: not a memorial
-- slot of it, or cancelled) that holds no other plan (`memorial_taken`), or
-- take it off (p_lesson NULL). The liaison goes with the plan: the slot it
-- leaves loses its escort and note, the slot it comes to takes them (the
-- escorts' ticks of both start over — app.lessons_escort_ticks). The same slot
-- again: nothing.
create or replace function public.place_memorial_plan(p_plan bigint, p_version integer, p_lesson bigint) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_p    public.memorial_plans := app.memorial_plan(p_plan);
    v_me   bigint := app.my_member_id(v_p.edition_id);
    v_new  public.lessons;
    v_old  public.lessons;
  begin
    if v_p.version <> p_version then perform app.refuse('stale'); end if;
    if p_lesson is not distinct from v_p.lesson_id then return; end if;
    if p_lesson is not null then
      select * into v_new from public.lessons where id = p_lesson and edition_id = v_p.edition_id for update;
      if v_new.id is null or v_new.kind <> 'memorial' or v_new.state = 'cancelled' then perform app.refuse('bad_value'); end if;
      if exists (select 1 from public.memorial_plans where lesson_id = p_lesson) then perform app.refuse('memorial_taken'); end if;
    end if;
    if v_p.lesson_id is not null then
      select * into v_old from public.lessons where id = v_p.lesson_id for update;
    end if;
    update public.memorial_plans set lesson_id = p_lesson, version = version + 1, updated_by = v_me where id = v_p.id;
    if v_old.id is not null and (v_old.escort_roster_id is not null or v_old.escort_note is not null) then
      update public.lessons set escort_roster_id = null, escort_note = null, version = version + 1, updated_by = v_me where id = v_old.id;
    end if;
    if v_new.id is not null and (v_new.escort_roster_id, v_new.escort_note) is distinct from (v_old.escort_roster_id, v_old.escort_note) then
      update public.lessons set escort_roster_id = v_old.escort_roster_id, escort_note = v_old.escort_note, version = version + 1, updated_by = v_me
       where id = v_new.id;
    end if;
  end
  $$;

-- A plan that is not placed (`memorial_placed`: take it off its slot first).
create or replace function public.delete_memorial_plan(p_plan bigint) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare v_p public.memorial_plans := app.memorial_plan(p_plan);
  begin
    if v_p.lesson_id is not null then perform app.refuse('memorial_placed'); end if;
    delete from public.memorial_plans where id = v_p.id;
    perform app.log_event(v_p.edition_id, 'memorial_plans', v_p.id, 'delete', jsonb_build_object('fallen', v_p.fallen_id));
  end
  $$;

-- The memorial policy (DESIGN: «המדיניות נקבעת ב-settings.memorial, אחרי ישיבת
-- הצוות»): where memorial times go (free text, a block ≤ 500), the most
-- minutes one may take (1–180), and whether a slot next to a meal is warned
-- about. Each part absent until the staff meeting decides it — never seeded;
-- all three empty removes the policy. An admin of the edition.
create or replace function public.set_memorial_policy(p_edition bigint, p_placement text, p_max_minutes integer, p_warn_adjacent_meal boolean)
  returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare v jsonb;
  begin
    perform app.require_edition_admin(p_edition);
    if p_max_minutes is not null and p_max_minutes not between 1 and 180 then perform app.refuse('bad_value'); end if;
    v := jsonb_strip_nulls(jsonb_build_object('placement', app.clean_block(p_placement, 500), 'max_minutes', p_max_minutes,
                                              'warn_adjacent_meal', p_warn_adjacent_meal));
    update public.editions
       set settings = case when v = '{}'::jsonb then settings - 'memorial' else settings || jsonb_build_object('memorial', v) end
     where id = p_edition;
  end
  $$;

-- Everything the grid needs, in one round trip, as the caller's RLS allows —
-- invoker, so it can never show more than the tables would. Never a contact
-- detail and never a transport detail (their own tables). v7 adds the
-- edition's roster (names only), for escorts; v9 the escorts' ticks; v10 the
-- sources' files (their rows — the bytes are in Storage, fetched by signed URL);
-- v11 the memorial plans and the names of the fallen they are for — never a
-- family's contact (fallen_contacts is read one fallen at a time, by admins).
create or replace function public.load_week(p_edition bigint) returns jsonb
  language sql stable security invoker set search_path = ''
  as $$
    select jsonb_build_object(
      'edition', (select to_jsonb(e) from public.editions e where e.id = p_edition),
      'rows', coalesce((select jsonb_agg(to_jsonb(r) - 'edition_id' order by r.start_min, r.id) from public.grid_rows r where r.edition_id = p_edition), '[]'),
      'rooms', coalesce((select jsonb_agg(to_jsonb(r) - 'edition_id' order by r.sort, r.id) from public.rooms r where r.edition_id = p_edition), '[]'),
      'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort, c.id) from public.categories c), '[]'),
      'speakers', coalesce((select jsonb_agg(jsonb_build_object(
          'id', s.id, 'title', s.title, 'name', s.name, 'disambiguator', s.disambiguator, 'gender', s.gender,
          'affiliation', s.affiliation, 'bio_short', s.bio_short, 'topics', s.topics, 'contact_pref', s.contact_pref,
          'vetted', s.vetted, 'vetted_by', s.vetted_by, 'vetted_note', s.vetted_note, 'retired', s.retired,
          'name_key', s.name_key, 'version', s.version)
          order by s.id) from public.speakers s), '[]'),
      'approaches', coalesce((select jsonb_agg(jsonb_build_object(
          'id', a.id, 'speaker_id', a.speaker_id, 'owner_member_id', a.owner_member_id, 'status', a.status,
          'avail_note', a.avail_note, 'offered_to', a.offered_to, 'version', a.version) order by a.id)
          from public.approaches a where a.edition_id = p_edition), '[]'),
      'availability', coalesce((select jsonb_agg(to_jsonb(v) order by v.id) from public.availability v
          join public.approaches a on a.id = v.approach_id where a.edition_id = p_edition), '[]'),
      'lessons', coalesce((select jsonb_agg(to_jsonb(l) - 'span' - 'edition_id' - 'created_at' order by l.id)
          from public.lessons l where l.edition_id = p_edition), '[]'),
      'lessonSpeakers', coalesce((select jsonb_agg(jsonb_build_object('lesson_id', x.lesson_id, 'speaker_id', x.speaker_id, 'role', x.role))
          from public.lesson_speakers x where x.edition_id = p_edition), '[]'),
      'pitches', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'lesson_id', p.lesson_id, 'approach_id', p.approach_id,
          'state', p.state, 'proposed_by', p.proposed_by, 'at', p.at) order by p.id)
          from public.pitches p where p.edition_id = p_edition), '[]'),
      'team', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.team(p_edition) t), '[]'),
      'roster', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'full_name', r.full_name, 'gender', r.gender) order by r.full_name, r.id)
          from public.roster r where r.edition_id = p_edition), '[]'),
      'escortTicks', coalesce((select jsonb_agg(jsonb_build_object('lesson_id', t.lesson_id, 'item', t.item, 'at', to_char(t.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by t.lesson_id, t.item)
          from public.escort_ticks t join public.lessons l on l.id = t.lesson_id where l.edition_id = p_edition), '[]'),
      'sourceFiles', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'lesson_id', f.lesson_id, 'cover', f.cover, 'speaker_id', f.speaker_id,
          'storage_path', f.storage_path, 'display_name', f.display_name, 'mime', f.mime, 'size_bytes', f.size_bytes, 'page_count', f.page_count,
          'uploaded_by', f.uploaded_by, 'uploaded_at', to_char(f.uploaded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'fallen_id', f.fallen_id) order by f.id)
          from public.source_files f where f.edition_id = p_edition), '[]'),
      'memorialPlans', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'fallen_id', p.fallen_id, 'lesson_id', p.lesson_id,
          'family_status', p.family_status, 'speaker_text', p.speaker_text, 'planned_minutes', p.planned_minutes, 'hard_stop', p.hard_stop,
          'materials_note', p.materials_note, 'version', p.version) order by p.id)
          from public.memorial_plans p where p.edition_id = p_edition), '[]'),
      'fallen', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'gender', f.gender) order by f.id)
          from public.fallen f where exists (select 1 from public.memorial_plans p where p.fallen_id = f.id and p.edition_id = p_edition)), '[]')
    )
    where app.can_see_edition(p_edition)
  $$;


-- =============================================================================
-- Import 5786 (v12) — last year's files (תשפ"ו) into the database, through the
-- browser only. Semantics: docs/CONTRACT.md «The import of 5786»; the in-memory
-- twin is src/data/engine.ts (importCommit), held to this by tests/parity.
--
-- The files themselves never reach the server: the wizard («הגדרות ← ייבוא»)
-- reads a paste or an .xlsx/.docx in the page, the admin maps, reviews and
-- decides, and only the reviewed rows arrive here, as one payload, in one
-- transaction — every row or none. A GLOBAL ADMIN only: it writes the cross-year
-- speaker pool and makes an archive edition.
--   import_lookup   which pool speaker has a phone (by app.phone_key — the
--                   browser's phoneKey, src/import/phone.ts), and which contact
--                   fields of some speakers are filled: booleans, never a value
--   import_commit   'candidates' → the pool (source as typed, vetted pending)
--                   'tracking'   → an archive edition of closed lessons (kind
--                                  'archive', status 'archived'); the same label
--                                  again REPLACES that edition's lessons — unless
--                                  someone wrote «איך עבר» on one of them
--                                  (`archive_reviewed`: a review goes with its
--                                  lesson, and is never lost to a re-run)
--                   'escorts'    → contact_pref and speaker_contacts.secretary_note: the
--                                  channel the admin chose from a fixed list, the
--                                  note the admin typed — never the file's text
-- Re-runnable: a 'new' speaker whose name key the pool already has completes
-- that speaker instead of adding a second one. A phone is never a reason to
-- merge on its own: the preview shows a phone the pool has («אותו טלפון כמו …»)
-- and the browser sends that row as an explicit 'merge' — two people who share
-- a line (a couple, an office) are two speakers. A match only FILLS what is
-- empty, never overwrites — and never a gender the speaker's own title
-- contradicts, nor a title that contradicts the speaker's gender. Gender only as the title says (הרב m, הרבנית f). Phones and
-- e-mails only in speaker_contacts. The log keeps ids, counts and field names —
-- never a name, a phone or a note. An archive's label is compared by
-- app.label_key (quote marks and spaces aside) and stored in that form.
-- lesson_import_notes: what last year's sheet said about a lesson that has no
-- field of its own (transport/payment words, who sent the summary message),
-- cleared of phones and e-mails in the browser (scrubContacts). Transport words
-- are personal data: the table has the transport details' rule
-- (app.may_see_transport — for an archive, a global admin only), is read one
-- lesson at a time (get_import_note), never in load_week, Realtime or the
-- device's offline copy, and purge_edition_private (Milestone 6) deletes it.
-- =============================================================================

create table if not exists public.lesson_import_notes (
  lesson_id  bigint primary key references public.lessons (id) on delete cascade,
  edition_id bigint not null references public.editions (id) on delete cascade,
  note       text not null check (char_length(note) between 1 and 1000)
);
create index if not exists lesson_import_notes_edition on public.lesson_import_notes (edition_id);
alter table public.lesson_import_notes enable row level security;
drop policy if exists lesson_import_notes_read on public.lesson_import_notes;
create policy lesson_import_notes_read on public.lesson_import_notes for select to authenticated
  using (app.may_see_transport(lesson_import_notes.lesson_id));

-- A lesson's import note, through the policy (invoker): NULL when there is none
-- or it is not the caller's to see (get_transport_details' rule).
create or replace function public.get_import_note(p_lesson bigint) returns text
  language sql stable security invoker set search_path = ''
  as $$ select n.note from public.lesson_import_notes n where n.lesson_id = p_lesson and app.may_see_transport(p_lesson) $$;

-- An archive edition's label as the import compares (and stores) it: the
-- Hebrew and typographic quote marks as ASCII (״ “ ” ″ → ", ׳ ‘ ’ → '), spaces
-- single (src/data/importRules.ts labelKey holds the same).
create or replace function app.label_key(p text) returns text
  language sql immutable set search_path = ''
  as $$
    select btrim(regexp_replace(translate(coalesce(p, ''), '״“”″׳‘’', '""""'''''''), '[ \t\n\r\f\v]+', ' ', 'g'))
  $$;

-- A phone's comparison key (src/import/phone.ts phoneKey holds the same):
-- digits; 972 / 00972 (and a 0 after it) as a leading 0; a leading 0 a number
-- cell dropped (8–9 digits) given back; NULL under 6 digits.
create or replace function app.phone_key(p text) returns text
  language sql immutable set search_path = ''
  as $$
    select case when length(k) >= 6 then k end
      from (select case
                     when d ~ '^(00)?972' then '0' || regexp_replace(regexp_replace(d, '^(00)?972', ''), '^0', '')
                     when length(d) in (8, 9) and d !~ '^0' then '0' || d
                     else d
                   end as k
              from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) a) b
  $$;

-- A phone or an e-mail inside text (src/import/phone.ts foldContact and hasContact hold the same — the same
-- expressions and lists, written out, held equal by tests/sql/import.test.ts). The text is folded first
-- (app.contact_fold): what shows nothing out (Unicode's format characters — bidi controls, zero widths, the soft
-- hyphen, tags — NEL and U+180E) and every decimal digit of every script as its ASCII digit (٠, ０ → 0). Then: an
-- e-mail (no space, @, <, >, ( or ) around an @ — «@@» and «＠» too — and a dot after it; or, in the usual letters,
-- spaces around the @ and the dots); or a phone by Israel's numbering plan, never «any seven digits» (DECISIONS «סבב
-- חמישי»): an Israeli number (0 and 2/3/4/8/9 and seven digits, or 5/7 and eight; 972, +972 or 00972 before it, a 0
-- after it or not — tried first, its length fixed; 1-700, 1-800, 1-599 and six digits), a number abroad («+» or «00»
-- and 8–15 digits), or 7–15 digits — or a star number — beside a word that says a phone («טל'», «טלפון», «נייד», «פקס»,
-- tel, phone, ☎…). Its digits apart by spaces, dashes, brackets, «·», «•», «‧», «_», «|», «;», «,» before a digit, «.»
-- and «/» unless between two groups of one or two digits, «:» only between groups of three; never starting inside a
-- number, after «20:» or «1,», at a time, at a date with a four-digit year, or at the day, month or year of a
-- two-digit-year date written with dashes or spaces («04-05-26», DECISIONS «סבב שישי»), nor ending at a time's hour.
-- Verses, dates, times, pages, prices and years are text. White space is written out: [[:space:]] would depend on the locale. The import's backstop: a contact is kept
-- in speaker_contacts' phone and e-mail only («contact_in_text»).
create or replace function app.contact_fold(p text) returns text
  language sql immutable set search_path = ''
  as $$ select translate(regexp_replace(coalesce(p, ''), '[\u0085\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]', '', 'g'), U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669\06f0\06f1\06f2\06f3\06f4\06f5\06f6\06f7\06f8\06f9\07c0\07c1\07c2\07c3\07c4\07c5\07c6\07c7\07c8\07c9\0966\0967\0968\0969\096a\096b\096c\096d\096e\096f\09e6\09e7\09e8\09e9\09ea\09eb\09ec\09ed\09ee\09ef\0a66\0a67\0a68\0a69\0a6a\0a6b\0a6c\0a6d\0a6e\0a6f\0ae6\0ae7\0ae8\0ae9\0aea\0aeb\0aec\0aed\0aee\0aef\0b66\0b67\0b68\0b69\0b6a\0b6b\0b6c\0b6d\0b6e\0b6f\0be6\0be7\0be8\0be9\0bea\0beb\0bec\0bed\0bee\0bef\0c66\0c67\0c68\0c69\0c6a\0c6b\0c6c\0c6d\0c6e\0c6f\0ce6\0ce7\0ce8\0ce9\0cea\0ceb\0cec\0ced\0cee\0cef\0d66\0d67\0d68\0d69\0d6a\0d6b\0d6c\0d6d\0d6e\0d6f\0de6\0de7\0de8\0de9\0dea\0deb\0dec\0ded\0dee\0def\0e50\0e51\0e52\0e53\0e54\0e55\0e56\0e57\0e58\0e59\0ed0\0ed1\0ed2\0ed3\0ed4\0ed5\0ed6\0ed7\0ed8\0ed9\0f20\0f21\0f22\0f23\0f24\0f25\0f26\0f27\0f28\0f29\1040\1041\1042\1043\1044\1045\1046\1047\1048\1049\1090\1091\1092\1093\1094\1095\1096\1097\1098\1099\17e0\17e1\17e2\17e3\17e4\17e5\17e6\17e7\17e8\17e9\1810\1811\1812\1813\1814\1815\1816\1817\1818\1819\1946\1947\1948\1949\194a\194b\194c\194d\194e\194f\19d0\19d1\19d2\19d3\19d4\19d5\19d6\19d7\19d8\19d9\1a80\1a81\1a82\1a83\1a84\1a85\1a86\1a87\1a88\1a89\1a90\1a91\1a92\1a93\1a94\1a95\1a96\1a97\1a98\1a99\1b50\1b51\1b52\1b53\1b54\1b55\1b56\1b57\1b58\1b59\1bb0\1bb1\1bb2\1bb3\1bb4\1bb5\1bb6\1bb7\1bb8\1bb9\1c40\1c41\1c42\1c43\1c44\1c45\1c46\1c47\1c48\1c49\1c50\1c51\1c52\1c53\1c54\1c55\1c56\1c57\1c58\1c59\a620\a621\a622\a623\a624\a625\a626\a627\a628\a629\a8d0\a8d1\a8d2\a8d3\a8d4\a8d5\a8d6\a8d7\a8d8\a8d9\a900\a901\a902\a903\a904\a905\a906\a907\a908\a909\a9d0\a9d1\a9d2\a9d3\a9d4\a9d5\a9d6\a9d7\a9d8\a9d9\a9f0\a9f1\a9f2\a9f3\a9f4\a9f5\a9f6\a9f7\a9f8\a9f9\aa50\aa51\aa52\aa53\aa54\aa55\aa56\aa57\aa58\aa59\abf0\abf1\abf2\abf3\abf4\abf5\abf6\abf7\abf8\abf9\ff10\ff11\ff12\ff13\ff14\ff15\ff16\ff17\ff18\ff19\+0104a0\+0104a1\+0104a2\+0104a3\+0104a4\+0104a5\+0104a6\+0104a7\+0104a8\+0104a9\+010d30\+010d31\+010d32\+010d33\+010d34\+010d35\+010d36\+010d37\+010d38\+010d39\+010d40\+010d41\+010d42\+010d43\+010d44\+010d45\+010d46\+010d47\+010d48\+010d49\+011066\+011067\+011068\+011069\+01106a\+01106b\+01106c\+01106d\+01106e\+01106f\+0110f0\+0110f1\+0110f2\+0110f3\+0110f4\+0110f5\+0110f6\+0110f7\+0110f8\+0110f9\+011136\+011137\+011138\+011139\+01113a\+01113b\+01113c\+01113d\+01113e\+01113f\+0111d0\+0111d1\+0111d2\+0111d3\+0111d4\+0111d5\+0111d6\+0111d7\+0111d8\+0111d9\+0112f0\+0112f1\+0112f2\+0112f3\+0112f4\+0112f5\+0112f6\+0112f7\+0112f8\+0112f9\+011450\+011451\+011452\+011453\+011454\+011455\+011456\+011457\+011458\+011459\+0114d0\+0114d1\+0114d2\+0114d3\+0114d4\+0114d5\+0114d6\+0114d7\+0114d8\+0114d9\+011650\+011651\+011652\+011653\+011654\+011655\+011656\+011657\+011658\+011659\+0116c0\+0116c1\+0116c2\+0116c3\+0116c4\+0116c5\+0116c6\+0116c7\+0116c8\+0116c9\+0116d0\+0116d1\+0116d2\+0116d3\+0116d4\+0116d5\+0116d6\+0116d7\+0116d8\+0116d9\+0116da\+0116db\+0116dc\+0116dd\+0116de\+0116df\+0116e0\+0116e1\+0116e2\+0116e3\+011730\+011731\+011732\+011733\+011734\+011735\+011736\+011737\+011738\+011739\+0118e0\+0118e1\+0118e2\+0118e3\+0118e4\+0118e5\+0118e6\+0118e7\+0118e8\+0118e9\+011950\+011951\+011952\+011953\+011954\+011955\+011956\+011957\+011958\+011959\+011bf0\+011bf1\+011bf2\+011bf3\+011bf4\+011bf5\+011bf6\+011bf7\+011bf8\+011bf9\+011c50\+011c51\+011c52\+011c53\+011c54\+011c55\+011c56\+011c57\+011c58\+011c59\+011d50\+011d51\+011d52\+011d53\+011d54\+011d55\+011d56\+011d57\+011d58\+011d59\+011da0\+011da1\+011da2\+011da3\+011da4\+011da5\+011da6\+011da7\+011da8\+011da9\+011f50\+011f51\+011f52\+011f53\+011f54\+011f55\+011f56\+011f57\+011f58\+011f59\+016130\+016131\+016132\+016133\+016134\+016135\+016136\+016137\+016138\+016139\+016a60\+016a61\+016a62\+016a63\+016a64\+016a65\+016a66\+016a67\+016a68\+016a69\+016ac0\+016ac1\+016ac2\+016ac3\+016ac4\+016ac5\+016ac6\+016ac7\+016ac8\+016ac9\+016b50\+016b51\+016b52\+016b53\+016b54\+016b55\+016b56\+016b57\+016b58\+016b59\+016d70\+016d71\+016d72\+016d73\+016d74\+016d75\+016d76\+016d77\+016d78\+016d79\+01ccf0\+01ccf1\+01ccf2\+01ccf3\+01ccf4\+01ccf5\+01ccf6\+01ccf7\+01ccf8\+01ccf9\+01d7ce\+01d7cf\+01d7d0\+01d7d1\+01d7d2\+01d7d3\+01d7d4\+01d7d5\+01d7d6\+01d7d7\+01d7d8\+01d7d9\+01d7da\+01d7db\+01d7dc\+01d7dd\+01d7de\+01d7df\+01d7e0\+01d7e1\+01d7e2\+01d7e3\+01d7e4\+01d7e5\+01d7e6\+01d7e7\+01d7e8\+01d7e9\+01d7ea\+01d7eb\+01d7ec\+01d7ed\+01d7ee\+01d7ef\+01d7f0\+01d7f1\+01d7f2\+01d7f3\+01d7f4\+01d7f5\+01d7f6\+01d7f7\+01d7f8\+01d7f9\+01d7fa\+01d7fb\+01d7fc\+01d7fd\+01d7fe\+01d7ff\+01e140\+01e141\+01e142\+01e143\+01e144\+01e145\+01e146\+01e147\+01e148\+01e149\+01e2f0\+01e2f1\+01e2f2\+01e2f3\+01e2f4\+01e2f5\+01e2f6\+01e2f7\+01e2f8\+01e2f9\+01e4f0\+01e4f1\+01e4f2\+01e4f3\+01e4f4\+01e4f5\+01e4f6\+01e4f7\+01e4f8\+01e4f9\+01e5f1\+01e5f2\+01e5f3\+01e5f4\+01e5f5\+01e5f6\+01e5f7\+01e5f8\+01e5f9\+01e5fa\+01e950\+01e951\+01e952\+01e953\+01e954\+01e955\+01e956\+01e957\+01e958\+01e959\+01fbf0\+01fbf1\+01fbf2\+01fbf3\+01fbf4\+01fbf5\+01fbf6\+01fbf7\+01fbf8\+01fbf9', '012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789') $$;

create or replace function app.has_contact(p text) returns boolean
  language sql immutable set search_path = ''
  as $$
    select f.t ~ '(?:[^ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff@\uff20<>()]+[@\uff20]+[^ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff@\uff20<>()]+\.[^ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff@\uff20<>()]+|[A-Za-z0-9._%+-]+[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*[@\uff20](?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*[@\uff20])*[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*[A-Za-z0-9-]+(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*\.[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*[A-Za-z0-9-]+)*[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*\.[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*[A-Za-z]{2,})'
        or f.t ~ '(?=[(+*0-9])(?:\([ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*)?(?:(?<![0-9])(?<![0-9][:.,])(?![0-9]{1,2}[:.][0-9]{2}(?![0-9]))(?![0-9]{1,2}[./-](?:[0-9]{1,2}[./-])?(?:1[89]|20)[0-9]{2}(?![0-9]))(?!(?:1[89]|20)[0-9]{2}[./-][0-9]{1,2}[./-][0-9]{1,2}(?![0-9]))(?!(?:0?[1-9]|[12][0-9]|3[01])-(?:0?[1-9]|1[0-2])-[0-9]{2}(?![0-9])(?!-[0-9]))(?!(?:0?[1-9]|[12][0-9]|3[01]) (?:0?[1-9]|1[0-2]) [0-9]{2}(?![0-9])(?! [0-9]{2} [0-9]{1,2}(?![0-9])))(?:(?<!(?:^|[^0-9-]|[^0-9]-)(?:0?[1-9]|[12][0-9]|3[01])-)|(?!(?:0?[1-9]|1[0-2])-[0-9]{2}(?![0-9])(?!-[0-9])))(?:(?<!(?:^|[^0-9-]|[^0-9]-)(?:0?[1-9]|[12][0-9]|3[01])-(?:0?[1-9]|1[0-2])-)|(?![0-9]{2}(?![0-9])(?!-[0-9])))(?:(?<!(?:^|[^0-9 ]|[^0-9] )(?:0?[1-9]|[12][0-9]|3[01]) )|(?!(?:0?[1-9]|1[0-2]) [0-9]{2}(?![0-9])(?! [0-9]{2} [0-9]{1,2}(?![0-9]))))(?:(?<!(?:^|[^0-9 ]|[^0-9] )(?:0?[1-9]|[12][0-9]|3[01]) (?:0?[1-9]|1[0-2]) )|(?![0-9]{2}(?![0-9])(?! [0-9]{2} [0-9]{1,2}(?![0-9]))))(?:0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*(?:[23489](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){7}|[57](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){8})|(?:(?:\+|0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0)(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*)?9(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*7(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*2(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*(?:0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*)?(?:[23489](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){7}|[57](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){8})|1(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*(?:7(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0|8(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0|5(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*9(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*9)(?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){6})|(?<![0-9])\+(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_-]|(?<=[0-9])[,;|](?=[0-9])|(?<=[0-9]{3})/(?=[0-9])|(?<=[0-9])(?<![0-9]{3})/(?=[0-9]{3})|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9](?:(?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_-]|(?<=[0-9])[,;|](?=[0-9])|(?<=[0-9]{3})/(?=[0-9])|(?<=[0-9])(?<![0-9]{3})/(?=[0-9]{3})|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))+(?![0-9]{1,2}[:.][0-9]{2}(?![0-9]))(?![0-9]{1,2}[./-](?:[0-9]{1,2}[./-])?(?:1[89]|20)[0-9]{2}(?![0-9]))(?!(?:1[89]|20)[0-9]{2}[./-][0-9]{1,2}[./-][0-9]{1,2}(?![0-9]))(?!(?:0?[1-9]|[12][0-9]|3[01])-(?:0?[1-9]|1[0-2])-[0-9]{2}(?![0-9])(?!-[0-9]))(?!(?:0?[1-9]|[12][0-9]|3[01]) (?:0?[1-9]|1[0-2]) [0-9]{2}(?![0-9])(?! [0-9]{2} [0-9]{1,2}(?![0-9])))(?!(?:0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*(?:[23489](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){7}|[57](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){8})|(?:(?:\+|0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0)(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*)?9(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*7(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*2(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*(?:0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*)?(?:[23489](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){7}|[57](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){8})|1(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*(?:7(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0|8(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0|5(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*9(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*9)(?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){6})(?![0-9])(?![:.][0-9]{2}(?![0-9]))(?:(?<=[0-9]{3})|(?![./][0-9]))))?[0-9]){7,14}|(?<![0-9])(?<![0-9][:.,])(?![0-9]{1,2}[:.][0-9]{2}(?![0-9]))(?![0-9]{1,2}[./-](?:[0-9]{1,2}[./-])?(?:1[89]|20)[0-9]{2}(?![0-9]))(?!(?:1[89]|20)[0-9]{2}[./-][0-9]{1,2}[./-][0-9]{1,2}(?![0-9]))(?!(?:0?[1-9]|[12][0-9]|3[01])-(?:0?[1-9]|1[0-2])-[0-9]{2}(?![0-9])(?!-[0-9]))(?!(?:0?[1-9]|[12][0-9]|3[01]) (?:0?[1-9]|1[0-2]) [0-9]{2}(?![0-9])(?! [0-9]{2} [0-9]{1,2}(?![0-9])))(?:(?<!(?:^|[^0-9-]|[^0-9]-)(?:0?[1-9]|[12][0-9]|3[01])-)|(?!(?:0?[1-9]|1[0-2])-[0-9]{2}(?![0-9])(?!-[0-9])))(?:(?<!(?:^|[^0-9-]|[^0-9]-)(?:0?[1-9]|[12][0-9]|3[01])-(?:0?[1-9]|1[0-2])-)|(?![0-9]{2}(?![0-9])(?!-[0-9])))(?:(?<!(?:^|[^0-9 ]|[^0-9] )(?:0?[1-9]|[12][0-9]|3[01]) )|(?!(?:0?[1-9]|1[0-2]) [0-9]{2}(?![0-9])(?! [0-9]{2} [0-9]{1,2}(?![0-9]))))(?:(?<!(?:^|[^0-9 ]|[^0-9] )(?:0?[1-9]|[12][0-9]|3[01]) (?:0?[1-9]|1[0-2]) )|(?![0-9]{2}(?![0-9])(?! [0-9]{2} [0-9]{1,2}(?![0-9]))))0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_-]|(?<=[0-9])[,;|](?=[0-9])|(?<=[0-9]{3})/(?=[0-9])|(?<=[0-9])(?<![0-9]{3})/(?=[0-9]{3})|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0(?:(?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_-]|(?<=[0-9])[,;|](?=[0-9])|(?<=[0-9]{3})/(?=[0-9])|(?<=[0-9])(?<![0-9]{3})/(?=[0-9]{3})|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))+(?![0-9]{1,2}[:.][0-9]{2}(?![0-9]))(?![0-9]{1,2}[./-](?:[0-9]{1,2}[./-])?(?:1[89]|20)[0-9]{2}(?![0-9]))(?!(?:1[89]|20)[0-9]{2}[./-][0-9]{1,2}[./-][0-9]{1,2}(?![0-9]))(?!(?:0?[1-9]|[12][0-9]|3[01])-(?:0?[1-9]|1[0-2])-[0-9]{2}(?![0-9])(?!-[0-9]))(?!(?:0?[1-9]|[12][0-9]|3[01]) (?:0?[1-9]|1[0-2]) [0-9]{2}(?![0-9])(?! [0-9]{2} [0-9]{1,2}(?![0-9])))(?!(?:0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*(?:[23489](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){7}|[57](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){8})|(?:(?:\+|0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0)(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*)?9(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*7(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*2(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*(?:0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*)?(?:[23489](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){7}|[57](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){8})|1(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*(?:7(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0|8(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0|5(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*9(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*9)(?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){6})(?![0-9])(?![:.][0-9]{2}(?![0-9]))(?:(?<=[0-9]{3})|(?![./][0-9]))))?[0-9]){6,13}|(?<=(?:(?<![A-Za-z\u05d0-\u05ea])[\u05d5\u05d1\u05dc\u05d4\u05de\u05e9]{0,2}(?:\u05d8\u05dc\u05e4\u05d5\u05df|\u05e0\u05d9\u05d9\u05d3|\u05e4\u05dc\u05d0\u05e4\u05d5\u05df|\u05e1\u05dc\u05d5\u05dc\u05e8\u05d9|\u05e4\u05e7\u05e1)(?![A-Za-z\u05d0-\u05ea])|(?<![A-Za-z\u05d0-\u05ea])[\u05d5\u05d1\u05dc\u05d4\u05de\u05e9]{0,2}(?:\u05d8\u05dc|\u05e4\u05dc)[\u0027\u05f3.:]|(?<![A-Za-z])(?:[Tt][Ee][Ll](?:[Ee][Pp][Hh][Oo][Nn][Ee])?|[Pp][Hh][Oo][Nn][Ee]|[Mm][Oo][Bb](?:[Ii][Ll][Ee])?|[Ff][Aa][Xx]|[Cc][Ee][Ll][Ll])(?![A-Za-z])|\u260e|\u260f|📞|📱)[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d().:,;/|*#=>\u0027\u0022\u05f3\u05f4\ufe0f-]{0,4})(?:\+(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_-]|(?<=[0-9])[,;|](?=[0-9])|(?<=[0-9]{3})/(?=[0-9])|(?<=[0-9])(?<![0-9]{3})/(?=[0-9]{3})|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*)?(?<![0-9])(?<![0-9][:.,])(?![0-9]{1,2}[:.][0-9]{2}(?![0-9]))(?![0-9]{1,2}[./-](?:[0-9]{1,2}[./-])?(?:1[89]|20)[0-9]{2}(?![0-9]))(?!(?:1[89]|20)[0-9]{2}[./-][0-9]{1,2}[./-][0-9]{1,2}(?![0-9]))(?!(?:0?[1-9]|[12][0-9]|3[01])-(?:0?[1-9]|1[0-2])-[0-9]{2}(?![0-9])(?!-[0-9]))(?!(?:0?[1-9]|[12][0-9]|3[01]) (?:0?[1-9]|1[0-2]) [0-9]{2}(?![0-9])(?! [0-9]{2} [0-9]{1,2}(?![0-9])))(?:(?<!(?:^|[^0-9-]|[^0-9]-)(?:0?[1-9]|[12][0-9]|3[01])-)|(?!(?:0?[1-9]|1[0-2])-[0-9]{2}(?![0-9])(?!-[0-9])))(?:(?<!(?:^|[^0-9-]|[^0-9]-)(?:0?[1-9]|[12][0-9]|3[01])-(?:0?[1-9]|1[0-2])-)|(?![0-9]{2}(?![0-9])(?!-[0-9])))(?:(?<!(?:^|[^0-9 ]|[^0-9] )(?:0?[1-9]|[12][0-9]|3[01]) )|(?!(?:0?[1-9]|1[0-2]) [0-9]{2}(?![0-9])(?! [0-9]{2} [0-9]{1,2}(?![0-9]))))(?:(?<!(?:^|[^0-9 ]|[^0-9] )(?:0?[1-9]|[12][0-9]|3[01]) (?:0?[1-9]|1[0-2]) )|(?![0-9]{2}(?![0-9])(?! [0-9]{2} [0-9]{1,2}(?![0-9]))))[0-9](?:(?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_-]|(?<=[0-9])[,;|](?=[0-9])|(?<=[0-9]{3})/(?=[0-9])|(?<=[0-9])(?<![0-9]{3})/(?=[0-9]{3})|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))+(?![0-9]{1,2}[:.][0-9]{2}(?![0-9]))(?![0-9]{1,2}[./-](?:[0-9]{1,2}[./-])?(?:1[89]|20)[0-9]{2}(?![0-9]))(?!(?:1[89]|20)[0-9]{2}[./-][0-9]{1,2}[./-][0-9]{1,2}(?![0-9]))(?!(?:0?[1-9]|[12][0-9]|3[01])-(?:0?[1-9]|1[0-2])-[0-9]{2}(?![0-9])(?!-[0-9]))(?!(?:0?[1-9]|[12][0-9]|3[01]) (?:0?[1-9]|1[0-2]) [0-9]{2}(?![0-9])(?! [0-9]{2} [0-9]{1,2}(?![0-9])))(?!(?:0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*(?:[23489](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){7}|[57](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){8})|(?:(?:\+|0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0)(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*)?9(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*7(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*2(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*(?:0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*)?(?:[23489](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){7}|[57](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){8})|1(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*(?:7(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0|8(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0|5(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*9(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*9)(?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){6})(?![0-9])(?![:.][0-9]{2}(?![0-9]))(?:(?<=[0-9]{3})|(?![./][0-9]))))?[0-9]){6,14}|(?<![0-9])(?<![0-9][:.,])(?![0-9]{1,2}[:.][0-9]{2}(?![0-9]))(?![0-9]{1,2}[./-](?:[0-9]{1,2}[./-])?(?:1[89]|20)[0-9]{2}(?![0-9]))(?!(?:1[89]|20)[0-9]{2}[./-][0-9]{1,2}[./-][0-9]{1,2}(?![0-9]))(?!(?:0?[1-9]|[12][0-9]|3[01])-(?:0?[1-9]|1[0-2])-[0-9]{2}(?![0-9])(?!-[0-9]))(?!(?:0?[1-9]|[12][0-9]|3[01]) (?:0?[1-9]|1[0-2]) [0-9]{2}(?![0-9])(?! [0-9]{2} [0-9]{1,2}(?![0-9])))(?:(?<!(?:^|[^0-9-]|[^0-9]-)(?:0?[1-9]|[12][0-9]|3[01])-)|(?!(?:0?[1-9]|1[0-2])-[0-9]{2}(?![0-9])(?!-[0-9])))(?:(?<!(?:^|[^0-9-]|[^0-9]-)(?:0?[1-9]|[12][0-9]|3[01])-(?:0?[1-9]|1[0-2])-)|(?![0-9]{2}(?![0-9])(?!-[0-9])))(?:(?<!(?:^|[^0-9 ]|[^0-9] )(?:0?[1-9]|[12][0-9]|3[01]) )|(?!(?:0?[1-9]|1[0-2]) [0-9]{2}(?![0-9])(?! [0-9]{2} [0-9]{1,2}(?![0-9]))))(?:(?<!(?:^|[^0-9 ]|[^0-9] )(?:0?[1-9]|[12][0-9]|3[01]) (?:0?[1-9]|1[0-2]) )|(?![0-9]{2}(?![0-9])(?! [0-9]{2} [0-9]{1,2}(?![0-9]))))[0-9](?:(?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_-]|(?<=[0-9])[,;|](?=[0-9])|(?<=[0-9]{3})/(?=[0-9])|(?<=[0-9])(?<![0-9]{3})/(?=[0-9]{3})|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))+(?![0-9]{1,2}[:.][0-9]{2}(?![0-9]))(?![0-9]{1,2}[./-](?:[0-9]{1,2}[./-])?(?:1[89]|20)[0-9]{2}(?![0-9]))(?!(?:1[89]|20)[0-9]{2}[./-][0-9]{1,2}[./-][0-9]{1,2}(?![0-9]))(?!(?:0?[1-9]|[12][0-9]|3[01])-(?:0?[1-9]|1[0-2])-[0-9]{2}(?![0-9])(?!-[0-9]))(?!(?:0?[1-9]|[12][0-9]|3[01]) (?:0?[1-9]|1[0-2]) [0-9]{2}(?![0-9])(?! [0-9]{2} [0-9]{1,2}(?![0-9])))(?!(?:0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*(?:[23489](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){7}|[57](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){8})|(?:(?:\+|0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0)(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*)?9(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*7(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*2(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*(?:0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*)?(?:[23489](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){7}|[57](?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){8})|1(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*(?:7(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0|8(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*0|5(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*9(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*9)(?:(?:[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d()\u00b7\u2022\u2027_|;-]|,(?=[0-9])|/(?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})/(?=[0-9]{1,2}(?![0-9]))|[.](?![0-9]{1,2}(?![0-9]))|(?<=[0-9]{3})[.](?=[0-9]{1,2}(?![0-9]))|(?<=[0-9]{3}):(?=[0-9]{3}))*[0-9]){6})(?![0-9])(?![:.][0-9]{2}(?![0-9]))(?:(?<=[0-9]{3})|(?![./][0-9]))))?[0-9]){6,14}(?![0-9])(?![:.][0-9]{2}(?![0-9]))(?:(?<=[0-9]{3})|(?![./][0-9]))(?=[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d().:,;/|*#=>\u0027\u0022\u05f3\u05f4\ufe0f-]{0,4}(?:(?<![A-Za-z\u05d0-\u05ea])[\u05d5\u05d1\u05dc\u05d4\u05de\u05e9]{0,2}(?:\u05d8\u05dc\u05e4\u05d5\u05df|\u05e0\u05d9\u05d9\u05d3|\u05e4\u05dc\u05d0\u05e4\u05d5\u05df|\u05e1\u05dc\u05d5\u05dc\u05e8\u05d9|\u05e4\u05e7\u05e1)(?![A-Za-z\u05d0-\u05ea])|(?<![A-Za-z\u05d0-\u05ea])[\u05d5\u05d1\u05dc\u05d4\u05de\u05e9]{0,2}(?:\u05d8\u05dc|\u05e4\u05dc)[\u0027\u05f3.:]|(?<![A-Za-z])(?:[Tt][Ee][Ll](?:[Ee][Pp][Hh][Oo][Nn][Ee])?|[Pp][Hh][Oo][Nn][Ee]|[Mm][Oo][Bb](?:[Ii][Ll][Ee])?|[Ff][Aa][Xx]|[Cc][Ee][Ll][Ll])(?![A-Za-z])|\u260e|\u260f|📞|📱))|(?<=(?:(?<![A-Za-z\u05d0-\u05ea])[\u05d5\u05d1\u05dc\u05d4\u05de\u05e9]{0,2}(?:\u05d8\u05dc\u05e4\u05d5\u05df|\u05e0\u05d9\u05d9\u05d3|\u05e4\u05dc\u05d0\u05e4\u05d5\u05df|\u05e1\u05dc\u05d5\u05dc\u05e8\u05d9|\u05e4\u05e7\u05e1)(?![A-Za-z\u05d0-\u05ea])|(?<![A-Za-z\u05d0-\u05ea])[\u05d5\u05d1\u05dc\u05d4\u05de\u05e9]{0,2}(?:\u05d8\u05dc|\u05e4\u05dc)[\u0027\u05f3.:]|(?<![A-Za-z])(?:[Tt][Ee][Ll](?:[Ee][Pp][Hh][Oo][Nn][Ee])?|[Pp][Hh][Oo][Nn][Ee]|[Mm][Oo][Bb](?:[Ii][Ll][Ee])?|[Ff][Aa][Xx]|[Cc][Ee][Ll][Ll])(?![A-Za-z])|\u260e|\u260f|📞|📱)[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d().:,;/|*#=>\u0027\u0022\u05f3\u05f4\ufe0f-]{0,4})(?:\*[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*[0-9]{4}|(?<![0-9])[0-9]{4}[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*\*)|(?:\*[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*[0-9]{4}|(?<![0-9])[0-9]{4}[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*\*)(?![0-9])(?=[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff\u05be\u2010-\u2015\u2212\ufe58\ufe63\uff0d().:,;/|*#=>\u0027\u0022\u05f3\u05f4\ufe0f-]{0,4}(?:(?<![A-Za-z\u05d0-\u05ea])[\u05d5\u05d1\u05dc\u05d4\u05de\u05e9]{0,2}(?:\u05d8\u05dc\u05e4\u05d5\u05df|\u05e0\u05d9\u05d9\u05d3|\u05e4\u05dc\u05d0\u05e4\u05d5\u05df|\u05e1\u05dc\u05d5\u05dc\u05e8\u05d9|\u05e4\u05e7\u05e1)(?![A-Za-z\u05d0-\u05ea])|(?<![A-Za-z\u05d0-\u05ea])[\u05d5\u05d1\u05dc\u05d4\u05de\u05e9]{0,2}(?:\u05d8\u05dc|\u05e4\u05dc)[\u0027\u05f3.:]|(?<![A-Za-z])(?:[Tt][Ee][Ll](?:[Ee][Pp][Hh][Oo][Nn][Ee])?|[Pp][Hh][Oo][Nn][Ee]|[Mm][Oo][Bb](?:[Ii][Ll][Ee])?|[Ff][Aa][Xx]|[Cc][Ee][Ll][Ll])(?![A-Za-z])|\u260e|\u260f|📞|📱)))(?![0-9])(?![:.][0-9]{2}(?![0-9]))(?:(?<=[0-9]{3})|(?![./][0-9]))'
      from (select app.contact_fold(p) as t) as f
  $$;

-- The gender a title says, and nothing else (src/import/speakerName.ts titleGender).
create or replace function app.title_gender(p text) returns text
  language sql immutable set search_path = ''
  as $$ select case p when 'הרב' then 'm' when 'הרבנית' then 'f' end $$;

-- A whole number from a JSON value, or NULL (anything else: a string, 1.5, an object).
create or replace function app.jint(p jsonb) returns bigint
  language sql immutable set search_path = ''
  as $$ select case when jsonb_typeof(p) = 'number' and (p #>> '{}') ~ '^-?[0-9]{1,15}$' then (p #>> '{}')::bigint end $$;

-- A JSON array's length; 0 for anything that is not an array.
create or replace function app.jlen(p jsonb) returns integer
  language sql immutable set search_path = ''
  as $$ select case when jsonb_typeof(p) = 'array' then jsonb_array_length(p) else 0 end $$;

-- The caller: a global admin (not_member, forbidden); their all-editions member id.
create or replace function app.require_global_admin() returns bigint
  language plpgsql stable security definer set search_path = ''
  as $$
  begin
    if not app.is_member() then perform app.refuse('not_member'); end if;
    if not app.is_global_admin() then perform app.refuse('forbidden'); end if;
    return app.my_member_id(null);
  end
  $$;

-- A row the import refuses: «import_bad_row», its row number and the reason in
-- the detail («7:bad_phone») — the whole import is rolled back.
create or replace function app.refuse_row(p_item jsonb, p_reason text) returns void
  language plpgsql set search_path = ''
  as $$
  begin
    raise exception using message = 'import_bad_row', errcode = 'P0001',
      detail = coalesce(app.jint(case when jsonb_typeof(p_item) = 'object' then p_item -> 'row' end), -1)::text || ':' || p_reason;
  end
  $$;

-- One speaker row: cleaned and checked (as src/data/importRules.ts cleanSpeakerRow,
-- in its order), then resolved — 'merge' completes the speaker named; 'new'
-- completes the one speaker with this name key (two: disambiguator_required),
-- else adds a speaker (vetted pending, source as typed) — never by a phone
-- alone (two names, one line, are two people; the preview turns a phone the
-- pool has into an explicit 'merge'). Completing fills ONLY what is empty — the
-- speaker's title (not one that says the other gender than the speaker's),
-- gender (not one its own title contradicts), affiliation,
-- topics, and the contacts' phone, e-mail, notes. 'contacts' says a phone or an
-- e-mail was filled, 'notes' the private note.
create or replace function app.import_speaker(p jsonb, p_titles_from bigint, p_source text, p_me bigint) returns jsonb
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_action  text := case when jsonb_typeof(p) = 'object' then p ->> 'action' end;
    v_name    text;
    v_key     text;
    v_title   text;
    v_gender  text;
    v_aff     text;
    v_topics  text[];
    v_phone   text;
    v_email   text;
    v_notes   text;
    v_n       integer;
    v_s       public.speakers;
    v_c       public.speaker_contacts;
    v_created boolean := false;
    v_fields  text[] := '{}';
    v_cfields text[] := '{}';
  begin
    if v_action is null or v_action not in ('new', 'merge') then perform app.refuse('bad_value'); end if;
    v_name := app.clean_line(case when jsonb_typeof(p -> 'name') = 'string' then p ->> 'name' end, 120);
    v_key := app.name_key(v_name);
    if v_name is null or v_key = '' then perform app.refuse('name_required'); end if;
    v_title  := app.pick_title(p ->> 'title', p_titles_from);
    v_gender := app.pick_gender(p ->> 'gender');
    if v_gender is not null and v_gender is distinct from app.title_gender(v_title) then perform app.refuse('bad_value'); end if;
    v_aff    := app.clean_line(p ->> 'affiliation', 120);
    v_topics := app.clean_topics(p -> 'topics');
    v_phone  := app.clean_line(p ->> 'phone', 40);
    if v_phone is not null and char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 6 then perform app.refuse('bad_phone'); end if;
    v_email  := app.clean_line(p ->> 'email', 120);
    if v_email is not null and v_email !~ '^[^ @]+@[^ @]+\.[^ @]+$' then perform app.refuse('bad_contact_email'); end if;
    v_notes  := app.clean_block(p ->> 'notes', 1000);
    -- a phone or an e-mail only in the phone and e-mail: never in the name, title, affiliation, a tag or the note
    -- (the browser takes them out — src/import/phone.ts stripContacts; this is the backstop)
    if app.has_contact(v_name) or app.has_contact(v_title) or app.has_contact(v_aff) or app.has_contact(v_notes)
       or exists (select 1 from unnest(v_topics) as t(x) where app.has_contact(t.x)) then
      perform app.refuse('contact_in_text');
    end if;

    if v_action = 'merge' then
      select * into v_s from public.speakers where id = app.jint(p -> 'speaker_id') for update;
      if v_s.id is null then perform app.refuse('stale'); end if;
    else
      select count(*) into v_n from public.speakers where name_key = v_key;
      if v_n > 1 then perform app.refuse('disambiguator_required'); end if;
      if v_n = 1 then
        select * into v_s from public.speakers where name_key = v_key for update;
      end if;
    end if;

    -- the pool's own title says the other gender: that gender is never filled from the row's title
    if v_s.id is not null and v_gender is not null and app.title_gender(v_s.title) is not null
       and app.title_gender(v_s.title) <> v_gender then
      v_gender := null;
    end if;
    -- …and the mirror: a title that says the other gender than the speaker's (its own, or the one filled now) is
    -- never filled — «הרבנית» is not written onto a man the pool knows, nor «הרב» onto a woman
    if v_s.id is not null and app.title_gender(v_title) is not null and coalesce(v_s.gender, v_gender) is not null
       and app.title_gender(v_title) <> coalesce(v_s.gender, v_gender) then
      v_title := null;
    end if;

    if v_s.id is null then
      begin
        insert into public.speakers (title, name, gender, affiliation, topics, vetted, created_by, source)
        values (v_title, v_name, v_gender, v_aff, v_topics, 'pending', p_me, p_source)
        returning * into v_s;
      exception when unique_violation then
        perform app.refuse('speaker_exists');   -- someone added the same name a moment ago
      end;
      v_created := true;
      perform app.log_event(null, 'speakers', v_s.id, 'insert', jsonb_build_object('vetted', 'pending', 'source', p_source));
    else
      select coalesce(array_agg(u.f order by u.o), '{}') into v_fields
        from unnest(array[
          case when v_s.title is null and v_title is not null then 'title' end,
          case when v_s.gender is null and v_gender is not null then 'gender' end,
          case when v_s.affiliation is null and v_aff is not null then 'affiliation' end,
          case when cardinality(v_s.topics) = 0 and cardinality(v_topics) > 0 then 'topics' end]) with ordinality as u(f, o)
       where u.f is not null;
      if cardinality(v_fields) > 0 then
        update public.speakers
           set title = coalesce(title, v_title), gender = coalesce(gender, v_gender), affiliation = coalesce(affiliation, v_aff),
               topics = case when cardinality(topics) = 0 then v_topics else topics end, version = version + 1
         where id = v_s.id;
        perform app.log_event(null, 'speakers', v_s.id, 'update', jsonb_build_object('fields', to_jsonb(v_fields)));
      end if;
    end if;

    select * into v_c from public.speaker_contacts where speaker_id = v_s.id for update;
    select coalesce(array_agg(u.f order by u.o), '{}') into v_cfields
      from unnest(array[
        case when v_c.phone is null and v_phone is not null then 'phone' end,
        case when v_c.email is null and v_email is not null then 'email' end,
        case when v_c.notes is null and v_notes is not null then 'notes' end]) with ordinality as u(f, o)
     where u.f is not null;
    if cardinality(v_cfields) > 0 then
      insert into public.speaker_contacts (speaker_id, phone, email, notes) values (v_s.id, v_phone, v_email, v_notes)
      on conflict (speaker_id) do update
        set phone = coalesce(speaker_contacts.phone, excluded.phone),
            email = coalesce(speaker_contacts.email, excluded.email),
            notes = coalesce(speaker_contacts.notes, excluded.notes);
      perform app.log_event(null, 'speakers', v_s.id, 'contacts', jsonb_build_object('fields', to_jsonb(v_cfields)));
    end if;
    return jsonb_build_object('speaker_id', v_s.id, 'created', v_created, 'filled', cardinality(v_fields) > 0,
                              'contacts', 'phone' = any (v_cfields) or 'email' = any (v_cfields), 'notes', 'notes' = any (v_cfields));
  end
  $$;

-- The speaker rows of a payload, each refused as its row: their results, in order.
create or replace function app.import_speakers(p_rows jsonb, p_titles_from bigint, p_source text, p_me bigint) returns jsonb[]
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_item jsonb;
    v_out  jsonb[] := '{}';
  begin
    for v_item in select x from jsonb_array_elements(p_rows) as t(x) loop
      begin
        v_out := v_out || app.import_speaker(v_item, p_titles_from, p_source, p_me);
      exception when sqlstate 'P0001' then
        if sqlerrm = 'import_bad_row' then raise; end if;
        perform app.refuse_row(v_item, sqlerrm);
      end;
    end loop;
    return v_out;
  end
  $$;

-- A parallel room of an archive edition: 0 its default room, k «מקביל k+1» (made when first needed).
create or replace function app.import_room(p_edition bigint, p_index integer) returns bigint
  language plpgsql security definer set search_path = ''
  as $$
  declare v bigint;
  begin
    if p_index = 0 then return app.default_room(p_edition); end if;
    select id into v from public.rooms where edition_id = p_edition and name = 'מקביל ' || (p_index + 1);
    if v is null then
      insert into public.rooms (edition_id, name, sort) values (p_edition, 'מקביל ' || (p_index + 1), p_index + 1) returning id into v;
    end if;
    return v;
  end
  $$;

-- The import's commit: one transaction, every row or none (docs/CONTRACT.md «The import of 5786»).
create or replace function public.import_commit(p_kind text, p_payload jsonb) returns jsonb
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_me       bigint := app.require_global_admin();
    v_titles   bigint;
    v_source   text;
    v_label    text;
    v_date     date;
    v_ed       public.editions;
    v_res      jsonb[];
    v_r        jsonb;
    v_ids      bigint[] := '{}';
    v_item     jsonb;
    v_lid      bigint;
    v_sid      bigint;
    v_seen     bigint[];
    v_ref      jsonb;
    v_refs     bigint[];
    v_c        text;
    v_day      bigint;
    v_start    bigint;
    v_end      bigint;
    v_room     bigint;
    v_title    text;
    v_cat      bigint;
    v_aud      text;
    v_kind     text;
    v_print    text;
    v_snote    text;
    v_pay      bigint;
    v_inote    text;
    v_s        public.speakers;
    v_cn       public.speaker_contacts;
    v_pref     text;
    v_sec      text;
    v_created  integer := 0;
    v_merged   integer := 0;
    v_filled   integer := 0;
    v_contacts integer := 0;
    v_notes    integer := 0;
    v_lessons  integer := 0;
    v_replaced integer := 0;
    v_rows     jsonb := '[]';
  begin
    if p_kind is null or p_kind not in ('candidates', 'tracking', 'escorts') then perform app.refuse('bad_value'); end if;
    if p_payload is null or jsonb_typeof(p_payload) <> 'object' then perform app.refuse('bad_value'); end if;
    if (case when p_kind = 'tracking' then app.jlen(p_payload -> 'speakers') + app.jlen(p_payload -> 'lessons') else app.jlen(p_payload -> 'rows') end) > 1000
       or octet_length(p_payload::text) > 1000000 then
      perform app.refuse('import_too_big');
    end if;
    v_titles := app.jint(p_payload -> 'titles_from');

    if p_kind = 'candidates' then
      if jsonb_typeof(p_payload -> 'rows') is distinct from 'array' then perform app.refuse('bad_value'); end if;
      v_source := app.clean_line(p_payload ->> 'source', 60);
      if v_source is null then perform app.refuse('bad_value'); end if;
      if app.has_contact(v_source) then perform app.refuse('contact_in_text'); end if;
      v_res := app.import_speakers(p_payload -> 'rows', v_titles, v_source, v_me);

    elsif p_kind = 'tracking' then
      if jsonb_typeof(p_payload -> 'speakers') is distinct from 'array' or jsonb_typeof(p_payload -> 'lessons') is distinct from 'array' then
        perform app.refuse('bad_value');
      end if;
      v_label := app.label_key(app.clean_line(case when jsonb_typeof(p_payload -> 'label') = 'string' then p_payload ->> 'label' end, 60));
      if v_label = '' then perform app.refuse('label_required'); end if;
      if app.has_contact(v_label) then perform app.refuse('contact_in_text'); end if;
      if jsonb_typeof(p_payload -> 'start_date') = 'string' and p_payload ->> 'start_date' <> '' then
        if p_payload ->> 'start_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then perform app.refuse('bad_value'); end if;
        begin
          v_date := (p_payload ->> 'start_date')::date;
        exception when others then
          perform app.refuse('bad_value');
        end;
        if to_char(v_date, 'YYYY-MM-DD') <> p_payload ->> 'start_date' then perform app.refuse('bad_value'); end if;
        if extract(dow from v_date) <> 0 then perform app.refuse('not_sunday'); end if;
      elsif jsonb_typeof(p_payload -> 'start_date') not in ('null', 'string') then
        perform app.refuse('bad_value');
      end if;
      -- the label as the key compares it: «תשפ״ו», «תשפ"ו» and «תשפ”ו» are one archive; two editions already
      -- answering to it (made before the key) are not guessed between
      if (select count(*) from public.editions where app.label_key(label) = v_label) > 1 then perform app.refuse('label_ambiguous'); end if;
      select * into v_ed from public.editions where app.label_key(label) = v_label for update;
      if v_ed.id is not null and v_ed.kind <> 'archive' then perform app.refuse('edition_exists'); end if;
      -- the replace deletes the lessons, and «איך עבר» (Milestone 6, below) with them: an archive with a review is kept
      if v_ed.id is not null and exists (select 1 from public.lesson_reviews r where r.edition_id = v_ed.id) then
        perform app.refuse('archive_reviewed');
      end if;
      v_source := app.clean_line(p_payload ->> 'source', 60);
      if v_source is null then perform app.refuse('bad_value'); end if;
      if app.has_contact(v_source) then perform app.refuse('contact_in_text'); end if;
      v_res := app.import_speakers(p_payload -> 'speakers', v_titles, v_source, v_me);
      foreach v_r in array v_res loop v_ids := v_ids || (v_r ->> 'speaker_id')::bigint; end loop;

      -- the edition: made from the template (as start_edition makes one), or the same label again — its lessons replaced
      if v_ed.id is null then
        begin
          insert into public.editions (label, kind, status, start_date) values (v_label, 'archive', 'archived', v_date) returning * into v_ed;
        exception when unique_violation then
          perform app.refuse('stale');   -- the same label, made by another import a moment ago
        end;
        insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days)
        select v_ed.id, start_min, end_min, kind, label, days from public.grid_template;
        insert into public.rooms (edition_id, name, sort, is_default) values (v_ed.id, 'בית מדרש', 1, true);
      else
        delete from public.lessons where edition_id = v_ed.id;
        get diagnostics v_replaced = row_count;
        update public.editions set start_date = v_date where id = v_ed.id and start_date is distinct from v_date;
        if not exists (select 1 from public.rooms where edition_id = v_ed.id) then
          insert into public.rooms (edition_id, name, sort, is_default) values (v_ed.id, 'בית מדרש', 1, true);
        end if;
      end if;

      -- the lessons, closed, each checked as src/data/importRules.ts cleanLessonRow (in its order)
      for v_item in select x from jsonb_array_elements(p_payload -> 'lessons') as t(x) loop
        begin
          if jsonb_typeof(v_item) <> 'object' then perform app.refuse('bad_value'); end if;
          v_day := app.jint(v_item -> 'day');
          v_start := app.jint(v_item -> 'start_min');
          v_end := app.jint(v_item -> 'end_min');
          if v_day is null or v_start is null or v_end is null or v_day not between 0 and 4 or v_start < 390 or v_end > 1830
             or v_start >= v_end or v_start % 5 <> 0 or v_end % 5 <> 0 then
            perform app.refuse('bad_shape');
          end if;
          -- the archive's own week (its grid's rule): nothing on Thursday after it ended (last_day_until — last year's
          -- ended at 19:00), nothing on Sunday before it opened (first_day_from, when known)
          if (v_day = 4 and v_end > v_ed.last_day_until) or (v_day = 0 and v_ed.first_day_from is not null and v_start < v_ed.first_day_from) then
            perform app.refuse('bad_shape');
          end if;
          v_room := app.jint(v_item -> 'room');
          if v_room is null or v_room < 0 or v_room >= 10 then perform app.refuse('bad_value'); end if;
          v_title := app.clean_line(v_item ->> 'title', 200);
          v_cat := app.jint(v_item -> 'category_id');
          if jsonb_typeof(v_item -> 'category_id') not in ('null') and v_item ? 'category_id'
             and (v_cat is null or not exists (select 1 from public.categories where id = v_cat)) then
            perform app.refuse('bad_value');
          end if;
          v_aud := app.clean_line(v_item ->> 'audience', 120);
          v_kind := v_item ->> 'sources_kind';
          if v_kind is null or v_kind not in ('pending', 'sheet', 'presentation', 'sheet_presentation', 'sheet_video', 'none', 'other') then
            perform app.refuse('bad_value');
          end if;
          v_print := v_item ->> 'print_when';
          if v_print is null or v_print not in ('none', 'before', 'same_day') then perform app.refuse('bad_value'); end if;
          v_snote := app.clean_block(v_item ->> 'sources_note', 500);
          if v_item ? 'pay_amount' and jsonb_typeof(v_item -> 'pay_amount') <> 'null' then
            v_pay := app.jint(v_item -> 'pay_amount');
            if v_pay is null or v_pay < 1 or v_pay > 100000 then perform app.refuse('bad_amount'); end if;
          else
            v_pay := null;
          end if;
          v_inote := app.clean_block(v_item ->> 'import_note', 1000);
          -- the team reads a lesson: no phone or e-mail in its title, audience or notes
          if app.has_contact(v_title) or app.has_contact(v_aud) or app.has_contact(v_snote) or app.has_contact(v_inote) then
            perform app.refuse('contact_in_text');
          end if;
          v_refs := '{}';
          if jsonb_typeof(v_item -> 'speakers') = 'array' then
            for v_ref in select x from jsonb_array_elements(v_item -> 'speakers') as t(x) loop
              if app.jint(v_ref) is null or app.jint(v_ref) < 0 or app.jint(v_ref) >= cardinality(v_ids) or app.jint(v_ref) = any (v_refs) then
                perform app.refuse('bad_value');
              end if;
              v_refs := v_refs || app.jint(v_ref);
            end loop;
          end if;
          if cardinality(v_refs) = 0 then perform app.refuse('bad_value'); end if;

          insert into public.lessons (edition_id, kind, state, day, start_min, end_min, room_id, title, category_id, audience,
                                      sources_kind, print_when, sources_note, pay_amount, updated_by)
          values (v_ed.id, 'lesson', 'closed', v_day, v_start, v_end, app.import_room(v_ed.id, v_room::integer), v_title, v_cat, v_aud,
                  v_kind, v_print, v_snote, v_pay, v_me)
          returning id into v_lid;
          if v_inote is not null then
            insert into public.lesson_import_notes (lesson_id, edition_id, note) values (v_lid, v_ed.id, v_inote);
          end if;
          -- its speakers: the first leads; two rows that became one pool speaker are one speaker here
          v_seen := '{}';
          foreach v_sid in array v_refs loop
            v_sid := v_ids[v_sid + 1];
            continue when v_sid = any (v_seen);
            insert into public.lesson_speakers (lesson_id, speaker_id, role)
            values (v_lid, v_sid, case when cardinality(v_seen) = 0 then 'lead' else 'co' end);
            v_seen := v_seen || v_sid;
          end loop;
          v_lessons := v_lessons + 1;
        exception
          when sqlstate 'P0001' then
            if sqlerrm = 'import_bad_row' then raise; end if;
            perform app.refuse_row(v_item, sqlerrm);
          when exclusion_violation then
            get stacked diagnostics v_c = constraint_name;
            perform app.refuse_row(v_item, app.exclusion_code(v_c));
        end;
      end loop;

    else -- 'escorts': how a speaker is reached — fill-empty only. The channel the admin CHOSE from the list and the
         -- note the admin TYPED: a row has no key for the file's own text, and one with any other key is refused
      if jsonb_typeof(p_payload -> 'rows') is distinct from 'array' then perform app.refuse('bad_value'); end if;
      v_res := '{}';
      for v_item in select x from jsonb_array_elements(p_payload -> 'rows') as t(x) loop
        begin
          if jsonb_typeof(v_item) <> 'object' then perform app.refuse('bad_value'); end if;
          if exists (select 1 from jsonb_object_keys(v_item) as k(x) where k.x not in ('row', 'speaker_id', 'channel', 'note')) then
            perform app.refuse('bad_value');
          end if;
          select * into v_s from public.speakers where id = app.jint(v_item -> 'speaker_id') for update;
          if v_s.id is null then perform app.refuse('stale'); end if;
          if jsonb_typeof(v_item -> 'channel') is distinct from 'string'
             or (v_item ->> 'channel') not in ('phone', 'whatsapp', 'email', 'secretary', 'other') then
            perform app.refuse('bad_value');
          end if;
          if coalesce(jsonb_typeof(v_item -> 'note'), 'null') not in ('string', 'null') then perform app.refuse('bad_value'); end if;
          -- «other»: none of the pool's channels — contact_pref is left as it is, the note says how
          v_pref := nullif(v_item ->> 'channel', 'other');
          v_sec := app.clean_block(v_item ->> 'note', 300);
          if app.has_contact(v_sec) then perform app.refuse('contact_in_text'); end if;
          v_r := jsonb_build_object('speaker_id', v_s.id, 'created', false, 'filled', false, 'contacts', false, 'notes', false);
          if v_s.contact_pref is null and v_pref is not null then
            update public.speakers set contact_pref = v_pref, version = version + 1 where id = v_s.id;
            perform app.log_event(null, 'speakers', v_s.id, 'update', jsonb_build_object('fields', jsonb_build_array('contact_pref')));
            v_r := v_r || jsonb_build_object('filled', true);
          end if;
          select * into v_cn from public.speaker_contacts where speaker_id = v_s.id for update;
          if v_cn.secretary_note is null and v_sec is not null then
            insert into public.speaker_contacts (speaker_id, secretary_note) values (v_s.id, v_sec)
            on conflict (speaker_id) do update set secretary_note = coalesce(speaker_contacts.secretary_note, excluded.secretary_note);
            perform app.log_event(null, 'speakers', v_s.id, 'contacts', jsonb_build_object('fields', jsonb_build_array('secretary_note')));
            v_r := v_r || jsonb_build_object('contacts', true);
          end if;
          v_res := v_res || v_r;
        exception when sqlstate 'P0001' then
          if sqlerrm = 'import_bad_row' then raise; end if;
          perform app.refuse_row(v_item, sqlerrm);
        end;
      end loop;
    end if;

    -- the result: counts, and each speaker row as resolved
    for v_r, v_item in
      select r, coalesce(case when p_kind = 'tracking' then p_payload -> 'speakers' else p_payload -> 'rows' end -> (o::integer - 1), '{}')
        from unnest(v_res) with ordinality as u(r, o)
    loop
      if (v_r ->> 'created')::boolean then v_created := v_created + 1; else v_merged := v_merged + 1; end if;
      if (v_r ->> 'filled')::boolean then v_filled := v_filled + 1; end if;
      if (v_r ->> 'contacts')::boolean then v_contacts := v_contacts + 1; end if;
      if (v_r ->> 'notes')::boolean then v_notes := v_notes + 1; end if;
      v_rows := v_rows || jsonb_build_object('row', coalesce(app.jint(v_item -> 'row'), -1), 'speaker_id', (v_r ->> 'speaker_id')::bigint,
                                             'created', (v_r ->> 'created')::boolean);
    end loop;
    -- the log: counts and the label — never a name, a phone or a note
    perform app.log_event(v_ed.id, 'import', v_ed.id, p_kind, jsonb_build_object(
      'rows', cardinality(v_res), 'created', v_created, 'merged', v_merged, 'filled', v_filled, 'contacts', v_contacts, 'notes', v_notes,
      'lessons', v_lessons, 'replaced', v_replaced) || case when v_source is not null then jsonb_build_object('source', v_source) else '{}' end);
    return jsonb_build_object('created', v_created, 'merged', v_merged, 'filled', v_filled, 'contacts', v_contacts, 'notes', v_notes,
                              'lessons', v_lessons, 'replaced', v_replaced, 'edition_id', v_ed.id, 'speakers', v_rows);
  end
  $$;

-- What the preview needs from the pool beyond the names: which speaker has one
-- of these phones (by key), and which contact fields of these speakers (and of
-- those the phones found) are filled — true/false, never a value. A global admin.
create or replace function public.import_lookup(p_speakers bigint[], p_phone_keys text[]) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
  begin
    perform app.require_global_admin();
    if coalesce(cardinality(p_speakers), 0) > 5000 or coalesce(cardinality(p_phone_keys), 0) > 5000 then perform app.refuse('import_too_big'); end if;
    return (
      with phones as (
        select distinct k.key, c.speaker_id
          from unnest(coalesce(p_phone_keys, '{}'::text[])) as k(key)
          join public.speaker_contacts c on app.phone_key(c.phone) = k.key
      )
      select jsonb_build_object(
        'phones', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'speaker_id', speaker_id) order by key, speaker_id) from phones), '[]'::jsonb),
        'contacts', coalesce((
          select jsonb_agg(jsonb_build_object('speaker_id', s.id, 'phone', c.phone is not null, 'email', c.email is not null,
                                              'secretary_note', c.secretary_note is not null, 'notes', c.notes is not null) order by s.id)
            from public.speakers s left join public.speaker_contacts c on c.speaker_id = s.id
           where s.id = any (coalesce(p_speakers, '{}'::bigint[])) or s.id in (select speaker_id from phones)), '[]'::jsonb)));
  end
  $$;


-- =============================================================================
-- Milestone 6 (v12) — after the week. Semantics: docs/CONTRACT.md «After the
-- week»; the in-memory twin is src/data/engine.ts (reviews, the purge) and
-- src/data/demoSettings.ts (start_edition's option, the dry run), held to this
-- by tests/parity and the unit tests.
--
--   lesson_reviews        «איך עבר» — one per closed lesson: what went well, what
--                         did not, invite again (yes / no / maybe), overran, a
--                         rating 1–5 (optional); the lead speaker it is about,
--                         who wrote it and when, a version. Opinions about a
--                         person: the edition's admins and content members read
--                         them — never logistics, never a link, never the
--                         designer's export, never load_week, never Realtime.
--                         Written through save_lesson_review only.
--   save_lesson_review    the lesson's handler or an admin of the edition; the
--                         handler only once the lesson's day has passed in Israel
--                         time (app.review_opens_on) — never while the week's
--                         date is TBD; an admin always; an archive: admins only.
--   load_reviews          the edition's reviews, as the policy shows them (invoker).
--   speaker_reviews       a speaker's reviews across the years, for the speaker
--                         sheet: a global admin, or an admin or content member of
--                         a live real edition (app.may_read_reviews — the
--                         people the contacts rule counts); past years, and a
--                         live edition only to its own admins and content.
--   edition_returning     which speakers of an edition taught in an earlier year
--                         (the summary's «חדשים / חוזרים»), with those years.
--   purge_edition_private a global admin, once the week is over (Israel time:
--                         Friday 00:00, start_date + 5 — when the links expire)
--                         or the edition is archived, with the edition's label
--                         typed: deletes its transport details (pickup addresses,
--                         drivers' names and phones) — and, in an edition the
--                         import of 5786 made, the sheet's notes (lesson_import_notes:
--                         its transport and payment words) —, revokes every link of it
--                         and deletes the links' rate-limit counts (hashed
--                         addresses); keeps everything else (DECISIONS «אבן דרך
--                         6», table by table). editions.purged_at says when (the
--                         first time); the log has the counts, never a value.
--                         Idempotent: a second run deletes nothing more.
--   start_edition         (above) gains p_deactivate_team.
--   start_edition_preview the dry run: what start_edition would archive, copy,
--                         deactivate and leave as it is — counts. STABLE (PL/pgSQL
--                         runs it read-only): it cannot write.
-- lesson_reviews is never published to Realtime (the list at the end): the
-- lesson panel and the summary read it when they open, and after a save.
-- =============================================================================

-- ------------------------------------------------------------- «איך עבר»

create table if not exists public.lesson_reviews (
  lesson_id    bigint primary key references public.lessons (id) on delete cascade,
  edition_id   bigint not null references public.editions (id) on delete cascade,
  speaker_id   bigint references public.speakers (id) on delete set null,   -- the lead speaker when it was written
  went_well    text check (char_length(went_well) <= 2000),
  issues       text check (char_length(issues) <= 2000),
  invite_again text check (invite_again in ('yes', 'no', 'maybe')),
  overran      boolean not null default false,
  rating       smallint check (rating between 1 and 5),
  written_by   bigint,
  written_at   timestamptz not null default now(),
  version      integer not null default 1
);
create index if not exists lesson_reviews_edition on public.lesson_reviews (edition_id);
create index if not exists lesson_reviews_speaker on public.lesson_reviews (speaker_id);
alter table public.lesson_reviews enable row level security;

-- Opinions about a person: the edition's admins and content members — never its
-- logistics members (public/privacy.html says exactly this).
drop policy if exists lesson_reviews_read on public.lesson_reviews;
create policy lesson_reviews_read on public.lesson_reviews for select to authenticated
  using (app.my_role(edition_id) in ('admin', 'content'));

-- The first Israel date on which a lesson's «איך עבר» opens to its handler: the
-- day after the calendar day the lesson ends on — a night lesson in a day's
-- column (00:30, end_min 1560) ends on the next date. src/domain/reviews.ts
-- (reviewOpensOn) is the same rule.
create or replace function app.review_opens_on(p_start date, p_day integer, p_end integer) returns date
  language sql immutable set search_path = ''
  as $$ select p_start + p_day + ((p_end - 1) / 1440) + 1 $$;

-- May the caller read «איך עבר» across the years? A global admin, or an admin
-- or content member of a real edition that is not archived — a practice or demo
-- week, last year's team and logistics give no access (the contacts' rule).
create or replace function app.may_read_reviews() returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select app.is_global_admin() or exists (
      select 1 from public.editions e
       where e.kind = 'real' and e.status <> 'archived' and app.my_role(e.id) in ('admin', 'content'))
  $$;

-- Is `p_other` a year before `p_this`? By the weeks' dates when both are known;
-- otherwise a past year (an archive, or an archived real edition) is before one
-- that is not. src/domain/reviews.ts (earlierEdition) is the same rule.
create or replace function app.earlier_edition(p_other public.editions, p_this public.editions) returns boolean
  language sql immutable set search_path = ''
  as $$
    select case
      when p_other.start_date is not null and p_this.start_date is not null then p_other.start_date < p_this.start_date
      else (p_other.kind = 'archive' or p_other.status = 'archived') and not (p_this.kind = 'archive' or p_this.status = 'archived')
    end
  $$;

-- Write (or rewrite) a closed lesson's «איך עבר», at the version on screen (0: none
-- yet). Refusals, in this order: the lesson gone `stale`; not a member
-- `not_member`; logistics `forbidden`; an archive `archived` (its admins may);
-- not a closed lesson `not_closed`; neither its handler nor an admin
-- `not_handler`; the handler before the lesson's day has passed in Israel, or
-- while the week's date is TBD, `review_closed`; another version `stale`; a text
-- longer than 2000, an answer outside yes/no/maybe or a rating outside 1–5
-- `bad_value`; nothing at all `review_empty`. The same answers again change
-- nothing. Returns the version saved.
create or replace function public.save_lesson_review(
  p_lesson bigint, p_version integer, p_went_well text, p_issues text, p_invite_again text, p_overran boolean, p_rating integer)
  returns integer
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_l    public.lessons;
    v_ed   public.editions;
    v_role text;
    v_me   bigint;
    v_old  public.lesson_reviews;
    v_ww   text;
    v_is   text;
    v_ia   text;
    v_ov   boolean := coalesce(p_overran, false);
    v_lead bigint;
    v_v    integer;
  begin
    select * into v_l from public.lessons where id = p_lesson for update;
    if v_l.id is null or v_l.state = 'cancelled' then perform app.refuse('stale'); end if;
    v_role := app.my_role(v_l.edition_id);
    if v_role is null then perform app.refuse('not_member'); end if;
    if v_role = 'logistics' then perform app.refuse('forbidden'); end if;
    select * into v_ed from public.editions where id = v_l.edition_id;
    if (v_ed.kind = 'archive' or v_ed.status = 'archived') and v_role <> 'admin' then perform app.refuse('archived'); end if;
    if v_l.state <> 'closed' or v_l.kind <> 'lesson' then perform app.refuse('not_closed'); end if;
    v_me := app.my_member_id(v_l.edition_id);
    if v_role <> 'admin' then
      if app.lesson_handler(v_l.id) is distinct from v_me then perform app.refuse('not_handler'); end if;
      if v_ed.start_date is null
         or (now() at time zone 'Asia/Jerusalem')::date < app.review_opens_on(v_ed.start_date, v_l.day, v_l.end_min) then
        perform app.refuse('review_closed');
      end if;
    end if;
    select * into v_old from public.lesson_reviews where lesson_id = v_l.id for update;
    if coalesce(v_old.version, 0) is distinct from p_version then perform app.refuse('stale'); end if;
    v_ww := app.clean_block(p_went_well, 2000);
    v_is := app.clean_block(p_issues, 2000);
    v_ia := nullif(btrim(coalesce(p_invite_again, '')), '');
    if v_ia is not null and v_ia not in ('yes', 'no', 'maybe') then perform app.refuse('bad_value'); end if;
    if p_rating is not null and p_rating not between 1 and 5 then perform app.refuse('bad_value'); end if;
    if v_ww is null and v_is is null and v_ia is null and p_rating is null and not v_ov then perform app.refuse('review_empty'); end if;
    select x.speaker_id into v_lead from public.lesson_speakers x where x.lesson_id = v_l.id and x.role = 'lead' limit 1;
    if v_old.lesson_id is not null
       and (v_old.went_well, v_old.issues, v_old.invite_again, v_old.overran, v_old.rating::integer, v_old.speaker_id)
           is not distinct from (v_ww, v_is, v_ia, v_ov, p_rating, v_lead) then
      return v_old.version;
    end if;
    insert into public.lesson_reviews as r (lesson_id, edition_id, speaker_id, went_well, issues, invite_again, overran, rating, written_by, written_at, version)
    values (v_l.id, v_l.edition_id, v_lead, v_ww, v_is, v_ia, v_ov, p_rating, v_me, now(), 1)
    on conflict (lesson_id) do update
      set speaker_id = excluded.speaker_id, went_well = excluded.went_well, issues = excluded.issues, invite_again = excluded.invite_again,
          overran = excluded.overran, rating = excluded.rating, written_by = excluded.written_by, written_at = now(), version = r.version + 1
    returning r.version into v_v;
    return v_v;
  end
  $$;

-- The edition's reviews, through the policy (invoker): its admins and content
-- members see them all; anyone else none.
create or replace function public.load_reviews(p_edition bigint) returns jsonb
  language sql stable security invoker set search_path = ''
  as $$
    select coalesce(jsonb_agg(jsonb_build_object(
             'lesson_id', r.lesson_id, 'speaker_id', r.speaker_id, 'went_well', r.went_well, 'issues', r.issues,
             'invite_again', r.invite_again, 'overran', r.overran, 'rating', r.rating, 'written_by', r.written_by,
             'written_at', to_char(r.written_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'version', r.version)
             order by r.lesson_id), '[]'::jsonb)
      from public.lesson_reviews r where r.edition_id = p_edition
  $$;

-- A speaker's «איך עבר» across the years, for the speaker sheet: the reviews
-- written about them (as the lesson's lead) in real and archive editions — a
-- past year (an archive, an archived real edition) to whoever may read reviews
-- at all (app.may_read_reviews), a live edition only to its own admins and
-- content members. Never a practice or demo week; never who wrote it. The
-- newest year first (a year whose date is TBD — this one, usually — at the top).
create or replace function public.speaker_reviews(p_speaker bigint) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
  begin
    if not app.is_member() then perform app.refuse('not_member'); end if;
    if not app.may_read_reviews() then perform app.refuse('forbidden'); end if;
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'edition_id', e.id, 'edition_label', e.label, 'edition_kind', e.kind, 'start_date', e.start_date,
               'lesson_id', l.id, 'day', l.day, 'start_min', l.start_min, 'end_min', l.end_min, 'title', l.title,
               'went_well', r.went_well, 'issues', r.issues, 'invite_again', r.invite_again, 'overran', r.overran,
               'rating', r.rating, 'written_at', app.iso(r.written_at))
             order by e.start_date desc nulls first, e.id desc, l.day, l.start_min, l.id)
        from public.lesson_reviews r
        join public.lessons l on l.id = r.lesson_id
        join public.editions e on e.id = r.edition_id
       where r.speaker_id = p_speaker and e.kind in ('real', 'archive')
         and (e.kind = 'archive' or e.status = 'archived' or app.my_role(e.id) in ('admin', 'content'))), '[]'::jsonb);
  end
  $$;

-- «סיכום המחזור»: the speakers of the edition's closed lessons who taught a
-- closed lesson in an earlier real or archive year (app.earlier_edition), each
-- with those years' labels. The edition's admins and content members.
create or replace function public.edition_returning(p_edition bigint) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
  declare
    v_role text := app.my_role(p_edition);
    v_ed   public.editions;
  begin
    if v_role is null then perform app.refuse('not_member'); end if;
    if v_role = 'logistics' then perform app.refuse('forbidden'); end if;
    select * into v_ed from public.editions where id = p_edition;
    return coalesce((
      select jsonb_agg(jsonb_build_object('speaker_id', t.speaker_id, 'editions', t.labels) order by t.speaker_id)
        from (select s.speaker_id,
                     (select jsonb_agg(o.label order by o.start_date nulls first, o.id)
                        from public.editions o
                       where o.id <> p_edition and o.kind in ('real', 'archive') and app.earlier_edition(o, v_ed)
                         and exists (select 1 from public.lesson_speakers y join public.lessons m on m.id = y.lesson_id
                                      where y.speaker_id = s.speaker_id and m.edition_id = o.id and m.state = 'closed' and m.kind = 'lesson')) as labels
                from (select distinct x.speaker_id from public.lesson_speakers x join public.lessons l on l.id = x.lesson_id
                       where l.edition_id = p_edition and l.state = 'closed' and l.kind = 'lesson') s) t
       where t.labels is not null), '[]'::jsonb);
  end
  $$;

-- ------------------------------------------------------------- the purge

-- When an edition's private data was deleted (the first purge) — written only by
-- purge_edition_private: any other write keeps it as it was (a global admin
-- writes editions directly, and must not mark one purged that is not).
alter table public.editions add column if not exists purged_at timestamptz;

create or replace function app.editions_purged_guard() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if coalesce(current_setting('app.purging', true), '') <> 'on' then
      if tg_op = 'INSERT' then new.purged_at := null; else new.purged_at := old.purged_at; end if;
    end if;
    return new;
  end
  $$;
drop trigger if exists editions_purged_guard on public.editions;
create trigger editions_purged_guard before insert or update on public.editions
  for each row execute function app.editions_purged_guard();

-- After the week (DESIGN «שלבים», שלב 4): a global admin's irreversible action.
-- Refusals, in this order: not a global admin `forbidden`; no such edition
-- `stale`; the label not typed exactly `confirm_mismatch`; the week not over yet
-- (Israel time, before Friday 00:00 = start_date + 5; the date TBD) and the
-- edition not archived `week_not_over`. Then: the transport details of its
-- lessons deleted, its lessons' import notes deleted (lesson_import_notes: the
-- import of 5786 keeps last year's transport and payment words there — an
-- archive it made is purged of them as a live edition is of its transport
-- details), its links revoked
-- (the anon functions answer `link_invalid` from now on) and their rate-limit
-- counts deleted. Returns the counts; logs
-- them (and nothing else) in the edition's activity.
create or replace function public.purge_edition_private(p_edition bigint, p_confirm text) returns jsonb
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_ed  public.editions;
    v_t   integer;
    v_l   integer;
    v_h   integer;
    v_n   integer;
    v_at  timestamptz;
  begin
    if not app.is_global_admin() then perform app.refuse('forbidden'); end if;
    select * into v_ed from public.editions where id = p_edition for update;
    if v_ed.id is null then perform app.refuse('stale'); end if;
    if p_confirm is null or btrim(p_confirm) <> v_ed.label then perform app.refuse('confirm_mismatch'); end if;
    if not (v_ed.kind = 'archive' or v_ed.status = 'archived'
            or (v_ed.start_date is not null and (now() at time zone 'Asia/Jerusalem')::date >= v_ed.start_date + 5)) then
      perform app.refuse('week_not_over');
    end if;
    delete from public.transport_details t using public.lessons l where l.id = t.lesson_id and l.edition_id = p_edition;
    get diagnostics v_t = row_count;
    delete from public.lesson_import_notes where edition_id = p_edition;
    get diagnostics v_n = row_count;
    delete from public.share_link_hits h using public.share_links s where s.token_hash = h.token_hash and s.edition_id = p_edition;
    get diagnostics v_h = row_count;
    update public.share_links set revoked_at = now() where edition_id = p_edition and revoked_at is null;
    get diagnostics v_l = row_count;
    v_at := coalesce(v_ed.purged_at, now());
    perform set_config('app.purging', 'on', true);
    update public.editions set purged_at = v_at where id = p_edition and purged_at is null;
    perform set_config('app.purging', '', true);
    perform app.log_event(p_edition, 'editions', p_edition, 'purge',
                          jsonb_build_object('transport_details', v_t, 'import_notes', v_n, 'links_revoked', v_l, 'link_hits', v_h));
    return jsonb_build_object('transport_details', v_t, 'import_notes', v_n, 'links_revoked', v_l, 'link_hits', v_h, 'purged_at', app.iso(v_at));
  end
  $$;

-- ------------------------------------------------------------- moving to next year

-- The dry run of public.start_edition (a global admin): which editions it would
-- archive, where the wording and milestones would come from and how many, how
-- many grid rows, how many of the archived editions' members it would
-- deactivate (with p_deactivate_team) and how many of their admins stay — and
-- what stays across the years as it is. Counts and labels; never an address.
-- STABLE: PL/pgSQL runs it read-only, so it cannot write.
create or replace function public.start_edition_preview(p_deactivate_team boolean default true) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
  declare
    v_from public.editions;
  begin
    if not app.is_global_admin() then perform app.refuse('forbidden'); end if;
    select * into v_from from public.editions where kind = 'real' order by (status <> 'archived') desc, id desc limit 1;
    return jsonb_build_object(
      'archive', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'label', e.label) order by e.id)
                             from public.editions e where e.kind = 'real' and e.status <> 'archived'), '[]'::jsonb),
      'carry_from', case when v_from.id is null then null else jsonb_build_object('id', v_from.id, 'label', v_from.label) end,
      'grid_rows', (select count(*) from public.grid_template)::integer,
      'milestones', (select count(*) from public.milestones m where m.edition_id = v_from.id)::integer,
      'confirm_template', coalesce(v_from.settings ? 'confirm_template', false),
      'duty_phrases', coalesce(case when jsonb_typeof(v_from.settings -> 'duty_phrases') = 'array' then jsonb_array_length(v_from.settings -> 'duty_phrases') end, 0),
      'deactivate', case when coalesce(p_deactivate_team, false) then
                      (select count(*) from public.members m
                        where m.active and m.role <> 'admin'
                          and m.edition_id in (select id from public.editions where kind = 'real' and status <> 'archived'))::integer
                    else 0 end,
      'admins_stay', (select count(*) from public.members m
                       where m.active and m.role = 'admin'
                         and m.edition_id in (select id from public.editions where kind = 'real' and status <> 'archived'))::integer,
      'stays', jsonb_build_object(
        'speakers', (select count(*) from public.speakers s where not s.retired)::integer,
        'categories', (select count(*) from public.categories c where c.active)::integer,
        'fallen', (select count(*) from public.fallen f where f.active)::integer,
        'notes', (select count(*) from public.notes n where n.edition_id is null)::integer));
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
-- members: whole rows to read and delete, but a row's address and edition are
-- fixed once written — re-pointing a member's row (and with it their history and
-- the speakers' contacts they handle) to another Google account is not a write
-- the screen ever needs: a wrong address is deleted and added again (DECISIONS).
grant select, delete on public.members to authenticated;
grant insert (email, display_name, gender, role, edition_id, active),
      update (display_name, gender, role, active) on public.members to authenticated;

grant execute on function app.my_member_id(bigint) to authenticated;

-- Phase 1: the grid. Reads are RLS-filtered SELECTs; every write is a
-- function below (SECURITY DEFINER, checks the caller, enforces the contract).
grant select on public.grid_template, public.categories, public.speakers, public.speaker_contacts,
                public.grid_rows, public.rooms, public.approaches, public.availability,
                public.lessons, public.lesson_speakers, public.pitches, public.activity
  to authenticated;

grant execute on function public.ping()           to anon, authenticated;
grant execute on function public.schema_version() to authenticated;
grant execute on function public.whoami()         to authenticated;
grant execute on function public.team(bigint)     to authenticated;
grant execute on function public.load_week(bigint) to authenticated;
grant execute on function public.propose(bigint, bigint, bigint, integer, integer, integer, bigint, text) to authenticated;
grant execute on function public.unpropose(bigint) to authenticated;
grant execute on function public.set_pitch(bigint, text) to authenticated;
grant execute on function public.close_lesson(bigint) to authenticated;
grant execute on function public.reopen_lesson(bigint) to authenticated;
grant execute on function public.move_lesson(bigint, integer, integer, integer, bigint) to authenticated;
grant execute on function public.reshape(bigint, integer, integer, text, integer, text, integer[]) to authenticated;
grant execute on function public.update_lesson(bigint, integer, jsonb) to authenticated;
grant execute on function public.start_edition(text, date, integer, text, boolean) to authenticated;   -- v12: the deactivation option

-- Settings (v5). Column lists are the whole point for rooms and categories:
-- `is_default` moves only through set_default_room(), and no id or edition is
-- ever chosen by a browser. RLS decides whose rows (admins only).
grant select, delete on public.roster, public.rooms, public.categories to authenticated;
grant insert (edition_id, full_name, gender), update (full_name, gender) on public.roster to authenticated;
grant insert (edition_id, name, sort), update (name, sort) on public.rooms to authenticated;
grant insert (name, color, sort, active), update (name, color, sort, active) on public.categories to authenticated;
grant execute on function public.set_my_profile(text, text) to authenticated;
grant execute on function public.set_default_room(bigint) to authenticated;
-- roster.name_key is computed as the inserting browser: a pure, immutable helper.
grant execute on function app.name_key(text) to authenticated;

-- The speaker pool (v6): every write a function; speakers, speaker_contacts,
-- approaches and availability stay SELECT-only (above). may_see_contacts is
-- the contacts policy's predicate, so the browser's role runs it.
grant execute on function app.may_see_contacts(bigint) to authenticated;
grant execute on function public.speaker_matches(text) to authenticated;
grant execute on function public.speaker_history(bigint) to authenticated;
grant execute on function public.speaker_activity(bigint) to authenticated;
grant execute on function public.get_speaker_contacts(bigint) to authenticated;
grant execute on function public.create_speaker(bigint, jsonb, boolean, boolean, boolean) to authenticated;
grant execute on function public.update_speaker(bigint, bigint, integer, jsonb) to authenticated;
grant execute on function public.vet_speakers(bigint[], text, text) to authenticated;
grant execute on function public.set_speaker_contacts(bigint, text, text, text, text) to authenticated;
grant execute on function public.claim_speaker(bigint, bigint) to authenticated;
grant execute on function public.set_approach_status(bigint, integer, text, text) to authenticated;
grant execute on function public.hand_over(bigint, bigint, text) to authenticated;
grant execute on function public.answer_handover(bigint, boolean, text) to authenticated;
grant execute on function public.set_availability(bigint, bigint, integer, text, text, text) to authenticated;

-- From placement to arrival (v7): lessons stays SELECT-only (above); every
-- stage write is a function. transport_details is read through its policy,
-- whose predicate (may_see_transport) the browser's role runs.
grant select on public.transport_details to authenticated;
grant execute on function app.may_see_transport(bigint) to authenticated;
grant execute on function public.get_transport_details(bigint) to authenticated;
grant execute on function public.set_transport_details(bigint, text, text, text, text, boolean) to authenticated;
grant execute on function public.set_payment(bigint, integer, numeric, text) to authenticated;
grant execute on function public.decide_payments(bigint[], integer[], text, text) to authenticated;
grant execute on function public.mark_confirm_sent(bigint, integer) to authenticated;
grant execute on function public.set_escort(bigint, integer, bigint, boolean, text) to authenticated;
grant execute on function public.set_sources(bigint, integer, text, text, text, text, boolean) to authenticated;
grant execute on function public.set_paid(bigint, boolean) to authenticated;
grant execute on function public.set_confirm_template(bigint, text) to authenticated;
grant execute on function public.set_duty_phrases(bigint, jsonb) to authenticated;

-- Outputs and knowledge (v8): direct writes under RLS, by column — a browser
-- never picks an id, an author, a time or a version (the guard triggers stamp
-- them), and a snapshot is never changed or deleted. Phones through one
-- invoker function, under the contacts policy.
grant select on public.export_snapshots to authenticated;
grant insert (edition_id, kind, payload) on public.export_snapshots to authenticated;
grant select, delete on public.notes, public.milestones to authenticated;
grant insert (edition_id, section, title, body_md), update (section, title, body_md) on public.notes to authenticated;
grant insert (edition_id, title, days_before), update (title, days_before, done_at) on public.milestones to authenticated;
grant execute on function public.get_contacts_for(bigint[]) to authenticated;

-- Links and מכריכה לכריכה (v9). anon — the publishable key, nobody signed in —
-- gets ping and the six link functions below, and nothing else: no table, no
-- other function. authenticated: every column of share_links but the hash (an
-- edition's admins, under RLS), SELECT on the ticks and the kk tables (the
-- edition's members); every write a function.
grant execute on function public.escort_view(text) to anon;
grant execute on function public.escort_tick(text, bigint, text, boolean) to anon;
grant execute on function public.escort_pickup(text, bigint, text) to anon;
grant execute on function public.kk_form(text) to anon;
grant execute on function public.kk_signup(text, bigint, bigint) to anon;
grant execute on function public.schedule_view(text) to anon;
grant select (id, edition_id, scope, subject_id, created_by, created_at, expires_at, revoked_at) on public.share_links to authenticated;
grant select on public.escort_ticks, public.kk_tracks, public.kk_groups, public.kk_leaders, public.kk_signups, public.book_orders to authenticated;
grant execute on function public.issue_link(bigint, text, bigint) to authenticated;
grant execute on function public.revoke_link(bigint) to authenticated;
grant execute on function public.load_kk(bigint) to authenticated;
grant execute on function public.kk_add_group(bigint, integer, integer, jsonb) to authenticated;
grant execute on function public.kk_update_group(bigint, jsonb) to authenticated;
grant execute on function public.kk_delete_group(bigint) to authenticated;
grant execute on function public.kk_place(bigint, bigint) to authenticated;
grant execute on function public.kk_unplace(bigint, bigint) to authenticated;
grant execute on function public.kk_set_window(bigint, timestamptz, timestamptz) to authenticated;
grant execute on function public.set_book_order(bigint, integer, boolean) to authenticated;

-- Sources and the reader (v10). source_files is read under RLS (the edition's
-- team) and written only by the functions; the policies on storage.objects
-- call the three predicates as the browser's role.
grant select on public.source_files to authenticated;
grant execute on function app.may_read_source(text) to authenticated;
grant execute on function app.may_upload_source(text) to authenticated;
grant execute on function app.may_delete_source(text, text) to authenticated;
grant execute on function public.register_source_file(bigint, bigint, text, text, integer) to authenticated;
grant execute on function public.remove_source_file(bigint) to authenticated;
grant execute on function public.set_reader_headers(bigint, text, text) to authenticated;
grant execute on function public.set_reader_cover(bigint, bigint) to authenticated;

-- Memorial times and logistics (v11). fallen, fallen_contacts and memorial_plans
-- are read under RLS (the policies' predicates run as the browser's role) and
-- written only by the functions: the fallen by a global admin, a family's contact
-- by the admins app.may_see_fallen_contacts names, plans and slots by the
-- edition's admins. get_transports_for: invoker, under the transport policy.
grant select on public.fallen, public.fallen_contacts, public.memorial_plans to authenticated;
grant execute on function app.may_see_fallen(bigint) to authenticated;
grant execute on function app.may_see_fallen_contacts(bigint) to authenticated;
grant execute on function public.get_fallen_contacts(bigint) to authenticated;
grant execute on function public.get_transports_for(bigint) to authenticated;
grant execute on function public.save_fallen(bigint, text, text, text, boolean) to authenticated;
grant execute on function public.delete_fallen(bigint) to authenticated;
grant execute on function public.set_fallen_contacts(bigint, text, text, text, text, text) to authenticated;
grant execute on function public.add_memorial_slot(bigint, integer, integer, integer, bigint) to authenticated;
grant execute on function public.remove_memorial_slot(bigint) to authenticated;
grant execute on function public.add_memorial_plan(bigint, bigint) to authenticated;
grant execute on function public.update_memorial_plan(bigint, integer, jsonb) to authenticated;
grant execute on function public.place_memorial_plan(bigint, integer, bigint) to authenticated;
grant execute on function public.delete_memorial_plan(bigint) to authenticated;
grant execute on function public.set_memorial_policy(bigint, text, integer, boolean) to authenticated;

-- Import 5786 (v12): a global admin's two functions (each checks it) — the lookup (which pool speaker has a
-- phone, which contact fields are filled: booleans) and the commit. Every helper (app.phone_key,
-- app.import_speaker, app.label_key, …) stays in app, out of the browser's reach. lesson_import_notes is read
-- through its policy (may_see_transport, granted above) one lesson at a time by get_import_note (invoker), and is
-- never in Realtime; only the commit writes it, only the purge deletes it.
grant execute on function public.import_lookup(bigint[], text[]) to authenticated;
grant execute on function public.import_commit(text, jsonb) to authenticated;
grant select on public.lesson_import_notes to authenticated;
grant execute on function public.get_import_note(bigint) to authenticated;

-- After the week (v12). lesson_reviews is read under RLS (an edition's admins and
-- content members; load_reviews is invoker) and written only by save_lesson_review;
-- speaker_reviews, edition_returning, purge_edition_private and the dry run are
-- definer functions that check the caller. app.review_opens_on,
-- app.may_read_reviews, app.earlier_edition and app.editions_purged_guard run
-- inside them (or the policy's own app.my_role) — no browser role executes them.
grant select on public.lesson_reviews to authenticated;
grant execute on function public.save_lesson_review(bigint, integer, text, text, text, boolean, integer) to authenticated;
grant execute on function public.load_reviews(bigint) to authenticated;
grant execute on function public.speaker_reviews(bigint) to authenticated;
grant execute on function public.edition_returning(bigint) to authenticated;
grant execute on function public.purge_edition_private(bigint, text) to authenticated;
grant execute on function public.start_edition_preview(boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime. Supabase sends a browser postgres_changes only for tables in the
-- supabase_realtime publication (created empty in every project). These six
-- are what the grid listens to (src/data/realtime.ts); availability joined in
-- v6, for the pool's chips (days and parts of days — no contact detail). An insert or update
-- reaches only a subscriber whose RLS lets them SELECT the row; a DELETE goes
-- to every signed-in subscriber of the table, carrying the primary key only —
-- so a table with personal data (speaker_contacts, members, activity,
-- editions, roster, transport_details) is never published, and is taken out if
-- someone added it by hand. v8 adds the knowledge base and the export
-- snapshots to that list (notes are free text; nobody needs them live); v9 the
-- links and their counts (token hashes), the escorts' ticks and every kk table
-- (who signed up for what; the «מכריכה לכריכה» screen reloads on return instead);
-- v10 the sources' files (file names; the week reloads after an upload); v11 the
-- fallen, their families' contacts, and the memorial plans (the memorial screen
-- reloads after each action; the grid on return to the tab); v12 the lessons'
-- «איך עבר» (opinions about a person; read when the panel or the summary opens),
-- and the imported lessons' notes (last year's transport words; read one lesson
-- at a time).
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'no supabase_realtime publication — live updates stay off until it exists';
    return;
  end if;
  if (select puballtables from pg_publication where pubname = 'supabase_realtime')
     or exists (select 1 from pg_publication_namespace pn join pg_publication p on p.oid = pn.pnpubid
                 where p.pubname = 'supabase_realtime') then
    raise warning 'supabase_realtime publishes whole schemas, personal-data tables included — recreate it empty (create publication supabase_realtime;) and run this file again';
    return;
  end if;
  foreach t in array array['speaker_contacts', 'members', 'activity', 'editions', 'roster', 'transport_details', 'export_snapshots', 'notes', 'milestones',
                           'share_links', 'share_link_hits', 'escort_ticks', 'kk_tracks', 'kk_groups', 'kk_leaders', 'kk_signups', 'book_orders',
                           'source_files', 'fallen', 'fallen_contacts', 'memorial_plans', 'lesson_reviews', 'lesson_import_notes'] loop
    if exists (select 1 from pg_publication_tables
                where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
  foreach t in array array['lessons', 'lesson_speakers', 'pitches', 'approaches', 'speakers', 'availability'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;
