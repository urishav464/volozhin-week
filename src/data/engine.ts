// docs/CONTRACT.md, in memory. DemoPort runs on this, so the demo and the
// decision gate behave exactly like production; tests/parity runs the same
// scenarios here and against the SQL and compares the results.
// So do the sources' files (CONTRACT.md «Sources and the reader», milestone
// 5ב-1): `shared.objects` is the Storage bucket (what the policies on
// storage.objects allow, by the same predicates), a Week's sourceFiles the
// table, and register/remove the two functions.
//
// Every command is all-or-nothing: the state is snapshotted first and restored
// if the command refuses, like a database transaction.
//
// The speaker pool (CONTRACT.md «The speaker pool») lives here too: speakers
// are one cross-year list, so DemoPort hands every edition's engine the same
// `shared` store (contacts, the pool's log) and the other editions' weeks
// (`elsewhere`) for the rules that look across years. So do a lesson's stages
// (CONTRACT.md «From placement to arrival», milestone 3): payment and
// transport, the summary message, the escort, sources — with transport
// details kept in `shared`, never in a Week, as the database keeps them apart.
// So do memorial times (CONTRACT.md «Memorial times and logistics», milestone
// 5ב-2): the fallen and their families' contacts are cross-year (`shared`), a
// Week holds the edition's plans and the names they are for. And «איך עבר» and
// the purge after the week (CONTRACT.md «After the week», milestone 6): the
// reviews are kept in `shared`, never in a Week, as the database keeps them apart.
import { dayPart } from "../domain/dayParts";
import { dutyNotes } from "../domain/escorts";
import { addDays, israelDate } from "../domain/israelTime";
import { earlierEdition, purgeAllowed, reviewWindow } from "../domain/reviews";
import { teachMinutes } from "../domain/message";
import { displayName } from "../domain/names";
import { nameKey } from "../domain/nameKey";
import { type Day, DAY_END, DAY_START, overlaps } from "../domain/time";
import { similarity } from "../domain/trigram";
import type {
  Approach, ApproachStatus, Availability, DutyPhrase, GridRow, Lesson, MemorialPlan, MemorialPolicy, Pitch, PitchState, SourceFile, SourceMime, Speaker, SpeakerContacts,
  Transport, TransportDetails, Vetting, Week,
} from "../domain/types";
import { LESSON_STAGE_DEFAULTS, LIVE_PITCH, TICK_ITEMS, type TickItem } from "../domain/types";
import { scheduleEntries } from "../exports/designer";
import { phoneKey } from "../import/phone";
import { titleGender } from "../import/speakerName";
import { TEMPLATE_2026 } from "../domain/template2026";
import { gridOrder } from "../exports/tracking";
import { rowActive } from "../grid/layout";
import { type CellTarget, CommandError, type EscortPatch, type LessonPatch, type LessonTransport, type PaymentItem, type ReshapeOp, type SourcesPatch } from "./commands";
import { cleanFallen, cleanFallenContacts, cleanPlanPatch, cleanPolicy, EMPTY_FALLEN_CONTACTS, type Fallen, type FallenContacts, type FallenFields, type PlanPatch } from "./memorial";
import {
  cleanBlock, cleanContactEmail, cleanLine, cleanPhone, cleanTopics, LIMITS, pickContactPref, pickGender, pickTitle, SIMILAR_THRESHOLD, titlesOf,
} from "./speakerRules";
import { type BookOrder, cleanGroupFields, type CleanLeader, type KkData, type KkGroup, type KkGroupFields, type KkLeader, type KkSignup, type KkTrack } from "./kk";
import { type IssuedLink, LINK_SCOPES, linkClient, linkExpiry, linkRate, type LinkScope, randomToken, RATE_WINDOW_MS, type ShareLink, tokenShape } from "./links";
import type { EscortLesson, EscortTicks, EscortView, KkForm, ScheduleView } from "./publicPort";
import type { ActivityEntry, CreateOptions, NewSpeaker, SpeakerMatch, SpeakerPatch } from "./speakers";
import { type ArchiveLessonRow, type ImportKind, type ImportLookup, type ImportResult, ImportRowError, type SpeakerRow } from "./imports";
import {
  ARCHIVE_LAST_DAY_UNTIL, ARCHIVE_ROOM, checkPayloadSize, cleanArchiveDate, cleanLabel, cleanLessonRow, cleanPrefsRow, cleanSource, cleanSpeakerRow, IMPORT_KINDS, parallelRoomName, prefsKeys,
} from "./importRules";
import { cleanReview, type LessonReview, type ReturningSpeaker, type ReviewFields, type SpeakerReview } from "./reviews";
import type { PurgeReport } from "./settings";
import { arrived, cleanDisplayName, DOCX, MAX_SOURCE_BYTES, mimeMatches, pagesFor, parseSourcePath, SOURCE_MIMES } from "./sourceRules";
import {
  cleanAmount, cleanDutyPhrases, cleanTransportDetails, cleanUrl, EMPTY_TRANSPORT, pickPrintWhen, pickSourcesKind, pickTransport, readerKind, STAGE_LIMITS,
} from "./stageRules";

export interface Actor {
  memberId: number;
  role: "admin" | "content" | "logistics";
  /** An admin of every edition (members.edition_id null): vets speakers, sees every speaker's contacts. */
  global?: boolean;
  /** anon's calls through a class link: the caller's address as the API reports it (app.link_client) — keys the rate limit. */
  address?: string;
}

/** share_links as the demo keeps them: with the token itself (synthetic; the database keeps only its sha256). */
export type DemoLink = ShareLink & { edition_id: number; token: string };

/** מכריכה לכריכה's tables, across editions as in the database. */
export interface KkStore {
  tracks: (KkTrack & { edition_id: number })[];
  groups: (KkGroup & { edition_id: number })[];
  leaders: (KkLeader & { sort: number })[];
  signups: (KkSignup & { edition_id: number })[];
  orders: BookOrder[];
}

export const emptyKk = (): KkStore => ({ tracks: [], groups: [], leaders: [], signups: [], orders: [] });

/** What the database keeps outside a Week, shared by every edition's engine in the demo. */
export interface PoolShared {
  /** speaker_contacts, by speaker id. */
  contacts: Record<number, SpeakerContacts>;
  /** The pool commands' activity rows (the grid's own commands are not logged in memory). */
  log: ActivityEntry[];
  /** transport_details, by `${edition id}:${lesson id}` (the demo's editions number their lessons apart). */
  transport: Record<string, TransportDetails>;
  /** share_links (v9). */
  links: DemoLink[];
  /** share_link_hits: the rate limit, by token and caller (`${token} ${linkClient(…)}`). */
  linkHits: Record<string, { window_start: string; hits: number }>;
  /** kk_tracks, kk_groups, kk_leaders, kk_signups, book_orders (v9). */
  kk: KkStore;
  /** The «sources» bucket (v10), by object path: what Storage keeps of each — its type, size and uploader. The bytes are DemoPort's. */
  objects: Record<string, StoredObject>;
  /** fallen (v11): one cross-year list. */
  fallen: Fallen[];
  /** fallen_contacts (v11), by fallen id — a bereaved family's contact person: never in a Week. */
  fallenContacts: Record<number, FallenContacts>;
  /** lesson_reviews (v12), every edition's — «איך עבר», opinions about a person: never in a Week. */
  reviews: (LessonReview & { edition_id: number })[];
  /**
   * lesson_import_notes (v12), by `${edition id}:${lesson id}`: what last year's tracking sheet said that has no field
   * of its own — its transport words among them, so the transport details' rule (mayTransport): never in a Week.
   */
  importNotes: Record<string, string>;
}

/** A stored object as the Storage API records it: metadata.mimetype, metadata.size, owner_id. */
export interface StoredObject {
  mime: string;
  size: number;
  /** Who uploaded it (the API writes the session's sub; here, the member). */
  owner: string;
}

export const emptyShared = (): PoolShared => ({ contacts: {}, log: [], transport: {}, links: [], linkHits: {}, kk: emptyKk(), objects: {}, fallen: [], fallenContacts: {}, reviews: [], importNotes: {} });

const EMPTY_CONTACTS: SpeakerContacts = { phone: null, email: null, secretary_note: null, notes: null };
const STATUSES: readonly ApproachStatus[] = ["claimed", "approached", "positive", "declined", "no_answer"];
const SPEAKER_FIELDS = ["title", "name", "disambiguator", "gender", "affiliation", "bio_short", "topics", "contact_pref", "retired"] as const;

function fail(code: string): never {
  throw new CommandError(code);
}

/** app.jint: a whole number from a JSON value, or null. */
const jint = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && Math.abs(v) < 1e15 ? v : null);
/** `->>`: a JSON value as text (a string as it is, a number or a boolean written out), null for null. */
const text = (v: unknown): string | null => (v == null ? null : typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v));

/** A refusal inside an import row: that row's ImportRowError (app.refuse_row). */
function rowError(item: unknown, e: unknown): unknown {
  if (!(e instanceof CommandError) || e instanceof ImportRowError) return e;
  const row = item != null && typeof item === "object" && !Array.isArray(item) ? jint((item as Record<string, unknown>).row) : null;
  return new ImportRowError(row ?? -1, e.code);
}

/** One speaker row as the import resolved it. */
interface SpeakerResult {
  speaker_id: number;
  created: boolean;
  filled: boolean;
  /** A phone or an e-mail filled (the escorts' file: the secretary note). */
  contacts: boolean;
  /** The private note filled. */
  notes: boolean;
}

/** What the import of the tracking sheet needs from outside the engine: the other editions, and where the archive goes. */
export interface ImportHost {
  /** app.titles: that edition's settings.titles when it lists any, else the default four. */
  titles(editionId: number | null): readonly string[];
  /** Every edition whose label has this key (labelKey): its kind, and its week when it is an archive. */
  byLabel(key: string): { kind: Week["edition"]["kind"]; week: Week | null }[];
  /** The categories that exist. */
  categoryIds(): ReadonlySet<number>;
  nextEditionId(): number;
  nextRoomId(): number;
  /** The archive's week — a new edition, or the one of that label with its lessons replaced. Called once, after every row passed. */
  install(week: Week): void;
}

const PITCH_RANK: Record<PitchState, number> = { approached: 0, candidate: 1, accepted: 2, declined: 3, withdrawn: 4, superseded: 5 };

/** What the summary message says about a lesson: changed after it was sent → «לעדכן את המרצה» (app.lessons_reconfirm). */
const RECONFIRM_FIELDS = ["day", "start_min", "end_min", "room_id", "title", "teach_min", "pay_amount"] as const;

