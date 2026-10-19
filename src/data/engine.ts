// docs/CONTRACT.md, in memory. DemoPort runs on this, so the demo and the
// decision gate behave exactly like production; tests/parity runs the same
// scenarios here and against the SQL and compares the results.
//
// Every command is all-or-nothing: the state is snapshotted first and restored
// if the command refuses, like a database transaction.
//
// The speaker pool (CONTRACT.md «The speaker pool») lives here too: speakers
// are one cross-year list, so DemoPort hands every edition's engine the same
// `shared` store (contacts, the pool's log) and the other editions' weeks
// (`elsewhere`) for the rules that look across years.
import { dayPart } from "../domain/dayParts";
import { nameKey } from "../domain/nameKey";
import { type Day, DAY_END, DAY_START, overlaps } from "../domain/time";
import { similarity } from "../domain/trigram";
import type { Approach, ApproachStatus, Availability, GridRow, Lesson, Pitch, PitchState, Speaker, SpeakerContacts, Vetting, Week } from "../domain/types";
import { LIVE_PITCH } from "../domain/types";
import { rowActive } from "../grid/layout";
import { type CellTarget, CommandError, type LessonPatch, type ReshapeOp } from "./commands";
import {
  cleanBlock, cleanContactEmail, cleanLine, cleanPhone, cleanTopics, LIMITS, pickContactPref, pickGender, pickTitle, SIMILAR_THRESHOLD, titlesOf,
} from "./speakerRules";
import type { ActivityEntry, CreateOptions, NewSpeaker, SpeakerMatch, SpeakerPatch } from "./speakers";

export interface Actor {
  memberId: number;
  role: "admin" | "content" | "logistics";
  /** An admin of every edition (members.edition_id null): vets speakers, sees every speaker's contacts. */
  global?: boolean;
}

/** What the database keeps outside a Week, shared by every edition's engine in the demo. */
export interface PoolShared {
  /** speaker_contacts, by speaker id. */
  contacts: Record<number, SpeakerContacts>;
  /** The pool commands' activity rows (the grid's own commands are not logged in memory). */
  log: ActivityEntry[];
}

const EMPTY_CONTACTS: SpeakerContacts = { phone: null, email: null, secretary_note: null, notes: null };
const STATUSES: readonly ApproachStatus[] = ["claimed", "approached", "positive", "declined", "no_answer"];
const SPEAKER_FIELDS = ["title", "name", "disambiguator", "gender", "affiliation", "bio_short", "topics", "contact_pref", "retired"] as const;

function fail(code: string): never {
  throw new CommandError(code);
}

const PITCH_RANK: Record<PitchState, number> = { approached: 0, candidate: 1, accepted: 2, declined: 3, withdrawn: 4, superseded: 5 };

