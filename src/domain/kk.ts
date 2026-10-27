// מכריכה לכריכה for the screens (schema v15): a group is the whole week's — one book, its leaders,
// one place — and meets at every kk session the grid has. The sessions here are app.kk_rows on
// days 0–4, so /kk, the public form (kk_form.sessions) and the engine list the same ones. Leaders
// are part of their group: a trainee who leads is not «עוד לא נרשמו» and is not offered the link.
import { rowActive } from "../grid/layout";
import type { KkData, KkGroup, KkLeader, LeaderInput, LeaderKind } from "../data/kk";
import { nameKey } from "./nameKey";
import type { Day } from "./time";
import type { Edition, GridRow, RosterMember } from "./types";

export const LEADER_KIND_LABEL: Record<LeaderKind, string> = { trainee: "חניך/ה", staff: "מהצוות", ein_prat: "מעין פרת" };

/** One kk session of the week: a kk row active on that day (the night row belongs to the day before). */
export interface KkSession {
  day: Day;
  start_min: number;
  end_min: number;
}

const DAYS: readonly Day[] = [0, 1, 2, 3, 4];

/** The week's kk sessions ≡ app.kk_rows(edition, day) for days 0–4: by day, then start, then end. */
export function kkSessions(rows: readonly GridRow[], edition: Pick<Edition, "first_day_from" | "last_day_until">): KkSession[] {
  const out: KkSession[] = [];
  for (const day of DAYS) {
    const today = rows.filter((r) => r.kind === "kk" && rowActive(r, day, edition)).sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min);
    for (const r of today) out.push({ day, start_min: r.start_min, end_min: r.end_min });
  }
  return out;
}

/** A leader's name: the roster's for a trainee, the typed one otherwise. */
export function leaderName(l: Pick<KkLeader, "roster_id" | "label">, roster: readonly RosterMember[]): string {
  if (l.roster_id != null) return roster.find((r) => r.id === l.roster_id)?.full_name ?? "חניך/ה שנמחק/ה";
  return l.label ?? "";
}

/** Names as one says them: «א», «א ו-ב», «א, ב ו-ג». */
export function andList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ו-${names[names.length - 1]}`;
}

/** The group's leaders, in their order. */
export function leadersOf(kk: Pick<KkData, "leaders">, groupId: number): KkLeader[] {
  return kk.leaders.filter((l) => l.group_id === groupId);
}

/** What a group is called on screen: its book, or — before the book is chosen — its leaders (or its place). */
export function groupName(g: Pick<KkGroup, "id" | "title" | "place">, kk: Pick<KkData, "leaders">, roster: readonly RosterMember[]): string {
  if (g.title) return g.title;
  const names = leadersOf(kk, g.id).map((l) => leaderName(l, roster));
  const who = names.length > 0 ? andList(names) : g.place;
  return who ? `עוד לא נבחר ספר · ${who}` : "עוד לא נבחר ספר";
}

/** The trainees who lead a group (any group: offered or not). */
export function traineeLeaders(kk: Pick<KkData, "leaders">): Set<number> {
  return new Set(kk.leaders.flatMap((l) => (l.roster_id == null ? [] : [l.roster_id])));
}

/** «עוד לא נרשמו»: the roster, without the leaders and without anyone signed up — in the roster's order. */
export function notYet(roster: readonly RosterMember[], kk: Pick<KkData, "leaders" | "signups">): RosterMember[] {
  const leading = traineeLeaders(kk);
  const signed = new Set(kk.signups.map((s) => s.roster_id));
  return roster.filter((r) => !leading.has(r.id) && !signed.has(r.id));
}

/**
 * A leader picked from the team list or typed by hand: a name that is a trainee's (by app.name_key)
 * is stored as that trainee, so the rules of a trainee leader hold for them — most of the team are
 * trainees of the class. Otherwise null: the caller keeps the name, «מהצוות» or «מעין פרת».
 */
export function leaderInput(name: string, roster: readonly RosterMember[]): Extract<LeaderInput, { kind: "trainee" }> | null {
  const key = nameKey(name);
  if (key === "") return null;
  const hit = roster.filter((r) => nameKey(r.full_name) === key);
  return hit.length === 1 ? { kind: "trainee", roster_id: hit[0]!.id } : null;
}

/** Offered through the link: a book, a capacity entered, open (≡ kk_form's groups). */
export function offered(g: Pick<KkGroup, "title" | "capacity" | "open">): boolean {
  return g.title != null && g.capacity != null && g.open;
}

/** Where the week stands, in the order of the work: leaders, books, the sign-up, the orders. */
export interface KkStatus {
  groups: number;
  /** Groups with at least two leaders — «סגורה» for the leaders' step. */
  paired: number;
  withBook: number;
  offered: number;
  signedUp: number;
  /** Who may sign up at all: the roster without the trainee leaders. */
  eligible: number;
  /** Groups with a book whose order is marked ordered. */
  ordered: number;
}

export function kkStatus(kk: KkData, roster: readonly RosterMember[]): KkStatus {
  const leading = traineeLeaders(kk);
  const books = kk.groups.filter((g) => g.title != null);
  const orderedIds = new Set(kk.orders.filter((o) => o.ordered_at != null).map((o) => o.group_id));
  return {
    groups: kk.groups.length,
    paired: kk.groups.filter((g) => leadersOf(kk, g.id).length >= 2).length,
    withBook: books.length,
    offered: kk.groups.filter(offered).length,
    signedUp: kk.signups.length,
    eligible: roster.filter((r) => !leading.has(r.id)).length,
    ordered: books.filter((g) => orderedIds.has(g.id)).length,
  };
}
