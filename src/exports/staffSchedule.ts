// «משמרות צוות» as a schedule (v20, the owner's «לו"ז הצוות: יום × שעות הלו"ז, כמו ברשת») — pure. A column a day, a row
// a time row of the grid that is active on some day of the week (walked as groupSchedule walks them: rowActive, so
// Sunday before the opening and Thursday after the close are not the week's), and in each cell the staff whose hours
// overlap the row's — by name, a team member's or typed, or «צוות <מכינה>». A night row (00:00–06:30) is the day's
// before it, as the grid's minutes are. A staff shift that overlaps no row of its day (a grid with gaps, after the
// close) is never lost: it is listed apart (`outside`), the sheet's last row.
//
// No phone (a staff shift has none) and NEVER a transport in the sheet: `staffScheduleTable` is what every member of
// the edition may open (/print/rota, the workbook) and takes no transport at all. The logistics side alone draws the
// transports into its own view (src/screens/logistics/rota/StaffShifts.tsx) through `placeLegs` — given legs it
// computed from ONE get_transports_for read, for whom the database let read them.
//
// The two clocks: a staff shift runs 390–1830 on its day (06:30 → 06:30 the next morning); a transport's pickup_min
// counts from 00:00 of the LESSON's day (0–1830). So a pickup before 06:30 is the previous day's night on the staff's
// clock (`onStaffClock`: minute + 1440 the day before) — and on Sunday, with no day before it in the week, Sunday's.
import type { RotaData, RotaStaffShift } from "../data/rota";
import { DAY_END, DAY_NAMES, DAY_START, type Day, fmt, fmtRange, LRM, nightLabel, overlaps } from "../domain/time";
import type { Edition, GridRow, Week } from "../domain/types";
import { rowActive } from "../grid/layout";
import { SHEET, staffInOrder, staffWho } from "./rota";
import type { Table } from "./table";

const DAYS: readonly Day[] = [0, 1, 2, 3, 4];

type ScheduleWeek = { rows: readonly GridRow[]; edition: Pick<Edition, "first_day_from" | "last_day_until"> };

/** One row of the schedule: a time row of the grid, and per day the staff on then (null: the row is not that day's). */
export interface StaffScheduleRow {
  start: number;
  end: number;
  /** The grid row's label as the edition has it ("" for a lesson row without one). */
  label: string;
  /** By day 0–4: the staff shifts that overlap the row, in their order (day, start, id); null when the row is not active that day. */
  cells: (RotaStaffShift[] | null)[];
}

/** The rows of the schedule: each distinct (start, end, label) of the grid active on some day, by time. */
export function staffScheduleRows(week: ScheduleWeek, data: Pick<RotaData, "staff">): StaffScheduleRow[] {
  const staff = staffInOrder(data);
  const seen = new Map<string, StaffScheduleRow>();
  const rows = [...week.rows].sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min || a.id - b.id);
  for (const r of rows) {
    const active = DAYS.filter((d) => rowActive(r, d, week.edition));
    if (active.length === 0) continue;
    const key = `${r.start_min}-${r.end_min}-${r.label}`;
    const row = seen.get(key) ?? { start: r.start_min, end: r.end_min, label: r.label ?? "", cells: DAYS.map(() => null) };
    for (const d of active) row.cells[d] = staff.filter((s) => s.day === d && overlaps(s.start_min, s.end_min, r.start_min, r.end_min));
    seen.set(key, row);
  }
  return [...seen.values()];
}

/** The whole schedule: its rows, where each staff shift is first met, and the shifts no row of their day holds. */
export interface StaffSchedule {
  rows: StaffScheduleRow[];
  /** staff shift id → the index of the first row (in time) it overlaps on its day — where its hours, its note and its «עריכה» go. */
  first: Map<number, number>;
  /** By day 0–4: the staff shifts that overlap no active row of their day (after Thursday's close, a gap in the grid) — never lost. */
  outside: RotaStaffShift[][];
}

export function staffSchedule(week: ScheduleWeek, data: Pick<RotaData, "staff">): StaffSchedule {
  const rows = staffScheduleRows(week, data);
  const first = new Map<number, number>();
  rows.forEach((r, i) => {
    for (const c of r.cells) for (const s of c ?? []) if (!first.has(s.id)) first.set(s.id, i);
  });
  const outside = DAYS.map((d) => staffInOrder(data).filter((s) => s.day === d && !first.has(s.id)));
  return { rows, first, outside };
}

/** The rows a day has, by index into `rows` (the phone's one day at a time). */
export function dayRowIndexes(rows: readonly StaffScheduleRow[], day: Day): number[] {
  return rows.flatMap((r, i) => (r.cells[day] != null ? [i] : []));
}

/**
 * Where a new staff shift opened from a row may end: this row's end and every later end of an active row that day, in
 * time order, distinct — «+» fills the row's own hours, and the end is extendable to a later row's end.
 */
export function rowEndsFrom(rows: readonly StaffScheduleRow[], day: Day, index: number): number[] {
  const from = rows[index];
  if (!from || from.cells[day] == null) return [];
  const ends = rows.filter((r) => r.cells[day] != null && r.end >= from.end).map((r) => r.end);
  return [...new Set(ends)].sort((a, b) => a - b);
}

/** A staff shift in a cell: in its first row «שם ‎06:30–14:30», in the rows after it the name alone. */
function cellText(data: Pick<RotaData, "cohorts">, s: RotaStaffShift, isFirst: boolean): string {
  return isFirst ? `${staffWho(data, s)} ${LRM}${fmtRange(s.start_min, s.end_min)}` : staffWho(data, s);
}

