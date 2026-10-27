// מכריכה לכריכה (DESIGN «מכריכה לכריכה»; week-long since schema v15) — reached as `port.kk`:
// the edition's groups, each one book read across every kk session of the week (the sessions come
// from the grid: src/domain/kk.ts kkSessions ≡ app.kk_rows), in one place of the campus for the whole
// week; their leaders (a trainee of the roster, or a name as typed); the sign-ups (ONE book per
// trainee for the week: through the class's link, or placed by the staff); and the book orders.
// A group may start with its leaders only — the book comes later, and only a group with a book, a
// capacity and «פתוחה להרשמה» is offered through the link. Writes are the edition admins' functions
// (book orders logistics' too); the cleaning below is the database's own (app.kk_clean_group,
// app.kk_clean_leaders), so the demo refuses exactly what production refuses.
import { CommandError } from "./commands";
import { cleanLine } from "./speakerRules";

export interface KkGroup {
  id: number;
  /** The book's title, as typed; null while the leaders have not chosen one yet. */
  title: string | null;
  author: string | null;
  /** Where on the campus the group meets, all week, as typed; null = not set yet. */
  place: string | null;
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
  groups: KkGroup[];
  leaders: KkLeader[];
  signups: KkSignup[];
  orders: BookOrder[];
}

/** A leader as a form sends it. */
export type LeaderInput = { kind: "trainee"; roster_id: number } | { kind: "staff" | "ein_prat"; label: string };

/** A group's fields — every key optional, on a new group as on an update. */
export interface KkGroupFields {
  /** null (or blank) = no book yet. */
  title?: string | null;
  author?: string | null;
  place?: string | null;
  capacity?: number | null;
  open?: boolean;
  leaders?: LeaderInput[];
}

export interface KkPort {
  load(editionId: number): Promise<KkData>;
  /** A group for the whole week. Returns its id. */
  addGroup(editionId: number, fields: KkGroupFields): Promise<number>;
  updateGroup(groupId: number, patch: KkGroupFields): Promise<void>;
  /** Refused with `group_has_signups` while anyone is signed up. */
  deleteGroup(groupId: number): Promise<void>;
  /** The staff put a trainee in a group: a new sign-up, or a move from another book. Never a leader (`is_leader`). */
  place(groupId: number, rosterId: number): Promise<void>;
  /** The trainee's sign-up for the week, if any, is removed. */
  unplace(editionId: number, rosterId: number): Promise<void>;
  /** Both bounds (ISO instants), or both null: closed. */
  setWindow(editionId: number, opensAt: string | null, closesAt: string | null): Promise<void>;
  /** Copies to order (0–1000; null removes the line), and ordered or not (the first time kept). Logistics or an admin; a group with a book (`no_book`). */
  setBookOrder(groupId: number, copies: number | null, ordered: boolean): Promise<void>;
}

/** Characters, and the leaders' count — as the database checks them. */
export const KK_LIMITS = { title: 200, author: 120, place: 80, leader: 80, leaders: 6, capacity: 1000, copies: 1000 } as const;

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

/** A string or null, cleaned to one line ≤ max (blank → null); anything else is `bad_value`. */
function lineOrNull(v: unknown, max: number): string | null {
  if (v != null && typeof v !== "string") fail("bad_value");
  return cleanLine(v as string | null, max);
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
  title?: string | null;
  author?: string | null;
  place?: string | null;
  capacity?: number | null;
  open?: boolean;
  leaders?: CleanLeader[];
}

/**
 * app.kk_clean_group, key by key in this order: title (one line ≤ 200, or none: a group may wait for
 * its book), author (≤ 120), place (≤ 80), capacity (1–1000 or none), open (a boolean), leaders.
 * Unknown keys are ignored. The rules between groups (a place, a leader, a sign-up) are the
 * functions' own, after the cleaning (CONTRACT «מכריכה לכריכה»).
 */
export function cleanGroupFields(p: unknown, isTrainee: (rosterId: number) => boolean): CleanGroup {
  if (typeof p !== "object" || p === null || Array.isArray(p)) fail("bad_value");
  const f = p as Record<string, unknown>;
  const out: CleanGroup = {};
  if ("title" in f) out.title = lineOrNull(f.title, KK_LIMITS.title);
  if ("author" in f) out.author = lineOrNull(f.author, KK_LIMITS.author);
  if ("place" in f) out.place = lineOrNull(f.place, KK_LIMITS.place);
  if ("capacity" in f) out.capacity = wholeOrNull(f.capacity, 1, KK_LIMITS.capacity);
  if ("open" in f) {
    if (typeof f.open !== "boolean") fail("bad_value");
    out.open = f.open as boolean;
  }
  if ("leaders" in f) out.leaders = cleanLeaders(f.leaders, isTrainee);
  return out;
}
