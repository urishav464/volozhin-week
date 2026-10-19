# The grid contract (Phase 1)

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
actor, or the actor is admin of the edition.

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

Exactly the codes above, each with a Hebrew message in `src/errors.ts`:
`not_member forbidden archived speaker_retired approach_owned not_vetted gender_unknown room_taken
speaker_busy cell_closed merge_blocked bad_shape outside_grid approved_locked stale`.
SQL raises them as `raise exception using message = '<code>', errcode = 'P0001'` (constraints
are caught and re-raised under their code), so PostgREST returns the code as the error message.

## RPC signatures (PostgREST, schema `public`)

All `SECURITY INVOKER` (RLS and the guard triggers apply), granted to `authenticated` only.
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
