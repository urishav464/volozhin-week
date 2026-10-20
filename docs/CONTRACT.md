# The grid contract (Phase 1), the speaker pool (milestone 2), from placement to arrival (milestone 3), outputs and knowledge (milestone 4), links and מכריכה לכריכה (milestone 5a), sources and the reader (milestone 5ב-1), memorial times and logistics (milestone 5ב-2), the import of 5786, and after the week (milestone 6)

The commands the grid issues, and exactly what each does. **Two implementations must agree on
every line of this file:** the SQL RPCs in `supabase/schema.sql` (the real thing) and
`src/data/engine.ts` (in memory, behind `DemoPort`, so the demo and the decision gate behave
exactly like production). `tests/parity/` runs the same scenarios against both and compares the
resulting state and error codes.

Types are those of `src/domain/types.ts`. Times are minutes since the day column's midnight,
390–1830 (`src/domain/time.ts`); a range is half-open `[start, end)`.

## Actors and permission

Every command runs as a signed-in member of the edition (`app.my_role(edition)` not null), else
`not_member`. Roles: `admin`, `content`, `logistics`. **Logistics may not issue any command in
this file** (`forbidden`). An `archive`-kind or `archived`-status edition refuses every command
from non-admins (`archived`).

`actor` = the caller's `members.id`. "Owner or admin" = the approach's `owner_member_id` is the
actor, or the actor is admin of the edition. An approach nobody holds (`owner_member_id` null — an
admin sent the speaker back to the pool) is no one's: only an admin passes "owner or admin" for it
(v6 made the SQL say so; the engine always did).

## Invariants (enforced by the database itself, mirrored by the engine)

| Name | Rule | Code |
|---|---|---|
| one handler | `approaches` unique on `(edition_id, speaker_id)` | `approach_owned` (when someone else holds it) |
| room | two non-cancelled lessons of an edition never share a room at overlapping times — drafts included | `room_taken` |
| speaker | a speaker is never in two **closed** lessons at overlapping times (lead or co) | `speaker_busy` |
| pitch | `pitches` unique on `(lesson_id, approach_id)` | (revive, never duplicate) |
| bounds | `390 ≤ start < end ≤ 1830`, both multiples of 5, `day` 0–4 | `bad_shape` |
| closing | a closed `lesson`-kind lesson has ≥1 speaker, each `vetted='approved'` with known gender | `not_vetted` / `gender_unknown` |
| version | every update of a lesson/approach that carries a `version` must match it; a successful update increments it | `stale` |

"Lesson row" = a `grid_rows` row of kind `lesson` that is active on the day (its `days` include
it, and the edition's window — Sunday from `first_day_from`, Thursday until `last_day_until` —
does not exclude it; see `rowActive` in `src/grid/layout.ts`).

## Commands

### `propose(edition, speaker, target, mode)` → `{ lesson_id, pitch_id }`

"I approached this speaker about this cell." `target` is either `{ lesson_id }` (an existing
draft) or `{ day, start_min, end_min, room_id | null }` (a cell). `mode` is `self` (default) or
`offer` (put the speaker forward to their current owner).

1. Speaker must exist and not be `retired` → else `speaker_retired`.
2. Target lesson:
   - `{ lesson_id }`: must be a non-cancelled `lesson`-kind lesson of the edition in state
     `draft` → else `cell_closed`.
   - a cell: the range must lie within one lesson row of that day → else `outside_grid`.
     `room_id null` = the edition's default room; a room of another edition → `bad_shape`
     (as in `move_lesson`). If a draft with exactly that
     `(day, start, end, room)` exists, use it; else create a draft there (the room invariant may
     refuse with `room_taken`).
3. Approach for `(edition, speaker)`:
   - none → create `{ owner = actor, status = 'approached' }`;
   - owned by the actor (or owner null → becomes actor) → use it; if its status is `claimed`,
     set `approached`;
   - owned by someone else: `mode = self` → `approach_owned`; `mode = offer` → use THEIR approach
     (the pitch below is created as `candidate`, `proposed_by = actor`).
4. Pitch state: `approached` for `self`; `candidate` for `offer`; **always `candidate` if the
   speaker is not `vetted = 'approved'`.**
5. If a pitch `(lesson, approach)` exists: live (`candidate`/`approached`) → upgrade
   `candidate → approached` when step 4 says `approached`, else leave it; dead (`declined`,
   `withdrawn`, `superseded`) → revive with step 4's state. `accepted` cannot occur on a draft.
6. Return the lesson and pitch ids.

### `unpropose(pitch)`

Owner-of-the-approach, the pitch's proposer, or admin. Pitch must be live → else no-op.
Sets it `withdrawn`. Then, if its lesson is a draft that is **plain** (no live pitches left,
no title, `parallel_reason` null, it is exactly one lesson row in the default room) the draft is
deleted, giving the cell back.

### `set_pitch(pitch, state)` — `state ∈ {candidate, approached, declined}`

Owner or admin. Only on a live or declined pitch of a draft. `approached` is refused with
`not_vetted` for an unvetted speaker.

### `close_lesson(pitch)`

Owner or admin. The pitch must be live and its lesson a draft (`cell_closed` otherwise).
1. Speaker vetted (`not_vetted`), gender known (`gender_unknown`), not retired.
2. Lesson → `closed`; `lesson_speakers (lesson, speaker, 'lead')`. The speaker invariant may
   refuse with `speaker_busy` (then nothing changes).
3. This pitch → `accepted`; other live pitches **on this lesson** → `superseded`; other live
   pitches **of this approach** on other lessons → `withdrawn`.
4. Approach status → `positive`.

### `reopen_lesson(lesson)`

Owner-of-the-lead-speaker's-approach or admin. Closed → draft. If `approval = 'approved'` and the
actor is not admin → `approved_locked`; if `paid_at` is set → `paid_locked`, for everyone (money
that went out is not erased with the speaker: «שולם» is undone first). Deletes its
`lesson_speakers`; its `accepted` pitch → `approached`. Does not change times, title, category,
audience or teaching time. **Its stages start over** — they belonged to the speaker who leaves
(«From placement to arrival»): the lesson's `transport_details` row is deleted, and every stage
column goes back to its default (`pay_amount` null, `transport` none, `approval` none,
`approval_note approved_by approved_at confirm_sent_at confirm_sent_by` null, `needs_reconfirm`
false, `escort_roster_id` null, `self_intro` false, `escort_note` null, `sources_kind` pending,
`print_when` none, `sources_note presentation_url` null, `in_reader` false). So whoever closes the
lesson next — another member, another speaker — never inherits the last speaker's pickup address,
approved amount or «נשלחה».

### `move_lesson(lesson, day, start_min, end_min, room_id)`

Owner or admin for a closed lesson; any content member for a draft. Bounds and
lesson-row containment as in `propose` (a range may span several consecutive lesson rows of
the day — a merged lesson moved whole). Room and speaker invariants apply (`room_taken`,
`speaker_busy`). A closed lesson whose message was sent is flagged by the reconfirm rule
(«From placement to arrival»). Increments `version`.

### `reshape(edition, day, row_start, op, …)`

Content or admin. Acts on the lesson row of `day` that starts at `row_start`.
- `split_parallel(count ∈ {2,3}, reason)`: make the row hold `count` lessons covering the full
  row, each in a different room. Existing non-cancelled lessons covering exactly the row count;
  new drafts go to the free rooms in `rooms.sort` order with `parallel_reason = reason`. Not
  enough free rooms → `room_taken`. `reason` must be non-empty → `bad_shape`.
- `split_time(parts[])`: `parts` are minutes, each ≥ 15 and a multiple of 5, summing to the row's
  length → else `bad_shape`. A closed lesson anywhere in the row → `cell_closed`. Result: one
  draft per part in the default room, back to back. Live pitches of drafts that were in the row
  move to the FIRST part (deduplicated per approach); the old drafts are deleted.
- `merge_next()`: the row's single lesson (a draft or closed; create a plain draft if the row is
  free) is extended to the end of the next lesson row of that day (the nearest lesson row
  starting at or after its end). Any closed lesson in the swallowed range → `merge_blocked`.
  Drafts in the swallowed range: their live pitches move onto the extended lesson (deduplicated),
  then they are deleted. Room and speaker invariants apply. A closed lesson that changes time
  with `confirm_sent_at` set → `needs_reconfirm` (the reconfirm rule).
- `reset()`: the lessons overlapping the row: any closed → `cell_closed`. Otherwise all are
  deleted; if they held live pitches, one plain draft is created on the row (default room)
  carrying them (deduplicated per approach). A merged lesson that started on this row is reset to
  this row.

### `update_lesson(lesson, version, patch)`

`patch ⊆ { title, category_id, audience, teach_min }`. Content or admin. A memorial slot →
`memorial_slot` (v11). Version must match
(`stale`). `title` and `audience` are trimmed; an empty one becomes null. `teach_min` must be > 0 and ≤ the lesson's length → `bad_shape`. Increments
`version`. A new title or teaching time after the message was sent → the reconfirm rule.

## Errors

Exactly the codes above and those of «The speaker pool» below, each with a Hebrew message in
`src/errors.ts`:
`not_member forbidden archived speaker_retired approach_owned not_vetted gender_unknown room_taken
speaker_busy cell_closed merge_blocked bad_shape outside_grid approved_locked paid_locked stale`.
SQL raises them as `raise exception using message = '<code>', errcode = 'P0001'` (constraints
are caught and re-raised under their code), so PostgREST returns the code as the error message.

## RPC signatures (PostgREST, schema `public`)

All `SECURITY DEFINER` functions that check the caller themselves (DECISIONS, phase 1 §5) — `load_week` alone is `SECURITY INVOKER`, so RLS decides what it returns — granted to `authenticated` only.
Parameter names are part of the contract — `SupabasePort` calls them by name.

| RPC | Parameters | Returns |
|---|---|---|
| `load_week` | `p_edition bigint` | `jsonb` — the `Week` shape of `src/domain/types.ts` (keys `edition rows rooms categories speakers approaches availability lessons lessonSpeakers pitches team roster escortTicks`; `roster` since v7, `escortTicks` since v9) |
| `propose` | `p_edition bigint, p_speaker bigint, p_lesson bigint` (null for a cell), `p_day int, p_start int, p_end int, p_room bigint` (null = default room), `p_mode text` (`self`/`offer`) | `jsonb {lesson_id, pitch_id}` |
| `unpropose` | `p_pitch bigint` | `void` |
| `set_pitch` | `p_pitch bigint, p_state text` | `void` |
| `close_lesson` | `p_pitch bigint` | `void` |
| `reopen_lesson` | `p_lesson bigint` | `void` |
| `move_lesson` | `p_lesson bigint, p_day int, p_start int, p_end int, p_room bigint` | `void` |
| `reshape` | `p_edition bigint, p_day int, p_row_start int, p_op text, p_count int, p_reason text, p_parts int[]` (unused ones null) | `void` |
| `update_lesson` | `p_lesson bigint, p_version int, p_patch jsonb` | `void` |

`load_week` is a function (not a set of table reads) so the grid loads in one round trip; it
returns only what the caller's RLS lets them see, and never a contact detail.

# The speaker pool (milestone 2, schema v6)

The same two implementations: the SQL functions of `supabase/schema.sql` «Milestone 2» and
`src/data/engine.ts` (behind `DemoPort`, through `src/data/demoSpeakers.ts`); `tests/parity` runs
the same scenarios on both. As in the grid, `authenticated` has SELECT only on `speakers`,
`speaker_contacts`, `approaches` and `availability`; every write below is a `SECURITY DEFINER`
function in `public` (`search_path = ''`) that checks the caller.

## Text and lists (what both sides accept)

