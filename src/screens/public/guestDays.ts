// The guests' schedule (/s, the reset, phase 5) as the page draws it — pure, beside the page (as the logistics home's
// tasks.ts is). One answer of schedule_view, three steps:
//   guestView    an answer written before v19 (a database not yet re-run) has no `people`, no `fixed` and rows without
//                `note` / `people`: filled in empty, so the page draws it as a plain schedule and never crashes; a row's
//                index into `people` that is not there is dropped.
//   guestPeople  each approved speaker once, with the photo the page may draw (guestPhotoSrc: a JPEG the database would
//                store, inside the answer — never a URL of its own), decoded once per answer.
//   guestDays    by day: the lessons, the memorial times and the fixed rows merged by start time.
import type { FixedRow, PublicPerson, PublicScheduleRow, ScheduleView } from "../../data/publicPort";
import type { ScheduleEntry } from "../../exports/designer";
import { messageDate } from "../../domain/message";
import { guestPhotoSrc } from "../../domain/photo";
import { DAY_START, type Day } from "../../domain/time";
import { todayColumn } from "../../offline/view";

/** What schedule_view answers, before v19 or since: the v19 keys may be missing. */
export interface ScheduleAnswer {
  edition: ScheduleView["edition"];
  rows: (ScheduleEntry & { note?: string | null; people?: unknown })[];
  people?: unknown;
  fixed?: unknown;
}

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const filled = (v: string | null | undefined): boolean => !!v && v.trim() !== "";

/** Every v19 key present; what a pre-v19 answer lacks, empty. Idempotent (a v19 answer comes back equal). */
export function guestView(raw: ScheduleView | ScheduleAnswer): ScheduleView {
  const people: PublicPerson[] = (Array.isArray(raw.people) ? raw.people : []).map((p: { label?: unknown; bio?: unknown; photo?: unknown } | null) => ({
    label: text(p?.label) ?? "",
    bio: text(p?.bio),
    photo: text(p?.photo),
  }));
  const rows: PublicScheduleRow[] = raw.rows.map((r) => {
    const ks = Array.isArray(r.people) ? (r.people as unknown[]) : [];
    return {
      ...r,
      note: r.kind === "memorial" ? null : text(r.note),
      people: r.kind === "memorial" ? [] : ks.filter((k): k is number => Number.isInteger(k) && (k as number) >= 0 && (k as number) < people.length),
    };
  });
  const fixed: FixedRow[] = (Array.isArray(raw.fixed) ? (raw.fixed as FixedRow[]) : []).filter(
    (f) => f && Number.isInteger(f.day) && f.day >= 0 && f.day <= 4 && typeof f.start_min === "number" && typeof f.end_min === "number" && typeof f.label === "string",
  );
  return { edition: raw.edition, rows, people, fixed };
}

/** An approved speaker as the card draws them: `src` is the photo when it is one the page may draw, else null. */
export interface GuestPerson extends PublicPerson {
  src: string | null;
}

export function guestPeople(view: ScheduleView): GuestPerson[] {
  return view.people.map((p) => ({ ...p, src: guestPhotoSrc(p.photo) }));
}

/** A person has something for the card: a description or a photo the page may draw. */
export const personShown = (p: GuestPerson | undefined): p is GuestPerson => !!p && (filled(p.bio) || p.src != null);

/** A lesson opens a card only when it has more than its row says: a short description, or a person to show. */
export function rowHasMore(row: PublicScheduleRow, people: readonly GuestPerson[]): boolean {
  if (row.kind !== "lesson") return false;
  return filled(row.note) || row.people.some((k) => personShown(people[k]));
}

/** One line of a day: `index` is the row's place in the answer's `rows`; `night` from midnight on (the poster's night). */
export type GuestDayItem =
  | { type: "lesson"; index: number; row: PublicScheduleRow; more: boolean; night: boolean }
  | { type: "memorial"; index: number; row: PublicScheduleRow; night: boolean }
  | { type: "fixed"; fixed: FixedRow; night: boolean };

export interface GuestDay {
  day: Day;
  /** The day column's date as the summary message writes it, or null while the week's date is TBD. */
  date: string | null;
  /** «now» (Israel time) falls in this day's column. */
  today: boolean;
  items: GuestDayItem[];
}

const startOf = (i: GuestDayItem): number => (i.type === "fixed" ? i.fixed.start_min : i.row.start_min);

/**
 * The days a guest sees: every day with a lesson, a memorial time or a fixed row — none while no lesson is closed (the
 * page then says so alone). In a day, by start time; rows keep the answer's grid order (start, room, id) and fixed rows
 * theirs; at the same minute a fixed row comes first (a meal at 13:00 before the lesson that starts as it does).
 */
export function guestDays(view: ScheduleView, nowIso: string, people: readonly GuestPerson[] = guestPeople(view)): GuestDay[] {
  if (view.rows.length === 0) return [];
  const start = view.edition.start_date;
  const today = todayColumn(start, nowIso);
  const days = [...new Set<Day>([...view.rows.map((r) => r.day), ...view.fixed.map((f) => f.day)])].sort((a, b) => a - b);
  return days.map((day) => {
    const keyed: { item: GuestDayItem; rank: number; seq: number }[] = [];
    view.fixed.forEach((fixed, seq) => {
      if (fixed.day === day) keyed.push({ item: { type: "fixed", fixed, night: fixed.start_min >= 1440 }, rank: 0, seq });
    });
    view.rows.forEach((row, index) => {
      if (row.day !== day) return;
      const night = row.start_min >= 1440;
      const item: GuestDayItem = row.kind === "memorial" ? { type: "memorial", index, row, night } : { type: "lesson", index, row, more: rowHasMore(row, people), night };
      keyed.push({ item, rank: 1, seq: index });
    });
    keyed.sort((a, b) => startOf(a.item) - startOf(b.item) || a.rank - b.rank || a.seq - b.seq);
    return { day, date: messageDate(start, day, DAY_START), today: today === day, items: keyed.map((k) => k.item) };
  });
}
