// «הצעה הוגנת» (src/domain/rotaSuggest.ts): pure and deterministic; never over what is there, never a cohort off campus,
// never two duties to a group in a shift, every need met while a free group is left — on hand-made cases, on a case
// shaped like last year's (17 groups 6/6/5, «נ» on campus two days, needs 1/1/1/4), and on seeded random rotas.
// Synthetic only: no name, no phone.
import { describe, expect, it } from "vitest";
import { LAST_YEAR_DUTIES, type NewAssignment, type RotaAssignment, type RotaData, type RotaDuty, type ShiftIndex } from "../data/rota";
import { loadsOf, needOf, presentAt, rotaShiftActive, rotaSlots, slotIndex } from "./rota";
import { ROTA_LOAD_TOLERANCE, ROTA_MAX_EXTRA, ROTA_MAX_SWAPS, type RotaSuggestInput, type RotaSuggestion, suggestRota } from "./rotaSuggest";
import type { Day } from "./time";

type Edges = RotaSuggestInput["edition"];
const WEEK: Edges = { first_day_from: 510, last_day_until: 1140, settings: {} };

interface Spec {
  /** A letter, the groups' sizes, the days on campus (all shifts of each; default the whole week). */
  cohorts: { letter: string; sizes: (number | null)[]; days?: number[] }[];
  /** [morning, afternoon, night], and a minimum of people. */
  duties: { need: [number | null, number | null, number | null]; min?: number }[];
  assignments?: { day: number; shift: number; duty: number; group: number; source?: "hand" | "suggested" }[];
  edition?: Edges;
}

/** Ids: cohorts 1…, groups 1… in order (א1 = 1), duties 1…. */
function build(spec: Spec): RotaSuggestInput & { data: RotaData } {
  const edition = spec.edition ?? WEEK;
  const data: RotaData = { cohorts: [], presence: [], groups: [], duties: [], assignments: [], staff: [], prep: [] };
  let gid = 0;
  spec.cohorts.forEach((c, i) => {
    data.cohorts.push({ id: i + 1, edition_id: 1, letter: c.letter, name: `מכינה לדוגמה ${c.letter}`, diets: [], sort: i + 1 });
    for (const s of rotaSlots(edition)) if (!c.days || c.days.includes(s.day)) data.presence.push({ cohort_id: i + 1, day: s.day, shift: s.shift });
    c.sizes.forEach((size, n) => data.groups.push({ id: ++gid, edition_id: 1, cohort_id: i + 1, number: n + 1, size, head_name: null }));
  });
  spec.duties.forEach((d, i) =>
    data.duties.push({ id: i + 1, edition_id: 1, name: `תורנות ${i + 1}`, description: null, need_morning: d.need[0], need_afternoon: d.need[1], need_night: d.need[2], min_people: d.min ?? null, sort: i + 1 }),
  );
  (spec.assignments ?? []).forEach((a, i) =>
    data.assignments.push({ id: i + 1, edition_id: 1, day: a.day as Day, shift: a.shift as ShiftIndex, duty_id: a.duty, group_id: a.group, source: a.source ?? "hand" }),
  );
  return { data, edition };
}

/** Last year's shape: 6/6/5 groups (synthetic sizes), «נ» on campus Monday and Tuesday, the four duties' needs. */
function lastYear(): RotaSuggestInput & { data: RotaData } {
  const sizes = (k: number, from: number) => Array.from({ length: k }, (_, i) => 6 + ((from + i) % 5));
  return build({
    cohorts: [
      { letter: "א", sizes: sizes(6, 0) },
      { letter: "ב", sizes: sizes(6, 6) },
      { letter: "נ", sizes: sizes(5, 12), days: [1, 2] },
    ],
    duties: LAST_YEAR_DUTIES.map((d) => ({ need: [d.need_morning ?? null, d.need_afternoon ?? null, d.need_night ?? null] as [number, number, number] })),
  });
}

