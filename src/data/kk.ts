// מכריכה לכריכה (DESIGN «מכריכה לכריכה», schema v9) — reached as `port.kk`:
// a track per kk occurrence of the grid (a day and a kk row), its groups (a
// book as the admin typed it — nothing seeded — a room, a capacity the admin
// entered, open or not), their leaders, the sign-ups (one per trainee per
// track: through the class's link, or placed by the staff), and the book
// orders. Writes are the edition admins' functions (book orders logistics'
// too); the cleaning below is the database's own (app.kk_clean_group,
// app.kk_clean_leaders), so the demo refuses exactly what production refuses.
import type { Day } from "../domain/time";
import { CommandError } from "./commands";
import { cleanLine } from "./speakerRules";

export interface KkTrack {
  id: number;
  day: Day;
  start_min: number;
  end_min: number;
}

export interface KkGroup {
  id: number;
  track_id: number;
  /** The book's title, as typed. */
  title: string;
  author: string | null;
  room_id: number | null;
  /** What the admin entered; null = not offered through the link yet. Never a default. */
  capacity: number | null;
  open: boolean;
}

export type LeaderKind = "staff" | "trainee" | "ein_prat";
export const LEADER_KINDS: readonly LeaderKind[] = ["staff", "trainee", "ein_prat"];

export interface KkLeader {
  id: number;
  group_id: number;
  kind: LeaderKind;
  /** A trainee leader (roster). */
  roster_id: number | null;
  /** Anyone else, as typed. */
  label: string | null;
}

export interface KkSignup {
  id: number;
  track_id: number;
  group_id: number;
  roster_id: number;
  /** Through the class's link, or placed by the staff. */
  via: "link" | "staff";
  created_at: string;
}

export interface BookOrder {
  group_id: number;
  copies: number;
  ordered_at: string | null;
}

/** public.load_kk — the edition's מכריכה לכריכה. The window is in the edition's settings (`kk_window`). */
export interface KkData {
  tracks: KkTrack[];
  groups: KkGroup[];
  leaders: KkLeader[];
  signups: KkSignup[];
  orders: BookOrder[];
}

/** A leader as a form sends it. */
export type LeaderInput = { kind: "trainee"; roster_id: number } | { kind: "staff" | "ein_prat"; label: string };

/** A group's fields — every key optional on an update; `title` required on a new one. */
export interface KkGroupFields {
  title?: string;
  author?: string | null;
  room_id?: number | null;
  capacity?: number | null;
  open?: boolean;
  leaders?: LeaderInput[];
}

export interface KkPort {
  load(editionId: number): Promise<KkData>;
  /** A group on the kk occurrence (day, the kk row starting at `start_min`); its track is made on first use. Returns the group's id. */
  addGroup(editionId: number, day: Day, startMin: number, fields: KkGroupFields): Promise<number>;
  updateGroup(groupId: number, patch: KkGroupFields): Promise<void>;
  /** Refused with `group_has_signups` while anyone is signed up. */
  deleteGroup(groupId: number): Promise<void>;
  /** The staff put a trainee in a group: a new sign-up, or a move within its track. */
  place(groupId: number, rosterId: number): Promise<void>;
  unplace(trackId: number, rosterId: number): Promise<void>;
  /** Both bounds (ISO instants), or both null: closed. */
  setWindow(editionId: number, opensAt: string | null, closesAt: string | null): Promise<void>;
  /** Copies to order (0–1000; null removes the line), and ordered or not (the first time kept). Logistics or an admin. */
  setBookOrder(groupId: number, copies: number | null, ordered: boolean): Promise<void>;
}

/** Characters, and the leaders' count — as the database checks them. */
export const KK_LIMITS = { title: 200, author: 120, leader: 80, leaders: 6, capacity: 1000, copies: 1000 } as const;

const fail = (code: string): never => {
  throw new CommandError(code);
};

const isWhole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** A whole number in [lo, hi], or null/absent → null (app.json_int). */
function wholeOrNull(v: unknown, lo: number, hi: number): number | null {
  if (v == null) return null;
  if (!isWhole(v) || v < lo || v > hi) fail("bad_value");
  return v as number;
}

/** A leader as stored: kind, and a roster id or a label. */
export interface CleanLeader {
  kind: LeaderKind;
  roster_id: number | null;
  label: string | null;
}

/** app.kk_clean_leaders: a trainee of the edition (`bad_trainee`), or a name, one line ≤ 80; repeats dropped; at most 6. */
export function cleanLeaders(v: unknown, isTrainee: (rosterId: number) => boolean): CleanLeader[] {
  if (v == null) return [];
  if (!Array.isArray(v)) fail("bad_value");
  const out: CleanLeader[] = [];
  for (const e of v as unknown[]) {
    const o = e as Record<string, unknown> | null;
    if (typeof o !== "object" || o === null || Array.isArray(o) || typeof o.kind !== "string" || !LEADER_KINDS.includes(o.kind as LeaderKind)) fail("bad_value");
    let one: CleanLeader;
    if (o!.kind === "trainee") {
      if (!isWhole(o!.roster_id) || !isTrainee(o!.roster_id as number)) fail("bad_trainee");
      one = { kind: "trainee", roster_id: o!.roster_id as number, label: null };
    } else {
      const label = typeof o!.label === "string" ? cleanLine(o!.label, KK_LIMITS.leader) : null;
      if (label == null) fail("bad_value");
      one = { kind: o!.kind as LeaderKind, roster_id: null, label };
    }
    if (out.some((x) => x.kind === one.kind && x.roster_id === one.roster_id && x.label === one.label)) continue;
    out.push(one);
  }
  if (out.length > KK_LIMITS.leaders) fail("bad_value");
  return out;
}

/** What a group's fields clean to: only the keys present (app.kk_clean_group). */
export interface CleanGroup {
  title?: string;
  author?: string | null;
  room_id?: number | null;
  capacity?: number | null;
  open?: boolean;
  leaders?: CleanLeader[];
}

/**
 * app.kk_clean_group, key by key in this order: title (one line ≤ 200, required — `title_required`), author (≤ 120),
 * room_id (a room of the edition), capacity (1–1000 or none), open (a boolean), leaders. Unknown keys are ignored.
 */
export function cleanGroupFields(p: unknown, isRoom: (roomId: number) => boolean, isTrainee: (rosterId: number) => boolean): CleanGroup {
  if (typeof p !== "object" || p === null || Array.isArray(p)) fail("bad_value");
  const f = p as Record<string, unknown>;
  const out: CleanGroup = {};
  if ("title" in f) {
    const t = typeof f.title === "string" ? cleanLine(f.title, KK_LIMITS.title) : null;
    if (t == null) fail("title_required");
    out.title = t!;
  }
  if ("author" in f) {
    if (f.author != null && typeof f.author !== "string") fail("bad_value");
    out.author = cleanLine(f.author as string | null, KK_LIMITS.author);
  }
  if ("room_id" in f) {
    const r = wholeOrNull(f.room_id, 1, 2147483647);
    if (r != null && !isRoom(r)) fail("bad_value");
    out.room_id = r;
  }
  if ("capacity" in f) out.capacity = wholeOrNull(f.capacity, 1, KK_LIMITS.capacity);
  if ("open" in f) {
    if (typeof f.open !== "boolean") fail("bad_value");
    out.open = f.open as boolean;
  }
  if ("leaders" in f) out.leaders = cleanLeaders(f.leaders, isTrainee);
  return out;
}
