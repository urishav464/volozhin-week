// The grid's commands — their semantics are fixed in docs/CONTRACT.md, and
// both SupabasePort (SQL RPCs) and DemoPort (src/data/engine.ts) follow it.
import type { Day } from "../domain/time";
import type { Lesson, MemorialPolicy, PrintWhen, SourcesKind, Transport, TransportDetails } from "../domain/types";
import type { PlanPatch } from "./memorial";

/** An existing draft, or a cell: a range of a day in a room (null = the default room). */
export type CellTarget = { lesson_id: number } | { day: Day; start_min: number; end_min: number; room_id: number | null };

export type ReshapeOp =
  | { op: "split_parallel"; count: 2 | 3; reason: string }
  | { op: "split_time"; parts: number[] }
  | { op: "merge_next" }
  | { op: "reset" };

export type LessonPatch = Partial<Pick<Lesson, "title" | "category_id" | "audience" | "teach_min">>;

/** The escort of a closed lesson: a trainee of the roster (or none), self-introduction, a note for the escorts' list. */
export interface EscortPatch {
  roster_id: number | null;
  self_intro: boolean;
  escort_note: string | null;
}

/** A closed lesson's sources, all five at once. */
export interface SourcesPatch {
  sources_kind: SourcesKind;
  print_when: PrintWhen;
  sources_note: string | null;
  /** http:// or https:// only. */
  presentation_url: string | null;
  /** Ignored (stored false) for a kind with nothing to print: pending, none, presentation. */
  in_reader: boolean;
}

/** A lesson in the approvals queue, at the version the instructor saw. */
export interface PaymentItem {
  lesson_id: number;
  version: number;
}

export interface WeekCommands {
  propose(speakerId: number, target: CellTarget, mode?: "self" | "offer"): Promise<{ lesson_id: number; pitch_id: number }>;
  unpropose(pitchId: number): Promise<void>;
  setPitch(pitchId: number, state: "candidate" | "approached" | "declined"): Promise<void>;
  closeLesson(pitchId: number): Promise<void>;
  reopenLesson(lessonId: number): Promise<void>;
  moveLesson(lessonId: number, to: { day: Day; start_min: number; end_min: number; room_id: number }): Promise<void>;
  reshape(day: Day, rowStart: number, op: ReshapeOp): Promise<void>;
  updateLesson(lessonId: number, version: number, patch: LessonPatch): Promise<void>;

  // ---- from placement to arrival (milestone 3; CONTRACT.md «From placement to arrival»)
  /**
   * The handler (or an admin) asks for an amount (whole shekels; null = none: a volunteer) and/or transport.
   * Anything asked → approval «pending»; nothing → «none». The same request again is nothing, unless it was rejected.
   */
  setPayment(lessonId: number, version: number, amount: number | null, transport: Transport): Promise<void>;
  /**
   * Approve or reject — one lesson or a batch, each at the version on screen — with an optional note. A global admin;
   * or (v18) an admin or a logistics member of the lesson's edition, a real one that is not archived. One approval is enough.
   */
  decidePayments(items: PaymentItem[], decision: "approved" | "rejected", note?: string | null): Promise<void>;
  /** «סומן כנשלח»: the handler or an admin; never while the payment/transport waits or was rejected. Clears «לעדכן את המרצה». */
  markConfirmSent(lessonId: number, version: number): Promise<void>;
  /** Any editor, on a closed lesson. */
  setEscort(lessonId: number, version: number, e: EscortPatch): Promise<void>;
  /** Any editor, on a closed lesson. */
  setSources(lessonId: number, version: number, s: SourcesPatch): Promise<void>;
  /** Logistics (or an admin): an approved payment is paid (or not yet). */
  setPaid(lessonId: number, paid: boolean): Promise<void>;
  /** Pickup and driver — null when the caller may not see them (app.may_see_transport). Never part of a Week. */
  transport(lessonId: number): Promise<TransportDetails | null>;
  /** The same people only; all five fields replaced (null clears). */
  setTransport(lessonId: number, d: TransportDetails): Promise<void>;
  /**
   * v18, the request's half: the lesson's handler or an admin of the edition, on a closed lesson that asked for
   * transport — whatever the instructor's decision (it is filled BEFORE the approval). Only the keys present are
   * written (null clears one); the log names the fields, never the values.
   */
  setTransportRequest(lessonId: number, patch: TransportRequestPatch): Promise<void>;
  /** v18, the driver's half: logistics or an admin of the edition, once the transport is approved. Only the keys present are written. */
  setTransportDriver(lessonId: number, patch: TransportDriverPatch): Promise<void>;
  /**
   * What last year's tracking sheet said about an imported lesson that has no field of its own (its transport and
   * payment words among them) — null when there is none or the caller may not see it: the transport details' rule
   * (public.get_import_note; for an archive, a global admin). Never part of a Week.
   */
  importNote(lessonId: number): Promise<string | null>;