export class Engine {
  constructor(
    public week: Week,
    private readonly actor: Actor,
    private readonly now: () => string = () => new Date().toISOString(),
    readonly shared: PoolShared = emptyShared(),
    /** The other editions' weeks (the demo's other engines): closed lessons and contacts across years. */
    private readonly elsewhere: () => Week[] = () => [],
    /** A new link's token: 128 random bits, as public.issue_link makes it (the demo's say what they open). */
    private readonly newToken: (scope: LinkScope, subjectId: number | null) => string = () => randomToken(),
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
      if (l.paid_at != null) fail("paid_locked"); // money that went out is not erased with the speaker
      this.week.lessonSpeakers = this.week.lessonSpeakers.filter((x) => x.lesson_id !== l.id);
      for (const p of this.week.pitches) if (p.lesson_id === l.id && p.state === "accepted") p.state = "approached";
      // The stages were the speaker's: whoever closes the lesson next starts them over (CONTRACT reopen_lesson).
      delete this.shared.transport[this.transportKey(l.id)];
      Object.assign(l, LESSON_STAGE_DEFAULTS, { state: "draft", version: l.version + 1, updated_by: this.actor.memberId });
    });
  }

  moveLesson(lessonId: number, to: { day: Day; start_min: number; end_min: number; room_id: number }): void {
    this.tx(() => {
      this.requireEditor();
      const l = this.lesson(lessonId);
      if (l.state === "cancelled") fail("cell_closed");
      if (l.kind === "memorial") fail("memorial_slot"); // a plan moves between slots instead
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
      Object.assign(l, to); // needs_reconfirm: the rule in tx() (app.lessons_reconfirm)
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
          if (old.some((l) => l.state === "closed" || l.kind === "memorial")) fail("cell_closed");
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
          if (swallowed.some((x) => x.state === "closed" || x.kind === "memorial")) fail("merge_blocked"); // a memorial slot is never swallowed
          const carried = this.livePitchesOf(swallowed.map((x) => x.id));
          swallowed.forEach((x) => this.deleteLesson(x.id));
          if (!this.roomFree(day, l.start_min, newEnd, l.room_id, [l.id])) fail("room_taken");
          if (l.state === "closed") {
            for (const x of this.week.lessonSpeakers.filter((y) => y.lesson_id === l.id)) {
              if (!this.speakerFree(x.speaker_id, day, l.start_min, newEnd, l.id)) fail("speaker_busy");
            }
          }
          l.end_min = newEnd;
          l.version++;
          this.adopt(l, carried);
          return;
        }
        case "reset": {
          const old = inRow();
          if (old.some((l) => l.state === "closed" || l.kind === "memorial")) fail("cell_closed");
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
      if (l.kind === "memorial") fail("memorial_slot"); // its title reaches the anon links; no screen edits one
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
      if (!this.mayEditSpeaker(speakerId)) fail("not_handler");
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

  // ---------------------------------------------------------------- from placement to arrival (CONTRACT.md, milestone 3)

  /** public.set_payment: the handler (or an admin) asks the instructor for an amount and/or transport. */
  setPayment(lessonId: number, version: number, amount: number | null, transport: Transport): void {
    this.tx(() => {
      const l = this.stageLesson(lessonId);
      this.requireEditor();
      this.requireHandler(l);
      if (l.version !== version) fail("stale");
      const pay = cleanAmount(amount);
      const tr = pickTransport(transport);
      if (l.paid_at != null && pay !== l.pay_amount) fail("paid_locked"); // a paid amount stays what was paid
      // the same request again: nothing — unless it was rejected (then it is asked again)
      if (pay === l.pay_amount && tr === l.transport && l.approval !== "rejected") return;
      Object.assign(l, {
        pay_amount: pay, transport: tr, approval: pay == null && tr === "none" ? "none" : "pending",
        approval_note: null, approved_by: null, approved_at: null, version: l.version + 1, updated_by: this.actor.memberId,
      });
      if (tr === "none") delete this.shared.transport[this.transportKey(l.id)]; // its pickup and driver go too
    });
  }

  /** public.decide_payments: a global admin, one lesson or a batch, each at the version seen; all or nothing. */
  decidePayments(items: PaymentItem[], decision: "approved" | "rejected", note: string | null = null): void {
    this.tx(() => {
      if (!this.actor.global) fail("forbidden");
      if (decision !== "approved" && decision !== "rejected") fail("bad_value");
      const n = cleanLine(note, STAGE_LIMITS.decision_note);
      const now = this.now();
      for (const it of [...items].sort((a, b) => a.lesson_id - b.lesson_id || a.version - b.version)) {
        const l = this.week.lessons.find((x) => x.id === it.lesson_id);
        if (!l || l.version !== it.version || l.approval !== "pending" || l.state !== "closed") fail("stale");
        Object.assign(l!, {
          approval: decision, approval_note: n, approved_by: this.actor.memberId, approved_at: now, version: l!.version + 1, updated_by: this.actor.memberId,
        });
      }
    });
  }

  /** public.mark_confirm_sent: «סומן כנשלח». */
  markConfirmSent(lessonId: number, version: number): void {
    this.tx(() => {
      const l = this.stageLesson(lessonId);
      this.requireEditor();
      this.requireHandler(l);
      if (l.version !== version) fail("stale");
      if (l.approval === "pending") fail("approval_pending");
      if (l.approval === "rejected") fail("approval_rejected");
      Object.assign(l, { confirm_sent_at: this.now(), confirm_sent_by: this.actor.memberId, needs_reconfirm: false, version: l.version + 1, updated_by: this.actor.memberId });
    });
  }

  /**
   * public.set_escort: any editor, on a closed lesson; the escort is a trainee of this edition's roster. A memorial
   * slot's escort is the family's liaison: an admin, on a slot with a plan (`no_plan`), never a self-introduction.
   */
  setEscort(lessonId: number, version: number, e: EscortPatch): void {
    this.tx(() => {
      const l = this.stageLesson(lessonId);
      this.requireEditor();
      if (l.kind === "memorial") {
        if (!this.isAdmin()) fail("forbidden");
        if (!this.week.memorialPlans.some((p) => p.lesson_id === l.id)) fail("no_plan");
      } else if (l.state !== "closed") fail("not_closed");
      if (l.version !== version) fail("stale");
      if (e.roster_id != null && !this.week.roster.some((r) => r.id === e.roster_id)) fail("bad_escort");
      if (typeof e.self_intro !== "boolean" || (e.self_intro && l.kind === "memorial")) fail("bad_value");
      const note = cleanBlock(e.escort_note, STAGE_LIMITS.escort_note);
      if (e.roster_id === l.escort_roster_id && e.self_intro === l.self_intro && note === l.escort_note) return;
      Object.assign(l, { escort_roster_id: e.roster_id, self_intro: e.self_intro, escort_note: note, version: l.version + 1, updated_by: this.actor.memberId });
    });
  }

  /** public.set_sources: any editor, on a closed lesson. */
  setSources(lessonId: number, version: number, s: SourcesPatch): void {
    this.tx(() => {
      const l = this.stageLesson(lessonId);
      this.requireEditor();
      if (l.state !== "closed") fail("not_closed");
      if (l.version !== version) fail("stale");
      const kind = pickSourcesKind(s.sources_kind);
      const print = pickPrintWhen(s.print_when);
      const note = cleanBlock(s.sources_note, STAGE_LIMITS.sources_note);
      const url = cleanUrl(s.presentation_url);
      if (typeof s.in_reader !== "boolean") fail("bad_value");
      const inReader = s.in_reader && readerKind(kind);
      if (kind === l.sources_kind && print === l.print_when && note === l.sources_note && url === l.presentation_url && inReader === l.in_reader) return;
      Object.assign(l, {
        sources_kind: kind, print_when: print, sources_note: note, presentation_url: url, in_reader: inReader, version: l.version + 1, updated_by: this.actor.memberId,
      });
    });
  }

  /** public.set_paid: logistics (or an admin) — an approved payment is paid, or not yet. */
  setPaid(lessonId: number, paid: boolean): void {
    this.tx(() => {
      const l = this.stageLesson(lessonId);
      this.requireLogistics();
      if (l.pay_amount == null || l.approval !== "approved") fail("payment_not_approved");
      if (typeof paid !== "boolean") fail("bad_value");
      if ((l.paid_at != null) === paid) return;
      Object.assign(l, { paid_at: paid ? this.now() : null, version: l.version + 1, updated_by: this.actor.memberId });
    });
  }

  /**
   * app.may_see_transport: a global admin; in a real edition that is not archived, the lesson's handler
   * (content or admin) — and its logistics members once the transport is approved.
   */
  mayTransport(lessonId: number): boolean {
    if (this.actor.global) return true;
    const l = this.week.lessons.find((x) => x.id === lessonId);
    const e = this.week.edition;
    if (!l || e.kind !== "real" || e.status === "archived") return false;
    if (this.actor.role === "logistics") return l.transport !== "none" && l.approval === "approved";
    return this.handlerOf(l) === this.actor.memberId;
  }

  /** public.get_import_note: what last year's sheet said about an imported lesson — the transport details' rule (mayTransport). */
  importNoteOf(lessonId: number): string | null {
    if (!this.week.lessons.some((l) => l.id === lessonId) || !this.mayTransport(lessonId)) return null;
    return this.shared.importNotes[this.transportKey(lessonId)] ?? null;
  }

  /** public.get_transport_details: null when they are not the caller's to see. */
  transportOf(lessonId: number): TransportDetails | null {
    if (!this.mayTransport(lessonId)) return null;
    return { ...(this.shared.transport[this.transportKey(lessonId)] ?? EMPTY_TRANSPORT) };
  }

  /** public.set_transport_details: the same people; all five replaced; the log names the fields, never the values. */
  setTransport(lessonId: number, d: TransportDetails): void {
    this.tx(() => {
      const l = this.week.lessons.find((x) => x.id === lessonId) ?? fail("stale");
      if (!this.mayTransport(lessonId)) fail("transport_hidden");
      if (l.transport === "none") fail("no_transport");
      const next = cleanTransportDetails(d);
      const old = this.shared.transport[this.transportKey(lessonId)] ?? EMPTY_TRANSPORT;
      const fields = (["pickup_address", "pickup_time", "driver_name", "driver_phone", "arranged"] as const).filter((k) => old[k] !== next[k]);
      if (fields.length === 0) return;
      this.shared.transport[this.transportKey(lessonId)] = next;
      this.log(this.week.edition.id, "lessons", lessonId, "transport", { fields });
    });
  }

  /** public.set_confirm_template: an admin of the edition; the instructor's own wording (empty removes it). */
  setConfirmTemplate(body: string | null): void {
    this.tx(() => {
      this.requireEditionAdmin();
      const v = cleanBlock(body, STAGE_LIMITS.template);
      const settings = { ...this.week.edition.settings };
      if (v == null) delete settings.confirm_template;
      else settings.confirm_template = v;
      this.week.edition.settings = settings;
    });
  }

  /** public.set_duty_phrases: an admin of the edition; an empty list removes them. */
  setDutyPhrases(phrases: DutyPhrase[] | null): void {
    this.tx(() => {
      this.requireEditionAdmin();
      const v = cleanDutyPhrases(phrases);
      const settings = { ...this.week.edition.settings };
      if (v.length === 0) delete settings.duty_phrases;
      else settings.duty_phrases = v;
      this.week.edition.settings = settings;
    });
  }

  // ---------------------------------------------------------------- sources (CONTRACT.md «Sources and the reader», milestone 5ב-1)

  /**
   * app.source_refusal: why the actor may not upload to this path — null when they may. The rule of set_sources:
   * content or admin of the path's edition (an archive: its admins), a closed lesson there — or a memorial slot
   * with a plan placed on it (else `no_plan`); the poster (…/cover/…, never Word) for the edition's admins.
   */
  sourceRefusal(path: string): string | null {
    const p = parseSourcePath(path);
    if (!p) return "bad_path";
    const at = this.editionAt(p.edition);
    if (!at) return "not_member";
    const { week, role } = at;
    if (role === "logistics") return "forbidden";
    const e = week.edition;
    if ((e.kind === "archive" || e.status === "archived") && role !== "admin") return "archived";
    if (p.lesson == null) return role !== "admin" ? "forbidden" : p.ext === "docx" ? "bad_file" : null;
    const l = week.lessons.find((x) => x.id === p.lesson);
    if (!l) return "bad_path";
    // a memorial slot's materials (v11): a slot with a plan placed on it
    if (l.kind === "memorial") return l.state === "cancelled" || !week.memorialPlans.some((x) => x.lesson_id === l.id) ? "no_plan" : null;
    if (l.state !== "closed") return "not_closed";
    return null;
  }

  /** The sources_upload policy (app.may_upload_source): sourceRefusal's rule, and a path no source_files row holds — a path is used once. */
  mayUploadSource(path: string): boolean {
    if (this.sourceRefusal(path) != null) return false;
    const p = parseSourcePath(path);
    const at = p && this.editionAt(p.edition);
    return !at || !at.week.sourceFiles.some((f) => f.storage_path === path);
  }

  /** The sources_read policy (app.may_read_source): the whole team of the path's edition, logistics included. */
  maySeeSource(path: string): boolean {
    const p = parseSourcePath(path);
    return !!p && !!this.editionAt(p.edition) && !!this.shared.objects[path];
  }

  /** The sources_delete policy (app.may_delete_source): an admin of the edition, else its uploader (the row's, or an unregistered object's owner). */
  mayDeleteSource(path: string): boolean {
    const p = parseSourcePath(path);
    const at = p && this.editionAt(p.edition);
    if (!at) return false;
    if (at.role === "admin") return true;
    const e = at.week.edition;
    if (e.kind === "archive" || e.status === "archived") return false;
    const row = at.week.sourceFiles.find((f) => f.storage_path === path);
    if (row) return row.uploaded_by != null && row.uploaded_by === this.actor.memberId;
    return this.shared.objects[path]?.owner === this.ownerKey();
  }

  /**
   * An upload through the Storage API: the bucket takes the four types (bad_file — the API's 415) up to 25 MB
   * (file_too_big — its 413), then the INSERT policy decides (upload_refused — the API's 403). Never replaces an object.
   */
  storeObject(path: string, mime: string, size: number): void {
    this.tx(() => {
      if (!(SOURCE_MIMES as readonly string[]).includes(mime)) fail("bad_file");
      if (!(size >= 0) || size > MAX_SOURCE_BYTES) fail("file_too_big");
      if (!this.mayUploadSource(path)) fail("upload_refused");
      if (this.shared.objects[path]) fail("upload_failed");
      this.shared.objects[path] = { mime, size, owner: this.ownerKey() };
    });
  }

  /** A delete through the Storage API: as the caller — nothing happens when the policies do not allow it. True when the object went. */
  deleteObject(path: string): boolean {
    if (!this.shared.objects[path] || !this.mayDeleteSource(path)) return false;
    delete this.shared.objects[path];
    return true;
  }

  /** public.register_source_file: the uploaded object becomes the lesson's file (lessonId null: the edition's poster). */
  registerSourceFile(lessonId: number | null, path: string, displayName: string, pages: number | null): SourceFile {
    return this.tx(() => {
      const p = parseSourcePath(path);
      if (!p || p.edition !== this.week.edition.id || p.lesson !== lessonId) fail("bad_path");
      // a retry (the first answer lost) answers the row that call made, whatever changed since
      const existing = this.week.sourceFiles.find((f) => f.storage_path === path);
      if (existing) {
        if (existing.lesson_id !== lessonId) fail("bad_path");
        return { ...existing };
      }
      const code = this.sourceRefusal(path);
      if (code) fail(code);
      const obj = this.shared.objects[path];
      if (!obj || obj.owner !== this.ownerKey()) fail("no_file");
      if (!mimeMatches(obj!.mime, p!.ext) || obj!.size > MAX_SOURCE_BYTES) fail("bad_file");
      const mime = obj!.mime as SourceMime;
      const name = cleanDisplayName(displayName);
      const pageCount = pagesFor(mime, pages);
      const lesson = lessonId == null ? null : this.week.lessons.find((l) => l.id === lessonId)!;
      // a memorial slot's file remembers the fallen of its plan (v11), no speaker; the slot's sources columns stay
      const memorial = lesson?.kind === "memorial";
      const fallenId = memorial ? (this.week.memorialPlans.find((x) => x.lesson_id === lesson!.id)?.fallen_id ?? null) : null;
      const lead = lesson && !memorial ? (this.week.lessonSpeakers.find((x) => x.lesson_id === lesson.id && x.role === "lead")?.speaker_id ?? null) : null;
      const first = lesson != null && !memorial && !this.week.sourceFiles.some((f) => f.lesson_id === lesson.id && f.speaker_id === lead);
      const row: SourceFile = {
        id: this.nextId(this.week.sourceFiles), lesson_id: lessonId, cover: lessonId == null, speaker_id: lead, fallen_id: fallenId, storage_path: path, display_name: name,
        mime, size_bytes: obj!.size, page_count: pageCount, uploaded_by: this.actor.memberId, uploaded_at: this.now(),
      };
      this.week.sourceFiles.push(row);
      if (memorial) {
        // a memorial slot is always in the reader: nothing of the lesson changes
      } else if (lesson) {
        const next = arrived(lesson, first);
        if (next.sources_kind !== lesson.sources_kind || next.in_reader !== lesson.in_reader) {
          Object.assign(lesson, next, { version: lesson.version + 1, updated_by: this.actor.memberId });
        }
      } else if (pageCount != null && this.week.edition.settings.reader_cover == null) {
        // the first poster the browser could read is the cover (one it could not, the build never fetches)
        this.week.edition.settings = { ...this.week.edition.settings, reader_cover: row.id };
      }
      return { ...row };
    });
  }

  /** public.remove_source_file: the uploader or an admin, once the stored object is gone (file_present). A row already gone: nothing. */
  removeSourceFile(fileId: number): void {
    this.tx(() => {
      const f = this.week.sourceFiles.find((x) => x.id === fileId);
      if (!f) return;
      const e = this.week.edition;
      if ((e.kind === "archive" || e.status === "archived") && !this.isAdmin()) fail("archived");
      if (!this.isAdmin() && (f.uploaded_by == null || f.uploaded_by !== this.actor.memberId)) fail("not_uploader");
      if (this.shared.objects[f.storage_path]) fail("file_present");
      this.week.sourceFiles = this.week.sourceFiles.filter((x) => x.id !== f.id);
      if (this.week.edition.settings.reader_cover === f.id) {
        const settings = { ...this.week.edition.settings };
        delete settings.reader_cover;
        this.week.edition.settings = settings;
      }
    });
  }

  /** public.set_reader_headers: an admin of the edition; one line each (≤ 120); both empty removes them. */
  setReaderHeaders(left: string | null, right: string | null): void {
    this.tx(() => {
      this.requireEditionAdmin();
      const l = cleanLine(left, 120);
      const r = cleanLine(right, 120);
      const settings = { ...this.week.edition.settings };
      if (l == null && r == null) delete settings.reader_headers;
      else settings.reader_headers = [l ?? "", r ?? ""];
      this.week.edition.settings = settings;
    });
  }

  /** public.set_reader_cover: an admin of the edition; one of its posters (not Word) the browser could read, or null. */
  setReaderCover(fileId: number | null): void {
    this.tx(() => {
      this.requireEditionAdmin();
      if (fileId != null && !this.week.sourceFiles.some((f) => f.id === fileId && f.cover && f.page_count != null && f.mime !== DOCX)) fail("bad_value");
      const settings = { ...this.week.edition.settings };
      if (fileId == null) delete settings.reader_cover;
      else settings.reader_cover = fileId;
      this.week.edition.settings = settings;
    });
  }

  // ---------------------------------------------------------------- memorial times and logistics (CONTRACT.md, milestone 5ב-2)

  /** app.may_see_fallen: a global admin, any admin (they plan), or the team of an edition with a plan for that fallen. */
  mayFallen(fallenId: number): boolean {
    return !!this.actor.global || this.isAdmin() || (this.week.memorialPlans ?? []).some((p) => p.fallen_id === fallenId);
  }

  /** The fallen the caller sees (fallen_read), by id. */
  fallenList(): Fallen[] {
    return this.shared.fallen.filter((f) => this.mayFallen(f.id)).sort((a, b) => a.id - b.id).map((f) => ({ ...f }));
  }

  /** public.save_fallen: a global admin adds one (id null) or rewrites one. */
  saveFallen(id: number | null, f: FallenFields): number {
    return this.tx(() => {
      if (!this.actor.global) fail("forbidden");
      const c = cleanFallen(f);
      if (id == null) {
        const row: Fallen = { id: this.nextId(this.shared.fallen), ...c };
        this.shared.fallen.push(row);
        return row.id;
      }
      const row = this.shared.fallen.find((x) => x.id === id) ?? fail("stale");
      Object.assign(row, c);
      return row.id;
    });
  }

  /** public.delete_fallen: a global admin; one no edition planned for (`in_use`). Their family's contact goes with them. */
  deleteFallen(id: number): void {
    this.tx(() => {
      if (!this.actor.global) fail("forbidden");
      if (!this.shared.fallen.some((x) => x.id === id)) fail("stale");
      const weeks = [this.week, ...this.elsewhere().filter((w) => w !== this.week)];
      if (weeks.some((w) => (w.memorialPlans ?? []).some((p) => p.fallen_id === id))) fail("in_use");
      this.shared.fallen = this.shared.fallen.filter((x) => x.id !== id);
      delete this.shared.fallenContacts[id];
      for (const w of weeks) for (const f of w.sourceFiles) if (f.fallen_id === id) f.fallen_id = null; // on delete set null
    });
  }

  /** app.may_see_fallen_contacts: a global admin, or an admin of a real, live edition with a plan for that fallen. */
  mayFallenContacts(fallenId: number): boolean {
    return this.actor.global || this.fallenContactsEdition(fallenId) != null;
  }

  /**
   * app.fallen_contacts_edition: the newest real, live edition with a plan for that fallen in which the actor is an
   * admin — where a change to the family's contact is logged (null: a global admin with no such plan).
   */
  private fallenContactsEdition(fallenId: number): number | null {
    const weeks = this.actor.global ? [this.week, ...this.elsewhere().filter((x) => x !== this.week)] : this.isAdmin() ? [this.week] : [];
    let found: number | null = null;
    for (const w of weeks) {
      const e = w.edition;
      if (e.kind !== "real" || e.status === "archived") continue;
      if (!(w.memorialPlans ?? []).some((p) => p.fallen_id === fallenId)) continue;
      if (found == null || e.id > found) found = e.id;
    }
    return found;
  }

  /** public.get_fallen_contacts: null when it is not the caller's to see; no row yet → five nulls. */
  fallenContactsOf(fallenId: number): FallenContacts | null {
    if (!this.mayFallenContacts(fallenId)) return null;
    return { ...(this.shared.fallenContacts[fallenId] ?? EMPTY_FALLEN_CONTACTS) };
  }

  /** public.set_fallen_contacts: the same people; all five replaced; the log names the fields, never the values. */
  setFallenContacts(fallenId: number, c: FallenContacts): void {
    this.tx(() => {
      if (!this.shared.fallen.some((x) => x.id === fallenId)) fail("stale");
      if (!this.mayFallenContacts(fallenId)) fail("contacts_hidden");
      const next = cleanFallenContacts(c);
      const old = this.shared.fallenContacts[fallenId] ?? EMPTY_FALLEN_CONTACTS;
      const fields = (["contact_name", "relation", "phone", "email", "note"] as const).filter((k) => old[k] !== next[k]);
      if (fields.length === 0) return;
      this.shared.fallenContacts[fallenId] = next;
      this.log(this.fallenContactsEdition(fallenId), "fallen", fallenId, "contacts", { fields });
    });
  }

  /** public.add_memorial_slot: an admin of the edition, inside one of the day's memorial rows, in a room of the edition. */
  addMemorialSlot(day: Day, start: number, end: number, roomId: number | null): number {
    return this.tx(() => {
      this.requireEditionAdmin();
      this.checkBounds(day, start, end);
      if (!this.memorialRows(day).some((r) => r.start_min <= start && end <= r.end_min)) fail("outside_grid");
      if (roomId != null && !this.week.rooms.some((r) => r.id === roomId)) fail("bad_shape");
      const room = roomId ?? this.defaultRoom();
      if (!this.roomFree(day, start, end, room, [])) fail("room_taken");
      return this.newDraft(day, start, end, room, { kind: "memorial" }).id;
    });
  }

  /** public.remove_memorial_slot: an admin of the edition; a slot with no plan on it (`memorial_placed`). */
  removeMemorialSlot(lessonId: number): void {
    this.tx(() => {
      const l = this.week.lessons.find((x) => x.id === lessonId);
      if (!l || l.kind !== "memorial") fail("stale");
      this.requireEditionAdmin();
      if (this.week.memorialPlans.some((p) => p.lesson_id === lessonId)) fail("memorial_placed");
      this.deleteLesson(lessonId);
    });
  }

  /** public.add_memorial_plan: an admin of the edition, for an active fallen (`bad_value`), one per fallen (`duplicate`). */
  addMemorialPlan(fallenId: number): number {
    return this.tx(() => {
      this.requireEditionAdmin();
      if (!this.shared.fallen.some((f) => f.id === fallenId && f.active)) fail("bad_value");
      if (this.week.memorialPlans.some((p) => p.fallen_id === fallenId)) fail("duplicate");
      const p: MemorialPlan = {
        id: this.nextId(this.week.memorialPlans), fallen_id: fallenId, lesson_id: null, family_status: "not_contacted", speaker_text: null,
        planned_minutes: null, hard_stop: false, materials_note: null, version: 1,
      };
      this.week.memorialPlans.push(p);
      this.log(this.week.edition.id, "memorial_plans", p.id, "insert", { fallen: fallenId }); // a plan opens the family's contact to the edition's admins
      return p.id;
    });
  }

  /** public.update_memorial_plan: at the version on screen; the keys present, each checked; nothing changed → nothing. */
  updateMemorialPlan(planId: number, version: number, patch: PlanPatch): void {
    this.tx(() => {
      const p = this.memorialPlan(planId);
      if (p.version !== version) fail("stale");
      const c = cleanPlanPatch(patch);
      if ((Object.keys(c) as (keyof PlanPatch)[]).every((k) => c[k] === p[k])) return;
      Object.assign(p, c, { version: p.version + 1 });
    });
  }

  /**
   * public.place_memorial_plan: onto a memorial slot of the edition (`bad_value`) holding no other plan
   * (`memorial_taken`), or off (null). The liaison (the slot's escort and note) goes with the plan.
   */
  placeMemorialPlan(planId: number, version: number, lessonId: number | null): void {
    this.tx(() => {
      const p = this.memorialPlan(planId);
      if (p.version !== version) fail("stale");
      if (lessonId === p.lesson_id) return;
      let target: Lesson | undefined;
      if (lessonId != null) {
        target = this.week.lessons.find((l) => l.id === lessonId);
        if (!target || target.kind !== "memorial" || target.state === "cancelled") fail("bad_value");
        if (this.week.memorialPlans.some((x) => x.lesson_id === lessonId)) fail("memorial_taken");
      }
      const from = p.lesson_id == null ? undefined : this.week.lessons.find((l) => l.id === p.lesson_id);
      const carried = { escort_roster_id: from?.escort_roster_id ?? null, escort_note: from?.escort_note ?? null };
      Object.assign(p, { lesson_id: lessonId, version: p.version + 1 });
      const touch = (l: Lesson, v: typeof carried) => Object.assign(l, v, { version: l.version + 1, updated_by: this.actor.memberId });
      if (from && (from.escort_roster_id != null || from.escort_note != null)) touch(from, { escort_roster_id: null, escort_note: null });
      if (target && (target.escort_roster_id !== carried.escort_roster_id || target.escort_note !== carried.escort_note)) touch(target, carried);
    });
  }

  /** public.delete_memorial_plan: an admin of the edition; a plan that is not placed (`memorial_placed`). */
  deleteMemorialPlan(planId: number): void {
    this.tx(() => {
      const p = this.memorialPlan(planId);
      if (p.lesson_id != null) fail("memorial_placed");
      this.week.memorialPlans = this.week.memorialPlans.filter((x) => x.id !== p.id);
      this.log(this.week.edition.id, "memorial_plans", p.id, "delete", { fallen: p.fallen_id });
    });
  }

  /** public.set_memorial_policy: an admin of the edition; the parts given — all empty removes the policy. Never seeded. */
  setMemorialPolicy(policy: MemorialPolicy): void {
    this.tx(() => {
      this.requireEditionAdmin();
      const v = cleanPolicy(policy);
      const settings = { ...this.week.edition.settings };
      if (Object.keys(v).length === 0) delete settings.memorial;
      else settings.memorial = v;
      this.week.edition.settings = settings;
    });
  }

  /** public.get_transports_for: the closed lessons with an approved transport the caller may see the details of — each as transportOf shows it. */
  transportsOf(): LessonTransport[] {
    return this.week.lessons
      .filter((l) => l.state === "closed" && l.transport !== "none" && l.approval === "approved" && this.mayTransport(l.id))
      .sort((a, b) => a.id - b.id)
      .map((l) => ({ lesson_id: l.id, ...(this.shared.transport[this.transportKey(l.id)] ?? EMPTY_TRANSPORT) }));
  }

  /** The Week's names of the fallen: those its plans are for (load_week's `fallen`). */
  syncFallen(): void {
    const ids = new Set((this.week.memorialPlans ?? []).map((p) => p.fallen_id));
    this.week.fallen = this.shared.fallen.filter((f) => ids.has(f.id)).sort((a, b) => a.id - b.id).map(({ id, name, gender }) => ({ id, name, gender }));
  }

  /** app.memorial_plan: the plan (`stale`), and an admin of its edition. */
  private memorialPlan(planId: number): MemorialPlan {
    const p = this.week.memorialPlans.find((x) => x.id === planId) ?? fail("stale");
    this.requireEditionAdmin();
    return p;
  }

  /** app.memorial_rows: the day's memorial rows, as the edition's window allows them. */
  private memorialRows(day: Day): GridRow[] {
    return this.week.rows.filter((r) => r.kind === "memorial" && rowActive(r, day, this.week.edition));
  }

  /** The edition a path names and the actor's role there: this engine's own, or — for an admin of every edition — another one's. */
  private editionAt(editionId: number): { week: Week; role: Actor["role"] } | null {
    if (editionId === this.week.edition.id) return { week: this.week, role: this.actor.role };
    if (!this.actor.global) return null;
    const week = this.elsewhere().find((w) => w.edition.id === editionId);
    return week ? { week, role: "admin" } : null;
  }

  /** Whose object an upload is (the Storage API's owner_id): the member, in the demo. */
  private ownerKey(): string {
    return `member:${this.actor.memberId}`;
  }

  // ---------------------------------------------------------------- after the week (CONTRACT.md «After the week», milestone 6)

  /** lesson_reviews_read: the edition's admins and content members read its reviews; logistics none. */
  reviewsOf(): LessonReview[] {
    if (this.actor.role === "logistics") return [];
    return this.shared.reviews
      .filter((r) => r.edition_id === this.week.edition.id)
      .sort((a, b) => a.lesson_id - b.lesson_id)
      .map(({ edition_id: _, ...r }) => ({ ...r }));
  }

  /**
   * public.save_lesson_review: the lesson (`stale`); not logistics (`forbidden`); an archive its admins' (`archived`); a
   * closed lesson (`not_closed`); its handler (`not_handler`) once its day has passed in Israel and the week has a date
   * (`review_closed`) — an admin always; the version on screen, 0 for none (`stale`); the fields as cleanReview keeps
   * them. The same answers again change nothing. Returns the version saved.
   */
  saveReview(lessonId: number, version: number, fields: ReviewFields): number {
    return this.tx(() => {
      const l = this.week.lessons.find((x) => x.id === lessonId);
      if (!l || l.state === "cancelled") fail("stale");
      this.requireEditor();
      if (l!.state !== "closed" || l!.kind !== "lesson") fail("not_closed");
      if (!this.isAdmin()) {
        if (this.handlerOf(l!) !== this.actor.memberId) fail("not_handler");
        if (reviewWindow(this.week.edition, l!, this.now()).state !== "open") fail("review_closed");
      }
      const ed = this.week.edition.id;
      const old = this.shared.reviews.find((r) => r.edition_id === ed && r.lesson_id === lessonId);
      if ((old?.version ?? 0) !== version) fail("stale");
      const c = cleanReview(fields);
      const lead = this.week.lessonSpeakers.find((x) => x.lesson_id === lessonId && x.role === "lead")?.speaker_id ?? null;
      if (old && old.speaker_id === lead && (Object.keys(c) as (keyof ReviewFields)[]).every((k) => old[k] === c[k])) return old.version;
      const stamp = { written_by: this.actor.memberId, written_at: this.now() };
      if (old) {
        Object.assign(old, c, stamp, { speaker_id: lead, version: old.version + 1 });
        return old.version;
      }
      this.shared.reviews.push({ lesson_id: lessonId, edition_id: ed, speaker_id: lead, ...c, ...stamp, version: 1 });
      return 1;
    });
  }

  /**
   * app.may_read_reviews: a global admin, or an admin or content member of a real edition that is not archived. (The
   * engine knows the actor's role in its own edition only: that one is asked.)
   */
  mayReadReviews(): boolean {
    if (this.actor.global) return true;
    const e = this.week.edition;
    return e.kind === "real" && e.status !== "archived" && this.actor.role !== "logistics";
  }

  /**
   * public.speaker_reviews: the reviews written about this speaker (the lesson's lead when written) in real and archive
   * editions — a past year to whoever may read reviews, a live edition to its own admins and content. Newest year first
   * (a date TBD at the top), never who wrote it.
   */
  speakerReviews(speakerId: number): SpeakerReview[] {
    if (!this.mayReadReviews()) fail("forbidden");
    const weeks = [this.week, ...this.elsewhere().filter((w) => w !== this.week)];
    const out: (SpeakerReview & { _start: string | null })[] = [];
    for (const r of this.shared.reviews) {
      if (r.speaker_id !== speakerId) continue;
      const w = weeks.find((x) => x.edition.id === r.edition_id);
      const l = w?.lessons.find((x) => x.id === r.lesson_id);
      if (!w || !l) continue;
      const e = w.edition;
      if (e.kind !== "real" && e.kind !== "archive") continue;
      const past = e.kind === "archive" || e.status === "archived";
      const reader = this.actor.global || (w === this.week && this.actor.role !== "logistics");
      if (!past && !reader) continue;
      out.push({
        _start: e.start_date, edition_id: e.id, edition_label: e.label, edition_kind: e.kind, start_date: e.start_date, lesson_id: l.id, day: l.day,
        start_min: l.start_min, end_min: l.end_min, title: l.title, went_well: r.went_well, issues: r.issues, invite_again: r.invite_again,
        overran: r.overran, rating: r.rating, written_at: r.written_at,
      });
    }
    const desc = (a: string | null, b: string | null) => (a === b ? 0 : a == null ? -1 : b == null ? 1 : a < b ? 1 : -1);
    return out
      .sort((a, b) => desc(a._start, b._start) || b.edition_id - a.edition_id || a.day - b.day || a.start_min - b.start_min || a.lesson_id - b.lesson_id)
      .map(({ _start: _, ...r }) => r);
  }

  /**
   * public.edition_returning: the speakers of this edition's closed lessons who taught a closed lesson in an earlier
   * real or archive year (earlierEdition), each with those years' labels — the edition's admins and content.
   */
  returning(): ReturningSpeaker[] {
    if (this.actor.role === "logistics") fail("forbidden");
    const closedSpeakers = (w: Week) =>
      new Set(w.lessonSpeakers.filter((x) => w.lessons.some((l) => l.id === x.lesson_id && l.state === "closed" && l.kind === "lesson")).map((x) => x.speaker_id));
    const mine = closedSpeakers(this.week);
    const before = this.elsewhere()
      .filter((w) => w !== this.week && w.edition.id !== this.week.edition.id && (w.edition.kind === "real" || w.edition.kind === "archive") && earlierEdition(w.edition, this.week.edition))
      .sort((a, b) => (a.edition.start_date === b.edition.start_date ? a.edition.id - b.edition.id : a.edition.start_date == null ? -1 : b.edition.start_date == null ? 1 : a.edition.start_date < b.edition.start_date ? -1 : 1));
    const taught = before.map((w) => ({ label: w.edition.label, speakers: closedSpeakers(w) }));
    return [...mine]
      .sort((a, b) => a - b)
      .map((id) => ({ speaker_id: id, editions: taught.filter((t) => t.speakers.has(id)).map((t) => t.label) }))
      .filter((x) => x.editions.length > 0);
  }

  /**
   * public.purge_edition_private: a global admin (`forbidden`), the edition's label typed (`confirm_mismatch`), once the
   * week is over or the edition archived (`week_not_over`). Deletes the edition's transport details and its links' rate
   * counts, clears its lessons' import notes (an archive the import of 5786 made keeps last year's transport and payment
   * words there), revokes every link of it; the first time is kept (purged_at); logged with the counts only.
   */
  purgePrivate(confirm: string | null): PurgeReport {
    return this.tx(() => {
      if (!this.actor.global) fail("forbidden");
      const e = this.week.edition;
      if (confirm == null || confirm.replace(/^ +| +$/g, "") !== e.label) fail("confirm_mismatch");
      if (!purgeAllowed(e, this.now())) fail("week_not_over");
      let transport = 0;
      for (const k of Object.keys(this.shared.transport)) {
        if (k.startsWith(`${e.id}:`)) {
          delete this.shared.transport[k];
          transport++;
        }
      }
      let notes = 0;
      for (const k of Object.keys(this.shared.importNotes)) {
        if (k.startsWith(`${e.id}:`)) {
          delete this.shared.importNotes[k];
          notes++;
        }
      }
      const links = this.shared.links.filter((l) => l.edition_id === e.id);
      let hits = 0;
      for (const k of Object.keys(this.shared.linkHits)) {
        if (links.some((l) => k.startsWith(`${l.token} `))) {
          delete this.shared.linkHits[k];
          hits++;
        }
      }
      const now = this.now();
      let revoked = 0;
      for (const l of links) {
        if (l.revoked_at == null) {
          l.revoked_at = now;
          revoked++;
        }
      }
      e.purged_at = e.purged_at ?? now;
      const counts = { transport_details: transport, import_notes: notes, links_revoked: revoked, link_hits: hits };
      this.log(e.id, "editions", e.id, "purge", counts);
      return { ...counts, purged_at: e.purged_at };
    });
  }

  // ---------------------------------------------------------------- links (CONTRACT.md «Links and מכריכה לכריכה», milestone 5a)

  /** share_links_read: an edition's admins see its links — never a token; anyone else, none. */
  links(): ShareLink[] {
    if (!this.isAdmin()) return [];
    return this.shared.links
      .filter((l) => l.edition_id === this.week.edition.id)
      .sort((a, b) => b.id - a.id)
      .map(({ id, scope, subject_id, created_by, created_at, expires_at, revoked_at }) => ({ id, scope, subject_id, created_by, created_at, expires_at, revoked_at }));
  }

  /** public.issue_link: an admin of the edition; the live link of the same subject is revoked (replace); the token comes back once. */
  issueLink(scope: LinkScope, subjectId: number | null = null): IssuedLink {
    return this.tx(() => {
      this.requireEditionAdmin();
      const e = this.week.edition;
      if (e.kind === "archive" || e.status === "archived") fail("archived");
      if (!LINK_SCOPES.includes(scope)) fail("bad_value");
      if (scope === "escort") {
        if (subjectId == null || !this.week.roster.some((r) => r.id === subjectId)) fail("bad_escort");
      } else if (subjectId != null) fail("bad_value");
      const now = this.now();
      const expires = linkExpiry(e, scope, now);
      if (Date.parse(expires) <= Date.parse(now)) fail("link_past");
      for (const l of this.shared.links) {
        if (l.edition_id === e.id && l.scope === scope && l.subject_id === subjectId && l.revoked_at == null) l.revoked_at = now;
      }
      const token = this.newToken(scope, subjectId);
      const link: DemoLink = {
        id: this.nextId(this.shared.links), edition_id: e.id, scope, subject_id: subjectId, token, created_by: this.actor.memberId, created_at: now, expires_at: expires, revoked_at: null,
      };
      this.shared.links.push(link);
      return { link_id: link.id, token, expires_at: expires };
    });
  }

  /** public.revoke_link: an admin of the link's edition; already revoked → nothing. */
  revokeLink(linkId: number): void {
    this.tx(() => {
      const l = this.shared.links.find((x) => x.id === linkId && x.edition_id === this.week.edition.id) ?? fail("stale");
      this.requireEditionAdmin();
      if (l.revoked_at == null) l.revoked_at = this.now();
    });
  }

  /** app.editions_link_expiry: the week's date or the sign-up window moved — the live links' expiry follows. */
  refreshLinkExpiry(): void {
    for (const l of this.shared.links) {
      if (l.edition_id === this.week.edition.id && l.revoked_at == null) l.expires_at = linkExpiry(this.week.edition, l.scope, l.created_at);
    }
  }

  // ---------------------------------------------------------------- the anon functions: a token is the only key

  /** public.escort_view: that trainee's closed lessons; the phone only from W−7 of a real edition with a date. */
  escortView(token: unknown): EscortView {
    return this.tx(() => {
      const link = this.linkFor(token, "escort");
      const e = this.week.edition;
      const r = this.week.roster.find((x) => x.id === link.subject_id)!;
      const phones = e.kind === "real" && e.start_date != null && israelDate(this.now()) >= addDays(e.start_date, -7);
      const rooms = new Map(this.week.rooms.map((x) => [x.id, x.name]));
      const lessons: EscortLesson[] = this.week.lessons
        .filter((l) => l.state !== "cancelled" && (l.state === "closed" || l.kind === "memorial") && l.escort_roster_id === link.subject_id)
        .sort(gridOrder(this.week))
        .map((l) => {
          const lead = this.week.lessonSpeakers.find((x) => x.lesson_id === l.id && x.role === "lead");
          const s = lead ? this.week.speakers.find((x) => x.id === lead.speaker_id) : undefined;
          const approved = l.transport !== "none" && l.approval === "approved";
          const t = this.shared.transport[this.transportKey(l.id)];
          return {
            lesson_id: l.id,
            kind: l.kind,
            day: l.day,
            date: e.start_date ? addDays(e.start_date, l.day) : null,
            start_min: l.start_min,
            end_min: this.teachEnd(l),
            room: rooms.get(l.room_id)!,
            speaker: s ? { name: displayName(s), gender: s.gender } : null,
            title: l.title,
            self_intro: l.self_intro,
            duty_notes: dutyNotes(l, e.settings?.duty_phrases),
            escort_note: l.escort_note,
            phone: phones && s ? (this.shared.contacts[s.id]?.phone ?? null) : null,
            transport: approved,
            driver: e.kind === "real" && approved && t?.arranged ? { name: t.driver_name, phone: t.driver_phone } : null,
            ticks: this.ticksOf(l.id),
          };
        });
      return {
        edition: { label: e.label, start_date: e.start_date },
        escort: { full_name: r.full_name, gender: r.gender },
        phones_from: e.kind === "real" && e.start_date ? addDays(e.start_date, -7) : null,
        lessons,
      };
    });
  }

  /** public.escort_tick: on (the first time kept) or off, on one of the escort's lessons — never a memorial slot (no ticks there: bad_value, as an unknown item). */
  escortTick(token: unknown, lessonId: number, item: TickItem, on: boolean): EscortTicks {
    return this.tx(() => {
      const l = this.escortLesson(this.linkFor(token, "escort"), lessonId);
      if (!TICK_ITEMS.includes(item) || typeof on !== "boolean" || l.kind === "memorial") fail("bad_value");
      const has = this.week.escortTicks.some((t) => t.lesson_id === l.id && t.item === item);
      if (on && !has) this.week.escortTicks.push({ lesson_id: l.id, item, at: this.now() });
      if (!on) this.week.escortTicks = this.week.escortTicks.filter((t) => !(t.lesson_id === l.id && t.item === item));
      return this.ticksOf(l.id);
    });
  }

  /** public.escort_pickup: write-only, on a lesson whose transport was approved. */
  escortPickup(token: unknown, lessonId: number, address: string): void {
    this.tx(() => {
      const l = this.escortLesson(this.linkFor(token, "escort"), lessonId);
      if (!(l.transport !== "none" && l.approval === "approved")) fail("no_transport");
      const a = typeof address === "string" ? cleanLine(address, STAGE_LIMITS.pickup_address) : null;
      if (a == null) fail("bad_value");
      const key = this.transportKey(l.id);
      this.shared.transport[key] = { ...(this.shared.transport[key] ?? EMPTY_TRANSPORT), pickup_address: a };
      this.shared.log.push({
        id: this.nextId(this.shared.log), at: this.now(), actor: null, edition_id: this.week.edition.id, entity: "lessons", entity_id: l.id, kind: "transport",
        detail: { fields: ["pickup_address"], via: "escort_link" },
      });
    });
  }

  /** public.kk_form: the window, the trainees (names only), and the groups on offer — whether each is full, never who is in it. */
  kkForm(token: unknown): KkForm {
    return this.tx(() => {
      this.linkFor(token, "kk_signup");
      const e = this.week.edition;
      const k = this.shared.kk;
      const offered = (g: KkGroup) => g.open && g.capacity != null;
      const rooms = new Map(this.week.rooms.map((x) => [x.id, x.name]));
      const names = new Map(this.week.roster.map((x) => [x.id, x.full_name]));
      return {
        edition: { label: e.label, start_date: e.start_date },
        window: { opens_at: e.settings?.kk_window?.opens_at ?? null, closes_at: e.settings?.kk_window?.closes_at ?? null },
        open: this.kkOpen(),
        roster: [...this.week.roster].sort((a, b) => a.full_name.localeCompare(b.full_name, "he") || a.id - b.id).map(({ id, full_name }) => ({ id, full_name })),
        tracks: k.tracks
          .filter((t) => t.edition_id === e.id && this.kkTrackOnGrid(t) && k.groups.some((g) => g.track_id === t.id && offered(g)))
          .sort((a, b) => a.day - b.day || a.start_min - b.start_min)
          .map((t) => ({
            id: t.id, day: t.day, date: e.start_date ? addDays(e.start_date, t.day) : null, start_min: t.start_min, end_min: t.end_min,
            groups: k.groups
              .filter((g) => g.track_id === t.id && offered(g))
              .sort((a, b) => a.title.localeCompare(b.title, "he") || a.id - b.id)
              .map((g) => ({
                id: g.id, title: g.title, author: g.author, room: g.room_id == null ? null : (rooms.get(g.room_id) ?? null),
                leaders: k.leaders
                  .filter((x) => x.group_id === g.id)
                  .sort((a, b) => a.sort - b.sort || a.id - b.id)
                  .map((x) => ({ kind: x.kind, name: (x.roster_id != null ? names.get(x.roster_id) : x.label) ?? "" })),
                full: k.signups.filter((x) => x.group_id === g.id).length >= g.capacity!,
              })),
          })),
      };
    });
  }

  /** public.kk_signup: recorded only when everything allows it; an existing sign-up is never changed; the same answer always. */
  kkSignup(token: unknown, rosterId: number, groupId: number): void {
    this.tx(() => {
      this.linkFor(token, "kk_signup");
      const e = this.week.edition;
      const k = this.shared.kk;
      const g = k.groups.find((x) => x.id === groupId && x.edition_id === e.id);
      if (
        g && g.open && g.capacity != null && this.kkOpen() && this.kkTrackOnGrid(k.tracks.find((t) => t.id === g.track_id)!) &&
        this.week.roster.some((r) => r.id === rosterId) &&
        k.signups.filter((x) => x.group_id === g.id).length < g.capacity &&
        !k.signups.some((x) => x.track_id === g.track_id && x.roster_id === rosterId)
      ) {
        k.signups.push({ id: this.nextId(k.signups), edition_id: e.id, track_id: g.track_id, group_id: g.id, roster_id: rosterId, via: "link", created_at: this.now() });
      }
    });
  }

  /** public.schedule_view: the public schedule (src/exports/designer.ts). */
  scheduleView(token: unknown): ScheduleView {
    return this.tx(() => {
      this.linkFor(token, "schedule");
      const e = this.week.edition;
      return { edition: { label: e.label, start_date: e.start_date }, rows: scheduleEntries(this.week).map(({ lesson_id: _id, ...r }) => r) };
    });
  }

  // ---------------------------------------------------------------- מכריכה לכריכה (the edition's admins)

  /** public.load_kk. */
  loadKk(): KkData {
    const ed = this.week.edition.id;
    const k = this.shared.kk;
    const groups = k.groups.filter((g) => g.edition_id === ed);
    const ids = new Set(groups.map((g) => g.id));
    return structuredClone({
      tracks: k.tracks.filter((t) => t.edition_id === ed).sort((a, b) => a.day - b.day || a.start_min - b.start_min).map(({ edition_id: _e, ...t }) => t),
      groups: [...groups].sort((a, b) => a.id - b.id).map(({ edition_id: _e, ...g }) => g),
      leaders: k.leaders.filter((x) => ids.has(x.group_id)).sort((a, b) => a.group_id - b.group_id || a.sort - b.sort || a.id - b.id).map(({ sort: _s, ...x }) => x),
      signups: k.signups.filter((x) => x.edition_id === ed).sort((a, b) => a.id - b.id).map(({ edition_id: _e, ...x }) => x),
      orders: k.orders.filter((o) => ids.has(o.group_id)).sort((a, b) => a.group_id - b.group_id),
    });
  }

  /** public.kk_add_group: on a kk occurrence of the grid (`outside_grid`); its track made on first use. */
  kkAddGroup(day: number, startMin: number, fields: KkGroupFields): number {
    return this.tx(() => {
      this.requireEditionAdmin();
      const e = this.week.edition;
      const row = this.week.rows
        .filter((r) => r.kind === "kk" && rowActive(r, day as Day, e) && r.start_min === startMin)
        .sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min)[0];
      if (!row) fail("outside_grid");
      const f = this.cleanGroup(fields);
      if (f.title === undefined) fail("title_required");
      const k = this.shared.kk;
      let track = k.tracks.find((t) => t.edition_id === e.id && t.day === day && t.start_min === startMin);
      if (!track) {
        track = { id: this.nextId(k.tracks), edition_id: e.id, day: day as Day, start_min: startMin, end_min: row!.end_min };
        k.tracks.push(track);
      }
      const g = {
        id: this.nextId(k.groups), edition_id: e.id, track_id: track.id, title: f.title!, author: f.author ?? null, room_id: f.room_id ?? null,
        capacity: f.capacity ?? null, open: f.open ?? true,
      };
      k.groups.push(g);
      this.writeLeaders(g.id, f.leaders ?? []);
      return g.id;
    });
  }

  /** public.kk_update_group: the keys present. */
  kkUpdateGroup(groupId: number, patch: KkGroupFields): void {
    this.tx(() => {
      const g = this.kkGroup(groupId);
      this.requireEditionAdmin();
      const f = this.cleanGroup(patch);
      const { leaders, ...rest } = f;
      Object.assign(g, rest);
      if (leaders !== undefined) this.writeLeaders(g.id, leaders);
    });
  }

  /** public.kk_delete_group: nobody signed up (`group_has_signups`); a track left empty goes too. */
  kkDeleteGroup(groupId: number): void {
    this.tx(() => {
      const g = this.kkGroup(groupId);
      this.requireEditionAdmin();
      const k = this.shared.kk;
      if (k.signups.some((x) => x.group_id === g.id)) fail("group_has_signups");
      k.groups = k.groups.filter((x) => x.id !== g.id);
      k.leaders = k.leaders.filter((x) => x.group_id !== g.id);
      k.orders = k.orders.filter((x) => x.group_id !== g.id);
      if (!k.groups.some((x) => x.track_id === g.track_id)) k.tracks = k.tracks.filter((t) => t.id !== g.track_id);
    });
  }

  /** public.kk_place: the staff put a trainee in a group — new, or moved within the track; no capacity, no window. */
  kkPlace(groupId: number, rosterId: number): void {
    this.tx(() => {
      const g = this.kkGroup(groupId);
      this.requireEditionAdmin();
      if (rosterId == null || !this.week.roster.some((r) => r.id === rosterId)) fail("bad_trainee");
      const k = this.shared.kk;
      const s = k.signups.find((x) => x.track_id === g.track_id && x.roster_id === rosterId);
      if (!s) k.signups.push({ id: this.nextId(k.signups), edition_id: g.edition_id, track_id: g.track_id, group_id: g.id, roster_id: rosterId, via: "staff", created_at: this.now() });
      else if (s.group_id !== g.id) Object.assign(s, { group_id: g.id, via: "staff" });
    });
  }

  /** public.kk_unplace. */
  kkUnplace(trackId: number, rosterId: number): void {
    this.tx(() => {
      const k = this.shared.kk;
      if (!k.tracks.some((t) => t.id === trackId && t.edition_id === this.week.edition.id)) fail("stale");
      this.requireEditionAdmin();
      k.signups = k.signups.filter((x) => !(x.track_id === trackId && x.roster_id === rosterId));
    });
  }

  /** public.kk_set_window: both bounds, opening first — or neither (closed). The sign-up link's expiry follows. */
  kkSetWindow(opensAt: string | null, closesAt: string | null): void {
    this.tx(() => {
      this.requireEditionAdmin();
      if ((opensAt == null) !== (closesAt == null)) fail("bad_value");
      const settings = { ...this.week.edition.settings };
      if (opensAt == null || closesAt == null) delete settings.kk_window;
      else {
        const [o, c] = [Date.parse(opensAt), Date.parse(closesAt)];
        if (Number.isNaN(o) || Number.isNaN(c) || o >= c) fail("bad_value");
        settings.kk_window = { opens_at: new Date(o).toISOString(), closes_at: new Date(c).toISOString() };
      }
      this.week.edition.settings = settings;
      this.refreshLinkExpiry();
    });
  }

  /** public.set_book_order: logistics or an admin; copies 0–1000 (null removes it); ordered — the first time kept. */
  setBookOrder(groupId: number, copies: number | null, ordered: boolean): void {
    this.tx(() => {
      const g = this.kkGroup(groupId);
      this.requireLogistics();
      if (typeof ordered !== "boolean" || (copies == null && ordered) || (copies != null && (!Number.isInteger(copies) || copies < 0 || copies > 1000))) fail("bad_value");
      const k = this.shared.kk;
      const o = k.orders.find((x) => x.group_id === g.id);
      if (copies == null) {
        k.orders = k.orders.filter((x) => x.group_id !== g.id);
        return;
      }
      const at = ordered ? (o?.ordered_at ?? this.now()) : null;
      if (o) Object.assign(o, { copies, ordered_at: at });
      else k.orders.push({ group_id: g.id, copies, ordered_at: at });
    });
  }

  // ---------------------------------------------------------------- links and kk: helpers

  /**
   * app.link_for: the link a token opens — refused, always `link_invalid`, when unknown, of another scope, revoked,
   * expired, of another or an archived edition — then counted against its rate limit (an escort's link as one, a
   * class link per caller's address) and refused, the same way, past it. (Inside tx(): a refusal rolls the count
   * back, as the database's does.) A counted call clears the link's other counts whose window has passed.
   */
  private linkFor(token: unknown, scope: LinkScope): DemoLink {
    if (!tokenShape(token)) fail("link_invalid");
    const l = this.shared.links.find((x) => x.token === token) ?? fail("link_invalid");
    const now = this.now();
    if (l.scope !== scope || l.revoked_at != null || Date.parse(l.expires_at) <= Date.parse(now)) fail("link_invalid");
    const e = this.week.edition;
    if (l.edition_id !== e.id || e.kind === "archive" || e.status === "archived") fail("link_invalid");
    const key = `${l.token} ${linkClient(l.scope, this.actor.address)}`;
    const passed = (h: { window_start: string }) => Date.parse(h.window_start) <= Date.parse(now) - RATE_WINDOW_MS;
    for (const [k, h] of Object.entries(this.shared.linkHits)) if (k !== key && k.startsWith(`${l.token} `) && passed(h)) delete this.shared.linkHits[k];
    const h = this.shared.linkHits[key];
    if (!h || passed(h)) this.shared.linkHits[key] = { window_start: now, hits: 1 };
    else h.hits++;
    if (this.shared.linkHits[key].hits > linkRate(l.scope)) fail("link_invalid");
    return l;
  }

  /** app.escort_lesson: closed (or a memorial slot: its escort is the liaison), of this edition, escorted by the link's trainee — else `link_invalid` (no oracle). */
  private escortLesson(link: DemoLink, lessonId: number): Lesson {
    const l = this.week.lessons.find((x) => x.id === lessonId);
    if (!l || l.escort_roster_id !== link.subject_id || l.state === "cancelled" || (l.state !== "closed" && l.kind !== "memorial")) fail("link_invalid");
    return l!;
  }

  private ticksOf(lessonId: number): EscortTicks {
    const at = (item: TickItem) => this.week.escortTicks.find((t) => t.lesson_id === lessonId && t.item === item)?.at ?? null;
    return { reminded: at("reminded"), met: at("met"), introduced: at("introduced"), gift: at("gift") };
  }

  /** app.teach_end. */
  private teachEnd(l: Lesson): number {
    return l.kind === "memorial" ? l.end_min : l.start_min + teachMinutes(l, this.week.edition.settings?.lesson_minutes);
  }

  /** app.kk_track_on_grid: the track's kk row is still active that day (the first or last day's hours may have moved). */
  private kkTrackOnGrid(t: { day: Day; start_min: number }): boolean {
    return this.week.rows.some((r) => r.kind === "kk" && rowActive(r, t.day, this.week.edition) && r.start_min === t.start_min);
  }

  /** app.kk_open: inside the sign-up window now. */
  private kkOpen(): boolean {
    const w = this.week.edition.settings?.kk_window;
    const now = Date.parse(this.now());
    return !!w && Date.parse(w.opens_at) <= now && now < Date.parse(w.closes_at);
  }

  private kkGroup(id: number): KkGroup & { edition_id: number } {
    return this.shared.kk.groups.find((g) => g.id === id && g.edition_id === this.week.edition.id) ?? fail("stale");
  }

  private cleanGroup(fields: unknown) {
    return cleanGroupFields(fields, (id) => this.week.rooms.some((r) => r.id === id), (id) => this.week.roster.some((r) => r.id === id));
  }

  /** app.kk_write_leaders: replace the group's leaders, in order. */
  private writeLeaders(groupId: number, leaders: CleanLeader[]) {
    const k = this.shared.kk;
    k.leaders = k.leaders.filter((x) => x.group_id !== groupId);
    leaders.forEach((x, i) => k.leaders.push({ id: this.nextId(k.leaders), group_id: groupId, ...x, sort: i + 1 }));
  }

  // ---------------------------------------------------------------- the import of 5786 (CONTRACT.md «The import of 5786», v12)

  /** public.import_lookup: a global admin — which pool speaker has one of these phones (by key), which contact fields are filled. */
  importLookup(speakerIds: number[], phoneKeys: string[]): ImportLookup {
    if (!this.actor.global) fail("forbidden");
    if (speakerIds.length > 5000 || phoneKeys.length > 5000) fail("import_too_big");
    const keys = new Set(phoneKeys);
    const pool = new Set(this.week.speakers.map((s) => s.id));
    const phones = Object.entries(this.shared.contacts)
      .flatMap(([id, c]) => {
        const k = phoneKey(c.phone);
        return k != null && keys.has(k) && pool.has(Number(id)) ? [{ key: k, speaker_id: Number(id) }] : [];
      })
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.speaker_id - b.speaker_id));
    const ids = new Set([...speakerIds, ...phones.map((p) => p.speaker_id)]);
    const contacts = this.week.speakers
      .filter((s) => ids.has(s.id))
      .sort((a, b) => a.id - b.id)
      .map((s) => {
        const c = this.shared.contacts[s.id];
        return { speaker_id: s.id, phone: c?.phone != null, email: c?.email != null, secretary_note: c?.secretary_note != null, notes: c?.notes != null };
      });
    return { phones, contacts };
  }

  /**
   * public.import_commit: a global admin; one transaction — every row or none (a bad row is an ImportRowError naming
   * it). The archive edition is built apart and handed to `host.install` only when every row passed.
   */
  importCommit(kind: unknown, payload: unknown, host: ImportHost): ImportResult {
    return this.tx(() => {
      if (!this.actor.global) fail("forbidden");
      if (typeof kind !== "string" || !IMPORT_KINDS.includes(kind as ImportKind)) fail("bad_value");
      if (payload == null || typeof payload !== "object" || Array.isArray(payload)) fail("bad_value");
      const p = payload as Record<string, unknown>;
      const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
      checkPayloadSize(kind === "tracking" ? len(p.speakers) + len(p.lessons) : len(p.rows), payload);
      const titles = host.titles(jint(p.titles_from));
      let res: SpeakerResult[] = [];
      let source: string | null = null;
      let editionId: number | null = null;
      let lessons = 0;
      let replaced = 0;
      if (kind === "candidates") {
        if (!Array.isArray(p.rows)) fail("bad_value");
        source = cleanSource(p.source);
        res = this.importSpeakers(p.rows as unknown[], titles, source);
      } else if (kind === "tracking") {
        if (!Array.isArray(p.speakers) || !Array.isArray(p.lessons)) fail("bad_value");
        const label = cleanLabel(p.label);
        const start = typeof p.start_date === "string" || p.start_date == null ? cleanArchiveDate(p.start_date) : fail("bad_value");
        // the label as its key compares it; two editions already answering to it are not guessed between
        const found = host.byLabel(label);
        if (found.length > 1) fail("label_ambiguous");
        const existing = found[0] ?? null;
        if (existing && existing.kind !== "archive") fail("edition_exists");
        // the replace deletes the lessons, and «איך עבר» with them (on delete cascade): an archive with a review is kept
        if (existing?.week && this.shared.reviews.some((r) => r.edition_id === existing.week!.edition.id)) fail("archive_reviewed");
        source = cleanSource(p.source);
        res = this.importSpeakers(p.speakers as unknown[], titles, source);
        const ids = res.map((r) => r.speaker_id);
        // the edition: from the template, or the same label again — its lessons replaced
        const draft: Week = existing?.week
          ? { ...structuredClone({ ...existing.week, speakers: [] }), speakers: this.week.speakers, lessons: [], lessonSpeakers: [], pitches: [], escortTicks: [] }
          : {
              edition: { id: host.nextEditionId(), label, kind: "archive", start_date: start, first_day_from: null, last_day_until: ARCHIVE_LAST_DAY_UNTIL, status: "archived", settings: {} },
              rows: structuredClone(TEMPLATE_2026), rooms: [{ id: host.nextRoomId(), name: ARCHIVE_ROOM, sort: 1, is_default: true }], categories: structuredClone(this.week.categories),
              speakers: this.week.speakers, approaches: [], availability: [], lessons: [], lessonSpeakers: [], pitches: [], team: [], roster: [], escortTicks: [], sourceFiles: [],
              memorialPlans: [], fallen: [],
            };
        if (existing?.week) {
          replaced = existing.week.lessons.length;
          draft.edition.start_date = start;
          for (const f of draft.sourceFiles) f.lesson_id = null; // on delete set null
          for (const m of draft.memorialPlans ?? []) m.lesson_id = null;
          if (draft.rooms.length === 0) draft.rooms.push({ id: host.nextRoomId(), name: ARCHIVE_ROOM, sort: 1, is_default: true });
        }
        editionId = draft.edition.id;
        let nextRoom = host.nextRoomId();
        const roomOf = (index: number): number => {
          if (index === 0) return (draft.rooms.find((r) => r.is_default) ?? [...draft.rooms].sort((a, b) => a.sort - b.sort || a.id - b.id)[0]).id;
          const name = parallelRoomName(index);
          const there = draft.rooms.find((r) => r.name === name);
          if (there) return there.id;
          const r = { id: Math.max(nextRoom++, this.nextId(draft.rooms)), name, sort: index + 1, is_default: false };
          draft.rooms.push(r);
          return r.id;
        };
        const categories = host.categoryIds();
        const notes: Record<number, string> = {};
        for (const item of p.lessons as unknown[]) {
          try {
            if (item == null || typeof item !== "object" || Array.isArray(item)) fail("bad_value");
            const l = cleanLessonRow(item as ArchiveLessonRow, categories, ids.length, draft.edition);
            const room = roomOf(l.room);
            if (draft.lessons.some((x) => x.room_id === room && x.day === l.day && overlaps(x.start_min, x.end_min, l.start_min, l.end_min))) fail("room_taken");
            const lesson: Lesson = {
              id: this.nextId(draft.lessons), kind: "lesson", state: "closed", day: l.day as Day, start_min: l.start_min, end_min: l.end_min, room_id: room,
              title: l.title, category_id: l.category_id, audience: l.audience, teach_min: null, parallel_reason: null, ...LESSON_STAGE_DEFAULTS,
              sources_kind: l.sources_kind, print_when: l.print_when, sources_note: l.sources_note, pay_amount: l.pay_amount,
              version: 1, updated_by: this.actor.memberId,
            };
            draft.lessons.push(lesson);
            if (l.import_note != null) notes[lesson.id] = l.import_note;
            const seen: number[] = [];
            for (const ref of l.speakers) {
              const sid = ids[ref];
              if (seen.includes(sid)) continue; // two rows that became one pool speaker
              const busy = draft.lessonSpeakers.some(
                (x) => x.speaker_id === sid && draft.lessons.some((y) => y.id === x.lesson_id && y.day === l.day && overlaps(y.start_min, y.end_min, l.start_min, l.end_min)),
              );
              if (busy) fail("speaker_busy");
              draft.lessonSpeakers.push({ lesson_id: lesson.id, speaker_id: sid, role: seen.length ? "co" : "lead" });
              seen.push(sid);
            }
            lessons++;
          } catch (e) {
            throw rowError(item, e);
          }
        }
        // the notes: the archive's old ones go with its old lessons (on delete cascade)
        for (const k of Object.keys(this.shared.importNotes)) if (k.startsWith(`${draft.edition.id}:`)) delete this.shared.importNotes[k];
        for (const [id, n] of Object.entries(notes)) this.shared.importNotes[`${draft.edition.id}:${id}`] = n;
        host.install(draft);
      } else {
        if (!Array.isArray(p.rows)) fail("bad_value");
        for (const item of p.rows as unknown[]) {
          try {
            // the channel chosen from the list and the admin's own note — no key for the file's text (DECISIONS «סבב רביעי»)
            const it = prefsKeys(item);
            const s = this.week.speakers.find((x) => x.id === jint(it.speaker_id)) ?? fail("stale");
            const { contact_pref: pref, note: sec } = cleanPrefsRow(it); // app.has_contact: the note says how, never a number or an address
            const r: SpeakerResult = { speaker_id: s.id, created: false, filled: false, contacts: false, notes: false };
            if (s.contact_pref == null && pref != null) {
              Object.assign(s, { contact_pref: pref, version: s.version + 1 });
              this.log(null, "speakers", s.id, "update", { fields: ["contact_pref"] });
              r.filled = true;
            }
            const old = this.shared.contacts[s.id];
            if (old?.secretary_note == null && sec != null) {
              this.shared.contacts[s.id] = { ...(old ?? EMPTY_CONTACTS), secretary_note: sec };
              this.log(null, "speakers", s.id, "contacts", { fields: ["secretary_note"] });
              r.contacts = true;
            }
            res.push(r);
          } catch (e) {
            throw rowError(item, e);
          }
        }
      }
      // the result, and the log: counts and the label — never a name, a phone or a note
      const src = (kind === "tracking" ? p.speakers : p.rows) as unknown[];
      const created = res.filter((r) => r.created).length;
      const out: ImportResult = {
        created, merged: res.length - created, filled: res.filter((r) => r.filled).length, contacts: res.filter((r) => r.contacts).length,
        notes: res.filter((r) => r.notes).length, lessons, replaced, edition_id: editionId,
        speakers: res.map((r, i) => ({ row: jint((src[i] as Record<string, unknown> | null)?.row) ?? -1, speaker_id: r.speaker_id, created: r.created })),
      };
      this.log(editionId, "import", editionId, kind, {
        rows: res.length, created: out.created, merged: out.merged, filled: out.filled, contacts: out.contacts, notes: out.notes, lessons, replaced, ...(source != null ? { source } : {}),
      });
      return out;
    });
  }

  /** app.import_speakers: each row as app.import_speaker resolves it, a refusal naming the row. */
  private importSpeakers(rows: unknown[], titles: readonly string[], source: string): SpeakerResult[] {
    return rows.map((item) => {
      try {
        return this.importSpeaker(item, titles, source);
      } catch (e) {
        throw rowError(item, e);
      }
    });
  }

  /**
   * app.import_speaker: checked in its order, resolved (merge / the name key / new — never a phone alone: two names on
   * one line are two people), filled where empty — never a gender the speaker's own title contradicts, nor a title
   * that says the other gender than the speaker's.
   */
  private importSpeaker(item: unknown, titles: readonly string[], source: string): SpeakerResult {
    const it = (item != null && typeof item === "object" && !Array.isArray(item) ? item : {}) as Record<string, unknown>;
    const r = cleanSpeakerRow(
      {
        row: 0, action: it.action as SpeakerRow["action"], speaker_id: null, title: text(it.title), name: typeof it.name === "string" ? it.name : (null as unknown as string),
        gender: text(it.gender) as SpeakerRow["gender"], affiliation: text(it.affiliation), topics: it.topics as string[], phone: text(it.phone), email: text(it.email), notes: text(it.notes),
      },
      titles,
    );
    const pool = this.week.speakers;
    let s: Speaker | undefined;
    if (r.action === "merge") s = pool.find((x) => x.id === jint(it.speaker_id)) ?? fail("stale");
    else {
      const same = pool.filter((x) => x.name_key === r.key);
      if (same.length > 1) fail("disambiguator_required");
      if (same.length === 1) s = same[0];
    }
    // the pool's own title says the other gender: that gender is never filled from the row's title
    const own = s ? titleGender(s.title) : null;
    if (own != null && r.gender != null && own !== r.gender) r.gender = null;
    // …and the mirror: a title that says the other gender than the speaker's (its own, or the one filled now) is never filled
    const said = titleGender(r.title);
    const has = s ? (s.gender ?? r.gender) : null;
    if (said != null && has != null && said !== has) r.title = null;
    let created = false;
    let fields: string[] = [];
    if (!s) {
      s = {
        id: this.nextId(pool), title: r.title, name: r.name, disambiguator: null, gender: r.gender, affiliation: r.affiliation, bio_short: null, topics: r.topics,
        contact_pref: null, vetted: "pending", vetted_by: null, vetted_note: null, retired: false, name_key: r.key, version: 1,
      };
      pool.push(s);
      created = true;
      this.log(null, "speakers", s.id, "insert", { vetted: "pending", source });
    } else {
      const t = s;
      fields = [
        t.title == null && r.title != null ? "title" : null,
        t.gender == null && r.gender != null ? "gender" : null,
        t.affiliation == null && r.affiliation != null ? "affiliation" : null,
        t.topics.length === 0 && r.topics.length > 0 ? "topics" : null,
      ].filter((f): f is string => f != null);
      if (fields.length) {
        Object.assign(t, {
          title: t.title ?? r.title, gender: t.gender ?? r.gender, affiliation: t.affiliation ?? r.affiliation, topics: t.topics.length ? t.topics : r.topics, version: t.version + 1,
        });
        this.log(null, "speakers", t.id, "update", { fields });
      }
    }
    const old = this.shared.contacts[s.id];
    const cfields = (["phone", "email", "notes"] as const).filter((f) => old?.[f] == null && r[f] != null);
    if (cfields.length) {
      this.shared.contacts[s.id] = { phone: old?.phone ?? r.phone, email: old?.email ?? r.email, secretary_note: old?.secretary_note ?? null, notes: old?.notes ?? r.notes };
      this.log(null, "speakers", s.id, "contacts", { fields: [...cfields] });
    }
    return { speaker_id: s.id, created, filled: fields.length > 0, contacts: cfields.some((f) => f !== "notes"), notes: cfields.includes("notes") };
  }

  // ---------------------------------------------------------------- helpers

  /** Restores IN PLACE on failure, so `engine.week` and `engine.shared` stay the same objects (their rows are the snapshot's). */
  private tx<T>(fn: () => T): T {
    const snapshot = structuredClone({ week: this.week, shared: this.shared });
    try {
      const out = fn();
      this.reconfirm(snapshot.week.lessons);
      this.dropStaleTicks(snapshot.week.lessons);
      this.dropStaleNotes();
      this.syncFallen();
      return out;
    } catch (e) {
      Object.assign(this.week, snapshot.week);
      Object.assign(this.shared, snapshot.shared);
      throw e;
    }
  }

  /**
   * app.lessons_reconfirm, for every command at once: a closed lesson that already had its message sent and
   * whose confirmed details changed (moved, retitled, a new teaching time or amount, or closed again with its
   * message still marked — reopenLesson clears it) needs the speaker told again. A new confirm_sent_at (the
   * message re-sent) is the one exception.
   */
  private reconfirm(before: Lesson[]) {
    const old = new Map(before.map((l) => [l.id, l]));
    for (const l of this.week.lessons) {
      const o = old.get(l.id);
      if (!o || l.state !== "closed" || l.confirm_sent_at == null || l.confirm_sent_at !== o.confirm_sent_at) continue;
      if (o.state !== "closed" || RECONFIRM_FIELDS.some((k) => o[k] !== l[k])) l.needs_reconfirm = true;
    }
  }

  /** app.lessons_escort_ticks: a lesson whose escort changed (or that is gone) loses the last escort's ticks. */
  /** lesson_import_notes … on delete cascade: a note goes with its lesson. */
  private dropStaleNotes() {
    const prefix = `${this.week.edition.id}:`;
    const ids = new Set(this.week.lessons.map((l) => String(l.id)));
    for (const k of Object.keys(this.shared.importNotes)) if (k.startsWith(prefix) && !ids.has(k.slice(prefix.length))) delete this.shared.importNotes[k];
  }

  private dropStaleTicks(before: Lesson[]) {
    const now = new Map(this.week.lessons.map((l) => [l.id, l.escort_roster_id]));
    const old = new Map(before.map((l) => [l.id, l.escort_roster_id]));
    this.week.escortTicks = this.week.escortTicks.filter((t) => now.has(t.lesson_id) && now.get(t.lesson_id) === old.get(t.lesson_id));
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

  /**
   * app.may_edit_speaker: the speaker's own record is one row across the years, so a global admin
   * — or, in a real edition that is not archived, its admin or the speaker's handler there.
   * A practice/demo edition (anyone may claim any pool speaker there) or an archived one gives no such right.
   */
  mayEditSpeaker(speakerId: number): boolean {
    if (this.actor.global) return true;
    const e = this.week.edition;
    if (e.kind !== "real" || e.status === "archived") return false;
    return this.isAdmin() || this.week.approaches.some((a) => a.speaker_id === speakerId && a.owner_member_id === this.actor.memberId);
  }

  /** app.has_live_closed: a closed lesson in a real edition that is not archived (a sandbox never pins a speaker). */
  private hasLiveClosed(speakerId: number): boolean {
    return [this.week, ...this.elsewhere().filter((x) => x !== this.week)].some(
      (w) =>
        w.edition.kind === "real" &&
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

  private log(editionId: number | null, entity: string, entityId: number | null, kind: string, detail: Record<string, unknown>) {
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

  /** app.stage_lesson: the lesson a stage command is about; gone (or cancelled) is `stale`. */
  private stageLesson(id: number): Lesson {
    const l = this.week.lessons.find((x) => x.id === id);
    if (!l || l.state === "cancelled") fail("stale");
    return l!;
  }

  /** app.lesson_handler: the owner of the lead speaker's approach (a closed lesson has one). */
  private handlerOf(l: Lesson): number | null {
    const lead = this.week.lessonSpeakers.find((x) => x.lesson_id === l.id && x.role === "lead");
    return (lead && this.week.approaches.find((a) => a.speaker_id === lead.speaker_id)?.owner_member_id) ?? null;
  }

  /** app.require_handler: a closed lesson (`not_closed`), and its handler or an admin (`not_handler`). */
  private requireHandler(l: Lesson) {
    if (l.state !== "closed") fail("not_closed");
    if (!this.isAdmin() && this.handlerOf(l) !== this.actor.memberId) fail("not_handler");
  }

  /** app.require_logistics: logistics or an admin; content `forbidden`; an archive is an admin's only. */
  private requireLogistics() {
    if (this.actor.role === "content") fail("forbidden");
    const e = this.week.edition;
    if ((e.kind === "archive" || e.status === "archived") && !this.isAdmin()) fail("archived");
  }

  /** app.require_edition_admin. */
  private requireEditionAdmin() {
    if (!this.isAdmin()) fail("forbidden");
  }

  private transportKey(lessonId: number): string {
    return `${this.week.edition.id}:${lessonId}`;
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
      title: null, category_id: null, audience: null, teach_min: null, parallel_reason: null, ...LESSON_STAGE_DEFAULTS,
      version: 1, updated_by: this.actor.memberId, ...extra,
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
    delete this.shared.transport[this.transportKey(id)]; // on delete cascade
    for (const f of this.week.sourceFiles) if (f.lesson_id === id) f.lesson_id = null; // on delete set null: the files stay, for removal
    for (const p of this.week.memorialPlans ?? []) if (p.lesson_id === id) p.lesson_id = null; // on delete set null: back to the tray
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