| Rule | Detail | Code |
|---|---|---|
| one line | runs of ASCII whitespace → one space, trimmed; empty → null; counted in characters (code points) | `bad_value` past the limit |
| a block (notes) | CRLF → LF, ASCII whitespace trimmed at both ends | `bad_value` past the limit |
| limits | name 120 · disambiguator 60 · title 40 · affiliation 120 · bio_short 400 (block) · topic 40, at most 10 · status/hand-over note 200 · vetting note 300 · availability note 120 · phone 40 · email 120 · secretary_note 300 (block) · contact notes 1000 (block) | `bad_value` |
| name | required; its key (`app.name_key`) must not be empty | `name_required` |
| title | null, or one of the edition's `settings.titles` (a non-empty array of strings), else ד״ר · פרופ׳ · הרב · הרבנית | `bad_value` |
| gender | `m`, `f` or null (unknown) — what someone chose, **never guessed** | `bad_value` |
| contact_pref | `phone`, `whatsapp`, `email`, `secretary` or null | `bad_value` |
| topics | a JSON array of strings (or absent/null = none); empty ones and repeats (the first kept) dropped | `bad_value` |
| phone | at least 6 digits | `bad_phone` |
| contact email | `^[^ @]+@[^ @]+\.[^ @]+$`, kept as typed | `bad_contact_email` |

**Similar names.** Two name keys are *similar* when pg_trgm's `similarity(a, b) ≥ 0.6` — inclusive,
like pg_trgm's `%` operator («הצעה», `app.similar_threshold()` = `SIMILAR_THRESHOLD`). `src/domain/trigram.ts` is pg_trgm's similarity
in the browser (lower-case; words of letters and digits; each padded «␣␣word␣»; distinct
trigrams; shared / (a + b − shared), a 4-byte float).

**A closed lesson stands.** A speaker teaching a closed lesson in a **live real** edition (kind
`real`, status ≠ `archived`) cannot be un-approved, have the gender cleared or be retired
(`lesson_closed`). An archive, an archived edition and a practice or demo week pin nothing in the
pool. An approach with a closed lesson **in its own edition** can only be `positive` (any kind).

**The pool's record is cross-year.** Who may rewrite a speaker's own fields (`update`) is decided by
the same editions the contacts rule counts: a global admin anywhere; otherwise only in a real,
non-archived edition. A practice or demo edition (anyone there may claim any pool speaker) and an
archived one give no right over the pool.

## Reads

### `matches(name)` — `speaker_matches(p_name)` → `jsonb[]`

Any member (`not_member`). The key of `name`; empty → `[]`. Every speaker (retired too) whose key
is the same (`match = 'same'`) or similar (`'similar'`), same first, then by similarity, at most
20. Fields: `id title name disambiguator gender affiliation vetted retired match similarity`.

### `contacts(speaker)` — `get_speaker_contacts(p_speaker)` → `jsonb | null`

`SECURITY INVOKER`: read through the policy `speaker_contacts_read`, whose predicate is
`app.may_see_contacts(speaker)` — a **global admin**, or whoever handles the speaker (owns its
approach, as content or admin) in a **real, non-archived** edition (unchanged from v3). Anyone else
gets null; no row yet → four nulls. Never in `load_week`, never in Realtime.

### `history(speaker)` — `speaker_history(p_speaker)` → `jsonb[]`

Any member. The speaker's closed lessons in editions of kind `real` or `archive` (not practice or
demo): past years (an `archive` edition, or one whose status is `archived`) for every member; a live
edition only when the caller can see it (`app.can_see_edition`, as the `lessons` policy). Fields
`edition_id edition_label edition_kind start_date day start_min end_min title category role`, newest
edition first. No contact, no payment.

### `activity(speaker)` — `speaker_activity(p_speaker)` → `jsonb[]`

