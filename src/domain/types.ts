// The week's domain — the same shapes the database returns (supabase/schema.sql)
// and DemoPort holds in memory. Screens and rules only ever see these.
import type { Day } from "./time";

export type Gender = "m" | "f";

export type RowKind = "lesson" | "fixed" | "kk" | "memorial";

/** A row of the week's grid: a lesson slot, a fixed block (meal/חבורות), מכריכה לכריכה, or a memorial slot. */
export interface GridRow {
  id: number;
  start_min: number;
  end_min: number;
  kind: RowKind;
  label: string;
  days: Day[];
}

export interface Room {
  id: number;
  name: string;
  sort: number;
  is_default: boolean;
}

export interface Category {
  id: number;
  name: string;
  color: string;
  sort: number;
  active: boolean;
}

export type Vetting = "pending" | "approved" | "rejected";

/** How a speaker prefers to be reached (the channel only — never the number or address). */
export type ContactPref = "phone" | "whatsapp" | "email" | "secretary";

/** A person in the cross-year pool. Contact details are NOT here — they live in speaker_contacts. */
export interface Speaker {
  id: number;
  title: string | null;
  /** Without the title («פלונית אלמונית»). */
  name: string;
  /** Tells two people of the same name apart («ירושלים», «מכון X»); required when the name key is taken. */
  disambiguator: string | null;
  /** What someone typed — never guessed from the name. */
  gender: Gender | null;
  affiliation: string | null;
  bio_short: string | null;
  topics: string[];
  contact_pref: ContactPref | null;
  vetted: Vetting;
  /** The admin who approved or rejected (a members.id), and their word on it — the team sees both. */
  vetted_by: number | null;
  vetted_note: string | null;
  retired: boolean;
  name_key: string;
  version: number;
}

/** speaker_contacts — reached only through the port's contacts calls, never in a Week or in Realtime. */
export interface SpeakerContacts {
  phone: string | null;
  email: string | null;
  secretary_note: string | null;
  notes: string | null;
}

export type ApproachStatus = "claimed" | "approached" | "positive" | "declined" | "no_answer";

/** Who handles a speaker this year — exactly one approach per speaker per edition. */
export interface Approach {
  id: number;
  speaker_id: number;
  owner_member_id: number | null;
  status: ApproachStatus;
  avail_note: string | null;
  /** A hand-over («העברה») the handler offered this member, waiting for their answer. */
  offered_to: number | null;
  version: number;
}

export interface Availability {
  id: number;
  approach_id: number;
  day: Day;
  from_min: number;
  to_min: number;
  kind: "can" | "cannot";
  note: string | null;
}

export type LessonKind = "lesson" | "memorial";
export type LessonState = "draft" | "closed" | "cancelled";
export type SourcesKind = "pending" | "sheet" | "presentation" | "sheet_presentation" | "sheet_video" | "none" | "other";

/** One lesson — or a shaped cell with no speaker yet (a draft). Every output is derived from these. */
export interface Lesson {
  id: number;
  kind: LessonKind;
  state: LessonState;
  day: Day;
  start_min: number;
  end_min: number;
  room_id: number;
  title: string | null;
  category_id: number | null;
  audience: string | null;
  teach_min: number | null;
  parallel_reason: string | null;
  pay_amount: number | null;
  transport: "none" | "one_way" | "round_trip";
  approval: "none" | "pending" | "approved" | "rejected";
  confirm_sent_at: string | null;
  needs_reconfirm: boolean;
  escort_roster_id: number | null;
  self_intro: boolean;
  sources_kind: SourcesKind;
  in_reader: boolean;
  version: number;
  updated_by: number | null;
}

export interface LessonSpeaker {
  lesson_id: number;
  speaker_id: number;
  role: "lead" | "co";
}

export type PitchState = "candidate" | "approached" | "declined" | "accepted" | "withdrawn" | "superseded";

/** "I approached this speaker about this cell" — the link between a speaker and a lesson. */
export interface Pitch {
  id: number;
  lesson_id: number;
  approach_id: number;
  state: PitchState;
  proposed_by: number | null;
  at: string;
}

export interface TeamMember {
  id: number;
  display_name: string;
  gender: Gender | null;
  role: "admin" | "content" | "logistics";
}

export interface EditionSettings {
  lesson_minutes?: number;
  row_minutes?: number;
  max_category_per_day?: number;
  /** The titles a speaker may carry this edition; absent = DEFAULT_TITLES (src/data/speakerRules.ts). */
  titles?: string[];
}

export interface Edition {
  id: number;
  label: string;
  kind: "real" | "practice" | "demo" | "archive";
  start_date: string | null;
  first_day_from: number | null;
  last_day_until: number;
  status: "planning" | "active" | "archived";
  settings: EditionSettings;
}

/** Everything the grid screen needs for one edition, loaded at once (~150 lessons: small). */
export interface Week {
  edition: Edition;
  rows: GridRow[];
  rooms: Room[];
  categories: Category[];
  speakers: Speaker[];
  approaches: Approach[];
  availability: Availability[];
  lessons: Lesson[];
  lessonSpeakers: LessonSpeaker[];
  pitches: Pitch[];
  team: TeamMember[];
}

/** Pitch states that still mean "in play" for a cell. */
export const LIVE_PITCH: ReadonlySet<PitchState> = new Set(["candidate", "approached"]);
