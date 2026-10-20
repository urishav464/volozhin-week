// The grid's commands — their semantics are fixed in docs/CONTRACT.md, and
// both SupabasePort (SQL RPCs) and DemoPort (src/data/engine.ts) follow it.
import type { Day } from "../domain/time";
import type { Lesson, PrintWhen, SourcesKind, Transport, TransportDetails } from "../domain/types";

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
  /** A global admin approves or rejects — one lesson or a batch, each at the version on screen — with an optional note. */
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
}

/** A refusal with one of the contract's codes (src/errors.ts has the Hebrew). */
export class CommandError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
