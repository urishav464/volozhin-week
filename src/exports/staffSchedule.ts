// «משמרות צוות» as a schedule (v20, the owner's «לו"ז הצוות: יום × שעות הלו"ז, כמו ברשת») — pure. A column a day, a row
// a time row of the grid that is active on some day of the week (walked as groupSchedule walks them: rowActive, so
// Sunday before the opening and Thursday after the close are not the week's), and in each cell the staff whose hours
// overlap the row's — by name, a team member's or typed, or «צוות <מכינה>». No phone (a staff shift has none) and NEVER
// a transport: this is the sheet every member of the edition may open (/print/rota, the workbook). The logistics side
// draws the transports in its own view (stream B: src/screens/logistics/rota/StaffShifts.tsx, the «הסעות וצוות» print).
//
// Owned by stream B (the staff and transport stream): the foundation wrote this first correct version so rotaWorkbook and
// /print/rota's «משמרות צוות» have one builder to call.
import type { RotaData, RotaStaffShift } from "../data/rota";
import { DAY_NAMES, type Day, fmtRange, LRM, overlaps } from "../domain/time";
import type { Edition, GridRow, Week } from "../domain/types";
import { rowActive } from "../grid/layout";
import { SHEET, staffInOrder, staffWho } from "./rota";
import type { Table } from "./table";

const DAYS: readonly Day[] = [0, 1, 2, 3, 4];

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
export function staffScheduleRows(week: { rows: readonly GridRow[]; edition: Pick<Edition, "first_day_from" | "last_day_until"> }, data: Pick<RotaData, "staff">): StaffScheduleRow[] {
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

/** The schedule as a sheet («משמרות צוות»): a row per time row, a column per day — the names, «—» when nobody, blank when the row is not that day's. */
export function staffScheduleTable(week: Pick<Week, "rows" | "edition">, data: Pick<RotaData, "staff" | "cohorts">): Table {
  return {
    name: SHEET.staff,
    headers: ["שעה", "בלו״ז", ...DAYS.map((d) => DAY_NAMES[d])],
    widths: [14, 24, ...DAYS.map(() => 24)],
    landscape: true,
    rows: staffScheduleRows(week, data).map((r) => [
      `${LRM}${fmtRange(r.start, r.end)}`,
      r.label,
      ...r.cells.map((c) => (c == null ? "" : c.length === 0 ? "—" : c.map((s) => staffWho(data, s)).join(", "))),
    ]),
  };
}