export class Engine {
  constructor(
    public week: Week,
    private readonly actor: Actor,
    private readonly now: () => string = () => new Date().toISOString(),
    readonly shared: PoolShared = { contacts: {}, log: [] },
    /** The other editions' weeks (the demo's other engines): closed lessons and contacts across years. */
    private readonly elsewhere: () => Week[] = () => [],
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
        approach = { id: this.nextId(this.week.approaches), speaker_id: speakerId, owner_member_id: this.actor.memberId, status: "approached", avail_note: null, offered_to: null, version: 1 };
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

  // ---------------------------------------------------------------- the speaker pool (CONTRACT.md «The speaker pool»)

  /** public.speaker_matches: the same name key first, then keys at least SIMILAR_THRESHOLD alike; at most 20. */
  matches(name: string): SpeakerMatch[] {
    const key = nameKey(name);
    if (!key) return [];
    const min = Math.fround(SIMILAR_THRESHOLD);
    return this.week.speakers
      .map((s) => ({ s, sim: similarity(s.name_key, key) }))
      .filter(({ s, sim }) => s.name_key === key || sim >= min)
      .sort((a, b) => Number(b.s.name_key === key) - Number(a.s.name_key === key) || b.sim - a.sim || a.s.name.localeCompare(b.s.name, "he") || a.s.id - b.s.id)
      .slice(0, 20)
      .map(({ s, sim }) => ({
        id: s.id, title: s.title, name: s.name, disambiguator: s.disambiguator, gender: s.gender, affiliation: s.affiliation,
        vetted: s.vetted, retired: s.retired, match: s.name_key === key ? ("same" as const) : ("similar" as const), similarity: sim,
      }));
  }

  createSpeaker(input: NewSpeaker, opts: CreateOptions = {}): { speaker_id: number; approach_id: number | null } {
    return this.tx(() => {
      this.requireEditor();
      const name = cleanLine(input.name, LIMITS.name);
      const key = nameKey(name);
      if (name == null || !key) fail("name_required");
      const disambiguator = cleanLine(input.disambiguator, LIMITS.disambiguator);
      const title = pickTitle(input.title, titlesOf(this.week.edition.settings));
      const gender = pickGender(input.gender);
      const affiliation = cleanLine(input.affiliation, LIMITS.affiliation);
      const bio_short = cleanBlock(input.bio_short, LIMITS.bio_short);
      const topics = cleanTopics(input.topics);
      const contact_pref = pickContactPref(input.contact_pref);
      const approve = !!opts.approve;
      if (approve && !this.actor.global) fail("forbidden");

      // search first
      const pool = this.week.speakers;
      if (pool.some((s) => s.name_key === key && (s.disambiguator ?? "") === (disambiguator ?? ""))) fail("speaker_exists");
      if (disambiguator == null && pool.some((s) => s.name_key === key)) fail("disambiguator_required");
      const min = Math.fround(SIMILAR_THRESHOLD);
      if (!opts.confirmed && pool.some((s) => s.name_key === key || similarity(s.name_key, key) >= min)) fail("speaker_similar");

      const s: Speaker = {
        id: this.nextId(pool), title, name: name!, disambiguator, gender, affiliation, bio_short, topics, contact_pref,
        vetted: approve ? "approved" : "pending", vetted_by: approve ? this.actor.memberId : null, vetted_note: null,
        retired: false, name_key: key, version: 1,
      };
      pool.push(s);
      this.log(this.week.edition.id, "speakers", s.id, "insert", { vetted: s.vetted });
      let approach_id: number | null = null;
      if (opts.claim) {
        const a: Approach = { id: this.nextId(this.week.approaches), speaker_id: s.id, owner_member_id: this.actor.memberId, status: "claimed", avail_note: null, offered_to: null, version: 1 };
        this.week.approaches.push(a);
        this.logApproach(a, "insert", null);
        approach_id = a.id;
      }
      return { speaker_id: s.id, approach_id };
    });
  }

  updateSpeaker(speakerId: number, version: number, patch: SpeakerPatch): void {
    this.tx(() => {
      this.requireEditor();
      const s = this.week.speakers.find((x) => x.id === speakerId) ?? fail("stale");
      const a = this.week.approaches.find((x) => x.speaker_id === speakerId);
      if (!this.isAdmin() && a?.owner_member_id !== this.actor.memberId) fail("not_handler");
      if (s.version !== version) fail("stale");
      // A key that is present (and not undefined, which JSON drops) changes; the rest stay.
      const has = (k: keyof SpeakerPatch) => k in patch && patch[k] !== undefined;
      const n: Speaker = { ...s };
      if (has("name")) {
        const name = cleanLine(patch.name, LIMITS.name);
        n.name_key = nameKey(name);
        if (name == null || !n.name_key) fail("name_required");
        n.name = name!;
      }
      if (has("disambiguator")) n.disambiguator = cleanLine(patch.disambiguator, LIMITS.disambiguator);
      if (has("title")) n.title = pickTitle(patch.title, titlesOf(this.week.edition.settings));
      if (has("gender")) n.gender = pickGender(patch.gender);
      if (has("affiliation")) n.affiliation = cleanLine(patch.affiliation, LIMITS.affiliation);
      if (has("bio_short")) n.bio_short = cleanBlock(patch.bio_short, LIMITS.bio_short);
      if (has("topics")) n.topics = cleanTopics(patch.topics);
      if (has("contact_pref")) n.contact_pref = pickContactPref(patch.contact_pref);
      if (has("retired")) {
        if (typeof patch.retired !== "boolean") fail("bad_value");
        if (!this.actor.global) fail("forbidden");
        n.retired = patch.retired!;
      }

      if (n.name_key !== s.name_key || (n.disambiguator ?? "") !== (s.disambiguator ?? "")) {
        const others = this.week.speakers.filter((x) => x.id !== s.id);
        if (others.some((x) => x.name_key === n.name_key && (x.disambiguator ?? "") === (n.disambiguator ?? ""))) fail("speaker_exists");
        if (n.disambiguator == null && others.some((x) => x.name_key === n.name_key)) fail("disambiguator_required");
      }
      if (((has("gender") && n.gender == null) || (has("retired") && n.retired)) && this.hasLiveClosed(s.id)) fail("lesson_closed");

      const fields = SPEAKER_FIELDS.filter((k) => JSON.stringify(n[k]) !== JSON.stringify(s[k]));
      if (fields.length === 0) return;
      Object.assign(s, n, { version: s.version + 1 });
      this.log(this.week.edition.id, "speakers", s.id, "update", { fields });
    });
  }

  /** The quality gate: a global admin approves, rejects or returns to pending — one speaker or many. */
  vetSpeakers(ids: number[], state: Vetting, note: string | null = null): void {
    this.tx(() => {
      if (!this.actor.global) fail("forbidden");
      if (!["approved", "rejected", "pending"].includes(state)) fail("bad_value");
      const n = cleanLine(note, LIMITS.vetted_note);
      for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
        const s = this.week.speakers.find((x) => x.id === id) ?? fail("stale");
        if (state !== "approved" && this.hasLiveClosed(id)) fail("lesson_closed");
        if (s.vetted === state && s.vetted_note === n) continue;
        Object.assign(s, { vetted: state, vetted_note: n, vetted_by: this.actor.memberId, version: s.version + 1 });
        this.log(null, "speakers", id, "vet", { vetted: state, note: n });
      }
    });
  }

