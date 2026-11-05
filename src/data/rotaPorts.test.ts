// «תורנויות» in the demo (DemoRota): the shared cases of src/testing/rotaCases.ts — the same table tests/sql/rota.test.ts
// runs on the database — each from ROTA_FIXTURE in a fresh real, live edition (Sunday opens 08:30, Thursday closes
// 19:00), as a logistics member (and the shifts' cases as an edition's admin); then what the cases do not reach: who
// reads and writes, the phones' rule, the cascades, presence, the suggestion's two statements, the demo's seed, the
// purge and the next year. Synthetic only.
import { describe, expect, it } from "vitest";
import { addDays, israelDate } from "../domain/israelTime";
import { rotaSlots } from "../domain/rota";
import { suggestRota } from "../domain/rotaSuggest";
import { assertWeekOnly, PERSONAL_KEYS } from "../offline/snapshot";
import { ROTA_ADMIN_CASES, ROTA_CASES, ROTA_FIXTURE, type RotaCase } from "../testing/rotaCases";
import { CommandError } from "./commands";
import { DemoPort } from "./demoPort";
import type { Actor } from "./engine";
import { LAST_YEAR_DUTIES, type RotaData, type RotaPort } from "./rota";

const LOGISTICS: Actor = { memberId: 5, role: "logistics" };
const EDITION_ADMIN: Actor = { memberId: 1, role: "admin" };
const CONTENT: Actor = { memberId: 2, role: "content" };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${String(e)}`;
  }
};

/** A fresh demo with a new real, live edition (08:30 / 19:00) — empty of any rota — as `actor`. */
async function edition(actor: Actor): Promise<{ port: DemoPort; e: number }> {
  const port = new DemoPort(actor);
  // start_edition is the global admin's — the demo's e-mail is one, whatever the actor its commands run as
  const e = await port.settings.startEdition({ label: "מחזור לדוגמה", start_date: null, first_day_from: 510 });
  const ed = port.engine(e).week.edition;
  expect([ed.kind, ed.status, ed.first_day_from, ed.last_day_until]).toEqual(["real", "planning", 510, 1140]);
  return { port, e };
}

/** ROTA_FIXTURE written through the port; its refs → ids. */
async function fixture(r: RotaPort, e: number): Promise<Map<string, number>> {
  const refs = new Map<string, number>();
  for (const c of ROTA_FIXTURE.cohorts) await r.addCohort(e, { letter: c.letter, name: c.name, diets: [...c.diets], sort: c.sort });
  let d = await r.load(e);
  for (const c of ROTA_FIXTURE.cohorts) refs.set(c.ref, d.cohorts.find((x) => x.letter === c.letter)!.id);
  for (const g of ROTA_FIXTURE.groups) await r.addGroup(e, { cohort_id: refs.get(g.cohort)!, number: g.number, size: g.size, head_name: g.head_name });
  for (const x of ROTA_FIXTURE.duties) {
    const { ref: _ref, ...fields } = x;
    await r.addDuty(e, fields);
  }
  d = await r.load(e);
  for (const g of ROTA_FIXTURE.groups) refs.set(g.ref, d.groups.find((x) => x.cohort_id === refs.get(g.cohort) && x.number === g.number)!.id);
  for (const x of ROTA_FIXTURE.duties) refs.set(x.ref, d.duties.find((y) => y.name === x.name)!.id);
  for (const a of ROTA_FIXTURE.assignments) await r.assign(e, { day: a.day, shift: a.shift, duty_id: refs.get(a.duty)!, group_id: refs.get(a.group)! });
  return refs;
}

/** One case, as DemoRota's method. */
function run(r: RotaPort, e: number, refs: Map<string, number>, c: RotaCase): Promise<unknown> {
  const ref = (x: string) => refs.get(x)!;
  switch (c.op) {
    case "addCohort":
      return r.addCohort(e, c.args);
    case "updateCohort":
      return r.updateCohort(ref(c.ref), c.args);
    case "deleteCohort":
      return r.deleteCohort(ref(c.ref));
    case "addGroup": {
      const { cohort, ...g } = c.args;
      return r.addGroup(e, { ...g, cohort_id: ref(cohort) });
    }
    case "addDuty":
      return r.addDuty(e, c.args);
    case "assign":
      return r.assign(e, { day: c.args.day, shift: c.args.shift, duty_id: ref(c.args.duty), group_id: ref(c.args.group) });
    case "applySuggestion":
      return r.applySuggestion(e, c.args.map((a) => ({ day: a.day, shift: a.shift, duty_id: ref(a.duty), group_id: ref(a.group) })));
    case "addStaffShift": {
      const { cohort, ...s } = c.args;
      return r.addStaffShift(e, { ...s, cohort_id: cohort ? ref(cohort) : null });
    }
    case "addPrepTasks":
      return r.addPrepTasks(e, c.args);
    case "setShifts":
      return r.setShifts(e, c.args);
    case "setContact":
      return r.setContact(ref(c.ref), c.args);
  }
}

describe("the shared cases (src/testing/rotaCases.ts) on the demo", () => {
  for (const c of ROTA_CASES) {
    it(`${c.name} → ${c.expect}`, async () => {
      const { port, e } = await edition(LOGISTICS);
      const refs = await fixture(port.rota, e);
      const before = await port.rota.load(e);
      expect(await code(run(port.rota, e, refs, c))).toBe(c.expect);
      // a refusal changes nothing (an all-or-nothing apply included)
      if (c.expect !== "ok") expect(await port.rota.load(e)).toEqual(before);
    });
  }
  for (const c of ROTA_ADMIN_CASES) {
    it(`as an edition's admin: ${c.name} → ${c.expect}`, async () => {
      const { port, e } = await edition(EDITION_ADMIN);
      const refs = await fixture(port.rota, e);
      const before = structuredClone(port.engine(e).week.edition.settings);
      expect(await code(run(port.rota, e, refs, c))).toBe(c.expect);
      if (c.expect !== "ok") expect(port.engine(e).week.edition.settings).toEqual(before);
    });
  }
});

