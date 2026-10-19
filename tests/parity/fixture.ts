// The base data every parity scenario starts from — synthetic only.
export type ActorKey = "admin" | "A" | "B" | "L";

export const MEMBERS: { key: ActorKey; email: string; role: "admin" | "content" | "logistics"; name: string }[] = [
  { key: "admin", email: "admin@example.org", role: "admin", name: "מדריך" },
  { key: "A", email: "a@example.org", role: "content", name: "חניך א" },
  { key: "B", email: "b@example.org", role: "content", name: "חניך ב" },
  { key: "L", email: "l@example.org", role: "logistics", name: "לוגיסטיקה" },
];

export const ROOMS = [
  { name: "בית מדרש", sort: 1, is_default: true },
  { name: "כיתה", sort: 2, is_default: false },
  { name: "ספרייה", sort: 3, is_default: false },
];

export const SPEAKERS: { name: string; gender: "m" | "f" | null; vetted?: "pending" | "approved"; retired?: boolean }[] = [
  { name: "אלפא", gender: "f" },
  { name: "בטא", gender: "m" },
  { name: "גמא", gender: "f" },
  { name: "דלתא", gender: null },
  { name: "הא", gender: "m", vetted: "pending" },
  { name: "וו", gender: "f", retired: true },
];

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
  | { archive: true };

/** The comparable state: everything keyed by natural keys, never by ids. */
export interface Normal {
  lessons: string[];
  pitches: string[];
  approaches: string[];
  speakers: string[];
}

export function lessonKey(l: { day: number; start_min: number; end_min: number; room: string }) {
  return `${l.day}|${l.start_min}-${l.end_min}|${l.room}`;
}

export interface Driver {
  run(step: Step): Promise<string>; // "ok" or the contract's code
  state(): Promise<Normal>;
  close(): Promise<void>;
}
