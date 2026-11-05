// «הצעה הוגנת» (DECISIONS «תורנויות — גרסה 16»; the plan's «ההצעה ההוגנת»): which group does which duty in each shift
// still empty, fairly. Pure and deterministic — no randomness, no clock; every input is sorted first, so the same rota
// in any order gives the same suggestion.
//
// It never touches an assignment already there (it counts in the loads and takes its place), never puts a group in a
// shift its cohort is not marked on campus in, never two duties to one group in one shift, and never fills a duty in a
// shift whose need is not set. The tightest shifts first (the fewest free groups for what they need), then by time;
// within a shift the duties with a minimum of people first, then by their order. A group is chosen by, in this order:
//   1. no shift right before or after it (a night and the morning after it are neighbours, as every two shifts in a row);
//   2. the fewest shifts per shift its cohort is on campus («הצעה»: a cohort there for part of the week is not loaded
//      more on its days) — compared exactly, by integer cross-multiplication;
//   3. in a night shift, the fewest nights;
//   4. the fewest times on this duty;
//   5. with a minimum of people, the larger group (one whose size is TBD last);
//   6. a rotation: each shift starts from another group, so it is not always «א1» first.
// With a minimum of people, more groups join (at most ROTA_MAX_EXTRA beyond the need, «הצעה») until it is reached — a
// size TBD counts as none. Then a polish of at most ROTA_MAX_SWAPS moves: a suggested row moves from a group loaded more
// than its share to one loaded less, while their gap is above ROTA_LOAD_TOLERANCE shifts («הצעה»); then a suggested night
// of a group two or more nights above another changes places with a suggested day shift of that other (the loads stay).
// No move makes a new pair of shifts in a row or takes a duty under its minimum; never an assignment that was there.
import type { NewAssignment, RotaCohort, RotaData, RotaDuty, RotaGroup, ShiftIndex } from "../data/rota";
import { type GroupLoad, loadsOf, needOf, rotaSlots, slotIndex, type RotaSlot } from "./rota";
import type { Day } from "./time";
import type { Edition } from "./types";

/** At most this many groups beyond a duty's need, to reach its minimum of people («הצעה»). */
export const ROTA_MAX_EXTRA = 2;
/** The polish stops once no two groups are more than this many shifts apart from their shares («הצעה»). */
export const ROTA_LOAD_TOLERANCE = 1;
/** The polish makes at most this many moves and night swaps together. */
export const ROTA_MAX_SWAPS = 500;

export interface RotaSuggestInput {
  data: Pick<RotaData, "cohorts" | "presence" | "groups" | "duties" | "assignments">;
  edition: Pick<Edition, "first_day_from" | "last_day_until" | "settings">;
}

/** A duty in a shift that could not get all the groups it needs: `missing` groups short. */
export interface RotaUnfilled {
  day: Day;
  shift: ShiftIndex;
  duty_id: number;
  missing: number;
}

export interface RotaSuggestion {
  /** The rows to add («suggested»), by day, shift, duty, group. */
  add: NewAssignment[];
  /** What it could not fill, by day, shift and the duties' order. */
  unfilled: RotaUnfilled[];
  /** Every group's load with the suggestion added (loadsOf). */
  loads: Map<number, GroupLoad>;
}