type Row = Pick<RotaAssignment, "day" | "shift" | "duty_id" | "group_id">;
const all = (input: RotaSuggestInput, r: RotaSuggestion): Row[] => [...input.data.assignments, ...r.add];
const on = (rows: Row[], day: number, shift: number, duty: number) => rows.filter((a) => a.day === day && a.shift === shift && a.duty_id === duty);

/** Every rule the suggestion holds, whatever the rota. */
function invariants(input: RotaSuggestInput, r: RotaSuggestion): void {
  const { data, edition } = input;
  const rows = all(input, r);
  const groupOf = new Map(data.groups.map((g) => [g.id, g]));
  // one duty per group per shift — what was there and what is added together
  const seen = new Set<string>();
  for (const a of rows) {
    const k = `${a.day}:${a.shift}:${a.group_id}`;
    expect(seen.has(k), `two duties for one group in a shift: ${k}`).toBe(false);
    seen.add(k);
  }
  for (const a of r.add) {
    expect(rotaShiftActive(edition, a.day, a.shift), "a shift the week has").toBe(true);
    expect(presentAt(data, groupOf.get(a.group_id)!.cohort_id, a.day, a.shift), "on campus").toBe(true);
    const need = needOf(data.duties.find((d) => d.id === a.duty_id)!, a.shift);
    expect(need != null && need > 0, "a duty whose need is set").toBe(true);
  }
  for (const s of rotaSlots(edition)) {
    for (const d of data.duties) {
      const need = needOf(d, s.shift);
      const before = on(data.assignments, s.day, s.shift, d.id).length;
      const after = on(rows, s.day, s.shift, d.id).length;
      if (need == null || need === 0) {
        expect(after, "nothing added where the need is not set").toBe(before);
        continue;
      }
      // never more than the need (and the extras for a minimum of people)
      expect(after).toBeLessThanOrEqual(Math.max(before, need + (d.min_people != null ? ROTA_MAX_EXTRA : 0)));
      if (d.min_people == null) expect(after).toBeLessThanOrEqual(Math.max(before, need));
      const u = r.unfilled.find((x) => x.day === s.day && x.shift === s.shift && x.duty_id === d.id);
      if (after >= need) expect(u).toBeUndefined();
      else {
        // short only when no free group on campus was left in that shift
        expect(u?.missing).toBe(need - after);
        const free = data.groups.filter((g) => presentAt(data, g.cohort_id, s.day, s.shift) && !rows.some((a) => a.day === s.day && a.shift === s.shift && a.group_id === g.id));
        expect(free, `a free group left while ${d.name} is short`).toEqual([]);
      }
    }
  }
  expect(r.loads).toEqual(loadsOf(data, rows, edition));
}

/** Every group's distance from its share, times P (exact): shifts × P − present × T; the gap between the extremes, and P. */
function spread(r: RotaSuggestion): { gap: number; P: number } {
  const ls = [...r.loads.values()].filter((l) => l.present > 0);
  const P = ls.reduce((s, l) => s + l.present, 0);
  const T = ls.reduce((s, l) => s + l.shifts, 0);
  const dev = ls.map((l) => l.shifts * P - l.present * T);
  return { gap: Math.max(...dev) - Math.min(...dev), P };
}

const backToBack = (r: RotaSuggestion) => [...r.loads.values()].reduce((s, l) => s + l.backToBack, 0);