  /** app.may_see_contacts: a global admin, or whoever handles the speaker in a real, non-archived edition. */
  mayContacts(speakerId: number): boolean {
    return !!this.actor.global || this.contactsEdition(speakerId) != null;
  }

  /** public.get_speaker_contacts: null when they are not the caller's to see. */
  contactsOf(speakerId: number): SpeakerContacts | null {
    if (!this.mayContacts(speakerId)) return null;
    return { ...(this.shared.contacts[speakerId] ?? EMPTY_CONTACTS) };
  }

  setContacts(speakerId: number, c: SpeakerContacts): void {
    this.tx(() => {
      if (!this.week.speakers.some((s) => s.id === speakerId)) fail("stale");
      if (!this.mayContacts(speakerId)) fail("contacts_hidden");
      const next: SpeakerContacts = {
        phone: cleanPhone(c.phone),
        email: cleanContactEmail(c.email),
        secretary_note: cleanBlock(c.secretary_note, LIMITS.secretary_note),
        notes: cleanBlock(c.notes, LIMITS.contact_notes),
      };
      const old = this.shared.contacts[speakerId] ?? EMPTY_CONTACTS;
      const fields = (["phone", "email", "secretary_note", "notes"] as const).filter((k) => old[k] !== next[k]);
      if (fields.length === 0) return;
      this.shared.contacts[speakerId] = next;
      this.log(this.contactsEdition(speakerId), "speakers", speakerId, "contacts", { fields });
    });
  }

