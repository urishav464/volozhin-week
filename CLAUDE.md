# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

The planning system for **שבוע וולוז'ין** — the five-day, round-the-clock study week that closes
Midreshet Ein Prat's שנה ב' programme. A team of ~10 trainees recruits and schedules ~50 speakers
into a fixed grid; the instructor oversees. One record per lesson; every output (tracking table,
escorts list, speaker confirmation message, designer export, the reader, logistics lists) is
derived from it.

**It is a standalone project.** It has nothing to do with the Mishmar app (`Ein-Prat-work`): its
own repo, its own Supabase project, its own Google OAuth client. Do not import from, query, or
mirror that project.

**Stack:** React 19 · Vite 8 · TypeScript 7 · Tailwind 4 (Hebrew, RTL) on Cloudflare Pages ·
Supabase (Postgres + Auth + Realtime + Storage), no server code — all logic is SQL or browser.

The approved plan is `docs/DESIGN.md` — read it before building anything. Implementation-time
decisions that differ from it are in `docs/DECISIONS.md`. The owner's setup steps are in
`docs/SETUP.he.md`.

## Commands

```bash
npm install
npm run dev                       # demo mode (no env vars) — synthetic data, nothing saved
npm run typecheck && npm run test:unit && npm run build
export PG_ADMIN_URL=$(npm run -s pg:up)   # local PostgreSQL 16 for the SQL tests
npm run test:sql                  # schema vs a browser's roles (old + new Supabase defaults) + tests/parity: engine ≡ SQL
npm run test:e2e                  # Playwright: demo build + mock-Supabase build at 390 / 820 / 1440 px
npm run scan:pii                  # tracked files: phones, private e-mails, keys
bash scripts/test-guard.sh        # the Bash guard hook's allow/block cases
```

Playwright 1.56.1 uses the pre-installed Chromium 1194 (`PLAYWRIGHT_BROWSERS_PATH`); do not run
`playwright install` in the sandbox. CI installs its own.

## Hard constraints

- **Personal data lives only in the database.** Phones, e-mails and addresses of speakers,
  families and drivers never enter git — not in code, fixtures, docs or commit messages. Fixtures
  are synthetic. `.gitignore` excludes spreadsheets/documents/PDFs/CSVs, the hook blocks staging
  them, `scripts/pii-scan.mjs` and gitleaks run in CI. Last year's files are imported through the
  app, in the browser, straight into the database.
- **The browser holds the publishable key**, so the permission model lives in
  `supabase/schema.sql`: it REVOKEs everything from `anon`/`authenticated` and grants back an
  explicit list at the end of the file. `tests/sql/schema.test.ts` pins the exact set of
  functions each role may execute — a new browser-callable function means updating that list
  on purpose. Helpers live in schema `app` (not exposed); browser RPCs in `public`.
- **Schema changes:** edit `supabase/schema.sql` (it must stay idempotent — the owner re-runs the
  whole file in the SQL Editor), bump `public.schema_version()` **and**
  `src/lib/schema.ts → EXPECTED_SCHEMA_VERSION` in the same commit, and tell the user to re-run it.
- **No service_role / secret key and no `.env` anywhere.** The only build variables are
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, set in Cloudflare (Production only);
  previews build without them and run in demo mode.
- **Never invent content:** speakers, dates, contacts, amounts. Unknown stays TBD; thresholds the
  user has not confirmed are labelled «הצעה».
- **Git:** work on `Volozin`; `main` (production) changes only through a pull request the user
  approves. `.claude/hooks/guard-bash.sh` blocks pushes to main, force pushes, and staging
  personal-data files.
- **Hebrew UI:** RTL; address the team gender-neutrally («מדריך/ה»); generated messages to a
  speaker take the speaker's gender.

## Shape of the code

- `src/data/port.ts` — the `DataPort` interface every screen talks to; `SupabasePort` (real) and
  `DemoPort` (synthetic, in memory). Screens never call Supabase directly.
- `src/data/gate.ts` — which screen a browser shows, from `public.whoami()` alone (pure, tested).
- `docs/CONTRACT.md` — what every grid command does. Two implementations: the SQL RPCs and
  `src/data/engine.ts` (behind DemoPort). **Change both together**; `tests/parity` runs the same
  scenarios on both and fails on any difference in result or state.
- All grid writes are SECURITY DEFINER functions in `public`; `authenticated` has SELECT only on
  the grid's tables.
- `src/screens/settings/` — «הגדרות» (`/settings/<tab>`, react-router), admins only: edition, team,
  roster, rooms, categories, through `port.settings` (`src/data/settings.ts`; SupabaseSettings /
  DemoSettings refuse with the same codes). Settings are direct writes under RLS — column grants
  and guard triggers keep their rules (`schema.sql` «Settings»; `docs/DECISIONS.md`).
- `src/data/speakers.ts` — the speaker pool (`port.speakers`): search first and create, edit, vet,
  contacts (fetched one speaker at a time, never in a Week or Realtime), approaches, hand-overs,
  availability. SupabaseSpeakers calls the v6 RPCs; DemoSpeakers runs them on the engine (CONTRACT
  «The speaker pool»). `src/domain/trigram.ts` is pg_trgm's similarity, held equal to the extension.
- `src/screens/speakers/` — the pool's screens: «מרצה חדש/ה» (search first), the speaker sheet (the
  grid's `Sheet`), «המרצים שלי» (`/mine`) and the approvals queue (`/approvals`, global admins). The
  week, /mine and /approvals share one loaded edition (`src/screens/weekStore.tsx`, which also feeds
  the header's badge); `actorIn` there is the one place a screen asks what the member may do.
- `supabase/seed_gate.sql` / `unseed_gate.sql` — the decision gate's synthetic practice week.
- `supabase/schema.sql` — the whole database; `tests/sql/` — its tests on PostgreSQL 16 with a
  Supabase-like bootstrap (`tests/sql/bootstrap.sql`).
- `tests/e2e/` — builds the app twice (demo / mock) and drives it in Chromium; `mock.ts` fakes the
  Supabase endpoints by route interception.