describe("who reads and who writes", () => {
  it("every member reads; content writes nothing", async () => {
    const content = new DemoPort(CONTENT);
    const c = await edition(CONTENT);
    expect(await code(c.port.rota.load(c.e))).toBe("ok");
    expect(await code(c.port.rota.addCohort(c.e, { letter: "א", name: "מכינה לדוגמה" }))).toBe("forbidden");
    expect(await code(c.port.rota.addDuty(c.e, { name: "מטבח" }))).toBe("forbidden");
    expect(await code(c.port.rota.addPrepTasks(c.e, ["משימה לדוגמה"]))).toBe("forbidden");
    expect(await code(c.port.rota.clearSuggested(c.e))).toBe("forbidden");
    expect(await code(c.port.rota.setPresence(c.e, 1, {}, true))).toBe("forbidden");
    // and on the demo's seeded week: reads, cannot touch a row
    const seeded = await content.rota.load(1);
    expect(seeded.groups).toHaveLength(17);
    expect(await code(content.rota.updateGroup(seeded.groups[0].id, { size: 9 }))).toBe("forbidden");
    expect(await code(content.rota.deleteDuty(seeded.duties[0].id))).toBe("forbidden");
    expect(await code(content.rota.updatePrepTask(seeded.prep[0].id, { done: true }))).toBe("forbidden");
    expect(await code(content.rota.deleteStaffShift(seeded.staff[0].id))).toBe("forbidden");
    expect(await code(content.rota.setShifts(1, null))).toBe("forbidden");
    expect(await content.rota.load(1)).toEqual(seeded);
  });

  it("an edition the member cannot see, or none: not_member to read, forbidden to write", async () => {
    const port = new DemoPort(LOGISTICS);
    expect(await code(port.rota.load(999))).toBe("not_member");
    expect(await code(port.rota.addCohort(999, { letter: "א", name: "מכינה" }))).toBe("forbidden");
    expect(await code(port.rota.setShifts(999, null))).toBe("not_member");
    expect(await port.rota.contacts(999)).toEqual([]);
  });

  it("logistics writes while the edition is live, not once it is archived; its admin still does", async () => {
    const { port, e } = await edition(LOGISTICS);
    await fixture(port.rota, e);
    port.engine(e).week.edition.status = "archived";
    expect(await code(port.rota.addCohort(e, { letter: "ב", name: "מכינה לדוגמה ב" }))).toBe("forbidden");
    const d = await port.rota.load(e);
    expect(await code(port.rota.unassign(d.assignments[0].id))).toBe("forbidden");
    expect(await code(port.rota.updateDuty(d.duties[0].id, { need_night: 2 }))).toBe("forbidden");
    expect(d.cohorts).toHaveLength(2); // still read
    const a = await edition(EDITION_ADMIN);
    a.port.engine(a.e).week.edition.status = "archived";
    expect(await code(a.port.rota.addCohort(a.e, { letter: "ב", name: "מכינה לדוגמה ב" }))).toBe("ok");
    // an archive (the import's kind) is the same: logistics reads only
    const b = await edition(LOGISTICS);
    b.port.engine(b.e).week.edition.kind = "archive";
    expect(await code(b.port.rota.addCohort(b.e, { letter: "ב", name: "מכינה לדוגמה ב" }))).toBe("forbidden");
  });
});