/** A deterministic PRNG (mulberry32) — never Math.random. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(xs: readonly T[], rnd: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const shuffle = (input: RotaSuggestInput, seed: number): RotaSuggestInput => {
  const rnd = prng(seed);
  const d = input.data;
  return {
    edition: input.edition,
    data: { cohorts: shuffled(d.cohorts, rnd), presence: shuffled(d.presence, rnd), groups: shuffled(d.groups, rnd), duties: shuffled(d.duties, rnd), assignments: shuffled(d.assignments, rnd) },
  };
};

describe("the constants are «הצעה»", () => {
  it("at most two extra groups for a minimum, a tolerance of one shift, at most 500 moves", () => {
    expect([ROTA_MAX_EXTRA, ROTA_LOAD_TOLERANCE, ROTA_MAX_SWAPS]).toEqual([2, 1, 500]);
  });
});

describe("deterministic", () => {
  it("the same rota twice, and in any order, gives the same suggestion", () => {
    const input = lastYear();
    const r = suggestRota(input);
    expect(suggestRota(input)).toEqual(r);
    for (const seed of [1, 2, 3, 99]) expect(suggestRota(shuffle(input, seed))).toEqual(r);
    // the input is not changed
    expect(input).toEqual(lastYear());
  });
});

describe("never over what is there", () => {
  it("an assignment already there stays, takes its place and counts in the load", () => {
    const input = build({
      cohorts: [{ letter: "א", sizes: [8, 8, 8, 8] }],
      duties: [{ need: [1, 1, 1] }, { need: [1, 1, 1] }],
      assignments: [
        { day: 0, shift: 0, duty: 1, group: 1 },
        { day: 0, shift: 0, duty: 2, group: 2, source: "suggested" },
        { day: 1, shift: 1, duty: 1, group: 3 },
      ],
    });
    const r = suggestRota(input);
    invariants(input, r);
    // Sunday morning is full: nothing added there
    expect(r.add.filter((a) => a.day === 0 && a.shift === 0)).toEqual([]);
    // Monday afternoon: duty 1 has its group; only duty 2 is filled, and never by group 3
    expect(r.add.filter((a) => a.day === 1 && a.shift === 1)).toEqual([expect.objectContaining({ duty_id: 2 })]);
    expect(r.add.some((a) => a.day === 1 && a.shift === 1 && a.group_id === 3)).toBe(false);
    expect(r.loads.get(1)!.shifts).toBe(r.add.filter((a) => a.group_id === 1).length + 1);
  });

  it("a group busy by hand in a shift is never given a second duty there, even when a duty goes short", () => {
    const input = build({ cohorts: [{ letter: "א", sizes: [8, 8] }], duties: [{ need: [1, 1, 1] }, { need: [1, 1, 1] }], assignments: [{ day: 2, shift: 1, duty: 1, group: 1 }] });
    const r = suggestRota(input);
    invariants(input, r);
    expect(r.add.filter((a) => a.day === 2 && a.shift === 1)).toEqual([{ day: 2, shift: 1, duty_id: 2, group_id: 2 }]);
  });
});

describe("presence", () => {
  it("a cohort is given duties only in the shifts it is marked on campus; one never marked, none", () => {
    const input = build({
      cohorts: [
        { letter: "א", sizes: [8, 8, 8] },
        { letter: "נ", sizes: [8, 8], days: [1] },
        { letter: "ג", sizes: [8], days: [] },
      ],
      duties: [{ need: [2, 2, 2] }],
    });
    const r = suggestRota(input);
    invariants(input, r);
    expect(r.add.filter((a) => a.group_id === 4 || a.group_id === 5).every((a) => a.day === 1)).toBe(true);
    expect(r.add.some((a) => a.group_id === 4 || a.group_id === 5)).toBe(true);
    expect(r.add.some((a) => a.group_id === 6)).toBe(false);
    expect(r.loads.get(6)).toMatchObject({ shifts: 0, present: 0 });
  });

  it("only the shifts the week has: none before Sunday's opening, none on Thursday night", () => {
    const input = build({ cohorts: [{ letter: "א", sizes: [8, 8, 8, 8] }], duties: [{ need: [1, 1, 1] }], edition: { first_day_from: 1200, last_day_until: 1140, settings: {} } });
    const r = suggestRota(input);
    invariants(input, r);
    expect(r.add.some((a) => a.day === 0 && a.shift === 0)).toBe(false);
    expect(r.add.some((a) => a.day === 4 && a.shift === 2)).toBe(false);
    expect(r.add).toHaveLength(13); // Sunday afternoon and night, Monday–Wednesday, Thursday morning and afternoon
  });
});

describe("the needs", () => {
  it("one duty per group per shift; a need not set (or 0) is not filled; every need met while groups are free", () => {
    const input = build({ cohorts: [{ letter: "א", sizes: [8, 8, 8, 8, 8, 8] }], duties: [{ need: [2, 1, null] }, { need: [1, 0, 3] }] });
    const r = suggestRota(input);
    invariants(input, r);
    expect(r.unfilled).toEqual([]);
    expect(r.add.filter((a) => a.duty_id === 1 && a.shift === 2)).toEqual([]);
    expect(r.add.filter((a) => a.duty_id === 2 && a.shift === 1)).toEqual([]);
    expect(on(r.add, 3, 2, 2)).toHaveLength(3);
  });

  it("what cannot be filled is reported, by shift and the duties' order", () => {
    const input = build({ cohorts: [{ letter: "א", sizes: [8, 8] }], duties: [{ need: [2, 2, 2] }, { need: [1, 1, 1] }] });
    const r = suggestRota(input);
    invariants(input, r);
    expect(r.unfilled).toHaveLength(14);
    expect(r.unfilled[0]).toEqual({ day: 0, shift: 0, duty_id: 2, missing: 1 });
    // the duty earlier in the order is filled first
    expect(on(r.add, 0, 0, 1)).toHaveLength(2);
  });

  it("the tightest shifts first: a shift with few free groups gets them before a roomier one", () => {
    // «נ» only on Monday: Monday is roomy, the rest tight — every tight shift still filled
    const input = build({ cohorts: [{ letter: "א", sizes: [8, 8] }, { letter: "נ", sizes: [8, 8], days: [1] }], duties: [{ need: [2, 2, 2] }] });
    const r = suggestRota(input);
    invariants(input, r);
    expect(r.unfilled).toEqual([]);
  });
});

describe("the choice", () => {
  it("no two shifts in a row when it can be avoided (four groups, two a shift)", () => {
    const input = build({ cohorts: [{ letter: "א", sizes: [8, 8, 8, 8] }], duties: [{ need: [2, 2, 2] }] });
    const r = suggestRota(input);
    invariants(input, r);
    expect(backToBack(r)).toBe(0);
    expect([...r.loads.values()].map((l) => l.shifts)).toEqual([7, 7, 7, 7]);
  });

  it("a night and the next morning are a pair too: avoided when it can be", () => {
    const input = build({ cohorts: [{ letter: "א", sizes: [8, 8, 8] }], duties: [{ need: [1, 1, 1] }], edition: { first_day_from: 510, last_day_until: 1140, settings: {} } });
    const r = suggestRota(input);
    invariants(input, r);
    expect(backToBack(r)).toBe(0);
    for (let d = 0; d < 4; d++) {
      const night = on(r.add, d, 2, 1)[0].group_id;
      const morning = on(r.add, d + 1, 0, 1)[0].group_id;
      expect(night).not.toBe(morning);
    }
  });

  it("the load per shift on campus: a cohort there two days carries its share, not more", () => {
    const input = build({ cohorts: [{ letter: "א", sizes: [8, 8, 8, 8] }, { letter: "נ", sizes: [8, 8], days: [1, 2] }], duties: [{ need: [2, 2, 2] }] });
    const r = suggestRota(input);
    invariants(input, r);
    const { gap, P } = spread(r);
    expect(gap).toBeLessThanOrEqual(ROTA_LOAD_TOLERANCE * P);
    // «נ» on campus 6 of the 14 shifts: about 6/14 of what «א» does
    const a = r.loads.get(1)!.shifts;
    const n = r.loads.get(5)!.shifts;
    expect(n).toBeLessThan(a);
  });

  it("nights spread: no group does every night", () => {
    const input = build({ cohorts: [{ letter: "א", sizes: [8, 8, 8, 8, 8, 8] }], duties: [{ need: [1, 1, 1] }] });
    const r = suggestRota(input);
    invariants(input, r);
    const nights = [...r.loads.values()].map((l) => l.nights);
    expect(Math.max(...nights) - Math.min(...nights)).toBeLessThanOrEqual(1);
  });

  it("a rotation: the first group is not always «א1»", () => {
    const input = build({ cohorts: [{ letter: "א", sizes: [8, 8, 8, 8, 8, 8, 8] }], duties: [{ need: [1, 1, 1] }] });
    const r = suggestRota(input);
    const firsts = new Set(r.add.map((a) => a.group_id));
    expect(firsts.size).toBe(7);
  });
});

describe("a minimum of people", () => {
  it("the larger groups first, then more groups until it is met — at most two beyond the need", () => {
    const input = build({ cohorts: [{ letter: "א", sizes: [5, 10, 6, 8, 7] }], duties: [{ need: [1, 1, 1], min: 15 }] });
    const r = suggestRota(input);
    invariants(input, r);
    // Sunday morning: all equal so far — the largest (10) and then 8
    expect(on(r.add, 0, 0, 1).map((a) => a.group_id).sort()).toEqual([2, 4]);
    for (const s of rotaSlots(WEEK)) {
      const ids = on(r.add, s.day, s.shift, 1).map((a) => a.group_id);
      const people = ids.reduce((sum, id) => sum + input.data.groups.find((g) => g.id === id)!.size!, 0);
      expect(ids.length).toBeLessThanOrEqual(1 + ROTA_MAX_EXTRA);
      expect(people >= 15 || ids.length === 1 + ROTA_MAX_EXTRA, `${s.day}:${s.shift}`).toBe(true);
    }
  });

  it("stops at two extra groups when the minimum cannot be met; a size TBD counts as none", () => {
    const input = build({ cohorts: [{ letter: "א", sizes: [3, 3, 3, null, 3, 3, 3, 3, 3] }], duties: [{ need: [1, 1, 1], min: 15 }] });
    const r = suggestRota(input);
    invariants(input, r);
    for (const s of rotaSlots(WEEK)) expect(on(r.add, s.day, s.shift, 1)).toHaveLength(3);
    // without a minimum, the need alone
    const plain = build({ cohorts: [{ letter: "א", sizes: [3, 3, 3, 3] }], duties: [{ need: [1, 1, 1] }] });
    expect(suggestRota(plain).add).toHaveLength(14);
  });

  it("a duty with a minimum is filled first in its shift", () => {
    const input = build({ cohorts: [{ letter: "א", sizes: [4, 9, 4] }], duties: [{ need: [1, 1, 1] }, { need: [1, 1, 1], min: 9 }] });
    const r = suggestRota(input);
    invariants(input, r);
    // the 9 goes to the duty with the minimum whenever it is free to
    const nine = r.add.filter((a) => a.group_id === 2);
    expect(nine.every((a) => a.duty_id === 2)).toBe(true);
  });
});

describe("last year's shape (6/6/5 groups, «נ» on campus Monday and Tuesday, needs 1/1/1/4)", () => {
  const input = lastYear();
  const r = suggestRota(input);

  it("fills every shift, holds every rule", () => {
    invariants(input, r);
    expect(r.unfilled).toEqual([]);
    expect(r.add).toHaveLength(14 * 7);
  });

  it("the load per shift on campus within the tolerance: «א»/«ב» 6–7 shifts, «נ» about 3", () => {
    const { gap, P } = spread(r);
    expect(gap).toBeLessThanOrEqual(ROTA_LOAD_TOLERANCE * P);
    const shifts = (cohort: number) => input.data.groups.filter((g) => g.cohort_id === cohort).map((g) => r.loads.get(g.id)!.shifts);
    for (const n of [...shifts(1), ...shifts(2)]) expect(n === 6 || n === 7).toBe(true);
    for (const n of shifts(3)) expect(n).toBe(3);
  });

  it("no group does one duty more than ceil(mean) + 1 times", () => {
    for (const d of input.data.duties) {
      const counts = [...r.loads.values()].map((l) => l.byDuty.get(d.id) ?? 0);
      const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
      expect(Math.max(...counts), d.name).toBeLessThanOrEqual(Math.ceil(mean) + 1);
    }
  });

  it("two shifts in a row only where twelve groups cannot fill fourteen places: none from Sunday night to Tuesday night", () => {
    const rows = all(input, r);
    const slots = rotaSlots(input.edition);
    let bound = 0;
    for (let i = 1; i < slots.length; i++) {
      const [a, b] = [slots[i - 1], slots[i]];
      const groupsIn = (s: { day: Day; shift: ShiftIndex }) => new Set(rows.filter((x) => x.day === s.day && x.shift === s.shift).map((x) => x.group_id));
      const [A, B] = [groupsIn(a), groupsIn(b)];
      const pairs = [...B].filter((g) => A.has(g)).length;
      const union = input.data.groups.filter((g) => presentAt(input.data, g.cohort_id, a.day, a.shift) || presentAt(input.data, g.cohort_id, b.day, b.shift)).length;
      bound += Math.max(0, 14 - union); // 7 + 7 places, `union` groups to fill them
      if (slotIndex(a.day, a.shift) >= slotIndex(0, 2) && slotIndex(b.day, b.shift) <= slotIndex(2, 2)) expect(pairs, `${a.day}:${a.shift}→${b.day}:${b.shift}`).toBe(0);
    }
    expect(bound).toBe(12);
    expect(backToBack(r)).toBeLessThanOrEqual(bound + 2);
  });
});

describe("seeded random rotas", () => {
  /** A random rota: 1–3 cohorts of 1–6 groups (some sizes TBD), presence whole / partial / none, 1–4 duties, some already assigned. */
  function random(seed: number): RotaSuggestInput & { data: RotaData } {
    const rnd = prng(seed);
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
    const edition: Edges = { first_day_from: pick([null, 510, 870, 1200]), last_day_until: pick([870, 1140, 1440]), settings: rnd() < 0.2 ? { rota_shifts: { cuts: [840, 1320], labels: ["א", "ב", "ג"] } } : {} };
    const cohorts = Array.from({ length: int(1, 3) }, (_, i) => ({
      letter: "אבג"[i],
      sizes: Array.from({ length: int(1, 6) }, () => (rnd() < 0.15 ? null : int(3, 12))),
      days: rnd() < 0.5 ? undefined : [0, 1, 2, 3, 4].filter(() => rnd() < 0.5),
    }));
    const need = () => (rnd() < 0.15 ? null : int(0, 3));
    const duties: Spec["duties"] = Array.from({ length: int(1, 4) }, () => ({ need: [need(), need(), need()], ...(rnd() < 0.25 ? { min: int(5, 30) } : {}) }));
    const built = build({ cohorts, duties, edition });
    // some assignments already there: by hand or an earlier suggestion — on campus or not, even on a shift the week no longer has
    const taken = new Set<string>();
    const groups = built.data.groups.length;
    for (let i = 0; i < int(0, 12); i++) {
      const a = { day: int(0, 4), shift: int(0, 2), duty: int(1, duties.length), group: int(1, groups) };
      const k = `${a.day}:${a.shift}:${a.group}`;
      if (taken.has(k)) continue;
      taken.add(k);
      built.data.assignments.push({ id: built.data.assignments.length + 1, edition_id: 1, day: a.day as Day, shift: a.shift as ShiftIndex, duty_id: a.duty, group_id: a.group, source: rnd() < 0.5 ? "hand" : "suggested" });
    }
    return built;
  }

  it("hold every rule on 300 seeded rotas, and answer the same in any order", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const input = random(seed);
      const r = suggestRota(input);
      invariants(input, r);
      expect(suggestRota(shuffle(input, seed + 1000)), `seed ${seed}`).toEqual(r);
      // the existing rows are never part of what is added
      const existing = new Set(input.data.assignments.map((a) => `${a.day}:${a.shift}:${a.group_id}`));
      expect(r.add.filter((a: NewAssignment) => existing.has(`${a.day}:${a.shift}:${a.group_id}`)), `seed ${seed}`).toEqual([]);
    }
  });

  it("a duty with no need anywhere adds nothing for it", () => {
    const duty: RotaDuty = { id: 9, edition_id: 1, name: "תורנות", description: null, need_morning: null, need_afternoon: null, need_night: null, min_people: null, sort: 1 };
    const input = build({ cohorts: [{ letter: "א", sizes: [8] }], duties: [] });
    input.data.duties.push(duty);
    const r = suggestRota(input);
    expect(r.add).toEqual([]);
    expect(r.unfilled).toEqual([]);
  });
});
