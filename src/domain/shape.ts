// The cell a reshape acts on (CONTRACT `reshape`, v13): the lesson row widened to the
// lessons that touch it — a merged lesson is split whole, never beside itself.
// The engine, the shape menu and public.reshape compute it alike.
import { overlaps } from "./time";

interface Range {
  start_min: number;
  end_min: number;
}

export interface Span {
  start: number;
  end: number;
}

/** The row, widened to every lesson that overlaps it. */
export function cellSpan(row: Range, lessons: readonly Range[]): Span {
  let start = row.start_min;
  let end = row.end_min;
  for (const l of lessons) {
    if (!overlaps(l.start_min, l.end_min, row.start_min, row.end_min)) continue;
    start = Math.min(start, l.start_min);
    end = Math.max(end, l.end_min);
  }
  return { start, end };
}

/** A range that starts inside one lesson row and ends inside one (possibly later) — move_lesson's rule. */
export function spansRows(rows: readonly Range[], start: number, end: number): boolean {
  return rows.some((r) => r.start_min <= start && start < r.end_min) && rows.some((r) => r.start_min < end && end <= r.end_min);
}

/** split_time's parts: at least two, each ≥ 15 and a multiple of 5, summing to the span, each on the grid. */
export function timeSplitOk(rows: readonly Range[], span: Span, parts: readonly number[]): boolean {
  if (parts.length < 2 || parts.some((m) => !Number.isInteger(m) || m < 15 || m % 5 !== 0)) return false;
  if (parts.reduce((s, m) => s + m, 0) !== span.end - span.start) return false;
  let t = span.start;
  for (const m of parts) {
    if (!spansRows(rows, t, t + m)) return false;
    t += m;
  }
  return true;
}