describe("the heads' phones (app.may_see_rota_contacts)", () => {
  it("logistics and the edition's admins of a real, live edition — the phone by itself, never in load()", async () => {
    for (const actor of [LOGISTICS, EDITION_ADMIN]) {
      const { port, e } = await edition(actor);
      const refs = await fixture(port.rota, e);
      await port.rota.setContact(refs.get("G1")!, " 000-000-0001 ");
      expect(await port.rota.contacts(e)).toEqual([{ group_id: refs.get("G1"), head_phone: "000-000-0001" }]);
      expect(JSON.stringify(await port.rota.load(e))).not.toContain("000-000-0001");
      // archived: none — and not set either
      port.engine(e).week.edition.status = "archived";
      expect(await port.rota.contacts(e)).toEqual([]);
      expect(await code(port.rota.setContact(refs.get("G1")!, "000-000-0003"))).toBe("rota_contact_hidden");
    }
  });

  it("a practice or demo week gives none — but to a global admin; content none anywhere", async () => {
    const logistics = new DemoPort(LOGISTICS);
    const g = (await logistics.rota.load(1)).groups[0].id; // the demo's own week: kind «demo»
    expect(await logistics.rota.contacts(1)).toEqual([]);
    expect(await code(logistics.rota.setContact(g, "000-000-0001"))).toBe("rota_contact_hidden");
    const global = new DemoPort();
    const all = await global.rota.contacts(1);
    expect(all).toHaveLength(17);
    expect(new Set(all.map((c) => c.head_phone))).toEqual(new Set(["טלפון לדוגמה"]));
    const content = await edition(CONTENT);
    expect(await content.port.rota.contacts(content.e)).toEqual([]);
    expect(await code(content.port.rota.setContact(1, "000-000-0001"))).toBe("rota_contact_hidden");
  });

  it("blank removes; a bad phone and a group gone are refused", async () => {
    const { port, e } = await edition(LOGISTICS);
    const refs = await fixture(port.rota, e);
    await port.rota.setContact(refs.get("G1")!, "000-000-0001");
    await port.rota.setContact(refs.get("G1")!, "   ");
    expect(await port.rota.contacts(e)).toEqual([]);
    expect(await code(port.rota.setContact(refs.get("G1")!, "12345"))).toBe("bad_phone");
    expect(await code(port.rota.setContact(9999, "000-000-0001"))).toBe("stale");
  });

  it("a head's phone is personal data: PERSONAL_KEYS has it, and a Week carrying one is never written to the device", async () => {
    expect(PERSONAL_KEYS).toContain("head_phone");
    const port = new DemoPort();
    const week = await port.loadWeek(1);
    expect(() => assertWeekOnly(week)).not.toThrow();
    const leak = structuredClone(week);
    leak.roster.push({ id: 99, full_name: "חניך/ה לדוגמה", gender: null, head_phone: "x" } as never);
    expect(() => assertWeekOnly(leak)).toThrow(/personal data at .*head_phone/);
    // nothing load() answers has a personal key, anywhere
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.add(k), walk(x));
    };
    walk(await port.rota.load(1));
    expect(PERSONAL_KEYS.filter((k) => keys.has(k))).toEqual([]);
  });
});

