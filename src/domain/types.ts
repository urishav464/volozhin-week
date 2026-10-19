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
/** What was asked for the speaker's travel: nothing, one way, or both ways. */
export type Transport = "none" | "one_way" | "round_trip";
/** The instructor's word on the payment/transport request: none asked, waiting, approved, rejected. */
export type Approval = "none" | "pending" | "approved" | "rejected";
export type PrintWhen = "none" | "before" | "same_day";

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
  // ---- payment and transport (milestone 3): what the handler asked, and the instructor's word
  /** Whole shekels; null = none asked (a volunteer, or not decided) — never a default. */
  pay_amount: number | null;
  transport: Transport;
  approval: Approval;
  approval_note: string | null;
  /** The global admin who decided (members.id), and when. */
  approved_by: number | null;
  approved_at: string | null;
  /** Logistics marked the approved payment paid. */
  paid_at: string | null;
  // ---- the summary message to the speaker
  confirm_sent_at: string | null;
  confirm_sent_by: number | null;
  /** The lesson changed after the message went out: «לעדכן את המרצה». */
  needs_reconfirm: boolean;
  // ---- the escort
  /** A trainee of the edition's roster. */
  escort_roster_id: number | null;
  self_intro: boolean;
  escort_note: string | null;
  // ---- sources
  sources_kind: SourcesKind;
  print_when: PrintWhen;
  sources_note: string | null;
  /** http(s) only. */
  presentation_url: string | null;
  in_reader: boolean;
  version: number;
  updated_by: number | null;
}

/** A new lesson's stage fields — nothing asked, nothing sent, no escort, sources pending (the database's defaults). */
export const LESSON_STAGE_DEFAULTS = {
  pay_amount: null,
  transport: "none",
  approval: "none",
  approval_note: null,
  approved_by: null,
  approved_at: null,
  paid_at: null,
  confirm_sent_at: null,
  confirm_sent_by: null,
  needs_reconfirm: false,
  escort_roster_id: null,
  self_intro: false,
  escort_note: null,
  sources_kind: "pending",
  print_when: "none",
  sources_note: null,
  presentation_url: null,
  in_reader: false,
} as const satisfies Partial<Lesson>;

/**
 * Pickup and driver — personal data: transport_details, reached only through
 * the port's transport calls (app.may_see_transport), never in a Week or Realtime.
 */
export interface TransportDetails {
  pickup_address: string | null;
  /** As the team writes it («07:15», «אחרי השיעור»). */
  pickup_time: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  arranged: boolean;
}

/** One of the year's trainees (roster) — a name only, never a contact detail. Escorts come from here. */
export interface RosterMember {
  id: number;
  full_name: string;
  gender: Gender | null;
}

/** The lesson facts an escorts' duty phrase applies to (src/domain/escorts.ts). */
export type DutyWhen = "always" | "self_intro" | "escort_intro" | "transport" | "memorial";

/** One phrase of «משהו שחשוב לדעת», as the instructor pasted it, and when it applies. */
export interface DutyPhrase {
  when: DutyWhen;
  text: string;
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
  /** The summary message's template (src/domain/message.ts) — the instructor's own wording; absent until pasted. */
  confirm_template?: string;
  /** The escorts' «משהו שחשוב לדעת» phrases — the instructor's own; absent until pasted. */
  duty_phrases?: DutyPhrase[];
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
  /** The edition's trainees (names only), for escorts. */
  roster: RosterMember[];
}

/** Pitch states that still mean "in play" for a cell. */
export const LIVE_PITCH: ReadonlySet<PitchState> = new Set(["candidate", "approached"]);
