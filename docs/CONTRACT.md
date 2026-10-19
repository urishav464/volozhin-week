# The grid contract (Phase 1) and the speaker pool (milestone 2)

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
actor is not admin → `approved_locked`. Deletes its `lesson_speakers`; its `accepted` pitch →
`approached`. Does not change times, title, category or stage fields.

### `move_lesson(lesson, day, start_min, end_min, room_id)`

Owner or admin for a closed lesson; any content member for a draft. Bounds and
lesson-row containment as in `propose` (a range may span several consecutive lesson rows of
the day — a merged lesson moved whole). Room and speaker invariants apply (`room_taken`,
`speaker_busy`). If the lesson is closed and `confirm_sent_at` is set and the time, day or room
changed → `needs_reconfirm = true`. Increments `version`.

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
  with `confirm_sent_at` set → `needs_reconfirm`.
- `reset()`: the lessons overlapping the row: any closed → `cell_closed`. Otherwise all are
  deleted; if they held live pitches, one plain draft is created on the row (default room)
  carrying them (deduplicated per approach). A merged lesson that started on this row is reset to
  this row.

### `update_lesson(lesson, version, patch)`

`patch ⊆ { title, category_id, audience, teach_min }`. Content or admin. Version must match
(`stale`). `title` and `audience` are trimmed; an empty one becomes null. `teach_min` must be > 0 and ≤ the lesson's length → `bad_shape`. Increments
`version`.

## Errors

Exactly the codes above and those of «The speaker pool» below, each with a Hebrew message in
`src/errors.ts`:
`not_member forbidden archived speaker_retired approach_owned not_vetted gender_unknown room_taken
speaker_busy cell_closed merge_blocked bad_shape outside_grid approved_locked stale`.
SQL raises them as `raise exception using message = '<code>', errcode = 'P0001'` (constraints
are caught and re-raised under their code), so PostgREST returns the code as the error message.

## RPC signatures (PostgREST, schema `public`)

All `SECURITY DEFINER` functions that check the caller themselves (DECISIONS, phase 1 §5) — `load_week` alone is `SECURITY INVOKER`, so RLS decides what it returns — granted to `authenticated` only.
Parameter names are part of the contract — `SupabasePort` calls them by name.

| RPC | Parameters | Returns |
|---|---|---|
| `load_week` | `p_edition bigint` | `jsonb` — the `Week` shape of `src/domain/types.ts` (keys `edition rows rooms categories speakers approaches availability lessons lessonSpeakers pitches team`) |
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