/**
 * The schedule as a sheet («משמרות צוות»): a row per time row, a column per day — the names (the hours beside a name in
 * the first row it is on), «—» when nobody, blank when the row is not that day's; the shifts no row holds on a last row
 * «מחוץ לשורות הלו״ז». Names only: no note, no phone, never a transport — every member of the edition may print it.
 */
export function staffScheduleTable(week: Pick<Week, "rows" | "edition">, data: Pick<RotaData, "staff" | "cohorts">): Table {
  const { rows, first, outside } = staffSchedule(week, data);
  const out = rows.map((r, i) => [
    `${LRM}${fmtRange(r.start, r.end)}`,
    r.label,
    ...r.cells.map((c) => (c == null ? "" : c.length === 0 ? "—" : c.map((s) => cellText(data, s, first.get(s.id) === i)).join(", "))),
  ]);
  if (outside.some((x) => x.length > 0)) out.push(["", OUTSIDE_ROWS, ...outside.map((x) => x.map((s) => cellText(data, s, true)).join(", "))]);
  return {
    name: SHEET.staff,
    headers: ["שעה", "בלו״ז", ...DAYS.map((d) => DAY_NAMES[d])],
    widths: [14, 24, ...DAYS.map(() => 24)],
    landscape: true,
    rows: out,
  };
}

/** The last row's words: the staff shifts that overlap no row of the grid that day. */
export const OUTSIDE_ROWS = "מחוץ לשורות הלו״ז";

// ------------------------------------------------------------------ the transports (the logistics side only)

/** A minute of a lesson's day (pickup_min's clock, 0–1830) on the staff's clock: before 06:30 it is the night of the day before; Sunday's stays Sunday's (null). */
export function onStaffClock(day: Day, min: number): { day: Day; min: number } | null {
  if (min >= DAY_START) return { day, min: Math.min(min, DAY_END) };
  if (day === 0) return null;
  return { day: (day - 1) as Day, min: min + 1440 };
}

/** One leg of a transport, as the logistics side computed it from its one transports read. */
export interface TransportLeg {
  lessonId: number;
  /** The way to the lesson (at the pickup), or — for «הלוך ושוב» — the way back (at the teaching's end). */
  leg: "pickup" | "return";
  /** The lesson's day column. */
  day: Day;
  /** The leg's minute on the lesson's day (0–1830); null: the pickup time is not known (placed at the lesson's start, said TBD). */
  min: number | null;
  /** The lesson's start. */
  start: number;
  /** The lesson's speakers («» when none is named). */
  speaker: string;
  /** Where it stands, as the board says it: waits for the decision, approved, approved and «סודר». */
  state: "pending" | "approved" | "arranged";
}

/** A leg in the schedule: its column (the staff's clock — a pickup before 06:30 is the night before) and its row. */
export interface PlacedLeg extends TransportLeg {
  col: Day;
  row: number;
  /** «הסעה ‎06:10 · <מרצה>», «הסעה TBD · …», «הסעה חזרה ‎11:45 · …». */
  text: string;
}

/**
 * The row of a day holding a minute: of the rows active that day, the one it falls in (start ≤ m < end; of two that
 * overlap, the later-starting one); else the last one that began before it; else the day's first. -1: the day has no row.
 */
export function rowAt(rows: readonly StaffScheduleRow[], day: Day, min: number): number {
  const mine = dayRowIndexes(rows, day);
  if (mine.length === 0) return -1;
  const inside = mine.filter((i) => rows[i].start <= min && min < rows[i].end);
  if (inside.length) return inside.reduce((a, b) => (rows[b].start > rows[a].start ? b : a));
  const before = mine.filter((i) => rows[i].start <= min);
  return before.length ? before[before.length - 1] : mine[0];
}

/** A leg's chip: «הסעה ‎HH:MM · <מרצה>» (the way back «הסעה חזרה …»; no pickup time: TBD). */
export function legText(l: Pick<TransportLeg, "leg" | "min" | "speaker">): string {
  const time = l.min == null ? "TBD" : `${LRM}${fmt(l.min)}`;
  return `${l.leg === "return" ? "הסעה חזרה" : "הסעה"} ${time} · ${l.speaker || "TBD"}`;
}

/**
 * Each leg in the schedule: the pickup in the row holding its time on the staff's clock (a pickup before 06:30 in the
 * night rows of the day before; on Sunday, Sunday's first row), the way back at the teaching's end; a pickup with no
 * time at the lesson's start. In time order; a leg whose column has no row at all is left out (a day the week has not).
 */
export function placeLegs(rows: readonly StaffScheduleRow[], legs: readonly TransportLeg[]): PlacedLeg[] {
  const out: PlacedLeg[] = [];
  for (const l of legs) {
    const at = l.min ?? l.start;
    const clock = onStaffClock(l.day, at) ?? { day: l.day, min: at };
    const row = rowAt(rows, clock.day, clock.min);
    if (row < 0) continue;
    out.push({ ...l, col: clock.day, row, text: legText(l) });
  }
  return out.sort((a, b) => a.col - b.col || a.row - b.row || (a.min ?? a.start) - (b.min ?? b.start) || a.lessonId - b.lessonId || (a.leg === "pickup" ? -1 : 1));
}

/** «ליל ראשון–שני» for a row after midnight (the night belongs to the day before), else null. */
export function rowNight(day: Day, row: Pick<StaffScheduleRow, "start">): string | null {
  return nightLabel(day, row.start);
}
