// «תורנויות» (schema v16, docs/CONTRACT.md «תורנויות»): the campus duty roster that runs beside the lessons. The
// week has three shifts a day — last year's own blocks, 06:30–14:30 · 14:30–22:30 · 22:30–06:30 (the night belongs to
// the day before it, as the grid's minutes do) — cut by Sunday's opening and Thursday's close exactly as a grid row is
// (src/grid/layout.ts rowActive). An edition's admin may move the two cuts and rename the shifts (settings.rota_shifts,
// public.set_rota_shifts); the count stays three, so a moved cut never orphans an assignment's shift index.
// `rotaShiftActive` ≡ app.rota_shift_active (tests/sql/rota.test.ts compares them value for value).
import type { RotaAssignment, RotaData, RotaDuty, RotaGroup, ShiftIndex } from "../data/rota";
import { DAY_END, DAY_START, type Day } from "./time";
import type { Edition, RotaShiftsSetting } from "./types";

export const SHIFTS: readonly ShiftIndex[] = [0, 1, 2];
export const ROTA_DAYS: readonly Day[] = [0, 1, 2, 3, 4];

/** Last year's shifts (the logistics workbook of 5786) and the instructor's own names for them («בוקר/אחר צהריים/לילה»). */
export const DEFAULT_ROTA_SHIFTS: RotaShiftsSetting = { cuts: [870, 1350], labels: ["בוקר", "אחר צהריים", "לילה"] };

/** The edition's shifts: its own setting, else last year's. */
export function rotaShiftsOf(edition: Pick<Edition, "settings">): RotaShiftsSetting {
  const s = edition.settings?.rota_shifts;
  return s && Array.isArray(s.cuts) && Array.isArray(s.labels) ? s : DEFAULT_ROTA_SHIFTS;
}

/** A shift's whole block, before the week's opening and close cut it: [from, to) in the day's minutes (390–1830). */
export function shiftBounds(s: RotaShiftsSetting, shift: ShiftIndex): { from: number; to: number } {
  const edges = [DAY_START, s.cuts[0], s.cuts[1], DAY_END];
  return { from: edges[shift], to: edges[shift + 1] };
}

type WeekEdges = Pick<Edition, "first_day_from" | "last_day_until" | "settings">;

/**
 * Is this shift part of the week — rowActive's rule on the shift's block: on Sunday it must end after the opening
 * (first_day_from; unknown = it is), on Thursday it must begin before the close (last_day_until). ≡ app.rota_shift_active.
 */
export function rotaShiftActive(edition: WeekEdges, day: Day, shift: ShiftIndex): boolean {
  const { from, to } = shiftBounds(rotaShiftsOf(edition), shift);
  if (day === 0 && edition.first_day_from != null && to <= edition.first_day_from) return false;
  if (day === 4 && from >= edition.last_day_until) return false;
  return true;
}

/** The shift as the week has it: its block cut by Sunday's opening and Thursday's close; null when it is not part of the week. */
export function rotaShiftRange(edition: WeekEdges, day: Day, shift: ShiftIndex): { start: number; end: number } | null {
  if (!rotaShiftActive(edition, day, shift)) return null;
  const { from, to } = shiftBounds(rotaShiftsOf(edition), shift);
  const start = day === 0 && edition.first_day_from != null ? Math.max(from, edition.first_day_from) : from;
  const end = day === 4 ? Math.min(to, edition.last_day_until) : to;
  return { start, end };
}

export interface RotaSlot {
  day: Day;
  shift: ShiftIndex;
}

/** Every shift of the week, in time order (Sunday morning first; Thursday has no night when the week closes at 19:00). */
export function rotaSlots(edition: WeekEdges): RotaSlot[] {
  return ROTA_DAYS.flatMap((day) => SHIFTS.filter((shift) => rotaShiftActive(edition, day, shift)).map((shift) => ({ day, shift })));
}

/** A shift's place in the week: a night and the next morning are neighbours (day×3+shift differ by one). */
export const slotIndex = (day: number, shift: number) => day * 3 + shift;

/** Two shifts one right after the other (a night, then the morning after it). */
export function adjacent(a: RotaSlot, b: RotaSlot): boolean {
  return Math.abs(slotIndex(a.day, a.shift) - slotIndex(b.day, b.shift)) === 1;
}

export const slotKey = (day: number, shift: number) => `${day}:${shift}`;

/** A group's code as the sheets write it: its cohort's letter and its number («א1», «נ5»). */
export function groupCode(letter: string, number: number): string {
  return `${letter}${number}`;
}

/** A group's code in the loaded data (TBD when its cohort is gone — never happens: a cohort with groups is not deleted). */
export function codeOf(data: Pick<RotaData, "cohorts">, g: Pick<RotaGroup, "cohort_id" | "number">): string {
  const c = data.cohorts.find((x) => x.id === g.cohort_id);
  return c ? groupCode(c.letter, g.number) : `?${g.number}`;
}

/** Is the cohort marked on campus in this shift (no row = not marked: never assumed). */
export function presentAt(data: Pick<RotaData, "presence">, cohortId: number, day: number, shift: number): boolean {
  return data.presence.some((p) => p.cohort_id === cohortId && p.day === day && p.shift === shift);
}

/** How many groups a duty needs in a shift (null: not set — the suggestion leaves it, a warning says so). */
export function needOf(duty: Pick<RotaDuty, "need_morning" | "need_afternoon" | "need_night">, shift: ShiftIndex): number | null {
  return shift === 0 ? duty.need_morning : shift === 1 ? duty.need_afternoon : duty.need_night;
}

export interface GroupLoad {
  /** Shifts with a duty. */
  shifts: number;
  /** Of them, night shifts. */
  nights: number;
  /** duty id → how many times. */
  byDuty: Map<number, number>;
  /** Shifts its cohort is marked on campus (the fairness is per shift present). */
  present: number;
  /** Pairs of its duties one right after the other. */
  backToBack: number;
}

/** Each group's load over the given assignments (all of them, or with a suggestion added). */
export function loadsOf(data: Pick<RotaData, "groups" | "presence">, assignments: readonly Pick<RotaAssignment, "day" | "shift" | "duty_id" | "group_id">[], edition: WeekEdges): Map<number, GroupLoad> {
  const slots = rotaSlots(edition);
  const out = new Map<number, GroupLoad>();
  for (const g of data.groups) {
    const mine = assignments.filter((a) => a.group_id === g.id).sort((a, b) => slotIndex(a.day, a.shift) - slotIndex(b.day, b.shift));
    const byDuty = new Map<number, number>();
    for (const a of mine) byDuty.set(a.duty_id, (byDuty.get(a.duty_id) ?? 0) + 1);
    let backToBack = 0;
    for (let i = 1; i < mine.length; i++) if (adjacent(mine[i - 1], mine[i])) backToBack++;
    out.set(g.id, {
      shifts: mine.length,
      nights: mine.filter((a) => a.shift === 2).length,
      byDuty,
      present: slots.filter((s) => presentAt(data, g.cohort_id, s.day, s.shift)).length,
      backToBack,
    });
  }
  return out;
}
