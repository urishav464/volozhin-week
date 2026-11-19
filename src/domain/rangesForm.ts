// The speaker page's availability editor (the reset, phase 2): per day «לא ידוע» · «כל היום» · «רק בשעות…» · «לא
// יכול/ה», and for «רק בשעות…» one to three from–to pairs. What it saves is ONE set_availability_ranges call
// (src/data/speakers.ts; the slots stay the one store) for the days that changed — pure here, so the screen, its
// preview and the tests read the same ranges.
//
// `rest` is never sent (always null): it is one value per call, and one save may mix modes, so each day carries its own
// ranges. «רק בשעות…» is its pairs (clamped to the day, merged where they touch) as «יכול/ה» plus «לא» over every gap
// between them — row for row the same as «the pairs, the rest «לא»» (rangesToSlots: a row a can-range does not cover
// whole touches a gap; the test compares both).
import { activeLessonRows, type AvailabilityRange, rangesToSlots, type SlotKind, slotKey } from "./availability";
import { LIMITS } from "../data/speakerRules";
import { rotaShiftsOf } from "./rota";
import { DAY_END, DAY_START, DAYS, type Day, fmt } from "./time";
import type { Edition, GridRow, SlotAvailability } from "./types";

export type DayMode = "unknown" | "all" | "hours" | "cannot";

export interface TimePair {
  /** "HH:MM", as a time input gives it. */
  from: string;
  to: string;
}

export interface DayForm {
  mode: DayMode;
  /** Only read in «hours». */
  pairs: TimePair[];
}

export type RangesForm = Partial<Record<Day, DayForm>>;

/** At most three pairs a day: 3 «יכול/ה» + 4 gaps a day, × 5 days ≤ the call's 40 ranges. */
export const MAX_PAIRS = 3;

type Rows = readonly GridRow[];

/** The day as the week has it: from its first lesson row's start to its last one's end; null when no lesson row is in play. */
export function daySpan(rows: Rows, edition: Edition, day: Day): { start: number; end: number } | null {
  const active = activeLessonRows(rows, edition, day);
  if (active.length === 0) return null;
  return { start: active[0].start_min, end: Math.max(...active.map((r) => r.end_min)) };
}

/** "HH:MM" of the grid's minutes (1470 → "00:30", 1830 → "06:30"). */
const clockOf = (min: number): string => fmt(min);

/**
 * "HH:MM" as the grid's minutes: before 06:30 is the night after the day (+1440); "06:30" as an END is the next
 * morning's (1830) — as a start it is the day's opening (390). null for anything that is not a time.
 */
export function gridMinute(hhmm: string, end: boolean): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  const v = h * 60 + mm;
  if (v < DAY_START) return v + 1440;
  if (v === DAY_START && end) return DAY_END;
  return v;
}

/** What the slots say of each day in play, as the editor starts it. */
export function rangesFormOf(rows: Rows, edition: Edition, slots: readonly Pick<SlotAvailability, "day" | "row_id" | "kind">[]): RangesForm {
  const out: RangesForm = {};
  const saved = new Map(slots.map((v) => [slotKey(v.day, v.row_id), v.kind]));
  for (const day of DAYS) {
    const active = activeLessonRows(rows, edition, day);
    if (active.length === 0) continue;
    const kinds = active.map((r) => saved.get(slotKey(day, r.id)) ?? null);
    if (kinds.every((k) => k == null)) out[day] = { mode: "unknown", pairs: [] };
    else if (kinds.every((k) => k === "can")) out[day] = { mode: "all", pairs: [] };
    else if (kinds.every((k) => k === "cannot")) out[day] = { mode: "cannot", pairs: [] };
    // «לא» on some rows and nothing on the rest: not «רק בשעות…» with no hours (it would read «can at no hour») — the
    // day is unknown but for those rows, which «דיוק לפי משבצת» shows (the editor says the day is marked finer)
    else if (!kinds.includes("can")) out[day] = { mode: "unknown", pairs: [] };
    else {
      // runs of consecutive «יכול/ה» rows, each one pair
      const pairs: TimePair[] = [];
      let from: number | null = null;
      let to = 0;
      for (let i = 0; i < active.length; i++) {
        if (kinds[i] === "can") {
          from ??= active[i].start_min;
          to = active[i].end_min;
        } else if (from != null) {
          pairs.push({ from: clockOf(from), to: clockOf(to) });
          from = null;
        }
      }
      if (from != null) pairs.push({ from: clockOf(from), to: clockOf(to) });
      out[day] = { mode: "hours", pairs };
    }
  }
  return out;
}

const samePairs = (a: readonly TimePair[], b: readonly TimePair[]) => a.length === b.length && a.every((p, i) => p.from === b[i].from && p.to === b[i].to);

/** Two forms of a day say the same (the pairs count only in «hours»). */
function sameDay(a: DayForm | undefined, b: DayForm | undefined): boolean {
  if (!a || !b) return a === b;
  return a.mode === b.mode && (a.mode !== "hours" || samePairs(a.pairs, b.pairs));
}

/** The days whose form changed, ascending. */
export function touchedDays(initial: RangesForm, current: RangesForm): Day[] {
  return DAYS.filter((d) => current[d] != null && !sameDay(initial[d], current[d]));
}

/**
 * A day's «רק בשעות…» pairs as minutes, clamped to the day and merged where they touch; or what is wrong with them. A
 * start before 06:30 with a morning end («06:00–10:00», «from six») is that morning, before the day opens — clamped to
 * its start, not read as the night after.
 */