describe("the cascades and the rules between tables", () => {
  it("a group's delete takes its assignments and its head's phone; its preparations keep their text, without it", async () => {
    const { port, e } = await edition(EDITION_ADMIN);
    const refs = await fixture(port.rota, e);
    const g2 = refs.get("G2")!;
    await port.rota.setContact(g2, "000-000-0001");
    await port.rota.addPrepTasks(e, ["משימה לדוגמה"]);
    const task = (await port.rota.load(e)).prep[0];
    await port.rota.updatePrepTask(task.id, { group_id: g2, done: true });
    await port.rota.deleteGroup(g2);
    const d = await port.rota.load(e);
    expect(d.assignments.filter((a) => a.group_id === g2)).toEqual([]);
    expect(d.prep[0]).toMatchObject({ text: "משימה לדוגמה", group_id: null, done: true });
    expect(await port.rota.contacts(e)).toEqual([]);
    expect(port.shared.rotaContacts[g2]).toBeUndefined();
  });

  it("a duty's delete takes its assignments; a cohort's — once it has no groups — its presence and its staff shift", async () => {
    const { port, e } = await edition(LOGISTICS);
    const refs = await fixture(port.rota, e);
    await port.rota.deleteDuty(refs.get("D2")!);
    expect((await port.rota.load(e)).assignments).toEqual([]);
    const n = refs.get("N")!;
    await port.rota.setPresence(e, n, { day: 1 }, true);
    await port.rota.addStaffShift(e, { day: 1, start_min: 510, end_min: 780, member_id: null, name: null, cohort_id: n, kind: "shift", note: null });
    await port.rota.deleteCohort(n);
    const d = await port.rota.load(e);
    expect([d.presence, d.staff, d.cohorts.map((c) => c.letter)]).toEqual([[], [], ["א"]]);
  });

  it("a group, a prep task or a staff shift pointing at a row gone (or another edition's) is stale", async () => {
    const { port, e } = await edition(LOGISTICS);
    const refs = await fixture(port.rota, e);
    expect(await code(port.rota.addGroup(e, { cohort_id: 9999, number: 1 }))).toBe("stale");
    expect(await code(port.rota.assign(e, { day: 2, shift: 0, duty_id: 9999, group_id: refs.get("G1")! }))).toBe("stale");
    expect(await code(port.rota.moveAssignment((await port.rota.load(e)).assignments[0].id, 9999))).toBe("stale");
    expect(await code(port.rota.addStaffShift(e, { day: 1, start_min: 510, end_min: 780, member_id: null, name: null, cohort_id: 9999, kind: "shift", note: null }))).toBe("stale");
    await port.rota.addPrepTasks(e, ["משימה"]);
    expect(await code(port.rota.updatePrepTask((await port.rota.load(e)).prep[0].id, { group_id: 9999 }))).toBe("stale");
    // the demo's own week's group from this edition
    const other = (await port.rota.load(1)).groups[0].id;
    expect(await code(port.rota.assign(e, { day: 2, shift: 0, duty_id: refs.get("D1")!, group_id: other }))).toBe("stale");
  });

  it("an update keeps the unique rules: a letter, a group's number, a duty's name", async () => {
    const { port, e } = await edition(LOGISTICS);
    const refs = await fixture(port.rota, e);
    expect(await code(port.rota.updateCohort(refs.get("N")!, { letter: "א" }))).toBe("rota_letter_taken");
    expect(await code(port.rota.updateCohort(refs.get("N")!, { letter: "ב", name: " מכינה לדוגמה ב " }))).toBe("ok");
    expect(await code(port.rota.updateGroup(refs.get("G2")!, { number: 1 }))).toBe("rota_group_taken");
    expect(await code(port.rota.updateGroup(refs.get("G2")!, { number: 3, head_name: "טל' 1234567" }))).toBe("rota_contact_in_text");
    expect(await code(port.rota.updateDuty(refs.get("D2")!, { name: "מטבח" }))).toBe("rota_duty_exists");
    expect(await code(port.rota.updateDuty(refs.get("D1")!, { name: " מטבח ", need_night: null }))).toBe("ok");
    expect(await code(port.rota.updateCohort(9999, { name: "x" }))).toBe("forbidden");
    const d = await port.rota.load(e);
    expect(d.cohorts.map((c) => [c.letter, c.name])).toEqual([["א", "מכינה לדוגמה א"], ["ב", "מכינה לדוגמה ב"]]);
  });

  it("a staff shift's member: an active member of the edition or of every edition", async () => {
    const { port, e } = await edition(LOGISTICS);
    const s = { day: 1 as const, start_min: 510, end_min: 780, name: "חבר/ת צוות", cohort_id: null, kind: "lead" as const, note: null };
    expect(await code(port.rota.addStaffShift(e, { ...s, member_id: 1 }))).toBe("ok"); // the global admin
    expect(await code(port.rota.addStaffShift(e, { ...s, member_id: 5 }))).toBe("bad_value"); // the demo week's logistics member
    expect(await code(port.rota.addStaffShift(e, { ...s, member_id: 9999 }))).toBe("bad_value");
    const id = (await port.rota.load(e)).staff[0].id;
    expect(await code(port.rota.updateStaffShift(id, { note: "הקפצת מרצה" }))).toBe("ok");
    expect(await code(port.rota.updateStaffShift(id, { start_min: 900 }))).toBe("bad_value"); // after its end
    expect(await code(port.rota.updateStaffShift(id, { name: null }))).toBe("name_required");
    expect((await port.rota.load(e)).staff[0]).toMatchObject({ member_id: 1, name: "חבר/ת צוות", kind: "lead", note: "הקפצת מרצה" });
  });
});