  // ---- memorial times and logistics (milestone 5ב-2; CONTRACT.md «Memorial times and logistics»)
  /**
   * The edition's closed lessons whose transport waits for the instructor or was approved (v18: pending too — each
   * says which, `approval`), each with what transport(lessonId) would show the caller and its `pickup_min` — a lesson
   * they may not see the details of is not listed (public.get_transports_for). Never in a Week. «לוגיסטיקה ← הסעות»
   * shows the approved ones only (transportRows, src/exports/logistics.ts).
   */
  transports(): Promise<LessonTransport[]>;
  /** An admin of the edition: a memorial slot inside one of the day's memorial rows (null: the default room). Returns its lesson id. */
  addMemorialSlot(day: Day, start: number, end: number, roomId: number | null): Promise<number>;
  /** An admin of the edition: a memorial slot with no plan on it. */
  removeMemorialSlot(lessonId: number): Promise<void>;
  /** An admin of the edition: a plan for one of the active fallen (one per fallen). Returns its id. */
  addMemorialPlan(fallenId: number): Promise<number>;
  /** An admin of the edition, at the version on screen: the keys present. */
  updateMemorialPlan(planId: number, version: number, patch: PlanPatch): Promise<void>;
  /** An admin of the edition, at the version on screen: onto a free memorial slot of the edition, or off (null). The liaison goes with it. */
  placeMemorialPlan(planId: number, version: number, lessonId: number | null): Promise<void>;
  /** An admin of the edition: a plan that is not placed. */
  deleteMemorialPlan(planId: number): Promise<void>;
  /** An admin of the edition: settings.memorial — the parts given (all empty removes it). */
  setMemorialPolicy(policy: MemorialPolicy): Promise<void>;
  /** An admin of the edition (v13): the grid's soft rules; null removes one (its «הצעה» default returns). */
  setGridRules(rules: GridRules): Promise<void>;

  // ---- v18 (CONTRACT.md «v18 — day owners, availability by ranges, transport in two parts»)
  /**
   * An admin of the edition: the day's owners — at most two different active members who handle speakers (content or
   * admin). Replaces the day's list: a member already there keeps their `seen_at`, a new one starts with none.
   */
  setDayOwners(day: Day, memberIds: number[]): Promise<void>;
  /** One of the day's owners looked at its notices: their own `seen_at` is now. Anyone else: `forbidden`. */
  markDaySeen(day: Day): Promise<void>;
}

/** settings.gender_tolerance (0–5) and settings.max_category_per_day (1–10); null = the «הצעה» default. */
export interface GridRules {
  gender_tolerance: number | null;
  max_category_per_day: number | null;
}

/** v18: the request's half of a lesson's transport details — the keys present are written, the rest left as they are. */
export type TransportRequestPatch = Partial<{ pickup_address: string | null; pickup_time: string | null; pickup_min: number | null }>;

/** v18: the driver's half — the keys present are written. */
export type TransportDriverPatch = Partial<{ driver_name: string | null; driver_phone: string | null; arranged: boolean }>;

/**
 * A lesson's transport details in the transports read (public.get_transports_for): the five fields, whether the
 * request still waits for the instructor or was approved, and (v18) the pickup time as minutes from 00:00 of the
 * lesson's grid day — for a time-line board; personal data like the rest.
 */
export type LessonTransport = TransportDetails & { lesson_id: number; approval: "pending" | "approved"; pickup_min: number | null };

/** A refusal with one of the contract's codes (src/errors.ts has the Hebrew). */
export class CommandError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