export function pairRanges(pairs: readonly TimePair[], span: { start: number; end: number }): { can: { start: number; end: number }[] } | { problem: string } {
  if (pairs.length === 0) return { problem: "צריך לפחות טווח אחד." };
  const list: { start: number; end: number }[] = [];
  for (const p of pairs) {
    let start = gridMinute(p.from, false);
    const end = gridMinute(p.to, true);
    if (start == null || end == null) return { problem: "צריך שעה בכל «מ־» ו«עד»." };
    if (start >= 1440 && end < 1440 && start - 1440 < end) start -= 1440;
    if (end <= start) return { problem: "«עד» צריך להיות אחרי «מ־»." };
    const s = Math.max(start, span.start);
    const e = Math.min(end, span.end);
    if (e <= s) return { problem: "טווח מחוץ לשעות היום." };
    list.push({ start: s, end: e });
  }
  list.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const r of list) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return { can: merged };
}

/** One day's ranges for its mode (no problem checked: `rangesCall` does). */
function dayRanges(day: Day, form: DayForm, span: { start: number; end: number }): AvailabilityRange[] | { problem: string } {
  switch (form.mode) {
    case "unknown":
      return [];
    case "all":
      return [{ day, start: span.start, end: span.end, kind: "can" }];
    case "cannot":
      return [{ day, start: span.start, end: span.end, kind: "cannot" }];
    case "hours": {
      const r = pairRanges(form.pairs, span);
      if ("problem" in r) return r;
      const out: AvailabilityRange[] = r.can.map((c) => ({ day, ...c, kind: "can" as SlotKind }));
      // «לא» over every gap the pairs leave in the day
      let at = span.start;
      for (const c of r.can) {
        if (c.start > at) out.push({ day, start: at, end: c.start, kind: "cannot" });
        at = c.end;
      }
      if (at < span.end) out.push({ day, start: at, end: span.end, kind: "cannot" });
      return out.sort((a, b) => a.start - b.start);
    }
  }
}

/**
 * The one call a save makes: the days that changed, their ranges, and what is wrong with a day (the save waits until
 * there is nothing). An «unknown» day is sent with no range — its slots are cleared.
 */
export function rangesCall(rows: Rows, edition: Edition, initial: RangesForm, current: RangesForm): { days: Day[]; ranges: AvailabilityRange[]; problems: Partial<Record<Day, string>> } {
  const days = touchedDays(initial, current);
  const ranges: AvailabilityRange[] = [];
  const problems: Partial<Record<Day, string>> = {};
  for (const day of days) {
    const span = daySpan(rows, edition, day);
    if (!span) continue;
    const r = dayRanges(day, current[day]!, span);
    if ("problem" in r) problems[day] = r.problem;
    else ranges.push(...r);
  }
  if (ranges.length > LIMITS.avail_ranges && days.length > 0) problems[days[days.length - 1]] = "יותר מדי טווחים בשמירה אחת: כדאי לשמור כמה ימים בכל פעם.";
  return { days: days.filter((d) => daySpan(rows, edition, d) != null), ranges, problems };
}

/**
 * Would saving this day's form write exactly the day's slots as they are? Not when the slots are finer than the four
 * modes say (a «לא» beside a «לא ידוע», a «יכול/ה» run with unmarked rows around it): the editor says so, and the
 * per-slot grid shows them.
 */
export function formMatchesSlots(rows: Rows, edition: Edition, day: Day, form: DayForm, slots: readonly Pick<SlotAvailability, "day" | "row_id" | "kind">[]): boolean {
  const span = daySpan(rows, edition, day);
  if (!span) return true;
  const r = dayRanges(day, form, span);
  if ("problem" in r) return false;
  const want = new Map(rangesToSlots(rows, edition, [day], r, null).map((x) => [x.row_id, x.kind]));
  const have = new Map(slots.filter((v) => v.day === day).map((v) => [v.row_id, v.kind]));
  return activeLessonRows(rows, edition, day).every((row) => (want.get(row.id) ?? null) === (have.get(row.id) ?? null));
}

/** What a save would mark, row by row of each day it touches (none: «לא ידוע»). */
export function previewOf(rows: Rows, edition: Edition, days: readonly Day[], ranges: readonly AvailabilityRange[]): { day: Day; row: GridRow; kind: SlotKind | null }[] {
  const marked = new Map(rangesToSlots(rows, edition, days, ranges, null).map((x) => [slotKey(x.day, x.row_id), x.kind]));
  return [...days]
    .sort((a, b) => a - b)
    .flatMap((day) => activeLessonRows(rows, edition, day).map((row) => ({ day, row, kind: marked.get(slotKey(day, row.id)) ?? null })));
}

/**
 * Quick pairs for «רק בשעות…»: the edition's three shifts (settings.rota_shifts, else last year's — «בוקר», «אחר
 * צהריים», «לילה»), clipped to the day; a shift the day does not reach is left out.
 */
export function shiftPresets(edition: Pick<Edition, "settings">, span: { start: number; end: number }): { label: string; from: string; to: string }[] {
  const s = rotaShiftsOf(edition);
  const edges = [DAY_START, s.cuts[0], s.cuts[1], DAY_END];
  const out: { label: string; from: string; to: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const start = Math.max(edges[i], span.start);
    const end = Math.min(edges[i + 1], span.end);
    if (end > start) out.push({ label: s.labels[i], from: clockOf(start), to: clockOf(end) });
  }
  return out;
}