describe("presence", () => {
  it("«כל השבוע» marks every shift the week has, once; «כל היום» and one cell narrow it; absent deletes the scope", async () => {
    const { port, e } = await edition(LOGISTICS);
    const refs = await fixture(port.rota, e);
    const a = refs.get("A")!;
    await port.rota.setPresence(e, a, {}, true);
    await port.rota.setPresence(e, a, {}, true);
    let d = await port.rota.load(e);
    expect(d.presence).toEqual(rotaSlots(port.engine(e).week.edition).map((s) => ({ cohort_id: a, ...s })));
    expect(d.presence).toHaveLength(14); // Thursday night is not part of the week
    await port.rota.setPresence(e, a, { day: 2 }, false);
    await port.rota.setPresence(e, a, { day: 3, shift: 2 }, false);
    d = await port.rota.load(e);
    expect(d.presence).toHaveLength(10);
    expect(d.presence.some((p) => p.day === 2 || (p.day === 3 && p.shift === 2))).toBe(false);
    await port.rota.setPresence(e, a, { day: 4, shift: 2 }, true); // not part of the week: nothing
    expect((await port.rota.load(e)).presence).toHaveLength(10);
    expect(await code(port.rota.setPresence(e, 9999, {}, true))).toBe("stale");
    expect(await code(port.rota.setPresence(e, a, { day: 5 as never }, true))).toBe("bad_value");
  });
});

