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
`docs/SETUP.he.md`; the team's one-page guide is `docs/GUIDE.he.md` (also the site's «עזרה» page —
keep it to markdown-lite).

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
  on purpose — that every function in `public` and `app` pins its `search_path`, and that anon's
  SECURITY DEFINER functions are exactly the six link functions (SETUP «Security Advisor» says which
  advisor warnings remain, and why). Helpers live in schema `app` (not exposed); browser RPCs in `public`.
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
- **From placement to arrival (milestone 3, schema v7):** a closed lesson's stages — payment and
  transport (the handler asks, a global admin decides), the summary message, escorts, sources —
  are `WeekCommands` (`src/data/commands.ts`), SQL functions in `schema.sql` «Milestone 3» and the
  engine (CONTRACT «From placement to arrival»); cleaning rules in `src/data/stageRules.ts`.
  `needs_reconfirm` is ONE rule: the trigger `app.lessons_reconfirm` / `Engine.reconfirm` (and
  `app.editions_reconfirm` / `DemoSettings.updateEdition` when the week's date moves). The stages are
  the speaker's: `reopen_lesson` starts them all over and deletes the transport details (never while
  paid: `paid_locked`).
  Transport details are personal data: `transport_details`, `app.may_see_transport`, fetched one
  lesson at a time — never in a Week or Realtime. `src/domain/message.ts` composes the summary
  message from the instructor's template (`editions.settings.confirm_template` — never seeded;
  every TBD blocks); `src/domain/escorts.ts` the escorts' load and duty notes.
  `src/domain/stages.ts` derives the five stage dots and a closed lesson's next step — the card,
  the lesson panel, «המרצים שלי» and the progress lens all read it. Screens: `src/screens/stages/`
  (the lesson panel's five sections, handed to `LessonPanel` as `stages`; `MessageComposer` is
  also in the speaker sheet), «תבניות» (`src/screens/settings/TemplatesTab.tsx`: the template with
  a live preview, the duty phrases), and the approvals queue's payment section. The escort
  picker warns through `escortClashes` (`src/rules/warnings.ts`), the same rule as `escort_gap`.
- **Outputs and knowledge (milestone 4, schema v8):** `src/exports/` — pure, unit-tested builders of
  every output from a loaded Week: the tracking table (`tracking.ts`), the escorts' list (`escorts.ts`),
  the designer's public schedule and its diff (`designer.ts`), the archive zip (`archive.ts`), and the
  file writers — CSV with BOM/CRLF (`csv.ts`) and our own small xlsx on `fflate` (`xlsx.ts`; no
  SheetJS). Every cell passes `guardCell` (the formula-injection guard). Nothing is uploaded but a
  designer export's snapshot. `port.outputs` (`src/data/outputs.ts`): phones in one invoker call,
  `get_contacts_for` (never more than `get_speaker_contacts`), the snapshots, the archive's extras;
  `port.knowledge` (`src/data/knowledge.ts`): notes and milestones — direct writes under RLS with guard
  triggers (CONTRACT «Outputs and knowledge»). Screens: `src/screens/outputs/` (/tracking,
  /print/escorts, /export/designer), `src/screens/knowledge/` (/knowledge), the archive in
  «הגדרות ← מחזור» (`ArchivePanel.tsx`), «עזרה» (/help) rendering `docs/GUIDE.he.md` itself through
  markdown-lite (`src/domain/markdown.ts` — text nodes only, never HTML). Last year's stage colours:
  `src/domain/progress.ts`, one definition for the lens, the table and the xlsx.
