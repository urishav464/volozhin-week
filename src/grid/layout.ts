// Where everything sits on the grid — pure, so every shape is testable without
// a browser.
//
// The idea: every row of the grid is a horizontal BAND with a fixed pixel
// height by kind (a 90-minute lesson row is tall, a meal is a thin strip).
// Time maps to height piecewise-linearly band by band (`yOf`), so a lesson of
// any shape is just a box from yOf(start) to yOf(end):
//   single      one band
//   time split  two boxes in one band (14:30–15:30 + 15:30–16:00)
//   merged      one box across several bands (00:30–05:00)
//   parallel    boxes that overlap in time share the width in lanes
// All days share the same bands, so a row lines up across the week even where
// it does not apply to a day (it is drawn inactive there).
import type { Edition, GridRow, Lesson, RowKind } from "../domain/types";
import { type Day, overlaps } from "../domain/time";

export const BAND_HEIGHT: Record<RowKind, number> = { lesson: 104, memorial: 40, kk: 34, fixed: 30 };

export interface Band {
  row: GridRow;
  top: number;
  height: number;
  /** The time range this band maps (rows that overlap the previous one are clipped). */
  t0: number;
  t1: number;
}

export interface Layout {
  bands: Band[];
  height: number;
  yOf(t: number): number;
}

export function buildLayout(rows: GridRow[], heights: Record<RowKind, number> = BAND_HEIGHT): Layout {
  const sorted = [...rows].sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min);
  const bands: Band[] = [];
  let top = 0;
  let prevEnd = -Infinity;
  for (const row of sorted) {
    // The 2026 poster itself overlaps two rows (פתיחת יום 06:30–07:15, breakfast
    // 07:00–08:00); the second one maps from where the first ends.
    const t0 = Math.max(row.start_min, prevEnd);
    const t1 = Math.max(row.end_min, t0);
    const height = heights[row.kind];
    bands.push({ row, top, height, t0, t1 });
    top += height;
    prevEnd = Math.max(prevEnd, t1);
  }
  const yOf = (t: number): number => {
    if (bands.length === 0) return 0;
    if (t <= bands[0].t0) return 0;
    for (const b of bands) {
      if (t <= b.t1) {
        if (t < b.t0) return b.top; // a gap between rows snaps to the next row's edge
        return b.t1 === b.t0 ? b.top : b.top + ((t - b.t0) / (b.t1 - b.t0)) * b.height;
      }
    }
    return top;
  };
  return { bands, height: top, yOf };
}

/** Is a row in play on this day of this edition (its days, Sunday's opening, Thursday's close)? */
export function rowActive(row: GridRow, day: Day, edition: Pick<Edition, "first_day_from" | "last_day_until">): boolean {
  if (!row.days.includes(day)) return false;
  if (day === 0 && edition.first_day_from != null && row.end_min <= edition.first_day_from) return false;
  if (day === 4 && row.start_min >= edition.last_day_until) return false;
  return true;
}

export interface Placed {
  lesson: Lesson;
  top: number;
  height: number;
  /** 0-based lane among the lessons it overlaps; lanes = how many share the width. */
  lane: number;
  lanes: number;
}

/** Position one day's lessons: boxes by time, lanes where they overlap. */
export function placeDay(layout: Layout, lessons: Lesson[]): Placed[] {
  const live = lessons.filter((l) => l.state !== "cancelled").sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min || a.room_id - b.room_id || a.id - b.id);
  const out: Placed[] = [];
  let i = 0;
  while (i < live.length) {
    // A cluster: lessons chained by overlap. Lanes are counted per cluster, so a
    // parallel pair at 16:00 does not narrow a single lesson at 17:30.
    let clusterEnd = live[i].end_min;
    let j = i + 1;
    while (j < live.length && live[j].start_min < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, live[j].end_min);
      j++;
    }
    const laneEnds: number[] = [];
    const lanesOf: number[] = [];
    for (let k = i; k < j; k++) {
      const l = live[k];
      let lane = laneEnds.findIndex((end) => end <= l.start_min);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(l.end_min);
      } else laneEnds[lane] = l.end_min;
      lanesOf.push(lane);
    }
    for (let k = i; k < j; k++) {
      const l = live[k];
      const top = layout.yOf(l.start_min);
      out.push({ lesson: l, top, height: layout.yOf(l.end_min) - top, lane: lanesOf[k - i], lanes: laneEnds.length });
    }
    i = j;
  }
  return out;
}

export interface FreeCell {
  day: Day;
  row: GridRow;
  top: number;
  height: number;
}

/**
 * The empty lesson cells of a day: an active lesson row that no lesson (of any
 * state but cancelled) touches. These are the drop targets, and the cells the
 * gender lens tints.
 */
export function freeCells(layout: Layout, day: Day, lessons: Lesson[], edition: Pick<Edition, "first_day_from" | "last_day_until">, kind: RowKind = "lesson"): FreeCell[] {
  const live = lessons.filter((l) => l.day === day && l.state !== "cancelled");
  return layout.bands
    .filter((b) => b.row.kind === kind && rowActive(b.row, day, edition))
    .filter((b) => !live.some((l) => overlaps(l.start_min, l.end_min, b.row.start_min, b.row.end_min)))
    .map((b) => ({ day, row: b.row, top: b.top, height: b.height }));
}