interface G {
  g: RotaGroup;
  /** Its place in the canonical order (cohort by sort, letter, id; then number, id). */
  pos: number;
  /** Shifts its cohort is on campus (the week's shifts only). */
  present: number;
  shifts: number;
  nights: number;
  byDuty: Map<number, number>;
  /** slotIndex → busy (any assignment, the week's or not). */
  busy: Set<number>;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function suggestRota(input: RotaSuggestInput): RotaSuggestion {
  const { data, edition } = input;
  const cohorts = [...data.cohorts].sort((a: RotaCohort, b: RotaCohort) => a.sort - b.sort || cmpStr(a.letter, b.letter) || a.id - b.id);
  const cohortRank = new Map(cohorts.map((c, i) => [c.id, i]));
  const groups = [...data.groups].sort(
    (a, b) => (cohortRank.get(a.cohort_id) ?? cohorts.length) - (cohortRank.get(b.cohort_id) ?? cohorts.length) || a.number - b.number || a.id - b.id,
  );
  const duties = [...data.duties].sort((a, b) => Number(a.min_people == null) - Number(b.min_people == null) || a.sort - b.sort || a.id - b.id);
  const dutyRank = new Map(duties.map((d, i) => [d.id, i]));
  const slots = rotaSlots(edition);
  const here = new Set(data.presence.map((p) => `${p.cohort_id}:${p.day}:${p.shift}`));
  const presentAt = (g: RotaGroup, s: RotaSlot) => here.has(`${g.cohort_id}:${s.day}:${s.shift}`);
  const n = groups.length;

  const state = new Map<number, G>();
  groups.forEach((g, pos) => state.set(g.id, { g, pos, present: slots.filter((s) => presentAt(g, s)).length, shifts: 0, nights: 0, byDuty: new Map(), busy: new Set() }));
  /** (slot, duty) → the groups on it. */
  const cell = new Map<string, number[]>();
  const cellKey = (idx: number, duty: number) => `${idx}:${duty}`;
  const take = (st: G, idx: number, shift: number, duty: number) => {
    st.shifts++;
    if (shift === 2) st.nights++;
    st.byDuty.set(duty, (st.byDuty.get(duty) ?? 0) + 1);
    st.busy.add(idx);
    const k = cellKey(idx, duty);
    cell.set(k, [...(cell.get(k) ?? []), st.g.id]);
  };
  const drop = (st: G, idx: number, shift: number, duty: number) => {
    st.shifts--;
    if (shift === 2) st.nights--;
    st.byDuty.set(duty, (st.byDuty.get(duty) ?? 0) - 1);
    st.busy.delete(idx);
    const k = cellKey(idx, duty);
    cell.set(k, (cell.get(k) ?? []).filter((id) => id !== st.g.id));
  };
  // what is there already: its loads, its places — never touched
  const existing = [...data.assignments].sort((a, b) => a.day - b.day || a.shift - b.shift || a.duty_id - b.duty_id || a.group_id - b.group_id);
  for (const a of existing) {
    const st = state.get(a.group_id);
    if (st) take(st, slotIndex(a.day, a.shift), a.shift, a.duty_id);
  }

  const adjacentBusy = (st: G, idx: number) => Number(st.busy.has(idx - 1)) + Number(st.busy.has(idx + 1));
  const free = (st: G, s: RotaSlot) => st.present > 0 && presentAt(st.g, s) && !st.busy.has(slotIndex(s.day, s.shift));
  const people = (ids: number[]) => ids.reduce((sum, id) => sum + (state.get(id)?.g.size ?? 0), 0);
  const needs = (s: RotaSlot) =>
    duties
      .map((d) => ({ d, need: needOf(d, s.shift) }))
      .filter((x): x is { d: RotaDuty; need: number } => x.need != null && x.need > 0);

  // the tightest shifts first: the fewest free groups for what is still needed, then by time
  const ordinal = new Map(slots.map((s, i) => [slotIndex(s.day, s.shift), i]));
  const slack = (s: RotaSlot) => {
    const idx = slotIndex(s.day, s.shift);
    const open = [...state.values()].filter((st) => free(st, s)).length;
    const wanted = needs(s).reduce((sum, { d, need }) => sum + Math.max(0, need - (cell.get(cellKey(idx, d.id))?.length ?? 0)), 0);
    return open - wanted;
  };
  const order = slots.map((s) => ({ s, slack: slack(s) })).sort((a, b) => a.slack - b.slack || slotIndex(a.s.day, a.s.shift) - slotIndex(b.s.day, b.s.shift));

  const added: { st: G; s: RotaSlot; duty: number }[] = [];
  const unfilled: RotaUnfilled[] = [];
  for (const { s } of order) {
    const idx = slotIndex(s.day, s.shift);
    const offset = n === 0 ? 0 : (ordinal.get(idx) ?? 0) % n;
    for (const { d, need } of needs(s)) {
      const on = () => cell.get(cellKey(idx, d.id)) ?? [];
      const candidates = [...state.values()]
        .filter((st) => free(st, s))
        .sort(
          (a, b) =>
            adjacentBusy(a, idx) - adjacentBusy(b, idx) ||
            a.shifts * b.present - b.shifts * a.present ||
            (s.shift === 2 ? a.nights - b.nights : 0) ||
            (a.byDuty.get(d.id) ?? 0) - (b.byDuty.get(d.id) ?? 0) ||
            (d.min_people != null ? (b.g.size ?? -1) - (a.g.size ?? -1) : 0) ||
            ((a.pos - offset + n) % n) - ((b.pos - offset + n) % n),
        );
      let i = 0;
      const pick = () => {
        const st = candidates[i++];
        take(st, idx, s.shift, d.id);
        added.push({ st, s, duty: d.id });
      };
      while (on().length < need && i < candidates.length) pick();
      if (on().length < need) unfilled.push({ day: s.day, shift: s.shift, duty_id: d.id, missing: need - on().length });
      if (d.min_people != null) while (people(on()) < d.min_people && on().length < need + ROTA_MAX_EXTRA && i < candidates.length) pick();
    }
  }

  // the polish: a suggested row moves from a group above its share to one below, while they are more than the tolerance apart
  const fair = [...state.values()].filter((st) => st.present > 0);
  const P = fair.reduce((sum, st) => sum + st.present, 0);
  const T = fair.reduce((sum, st) => sum + st.shifts, 0);
  /** A group's distance from its share, times P (exact): shifts × P − present × T. */
  const dev = (st: G) => st.shifts * P - st.present * T;
  const dutyOf = new Map(duties.map((d) => [d.id, d]));
  let swaps = 0;
  while (swaps < ROTA_MAX_SWAPS && P > 0) {
    const byDev = [...fair].sort((a, b) => dev(b) - dev(a) || a.pos - b.pos);
    let moved = false;
    search: for (const a of byDev) {
      for (const b of [...byDev].reverse()) {
        if (dev(a) - dev(b) <= ROTA_LOAD_TOLERANCE * P) break;
        const rows = added
          .filter((r) => r.st === a)
          .sort(
            (x, y) =>
              (b.byDuty.get(x.duty) ?? 0) - (a.byDuty.get(x.duty) ?? 0) - ((b.byDuty.get(y.duty) ?? 0) - (a.byDuty.get(y.duty) ?? 0)) ||
              (x.s.shift === 2 ? b.nights - a.nights : 0) - (y.s.shift === 2 ? b.nights - a.nights : 0) ||
              slotIndex(x.s.day, x.s.shift) - slotIndex(y.s.day, y.s.shift) ||
              (dutyRank.get(x.duty) ?? 0) - (dutyRank.get(y.duty) ?? 0),
          );
        for (const r of rows) {
          const idx = slotIndex(r.s.day, r.s.shift);
          if (!free(b, r.s)) continue;
          if (adjacentBusy(b, idx) > adjacentBusy(a, idx)) continue; // never a new pair of shifts in a row
          const d = dutyOf.get(r.duty);
          if (d?.min_people != null) {
            const before = people(cell.get(cellKey(idx, r.duty)) ?? []);
            if (before - (a.g.size ?? 0) + (b.g.size ?? 0) < Math.min(d.min_people, before)) continue;
          }
          drop(a, idx, r.s.shift, r.duty);
          take(b, idx, r.s.shift, r.duty);
          r.st = b;
          moved = true;
          break search;
        }
      }
    }
    if (!moved) break;
    swaps++;
  }

  // and the nights: a suggested night of a group with more nights changes places with a suggested day shift of one with
  // fewer (two or more apart) — the loads stay as they are, no new pair in a row, no duty under its minimum
  const pairsOf = (st: G) => [...st.busy].filter((idx) => st.busy.has(idx + 1)).length;
  const keepsMin = (idx: number, duty: number, out: G, inn: G) => {
    const d = dutyOf.get(duty);
    if (d?.min_people == null) return true;
    const before = people(cell.get(cellKey(idx, duty)) ?? []);
    return before - (out.g.size ?? 0) + (inn.g.size ?? 0) >= Math.min(d.min_people, before);
  };
  for (; swaps < ROTA_MAX_SWAPS; swaps++) {
    const byNights = [...fair].sort((a, b) => b.nights - a.nights || a.pos - b.pos);
    let moved = false;
    search: for (const a of byNights) {
      for (const b of [...byNights].reverse()) {
        if (a.nights - b.nights < 2) break;
        const nights = added.filter((r) => r.st === a && r.s.shift === 2);
        const days = added.filter((r) => r.st === b && r.s.shift !== 2);
        for (const r1 of nights) {
          for (const r2 of [...days].sort((x, y) => Number(x.duty !== r1.duty) - Number(y.duty !== r1.duty))) {
            const [i1, i2] = [slotIndex(r1.s.day, r1.s.shift), slotIndex(r2.s.day, r2.s.shift)];
            if (!presentAt(b.g, r1.s) || b.busy.has(i1) || !presentAt(a.g, r2.s) || a.busy.has(i2)) continue;
            if (!keepsMin(i1, r1.duty, a, b) || !keepsMin(i2, r2.duty, b, a)) continue;
            const [pa, pb] = [pairsOf(a), pairsOf(b)];
            drop(a, i1, 2, r1.duty);
            drop(b, i2, r2.s.shift, r2.duty);
            take(a, i2, r2.s.shift, r2.duty);
            take(b, i1, 2, r1.duty);
            if (pairsOf(a) > pa || pairsOf(b) > pb) {
              drop(a, i2, r2.s.shift, r2.duty);
              drop(b, i1, 2, r1.duty);
              take(a, i1, 2, r1.duty);
              take(b, i2, r2.s.shift, r2.duty);
              continue;
            }
            [r1.st, r2.st] = [b, a];
            moved = true;
            break search;
          }
        }
      }
    }
    if (!moved) break;
  }

  const add: NewAssignment[] = added
    .map(({ st, s, duty }) => ({ day: s.day, shift: s.shift, duty_id: duty, group_id: st.g.id }))
    .sort((a, b) => a.day - b.day || a.shift - b.shift || (dutyRank.get(a.duty_id) ?? 0) - (dutyRank.get(b.duty_id) ?? 0) || a.group_id - b.group_id);
  unfilled.sort((a, b) => a.day - b.day || a.shift - b.shift || (dutyRank.get(a.duty_id) ?? 0) - (dutyRank.get(b.duty_id) ?? 0));
  return { add, unfilled, loads: loadsOf(data, [...data.assignments, ...add], edition) };
}
