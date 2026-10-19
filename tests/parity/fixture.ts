// The base data every parity scenario starts from — synthetic only.
export type ActorKey = "admin" | "A" | "B" | "L" | "E";

/** `global`: an admin of every edition (members.edition_id null); everyone else belongs to the scenario's edition. */
export const MEMBERS: { key: ActorKey; email: string; role: "admin" | "content" | "logistics"; name: string; global?: true }[] = [
  { key: "admin", email: "admin@example.org", role: "admin", name: "מדריך", global: true },
  { key: "A", email: "a@example.org", role: "content", name: "חניך א" },
  { key: "B", email: "b@example.org", role: "content", name: "חניך ב" },
  { key: "L", email: "l@example.org", role: "logistics", name: "לוגיסטיקה" },
  { key: "E", email: "e@example.org", role: "admin", name: "אדמין המחזור" }, // this edition's admin only
];

export const ROOMS = [
  { name: "בית מדרש", sort: 1, is_default: true },
  { name: "כיתה", sort: 2, is_default: false },
  { name: "ספרייה", sort: 3, is_default: false },
];

/** A room that belongs to another edition: the SQL driver makes one there; the engine has no such room. */
export const FOREIGN_ROOM = "חדר של מחזור אחר";

export const SPEAKERS: { name: string; gender: "m" | "f" | null; vetted?: "pending" | "approved"; retired?: boolean }[] = [
  { name: "אלפא", gender: "f" },
  { name: "בטא", gender: "m" },
  { name: "גמא", gender: "f" },
  { name: "דלתא", gender: null },
  { name: "הא", gender: "m", vetted: "pending" },
  { name: "וו", gender: "f", retired: true },
  // the pool (milestone 2): names for «ייתכן שזה…», and a speaker B already handles
  { name: "פלונית אלמונית", gender: "f" },
  { name: "יוסף בן שמעון", gender: "m", vetted: "pending" },
  { name: "זין", gender: "m" },
];

/** Contacts some speakers start with — placeholder words only. */
export const CONTACTS: Record<string, { phone: string | null; email: string | null; secretary_note: string | null; notes: string | null }> = {
  "אלפא": { phone: "טלפון לדוגמה", email: null, secretary_note: "נתון לדוגמה", notes: null },
};

/** Approaches the edition starts with (owner by actor key), and their availability rows (an older, hand-entered shape: ranges across parts). */
export const APPROACHES: { speaker: string; owner: ActorKey; status: "claimed" }[] = [{ speaker: "זין", owner: "B", status: "claimed" }];
export const AVAILABILITY: { speaker: string; day: number; from: number; to: number; kind: "can" | "cannot"; note: string | null }[] = [
  { speaker: "זין", day: 2, from: 1200, to: 1830, kind: "can", note: "ערב ולילה" },
  { speaker: "זין", day: 3, from: 700, to: 1200, kind: "cannot", note: null },
];

/** A speaker as steps name them: «name», or «name#disambiguator» for a namesake. */
export function speakerLabel(s: { name: string; disambiguator: string | null }): string {
  return s.disambiguator ? `${s.name}#${s.disambiguator}` : s.name;
}
export function splitLabel(label: string): [string, string | null] {
  const i = label.indexOf("#");
  return i < 0 ? [label, null] : [label.slice(0, i), label.slice(i + 1)];
}

export interface CreateFields {
  name: string;
  title?: string | null;
  disambiguator?: string | null;
  gender?: string | null;
  affiliation?: string | null;
  bio_short?: string | null;
  topics?: unknown;
  contact_pref?: string | null;
}

export const CATEGORIES = ["תנ\"ך", "פילוסופיה"];

export const EDITION = { label: "בדיקת התאמה", first_day_from: 510, last_day_until: 1140 };

/** Where a lesson is: [day, start_min, room name?] — the room defaults to the default room. */
export type At = [number, number, string?];

