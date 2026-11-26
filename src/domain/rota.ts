// «תורנויות» (schema v16, docs/CONTRACT.md «תורנויות»): the campus duty roster that runs beside the lessons. The
// week has three shifts a day — last year's own blocks, 06:30–14:30 · 14:30–22:30 · 22:30–06:30 (the night belongs to
// the day before it, as the grid's minutes do) — cut by Sunday's opening and Thursday's close exactly as a grid row is
// (src/grid/layout.ts rowActive). An edition's admin may move the two cuts and rename the shifts (settings.rota_shifts,
// public.set_rota_shifts); the count stays three, so a moved cut never orphans an assignment's shift index.
// `rotaShiftActive` ≡ app.rota_shift_active (tests/sql/rota.test.ts compares them value for value).
import type { RotaAssignment, RotaCohort, RotaData, RotaDuty, RotaGroup, ShiftIndex } from "../data/rota";
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

/**
 * The staff of a shift: the staff shifts of that day whose hours overlap the shift as the week has it (rotaShiftRange)
 * — someone from 14:00 to 22:30 is on the morning and the afternoon, a whole day on every shift; none when the shift is
 * not part of the week. v20: there is no «אחראי/ת משמרת» — every staff shift counts (the lens, the day sheet).
 */
export function staffOn<S extends { day: number; start_min: number; end_min: number }>(edition: WeekEdges, staff: readonly S[], day: Day, shift: ShiftIndex): S[] {
  const r = rotaShiftRange(edition, day, shift);
  if (!r) return [];
  return staff.filter((x) => x.day === day && x.start_min < r.end && x.end_min > r.start);
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

/** v20: the duties the cohort helps in (rota_cohort_duties), by id in the rows' order. */
export function cohortDutyIds(data: Pick<RotaData, "cohortDuties">, cohortId: number): number[] {
  return (data.cohortDuties ?? []).filter((x) => x.cohort_id === cohortId).map((x) => x.duty_id);
}

/**
 * v20 «עוזרת בתורנויות»: the cohort helps in at least one duty. One that does not is still on campus — its presence
 * and its trainees feed the meal counts — but it has no groups (`cohort_not_helping`), so the suggestion never meets it.
 */
export function cohortHelps(data: Pick<RotaData, "cohortDuties">, cohortId: number): boolean {
  return (data.cohortDuties ?? []).some((x) => x.cohort_id === cohortId);
}

/**
 * v20: may this group take this duty — its cohort helps in it. The fair suggestion places a group only there, at every
 * step; a hand-made assignment elsewhere is the `not_eligible` warning. A group whose cohort is gone helps in nothing.
 */
export function groupHelpsIn(data: Pick<RotaData, "cohortDuties">, g: Pick<RotaGroup, "cohort_id">, dutyId: number): boolean {
  return (data.cohortDuties ?? []).some((x) => x.cohort_id === g.cohort_id && x.duty_id === dutyId);
}

/** The groups the suggestion and the fairness look at: those of a cohort that helps in some duty. */
export function helpingGroups<G extends Pick<RotaGroup, "cohort_id">>(data: Pick<RotaData, "cohortDuties"> & { groups: readonly G[] }): G[] {
  return data.groups.filter((g) => cohortHelps(data, g.cohort_id));
}

/** v19 «הצוות שלה יכול להסיע» (absent = no): the transport board names such a cohort — never a phone or a driver. */
export const canDrive = (c: Pick<RotaCohort, "can_drive">): boolean => c.can_drive === true;

/**
 * v20 «חלוקה לקבוצות»: `trainees` split into groups of about `perGroup` — n = ⌈trainees / perGroup⌉ groups, as equal
 * as possible, the larger first (23 by 8 → [8, 8, 7]; 24 by 8 → [8, 8, 8]). The sum is the trainees. Nothing to split
 * (trainees or perGroup not a whole number above 0) → []. A proposal («הצעה»): the screen says so; the sizes are typed.
 */
export function splitSizes(trainees: number, perGroup: number): number[] {
  if (!Number.isInteger(trainees) || !Number.isInteger(perGroup) || trainees <= 0 || perGroup <= 0) return [];
  const n = Math.ceil(trainees / perGroup);
  const base = Math.floor(trainees / n);
  const extra = trainees - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** v20: what a cohort's meals are, from its four numbers — null where something it needs is TBD. */
export interface DietSplit {
  trainees: number | null;
  /** «צמחוני/טבעוני» only: veg − both. */
  veg_only: number | null;
  /** «ללא גלוטן» only: gf − both. */
  gf_only: number | null;
  /** «גם וגם». */
  both: number | null;
  /** The rest: trainees − veg − gf + both. */
  regular: number | null;
}

/** v20: a cohort's meals by diet (the owner's words: «מהם גם וגם» are counted once, as both). */
export function dietSplit(c: Pick<RotaCohort, "trainees" | "diet_veg" | "diet_gf" | "diet_both">): DietSplit {
  const { trainees: t, diet_veg: v, diet_gf: g, diet_both: b } = c;
  return {
    trainees: t,
    veg_only: v != null && b != null ? v - b : null,
    gf_only: g != null && b != null ? g - b : null,
    both: b,
    regular: t != null && v != null && g != null && b != null ? t - v - g + b : null,
  };
}

/** The cohorts' order everywhere they are listed: their `sort`, then the letter, then the id. */
export function byCohortOrder(a: Pick<RotaCohort, "sort" | "letter" | "id">, b: Pick<RotaCohort, "sort" | "letter" | "id">): number {
  return a.sort - b.sort || (a.letter < b.letter ? -1 : a.letter > b.letter ? 1 : 0) || a.id - b.id;
}

/** Is the cohort marked on campus in any shift of the week (no row at all: `presence_unknown`, never assumed). */
export function presenceMarked(data: Pick<RotaData, "presence">, cohortId: number): boolean {
  return data.presence.some((p) => p.cohort_id === cohortId);
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
