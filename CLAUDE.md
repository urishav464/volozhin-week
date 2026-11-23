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

- **The look is Ein Prat's design system** (DECISIONS «עיצוב עין פרת»; no emoji — a warning's mark is `SeverityMark`, `src/grid/bits.tsx`): Almoni embedded from `src/assets/fonts` (under Ein
  Prat's web licence — its README), the seal in `src/assets/brand`, the tokens in `src/index.css` (Prat Navy, sage, sand, a
  rare gold; two brand pairs darkened for contrast). Buttons are pills, tables take the sage header (`TABLE_*` in
  `kit.tsx`); the data colours of the grid (topics, the gender lens, fit, stages, owners) are not the brand's to change.
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
  `kit.tsx` is every screen's kit: `Button` (busy = `aria-disabled`, so it keeps the focus; `keepFocus` does the same for
  `disabled`, opt-in — /kk's book order, «שיבוץ», «העברה»), `Confirm`, and
  `useFocusBack` — every `Confirm` stands in for a button, and its «ביטול» gives that button the focus back
  (`ref(key)` on the button, `back(key)` on cancel; a new Confirm does the same — DECISIONS «המיקוד»).
- `src/data/speakers.ts` — the speaker pool (`port.speakers`): search first and create, edit, vet,
  contacts (fetched one speaker at a time, never in a Week or Realtime), approaches, hand-overs,
  availability per slot (v14). SupabaseSpeakers calls the RPCs; DemoSpeakers runs them on the engine (CONTRACT
  «The speaker pool»). `src/domain/trigram.ts` is pg_trgm's similarity, held equal to the extension.