Any member. Newest first, at most 200: the speaker's own events (any edition) and the
`approaches` / `pitches` rows about them in editions the caller can see. Ids, states, field names
and short notes only — never a contact value. (The demo logs the pool's commands only.)

## Commands

### `create(edition, fields, {claim, approve, confirmed})` — `create_speaker` → `{speaker_id, approach_id}`

Content or admin of the edition (`not_member` / `forbidden` / `archived`, as `app.require_editor`).
In this order:
1. name (`bad_value`, `name_required`), disambiguator, title, gender, affiliation, bio_short,
   topics, contact_pref — each cleaned and checked as above.
2. `approve` by anyone but a global admin → `forbidden`.
3. Search first: the same key **and** the same disambiguator (null = '') → `speaker_exists`; the
   same key with no disambiguator given → `disambiguator_required`; unless `confirmed`, the same
   key or a similar one → `speaker_similar`.
4. Insert: `vetted = 'approved'` (`vetted_by` = the global admin) when `approve`, else `pending`;
   `created_by` = actor. Logged (`speakers insert`). (Storage only, not in a Week: from a `demo`
   edition the row's `source` is `synthetic`, so `unseed_gate.sql` removes it with the gate.)
5. `claim` → an approach in the edition, owner = actor, status `claimed`.

### `update(edition, speaker, version, patch)` — `update_speaker` → `void`

Content or admin of the edition; the speaker must exist (`stale`); the actor is a global admin, or
the edition is real and not archived and the actor owns the speaker's approach there or is admin
there (`not_handler` — also for anyone in a practice, demo or archived edition); `version` must
match (`stale`). Keys present in `patch` (null clears; unknown keys ignored): those of `create`,
and `retired` (a JSON boolean, `bad_value`; a global admin's, `forbidden`). A new key/disambiguator: taken by another speaker →
`speaker_exists`; the key taken and no disambiguator → `disambiguator_required`. Clearing the
gender or retiring under a live closed lesson → `lesson_closed`. Nothing changed → no-op;
else `version + 1`, logged with the changed field names.

### `vet(speakers[], state, note)` — `vet_speakers` → `void`

A global admin (`forbidden`); `state ∈ {approved, rejected, pending}` (`bad_value`). Each id in
ascending order, all or nothing: missing → `stale`; not `approved` under a live closed lesson →
`lesson_closed`; already that state with that note → unchanged; else `vetted`, `vetted_note`,
`vetted_by`, `vetted_at`, `version + 1`, logged (`speakers vet`, no edition).

### `setContacts(speaker, {phone, email, secretary_note, notes})` — `set_speaker_contacts` → `void`

Any member (`not_member`); the speaker must exist (`stale`); `may_see_contacts` (`contacts_hidden`).
All four replaced (null clears); nothing changed → no-op; logged with the field names only.

### `claim(edition, speaker)` — `claim_speaker` → approach id

Content or admin; the speaker exists and is not retired (`speaker_retired`). No approach → one,
owner = actor, `claimed`; owner null → the actor takes it (`version + 1`); the actor's → as is;
someone else's → `approach_owned` (also when two claim at once: one wins).

### `setStatus(approach, version, status, note)` — `set_approach_status` → `void`

The approach must exist (`stale`); editor of its edition; owner or admin (`not_handler`); version
(`stale`); `status ∈ {claimed, approached, positive, declined, no_answer}` (`bad_value`); note.
`approached`/`positive` for a speaker not approved → `not_vetted`; anything but `positive` with a
closed lesson in the edition → `lesson_closed`. The same status and no note → no-op. `declined`:
the approach's live pitches → `declined`. `version + 1`; logged with the note.

### `handOver(approach, to, note)` — `hand_over` → `void`

The approach must exist (`stale`); editor of its edition. **Admin** of the edition: owner := `to`
(null = back to the pool), any pending offer cleared. **Owner**: `offered_to := to` (null withdraws
the offer). Anyone else → `not_handler`. `to` must be an active content or admin member of the
edition (or of every edition), and not the owner offering to themselves → `bad_member`. No
change and no note → no-op; else `version + 1`, logged with the note.

### `answerHandOver(approach, accept, note)` — `answer_handover` → `void`

The approach must exist (`stale`); editor of its edition; an offer waiting for the actor, else
`stale`. Accept → owner := actor; either way `offered_to := null`, `version + 1`, logged.

### `setAvailability(edition, speaker, day, part, kind, note)` — `set_availability` → `void`

Editor of the edition; `day` 0–4, `part ∈ {morning 390–780, afternoon 780–1140, evening 1140–1440,
night 1440–1830}`, `kind ∈ {can, cannot, null}` (`bad_value`); note. The speaker's approach in the
edition, owned by the actor or the actor admin (`not_handler` — also when there is none). Every
row of that approach and day overlapping the part is cut back to what lies outside it; then, unless
`kind` is null, one row for the whole part. Logged.

## Errors (the pool)

`speaker_exists disambiguator_required speaker_similar not_handler lesson_closed bad_member
contacts_hidden bad_phone bad_contact_email name_required bad_value` — plus the grid's
`not_member forbidden archived stale not_vetted speaker_retired approach_owned`.

## RPC signatures (the pool)

| RPC | Parameters | Returns |
|---|---|---|
| `speaker_matches` | `p_name text` | `jsonb` |
| `create_speaker` | `p_edition bigint, p_fields jsonb, p_claim boolean, p_approve boolean, p_confirmed boolean` (all three default false) | `jsonb {speaker_id, approach_id}` |
| `update_speaker` | `p_edition bigint, p_speaker bigint, p_version integer, p_patch jsonb` | `void` |
| `vet_speakers` | `p_speakers bigint[], p_state text, p_note text` | `void` |
| `get_speaker_contacts` | `p_speaker bigint` (invoker) | `jsonb` or null |
| `set_speaker_contacts` | `p_speaker bigint, p_phone text, p_email text, p_secretary_note text, p_notes text` | `void` |
| `speaker_history` | `p_speaker bigint` | `jsonb` |
| `speaker_activity` | `p_speaker bigint` | `jsonb` |
| `claim_speaker` | `p_edition bigint, p_speaker bigint` | `bigint` |
| `set_approach_status` | `p_approach bigint, p_version integer, p_status text, p_note text` | `void` |
| `hand_over` | `p_approach bigint, p_to bigint, p_note text` | `void` |
| `answer_handover` | `p_approach bigint, p_accept boolean, p_note text` | `void` |
| `set_availability` | `p_edition bigint, p_speaker bigint, p_day integer, p_part text, p_kind text, p_note text` | `void` |

`load_week` (v6) also returns each speaker's `disambiguator contact_pref vetted_by vetted_note
version` and each approach's `offered_to` — still never a contact detail.

# From placement to arrival (milestone 3, schema v7)

A closed lesson's stages: payment and transport (with the instructor's approval), the summary
message to the speaker, the escort, the sources. The same two implementations: the SQL functions
of `supabase/schema.sql` «Milestone 3» and `src/data/engine.ts` (behind `DemoPort`); the cleaning
rules are `src/data/stageRules.ts` in the browser. `tests/parity` runs the same scenarios on both.
`lessons` stays SELECT-only for a browser; every write below is a `SECURITY DEFINER` function in
`public` (`search_path = ''`) that checks the caller.

"Handler" = the owner of the approach of the lesson's **lead** speaker in the edition
(`app.lesson_handler`); a closed lesson has one. "Handler or admin" = that member, or an admin of
the edition (`app.require_handler`: `not_closed` for a lesson that is not closed, then
`not_handler`). A lesson the command names that does not exist (or is cancelled) → `stale`.
Every successful lesson write increments `version` and sets `updated_by`.

## The reconfirm rule (all commands)

A **closed** lesson whose `confirm_sent_at` is set gets `needs_reconfirm = true` when a command
changes what the message says: `day start_min end_min room_id title teach_min pay_amount`, or
when it becomes closed again with its message still marked (`reopen_lesson` clears the mark, so
only a hand edit gets there: a lesson closed again after a reopen has a first message to send,
not a reconfirm). A write that sets a **new** `confirm_sent_at` (the message re-sent) is the one
exception. In SQL this is one trigger (`app.lessons_reconfirm`, so it holds for any write path —
the SQL Editor too); in the engine, one check after every command (`Engine.reconfirm`). Drafts are
never flagged. Only `mark_confirm_sent` clears the flag.

`{{תאריך}}` and `{{יום}}` come from the edition's opening Sunday, so moving `editions.start_date`
from one date to another (or back to TBD) flags every closed lesson of the edition whose message
was sent, with `version + 1` (`app.editions_reconfirm`, a trigger on `editions` — the «מחזור» tab
writes the row directly; `DemoSettings.updateEdition` in the demo). Setting a date that was TBD
flags nothing: no message carried one.

## Text and values (what both sides accept)

| Rule | Detail | Code |
|---|---|---|
| amount | `null` (none asked: a volunteer, or not decided — never a default), or a whole number 1–100000 (a typo guard, «הצעה») | `bad_amount` |
| transport | `none`, `one_way`, `round_trip` | `bad_value` |
| decision | `approved` or `rejected`; note one line ≤ 300 | `bad_value` |
| escort | a `roster` row **of the lesson's edition**, or null; `self_intro` a boolean; note a block ≤ 300 | `bad_escort` / `bad_value` |
| sources | kind `pending sheet presentation sheet_presentation sheet_video none other`; print_when `none before same_day`; note a block ≤ 500; `in_reader` a boolean, stored **false** for `pending`, `none` and `presentation` (nothing to print) | `bad_value` |
| presentation_url | null, or one line ≤ 500 matching `^https?://[^ ]+$` (case-insensitive) | `bad_url` |
| transport details | pickup_address ≤ 200, pickup_time ≤ 60 (as the team writes it), driver_name ≤ 80 — one line each; driver_phone ≤ 40 with ≥ 6 digits; `arranged` true/false (null = false) | `bad_value` / `bad_phone` |
| template | a block ≤ 4000; empty removes it | `bad_value` |
| duty phrases | a JSON array of `{when, text}`: `when` ∈ `always self_intro escort_intro transport memorial`, `text` one line ≤ 200; empty texts and repeats (the first kept) dropped; at most 30; empty removes them | `bad_value` |

## Commands

### `setPayment(lesson, version, amount, transport)` — `set_payment` → `void`

Editor (`app.require_editor`: logistics `forbidden`, an archive `archived` for non-admins);
handler or admin; `version` (`stale`); amount and transport (above). The same amount and transport
as stored, and the approval not `rejected` → no-op. A lesson marked paid (`paid_at` set) keeps its
amount: a different one (null included) → `paid_locked` — «שולם» is undone first (`setPaid`, by
logistics or an admin), so a new amount is never shown as paid; the transport may still change.
Otherwise: `pay_amount`, `transport`;
`approval` := `none` when nothing is asked (amount null and transport `none`), else `pending`;
`approval_note`, `approved_by`, `approved_at` := null. So changing an approved request sends it
back to the instructor, and asking a rejected one again re-opens it. Transport `none` deletes the
lesson's transport details (and so does `reopen_lesson`: they were the speaker's).

### `decidePayments(items[{lesson, version}], decision, note)` — `decide_payments` → `void`

A global admin (`forbidden`); decision (`bad_value`); `p_lessons` and `p_versions` of one length
(`bad_value`). Each item in ascending (lesson, version) order, all or nothing: the lesson missing,
at another version, not `pending`, or not `closed` → `stale` (the queue on screen is out of date;
an amount changed since is never approved unseen; a draft's request is no one's — `reopen_lesson`
clears it, so only a hand edit leaves one). Sets `approval`, `approval_note`, `approved_by` (the
global admin's row), `approved_at`.

### `markConfirmSent(lesson, version)` — `mark_confirm_sent` → `void`

Editor; handler or admin; `version`; approval `pending` → `approval_pending`, `rejected` →
`approval_rejected` (DESIGN: no summary while a payment or transport waits). Sets
`confirm_sent_at = now`, `confirm_sent_by`, `needs_reconfirm = false` — every time (sending again
refreshes it).

### `setEscort(lesson, version, {roster_id, self_intro, escort_note})` — `set_escort` → `void`

Editor (any content member or admin); the lesson closed (`not_closed`); `version`; values (above).
Nothing changed → no-op.

### `setSources(lesson, version, {sources_kind, print_when, sources_note, presentation_url, in_reader})` — `set_sources` → `void`

Editor; closed (`not_closed`); `version`; values in that order (above). Nothing changed → no-op.

### `setPaid(lesson, paid)` — `set_paid` → `void`

`app.require_logistics`: logistics or an admin of the edition (content → `forbidden`; an archive
`archived` for non-admins). The lesson has an amount and `approval = 'approved'`, else
`payment_not_approved`; `paid` a boolean (`bad_value`). Already so → no-op; else `paid_at` :=
now / null.

### Transport details — `get_transport_details` / `set_transport_details`

Personal data (an address, a driver's phone): `transport_details(lesson_id PK, pickup_address,
pickup_time, driver_name, driver_phone, arranged)`, never in `load_week`, never in Realtime.
`app.may_see_transport(lesson)`: a **global admin**; or, in a **real, non-archived** edition, the
lesson's **handler** (content or admin there) — and that edition's **logistics** members once the
lesson's transport is not `none` and `approval = 'approved'`. Nobody else: not another content
member, not the edition's admin who is not the handler, not a practice or demo week's team, not
last year's. Because the handler is whoever handles the lesson's *current* lead speaker, the row
never outlives that speaker: `reopen_lesson` deletes it with the other stages.
- `transport(lesson)` — `get_transport_details(p_lesson)`, `SECURITY INVOKER` (read through the
  policy `transport_details_read`, whose predicate is the same function): null when hidden; no row
  yet → four nulls and `arranged: false`.
- `setTransport(lesson, details)` — any member (`not_member`); the lesson exists (`stale`);
  `may_see_transport` (`transport_hidden`); `transport <> 'none'` (`no_transport`); values (above).
  All five replaced; nothing changed → no-op; logged (`lessons transport {fields}`) with the field
  names only, never a value. Since v9 the escort's link writes `pickup_address` too
  (`escort_pickup`), so the lesson panel saves the fields its form changed over the details read
  again at the moment of saving (`mergeTransport`, `src/data/stageRules.ts`), never a stale copy.

### Templates — `set_confirm_template` / `set_duty_phrases`

An admin of the edition (`app.require_edition_admin`: `not_member`, then `forbidden`). They write
`editions.settings.confirm_template` (the summary message's template — `src/domain/message.ts`)
and `editions.settings.duty_phrases` (the escorts' phrases — `src/domain/escorts.ts`), the
instructor's own wording: **never seeded**, absent until pasted. `start_edition` carries both over
from the live real edition (else the newest real one) to the new one.

## Errors (milestone 3)

`not_closed not_handler bad_amount approval_pending approval_rejected bad_escort bad_url
no_transport transport_hidden payment_not_approved paid_locked bad_phone bad_value` — plus
`not_member forbidden archived stale`. (`paid_locked` is also `reopen_lesson`'s.)

## RPC signatures (milestone 3)

| RPC | Parameters | Returns |
|---|---|---|
| `set_payment` | `p_lesson bigint, p_version integer, p_pay_amount numeric, p_transport text` | `void` |
| `decide_payments` | `p_lessons bigint[], p_versions integer[], p_decision text, p_note text` (default null) | `void` |
| `mark_confirm_sent` | `p_lesson bigint, p_version integer` | `void` |
| `set_escort` | `p_lesson bigint, p_version integer, p_roster bigint, p_self_intro boolean, p_note text` (default null) | `void` |
| `set_sources` | `p_lesson bigint, p_version integer, p_kind text, p_print_when text, p_note text, p_url text, p_in_reader boolean` | `void` |
| `set_paid` | `p_lesson bigint, p_paid boolean` | `void` |
| `get_transport_details` | `p_lesson bigint` (invoker) | `jsonb` or null |
| `set_transport_details` | `p_lesson bigint, p_pickup_address text, p_pickup_time text, p_driver_name text, p_driver_phone text, p_arranged boolean` (default false) | `void` |
| `set_confirm_template` | `p_edition bigint, p_body text` | `void` |
| `set_duty_phrases` | `p_edition bigint, p_phrases jsonb` | `void` |

`load_week` (v7) also returns the edition's `roster` (`id full_name gender` — names only), and each
lesson's stage columns (`pay_amount transport approval approval_note approved_by approved_at
paid_at confirm_sent_at confirm_sent_by needs_reconfirm escort_roster_id self_intro escort_note
sources_kind print_when sources_note presentation_url in_reader`) — never a transport detail.

# Outputs and knowledge (milestone 4, schema v8)

The outputs — the tracking table, the escorts' list, the designer's export, the archive — are made
in the browser from a loaded Week (`src/exports/`, pure and unit-tested); nothing is uploaded but a
designer export's snapshot. The database adds three tables and one function (`supabase/schema.sql`
«Milestone 4»), reached as `port.outputs` (`src/data/outputs.ts`) and `port.knowledge`
(`src/data/knowledge.ts`), each with a Supabase and a Demo implementation. Unlike the grid, these
are **direct writes under RLS** (as «הגדרות»): column grants, and a guard trigger that stamps who and
when and keeps what one statement cannot. A refusal is a code of `src/errors.ts`.

## Reads and writes

| What | Read | Write | Rules |
|---|---|---|---|
| `export_snapshots(id, edition_id, kind 'designer', payload jsonb, created_by, created_at)` | the edition's admins (`app.my_role = 'admin'`, a global admin included) | INSERT `(edition_id, kind, payload)` by the same; never UPDATE or DELETE | `payload` an array (≤ 2000 rows, ≤ 1 MB) of objects whose keys are only `lesson_id kind day date time speaker title category room parallel` with scalar values, else `bad_value`; `created_by`/`created_at` the database's |
| `notes(id, edition_id NULL, section, title, body_md, version, created_by, updated_by, created_at, updated_at)` | cross-year (`edition_id` null): every member; an edition's: whoever sees it | cross-year: a global admin; an edition's: its admins — INSERT `(edition_id, section, title, body_md)`, UPDATE `(section, title, body_md)`, DELETE | `section ∈ process lessons_learned challenges templates` (`23514`); title one line ≤ 120, required (`title_required`); body a block ≤ 20000 (`bad_value`); `version + 1` on every update (the browser updates `where version = <seen>`: no row → `stale`); `edition_id`, authors and times never the browser's |
| `milestones(id, edition_id, title, days_before, done_at, done_by, created_by, created_at)` | the edition's members | its admins — INSERT `(edition_id, title, days_before)`, UPDATE `(title, days_before, done_at)`, DELETE | `days_before` −90…365 (`23514`; negative = after the week, W+n); title as a note's; `done_at` set → the database's `now()` and the marker as `done_by` (a second «done» keeps the first time), null → both null |

`start_edition` copies the milestones (title, days_before — none done) of the edition whose settings it
carries over (the live real one, else the newest real). `app.member_has_history` counts notes,
milestones and snapshots. None of the three tables is ever published to Realtime.

## `phones(lessons)` — `get_contacts_for(p_lessons bigint[])` → `jsonb` (an array of `{lesson_id, speaker_id, phone}`)

`SECURITY INVOKER`: `lesson_speakers` and `speaker_contacts` are read through their policies, and every
row also passes `app.may_see_contacts(speaker)` — the predicate of `get_speaker_contacts`. Rows
`{lesson_id, speaker_id, phone}` for the given lessons' speakers (at most the first 1000 ids) whose phone
is set; phones only. Never more than `get_speaker_contacts` would show one speaker at a time
(`tests/sql/outputs.test.ts` holds the two equal for every member and lesson); `[]` for a null or empty list.

## The archive's reads

A global admin's archive reads `activity` (the edition's rows, in pages of 1000), `speaker_contacts`
(the speakers the edition touched) and `transport_details` (its lessons) **directly, through their
policies** — the grants were already SELECT; what comes back is exactly what the caller may see.

## Errors (milestone 4)

`title_required` — plus `bad_value forbidden stale`.

## RPC signatures (milestone 4)

| RPC | Parameters | Returns |
|---|---|---|
| `get_contacts_for` | `p_lessons bigint[]` (invoker) | `jsonb` |

# Links and מכריכה לכריכה (milestone 5a, schema v9)

Links without an account (DESIGN «גישה בלי חשבון»): an escort's link, the class's sign-up link for
מכריכה לכריכה, the schedule link. The same two implementations: the SQL functions of
`supabase/schema.sql` «Milestone 5a» and `src/data/engine.ts` (behind `DemoPort`, through
`src/data/demoLinks.ts`); `tests/parity` runs the same scenarios on both — the public pages' answers
included. This is the first surface for `anon`: it may execute `ping` and the six functions of «The
anon functions» below, and nothing else — no table, no other function.

## Links

`share_links(id, edition_id, scope escort|kk_signup|schedule, subject_id, token_hash, created_by,
created_at, expires_at, revoked_at)`. `subject_id` is the escort (a `roster` row of the edition) for
`escort`, null otherwise. **The token** is 128 random bits (`extensions.gen_random_bytes(16)`),
base64url (22 characters), returned once by `issue_link`; the database keeps only
`sha256(token)` and finds a link by the hash of what was presented, never by the plaintext. No
browser role may read `token_hash` (column grants): an edition's admins read every other column of
their edition's links (`share_links_read`), everyone else nothing. A link opens at `/e#<token>`,
`/k#<token>`, `/s#<token>` — after `#`, so the token reaches no log and no Referer.

| Rule | Detail |
|---|---|
| expiry («הצעה») | `escort`, `schedule`: the end of the week, Friday 00:00 Israel time (`start_date + 5`); while the date is TBD, 720 hours after issue. `kk_signup`: `settings.kk_window.closes_at`; no window, 720 hours after issue (`app.link_expiry`, `linkExpiry`). Stored in `expires_at` and recomputed, for links not revoked, whenever the edition's `start_date` or `kk_window` changes (`app.editions_link_expiry`; `Engine.refreshLinkExpiry`) |
| rate limit («הצעה») | 10 minutes. An `escort` link (one person's) is one count: 60 calls. A class link (`kk_signup`, `schedule`, held by the whole class) is counted **per caller's address** — Cloudflare's `cf-connecting-ip`, else the first entry of `X-Forwarded-For` from PostgREST's `request.headers`, kept only as its sha256; none reported is a count of its own — 1200 calls each (`share_link_hits(token_hash, client_hash, window_start, hits)`, `app.link_rate` / `linkRate`, `app.link_client` / `linkClient`). There is no count the class shares, so nobody can use up the link for the others. A refused call is rolled back with everything else, so only answered calls count; a counted call clears the link's counts whose window has passed |
| one live link | per `(edition, scope, subject)`: issuing again revokes the live one (replace) |

### `issue(edition, scope, subject)` — `issue_link` → `{link_id, token, expires_at}`

`app.require_edition_admin` (`not_member`, then `forbidden`); an archive or archived edition
`archived`; `scope` one of the three (`bad_value`); `escort` needs a trainee of the edition
(`bad_escort`), the others none (`bad_value`); an expiry already past — the week over, the window
closed — `link_past`. Then the live link of the same subject is revoked, and the new one inserted
(`created_by` = the caller's member row). `expires_at` as `app.iso` writes it.

### `revoke(link)` — `revoke_link` → `void`

The link must exist (`stale`); an admin of its edition; already revoked → nothing.

## The anon functions

Each is `SECURITY DEFINER`, `search_path = ''`, takes the token first, and answers a fixed shape.
**One refusal for every link problem: `link_invalid`** (P0001, no detail, no hint) — a token
outside 16–64 characters, unknown, of another scope, revoked, expired, of an archived or archive
edition, or past its rate limit; and, for the escort's writes, a lesson that is not closed, not in
the link's edition, or not escorted by its trainee. In that order: the shape, the lookup and the
link's state, the edition, then the count (`app.link_for`, `Engine.linkFor`).

### `escortView(token)` — `escort_view` → `jsonb`

`{edition: {label, start_date}, escort: {full_name, gender}, phones_from, lessons: [...]}` — the
link's trainee's **closed** lessons in its edition, in grid order (day, start, the room's sort, id).
Each lesson exactly: `lesson_id kind day date start_min end_min room speaker title self_intro
duty_notes escort_note phone transport driver ticks`.
- `date`: the day column's date (`start_date + day`) or null; `start_min`/`end_min`: the teaching
  time (`app.teach_end` = the lesson's `teach_min`, else min(`settings.lesson_minutes` ?? 75, the
  slot); a memorial slot its whole length).
- `speaker`: the lead speaker's `{name (title + name), gender}`, or null.
- `duty_notes`: the edition's duty phrases that apply, in their order — `app.duty_notes`, the rule
  of `src/domain/escorts.ts` (`dutyNotes`). Never the amount.
- `phone`: the lead speaker's `speaker_contacts.phone` — only in a `real` edition whose
  `start_date` is set, and only from W−7: the date in Israel ≥ `start_date − 7`. Else null.
  `phones_from` is that date (`start_date − 7`) in a real edition, else null.
- `transport`: transport asked and approved (`transport <> 'none' and approval = 'approved'`).
- `driver`: `{name, phone}` from `transport_details` once `transport` and `arranged`, in a real
  edition; else null.
- `ticks`: `{reminded, met, introduced, gift}` — when each was ticked, or null.

Never an amount, an approval or its note, an e-mail, the pickup address or time, any note but
`escort_note`, another escort's lesson, a draft.

### `escortTick(token, lesson, item, on)` — `escort_tick` → `jsonb` (the lesson's four ticks)

The lesson as above (`link_invalid`); `item ∈ {reminded, met, introduced, gift}`, `on` a boolean,
and a lesson, not a memorial slot (`bad_value` — the four are a speaker's escort's; a liaison's slot
has none, and answers as an item that does not exist, after the link's one refusal: nothing the page
does not show already). On → `escort_ticks(lesson, item, at = now)` unless there (the first time is
kept); off → deleted.

### `escortPickup(token, lesson, address)` — `escort_pickup` → `void`

The lesson as above; transport approved, else `no_transport`; `address` one line ≤ 200, required
(`bad_value`). Upserts `transport_details.pickup_address` (the rest untouched). **Write-only**: no
function returns it through a link. Logged (`lessons transport {fields: [pickup_address], via:
escort_link}`, actor null) — never the value.

### `kkForm(token)` — `kk_form` → `jsonb`

`{edition: {label, start_date}, window: {opens_at, closes_at}, open, roster: [{id, full_name}],
tracks: [{id, day, date, start_min, end_min, groups: [{id, title, author, room, leaders: [{kind,
name}], full}]}]}`. `open`: `opens_at ≤ now < closes_at`. `roster`: the edition's trainees, names
only — nothing about who signed up. `tracks`: those still on the grid (their kk row active that
day — `app.kk_track_on_grid`; the first or last day's hours may move after groups exist) with a
group **on offer** (`open` and a `capacity` entered); `groups`: those on offer; `full`: the sign-ups
≥ the capacity (a count, never who). Lists the SQL orders by collation (trainees, groups by title)
are compared sorted.

**The one residual** (accepted, `tests/sql/kk.test.ts` «RESIDUAL»): `full` together with a sign-up
can tell whether a named trainee already had a sign-up in a track — sign them up for a group with
exactly one place left and read the form again: still not full means they had one. One bit per
probe, and the probe is itself a sign-up (`via 'link'`) the staff see. The link never *answers* who
signed up.

### `kkSignup(token, roster, group)` — `kk_signup` → `{status: 'received'}`, always

Records `kk_signups(track of the group, group, roster, via 'link')` only when **all** hold: the
group is of the link's edition, `open`, with a capacity, its track on the grid, the window open
now, the trainee of the edition, fewer sign-ups than the capacity — counted under the group's row
lock, which `kk_place` takes too — and no sign-up of
that trainee for that track yet (**an existing sign-up is never changed through the link**; only
`kk_place` moves one). Otherwise nothing. The answer is the same in every case: the link is no
oracle of who signed up.

### `scheduleView(token)` — `schedule_view` → `jsonb`

`{edition: {label, start_date}, rows: [...]}` — closed lessons and memorial slots (not cancelled), in
grid order, each exactly `kind day date start_min end_min speaker title category room parallel`:
the facts of `scheduleEntries` (`src/exports/designer.ts`), from which the designer's rows are
written. `speaker`: the names (title + name), the lead first then by speaker id, joined « · »;
`category`, `room`: names or ""; `parallel`: a lesson-kind lesson overlapping another closed
lesson-kind lesson of the day (by the slot). Never a contact, an amount or a note.

## The escorts' ticks for the team

`escort_ticks(lesson_id, item, at)`, read by the edition's members (`escort_ticks_read`) and in
`load_week` as `escortTicks: [{lesson_id, item, at}]`. A lesson whose `escort_roster_id` changes —
`set_escort`, `reopen_lesson`, a trainee deleted (`on delete set null`) — loses its ticks
(`app.lessons_escort_ticks`; `Engine.dropStaleTicks` after every command). No browser writes them
but through a link.

## מכריכה לכריכה

`kk_tracks(edition, day, start_min, end_min)` — one per kk occurrence of the grid (a kk `grid_rows`
row active that day, as `rowActive`), made by the first group on it; `kk_groups(edition, track,
title, author, room_id, capacity, open)`; `kk_leaders(group, kind staff|trainee|ein_prat, roster_id
| label, sort)`; `kk_signups(edition, track, group, roster, via link|staff, created_at)`, unique
`(track, roster)`, the group inside its track and the trainee inside the edition by composite keys;
`book_orders(group, copies, ordered_at)`. The window: `editions.settings.kk_window = {opens_at,
closes_at}` (instants as `toISOString` writes them). Nothing is seeded: books, leaders and
capacities are what an admin typed. Every member of the edition reads them (`load_kk`, RLS); a
browser writes none directly.

### Fields (what both sides accept — `app.kk_clean_group` / `cleanGroupFields`, in this order)

| Key | Rule | Code |
|---|---|---|
| `title` | one line ≤ 200, required (on a new group; on an update when present) | `title_required` / `bad_value` |
| `author` | null, or one line ≤ 120 | `bad_value` |
| `room_id` | null, or a room of the edition | `bad_value` |
| `capacity` | null (not offered through the link yet — never a default), or a whole number 1–1000 | `bad_value` |
| `open` | a boolean (a new group: true) | `bad_value` |
| `leaders` | an array of `{kind: 'trainee', roster_id}` (a trainee of the edition, else `bad_trainee`) or `{kind: 'staff'\|'ein_prat', label}` (one line ≤ 80); repeats dropped, the first kept; at most 6 («הצעה») | `bad_value` / `bad_trainee` |

Unknown keys are ignored; a patch writes only the keys present (`leaders` replaces them all).

### Commands — an admin of the edition (`app.require_edition_admin`), except book orders

- `addGroup(edition, day, start, fields)` — `kk_add_group` → group id: the kk row of that day
  starting at `start` (else `outside_grid`); fields; the track made on first use.
- `updateGroup(group, patch)` — `kk_update_group`: the group (`stale`), then the admin.
- `deleteGroup(group)` — `kk_delete_group`: `stale`; signed-up trainees → `group_has_signups`; a
  track left with no group goes too.
- `place(group, roster)` — `kk_place`: `stale`; a trainee of the edition (`bad_trainee`); a new
  sign-up `via staff`, or the trainee's sign-up for that track moved here. Not bound by the window
  or the capacity: the staff decide.
- `unplace(track, roster)` — `kk_unplace`: the track (`stale`); the sign-up deleted, if any.
- `setWindow(edition, opens, closes)` — `kk_set_window`: both or neither (`bad_value`), `opens <
  closes` (`bad_value`); neither removes the window (closed). The sign-up link's expiry follows.
- `setBookOrder(group, copies, ordered)` — `set_book_order`: `stale`; `app.require_logistics`
  (logistics or an admin; content `forbidden`); `ordered` a boolean, `copies` 0–1000 or null —
  null removes the line (and may not be `ordered`) (`bad_value`); `ordered_at` := the first time
  it was ordered, or null.

`load(edition)` — `load_kk(p_edition)`, invoker: `{tracks, groups, leaders, signups, orders}`
(`signups[].created_at`, `orders[].ordered_at` as `toISOString` writes them); null for an edition
the caller does not see.

None of `share_links`, `share_link_hits`, `escort_ticks` or the kk tables is ever published to
Realtime (the never-publish list of `schema.sql`).

## Errors (milestone 5a)

`link_invalid link_past bad_trainee group_has_signups` — plus `not_member forbidden archived stale
bad_value bad_escort title_required outside_grid no_transport`.

## RPC signatures (milestone 5a)

| RPC | Parameters | Returns | Role |
|---|---|---|---|
| `escort_view` | `p_token text` | `jsonb` | anon |
| `escort_tick` | `p_token text, p_lesson bigint, p_item text, p_on boolean` | `jsonb` | anon |
| `escort_pickup` | `p_token text, p_lesson bigint, p_address text` | `void` | anon |
| `kk_form` | `p_token text` | `jsonb` | anon |
| `kk_signup` | `p_token text, p_roster bigint, p_group bigint` | `jsonb` | anon |
| `schedule_view` | `p_token text` | `jsonb` | anon |
| `issue_link` | `p_edition bigint, p_scope text, p_subject bigint` (default null) | `jsonb` | authenticated |
| `revoke_link` | `p_link bigint` | `void` | authenticated |
| `load_kk` | `p_edition bigint` (invoker) | `jsonb` | authenticated |
| `kk_add_group` | `p_edition bigint, p_day integer, p_start integer, p_fields jsonb` | `bigint` | authenticated |
| `kk_update_group` | `p_group bigint, p_patch jsonb` | `void` | authenticated |
| `kk_delete_group` | `p_group bigint` | `void` | authenticated |
| `kk_place` | `p_group bigint, p_roster bigint` | `void` | authenticated |
| `kk_unplace` | `p_track bigint, p_roster bigint` | `void` | authenticated |
| `kk_set_window` | `p_edition bigint, p_opens timestamptz, p_closes timestamptz` | `void` | authenticated |
| `set_book_order` | `p_group bigint, p_copies integer, p_ordered boolean` | `void` | authenticated |

The public pages call the anon functions through `SupabasePublic` (`src/data/supabaseLinks.ts`): a
plain POST to `/rest/v1/rpc/<function>` with the publishable key in `apikey` and **no
Authorization header**, the token in the body — no session read or refreshed, so PostgREST runs it as
`anon`. A public page gets it from `loadPublicPort()` (`src/data/publicEntry.ts`), which in production
never loads supabase-js or `SupabasePort` at all; the pages call nothing else (`tests/e2e/links.spec.ts`
checks every request on the wire).

# Sources and the reader (milestone 5ב-1, schema v10)

A closed lesson's source files, and the reader built from them (DESIGN «תוצרים» 5). The same two
implementations: the SQL of `supabase/schema.sql` «Milestone 5ב-1» with the Storage policies, and
`src/data/engine.ts` (an in-memory bucket, `PoolShared.objects`, behind `DemoSources`);
`tests/parity` runs the same scenario on both — the uploads, the registrations, the refusals, the
cover and the headers included. The reader itself (`src/reader/`) is pure browser code over a loaded
Week: nothing of it is in the database but two settings.

## The bucket

Supabase Storage, bucket `sources`, created by `schema.sql`: **private** (a re-run makes it private
again, with a warning, and never rewrites its size or types), `file_size_limit` 25 MB (26214400),
`allowed_mime_types` `application/pdf image/png image/jpeg` and DOCX
(`application/vnd.openxmlformats-officedocument.wordprocessingml.document`). The bucket and its
policies are two `do` blocks, each with its own handler (no privilege on `storage`): a failed block
rolls back alone and warns — the bucket as it was before the run, or the previous policies (on a
first run none: no upload) — so the bucket goes private even when the policies cannot be
(re)created; the rest of the file applies.

**The path** (`app.source_path_re()` ≡ `SOURCE_PATH_RE` in `src/data/sourceRules.ts`, a unit test
compares the two): `<edition id>/<lesson id | cover>/<uuid>-<safe name>.<ext>` — ids without leading
zeros; the uuid lower-case hex; the safe name `[A-Za-z0-9][A-Za-z0-9_-]{0,59}` (`safeName`: the
original's base, anything else → `-`, "file" when nothing is left); `ext` one of `pdf png jpg jpeg
docx`. The original name is never in the path; it is the row's `display_name`.

| Who (policies on `storage.objects`, `bucket_id = 'sources'`) | Rule | Function |
|---|---|---|
| upload (INSERT, `authenticated`) | `app.source_refusal(name)` is null — below — and **no `source_files` row holds the path**: a path is used once (a row whose object a half-way removal deleted is never fronted by someone else's new bytes; a real upload always has a new uuid) | `app.may_upload_source` |
| read (SELECT, `authenticated`) | a member of the path's edition, any role (logistics print) | `app.may_read_source` |
| delete (DELETE, `authenticated`) | an admin of the edition; else (not an archive) its uploader — the row's `uploaded_by` is the caller's member row, or, for an object never registered, its `owner_id` is the caller's JWT `sub` | `app.may_delete_source` |
| update | nobody — a replacement is a delete and an upload | — |
| `anon` | nothing | — |

Every one of them is also a **restrictive** policy (`sources_cap_read/upload/update/delete`, and
`sources_cap_anon` for every command of `anon`), ANDed with every permissive policy on
`storage.objects`: a policy someone adds later cannot widen this bucket.

**`app.source_refusal(path)`** — in this order: not the convention → `bad_path`; the caller is no
member of the path's edition (or it does not exist) → `not_member`; logistics → `forbidden`; an
archive-kind or archived edition and not an admin → `archived`; `cover`: not an admin → `forbidden`,
a `.docx` → `bad_file`, else allowed; a lesson that is not the edition's → `bad_path`; a memorial
slot: cancelled or no plan placed on it → `no_plan`, else allowed (5ב-2); a lesson not `closed` →
`not_closed`. It is the rule of
`set_sources` (content or admin, a closed lesson). Engine: `Engine.sourceRefusal`; the upload
policy's whole predicate (with the used path): `Engine.mayUploadSource`.

The Storage API's own answers, as the browser maps them (`SupabaseSources`; `Engine.storeObject`):
over the bucket's size (413) → `file_too_big`; not one of its types (415) → `bad_file`; a policy refusal (401/403) →
`upload_refused` — a path a row already holds included; anything else, or an unregistered object
already at the path → `upload_failed`.

**What the Storage API knows of a file** (`objects.metadata`): `size` is measured by Storage itself;
`mimetype` is the uploader's declared `Content-Type`, held only to the bucket's four types — Storage
never looks at the bytes. `register_source_file` holds the type to the path's extension as well, but a
row marked `application/pdf` can still hold any bytes. The reader therefore checks the bytes
themselves — at upload and at the build, by one check (`src/reader/readable.ts`, below).

**Every upload carries `Cache-Control: private, no-store`**, which Storage stores and sends back on
every read of the file, signed URLs included: no browser or shared cache keeps a copy past its signed
URL or past a removal.

## `source_files`

`source_files(id, edition_id, lesson_id null — the poster or a lesson deleted since (on delete set
null), cover, speaker_id — the lesson's lead speaker when the file arrived (on delete set null),
storage_path unique, display_name, mime, size_bytes ≤ 26214400, page_count 1–5000 | null,
uploaded_by → members (on delete set null), uploaded_at)`. Read under RLS by every member of the
edition, in `load_week` as `sourceFiles` (`uploaded_at` as `toISOString` writes it). No browser
writes it but through the functions below. **Never published to Realtime** (the never-publish list):
the week reloads after an upload. `member_has_history` counts `uploaded_by`.

**A file of the previous speaker:** `speaker_id` is not the lesson's lead any more — after
`reopen_lesson` (which keeps every file) or a lead replaced. Listed «מהמרצה הקודם», for removal; never
in the reader; `register_source_file`'s "first file" counts only the current speaker's.

## Commands

### `upload(edition, lesson | null, file, {pages})` — Storage, then `register_source_file` → the row

The browser checks the pick (`checkPicked`, each reason its own code: a poster that is not a PDF or
a picture → `cover_bad_file`; a type we do not take → `bad_file`; over 25 MB → `file_too_big`),
reads the bytes as the reader will (`readerPages`, `src/reader/pages.ts` → `readableSource`: a PDF's
pages, a picture 1, null when the reader cannot print it — protected, damaged, not what its name
says; Word null, never read), POSTs the bytes to `/storage/v1/object/sources/<path>` with the
member's own access token (never a service key), then calls:

`register_source_file(p_edition, p_lesson, p_path, p_display_name, p_pages)` — in this order:
- the caller not a member of `p_edition` → `not_member`;
- `p_path` not the convention for exactly this edition and this lesson (`cover` when `p_lesson` is
  null) → `bad_path`;
- the lesson row locked (`for update`, this edition's) **before any other check**: a `reopen_lesson`
  that commits while this waits is seen by every check after it (→ `not_closed`), never a file
  registered on the draft and its stages set again;
- a row already at `p_path` → that row again (a retry — the browser lost the first answer —
  answered even if the lesson was reopened since), unless it is another edition's or lesson's
  (`bad_path`);
- `app.source_refusal(p_path)` → its code;
- no live object at `p_path`, or not uploaded by the caller (`owner_id` ≠ the JWT `sub`) → `no_file`;
- the object's `metadata.mimetype` not one of the four or not matching the extension, or its
  `metadata.size` missing or over 25 MB → `bad_file` — the size as Storage measured it; the type as the
  uploader declared it (Storage held it to the four, never sniffing the bytes);
- `display_name` one line ≤ 200, required; `p_pages` null or 1–5000 → else `bad_value`. The browser
  sends the picked file's name shortened to fit before the bytes go up (`displayNameOf`: cut before
  the extension, which stays — «….pdf»), so a long name is never refused after the upload.

Then the row: `page_count` = `p_pages` for a PDF; for an image 1 when the browser read it (`p_pages`
not null), else null; null for Word. **A PDF or picture with no page count was not read**
(«לא נקרא»): never printable (`readableFile`, `src/reader/model.ts`), never fetched by the build.
`speaker_id` = the lesson's lead; `uploaded_by` = the caller's member row. **A lesson's file:** `sources_kind`
`pending` → `sheet` (a file arrived); and when it is the current speaker's first file and the kind
prints something (not `pending none presentation`), `in_reader` := true — only then, so a lesson
someone unmarked stays unmarked. `version + 1` when either changed. **A poster:** the edition's first
one the browser read (`page_count` not null) becomes the cover (`settings.reader_cover`), when none
is marked; one it could not read never does (the build would not fetch it). Engine:
`Engine.registerSourceFile` (`arrived`, `pagesFor`).

A registration the database refuses (a `CommandError`) removes the uploaded object again (the
browser, under the delete policy), and the refusal is shown. A registration with no answer (a
dropped connection, a 5xx — no refusal) is asked once more with the same arguments: the row it made,
or the row now, or a refusal (→ the object removed). No answer twice: the object is kept — it may be
registered — and the error shown.

### `remove(file)` — Storage, then `remove_source_file(p_file)` → `void`

The stored object first, through the Storage API under the delete policy — a refused delete is no
error there (nothing is deleted, the answer an empty list), so the refusal comes from
`remove_source_file` (`not_uploader`, or `file_present`); a failed call to the Storage API →
`remove_failed`. Then: no such row → nothing; not a member → `not_member`; an archive and not an
admin → `archived`; not an admin and not its uploader → `not_uploader`; **the object still in the
bucket → `file_present`**; else the row goes, and `settings.reader_cover` with it when it named the
file. So a failure half-way leaves a row whose file is gone — visible, removed again with one tap —
never an object nobody can see.

### `urls(edition, paths)` — signed URLs

`createSignedUrls` for 600 seconds (`SIGNED_URL_SECONDS`), at most 20 per call when the reader is
built; the bucket has no public URL. The demo: object URLs of its in-memory blobs.

### `setHeaders(edition, left, right)` — `set_reader_headers` → `void`

`app.require_edition_admin`; each one line ≤ 120 (`clean_line`); both empty removes
`settings.reader_headers`, else it is `[left ?? '', right ?? '']`. **Never seeded:** absent, the
reader has no running headers.

### `setCover(edition, file | null)` — `set_reader_cover` → `void`

`app.require_edition_admin`; a file must be a poster (`cover`) of this edition, not Word, and one the
browser could read (`page_count` not null — the build never fetches one it could not), else
`bad_value`; null removes `settings.reader_cover` (the reader opens with a schedule page).

## The reader (browser only — `src/reader/`)

`readerManifest(week)` (`model.ts`): one row per `scheduleEntries` entry — every closed lesson and
memorial slot, not cancelled, in grid order — with its status:

| Status | When |
|---|---|
| `no_sources` | `sources_kind = none` |
| `presentation_only` | `sources_kind = presentation` (whatever `in_reader` says) |
| `included` | `in_reader`, and a PDF or an image of the current speaker that was read (a page count) |
| `needs_pdf` | `in_reader`, none read, and Word files |
| `unreadable` («צריך קובץ אחר») | `in_reader`, none read, no Word, and PDFs or images not read |
| `missing` | `in_reader` and no file; or not marked, not pending, and no file |
| `pending` | not marked, `sources_kind = pending` |
| `not_marked` | not marked, files arrived (read or not) |
| `memorial` | a memorial slot: always in, its header page (its materials: `memorialFiles`, 5ב-2) |

A row's files split into `printable` (read: what the build merges), `word` and `unread`; an
`included` row counts `printable`, then names the rest («ועוד קובץ Word אחד שלא נכנס — צריך PDF»,
«ועוד קובץ אחד שלא נקרא — צריך קובץ אחר»; `wordText`, `unreadText` — the lesson panel's words too).
`manifestTotals` counts each status (`unreadable` included). The marked poster is the cover only when
it was read; else the schedule is. The screen's estimate is `readerEstimate(manifest,
scheduleLines(week))`: the build's own plan, the cover the poster's pages or the schedule's
(`scheduleCoverPages`).

The PDF (`layout.ts`, `assemble.ts`, in a module worker): first the cover — the marked poster's
pages, else schedule pages made from the designer's rows; the table of contents (each day, each
entry with the page it starts on); then each day: every `included` row — a header strip «מרצה –
כותרת» (TBD for a missing name or title) with its day and teaching time on its first page, then its
files' pages, each scaled to fit A4 with its aspect and rotation kept — and every memorial slot; a
«סיכום יום» page closes every day. Running headers `[left, right]` alternate (an odd page the left
one); page numbers count from the cover's first page as 1; the cover carries neither. Hebrew is drawn on an OffscreenCanvas and
embedded as PNG. Only read files are fetched; the screen names the unread ones at once, under «לא
נכנסו (צריך להעלות קובץ אחר):» — every one of every lesson marked `in_reader`, a row left out
(`unreadable`) as well as an `included` one (`unreadForReader`, `src/reader/model.ts`), in schedule
order, then what the build left out (never the same file: it fetches only read ones). Every file is
opened — `openSource` (`src/reader/readable.ts`), the same steps as the upload's `readableSource` —
and embedded before the pages are planned; a file that
cannot be read — a PDF that does not open or is protected, has no pages, or one whose pages pdf-lib
cannot decode (all its pages or none), a picture that is neither PNG nor JPEG by its bytes, a PNG
whose image data does not inflate to its end (`src/reader/png.ts`, before pdf-lib's decoder, which
never returns on data cut short), a JPEG whose structure cannot be followed or whose frame pdf-lib
does not take (its own header read, `JpegEmbedder.for`, on the cleaned bytes: not 1, 3 or 4
components) or whose frame has no width or height — is left out and named, and the build goes on. A picture is drawn as what its bytes are (a PNG saved as .jpg is a PNG). **A
JPEG goes in without its metadata** (`src/reader/jpeg.ts`): only APP0, APP14, the tables, the frame
and the scans are kept — EXIF (GPS, camera, time), XMP, ICC, MPF, comments and anything after the
image are dropped, and so is a marker without a length (RST0–7, TEM) outside a scan, which libjpeg
ignores; its EXIF orientation is read first and honoured. A PDF's pages are copied with
**their printing annotations and filled form fields painted in** (`src/reader/annotations.ts`, as a
viewer prints, PDF 32000-1 §12.5.5: the Print flag and not Hidden, never a Popup or a Link; the
normal appearance — a check box's by its /AS — its /BBox through its /Matrix onto its /Rect; one
that cannot be followed is skipped alone, never the file); an annotation with no appearance stream
is not drawn. A page's box is taken with its corners in order (`[0 842 595 0]` is an upright A4).
An image inside a PDF keeps what it carries. The result is downloaded — never uploaded.

**The lesson's «מקראה» stage** (`stagesOf(lesson, readerFilesOf(week, id))`, `src/domain/stages.ts`)
says what the manifest says (`readerFilesOf` → `{printable, word, unread}`): «במקראה» (done) only
for `included`; marked with no PDF or picture of the current speaker that was read → open, «חסר
קובץ», «צריך PDF» when Word files came, or «צריך קובץ אחר» when only unread ones did.
`nextLessonStep` then still says `sources` for such a lesson («המרצים שלי», the tracking table).

The build's button shows on a computer — `(min-width: 1024px), (pointer: fine)`: a mouse at any
width, or 1024px and up; elsewhere the screen says it is built on a computer.

The Word skeleton (`docx.ts`, docx 9.8.1): a title «תוכן העניינים» and a TOC field updated on open,
a heading per day (Heading 1, outline level 0) opening a page with its first entry under it, every
lesson marked `in_reader` (not `presentation_only`, not `no_sources` — whatever its files) and every
memorial slot as a heading (Heading 2, outline level 1) on its own page, a «סיכום יום» page per day of
22 ruled lines (a bottom and a between border: a bottom alone is drawn once under the whole block),
right to left by default (`pPrDefault` `w:bidi` — the TOC's paragraphs too), A4, the same running
headers and a page number.

## Errors (milestone 5ב-1)

`bad_path no_file bad_file not_uploader file_present not_closed` from the database; `upload_refused
upload_failed remove_failed read_failed`, and `file_too_big` (413), from the Storage API as the
browser maps it; `bad_file cover_bad_file file_too_big` from the browser's own check of a pick
(`checkPicked`) — plus `not_member forbidden archived bad_value`.

## RPC signatures (milestone 5ב-1)

| RPC | Parameters | Returns | Role |
|---|---|---|---|
| `register_source_file` | `p_edition bigint, p_lesson bigint, p_path text, p_display_name text, p_pages integer` | `jsonb` (the row) | authenticated |
| `remove_source_file` | `p_file bigint` | `void` | authenticated |
| `set_reader_headers` | `p_edition bigint, p_left text, p_right text` | `void` | authenticated |
| `set_reader_cover` | `p_edition bigint, p_file bigint` | `void` | authenticated |

`authenticated` may also execute `app.may_upload_source`, `app.may_read_source` and
`app.may_delete_source` — the policies run as the browser's role (`tests/sql/schema.test.ts` pins
them).

# Memorial times and logistics (milestone 5ב-2, schema v11)

Memorial times (DESIGN «זיכרון», «זמני זיכרון»), and the one read the logistics screen adds. The same
two implementations: `supabase/schema.sql` «Milestone 5ב-2» and `src/data/engine.ts` (behind
`DemoPort`, `DemoMemorial`); `tests/parity` runs the fallen, the contacts, slots, plans, placing,
the policy and the transports on both and compares results, refusals and state. Every write is a
`SECURITY DEFINER` function in `public`; the reads are invoker, under RLS.

## The tables

| Table | What | Who reads | Who writes |
|---|---|---|---|
| `fallen` | one cross-year list: `name` (one line ≤ 120), `gender` (`m`/`f`/null — chosen, never guessed), `note` (≤ 500), `active` | `app.may_see_fallen`: a global admin, any admin, or the team of an edition with a plan for them | a global admin (`save_fallen`, `delete_fallen`) |
| `fallen_contacts` | the family's contact person: `contact_name`, `relation`, `phone`, `email`, `note` — **personal data of a bereaved family** | `app.may_see_fallen_contacts`: a global admin, or an admin of a **real, non-archived** edition with a plan for that fallen — one fallen at a time (`get_fallen_contacts`) | the same people (`set_fallen_contacts`) |
| `memorial_plans` | one per fallen per edition: `family_status` (`not_contacted invited confirmed cannot_come other_speaker`), `speaker_text` (≤ 200), `planned_minutes` (1–180 or null), `hard_stop`, `materials_note` (≤ 500), `lesson_id` (the slot it is placed on — one plan per slot), `version` | the edition's whole team (`app.can_see_edition`), in `load_week` | the edition's admins (functions below) |

`fallen_contacts` is **never** in `load_week`, Realtime, a link (`escort_view`, `schedule_view`,
`kk_form`), the tracking table, the escorts' list, the designer's export or the logistics lists — only
in the admin's archive, in its personal-data file. None of the three tables is published to Realtime
(`tests/sql/schema.test.ts`). `source_files.fallen_id` (on delete set null): a memorial slot's file
remembers the fallen of the plan it was uploaded for.

`load_week` adds `memorialPlans` (every column above) and `fallen` (`id, name, gender` of the fallen
those plans are for — never the note, never a contact), and `sourceFiles[].fallen_id`.

## Slots

A memorial slot is a lesson of kind `memorial` (a draft, always). DESIGN «בכל מקום ובכל משך»: an
admin makes one anywhere inside a memorial row of the grid, any part of it, any room.

### `addMemorialSlot(day, start, end, room | null)` — `add_memorial_slot(p_edition, p_day, p_start, p_end, p_room)` → `bigint`
An admin of the edition. The bounds (`app.check_bounds`: 5-minute steps → `bad_shape`); the day locked; `[start, end)` inside one of the
day's memorial rows as the edition's window allows it (`app.memorial_rows`, rowActive) →
`outside_grid`; a room not of the edition → `bad_shape`; null → the default room; the room invariant
→ `room_taken`. Returns the new lesson's id.

### `removeMemorialSlot(lesson)` — `remove_memorial_slot(p_lesson)` → `void`
An admin. Not a memorial slot → `stale`; a plan placed on it → `memorial_placed`. Its files' rows
stay (lesson_id null) for removal.

A slot never moves by drag (`move_lesson` → `memorial_slot`), its title, category and minutes are
not written (`update_lesson` → `memorial_slot`, for everyone: its title reaches the anon links, and no
screen edits one), and a merge that would swallow one is
refused (`reshape` `merge_next` → `merge_blocked`; `split_time`/`reset` treat it as a closed cell).

## Plans

### `addMemorialPlan(fallen)` — `add_memorial_plan(p_edition, p_fallen)` → `bigint`
An admin. The fallen is not active (or does not exist) → `bad_value`; already planned in this
edition → `duplicate`. The fallen's row is locked (`for share`) before that check, so a
`delete_fallen` or a deactivation on another connection either lands first (→ `bad_value`, never a
raw foreign-key error, never a plan for an inactive fallen) or waits for the plan and sees it
(`in_use`). In the tray (`lesson_id` null), `not_contacted`. Logged in the edition's activity
(`memorial_plans`, `insert`, `{fallen}`, the caller's member id): a plan is what opens the family's
contact to the edition's admins.

### `updateMemorialPlan(plan, version, patch)` — `update_memorial_plan(p_plan, p_version, p_patch jsonb)` → `void`
An admin (`app.memorial_plan`: no plan → `stale`). Another version → `stale`; not an object →
`bad_value`. The keys present, in this order (`cleanPlanPatch`): `family_status` (one of five),
`speaker_text` (string or null, one line ≤ 200), `planned_minutes` (a whole number 1–180 — a typo
guard, «הצעה» — or null), `hard_stop` (a boolean), `materials_note` (string or null, block ≤ 500);
anything else → `bad_value`; unknown keys ignored. Nothing changed → nothing; else version + 1.

### `placeMemorialPlan(plan, version, lesson | null)` — `place_memorial_plan(p_plan, p_version, p_lesson)` → `void`
An admin, at the version. Onto a memorial slot of the plan's edition, not cancelled (`bad_value`),
holding no other plan (`memorial_taken`) — or off it (null). The same slot again: nothing. **The
liaison goes with the plan**: the slot it leaves loses `escort_roster_id` and `escort_note`, the slot
it comes to takes them (both versions + 1; the escorts' ticks of both start over).

### `deleteMemorialPlan(plan)` — `delete_memorial_plan(p_plan)` → `void`
An admin. Placed → `memorial_placed`. Logged like the insert (`delete`, `{fallen}`).

### The liaison
DESIGN «בזמני זיכרון, המלווה הוא איש הקשר של המשפחה»: the slot's escort, through `setEscort` —
on a memorial slot only an admin of the edition (`forbidden`), only once a plan is placed
(`no_plan`), never a self-introduction (`bad_value`). The escort's link and the escorts' list show
the slot (the fallen's name in the list; the link shows «זמן זיכרון») — never a family's contact.
Neither shows the speaker's four ticks for it (`ticksApply`, `src/domain/escorts.ts`: a lesson's
only): the link says the liaison's role in their gender instead, and counts lessons and memorial times
apart. `escort_tick` refuses a memorial slot too (`bad_value`, as an unknown item — never a wider
answer to anon); a tick of the liaison's own is the instructor's to decide, if ever.

### Materials
`app.source_refusal`: a memorial slot with a plan placed on it takes uploads from content and admins
(else `no_plan`); `register_source_file` writes the plan's `fallen_id` on the row and leaves the
lesson alone. The reader (`memorialFiles`) takes the files of the plan's fallen wherever the plan is
placed now, with a lesson's verdicts: `memorial_received` (a printable file), `memorial_needs_pdf`
(Word only), `memorial_unreadable` (only files the browser could not read), `memorial_missing` (a
plan, nothing yet), `memorial` (no plan); the header «זמן זיכרון – <name>» is in the reader in every
one of them. A plan in the tray keeps its files — `Manifest.waiting`, «ממתין לשיבוץ», shown on its
card in «זמני זיכרון» and on «מקראה» — never for removal. Only the files of a fallen with no plan in
the edition (the plan deleted) are a slot's leftovers (`memorialLeftovers`: «מתוכנית שנמחקה
מהמחזור»), never in the reader.

## The policy — `setMemorialPolicy(policy)` — `set_memorial_policy(p_edition, p_placement, p_max_minutes, p_warn_adjacent_meal)` → `void`
An admin. `settings.memorial = {placement?, max_minutes?, warn_adjacent_meal?}` — never seeded; the
staff meeting decides it. `max_minutes` 1–180 or null (`bad_value`), `placement` a block ≤ 500; only
the parts given are kept; all three empty removes it. Warnings (`src/rules/warnings.ts`): a plan
longer than its slot always (`memorial_over_slot`); longer than `max_minutes` (`memorial_too_long`)
and a slot next to a meal row (`memorial_near_meal`, a slot a plan is placed on: the grid's memorial
rows sit next to lunch by design) only once the policy sets them. A memorial slot is never in the
gender balance or the category load. Every warning keeps its time range left to right inside the
Hebrew (`dayRange`: an LRM before it).

## The fallen and their families (`port.memorial`, `src/data/memorial.ts`)

| Call | RPC / read | Who | Refusals |
|---|---|---|---|
| `fallen()` | `select` on `fallen` (RLS) | as `app.may_see_fallen` | — |
| `saveFallen(id \| null, fields)` | `save_fallen(p_fallen, p_name, p_gender, p_note, p_active)` → `bigint` | a global admin | `not_member forbidden name_required bad_value stale` |
| `deleteFallen(id)` | `delete_fallen(p_fallen)` | a global admin | `forbidden stale in_use` (planned somewhere: deactivate instead) |
| `contacts(fallen)` | `get_fallen_contacts(p_fallen)` (invoker) → `jsonb` or null | `app.may_see_fallen_contacts`; no row yet → five nulls; not theirs → null | — |
| `setContacts(fallen, c)` | `set_fallen_contacts(p_fallen, p_contact_name, p_relation, p_phone, p_email, p_note)` | the same | `stale contacts_hidden bad_phone bad_contact_email` |

All five contact fields are replaced (null clears one); the activity log records which fields
changed, never their values. The row goes in the edition whose plan gives the caller access
(`app.fallen_contacts_edition` / `Engine.fallenContactsEdition`: the newest real, non-archived edition
with a plan for that fallen in which the caller is an admin), as the caller's member row there — so
it is in that edition's log and archive. A global admin with no such plan: no edition, their own id
(the row is then only in the database, not in an edition's log). The fallen's row is locked
(`for key share` — the lock the foreign key takes anyway) before the `stale` check, so a
`delete_fallen` on another connection either lands first (→ `stale`, never a raw foreign-key error)
or waits for the write and then deletes the fallen with their contact; a rename does not wait.

## The logistics screen's transports — `transports()` — `get_transports_for(p_edition)` → `jsonb`
Invoker. The edition's closed lessons with `transport <> 'none'` and `approval = 'approved'`, each
`{lesson_id, pickup_address, pickup_time, driver_name, driver_phone, arranged}` exactly as
`get_transport_details` shows it (no row yet → nulls and `arranged` false), and **only** the lessons
`app.may_see_transport` lets the caller see — never more than the one-lesson call. Ordered by lesson
id. Never in a Week or Realtime. Edited through `setTransport` (`set_transport_details`), as in the
lesson panel.

The four lists themselves are browser code over a loaded Week (`src/exports/logistics.ts`): הסעות
(the pickup address and the driver's phone only behind «כולל כתובות וטלפונים»), תשלומים (approved
amounts, «שולם» through `setPaid`, the totals), ספרים (`port.kk`, `set_book_order`), הדפסות
(`print_when` before / same_day, the current speaker's files, their pages — no copy count).

## Errors (milestone 5ב-2)

`no_plan memorial_taken memorial_placed memorial_slot contacts_hidden bad_contact_email in_use
duplicate outside_grid room_taken stale bad_value forbidden name_required merge_blocked`; the
archive's `archive_cancelled` is the browser's.

## RPC signatures (milestone 5ב-2)

| RPC | Parameters | Returns | Role |
|---|---|---|---|
| `get_fallen_contacts` | `p_fallen bigint` | `jsonb` | authenticated (invoker) |
| `get_transports_for` | `p_edition bigint` | `jsonb` | authenticated (invoker) |
| `save_fallen` | `p_fallen bigint, p_name text, p_gender text, p_note text, p_active boolean default true` | `bigint` | authenticated |
| `delete_fallen` | `p_fallen bigint` | `void` | authenticated |
| `set_fallen_contacts` | `p_fallen bigint, p_contact_name text, p_relation text, p_phone text, p_email text, p_note text default null` | `void` | authenticated |
| `add_memorial_slot` | `p_edition bigint, p_day integer, p_start integer, p_end integer, p_room bigint default null` | `bigint` | authenticated |
| `remove_memorial_slot` | `p_lesson bigint` | `void` | authenticated |
| `add_memorial_plan` | `p_edition bigint, p_fallen bigint` | `bigint` | authenticated |
| `update_memorial_plan` | `p_plan bigint, p_version integer, p_patch jsonb` | `void` | authenticated |
| `place_memorial_plan` | `p_plan bigint, p_version integer, p_lesson bigint` | `void` | authenticated |
| `delete_memorial_plan` | `p_plan bigint` | `void` | authenticated |
| `set_memorial_policy` | `p_edition bigint, p_placement text, p_max_minutes integer, p_warn_adjacent_meal boolean` | `void` | authenticated |

`authenticated` may also execute `app.may_see_fallen` and `app.may_see_fallen_contacts` — the
policies run as the browser's role (`tests/sql/schema.test.ts` pins them).

# The import of 5786 (schema v12)

Last year's files (תשפ"ו) into the database (DESIGN «ייבוא תשפ"ו»; DECISIONS «ייבוא תשפ"ו»). The same two
implementations: `supabase/schema.sql` «Import 5786» and `src/data/engine.ts` (`importCommit`, `importLookup`,
behind `DemoPort`'s `imports`); `tests/parity` runs candidates, an archive (made, then replaced) and the escorts on
both and compares results, refusals and state. Both functions are `SECURITY DEFINER` in `public`, and both are a
**global admin's** (`app.require_global_admin`: not a member → `not_member`; a member who is not a global admin —
an edition's admin included → `forbidden`).

**What travels.** The files never reach the server. The wizard («הגדרות ← ייבוא», `src/screens/settings/ImportTab.tsx`)
reads a paste or an .xlsx/.docx in the page (`src/import/`), the admin maps, reviews and decides, and only the
reviewed rows arrive, as one payload. Nothing raw is stored — not in the database, not in the browser's storage. The
pool is read as `load_week` gives a speaker (`port.imports.pool()`: `speakers` without any contact column).

## `lookup(speakers[], phoneKeys[])` — `import_lookup(p_speakers bigint[], p_phone_keys text[])` → `jsonb`
`stable`. At most 5000 of each (`import_too_big`). Returns `{phones: [{key, speaker_id}], contacts: [{speaker_id,
phone, email, secretary_note, notes}]}`: the pool speakers whose stored phone has one of the keys (by
`app.phone_key`), and, for the speakers asked about and those the phones found, **which** contact fields are filled
— booleans, never a value. Ordered by key then speaker; contacts by speaker.

## The phone key — `app.phone_key(text)` ≡ `phoneKey` (`src/import/phone.ts`)
The digits; a leading `972` or `00972` becomes a `0`, and **one** `0` written after it is dropped («+972 (0)…»); 8–9
digits with no leading `0` get it back (a number cell ate it — «הצעה»); fewer than 6 digits → null. The two are held
equal value for value (`tests/sql/import.test.ts`).

## `commit(kind, payload)` — `import_commit(p_kind text, p_payload jsonb)` → `jsonb`
One transaction: **every row or none.** In this order: `p_kind` one of `candidates tracking escorts` and `p_payload`
an object, else `bad_value`; more than 1000 rows (`tracking`: speakers + lessons) or more than 1,000,000 bytes →
`import_too_big`. A row the function refuses aborts the whole call with `import_bad_row`, its detail `«row:reason»`
(the row's `row`, or −1; the reason one of this file's codes); the browser's `ImportRowError(row, reason)`.

### A speaker row (`candidates` rows, `tracking` speakers) — `app.import_speaker`
Checked in this order (`cleanSpeakerRow`, `src/data/importRules.ts`, the same): `action` `new`/`merge` → else
`bad_value`; `name` one line ≤ 120 with a non-empty name key → else `name_required`; `title` one of the titles of
`titles_from`'s edition (null: the default four) → else `bad_value`; `gender` `m`/`f`/null **and exactly what the
title says** (`app.title_gender`: הרב → m, הרבנית → f, any other title or none → null) → else `bad_value`;
`affiliation` ≤ 120; `topics` as `create_speaker` takes them; `phone` ≤ 40 with ≥ 6 digits → else `bad_phone`;
`email` ≤ 120, one `@` and a dot after it → else `bad_contact_email`; `notes` a block ≤ 1000.

Resolved:
- `merge`: the speaker `speaker_id` (locked) — gone → `stale`.
- `new`: the one pool speaker with this name key (two → `disambiguator_required`); else the one speaker whose stored
  phone has this phone's key; else a **new** speaker: `vetted='pending'`, `source` the payload's, `created_by` the
  caller, the title and gender as given (a name taken a moment ago by another connection → `speaker_exists`).
  So a re-run, or a row the browser thought new, **completes** — never a second copy.
- Completing **fills only what is empty**: the speaker's `title`, `gender`, `affiliation`, `topics` (an empty array is
  empty), and `speaker_contacts`' `phone`, `email`, `notes`. A field with a value is never overwritten. A speaker
  whose own record got a field: `version + 1`.

### `candidates` — `{source, titles_from, rows: SpeakerRow[]}`
`rows` an array, else `bad_value`; `source` one line ≤ 60, else `bad_value`. Each row as above.

### `tracking` — `{label, start_date, source, titles_from, speakers: SpeakerRow[], lessons: ArchiveLessonRow[]}`
In this order: `speakers` and `lessons` arrays → else `bad_value`; `label` one line ≤ 60 → else `label_required`;
`start_date` null/`""` or `yyyy-mm-dd`, a real date → else `bad_value`, a Sunday → else `not_sunday`; an edition with
this label that is not of kind `archive` → `edition_exists`; `source` as above. Then the speakers (as above), then:
- **No edition with this label:** a new one — `kind='archive'`, `status='archived'`, `start_date` only as given; its
  grid rows copied from `grid_template` (as `start_edition` makes them), one default room «בית מדרש» (the same label
  made a moment ago by another import → `stale`).
- **An archive edition with this label:** **all its lessons are deleted** (their speakers with them) and replaced
  by these; its `start_date` set to the one given (null included); its speakers stay in the pool.
- Each lesson, checked in this order (`cleanLessonRow`): an object; `day` 0–4, `390 ≤ start_min < end_min ≤ 1830`,
  multiples of 5 → else `bad_shape`; `room` 0–9 → else `bad_value` (0 the default room; k «מקביל k+1», made when first
  needed); `title` ≤ 200; `category_id` null or a category → else `bad_value`; `audience` ≤ 120; `sources_kind` one of
  the kinds, `print_when` one of `none before same_day` → else `bad_value`; `sources_note` ≤ 500; `pay_amount` null or
  a whole 1–100000 → else `bad_amount`; `import_note` a block ≤ 1000; `speakers` a non-empty array of distinct
  indexes into the payload's `speakers` → else `bad_value`.
- Inserted `kind='lesson'`, `state='closed'`, `updated_by` the caller; its speakers — the first `lead`, the rest `co`;
  two rows that resolved to one pool speaker are one speaker here. The room invariant → `room_taken`, the speaker
  invariant → `speaker_busy` (the row named). **The closing invariant is not applied**: an archive's lesson is a
  record of what was, its speakers may be pending, their gender unknown.
- `lessons.import_note` (v12): what the sheet said that has no field of its own («הסעה/תשלום» words, «קיבל הודעת
  סיכום מ» — a note, never a member), cleared of phones and e-mails in the browser. Written by this import only;
  `load_week` carries it; the lesson panel shows it («מגיליון המעקב של אשתקד»).
- The archive's lessons are in `speaker_history` like any edition's.

### `escorts` — `{rows: PrefsRow[]}`
`rows` an array → else `bad_value`. Each row: an object; `speaker_id` a pool speaker → else `stale`; `contact_pref`
null or a channel (`app.pick_contact_pref`) → else `bad_value`; `secretary_note` a block ≤ 300. **Fill only what is
empty:** `speakers.contact_pref` (`version + 1`), `speaker_contacts.secretary_note`. No speaker is added.

### The result and the log
`{created, merged, filled, contacts, lessons, replaced, edition_id, speakers: [{row, speaker_id, created}]}` —
`merged` counts every speaker row that completed one (`escorts`: every row), `filled` those whose record got a
field, `contacts` those whose contacts did; `lessons` and `replaced` the archive's; `edition_id` null but for
`tracking`; `speakers` each speaker row as resolved, in order.
The activity log: per speaker `insert` (`{vetted, source}`), `update` and `contacts` (`{fields: […]}` — field names);
per call one `import` entry (entity `import`, the archive's edition and id for `tracking`, kind = the call's kind)
with the counts and the source. **Never a name, a phone, an e-mail or a note.**

## Errors (the import)

`not_member forbidden bad_value import_too_big import_bad_row` and, as a row's reason, `name_required bad_phone
bad_contact_email disambiguator_required speaker_exists stale bad_shape bad_amount room_taken speaker_busy`; for
`tracking`, `label_required not_sunday edition_exists stale`. The browser's own, before anything is sent:
`import_too_big` (a file or a table past `IMPORT_LIMITS`), `import_bad_file`, `import_encrypted`.

## RPC signatures (the import)

| RPC | Parameters | Returns | Role |
|---|---|---|---|
| `import_lookup` | `p_speakers bigint[], p_phone_keys text[]` | `jsonb` | authenticated (a global admin's; definer) |
| `import_commit` | `p_kind text, p_payload jsonb` | `jsonb` | authenticated (a global admin's; definer) |

The helpers (`app.phone_key`, `app.title_gender`, `app.jint`, `app.jlen`, `app.require_global_admin`,
`app.refuse_row`, `app.import_speaker`, `app.import_speakers`, `app.import_room`) are no API role's
(`tests/sql/import.test.ts`).

# After the week (milestone 6, schema v12)

«איך עבר» per lesson, the year's summary, the purge of the edition's private data, and the move to next
year (DESIGN «שלבים», שלב 4). Two implementations: `supabase/schema.sql` «Milestone 6» and
`src/data/engine.ts` (reviews, the purge — behind `DemoPort`, `DemoReviews`), with
`src/data/demoSettings.ts` for start_edition's option and its dry run (settings, like start_edition itself:
their unit tests hold them to the SQL tests' answers). `tests/parity` runs reviews (who writes, when,
who reads) and the purge on both and compares results, refusals and state.

## «איך עבר» — `lesson_reviews`

| Column | What |
|---|---|
| `lesson_id` | the closed lesson (primary key: one review per lesson; on delete cascade) |
| `edition_id` | its edition (written by the function; the policy reads it) |
| `speaker_id` | the lesson's lead speaker **when the review was written** — the review is about them (a lesson reopened and closed with someone else keeps the old review, said so in the panel) |
| `went_well`, `issues` | blocks of at most 2000 characters (`app.clean_block` / `cleanBlock`), or null |
| `invite_again` | `yes` / `no` / `maybe`, or null (not said) |
| `overran` | boolean, default false |
| `rating` | 1–5, or null — optional |
| `written_by`, `written_at`, `version` | who saved last (members.id), when (the database's clock), a version |

**Reads.** `lesson_reviews_read`: `app.my_role(edition_id) in ('admin', 'content')` — the edition's admins
and content members; **never logistics**. Never in `load_week` (so never the offline copy), Realtime, a
link (`escort_view`, `schedule_view`, `kk_form`), the designer's export or the tracking table. In the admin's
archive, in `reviews.json`. `member_has_history` counts `written_by`.

### `reviews.ofEdition(edition)` — `load_reviews(p_edition)` → `jsonb[]`
Invoker, under the policy: `{lesson_id, speaker_id, went_well, issues, invite_again, overran, rating,
written_by, written_at, version}` by lesson id; an edition the caller may not read → `[]`.

### `reviews.save(edition, lesson, version, fields)` — `save_lesson_review(p_lesson, p_version, p_went_well, p_issues, p_invite_again, p_overran, p_rating)` → `integer` (the version saved)
Refusals, in this order (engine and SQL alike):
1. the lesson missing or cancelled → `stale`;
2. not a member of its edition → `not_member`; logistics → `forbidden`;
3. an archive (or an archived edition) and not its admin → `archived`;
4. not a closed lesson of kind `lesson` (a draft, a memorial slot) → `not_closed`;
5. not an admin of the edition: not the lesson's handler (`app.lesson_handler`) → `not_handler`; the
   week's date TBD, or the Israel date before `app.review_opens_on(start_date, day, end_min)` → `review_closed`;
6. `version` ≠ the stored one (0 when there is none) → `stale`;
7. a text over 2000, an answer other than yes/no/maybe, a rating outside 1–5 → `bad_value`; nothing said
   at all (both texts empty, no answer, no rating, no overrun) → `review_empty`.

The same answers (and the same lead speaker) again change nothing and return the stored version.
Otherwise the row is written with `speaker_id` = the current lead, `written_by` = the caller, `written_at`
= now, `version` + 1.

**When it opens** (`reviewOpensOn`, `src/domain/reviews.ts`; `app.review_opens_on`): the day after the
calendar day the lesson ends on — `start_date + day + ⌊(end_min − 1) / 1440⌋ + 1`, compared with today's date in
Israel (`now() at time zone 'Asia/Jerusalem'` / `israelDate`). A lesson ending at 24:00 opens the next
day; a night lesson in a day's column (00:30–02:00) ends on the next date and opens the day after. An admin of
the edition writes at any time.

### `reviews.ofSpeaker(speaker)` — `speaker_reviews(p_speaker)` → `jsonb[]`
Definer. `not_member` for a non-member; `forbidden` unless `app.may_read_reviews()`: a global admin, or an
admin or content member of a real edition that is not archived (the people the contacts rule counts — a
practice or demo week, last year's team and logistics never). Returns the reviews whose `speaker_id` is the
speaker, in `real` and `archive` editions: a past year (`kind = 'archive'` or `status = 'archived'`) to
anyone allowed, a live edition only to its own admins and content members. Each `{edition_id,
edition_label, edition_kind, start_date, lesson_id, day, start_min, end_min, title, went_well, issues,
invite_again, overran, rating, written_at}` — never who wrote it. Newest year first (`start_date desc nulls
first`, then edition id desc), then day and time. The engine knows the actor's role in its own edition only
and asks that one.

### `reviews.returning(edition)` — `edition_returning(p_edition)` → `jsonb[]`
Definer; the edition's admins and content (`forbidden` for logistics, `not_member` for others). The speakers
of the edition's closed lessons (kind `lesson`, any role) who taught a closed lesson in an **earlier** `real` or
`archive` edition, each `{speaker_id, editions: [labels]}` (by date, nulls first). Earlier
(`app.earlier_edition` / `earlierEdition`): by the weeks' dates when both are known; otherwise a past year
(archive or archived) is before one that is not.

## The summary (browser only — `src/exports/summary.ts`)
`editionSummary(week, reviews, returning)`: closed lessons held; memorial times with a plan placed; per day
the closed lessons by their speakers' gender (`dayBalance(…).closed` — a co-taught lesson splits its one,
memorial times never count); closed lessons per category (+ «בלי קטגוריה»); speakers new vs returning;
reviews done of the closed lessons, and the missing ones; the `yes` / `no` / `maybe` lists. Counts only — no
threshold. `summaryTables` writes the same as five sheets through `toXlsx` (`guardCell` on every cell).

## The purge — `settings.purgeEdition(edition, confirm)` — `purge_edition_private(p_edition, p_confirm)` → `jsonb`
Definer. Refusals, in this order: not a global admin → `forbidden`; no such edition → `stale`; `p_confirm`
(trimmed of spaces) ≠ the edition's label → `confirm_mismatch`; the edition is not an archive, not archived,
and its week is not over → `week_not_over` («over»: the Israel date ≥ `start_date + 5` — Friday 00:00, when
the escort and schedule links expire; never while the date is TBD). Then:

- deletes the edition's `transport_details` (pickup addresses and times, drivers' names and phones);
- deletes the `share_link_hits` of the edition's links (the hashed callers' addresses);
- revokes every live `share_links` row of the edition (`revoked_at` = now) — the anon functions answer
  `link_invalid` for them from then on, and nothing un-revokes a link;
- sets `editions.purged_at` the first time (a trigger keeps it from any other write);
- logs `activity (entity 'editions', kind 'purge', detail {transport_details, links_revoked, link_hits})` —
  counts only;

and returns `{transport_details, links_revoked, link_hits, purged_at}`. Idempotent: a second run deletes
nothing more, returns zeros and the first `purged_at`, and is logged again. Everything else stays
(DECISIONS «אבן דרך 6» has each table and why). In the engine: `shared.transport` keys `<edition>:…`,
`shared.linkHits` of the edition's tokens, `shared.links`, `week.edition.purged_at`, the pool's log.

## Moving to next year
### `settings.startEdition(e, {deactivateTeam})` — `start_edition(p_label, p_start_date, p_first_day_from, p_room, p_deactivate_team default false)` → `bigint`
As before, and with `p_deactivate_team`: before the live real editions are archived, their members who are
not admins (content, logistics) become `active = false` — never deleted; admins of those editions and every
all-editions member stay. The screen sends it on by default («הצעה»).

### `settings.previewStart(deactivateTeam)` — `start_edition_preview(p_deactivate_team default true)` → `jsonb`
Definer, **STABLE** (PL/pgSQL runs it read-only: it cannot write); a global admin (`forbidden`). `{archive:
[{id, label}] (the real editions not archived), carry_from: {id, label} | null (where the wording and
milestones come from: the live real edition, else the newest real), grid_rows (the template's), milestones
(carry_from's), confirm_template (boolean), duty_phrases (count), deactivate (with the option: the active
non-admin members of the archived editions; without: 0), admins_stay, stays: {speakers (not retired),
categories (active), fallen (active), notes (cross-year)}}`.

## Errors (milestone 6)

`review_closed review_empty confirm_mismatch week_not_over`, and `stale not_member forbidden archived
not_closed not_handler bad_value`.

## RPC signatures (milestone 6)

| RPC | Parameters | Returns | Role |
|---|---|---|---|
| `save_lesson_review` | `p_lesson bigint, p_version integer, p_went_well text, p_issues text, p_invite_again text, p_overran boolean, p_rating integer` | `integer` | authenticated |
| `load_reviews` | `p_edition bigint` | `jsonb` | authenticated (invoker) |
| `speaker_reviews` | `p_speaker bigint` | `jsonb` | authenticated |
| `edition_returning` | `p_edition bigint` | `jsonb` | authenticated |
| `purge_edition_private` | `p_edition bigint, p_confirm text` | `jsonb` | authenticated |
| `start_edition_preview` | `p_deactivate_team boolean default true` | `jsonb` | authenticated |
| `start_edition` | `p_label text, p_start_date date, p_first_day_from integer default null, p_room text default 'בית מדרש', p_deactivate_team boolean default false` | `bigint` | authenticated |

No new `app.*` function is a browser's to run; anon gets nothing new.