describe("assignments", () => {
  it("«העברה לכאן» makes a suggested row «hand»; «ניקוי» removes the suggested rows only and says how many", async () => {
    const { port, e } = await edition(LOGISTICS);
    const refs = await fixture(port.rota, e);
    const [g1, g2, d1, d2] = ["G1", "G2", "D1", "D2"].map((x) => refs.get(x)!);
    await port.rota.applySuggestion(e, [
      { day: 2, shift: 0, duty_id: d1, group_id: g1 },
      { day: 2, shift: 1, duty_id: d1, group_id: g2 },
      { day: 3, shift: 0, duty_id: d2, group_id: g1 },
    ]);
    let d = await port.rota.load(e);
    expect(d.assignments.map((a) => a.source)).toEqual(["hand", "suggested", "suggested", "suggested"]);
    const moved = d.assignments.find((a) => a.day === 2 && a.shift === 1)!;
    await port.rota.moveAssignment(moved.id, d2);
    d = await port.rota.load(e);
    expect(d.assignments.find((a) => a.id === moved.id)).toMatchObject({ duty_id: d2, source: "hand" });
    expect(await port.rota.clearSuggested(e)).toBe(2);
    expect(await port.rota.clearSuggested(e)).toBe(0);
    d = await port.rota.load(e);
    expect(d.assignments.map((a) => [a.day, a.shift, a.source])).toEqual([[1, 0, "hand"], [2, 1, "hand"]]);
    await port.rota.unassign(moved.id);
    expect((await port.rota.load(e)).assignments).toHaveLength(1);
    expect(await port.rota.applySuggestion(e, [])).toBeUndefined();
  });

  it("an apply with a row twice in the list, or on a shift the week has not, adds nothing", async () => {
    const { port, e } = await edition(LOGISTICS);
    const refs = await fixture(port.rota, e);
    const [g1, d1, d2] = ["G1", "D1", "D2"].map((x) => refs.get(x)!);
    expect(await code(port.rota.applySuggestion(e, [{ day: 3, shift: 0, duty_id: d1, group_id: g1 }, { day: 3, shift: 0, duty_id: d2, group_id: g1 }]))).toBe("stale");
    expect(await code(port.rota.applySuggestion(e, [{ day: 3, shift: 0, duty_id: d1, group_id: g1 }, { day: 4, shift: 2, duty_id: d1, group_id: g1 }]))).toBe("outside_week");
    expect((await port.rota.load(e)).assignments).toHaveLength(1);
  });

  it("a moved opening: Sunday's morning is no longer the week's — a new row there is refused (an old one stays)", async () => {
    const { port, e } = await edition(LOGISTICS);
    const refs = await fixture(port.rota, e);
    await port.rota.assign(e, { day: 0, shift: 0, duty_id: refs.get("D1")!, group_id: refs.get("G1")! });
    port.engine(e).week.edition.first_day_from = 870;
    expect(await code(port.rota.assign(e, { day: 0, shift: 0, duty_id: refs.get("D1")!, group_id: refs.get("G2")! }))).toBe("outside_week");
    expect((await port.rota.load(e)).assignments).toHaveLength(2);
  });
});