  /** «אני מטפל/ת» without a cell. */
  claim(speakerId: number): number {
    return this.tx(() => {
      this.requireEditor();
      const s = this.week.speakers.find((x) => x.id === speakerId);
      if (!s || s.retired) fail("speaker_retired");
      let a = this.week.approaches.find((x) => x.speaker_id === speakerId);
      if (!a) {
        a = { id: this.nextId(this.week.approaches), speaker_id: speakerId, owner_member_id: this.actor.memberId, status: "claimed", avail_note: null, offered_to: null, version: 1 };
        this.week.approaches.push(a);
        this.logApproach(a, "insert", null);
      } else if (a.owner_member_id == null) {
        Object.assign(a, { owner_member_id: this.actor.memberId, offered_to: null, version: a.version + 1 });
        this.logApproach(a, "update", null);
      } else if (a.owner_member_id !== this.actor.memberId) fail("approach_owned");
      return a.id;
    });
  }

  setApproachStatus(approachId: number, version: number, status: ApproachStatus, note: string | null = null): void {
    this.tx(() => {
      const a = this.week.approaches.find((x) => x.id === approachId) ?? fail("stale");
      this.requireEditor();
      if (!this.isAdmin() && a.owner_member_id !== this.actor.memberId) fail("not_handler");
      if (a.version !== version) fail("stale");
      if (!STATUSES.includes(status)) fail("bad_value");
      const n = cleanLine(note, LIMITS.note);
      const s = this.speakerOf(a);
      if ((status === "approached" || status === "positive") && s.vetted !== "approved") fail("not_vetted");
      if (status !== "positive" && this.closedHere(s.id)) fail("lesson_closed");
      if (status === a.status && n == null) return;
      // «סירב/ה»: every cell they are still pitched in says so too
      if (status === "declined") for (const p of this.week.pitches) if (p.approach_id === a.id && LIVE_PITCH.has(p.state)) p.state = "declined";
      a.status = status;
      a.version++;
      this.logApproach(a, "update", n);
    });
  }

  /** «העברה»: the handler offers (null withdraws the offer); an admin reassigns at once (null: back to the pool). */
  handOver(approachId: number, to: number | null, note: string | null = null): void {
    this.tx(() => {
      const a = this.week.approaches.find((x) => x.id === approachId) ?? fail("stale");
      this.requireEditor();
      const n = cleanLine(note, LIMITS.note);
      let owner: number | null;
      let offer: number | null;
      if (this.isAdmin()) {
        if (to != null && !this.canHandle(to)) fail("bad_member");
        owner = to;
        offer = null;
      } else if (a.owner_member_id === this.actor.memberId) {
        if (to != null && (to === this.actor.memberId || !this.canHandle(to))) fail("bad_member");
        owner = a.owner_member_id;
        offer = to;
      } else fail("not_handler");
      if (owner === a.owner_member_id && offer === a.offered_to && n == null) return;
      Object.assign(a, { owner_member_id: owner, offered_to: offer, version: a.version + 1 });
      this.logApproach(a, "update", n);
    });
  }

  answerHandOver(approachId: number, accept: boolean, note: string | null = null): void {
    this.tx(() => {
      const a = this.week.approaches.find((x) => x.id === approachId) ?? fail("stale");
      this.requireEditor();
      const n = cleanLine(note, LIMITS.note);
      if (a.offered_to == null || a.offered_to !== this.actor.memberId) fail("stale"); // withdrawn, answered, or not mine
      if (accept) a.owner_member_id = this.actor.memberId;
      a.offered_to = null;
      a.version++;
      this.logApproach(a, "update", n);
    });
  }

