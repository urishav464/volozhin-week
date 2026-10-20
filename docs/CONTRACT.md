# The grid contract (Phase 1), the speaker pool (milestone 2), from placement to arrival (milestone 3), and outputs and knowledge (milestone 4)

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

`patch ⊆ { title, category_id, audience, teach_min }`. Content or admin. Version must match
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
| `load_week` | `p_edition bigint` | `jsonb` — the `Week` shape of `src/domain/types.ts` (keys `edition rows rooms categories speakers approaches availability lessons lessonSpeakers pitches team roster`; `roster` since v7) |
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
  names only, never a value.

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