- **Links without an account and מכריכה לכריכה (milestone 5a, schema v9):** `share_links` (a token's sha256
  only; issued, replaced, revoked by an edition's admins — `port.links`, `src/data/links.ts`), the escorts'
  ticks (`escortTicks` in the Week) and the kk tables (`port.kk`, `src/data/kk.ts`: all writes are functions).
  **anon's whole reach is `ping` (invoker since v12) and six SECURITY DEFINER functions** (`escort_view escort_tick escort_pickup
  kk_form kk_signup schedule_view`), keyed by a token alone; every link problem is the one refusal
  `link_invalid` (no oracle); a sign-up answers the same in every case and never overwrites (its one accepted
  residual: «full» after a sign-up — CONTRACT). The rate limit: an escort's link one count; a class link one per
  caller's address (`app.link_client` / `linkClient`, the sha256 of cf-connecting-ip or X-Forwarded-For's first
  entry) — never a count the whole class shares. `src/lib/schema.test.ts` holds `EXPECTED_SCHEMA_VERSION` to the file. The public
  pages read through `PublicPort` (`src/data/publicPort.ts`, `makePublicPort()`): `SupabasePublic` is a plain
  POST with the `apikey` header and no Authorization; the demo's is `src/data/demoLinks.ts`. Engine ≡ SQL
  by `tests/parity`, the public answers included; `src/domain/israelTime.ts` counts days as Israel does (W−7).
  **Screens:** `src/Root.tsx` sends `/e`, `/k`, `/s` to the public pages (`src/screens/public/`) — outside the whoami
  gate, lazy, the token taken from the hash and out of the address bar at once (`history.replaceState`), in memory
  only; in production they load `SupabasePublic` alone through `src/data/publicEntry.ts` (no supabase-js, no auth
  client). «קישורים» (`src/screens/settings/LinksTab.tsx`) issues, replaces and revokes, the token shown once;
  «מכריכה לכריכה» is `/kk` (`src/screens/kk/KkScreen.tsx`, every member reads; the window's fields in Israel time —
  `israelInstant`); the ticks show in the lesson panel's escort stage and the escorts' list (`EscortTicksLine`).
- **Sources and the reader (milestone 5ב-1, schema v10):** a closed lesson's files live in the PRIVATE Storage
  bucket `sources`, which `schema.sql` creates with its policies on `storage.objects` (no dashboard step): upload =
  `app.source_refusal` (the set_sources rule — content/admin, a closed lesson, or a memorial slot with a plan placed (5ב-2); the poster
  `…/cover/…` admins only) and a path no `source_files` row holds (`app.may_upload_source` — a path is used once),
  read = the whole edition team, delete = uploader or admin, update nobody, anon nothing —
  and **restrictive** copies of each so no later policy can widen the bucket. The path convention is one regex in
  two places (`app.source_path_re` ≡ `SOURCE_PATH_RE`, `src/data/sourceRules.ts`, compared by a test). Upload =
  Storage first (XHR with the member's token, `Cache-Control: private, no-store`), then `register_source_file` (the
  object must exist, be the caller's; its size as Storage measured it, its type as the uploader declared it — Storage
  never sniffs; the display name shortened to ≤ 200 before upload, `displayNameOf`; the lesson row locked before any
  check; a lost answer asked once more, the object deleted only on a refusal); removal = Storage first, then
  `remove_source_file` (refuses `file_present`).
  `source_files` rows remember the lead speaker they came for (`speaker_id`): `reopen_lesson` keeps them as
  «מהמרצה הקודם», never in the reader. Never in Realtime. `port.sources` (`src/data/sources.ts`: SupabaseSources /
  DemoSources on the engine's in-memory bucket; synthetic demo files in `src/data/demoFiles.ts`).
  **The reader** is browser-only (`src/reader/`): `model.ts` the manifest «התקבל / חסר» (one status per closed lesson
  and memorial slot; a slot's materials are `memorialFiles` — the files of its plan's fallen, wherever uploaded), `layout.ts` the pure page plan (cover, TOC with page numbers,
  days, «סיכום יום»), `assemble.ts` the PDF on pdf-lib 1.17.1 inside a module worker (`worker.ts`; Hebrew drawn on
  OffscreenCanvas → PNG) — every file opened AND embedded before the plan (a file pdf-lib cannot decode is named, never
  a failed build), `build.ts` signed URLs + fetch + cancel, `docx.ts` the Word skeleton (docx **9.8.1**, not
  newer). **One readable check for the upload and the build:** `readable.ts` — `openSource` is the only way the build
  opens a file, `readableSource` the same steps for the upload (`pages.ts` `readerPages`, loaded on demand; pdf-lib
  inside): a picture by its bytes; a PNG whose image data does not inflate to its end refused BEFORE pdf-lib, whose
  decoder loops for ever on data cut short (`png.ts` `pngInflates`, fflate `inflateSync` — not `unzlibSync`); a JPEG
  stripped of EXIF/GPS/XMP/ICC/comments (`jpeg.ts`); a PDF's printing annotations and filled fields painted into each
  page (`annotations.ts` `flattenAnnotations` — never pdf-lib's `form.flatten()`), its box normalised, every page
  decoded once. A PDF or picture registered with `page_count` NULL was not read (`model.ts` `readableFile`): never
  printable, manifest status `unreadable` «צריך קובץ אחר». CI: `npm run test:unit` has a step `timeout-minutes: 5`
  (`.github/workflows/ci.yml`; jobs 15 and 10) — a decoder loop blocks vitest's own timeouts.
  Running headers are `settings.reader_headers` — empty unless the instructor writes them, never seeded.
  Screens: `src/screens/stages/SourceFiles.tsx` (the lesson panel's upload and lists), `src/screens/reader/ReaderScreen.tsx`
  (`/reader`, content and admins; also a tab of «תוצרים»). The «מקראה» stage dot is the manifest's verdict:
  `stagesOf(lesson, readerFilesOf(week, id))` / `nextLessonStep(lesson, files)` — every caller passes the files.
- **Memorial times and logistics (milestone 5ב-2, schema v11):** `fallen` (one cross-year list; a global admin
  writes it — the names are entered in the app only, the demo's are «חלל/ה לדוגמה 1…9»), `fallen_contacts` (a bereaved
  family's contact person: **admins only**, `app.may_see_fallen_contacts` — a global admin, or an admin of a real,
  non-archived edition with a plan for that fallen; read one fallen at a time, `get_fallen_contacts`, invoker; never in
  `load_week`, Realtime, a link, a list or a file but the admin's archive's personal-data file), `memorial_plans` (one
  per fallen per edition, placed on a memorial slot = `lesson_id`; the team reads them in `load_week`, admins write
  through functions; adding and deleting one is logged). A slot is a memorial-kind draft made inside a memorial row
  (`add_memorial_slot`), never dragged or edited (`memorial_slot`: `move_lesson`, `update_lesson`) or merged away
  (`merge_blocked`). A change to a family's contact is logged in the edition whose plan gave access
  (`app.fallen_contacts_edition`). The liaison is the slot's escort and moves with the plan — no speaker's ticks
  for it (`ticksApply`, `src/domain/escorts.ts`); files
  follow the fallen (`source_files.fallen_id`). `settings.memorial` (the staff meeting's policy) is never seeded; its
  warnings fire only once set (`src/rules/warnings.ts`). `port.memorial` (`src/data/memorial.ts`); plans, slots and the
  policy are `WeekCommands`; `src/domain/memorial.ts` the yellow card and the picker. A time range inside a Hebrew
  string takes an LRM (`dayRange`/`LRM`, `src/domain/time.ts`); in JSX, its own `<bdi dir="ltr">`. Screens: `/memorial`
  (`src/screens/memorial/`; `SlotPanel.tsx` is the week's lesson panel for a slot), `/logistics/<tab>`
  (`src/screens/logistics/`, logistics + admins; `handlesLogistics`): transports in ONE `get_transports_for` call
  (invoker, never more than `get_transport_details`), payments, books, prints — builders in `src/exports/logistics.ts`;
  addresses and drivers' phones only behind «כולל כתובות וטלפונים». The archive adds kk.json, memorial.json,
  sources.json and, on request, the files per day (`src/exports/archive.ts`, `archiveGather.ts`).
  `tests/sql/upgrade.test.ts` re-runs the file on a v10 database read from git history (CI checks out the whole
  history) and compares the catalog with a fresh install.
- **Without internet (milestone 5ב-2, part B; no schema change of its own):** `src/offline/`. A hand-written service worker — `sw.ts`
  (`shellWorker`, `killWorker`: functions of `self`, inlined into `/sw.js` by the Vite plugin `swBuild.ts`, which lists
  every emitted file and names the cache by their digest); registered from the team's app in production builds only
  (`register.ts`, the «גרסה חדשה של האתר זמינה» banner — never a reload by itself). It never answers or caches anything
  sent to Supabase, or carrying Authorization/apikey (`routeFor`); a navigation waits for the network
  `NAVIGATE_TIMEOUT_MS`, then the cached shell — but one to a static page of `public/` in either spelling Cloudflare
  Pages answers (`/privacy.html` is a 308 to `/privacy`; `staticPages`, read from the folder by the build) or to a path
  with a file extension is the network's alone; only this build's own files are ever cached. The kill switch is
  `OFFLINE_SHELL_ENABLED` in `config.ts` (the app itself then unregisters and deletes the caches, `retireShellWorker`).
  A lazy screen whose file is gone shows «רענון», not a blank page (`src/screens/ScreenBoundary.tsx`). After every load the Week (only the Week: `assertWeekOnly`, and `WEEK_KEYS` must list every key of
  `Week` — tsc fails on a new one) and the last whoami go to IndexedDB (`store.ts` `OfflineCopy`); started offline (a
  `PortError("network")`, `network.ts` — never a refusal) the day view shows it read-only (`src/screens/OfflineWeek.tsx`)
  only to the device's own user (`DataPort.deviceUserId()`, `snapshot.ts` `offlineDecision`); sign-out clears it. The
  public pages stay online-only. `playwright.config.ts` blocks workers except in `tests/e2e/offline.spec.ts`, whose
  «offline» is `setOffline` plus the test server dropping the context's connections (`e2e-net=down`: setOffline does
  not reach the worker's own fetches) (DECISIONS «אבן דרך 5ב-2, חלק ב: בלי רשת», «ביקורת אבן דרך 5ב-2»). With part A the snapshot holds `memorialPlans` and `fallen` (names
  only) — never a family's contact (`PERSONAL_KEYS` has `contact_name`/`relation`; `tests/sql/memorial.test.ts` runs
  `assertWeekOnly` on `load_week`); offline a memorial card opens its plan to read, and any other address (`/memorial`,
  `/logistics`, …) says it needs a connection over the day view (`view.ts` `sectionNeedingConnection`).
- **The import of 5786 (schema v12):** `src/import/` — the readers (a paste: `clipboard.ts` → `html.ts`, DOMParser
  into an inert document, text nodes only, or `table.ts` TSV; `xlsxRead.ts` and `docxRead.ts` of our own on
  `zip.ts`/`xml.ts` and fflate, bounded by `limits.ts` — inflation stops at the limit whatever the zip says),
  normalisation (`phone.ts` — `phoneKey` ≡ `app.phone_key`, `speakerName.ts` — gender ONLY from הרב/הרבנית, `when.ts`,
  `sources.ts`), mapping (`fields.ts`: only the DESIGN appendix's headers by default; an escorts' column is never
  mappable), matching (`match.ts`) and the three kinds (`candidates.ts`, `tracking.ts`, `escorts.ts`).
  `port.imports` (`src/data/imports.ts`, `importRules.ts`) → `import_lookup` (booleans, never a contact's value) and
  `import_commit` — a global admin's, SECURITY DEFINER, one transaction, every row or none (`import_bad_row`
  «row:reason»), fill-empty only, re-runnable (schema.sql «Import 5786»; CONTRACT «The import of 5786»; the engine's
  `importCommit` behind DemoPort). The wizard is «הגדרות ← ייבוא» (`src/screens/settings/ImportTab.tsx`,
  `importParts.tsx`); **nothing raw is stored** — not in the database, not in the browser (the e2e checks the
  storage). A `new` row is never resolved by a phone alone (two names on one line are two people): the preview's
  `sheetMatches` makes rows of one table that share a phone or a name 0.6 alike «עמום» («כמו שורה N»,
  `resolveChoice`; the tracking sheet's `speakerAliases`). An archive's label is compared by `app.label_key` ≡
  `labelKey`. The sheet's notes are `lesson_import_notes` — the transport details' rule (`app.may_see_transport`),
  one lesson at a time (`get_import_note`, `cmds.importNote`; `shared.importNotes` in the engine), never in a Week,
  Realtime or the offline copy (`import_note` is a `PERSONAL_KEYS` key); «אישור באצווה: מי שלימד/ה ב-…» is
  `pendingWhoTaught` (`src/domain/mine.ts`) in `/approvals` (DECISIONS «ייבוא תשפ"ו», «ביקורת: ייבוא ואבן דרך 6»).
- **After the week (milestone 6, schema v12):** `lesson_reviews` — «איך עבר», one per closed lesson, written only
  through `save_lesson_review` by the lesson's handler (once the day the lesson ENDS on has passed in Israel time:
  `app.review_opens_on` ≡ `reviewOpensOn` in `src/domain/reviews.ts`; never while the date is TBD) or an edition admin
  (always); read by the edition's admins and content (`load_reviews`, invoker) — never logistics, a link, the designer's
  export, `load_week`, Realtime or the offline copy. Across years `speaker_reviews` (`app.may_read_reviews`: a global
  admin, or admin/content of a live real edition; past years + the reader's own live one; never who wrote it).
  `port.reviews` (`src/data/reviews.ts`, `supabaseReviews.ts`, `demoReviews.ts`; the engine's `saveReview` /
  `speakerReviews` / `returning` / `purgePrivate`, parity-tested). Screens: the lesson panel's sixth section
  (`src/screens/stages/ReviewStage.tsx`; the card's five dots unchanged), the speaker sheet's
  `SpeakerReviews.tsx`, «סיכום המחזור» (`/knowledge/summary`, `src/screens/knowledge/SummaryScreen.tsx`, builders in
  `src/exports/summary.ts` — counts only, no thresholds). `purge_edition_private` (a global admin, from Friday 00:00
  Israel = start_date + 5 or once archived, the label typed): deletes `transport_details` and the links' hits, revokes
  every link, deletes the edition's `lesson_import_notes`, sets `editions.purged_at` (guarded by `app.editions_purged_guard`), logs counts only, idempotent; what it
  keeps and why is DECISIONS «אבן דרך 6». `start_edition(…, p_deactivate_team)` (SQL default false; the screen's
  checkbox on, «הצעה») and its dry run `start_edition_preview` (STABLE, cannot write); both in `DemoSettings`. The
  «מעבר לשנה הבאה» checklist and the purge panel: `src/screens/settings/AfterWeek.tsx`. Tests: `tests/sql/after.test.ts`,
  `tests/e2e/after.spec.ts`; `upgrade.test.ts` now starts from v11 (50ff373).
- **Schema v12 is both parts at once** (the import and after the week, DECISIONS «איחוד גרסה 12»): an imported archive
  (`kind 'archive'`) is a past year for `edition_returning`, `speaker_history` and `speaker_reviews`; a re-run of its
  label is refused once a review is on it (`archive_reviewed` — the replace would cascade it away); the purge clears its
  `import_note` (the sheet's transport/payment words); `start_edition`'s previous edition is `kind = 'real'` only. The
  parity engine sees the import's archives as `elsewhere`. Tests: `tests/sql/importAfter.test.ts`,
  `src/data/importAfter.test.ts`, parity «the import meets after the week».
- `src/screens/speakers/` — the pool's screens: «מרצה חדש/ה» (search first), the speaker sheet (the
  grid's `Sheet`), «המרצים שלי» (`/mine`) and the approvals queue (`/approvals`, global admins). The
  week, /mine and /approvals share one loaded edition (`src/screens/weekStore.tsx`, which also feeds
  the header's badge); `actorIn` there is the one place a screen asks what the member may do.
- `supabase/seed_gate.sql` / `unseed_gate.sql` — the decision gate's synthetic practice week.
- `supabase/schema.sql` — the whole database; `tests/sql/` — its tests on PostgreSQL 16 with a
  Supabase-like bootstrap (`tests/sql/bootstrap.sql`).
- `tests/e2e/` — builds the app twice (demo / mock) and drives it in Chromium; `mock.ts` fakes the
  Supabase endpoints by route interception.
- `tests/sql/links.test.ts`, `tests/sql/kk.test.ts` — the anon surface: every bad token refused alike, the
  escort's page by date (W−7) and by key, the rate limit per address (and the review's lock-out attack, closed), the
  sign-up races on two connections (each from its own address, so the group's row lock is what is tested), the
  «full» residual pinned.
- `tests/sql/sources.test.ts` — the bucket on the Storage stub of `tests/sql/bootstrap.sql` (its assumptions cite
  Storage's migrations): uploads per role/edition/archive/anon as the Storage API makes them (INSERT as the caller),
  the restrictive caps against a wide-open policy someone adds, direct SQL deletes refused, register/remove rules
  (a register waiting on a reopen's lock, on two connections), reopen keeping files, the bucket and policy blocks
  failing one at a time. `src/reader/files.test.ts` — files that hang or fool plain pdf-lib (PNGs cut short, Huffman-
  coded — a stub throws and proves nothing), annotations painted in, and `readableSource` ≡ the build on a corpus.
  `tests/e2e/reader.spec.ts` — upload and removal, the manifest at three widths, a real PDF
  built and its pages checked, the cover and the Word skeleton; on the mock wire, Storage then register, in order.
- `tests/e2e/links.spec.ts` — the public pages at three widths (the token out of the address bar, the one refusal),
  issuing and opening a link, the sign-up and the staff's /kk, the schedule in print; on the mock wire, the public
  pages send the publishable key alone to the six anon functions, even with a member's session in the browser.
