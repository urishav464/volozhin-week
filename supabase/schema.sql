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
  as $$ select 2 $$;

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
-- One's own row; admins see all. public/privacy.html promises e-mails reach no one else.
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
  retired       boolean not null default false,
  source        text not null default 'manual',
  name_key      text generated always as (app.name_key(name)) stored,
  disambiguator text,
  version       integer not null default 1,
  created_by    bigint,
  created_at    timestamptz not null default now()
);
create unique index if not exists speakers_name_key on public.speakers (name_key, coalesce(disambiguator, ''));

-- Contact details: their own table, never in Realtime, readable only by the
-- admin and by whoever handles the speaker this year.
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
  version         integer not null default 1,
  created_at      timestamptz not null default now(),
  unique (edition_id, speaker_id)
);

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
  pay_amount       numeric(8, 2) check (pay_amount > 0),
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

-- Contacts: the admin, or whoever handles the speaker in an edition they belong to.
-- public/privacy.html tells users exactly this — widen the policy, update that page.
drop policy if exists speaker_contacts_read on public.speaker_contacts;
create policy speaker_contacts_read on public.speaker_contacts for select to authenticated using (
  (select app.is_global_admin())
  or exists (select 1 from public.approaches a
              where a.speaker_id = speaker_contacts.speaker_id
                and a.owner_member_id = app.my_member_id(a.edition_id)
                and app.my_role(a.edition_id) in ('admin', 'content'))
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

-- Everything the grid needs, in one round trip, as the caller's RLS allows —
-- invoker, so it can never show more than the tables would.
create or replace function public.load_week(p_edition bigint) returns jsonb
  language sql stable security invoker set search_path = ''
  as $$
    select jsonb_build_object(
      'edition', (select to_jsonb(e) from public.editions e where e.id = p_edition),
      'rows', coalesce((select jsonb_agg(to_jsonb(r) - 'edition_id' order by r.start_min, r.id) from public.grid_rows r where r.edition_id = p_edition), '[]'),
      'rooms', coalesce((select jsonb_agg(to_jsonb(r) - 'edition_id' order by r.sort, r.id) from public.rooms r where r.edition_id = p_edition), '[]'),
      'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort, c.id) from public.categories c), '[]'),
      'speakers', coalesce((select jsonb_agg(jsonb_build_object(
          'id', s.id, 'title', s.title, 'name', s.name, 'gender', s.gender, 'affiliation', s.affiliation,
          'bio_short', s.bio_short, 'topics', s.topics, 'vetted', s.vetted, 'retired', s.retired, 'name_key', s.name_key)
          order by s.id) from public.speakers s), '[]'),
      'approaches', coalesce((select jsonb_agg(jsonb_build_object(
          'id', a.id, 'speaker_id', a.speaker_id, 'owner_member_id', a.owner_member_id, 'status', a.status,
          'avail_note', a.avail_note, 'version', a.version) order by a.id)
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
      'team', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.team(p_edition) t), '[]')
    )
    where app.can_see_edition(p_edition)
  $$;

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
    if not (app.my_role(v_p.edition_id) = 'admin' or v_a.owner_member_id = v_me or v_p.proposed_by = v_me) then
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
    if not (app.my_role(v_p.edition_id) = 'admin' or v_a.owner_member_id = v_me) then perform app.refuse('forbidden'); end if;
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
    if not (app.my_role(v_p.edition_id) = 'admin' or v_a.owner_member_id = v_me) then perform app.refuse('forbidden'); end if;
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
    delete from public.lesson_speakers where lesson_id = v_l.id;
    update public.pitches set state = 'approached' where lesson_id = v_l.id and state = 'accepted';
    update public.lessons set state = 'draft', version = version + 1, updated_by = v_me where id = v_l.id;
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
         set day = p_day, start_min = p_start, end_min = p_end, room_id = p_room,
             needs_reconfirm = needs_reconfirm or (state = 'closed' and confirm_sent_at is not null
                               and (day, start_min, end_min, room_id) is distinct from (p_day, p_start, p_end, p_room)),
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
      if exists (select 1 from public.lessons where id = any (v_ids) and state = 'closed') then perform app.refuse('cell_closed'); end if;
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
      if exists (select 1 from public.lessons where id = any (v_ids) and state = 'closed') then perform app.refuse('merge_blocked'); end if;
      select coalesce(jsonb_agg(to_jsonb(c)), '[]') into v_carried from app.carry(v_ids) c;
      delete from public.lessons where id = any (v_ids);
      begin
        update public.lessons
           set end_min = v_new_end, version = version + 1, updated_by = v_me,
               needs_reconfirm = needs_reconfirm or (state = 'closed' and confirm_sent_at is not null)
         where id = v_l.id;
      exception when exclusion_violation then
        get stacked diagnostics v_c = constraint_name;
        perform app.refuse(app.exclusion_code(v_c));
      end;
      perform app.adopt(v_l.id, v_carried);

    elsif p_op = 'reset' then
      if exists (select 1 from public.lessons where id = any (v_ids) and state = 'closed') then perform app.refuse('cell_closed'); end if;
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
create or replace function public.start_edition(p_label text, p_start_date date, p_first_day_from integer default null, p_room text default 'בית מדרש')
  returns bigint
  language plpgsql security definer set search_path = ''
  as $$
  declare v bigint;
  begin
    if not app.is_global_admin() then perform app.refuse('forbidden'); end if;
    update public.editions set status = 'archived' where kind = 'real' and status <> 'archived';
    insert into public.editions (label, kind, start_date, first_day_from, settings)
    values (p_label, 'real', p_start_date, p_first_day_from, '{"lesson_minutes": 75, "row_minutes": 90}'::jsonb)
    returning id into v;
    insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days)
    select v, start_min, end_min, kind, label, days from public.grid_template;
    insert into public.rooms (edition_id, name, sort, is_default) values (v, p_room, 1, true);
    return v;
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
grant execute on function public.start_edition(text, date, integer, text) to authenticated;

commit;