describe("the preparations and the shifts", () => {
  it("a pasted list goes after the last, in order", async () => {
    const { port, e } = await edition(LOGISTICS);
    await port.rota.addPrepTasks(e, ["משימה לדוגמה 1", "משימה לדוגמה 2"]);
    const first = (await port.rota.load(e)).prep;
    await port.rota.updatePrepTask(first[0].id, { sort: 10 });
    await port.rota.addPrepTasks(e, [" משימה לדוגמה 3 "]);
    const d = await port.rota.load(e);
    expect(d.prep.map((t) => [t.text, t.sort])).toEqual([["משימה לדוגמה 2", 2], ["משימה לדוגמה 1", 10], ["משימה לדוגמה 3", 11]]);
    expect(await code(port.rota.updatePrepTask(first[0].id, { sort: 1.5 }))).toBe("bad_value");
    await port.rota.deletePrepTask(first[0].id);
    expect((await port.rota.load(e)).prep).toHaveLength(2);
    expect(await code(port.rota.addPrepTasks(e, []))).toBe("ok");
  });

  it("the shifts' setting is in the edition's settings — the Week shows it; null is last year's again", async () => {
    const { port, e } = await edition(EDITION_ADMIN);
    await port.rota.setShifts(e, { cuts: [840, 1320], labels: [" בוקר ", "צהריים", "לילה"] });
    expect((await port.loadWeek(e)).edition.settings.rota_shifts).toEqual({ cuts: [840, 1320], labels: ["בוקר", "צהריים", "לילה"] });
    await port.rota.setShifts(e, null);
    expect("rota_shifts" in (await port.loadWeek(e)).edition.settings).toBe(false);
  });
});

describe("the demo's seed", () => {
  it("three cohorts «לדוגמה», 6/6/5 groups with heads and a placeholder phone, «נ» on Monday and Tuesday, last year's duties, no assignments", async () => {
    const port = new DemoPort();
    const d: RotaData = await port.rota.load(1);
    expect(d.cohorts.map((c) => [c.letter, c.name])).toEqual([["א", "מכינה לדוגמה א"], ["ב", "מכינה לדוגמה ב"], ["נ", "מכינה לדוגמה נ"]]);
    expect(d.cohorts.map((c) => d.groups.filter((g) => g.cohort_id === c.id).length)).toEqual([6, 6, 5]);
    expect(d.groups.every((g) => g.size != null && g.size >= 6 && g.size <= 10 && /^ראש\/ת קבוצה לדוגמה \d+$/.test(g.head_name ?? ""))).toBe(true);
    const nun = d.cohorts[2].id;
    expect(new Set(d.presence.filter((p) => p.cohort_id === nun).map((p) => p.day))).toEqual(new Set([1, 2]));
    expect(d.presence.filter((p) => p.cohort_id === d.cohorts[0].id)).toHaveLength(14);
    expect(d.duties.map((x) => x.name)).toEqual(LAST_YEAR_DUTIES.map((x) => x.name));
    expect(d.assignments).toEqual([]);
    expect(d.staff.filter((s) => s.kind === "lead")).toHaveLength(1);
    expect(d.staff.map((s) => (s.cohort_id != null ? "cohort" : s.member_id != null ? "member" : "typed")).sort()).toEqual(["cohort", "member", "typed"]);
    expect(d.prep.map((t) => t.text)).toEqual([1, 2, 3, 4].map((i) => `משימת הכנה לדוגמה ${i}`));
    // no digit in a seeded phone (scripts/pii-scan.mjs reads git): «טלפון לדוגמה»
    expect(Object.values(port.shared.rotaContacts).every((p) => p === "טלפון לדוגמה")).toBe(true);
    // the demo opens on «הצעה הוגנת»: it fills the whole week
    const r = suggestRota({ data: d, edition: port.engine(1).week.edition });
    expect([r.add.length, r.unfilled.length]).toEqual([14 * 7, 0]);
    // and applies, as one statement
    await port.rota.applySuggestion(1, r.add);
    expect((await port.rota.load(1)).assignments).toHaveLength(98);
  });
});

