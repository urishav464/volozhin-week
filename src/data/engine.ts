// docs/CONTRACT.md, in memory. DemoPort runs on this, so the demo and the
// decision gate behave exactly like production; tests/parity runs the same
// scenarios here and against the SQL and compares the results.
//
// Every command is all-or-nothing: the state is snapshotted first and restored
// if the command refuses, like a database transaction.
import { type Day, DAY_END, DAY_START, overlaps } from "../domain/time";
import type { Approach, GridRow, Lesson, Pitch, PitchState, Week } from "../domain/types";
import { LIVE_PITCH } from "../domain/types";
import { rowActive } from "../grid/layout";
import { type CellTarget, CommandError, type LessonPatch, type ReshapeOp } from "./commands";

export interface Actor {
  memberId: number;
  role: "admin" | "content" | "logistics";
}

function fail(code: string): never {
  throw new CommandError(code);
}

const PITCH_RANK: Record<PitchState, number> = { approached: 0, candidate: 1, accepted: 2, declined: 3, withdrawn: 4, superseded: 5 };

export class Engine {
  constructor(
    public week: Week,
    private readonly actor: Actor,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  // ---------------------------------------------------------------- commands

  propose(speakerId: number, target: CellTarget, mode: "self" | "offer" = "self"): { lesson_id: number; pitch_id: number } {
    return this.tx(() => {
      this.requireEditor();
      const speaker = this.week.speakers.find((s) => s.id === speakerId);
      if (!speaker || speaker.retired) fail("speaker_retired");

      // The approach first: a refusal here must not leave a draft behind.
      let approach = this.week.approaches.find((a) => a.speaker_id === speakerId);
      if (approach && approach.owner_member_id != null && approach.owner_member_id !== this.actor.memberId && mode === "self") {
        fail("approach_owned");
      }

      const lesson = this.targetDraft(target);

      if (!approach) {
        approach = { id: this.nextId(this.week.approaches), speaker_id: speakerId, owner_member_id: this.actor.memberId, status: "approached", avail_note: null, version: 1 };
        this.week.approaches.push(approach);
      } else if (approach.owner_member_id == null || approach.owner_member_id === this.actor.memberId) {
        approach.owner_member_id = this.actor.memberId;
        if (approach.status === "claimed") this.bumpApproach(approach, "approached");
      }

      let state: PitchState = mode === "offer" && approach.owner_member_id !== this.actor.memberId ? "candidate" : "approached";
      if (speaker!.vetted !== "approved") state = "candidate";

      let pitch = this.week.pitches.find((p) => p.lesson_id === lesson.id && p.approach_id === approach!.id);
      if (pitch) {
        if (LIVE_PITCH.has(pitch.state)) {
          if (state === "approached" && pitch.state === "candidate") pitch.state = "approached";
        } else {
          Object.assign(pitch, { state, proposed_by: this.actor.memberId, at: this.now() });
        }
      } else {
        pitch = { id: this.nextId(this.week.pitches), lesson_id: lesson.id, approach_id: approach.id, state, proposed_by: this.actor.memberId, at: this.now() };
        this.week.pitches.push(pitch);
      }
      return { lesson_id: lesson.id, pitch_id: pitch.id };
    });
  }

  unpropose(pitchId: number): void {
    this.tx(() => {
      this.requireEditor();
      const p = this.pitch(pitchId);
      const a = this.approach(p.approach_id);
      if (!(this.isAdmin() || a.owner_member_id === this.actor.memberId || p.proposed_by === this.actor.memberId)) fail("forbidden");
      if (!LIVE_PITCH.has(p.state)) return;
      p.state = "withdrawn";
      const l = this.lesson(p.lesson_id);
      if (l.state === "draft" && this.isPlain(l)) this.deleteLesson(l.id);
    });
  }

  setPitch(pitchId: number, state: "candidate" | "approached" | "declined"): void {
    this.tx(() => {
      this.requireEditor();
      const p = this.pitch(pitchId);
      const a = this.approach(p.approach_id);
      this.requireOwner(a);
      const l = this.lesson(p.lesson_id);
      if (l.state !== "draft") fail("cell_closed");
      if (!(LIVE_PITCH.has(p.state) || p.state === "declined")) return;
      if (state === "approached" && this.speakerOf(a).vetted !== "approved") fail("not_vetted");
      p.state = state;
    });
  }

  closeLesson(pitchId: number): void {
    this.tx(() => {
      this.requireEditor();
      const p = this.pitch(pitchId);
      const a = this.approach(p.approach_id);
      this.requireOwner(a);
      const l = this.lesson(p.lesson_id);
      if (l.state !== "draft" || !LIVE_PITCH.has(p.state)) fail("cell_closed");
      const s = this.speakerOf(a);
      if (s.retired) fail("speaker_retired");
      if (s.vetted !== "approved") fail("not_vetted");
      if (s.gender == null) fail("gender_unknown");
      if (!this.speakerFree(s.id, l.day, l.start_min, l.end_min, l.id)) fail("speaker_busy");

      l.state = "closed";
      l.version++;
      this.week.lessonSpeakers.push({ lesson_id: l.id, speaker_id: s.id, role: "lead" });
      p.state = "accepted";
      for (const q of this.week.pitches) {
        if (q === p || !LIVE_PITCH.has(q.state)) continue;
        if (q.lesson_id === l.id) q.state = "superseded";
        else if (q.approach_id === a.id) q.state = "withdrawn";
      }
      this.bumpApproach(a, "positive");
    });
  }

  reopenLesson(lessonId: number): void {
    this.tx(() => {
      this.requireEditor();
      const l = this.lesson(lessonId);
      if (l.state !== "closed") return;
      const lead = this.week.lessonSpeakers.find((x) => x.lesson_id === l.id && x.role === "lead");
      const a = lead ? this.week.approaches.find((x) => x.speaker_id === lead.speaker_id) : undefined;
      if (!this.isAdmin() && !(a && a.owner_member_id === this.actor.memberId)) fail("forbidden");
      if (l.approval === "approved" && !this.isAdmin()) fail("approved_locked");
      this.week.lessonSpeakers = this.week.lessonSpeakers.filter((x) => x.lesson_id !== l.id);
      for (const p of this.week.pitches) if (p.lesson_id === l.id && p.state === "accepted") p.state = "approached";
      l.state = "draft";
      l.version++;
    });
  }

  moveLesson(lessonId: number, to: { day: Day; start_min: number; end_min: number; room_id: number }): void {
    this.tx(() => {
      this.requireEditor();
      const l = this.lesson(lessonId);
      if (l.state === "cancelled") fail("cell_closed");
      if (l.state === "closed") this.requireLeadOwner(l);
      this.checkBounds(to.day, to.start_min, to.end_min);
      if (!this.spansLessonRows(to.day, to.start_min, to.end_min)) fail("outside_grid");
      if (!this.week.rooms.some((r) => r.id === to.room_id)) fail("bad_shape");
      if (!this.roomFree(to.day, to.start_min, to.end_min, to.room_id, [l.id])) fail("room_taken");
      if (l.state === "closed") {
        for (const x of this.week.lessonSpeakers.filter((y) => y.lesson_id === l.id)) {
          if (!this.speakerFree(x.speaker_id, to.day, to.start_min, to.end_min, l.id)) fail("speaker_busy");
        }
      }
      const changed = l.day !== to.day || l.start_min !== to.start_min || l.end_min !== to.end_min || l.room_id !== to.room_id;
      if (l.state === "closed" && l.confirm_sent_at && changed) l.needs_reconfirm = true;
      Object.assign(l, to);
      l.version++;
    });
  }

  reshape(day: Day, rowStart: number, op: ReshapeOp): void {
    this.tx(() => {
      this.requireEditor();
      const row = this.lessonRows(day).find((r) => r.start_min === rowStart) ?? fail("outside_grid");
      const inRow = () => this.live().filter((l) => l.day === day && overlaps(l.start_min, l.end_min, row.start_min, row.end_min));

      switch (op.op) {
        case "split_parallel": {
          if (![2, 3].includes(op.count) || !op.reason.trim()) fail("bad_shape");
          const exact = inRow().filter((l) => l.start_min === row.start_min && l.end_min === row.end_min);
          const need = op.count - exact.length;
          if (need <= 0) return;
          const used = new Set(inRow().map((l) => l.room_id));
          const free = [...this.week.rooms].sort((a, b) => a.sort - b.sort).filter((r) => !used.has(r.id));
          if (free.length < need) fail("room_taken");
          for (const room of free.slice(0, need)) this.newDraft(day, row.start_min, row.end_min, room.id, { parallel_reason: op.reason.trim() });
          return;
        }
        case "split_time": {
          const len = row.end_min - row.start_min;
          if (op.parts.length < 2 || op.parts.some((m) => m < 15 || m % 5 !== 0) || op.parts.reduce((s, m) => s + m, 0) !== len) fail("bad_shape");
          const old = inRow();
          if (old.some((l) => l.state === "closed")) fail("cell_closed");
          const carried = this.livePitchesOf(old.map((l) => l.id));
          old.forEach((l) => this.deleteLesson(l.id));
          let t = row.start_min;
          const parts = op.parts.map((m) => {
            const d = this.newDraft(day, t, t + m, this.defaultRoom());
            t += m;
            return d;
          });
          this.adopt(parts[0], carried);
          return;
        }
        case "merge_next": {
          const current = inRow();
          if (current.length > 1) fail("bad_shape");
          const l = current[0] ?? this.newDraft(day, row.start_min, row.end_min, this.defaultRoom());
          const next = this.lessonRows(day).filter((r) => r.start_min >= l.end_min).sort((a, b) => a.start_min - b.start_min)[0] ?? fail("outside_grid");
          const newEnd = next.end_min;
          const swallowed = this.live().filter((x) => x.id !== l.id && x.day === day && overlaps(x.start_min, x.end_min, l.end_min, newEnd));
          if (swallowed.some((x) => x.state === "closed")) fail("merge_blocked");
          const carried = this.livePitchesOf(swallowed.map((x) => x.id));
          swallowed.forEach((x) => this.deleteLesson(x.id));
          if (!this.roomFree(day, l.start_min, newEnd, l.room_id, [l.id])) fail("room_taken");
          if (l.state === "closed") {
            for (const x of this.week.lessonSpeakers.filter((y) => y.lesson_id === l.id)) {
              if (!this.speakerFree(x.speaker_id, day, l.start_min, newEnd, l.id)) fail("speaker_busy");
            }
            if (l.confirm_sent_at) l.needs_reconfirm = true;
          }
          l.end_min = newEnd;
          l.version++;
          this.adopt(l, carried);
          return;
        }
        case "reset": {
          const old = inRow();
          if (old.some((l) => l.state === "closed")) fail("cell_closed");
          const carried = this.livePitchesOf(old.map((l) => l.id));
          old.forEach((l) => this.deleteLesson(l.id));
          if (carried.length) this.adopt(this.newDraft(day, row.start_min, row.end_min, this.defaultRoom()), carried);
          return;
        }
      }
    });
  }

  updateLesson(lessonId: number, version: number, patch: LessonPatch): void {
    this.tx(() => {
      this.requireEditor();
      const l = this.lesson(lessonId);
      if (l.state === "cancelled") fail("cell_closed");
      if (l.version !== version) fail("stale");
      if (patch.teach_min != null && (patch.teach_min <= 0 || patch.teach_min > l.end_min - l.start_min)) fail("bad_shape");
      if (patch.category_id != null && !this.week.categories.some((c) => c.id === patch.category_id)) fail("bad_shape");
      const text = (v: string | null | undefined) => (v == null ? null : v.trim() || null);
      if ("title" in patch) l.title = text(patch.title);
      if ("audience" in patch) l.audience = text(patch.audience);
      if ("category_id" in patch) l.category_id = patch.category_id ?? null;
      if ("teach_min" in patch) l.teach_min = patch.teach_min ?? null;
      l.version++;
    });
  }

  // ---------------------------------------------------------------- helpers

  /** Restores IN PLACE on failure, so `engine.week` stays the same object (its rows are the snapshot's). */
  private tx<T>(fn: () => T): T {
    const snapshot = structuredClone(this.week);
    try {
      return fn();
    } catch (e) {
      Object.assign(this.week, snapshot);
      throw e;
    }
  }

  private isAdmin() {
    return this.actor.role === "admin";
  }

  private requireEditor() {
    if (this.actor.role === "logistics") fail("forbidden");
    const e = this.week.edition;
    if ((e.kind === "archive" || e.status === "archived") && !this.isAdmin()) fail("archived");
  }

  private requireOwner(a: Approach) {
    if (!this.isAdmin() && a.owner_member_id !== this.actor.memberId) fail("forbidden");
  }

  private requireLeadOwner(l: Lesson) {
    if (this.isAdmin()) return;
    const lead = this.week.lessonSpeakers.find((x) => x.lesson_id === l.id && x.role === "lead");
    const a = lead && this.week.approaches.find((x) => x.speaker_id === lead.speaker_id);
    if (!a || a.owner_member_id !== this.actor.memberId) fail("forbidden");
  }

  private nextId(rows: { id: number }[]) {
    return rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  }

  private live() {
    return this.week.lessons.filter((l) => l.state !== "cancelled");
  }

  private lesson(id: number) {
    return this.week.lessons.find((l) => l.id === id) ?? fail("cell_closed");
  }

  private pitch(id: number) {
    return this.week.pitches.find((p) => p.id === id) ?? fail("cell_closed");
  }

  private approach(id: number) {
    return this.week.approaches.find((a) => a.id === id) ?? fail("cell_closed");
  }

  private speakerOf(a: Approach) {
    return this.week.speakers.find((s) => s.id === a.speaker_id) ?? fail("speaker_retired");
  }

  private bumpApproach(a: Approach, status: Approach["status"]) {
    a.status = status;
    a.version++;
  }

  private defaultRoom(): number {
    const rooms = [...this.week.rooms].sort((a, b) => a.sort - b.sort);
    return (rooms.find((r) => r.is_default) ?? rooms[0] ?? fail("bad_shape")).id;
  }

  private lessonRows(day: Day): GridRow[] {
    return this.week.rows.filter((r) => r.kind === "lesson" && rowActive(r, day, this.week.edition));
  }

  private checkBounds(day: number, start: number, end: number) {
    if (!(day >= 0 && day <= 4) || start < DAY_START || end > DAY_END || start >= end || start % 5 !== 0 || end % 5 !== 0) fail("bad_shape");
  }

  /** The range starts inside one lesson row and ends inside one (possibly later) lesson row. */
  private spansLessonRows(day: Day, start: number, end: number): boolean {
    const rows = this.lessonRows(day);
    return rows.some((r) => r.start_min <= start && start < r.end_min) && rows.some((r) => r.start_min < end && end <= r.end_min);
  }

  private roomFree(day: Day, start: number, end: number, roomId: number, except: number[]): boolean {
    return !this.live().some((l) => !except.includes(l.id) && l.day === day && l.room_id === roomId && overlaps(l.start_min, l.end_min, start, end));
  }

  private speakerFree(speakerId: number, day: Day, start: number, end: number, exceptLesson: number): boolean {
    const lessonIds = this.week.lessonSpeakers.filter((x) => x.speaker_id === speakerId && x.lesson_id !== exceptLesson).map((x) => x.lesson_id);
    return !this.week.lessons.some((l) => lessonIds.includes(l.id) && l.state === "closed" && l.day === day && overlaps(l.start_min, l.end_min, start, end));
  }

  private targetDraft(target: CellTarget): Lesson {
    if ("lesson_id" in target) {
      const l = this.week.lessons.find((x) => x.id === target.lesson_id);
      if (!l || l.kind !== "lesson" || l.state !== "draft") fail("cell_closed");
      return l!;
    }
    const { day, start_min, end_min } = target;
    this.checkBounds(day, start_min, end_min);
    if (!this.lessonRows(day).some((r) => r.start_min <= start_min && end_min <= r.end_min)) fail("outside_grid");
    if (target.room_id != null && !this.week.rooms.some((r) => r.id === target.room_id)) fail("bad_shape"); // a room of this edition only
    const room = target.room_id ?? this.defaultRoom();
    const existing = this.live().find((l) => l.kind === "lesson" && l.state === "draft" && l.day === day && l.start_min === start_min && l.end_min === end_min && l.room_id === room);
    if (existing) return existing;
    if (!this.roomFree(day, start_min, end_min, room, [])) fail("room_taken");
    return this.newDraft(day, start_min, end_min, room);
  }

  private newDraft(day: Day, start: number, end: number, room: number, extra: Partial<Lesson> = {}): Lesson {
    const l: Lesson = {
      id: this.nextId(this.week.lessons), kind: "lesson", state: "draft", day, start_min: start, end_min: end, room_id: room,
      title: null, category_id: null, audience: null, teach_min: null, parallel_reason: null, pay_amount: null,
      transport: "none", approval: "none", confirm_sent_at: null, needs_reconfirm: false, escort_roster_id: null,
      self_intro: false, sources_kind: "pending", in_reader: false, version: 1, updated_by: this.actor.memberId, ...extra,
    };
    this.week.lessons.push(l);
    return l;
  }

  /** A draft that is just "a speaker was pitched here": nothing shaped or written on it. */
  private isPlain(l: Lesson): boolean {
    const hasLive = this.week.pitches.some((p) => p.lesson_id === l.id && LIVE_PITCH.has(p.state));
    const exactRow = this.lessonRows(l.day).some((r) => r.start_min === l.start_min && r.end_min === l.end_min);
    return !hasLive && l.title == null && l.parallel_reason == null && l.room_id === this.defaultRoom() && exactRow;
  }

  /** Delete a lesson with its pitches and speakers (callers take the live pitches first, via livePitchesOf). */
  private deleteLesson(id: number) {
    this.week.lessons = this.week.lessons.filter((l) => l.id !== id);
    this.week.lessonSpeakers = this.week.lessonSpeakers.filter((x) => x.lesson_id !== id);
    this.week.pitches = this.week.pitches.filter((p) => p.lesson_id !== id);
  }

  /** Live pitches of these lessons, one per approach (the most advanced), detached copies. */
  private livePitchesOf(lessonIds: number[]): Pitch[] {
    const byApproach = new Map<number, Pitch>();
    for (const p of this.week.pitches) {
      if (!lessonIds.includes(p.lesson_id) || !LIVE_PITCH.has(p.state)) continue;
      const cur = byApproach.get(p.approach_id);
      if (!cur || PITCH_RANK[p.state] < PITCH_RANK[cur.state] || (p.state === cur.state && p.id < cur.id)) byApproach.set(p.approach_id, { ...p });
    }
    return [...byApproach.values()];
  }

  /** Re-home carried pitches onto `target`, never duplicating an approach there. */
  private adopt(target: Lesson, carried: Pitch[]) {
    for (const p of carried) {
      const there = this.week.pitches.find((q) => q.lesson_id === target.id && q.approach_id === p.approach_id);
      if (there) {
        if (!LIVE_PITCH.has(there.state) || PITCH_RANK[p.state] < PITCH_RANK[there.state]) there.state = p.state;
        continue;
      }
      this.week.pitches.push({ ...p, lesson_id: target.id });
    }
  }
}