  /** One availability chip (src/domain/dayParts.ts); rows of the day overlapping the part are cut back to what lies outside it. */
  setAvailability(speakerId: number, day: number, part: string, kind: "can" | "cannot" | null, note: string | null = null): void {
    this.tx(() => {
      this.requireEditor();
      if (!Number.isInteger(day) || day < 0 || day > 4) fail("bad_value");
      const range = dayPart(part) ?? fail("bad_value");
      if (kind != null && kind !== "can" && kind !== "cannot") fail("bad_value");
      const n = cleanLine(note, LIMITS.avail_note);
      const a = this.week.approaches.find((x) => x.speaker_id === speakerId);
      if (!a || !(this.isAdmin() || a.owner_member_id === this.actor.memberId)) fail("not_handler");
      const hit = this.week.availability
        .filter((v) => v.approach_id === a!.id && v.day === day && v.from_min < range.to && v.to_min > range.from)
        .sort((x, y) => x.id - y.id);
      const rows = this.week.availability.filter((v) => !hit.includes(v));
      const add = (v: Omit<Availability, "id">) => rows.push({ id: this.nextId([...rows, ...hit]), ...v });
      for (const { id: _id, ...v } of hit) {
        if (v.from_min < range.from) add({ ...v, to_min: range.from });
        if (v.to_min > range.to) add({ ...v, from_min: range.to });
      }
      if (kind != null) add({ approach_id: a!.id, day: day as Day, from_min: range.from, to_min: range.to, kind, note: n });
      this.week.availability = rows;
      this.log(this.week.edition.id, "approaches", a!.id, "availability", { speaker: speakerId, day, part, kind });
    });
  }

  // ---------------------------------------------------------------- helpers

  /** Restores IN PLACE on failure, so `engine.week` and `engine.shared` stay the same objects (their rows are the snapshot's). */
  private tx<T>(fn: () => T): T {
    const snapshot = structuredClone({ week: this.week, shared: this.shared });
    try {
      return fn();
    } catch (e) {
      Object.assign(this.week, snapshot.week);
      Object.assign(this.shared, snapshot.shared);
      throw e;
    }
  }

  /** app.contacts_edition: the newest real, non-archived edition in which the actor handles the speaker. */
  private contactsEdition(speakerId: number): number | null {
    if (this.actor.role === "logistics") return null;
    let found: number | null = null;
    for (const w of [this.week, ...this.elsewhere().filter((x) => x !== this.week)]) {
      const e = w.edition;
      if (e.kind !== "real" || e.status === "archived") continue;
      if (!w.approaches.some((a) => a.speaker_id === speakerId && a.owner_member_id === this.actor.memberId)) continue;
      if (found == null || e.id > found) found = e.id;
    }
    return found;
  }

  /** app.has_live_closed: a closed lesson in any edition that is not an archive. */
  private hasLiveClosed(speakerId: number): boolean {
    return [this.week, ...this.elsewhere().filter((x) => x !== this.week)].some(
      (w) =>
        w.edition.kind !== "archive" &&
        w.edition.status !== "archived" &&
        w.lessonSpeakers.some((x) => x.speaker_id === speakerId && w.lessons.some((l) => l.id === x.lesson_id && l.state === "closed")),
    );
  }

  private closedHere(speakerId: number): boolean {
    return this.week.lessonSpeakers.some((x) => x.speaker_id === speakerId && this.week.lessons.some((l) => l.id === x.lesson_id && l.state === "closed"));
  }

  /** app.can_handle: an active content member or admin of this edition (the team holds the active ones). */
  private canHandle(memberId: number): boolean {
    return this.week.team.some((t) => t.id === memberId && (t.role === "content" || t.role === "admin"));
  }

  private log(editionId: number | null, entity: string, entityId: number, kind: string, detail: Record<string, unknown>) {
    this.shared.log.push({ id: this.nextId(this.shared.log), at: this.now(), actor: this.actor.memberId, edition_id: editionId, entity, entity_id: entityId, kind, detail });
  }

  /** As the approaches trigger logs a row (app.log_activity). */
  private logApproach(a: Approach, kind: "insert" | "update", note: string | null) {
    this.log(this.week.edition.id, "approaches", a.id, kind, {
      status: a.status,
      owner: a.owner_member_id,
      speaker: a.speaker_id,
      ...(a.offered_to != null ? { offered_to: a.offered_to } : {}),
      ...(note != null ? { note } : {}),
    });
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
