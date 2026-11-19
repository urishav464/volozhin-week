// The public pages' storage (/e#token, /k#token, /s#token — schema v9): the
// anon functions and nothing else. No session, no sign-in, no other endpoint —
// the token is the only key, and every refusal is the one code `link_invalid`
// (src/errors.ts). Two implementations: SupabasePublic (the publishable key
// alone, src/data/supabaseLinks.ts) and the demo's (src/data/demoLinks.ts),
// which runs the same rules on the engine. The shapes below are the functions'
// fixed output (supabase/schema.sql «Milestone 5a»); tests/sql pins their keys.
import type { ScheduleEntry } from "../exports/designer";
import type { Day } from "../domain/time";
import type { Gender, LessonKind, TickItem } from "../domain/types";

/** When each of the four ticks was made, or null. */
export type EscortTicks = Record<TickItem, string | null>;

/** One of the escort's lessons — exactly the keys public.escort_view returns. */
export interface EscortLesson {
  lesson_id: number;
  kind: LessonKind;
  day: Day;
  /** The day column's date (yyyy-mm-dd), or null while the week's date is TBD. */
  date: string | null;
  /** The teaching time. */
  start_min: number;
  end_min: number;
  room: string;
  /** The lead speaker: the name as printed (title and name) and the gender the team entered. */
  speaker: { name: string; gender: Gender | null } | null;
  title: string | null;
  self_intro: boolean;
  /** The instructor's duty phrases that apply (src/domain/escorts.ts dutyNotes). */
  duty_notes: string[];
  escort_note: string | null;
  /** The lead speaker's phone — only from W−7 (Israel time) of a real edition with a date. */
  phone: string | null;
  /** Transport was approved for this lesson: the pickup address may be written. */
  transport: boolean;
  /** The driver, once the transport is approved and arranged. */
  driver: { name: string | null; phone: string | null } | null;
  ticks: EscortTicks;
}

export interface EscortView {
  edition: { label: string; start_date: string | null };
  escort: { full_name: string; gender: Gender | null };
  /** From which date the speakers' phones show (W−7); null while the date is TBD, or outside a real edition. */
  phones_from: string | null;
  lessons: EscortLesson[];
}

/** A group on offer: a book, a capacity entered, open to the link. */
export interface KkFormGroup {
  id: number;
  title: string;
  author: string | null;
  /** Where it meets, all week. */
  place: string | null;
  leaders: { kind: "staff" | "trainee" | "ein_prat"; name: string }[];
  /** No place left — a count, never who. */
  full: boolean;
}

/** One kk session of the week, from the grid (app.kk_rows): every group meets in each. */
export interface KkFormSession {
  day: Day;
  date: string | null;
  start_min: number;
  end_min: number;
}

export interface KkForm {
  edition: { label: string; start_date: string | null };
  window: { opens_at: string | null; closes_at: string | null };
  /** Inside the window right now. */
  open: boolean;
  /** The edition's trainees who lead no group, names only — nothing about who signed up. */
  roster: { id: number; full_name: string }[];
  sessions: KkFormSession[];
  /** The groups on offer, by title. */
  groups: KkFormGroup[];
}

/**
 * v19: a speaker the guests' schedule may show — only one whose approach in the link's edition has `public_ok`; each
 * once, in the order they first appear (src/exports/publicSchedule.ts ≡ public.schedule_view).
 */
export interface PublicPerson {
  /** The name as printed (title and name). */
  label: string;
  /** speakers.public_bio. */
  bio: string | null;
  /** «data:image/jpeg;base64,…», or null (no photo). */
  photo: string | null;
}

/**
 * v19: one row of the guests' schedule — the ten keys the designer's export has (ScheduleEntry, unchanged) and the
 * lesson's `public_note` (null for a memorial time) and the indexes of its speakers in `people` (a memorial time: []).
 * schedule_view and publicSchedule always send both; they are optional here only so a row written before v19 (the
 * e2e mocks) still compiles — a reader takes an absent one as null / [].
 */
export type PublicScheduleRow = ScheduleEntry & { note?: string | null; people?: number[] };

/** v19: a fixed row of the grid (a meal, a prayer, «מכריכה לכריכה») on one day — its label and times, no people. */
export interface FixedRow {
  day: Day;
  start_min: number;
  end_min: number;
  label: string;
}

export interface ScheduleView {
  edition: { label: string; start_date: string | null };
  rows: PublicScheduleRow[];
  /** v19 — always sent (optional in TS for answers written before v19; absent reads as []). */
  people?: PublicPerson[];
  /** v19: by day, then start — always sent (as `people`). */
  fixed?: FixedRow[];
}

/** What schedule_view answers since v19, every key present — publicSchedule's (src/exports/publicSchedule.ts) type. */
export interface GuestSchedule extends ScheduleView {
  rows: (ScheduleEntry & { note: string | null; people: number[] })[];
  people: PublicPerson[];
  fixed: FixedRow[];
}

export interface PublicPort {
  readonly mode: "demo" | "live";
  escortView(token: string): Promise<EscortView>;
  /** On (the first time kept) or off; answers the lesson's four ticks. */
  escortTick(token: string, lessonId: number, item: TickItem, on: boolean): Promise<EscortTicks>;
  /** Write-only: the address is never read back through the link. */
  escortPickup(token: string, lessonId: number, address: string): Promise<void>;
  kkForm(token: string): Promise<KkForm>;
  /** The same answer in every case — the page says «נקלט — אם יש בעיה, הצוות יחזור אליך». */
  kkSignup(token: string, rosterId: number, groupId: number): Promise<void>;
  scheduleView(token: string): Promise<ScheduleView>;
}