- **From placement to arrival (milestone 3, schema v7):** a closed lesson's stages — payment and
  transport (the handler asks; a global admin decides — since v18 the edition's admins and logistics too), the summary message, escorts, sources —
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
  the lesson panel, the lesson page and «היום שלי» / «ימים» all read it. Screens: `src/screens/stages/`
  (the stage sections the lesson page's steps are built of; since phase 5 of the reset the grid's panel shows a closed lesson's summary only), «תבניות» (`src/screens/settings/TemplatesTab.tsx`: the template with
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
  `link_invalid` (no oracle); a sign-up answers the same in every case and never overwrites (its two accepted
  residuals: «full» after a sign-up, and a leader missing from the names — CONTRACT «kkForm»). The rate limit: an escort's link one count; a class link one per
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
  (`.github/workflows/ci.yml`; jobs 30 and 10; the e2e step 10, the browser install 15) — a decoder loop blocks
  vitest's own timeouts.
  Running headers are `settings.reader_headers` — empty unless the instructor writes them, never seeded.
  Screens: `src/screens/stages/SourceFiles.tsx` (the lesson page's sources upload and lists; presentations apart since phase 5 of the reset, `skipPresentations`), `src/screens/reader/ReaderScreen.tsx`
  (`/reader`, every member since v19 — content and admins build it whole, logistics builds, downloads and marks «נשלח לדפוס»; also a tab of «תוצרים»). The «מקראה» stage dot is the manifest's verdict:
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
  `zip.ts`/`xml.ts` and fflate, bounded by `limits.ts` — inflation stops at the limit whatever the zip says, and every
  reader counts as it reads (`readBudget`; `cleanGrid` refuses what is too long or wide before cleaning a cell)),
  normalisation (`phone.ts` — `phoneKey` ≡ `app.phone_key`, `speakerName.ts` — gender from הרב/הרבנית or (v13) the candidates' «מגדר» column, never from a name nor against a title, `when.ts`,
  `sources.ts`), mapping (`fields.ts`: only the DESIGN appendix's headers and those last year's own files use (their dry runs, DECISIONS «הרצה יבשה…») by default, the header row found in the
  first five rows (`findHeaderRow`, the admin may choose another); the escorts' column is ASKED for, never guessed —
  always in the escorts' file, in the tracking sheet and the candidates when a header or a first row looks like one
  (`escortLike`) — and never mappable in any kind (`escortColumns` a guard besides)), matching (`match.ts`) and the
  three kinds (`candidates.ts`, `tracking.ts`, `escorts.ts`; a speaker cell's other names are `lines.ts` ExtraLines in
  both of the first two — a line under the name, a name beside it, a bracket at its end and what follows «, », a spaced
  dash or «והרב…» on its own line (`nameTails` in `speakerName.ts`: the name is matched without them; the escorts'
  file matches the bare name): «מרצה נוסף/ת» · «שיוך מוסדי» · «לא לייבא», proposed only for an institution's word,
  a line that IS one escort's name (`allOfOneEscort`) or speaks of one, and in the tracking sheet a co-speaker beside
  the first — a line that only shares a word with an escort's name is `held`, undecided, said in red). **«עריכה»**
  (`edit.ts`, DECISIONS «סבב שישי»): the admin corrects a speaker card's name, title and affiliation; the readers apply
  it (candidates by the row's ref, the tracking sheet by the key as read), so it is matched again and checked again.
  **The escorts' file sends nothing of the file** (DECISIONS «סבב רביעי»): a channel chosen from a fixed list
  (`IMPORT_CHANNELS`, the phrases only suggest it) and the admin's own note — `import_commit` refuses an escorts' row
  with any other key. **A phone or an e-mail lands only in phone / email:** the wizard takes it out of every other
  field (`stripContacts`; a note's are replaced, `scrubContacts`), attaching one only when unambiguous, and
  `import_commit` refuses one anywhere else (`app.has_contact` ≡ `hasContact` on the text folded alike — every digit
  ASCII, format characters out: `app.contact_fold` ≡ `foldContact` — `contact_in_text`). A phone in text is one by
  Israel's numbering plan (+972 / 00972 of a fixed length, tried first), abroad («+»/«00» and 8–15 digits) or 7–15
  digits beside «טל'»/«נייד»/☎ — never «any seven digits», never from a date's day, month or year (`PHONE`; verses,
  dates, times, prices are text; a number's rest leaves with it, `REST`; its residuals in DECISIONS «סבב שישי»);
  `src/import/privacy.property.test.ts` holds both privacy invariants on thousands of seeded random tables.
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
  `speakerReviews` / `returning` / `purgePrivate`, parity-tested). Screens: «אחרי השבוע» (`/after`, since phase 3 of the reset;
  the form is `ReviewForm` in `src/screens/stages/ReviewStage.tsx`; the card's five dots unchanged; the grid panel's section went in phase 5), the speaker
  page's `SpeakerReviews.tsx`, «סיכום המחזור» (`/knowledge/summary`, `src/screens/knowledge/SummaryScreen.tsx`, builders in
  `src/exports/summary.ts` — counts only, no thresholds). `purge_edition_private` (a global admin, from Friday 00:00
  Israel = start_date + 5 or once archived, the label typed): deletes `transport_details` and the links' hits, revokes
  every link, deletes the edition's `lesson_import_notes`, sets `editions.purged_at` (guarded by `app.editions_purged_guard`), logs counts only, idempotent; what it
  keeps and why is DECISIONS «אבן דרך 6». `start_edition(…, p_deactivate_team)` (SQL default false; the screen's
  checkbox on, «הצעה») and its dry run `start_edition_preview` (STABLE, cannot write); both in `DemoSettings`. The
  «מעבר לשנה הבאה» checklist and the purge panel: `src/screens/settings/AfterWeek.tsx`. Tests: `tests/sql/after.test.ts`,
  `tests/e2e/after.spec.ts`; `upgrade.test.ts` runs on six bases, v13 (c6d6012), v14 (fe55f7c), v15 (baf3cbe), v16 (bcab571), v17 (035f6fa) and v18 (512ae35, what production runs).
- **Schema v12 is both parts at once** (the import and after the week, DECISIONS «איחוד גרסה 12»): an imported archive
  (`kind 'archive'`) is a past year for `edition_returning`, `speaker_history` and `speaker_reviews`; a re-run of its
  label is refused once a review is on it (`archive_reviewed` — the replace would cascade it away); the purge clears its
  `import_note` (the sheet's transport/payment words); `start_edition`'s previous edition is `kind = 'real'` only. The
  parity engine sees the import's archives as `elsewhere`. Tests: `tests/sql/importAfter.test.ts`,
  `src/data/importAfter.test.ts`, parity «the import meets after the week».
- **The grid rethought (schema v13):** a reshape's splits act on the row's CELL — the row widened to the
  lessons on it (`cellSpan`, `src/domain/shape.ts` ≡ `public.reshape`), so a merged lesson splits whole;
  split_time takes any minutes (`timeSplitOk`: each part starts and ends inside a lesson row). The two
  memorial rows are one «זמן זיכרון»; an empty one is a «+ זמן זיכרון» button for an edition admin.
  A day is «לא מאוזן» when its CLOSED women and men differ by more than `settings.gender_tolerance`
  (absent = 1, «הצעה»; `unbalanced`, `src/rules/balance.ts`) — the `gender_day` warning, keyed by the day,
  on no card. `set_grid_rules` (an edition admin) sets it and `max_category_per_day`. The day header opens
  `src/grid/DayPanel.tsx`; the «אחריות» lens colours each handler (`src/grid/owners.ts`) with «רק של X».
  The night is always shown (no toggle). **The topics axis** (26.10, no schema change): `src/grid/axis.ts`
  (`topicAxis` → `DayModel.axis`, once per load in `buildModel`), `TopicAxis.tsx` (thin in every day header,
  large in the day panel; aria-hidden — its text twins are the panel's lists, the card's aria-label and
  «לפי ימים»), `TopicMatrix.tsx` (topic × day, «לפי ימים»); `TopicChip`/`topicsOf` and `NO_TOPIC_COLOR` in
  `src/grid/bits.tsx`. Every fold is `Fold` (`src/screens/settings/kit.tsx`); a panel's parts are
  `Section` (`count`, `aside`, `label`) inside `Sheet` (`title` node + `label`, `accent` band) — DECISIONS «כל החלונות».
- **The speakers rethought (schema v14):** the call is the first step. `propose` makes a `claimed` approach and a `candidate`
  pitch (never «פנו»); the call's result is `set_approach_status` (the card follows the APPROACH, labels from one place:
  `statusLabel`); the instructor's vetting gates only `close_lesson` (`not_vetted`); `set_pitch` reviving a declined pitch
  also returns a declined approach to `claimed`. The badge is per viewer since phase 3 of the reset (`approvalsBadge`).
  «נקודות לשיחה»: `src/domain/callPoints.ts` (the instructor's text verbatim as the default; `settings.call_template` /
  `set_call_template` to edit; never blocks), shared UI `src/screens/speakers/call.tsx`. Availability per slot:
  `slot_availability` (edition, speaker, day, lesson row; can/cannot; any content member; `set_slot_availability`),
  converted from v6's table in the schema run; every reader goes through `src/domain/availability.ts`. «כל הצוות»
  (`teamBoard` in `src/domain/mine.ts`) is `/speakers?view=team` since phase 3 of the reset. DECISIONS «המרצים מחדש — גרסה 14».
- **מכריכה לכריכה לפי שבוע (schema v15):** a group is the whole week's — its leaders, ONE book (`title` null until
  chosen), one place as typed (`place_key` = `app.name_key`, unique per edition: `place_taken`; the rooms only suggested) —
  and meets at every kk session, which is never stored: `app.kk_rows` ≡ `kkSessions` (`src/domain/kk.ts`, with
  `groupName`, `notYet`, `leaderInput`, `offered`, `kkStatus`, `LEADER_KIND_LABEL`). One sign-up per trainee for the week
  (unique `(edition, roster)`); offered = a book + a capacity + open; copies need a book (`no_book`). A leader is part of
  the group: a trainee leads one (`leader_elsewhere`), is never signed up (`leader_signed_up`, `is_leader`) and is left
  out of `kk_form.roster`; a team or typed name that is one trainee's is sent as the trainee (`leaderInput`). Every kk write
  but `kk_set_window` takes the edition's kk lock (`app.kk_lock`) before any rule between groups; a unique index hit is
  a refusal. `kk_add_group(p_edition, p_fields)`, `kk_unplace(p_edition, p_roster)`; the per-session tables
  (`kk_tracks` …) are dropped by the schema run, never converted. Screens: `src/screens/kk/` (`BookOrder.tsx` also in
  «לוגיסטיקה ← ספרים»: one row per group with a book or an order line, `bookRows`), `/k` one «הספר שלי». kk.json has no tracks (archive
  `format_version` 4). DECISIONS «מכריכה לכריכה לפי שבוע — גרסה 15».
- **תורנויות (milestone 7, schema v16):** the campus duty roster beside the lessons — `rota_*` / `RotaPort` / `port.rota`
  («duty» and «roster» are taken: the escorts' phrases, the trainees). Cohorts (a letter, diets), presence per cohort × day ×
  shift (no row = not marked, never assumed), groups (a number; the code «א1» derived; size null = TBD; the head's name),
  duties (needs per shift, null = not set), assignments (`rota_assignments_one_duty`: one duty per group per shift), staff
  shifts (a member, a typed name or a cohort's staff; no phone), Saturday-night preparations — direct writes under RLS with
  a guard per table (`app.may_write_rota`: the edition's admins, logistics while live), cleaned first by `src/data/rota.ts`
  (≡ the guards). Three shifts a day, `settings.rota_shifts` (`set_rota_shifts`, an edition admin), cut as a grid row is:
  `rotaShiftActive` ≡ `app.rota_shift_active` (`src/domain/rota.ts`). **A head's phone is personal data:** `rota_group_contacts`,
  `app.may_see_rota_contacts` (a global admin, or admin/logistics of a real live edition), `get_rota_contacts` (invoker, one
  call) / `set_rota_contact`; never in `load_rota`, a Week, Realtime, the offline copy, a log or a file but behind
  «כולל טלפונים של ראשי הקבוצות» (`useHeadPhones`, `maySeeRotaContacts` in `src/screens/rota/shared.tsx`); the purge deletes it.
  The fair suggestion is pure and deterministic (`src/domain/rotaSuggest.ts`: never touches an assignment, never an absent
  cohort; applied as ONE insert, `stale` on a clash); `rotaWarnings`. Screens: `/logistics/rota/:view?`
  (`src/screens/logistics/rota/`), «תוצרים ← תורנויות» `/print/rota` (`src/screens/outputs/RotaScreen.tsx`, every member;
  `GroupSheet.tsx` an A4 landscape page per group). Builders `src/exports/rota.ts` (`groupSchedule` takes the public schedule (and
  the closed cells' times), the rows, one group, the duties and its assignments — no Week, no phone: a future `/g` link would be anon's seventh function
  and waits; `rotaWorkbook` a sheet per page, «מוצ״ש» in gershayim). `start_edition` carries the duties, the preparations and
  the shifts; archive `format_version` 5, 6 since v19 (`rota.json` without phones; `rota_head_phones` only in the personal-data file).
  Shared cases on SQL and the demo: `src/testing/rotaCases.ts`. DECISIONS «תורנויות — גרסה 16». The week's fourth lens
  «תורנויות» (8.11, `src/grid/rotaLens.ts` → `RotaWeek.tsx`) draws the duties alone — `load_rota` only while it is on, never
  the phones; a shift links to `/logistics/rota` (the edition's logistics and admins) or `/print/rota` (DECISIONS «עדשת התורנויות…»).
- **Titles (schema v17):** the default list (`DEFAULT_TITLES` ≡ `app.titles`) adds «עו״ד», «הרב ד״ר», «הרבנית ד״ר»;
  `app.title_gender` ≡ `titleGender` reads the two together as הרב / הרבנית; `start_edition` carries an edition's own
  `settings.titles` (its dry run says so: `titles`); the import reads «עו"ד» and two-word titles in a sheet's spellings
  (`titleOf`/`splitTitle`, the longer title wins). `app.name_key` is unchanged (the import splits the leading title off; a second one, «הרב עו"ד …», stays in the name and is «עמום» against «עו"ד …» — DECISIONS).
  DECISIONS «תארים — גרסה 17», «מגדר המרצים במאגר».
- **The reset, phase 1 (schema v18):** the data the role-and-stage screens will ask for — phase 1 rebuilt no screen (phases
  2–3 call all five new functions; `set_transport_driver` from phase 3's transport board and the lesson page's `StaffTransport`); what an old screen shows changes only through the wider transport visibility below — the lesson
  panel's transport block opens for an edition admin and for logistics on a pending request, and «לוגיסטיקה ← הסעות» shows an
  edition admin every approved row's details — plus a few sentences of wording (the hints, «עזרה») (DECISIONS «הריסט — מסכים לפי תפקיד ושלב»: five phases, the screens rebuilt per role — trainees,
  staff, logistics; the database, the SQL rules, the engine, parity and the exports stay). No new role (trainees = `content`, the
  two content staff = admins, logistics = `logistics`) and no new refusal code. **Day owners:** `day_owners` (edition, day,
  member, `seen_at`) — the team reads it in `load_week` as `dayOwners` (`WEEK_KEYS`), never in Realtime; `set_day_owners` (an
  edition admin: at most two members who `app.can_handle`, replaced as a set) and `mark_day_seen` (an owner, their own row);
  `start_edition` copies none. **Availability as time ranges is an INPUT method** — `slot_availability` stays the one store:
  `set_availability_ranges` (`port.speakers.setAvailabilityRanges`) replaces whole days by the v6→v14 conversion's rule («לא»
  if ANY «לא» range touches a row, else «יכול/ה» only if ONE «יכול/ה» range covers it whole, else `rest`); the pure twin `rangesToSlots`
  (`src/domain/availability.ts`) is what the engine writes with; ONE activity line per call (`marked` — `timeline()` in
  `src/domain/activityText.ts` labels both shapes). **Transport in two parts:** `set_transport_request` (pickup address, time and
  `pickup_min`; the handler or an edition admin, BEFORE the approval) and `set_transport_driver` (driver, phone, arranged;
  `app.require_logistics`, only once approved — `transport_hidden`), both a JSON PATCH that logs field names, and both refuse
  `transport_hidden` to anyone `app.may_see_transport` would not let read the row (who writes can read: never a practice or demo
  week's team, never an archived edition's own admin; a global admin always);
  `set_transport_details` stays in SQL, the engine and parity — no screen calls it since phase 5 of the reset. `transport_details.pickup_min` is a `PERSONAL_KEYS` key, read
  under `transport_details`' own policy (the same `app.may_see_transport`) and returned by `get_transports_for`; never in a Week,
  Realtime or the offline copy. `app.may_see_transport`: a global admin; in a real live edition its admins, the handler,
  and logistics while the request is `pending` or `approved` (before: approved only) — `public/privacy.html` says so.
  `get_transports_for` returns pending and approved, each with `approval` and `pickup_min`; the print and xlsx/CSV of
  «לוגיסטיקה ← הסעות» list the approved only (`transportRows`, `src/exports/logistics.ts`; the board shows pending too). `decide_payments`: a global admin, or an admin or a logistics
  member of the lesson's own real live edition — one approval is enough (phase 3's `mayDecide` is the same rule on screen).
  `WeekCommands.setDayOwners / markDaySeen / setTransportRequest / setTransportDriver`; cleaners `cleanAvailabilityRanges`
  (`src/data/speakerRules.ts`), `cleanTransportRequest` / `cleanTransportDriver` (`src/data/stageRules.ts`). Anon unchanged; five
  more definer functions for `authenticated` (Advisor 80). CONTRACT «v18 — day owners, availability by ranges, transport in two
  parts»; tests `tests/sql/reset.test.ts`, parity's v18 scenarios (a parity step can pin its answer with `is`, so a twin that
  agrees with the other on a WRONG answer still fails).
- **The reset, phase 2 — the trainee's screens (no schema change):** a content member who is not an admin is a trainee
  (`personaOf(me, editionId)` in `src/data/gate.ts`: a global admin is staff, else the role of `actorIn`'s membership);
  the header is `navFor` (`src/screens/nav.ts`) — a trainee's four sections «היום שלי» `/` · «מרצים» `/speakers` · «השבוע»
  `/week` · «עזרה» (and «אחרי השבוע» from phase 3); the staff's header is phase 3's, logistics' home phase 4's. The writing
  grid's old address `/grid` redirects since phase 5 (`gridRedirect`). Addresses are built and parsed in ONE place,
  `src/domain/routes.ts` (`lessonPath(id, step)`, `speakerPath(id, section)`, `speakersPath(query)` — filters live in the
  query; a slot is `?slot=d:start-end&lesson=<id>`, so a parallel draft's link names its own draft — `slotFor`).
  **«היום שלי»** (`src/screens/myday/`, pure `myDay(model, day, me)` in `src/domain/myDay.ts`): the days `week.dayOwners`
  gives me (a tab each), each slot one next step; «משבצות ביום שלכם שמטופלות על ידי אחרים» is the pair's in-site notice —
  «חדש» from `pitches.at` after my `seen_at` (a lesson has no updated-at), «ראיתי» = `markDaySeen`; staff are sent to
  `/day` (phase 3). **«מרצים»** (`src/screens/speakerPages/`): the list (`filters.ts` `filterSpeakers`; a table
  from a tablet up — the institution under the name below 1024px — cards on a phone; a whole row or card opens the speaker), «מרצה חדש/ה» (`/speakers/new`: «פרט מבחין» only when the
  name check or the server asks; «דרך תקשורת» = `CONTACT_WAY_LABEL` everywhere the field shows), the speaker page: the
  vetting chip, «הפנייה», «זמינות» — `RangesEditor` on `src/domain/rangesForm.ts` (per day «לא ידוע / כל היום / רק בשעות… /
  לא יכול/ה», up to three pairs; a preview by `rangesToSlots` before the ONE `setAvailabilityRanges` call for the days
  touched, `rest` null; the saved form reads back the slots stored — 17:00–19:00 returns as 17:30–19:00; per-slot grid in
  «דיוק לפי משבצת»), «איפה אפשר לשבץ» (`src/domain/placement.ts` `placementFor`: «יכול/ה» or unknown, no clash with the
  speaker's closed lessons, my days first; another pair's day asks a `Confirm` naming them), «מה קרה» folded through
  `curate` (`src/domain/activityText.ts`). `dayKind` (`src/domain/availability.ts`) has «some» — a «רק בשעות…» day is a day the
  speaker CAN, drawn half and half (`src/grid/AvailabilityStrip.tsx`). **The lesson page** (`src/screens/lesson/`,
  `/lesson/:id?step=`): a stepper שיבוץ → סגירה → תשלום והסעה → הודעת סיכום → מקורות ומצגת → מלווה (`steps.ts`), built of the
  panel's pieces, never «איך עבר»; the trainee's transport is `TransportRequest.tsx` (`set_payment` only when the amount or
  kind changed or a request was refused, then `set_transport_request` with `pickup_min`; a send stopped half-way keeps the form
  and sends the pickup alone); the decide box follows `decide_payments`' rule. **«השבוע»** is `src/screens/ReadOnlyWeek.tsx`
  (no drag, no placing, no warning counts; my days ringed; a card opens `/lesson/:id`). **Gender, for everyone:** a day's need
  counts CLOSED lessons only (`src/rules/balance.ts`), said once in the day header — no free-cell tint, no per-cell «דרושה
  מרצה». **Settings:** «ימים» in «צוות» (`DayOwnersPanel.tsx` → `setDayOwners`; an inactive owner is dropped, not resent);
  «הנוסח המוצע» in «תבניות» (labelled «הצעה», never seeded) with two new switches `[[הסעה:…|…]]` and `[[מקורות:…|…]]`
  (`src/domain/message.ts`; `callPoints.ts` lists them as the summary message's). Focus never falls to the page:
  `useFocusRescue` (`kit.tsx`) moves it only when it reached `<body>`. Markdown-lite wraps every «HH:MM–HH:MM» in its own
  `<bdi dir="ltr">` (`timeRuns`). **The demo's `?as=trainee`** (`src/lib/config.ts` `demoAs`, sticky per tab): «חניך/ה א׳»
  (member 2) owns Sunday and Wednesday with partners, the demo edition becomes `real`, plus a few synthetic availability rows
  (`src/data/demoWeek.ts`). e2e: `myday.spec.ts`, `speakers-page.spec.ts`, `lesson-page.spec.ts`; old-screen specs that sign
  in a content member open `/grid`. DECISIONS «הריסט, שלב 2 — המסכים של החניך/ה».
- **The reset, phase 3 — approvals, the transport board, the staff's screens (no schema change):** the screens hide only
  what the rules refuse; the commands decide. **Header** (`navFor`): staff «השבוע» `/` (the writing grid) · «ימים» `/day/:d` ·
  «מרצים» · «אישורים» (badge) · «לוגיסטיקה» · «תוצרים» · «זמני זיכרון» · «מכריכה לכריכה» · «ידע» · «הגדרות» · «עזרה»;
  logistics adds «אישורים»; a trainee gets «אחרי השבוע» once `reviewsOpen` (`src/domain/reviews.ts`: a date, and Israel's
  today past the week's first day). `dayPath` / `afterPath` in `routes.ts`; the redirects are pure helpers in `nav.ts`
  (`myDayRedirect`, `afterRedirect`, `mineRedirect`: `/mine` → `/speakers?s=mine`, `/mine/team` → `/speakers?view=team`).
  `WeekVisit` is gone — no screen sends staff to the old panel; a lesson link is `lessonPath(id, step)`. **ONE handler rule:**
  `lessonHandler` (`src/domain/handler.ts`, the lead's approach owner) — the lesson page, the panel, «היום שלי», «אחרי השבוע»,
  the board, approvals, tracking and the «אחריות» lens. **ONE decide rule:** `mayDecide` (`src/domain/approvals.ts`, the rule
  of `decide_payments`); `approvalsBadge` counts what waits for THIS viewer (vetting only for a global admin). **«אישורים»**
  (`src/screens/approvals/`, `/approvals` for `handlesLogistics`): request rows from ONE `transports()` read (`requestRows`;
  re-read when the pending set changes and after each decision; a failed read only drops the pickup), single or batch
  decisions, `stale` reloads with one line; vetting and «אישור באצווה» stay the global admins'. Wording: payment and
  transport are no longer «the instructor's» («ממתין לאישור», «החלטה על הבקשה»; `forbidden` = «אין הרשאה לפעולה הזו.»).
  **The transport board** («לוגיסטיקה ← הסעות», «הסעות וצוות» since phase 4, `src/screens/logistics/TransportBoard.tsx`, the pure model `lanes.ts`): closed
  lessons with a pending or approved request, from ONE `transports()` read and `useRota`; the axis (`BoardAxis.tsx`, from
  768px, `aria-hidden` — the list is its twin and the phone's board) runs 06:30 to the next morning; outbound bar from
  `boardPickupMin` (`pickup_min` only when it is the clock time typed in `pickup_time` — the old `set_transport_details`
  form changes the text alone) to the start, clamped at 06:30, a marker «שעת איסוף לא ידועה» without one; a round trip's
  «חזרה מ-HH:MM» at the TEACHING end (`teachEndOf` ≡ `app.teach_end`) with no length — no return time, car or second
  driver exists in the database, so none is drawn; the day's staff shifts, leads marked, no phones. Pending → `Decide`
  («דחייה» asks once, everywhere); approved → `DriverForm` (`setTransportDriver` only, changed keys only; «סודר» publishes
  the driver on the escort's page — said on screen). The lesson page's pay step gives staff and logistics `StaffTransport`
  (`src/screens/lesson/`: the pickup read-only, the driver only after approval, `mayArrangeDriver`); the old
  `set_transport_details` form went in phase 5 (an archive's lesson reads its transport, `TransportReadOnly`). **«ימים»** (`/day/:d`,
  `src/screens/myday/DayScreen.tsx`): `myDay(…, { staff: true })` per day — the pair, the balance, every slot's next step,
  «חריגים», who can come; no day in the address = `staffDay`; «ראיתי» only for an owner. **ONE «חריג» rule:** `outsidePair`
  (`src/grid/owners.ts`: a closed lesson's handler, or any live candidate's on a draft, outside the day's pair; none on a
  day without a pair; a member who left never counts) — the grid card, «ימים» and «היום שלי». **The grid:** «התקדמות» is a
  table (`src/screens/progress/`, `progressRows`: a row per closed lesson and per draft with a candidate, a column per
  `pageSteps` step, each cell a link to its step; filters day / «רק מה שחסר» / handler; cards on a phone) — last year's
  colours stay only in tracking (`src/domain/progress.ts`); «אחריות» keeps the handler's colour and names the day's pair.
  The pool is gone (no column, drawer or «שבץ»; propose from a cell's chooser or the speaker page); the only drag left
  moves a lesson; the panel stays (shape, move, grid rules) with «לדף השיעור» — a closed lesson's summary only since phase 5. **Deleted:** `SpeakerSheet`,
  `CreateSpeaker`, `MineScreen`, `TeamBoard.tsx`, the old approvals queue, `src/grid/Pool.tsx`, `mySpeakers`,
  `waitingForApproval`, `handlesSpeakers`, placing mode. «כל הצוות» → `/speakers?view=team` (`TeamView.tsx`); «הוצעו לך»
  (`offeredTo`, `myDay.ts`) → a line atop «מרצים» and «היום שלי». **«אחרי השבוע»** (`/after`, `src/screens/after/`,
  `afterRows` in `src/domain/after.ts`): my closed lessons by `lessonHandler`, each with `reviewWindow`; the panel's form
  shared (`ReviewForm` / `reviewFormProps`, `ReviewStage.tsx`); ONE `reviews.ofEdition` read per page (none while a
  trainee's window is closed); staff «כל השיעורים» `?all=1` (ignored for a non-admin); never logistics. **The demo's
  `?as=logistics`** (`demoAs`): «לוגיסטיקה (הדגמה)» (member 5), the edition `real`, and in that mode only synthetic pickup
  times (one before 06:30), an approved Wednesday transport with no driver and two staff shifts (`seedDemoLogistics`,
  `demoWeek.ts`). Offline: `/day/:d` opens the copy on that day (`offlineDayOf`); `/after`, `/approvals` need a connection.
  e2e: `approvals.spec.ts`, `staff.spec.ts`, `after.spec.ts`; `speakers.spec.ts` and `stages.spec.ts` rewritten,
  `mine.spec.ts` deleted. DECISIONS «הריסט, שלב 3 — אישורים, הסעות והמסכים של הצוות».
- **The reset, phase 4 — the logistics home, and schema v19:** **the home** (`/logistics` with no tab, or an unknown one;
  `src/screens/logistics/LogisticsHome.tsx`): tasks by time from the pure `logisticsTasks` (`tasks.ts`) — three groups always
  shown («בהתחלה» · «כשהתוכן מוכן» · «קרוב לשבוע», the last with `weekLine(daysToWeek(…))`, `src/domain/israelTime.ts`), each
  task `done` / `open` / `empty` (nothing yet — never a false «הושלם») / `unknown` («לא נטען»; «לא זמין במחזור הזה» where
  `mayDecide` is false), its title the link to its screen. ONE read each of `load_rota`, `load_kk` and `get_transports_for`
  (only when `mayDecide`); a failed read turns only its own tasks «לא נטען». The tab strip: «בית» · «הסעות וצוות»
  (`/logistics/transports`, phase 3's board, full width) · «תשלומים» · «ספרים» · «הדפסות» · «תורנויות». **Logistics' header**
  («בית» · «אישורים» · «השבוע» `/week`, read-only with «לבית» · «תוצרים» · «זמני זיכרון» · «מכריכה לכריכה» · «ידע» · «עזרה»);
  their `/`, `/myday`, `/day/*` and `/after` go to `LOGISTICS_HOME` (`homeRedirect` and the other helpers in `nav.ts`). ONE
  browser twin of `app.require_logistics`: `mayLogisticsWrite` (`src/domain/approvals.ts`; `maySendReader`, `mayArrangeDriver`).
  **Cohort flags** (`rota_cohorts.helps_rota` default true, `can_drive` default false; `helpsRota` / `canDrive` /
  `helpingGroups` / `byCohortOrder` / `presenceMarked` in `src/domain/rota.ts`): the fair suggestion and `unevenLoad` skip a
  non-helping cohort's groups, a hand assignment of one warns `not_helping`, `presence_unknown` stays for every cohort (meals);
  the board lists the cohorts whose staff can drive, on campus that day first (`transportLanes(…).drivers`, names only).
  **Saturday night** (`rota_prep_tasks.kind` `task` | `item`, `qty` ≤ 40 for an item, cleaned whatever the kind — a phone is
  `rota_contact_in_text`; «נקנה» is `done`): two lists with their own counts and paste (`addPrepTasks(edition, rows, kind)`,
  one insert; `parsePrepItems`), `prepMoves` reorders inside one list; printing adds `shoppingTable` («קניות מוצ״ש»);
  `start_edition` copies kind and qty; archive `format_version` 6. **The reader for logistics:** build and download, no cover,
  headers, uploads or removal; `set_reader_sent(p_edition, p_sent)` (definer, `require_logistics`; archived → admins) writes or
  removes `editions.settings.reader_sent = {at, by}`, never carried by `start_edition`; `filesAfterSent` («נוספו N קבצים אחרי
  השליחה»); «מקראה» is in every member's `OutputsTabs`. **Books:** `suggestedCopies(signed, leaders)` beside the field,
  «למלא» fills it only, saved on «שמירה». **What phase 5 needs, already in v19** (phase 5's screens write it): presentations
  (`source_files.kind` `source` | `presentation`; pptx only as a presentation — mime check, bucket, `SOURCE_PATH_RE` ≡
  `app.source_path_re`; `register_source_file(…, p_kind)`, the 5-argument overload dropped with its grant; never in the reader,
  the manifest or `printRows` — `isPresentation`; an edition-level one is admins', `lesson_id` null, never the cover);
  `speakers.public_bio` (≤ 600) and `lessons.public_note` (≤ 400, `update_lesson`), both `contact_in_text`;
  `approaches.public_ok` (`set_public_ok(p_approach, p_version, p_ok)`, the handler or an admin, logged; never carried;
  a MARK also needs `app.may_edit_speaker` — a real live edition or a global admin — so a practice week's claim publishes nothing);
  **the speaker's photo** — `speaker_photos` (a JPEG `bytea`, 100–20480 bytes, ≤ 512 px), `app.photo_ok` ≡ `photoOk`
  (`src/domain/photo.ts`: the file's own structure — no EXIF/XMP/ICC/comments, baseline, nothing after FFD9; a segment
  it takes is held to its minimum length only, a residual in DECISIONS), written by
  `set_speaker_photo(p_edition, p_speaker, p_photo)` (base64; null deletes; the speaker-edit rule), read one at a time by
  `get_speaker_photo` (invoker); `load_week` carries `has_photo` only; never in Realtime, the offline copy (`image`/`photo`
  are `PERSONAL_KEYS`), a log detail or the archive. Fixtures are built byte by byte (`src/testing/photos.ts`,
  `src/data/demoPhoto.ts`) — never a base64 blob in git. **`schedule_view`** (still anon's sixth door, no seventh) returns
  `{edition, rows (+note, +people), people [{label, bio, photo}], fixed}`: a speaker in `people` only with an approach of
  THAT edition marked `public_ok`, once, by first appearance; a memorial slot nameless; `fixed` = the grid's fixed/kk rows
  inside the day window; the browser twin is `publicSchedule` (`src/exports/publicSchedule.ts`, `GuestSchedule`), and
  `SchedulePage.tsx` shows it since phase 5. `public/privacy.html` says what a guest sees. Advisor 83 (three more
  definer functions: `set_reader_sent`, `set_speaker_photo`, `set_public_ok`). **The demo's `?as=logistics`** adds a cohort
  that can drive, one that does not help, two shopping items and a week date three weeks ahead (`demoLogisticsStart`, that
  mode only); its guests' sample is every demo's since phase 5 (`seedDemoGuests`). Parity: six v19 scenarios, every step pinned with `is`; tests
  `tests/sql/v19.test.ts`, e2e `logistics-home.spec.ts`. DECISIONS «הריסט, שלב 4 — הבית של הלוגיסטיקה, וגרסה 19».
- **The reset, phase 5 — the guest site, filling it in, presentations, cleanup (no schema change):** every screen writes
  through v19's existing commands. **The guest site** (`/s`, `src/screens/public/`): `guestView` (an answer from before v19
  reads as one), `guestDays` (`guestDays.ts`: lessons, memorial times — nameless — and the grid's fixed rows by time, days with
  fixed rows only included), a sticky day bar of BUTTONS (never `href="#…"`, never pushState — the hash is the token), the days
  side by side from 1280px; a lesson with more (`rowHasMore`: a note, or a marked speaker with a bio or a valid photo) opens
  `GuestCard.tsx` — a native modal `<dialog>` (a bottom sheet on a phone; Escape, the backdrop, «סגירה»; focus back to the
  row), no request, history entry or storage on opening; `CardBody` (its `level`: 2 in the dialog, 4 inside a team page's
  section) draws text nodes only and a photo only through
  `guestPhotoSrc` (`src/domain/photo.ts`: a `data:image/jpeg` that `photoFromBase64` accepts — never a URL). Print: lessons
  and fixed rows, no notes, bios or photos. **Filling it in** (`src/domain/guestSite.ts`: `guestRows`, `guestSummary`,
  `guestLine`, `filterGuests`, `guestPreview`; `mayEditSpeaker` lives here; `mayMarkPublic` ≡ `set_public_ok`'s mark rule with
  `app.may_edit_speaker`, `mayUnmarkPublic`, `publicOkOffered` — the box shows once the approach is `positive` or already
  marked; a practice week's existing mark keeps its box, to be taken back; `mayChangePublicOk` — the consent hint only to a
  viewer who may change a box; a test holds `guestRows`' marked people ≡ `publicSchedule(…).people`): the speaker page's `#guest`
  (`src/screens/speakerPages/GuestSpeaker.tsx`; `PublicOkSwitch` in `src/screens/speakers/PublicOk.tsx`, shared with the lesson
  page; the photo redrawn in the browser — `photoCanvas.ts` `preparePhoto` (≤ 25MB, ≤ 40MP before decoding — a WebP's size by `webpSize`, an AVIF/HEIF's by `heifSize`) and the pure
  `fitPhoto` (`src/domain/photoFit.ts`: ≤ 512px, ≤ 20KB, never enlarged, ≤ 12 encodes, every candidate stripped and passing
  `photoOk`) — the preview is the bytes sent, held in React state only; the guest bio ≤ 600), the lesson page's `#guest`
  (`src/screens/lesson/GuestLesson.tsx`, closed lessons, a section under the stepper — the five dots and six steps
  unchanged: `public_note` ≤ 400 through `updateLesson`, each speaker's mark, bio and photo, «כך זה ייראה לאורחים»), and
  «תוצרים ← אתר האורחים» (`/export/guests`, `src/screens/outputs/GuestsScreen.tsx`, edition admins: counts, filters in the
  address — `guestsPath`, what is missing, a take-back, «תצוגה מקדימה לאורחים» = `publicSchedule` with photos read ≤ 4 at a
  time, only while open). **Presentations** (`/presentations?day=&room=`, `src/screens/presentations/`, every member by
  address; in the header for staff and logistics): the hall's computer is not signed in — a staff member downloads the day
  every morning. `src/domain/presentations.ts`: `presentationRows` (closed lessons and memorial slots; `file` / `link` /
  `missing` / `none` / `memorial`; the CURRENT lead's files, `lessonPresentations`), `weekPresentations` (the cover path,
  admins upload, never Word), `orphanPresentations`, `dayZipPlan` (week decks `0000_השבוע_…` first, then `HHMM_<room>_<name>`
  in the day's order — a night hour is 24–29 — plus `סדר-היום.txt` and, with a link-only row, `links.txt`, UTF-8 BOM, CRLF;
  names through `safeEntryName` — control and bidi characters out — and `storedFileName`, the extension from the STORED path,
  never the display name, also for «הורדה» and the archive, `src/exports/download.ts`); a night row reads «ליל ראשון–שני»
  (`nightLabel`, `src/domain/time.ts`, shared with the reader and /s); `src/exports/presentationsZip.ts` (fflate, stored,
  ≤ 250MB, cancel; the rest of a batch signed again after `RESIGN_AFTER_MS`, an address refused as expired asked for once
  more; with a room chosen the card and its button name the room; not one file came = an error, no zip, no marker). The device remembers the day's last download (`readZipMarker`/`writeZipMarker`, localStorage in try/catch, server
  upload times compared — `newSinceDownload`) and marks «חדש מאז ההורדה»; the week store reloads every
  `PRESENTATIONS_POLL_MS` while the tab is visible (`source_files` is not in Realtime). Uploads: `checkPicked(file, cover,
  "presentation")` then `port.sources.upload(…, { kind: "presentation" })` — the browser's own words `pptx_source`,
  `presentation_bad_file`, `week_presentation_bad_file`; logistics never gets an input. `openOrDownload` (`open.ts`: PDF or
  picture opens, pptx/docx downloads under its Hebrew name) is also `FileRow`'s. The lesson page's «מקורות ומצגת» has
  `LessonPresentations` (`#presentations`); `SourceFiles skipPresentations`. **Cleanup:** `/grid` redirects (`gridRedirect`:
  staff `/`, the rest `/week`; «טוען…» until the edition is known — a screen guard only, the SQL still lets a content member
  reshape); no screen calls `set_transport_details` (`WeekCommands.setTransport`, `TransportBlock`, `TransportForm` gone; an
  archive's lesson reads `TransportReadOnly`; CONTRACT says so); the grid panel of a closed lesson is a summary (details, the
  five dots read-only, «לדף השיעור», «פעולות נוספות»); below 1024px the header shows its first four sections and «עוד», a
  disclosure (`NavItem.more` and the disclosure in `Shell.tsx`; `splitNav`, `moreLabel` in `src/screens/nav.ts`; Escape and a
  page change close it, focus back), the
  trainee has none; «עזרה» per role (`src/domain/guide.ts`: `GUIDE_SECTIONS` maps every `##` of `docs/GUIDE.he.md` to the
  personas — a unit test fails on an unmapped heading — `guideFor`, «כל המדריך» at `/help?all=1`). The demo seeds guest data
  and three synthetic presentation PDFs in every persona (`seedDemoGuests`, `seedDemoPresentations`, `demoWeek.ts`). e2e:
  `guests.spec.ts`, `presentations.spec.ts`; a header click goes through `goSection` (`tests/e2e/helpers.ts`), which opens
  «עוד» first. DECISIONS «הריסט, שלב 5 — אתר האורחים, מילוי, מצגות וניקיון».
- `src/screens/speakers/` — the speaker's shared parts (since phase 3 of the reset no screen of its own): `sheetParts.tsx`
  (contacts, hand-over and offers, claim, `mayEditSpeaker`), `call.tsx`, `parts.tsx`, `nameCheck.tsx`, `SpeakerReviews.tsx`
  — used by `src/screens/speakerPages/` and the lesson page. The week, the new pages and /approvals share one loaded edition
  (`src/screens/weekStore.tsx`, which also feeds the header's badge); `actorIn` there is the one place a screen asks what
  the member may do.
- `supabase/seed_gate.sql` / `unseed_gate.sql` — the decision gate's synthetic practice week.
- `supabase/schema.sql` — the whole database; `tests/sql/` — its tests on PostgreSQL 16 with a
  Supabase-like bootstrap (`tests/sql/bootstrap.sql`).
- `tests/e2e/` — builds the app twice (demo / mock) and drives it in Chromium; `mock.ts` fakes the
  Supabase endpoints by route interception.
- `tests/sql/links.test.ts`, `tests/sql/kk.test.ts` — the anon surface: every bad token refused alike, the
  escort's page by date (W−7) and by key, the rate limit per address (and the review's lock-out attack, closed), the
  kk races on two connections (each from its own address, so the edition's kk lock is what is tested: the last place,
  a leader of two groups, a sign-up against a leader, one place for two groups), the residuals pinned.
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