describe("after the week and the next year", () => {
  const today = () => israelDate(new Date().toISOString());

  it("the purge deletes the edition's heads' phones (counted and logged), never another edition's, and keeps the rest", async () => {
    const port = new DemoPort();
    const s = port.settings;
    const real = await s.startEdition({ label: "מחזור לדוגמה", start_date: null, first_day_from: 510 });
    const refs = await fixture(port.rota, real);
    await port.rota.setContact(refs.get("G1")!, "000-000-0001");
    await port.rota.setContact(refs.get("G2")!, "000-000-0002");
    port.engine(real).week.edition.start_date = addDays(today(), -5);
    const before = await port.rota.load(real);
    const report = await s.purgeEdition(real, "מחזור לדוגמה");
    expect(report).toMatchObject({ rota_contacts: 2 });
    expect(await port.rota.contacts(real)).toEqual([]);
    expect(await port.rota.load(real)).toEqual(before); // the groups, heads' names, assignments stay
    expect(await port.rota.contacts(1)).toHaveLength(17); // the demo week's untouched
    const log = port.shared.log.filter((x) => x.kind === "purge");
    expect(log.at(-1)?.detail).toMatchObject({ rota_contacts: 2 });
    expect((await s.purgeEdition(real, "מחזור לדוגמה")).rota_contacts).toBe(0);
  });

  it("start_edition carries the duties, the preparations (no group, not done) and the shifts — never cohorts, groups, assignments or staff", async () => {
    const port = new DemoPort();
    const s = port.settings;
    const first = await s.startEdition({ label: "מחזור לדוגמה", start_date: null, first_day_from: 510 });
    const refs = await fixture(port.rota, first);
    await port.rota.updateDuty(refs.get("D1")!, { description: "תיאור לדוגמה", min_people: 12 });
    await port.rota.addPrepTasks(first, ["משימה לדוגמה 1", "משימה לדוגמה 2"]);
    const task = (await port.rota.load(first)).prep[0];
    await port.rota.updatePrepTask(task.id, { group_id: refs.get("G1")!, done: true });
    await port.rota.addStaffShift(first, { day: 1, start_min: 510, end_min: 780, member_id: null, name: "איש/אשת צוות לדוגמה", cohort_id: null, kind: "shift", note: null });
    await port.rota.setShifts(first, { cuts: [840, 1320], labels: ["בוקר", "צהריים", "לילה"] });
    expect(await s.previewStart(true)).toMatchObject({ carry_from: { id: first }, rota_duties: 2, rota_prep_tasks: 2, rota_shifts: true });
    const next = await s.startEdition({ label: "מחזור לדוגמה הבא", start_date: null, first_day_from: 510 });
    const d = await port.rota.load(next);
    const was = await port.rota.load(first);
    expect(d.duties.map(({ id: _i, edition_id: _e, ...x }) => x)).toEqual(was.duties.map(({ id: _i, edition_id: _e, ...x }) => x));
    expect(d.duties.every((x) => x.edition_id === next && !was.duties.some((y) => y.id === x.id))).toBe(true);
    expect(d.prep.map((t) => [t.text, t.group_id, t.done, t.sort])).toEqual([["משימה לדוגמה 1", null, false, 1], ["משימה לדוגמה 2", null, false, 2]]);
    expect([d.cohorts, d.presence, d.groups, d.assignments, d.staff]).toEqual([[], [], [], [], []]);
    expect(port.engine(next).week.edition.settings.rota_shifts).toEqual({ cuts: [840, 1320], labels: ["בוקר", "צהריים", "לילה"] });
    // the first is archived now: what it had stays as it was
    expect(was.groups).toHaveLength(2);
  });

  it("the dry run counts nothing to carry when there is nothing", async () => {
    const port = new DemoPort();
    expect(await port.settings.previewStart(true)).toMatchObject({ carry_from: null, rota_duties: 0, rota_prep_tasks: 0, rota_shifts: false });
    await port.settings.startEdition({ label: "מחזור לדוגמה", start_date: null, first_day_from: 510 });
    expect(await port.settings.previewStart(true)).toMatchObject({ rota_duties: 0, rota_prep_tasks: 0, rota_shifts: false });
  });
});