export type Step =
  | { as: ActorKey; propose: string; cell: [number, number, number, string?]; mode?: "self" | "offer" }
  | { as: ActorKey; propose: string; at: At; mode?: "self" | "offer" }
  | { as: ActorKey; unpropose: string; at: At }
  | { as: ActorKey; setPitch: string; at: At; state: "candidate" | "approached" | "declined" }
  | { as: ActorKey; close: string; at: At }
  | { as: ActorKey; reopen: At }
  | { as: ActorKey; move: At; to: [number, number, number, string?] }
  | { as: ActorKey; reshape: [number, number]; op: { op: "split_parallel"; count: 2 | 3; reason: string } | { op: "split_time"; parts: number[] } | { op: "merge_next" } | { op: "reset" } }
  | { as: ActorKey; update: At; patch: { title?: string | null; category?: string | null; audience?: string | null; teach_min?: number | null }; staleBy?: number }
  | { archive: true }
  /** The edition becomes a practice week (kind 'practice'): the real pool, no right over it. */
  | { sandbox: true }
  // the speaker pool (CONTRACT.md «The speaker pool») — speakers by label
  | { as: ActorKey; matches: string }
  | { as: ActorKey; create: CreateFields; opts?: { claim?: boolean; approve?: boolean; confirmed?: boolean } }
  | { as: ActorKey; updateSpeaker: string; patch: Record<string, unknown>; staleBy?: number }
  | { as: ActorKey; vet: string[]; state: string; note?: string | null }
  | { as: ActorKey; readContacts: string }
  | { as: ActorKey; setContacts: string; phone?: string | null; email?: string | null; secretary_note?: string | null; notes?: string | null }
  | { as: ActorKey; claim: string }
  | { as: ActorKey; setStatus: string; status: string; note?: string | null; staleBy?: number }
  | { as: ActorKey; handOver: string; to: ActorKey | null; note?: string | null }
  | { as: ActorKey; answerHandOver: string; accept: boolean; note?: string | null }
  | { as: ActorKey; avail: string; day: number; part: string; kind: string | null; note?: string | null };

/** The comparable state: everything keyed by natural keys, never by ids. */
export interface Normal {
  lessons: string[];
  pitches: string[];
  approaches: string[];
  /** lesson_speakers */
  speakers: string[];
  /** the speakers themselves */
  pool: string[];
  contacts: string[];
  availability: string[];
}

const d = (v: unknown) => (v == null ? "-" : String(v));

export function poolLine(s: {
  name: string; disambiguator: string | null; title: string | null; gender: string | null; affiliation: string | null; bio_short: string | null;
  topics: string[]; contact_pref: string | null; vetted: string; vetted_note: string | null; retired: boolean; version: number;
}, vettedBy: string): string {
  return [speakerLabel(s), `t=${d(s.title)}`, `g=${d(s.gender)}`, `a=${d(s.affiliation)}`, `b=${d(s.bio_short)}`, `tp=${s.topics.join(",")}`,
    `cp=${d(s.contact_pref)}`, `vt=${s.vetted}`, `vb=${vettedBy}`, `vn=${d(s.vetted_note)}`, `r=${s.retired}`, `v=${s.version}`].join("|");
}

export function contactsLine(label: string, c: { phone: string | null; email: string | null; secretary_note: string | null; notes: string | null }): string {
  return `${label}|p=${d(c.phone)}|e=${d(c.email)}|s=${d(c.secretary_note)}|n=${d(c.notes)}`;
}

/** What a contacts read returns, as one comparable string. */
export function contactsRead(c: { phone: string | null; email: string | null; secretary_note: string | null; notes: string | null } | null): string {
  return c == null ? "hidden" : contactsLine("seen", c);
}

/** What a matches read returns, as one comparable string (the order of «similar» ones depends on collation, so sorted). */
export function matchesRead(list: { name: string; disambiguator: string | null; match: string }[]): string {
  return list.map((m) => `${speakerLabel(m)}:${m.match}`).sort().join(",") || "none";
}

export function lessonKey(l: { day: number; start_min: number; end_min: number; room: string }) {
  return `${l.day}|${l.start_min}-${l.end_min}|${l.room}`;
}

export interface Driver {
  run(step: Step): Promise<string>; // "ok" or the contract's code
  state(): Promise<Normal>;
  close(): Promise<void>;
}
