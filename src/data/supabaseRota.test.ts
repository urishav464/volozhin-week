// SupabaseRota on the wire: the real supabase-js client, a stub fetch in place of PostgREST. tests/sql/rota.test.ts
// proves the database and src/data/rotaPorts.test.ts the demo; this proves the real port sends each write as the
// contract's statement (one insert for an apply, one delete for «ניקוי», one insert for «כל השבוע»), cleans it first,
// and reads every answer and refusal right. Synthetic only.
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { CommandError } from "./commands";
import { SupabaseRota } from "./supabaseRota";

interface Sent {
  method: string;
  path: string;
  query: URLSearchParams;
  prefer: string;
  body: unknown;
}

/** One answer per request, in order: [status, JSON body]. */
function port(answers: [number, unknown][]) {
  const sent: Sent[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const u = new URL(req.url);
    const text = await req.text();
    sent.push({ method: req.method, path: u.pathname.replace("/rest/v1/", ""), query: u.searchParams, prefer: req.headers.get("prefer") ?? "", body: text ? JSON.parse(text) : null });
    const [status, body] = answers.shift() ?? [404, {}];
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  const sb = createClient("https://stub.supabase.co", "stub-publishable-key", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch } });
  return { r: new SupabaseRota(sb), sent };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${String(e)}`;
  }
};

const pg = (c: string, message = "x") => [400, { code: c, message, details: null, hint: null }] as [number, unknown];
const row = [201, [{ id: 1 }]] as [number, unknown];
const q = (s: Sent) => Object.fromEntries(s.query.entries());

describe("SupabaseRota: reading", () => {
  it("load_rota by its parameter name; the answer as the port's types (numbers, exactly their keys — a stray key never passes)", async () => {
    const { r, sent } = port([
      [
        200,
        {
          cohorts: [
            {
              id: "3", edition_id: "7", letter: "א", name: "מכינה לדוגמה א", trainees: "23", diet_veg: 4, diet_gf: "3", diet_both: 2, contact_name: "איש/אשת קשר לדוגמה", sort: 1,
              can_drive: true, helps_rota: false, diets: [{ label: "צמחוני", count: 2 }], // v19's keys, if a stale answer had them: never passed on
            },
            { id: "4", edition_id: "7", letter: "ב", name: "מכינה לדוגמה ב", sort: 2 }, // the numbers absent: TBD; can_drive absent: the column's default
          ],
          cohortDuties: [{ cohort_id: "3", duty_id: "5", edition_id: 7 }],
          presence: [{ edition_id: 7, cohort_id: "3", day: 1, shift: 0 }],
          groups: [{ id: "11", edition_id: "7", cohort_id: "3", number: 1, size: null, head_name: "ראש/ת קבוצה לדוגמה", head_phone: "000-000-0001" }],
          duties: [{ id: "5", edition_id: "7", name: "מטבח", description: null, need_morning: 1, need_afternoon: null, need_night: 1, min_people: null, sort: 1, name_key: "מטבח" }],
          assignments: [{ id: "9", edition_id: "7", day: 1, shift: 0, duty_id: "5", group_id: "11", source: "suggested" }],
          staff: [{ id: "2", edition_id: "7", day: 0, start_min: 510, end_min: 870, member_id: "4", name: "חבר/ת צוות לדוגמה", cohort_id: null, kind: "lead", note: null }], // v19's kind: dropped
          prep: [
            { id: "8", edition_id: "7", text: "משימה לדוגמה", group_id: null, done: false, sort: 1 }, // before v19: a task
            { id: "9", edition_id: "7", text: "פריט לדוגמה", group_id: null, done: true, sort: 2, kind: "item", qty: "2 (לדוגמה)" },
          ],
        },
      ],
      [200, null],
    ]);
    const d = await r.load(7);
    expect(d).toEqual({
      cohorts: [
        { id: 3, edition_id: 7, letter: "א", name: "מכינה לדוגמה א", trainees: 23, diet_veg: 4, diet_gf: 3, diet_both: 2, contact_name: "איש/אשת קשר לדוגמה", sort: 1, can_drive: true },
        { id: 4, edition_id: 7, letter: "ב", name: "מכינה לדוגמה ב", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 2, can_drive: false },
      ],
      cohortDuties: [{ cohort_id: 3, duty_id: 5 }],
      presence: [{ cohort_id: 3, day: 1, shift: 0 }],
      groups: [{ id: 11, edition_id: 7, cohort_id: 3, number: 1, size: null, head_name: "ראש/ת קבוצה לדוגמה" }],
      duties: [{ id: 5, edition_id: 7, name: "מטבח", description: null, need_morning: 1, need_afternoon: null, need_night: 1, min_people: null, sort: 1 }],
      assignments: [{ id: 9, edition_id: 7, day: 1, shift: 0, duty_id: 5, group_id: 11, source: "suggested" }],
      staff: [{ id: 2, edition_id: 7, day: 0, start_min: 510, end_min: 870, member_id: 4, name: "חבר/ת צוות לדוגמה", cohort_id: null, note: null }],
      prep: [
        { id: 8, edition_id: 7, text: "משימה לדוגמה", group_id: null, done: false, sort: 1, kind: "task", qty: null },
        { id: 9, edition_id: 7, text: "פריט לדוגמה", group_id: null, done: true, sort: 2, kind: "item", qty: "2 (לדוגמה)" },
      ],
    });
    expect(JSON.stringify(d)).not.toContain("head_phone");
    // an edition the caller cannot see answers null
    expect(await code(r.load(8))).toBe("not_member");
    expect(sent.map((s) => [s.method, s.path, s.body])).toEqual([
      ["POST", "rpc/load_rota", { p_edition: 7 }],
      ["POST", "rpc/load_rota", { p_edition: 8 }],
    ]);
  });

  it("the phones: get_rota_contacts — the heads' and (v20) the cohorts' contacts' (none → []); set_rota_contact (kind, id, phone) with the phone cleaned — a bad one never sent", async () => {
    const { r, sent } = port([
      [200, [{ group_id: "11", head_phone: "000-000-0001" }, { cohort_id: "3", phone: "000-000-0002" }]], [200, null], [204, null], [204, null], [204, null], pg("P0001", "rota_contact_hidden"),
    ]);
    expect(await r.contacts(7)).toEqual([{ group_id: 11, head_phone: "000-000-0001" }, { cohort_id: 3, phone: "000-000-0002" }]);
    expect(await r.contacts(7)).toEqual([]);
    await r.setContact({ group: 11 }, "  000-000-0001 ");
    await r.setContact({ group: 11 }, "  ");
    await r.setContact({ cohort: 3 }, " 000-000-0002");
    expect(await code(r.setContact({ group: 11 }, "12-345"))).toBe("bad_phone");
    expect(await code(r.setContact({ cohort: 3 }, "12-345"))).toBe("bad_phone");
    expect(await code(r.setContact({ group: 11 }, "000-000-0001"))).toBe("rota_contact_hidden");
    expect(sent.map((s) => [s.path, s.body])).toEqual([
      ["rpc/get_rota_contacts", { p_edition: 7 }],
      ["rpc/get_rota_contacts", { p_edition: 7 }],
      ["rpc/set_rota_contact", { p_kind: "group", p_id: 11, p_phone: "000-000-0001" }],
      ["rpc/set_rota_contact", { p_kind: "group", p_id: 11, p_phone: null }],
      ["rpc/set_rota_contact", { p_kind: "cohort", p_id: 3, p_phone: "000-000-0002" }],
      ["rpc/set_rota_contact", { p_kind: "group", p_id: 11, p_phone: "000-000-0001" }],
    ]);
  });

  it("v20: «חלוקה לקבוצות» is ONE call of rota_split_cohort — the sizes cleaned first; the new groups as the port's types", async () => {
    const { r, sent } = port([
      [200, [{ id: "21", edition_id: "7", cohort_id: "3", number: 1, size: 8, head_name: null }, { id: "22", edition_id: "7", cohort_id: "3", number: 2, size: 7, head_name: null }]],
      pg("P0001", "cohort_not_helping"),
    ]);
    expect(await r.splitCohort(7, 3, [8, 7])).toEqual([
      { id: 21, edition_id: 7, cohort_id: 3, number: 1, size: 8, head_name: null },
      { id: 22, edition_id: 7, cohort_id: 3, number: 2, size: 7, head_name: null },
    ]);
    expect(await code(r.splitCohort(7, 4, [5]))).toBe("cohort_not_helping");
    expect(await code(r.splitCohort(7, 3, []))).toBe("bad_value");
    expect(await code(r.splitCohort(7, 3, [201]))).toBe("bad_value");
    expect(sent.map((s) => [s.path, s.body])).toEqual([
      ["rpc/rota_split_cohort", { p_edition: 7, p_cohort: 3, p_sizes: [8, 7] }],
      ["rpc/rota_split_cohort", { p_edition: 7, p_cohort: 4, p_sizes: [5] }],
    ]);
  });

  it("v20: the duties a cohort helps in — ONE insert of the set (on conflict nothing), then ONE delete of the rest; an empty set the delete alone", async () => {
    const { r, sent } = port([[201, null], [204, null], pg("P0001", "in_use"), pg("23503")]);
    await r.setCohortDuties(7, 3, [5, 6, 5]);
    expect(await code(r.setCohortDuties(7, 3, []))).toBe("in_use"); // a cohort with groups keeps one (the guard)
    expect(await code(r.setCohortDuties(7, 3, [99]))).toBe("stale"); // a duty not the edition's
    expect(await code(r.setCohortDuties(7, 3, [1.5]))).toBe("bad_value"); // never sent
    expect(sent.map((s) => [s.method, s.path, q(s), s.body])).toEqual([
      ["POST", "rota_cohort_duties", { on_conflict: "cohort_id,duty_id", columns: '"edition_id","cohort_id","duty_id"' }, [{ edition_id: 7, cohort_id: 3, duty_id: 5 }, { edition_id: 7, cohort_id: 3, duty_id: 6 }]],
      ["DELETE", "rota_cohort_duties", { edition_id: "eq.7", cohort_id: "eq.3", duty_id: "not.in.(5,6)" }, null],
      ["DELETE", "rota_cohort_duties", { edition_id: "eq.7", cohort_id: "eq.3" }, null],
      ["POST", "rota_cohort_duties", { on_conflict: "cohort_id,duty_id", columns: '"edition_id","cohort_id","duty_id"' }, [{ edition_id: 7, cohort_id: 3, duty_id: 99 }]],
    ]);
    expect(sent[0].prefer).toContain("resolution=ignore-duplicates");
  });

  it("set_rota_shifts with the setting cleaned, null for last year's; a refusal its code", async () => {
    const { r, sent } = port([[204, null], [204, null], pg("P0001", "forbidden")]);
    await r.setShifts(7, { cuts: [840, 1320], labels: [" בוקר ", "צהריים", "לילה"] });
    await r.setShifts(7, null);
    expect(await code(r.setShifts(7, { cuts: [840, 1320], labels: ["בוקר", "צהריים", "לילה"] }))).toBe("forbidden");
    expect(await code(r.setShifts(7, { cuts: [842, 1320], labels: ["בוקר", "צהריים", "לילה"] }))).toBe("bad_value");
    expect(sent.map((s) => [s.path, s.body])).toEqual([
      ["rpc/set_rota_shifts", { p_edition: 7, p_shifts: { cuts: [840, 1320], labels: ["בוקר", "צהריים", "לילה"] } }],
      ["rpc/set_rota_shifts", { p_edition: 7, p_shifts: null }],
      ["rpc/set_rota_shifts", { p_edition: 7, p_shifts: { cuts: [840, 1320], labels: ["בוקר", "צהריים", "לילה"] } }],
    ]);
  });
});

describe("SupabaseRota: direct writes under RLS", () => {
  it("cohorts: insert / update / delete by id, each asking for its row back; the codes per table", async () => {
    const { r, sent } = port([row, pg("23505"), [200, [{ id: 3 }]], [200, []], pg("23503"), [200, [{ id: 3 }]], pg("42501"), pg("P0001", "rota_contact_in_text")]);
    expect(await r.addCohort(7, { letter: " א ", name: "  מכינה   לדוגמה א ", trainees: 23, diet_veg: 4, diet_gf: 3, diet_both: 2, contact_name: " איש/אשת קשר " })).toBe(1); // the new id
    expect(await code(r.addCohort(7, { letter: "א", name: "מכינה" }))).toBe("rota_letter_taken");
    await r.updateCohort(3, { name: "מכינה לדוגמה", sort: 2 });
    expect(await code(r.updateCohort(3, { trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null }))).toBe("forbidden"); // RLS: no row back
    expect(await code(r.deleteCohort(3))).toBe("in_use"); // a cohort with groups
    await r.deleteCohort(3);
    expect(await code(r.addCohort(7, { letter: "ב", name: "מכינה" }))).toBe("forbidden"); // 42501
    expect(await code(r.addCohort(7, { letter: "ג", name: "מכינה" }))).toBe("rota_contact_in_text"); // the guard's backstop
    // the cleaners refuse before anything is sent
    expect(await code(r.addCohort(7, { letter: "א1", name: "מכינה" }))).toBe("bad_value");
    expect(await code(r.addCohort(7, { letter: "ד", name: "מכינה 000-000-0055" }))).toBe("rota_contact_in_text");
    expect(await code(r.updateCohort(3, { sort: 1.5 }))).toBe("bad_value");
    // v20: the numbers' rule before the wire — on a whole set of four; a patch of one is the guard's to hold
    expect(await code(r.addCohort(7, { letter: "ה", name: "מכינה", trainees: 5, diet_veg: 4, diet_gf: 3, diet_both: 1 }))).toBe("rota_diets_exceed");
    expect(await code(r.updateCohort(3, { trainees: 5, diet_veg: 4, diet_gf: 3, diet_both: 1 }))).toBe("rota_diets_exceed");
    expect(await code(r.addCohort(7, { letter: "ה", name: "מכינה", trainees: 1001 }))).toBe("bad_value");
    expect(await code(r.addCohort(7, { letter: "ה", name: "מכינה", contact_name: "טל' 1234567" }))).toBe("rota_contact_in_text");
    expect(sent).toHaveLength(8);
    expect([sent[0].method, sent[0].path, q(sent[0]).select, sent[0].body]).toEqual([
      "POST", "rota_cohorts", "id", { edition_id: 7, letter: "א", name: "מכינה לדוגמה א", trainees: 23, diet_veg: 4, diet_gf: 3, diet_both: 2, contact_name: "איש/אשת קשר" },
    ]);
    expect([sent[2].method, q(sent[2]), sent[2].body]).toEqual(["PATCH", { id: "eq.3", select: "id" }, { name: "מכינה לדוגמה", sort: 2 }]);
    expect([sent[4].method, q(sent[4])]).toEqual(["DELETE", { id: "eq.3", select: "id" }]);
  });

  it("groups and duties: their unique codes; a parent gone on a write is stale", async () => {
    const { r, sent } = port([row, pg("23505"), pg("23503"), [200, [{ id: 4 }]], row, pg("23505"), [200, [{ id: 5 }]], [200, [{ id: 5 }]]]);
    await r.addGroup(7, { cohort_id: 3, number: 1, size: 8, head_name: " ראש/ת קבוצה לדוגמה " });
    expect(await code(r.addGroup(7, { cohort_id: 3, number: 1 }))).toBe("rota_group_taken");
    expect(await code(r.addGroup(7, { cohort_id: 99, number: 2 }))).toBe("stale");
    await r.updateGroup(4, { size: null });
    await r.addDuty(7, { name: " מטבח ", need_morning: 1, need_night: null });
    expect(await code(r.addDuty(7, { name: "מטבח" }))).toBe("rota_duty_exists");
    await r.updateDuty(5, { min_people: 12 });
    await r.deleteDuty(5);
    expect(await code(r.addGroup(7, { cohort_id: 3, number: 100 }))).toBe("bad_value");
    expect(await code(r.addDuty(7, { name: "בית מדרש", need_morning: 21 }))).toBe("bad_value");
    expect(sent.map((s) => [s.method, s.path, s.body])).toEqual([
      ["POST", "rota_groups", { edition_id: 7, cohort_id: 3, number: 1, size: 8, head_name: "ראש/ת קבוצה לדוגמה" }],
      ["POST", "rota_groups", { edition_id: 7, cohort_id: 3, number: 1, size: null, head_name: null }],
      ["POST", "rota_groups", { edition_id: 7, cohort_id: 99, number: 2, size: null, head_name: null }],
      ["PATCH", "rota_groups", { size: null }],
      ["POST", "rota_duties", { edition_id: 7, name: "מטבח", need_morning: 1, need_night: null }],
      ["POST", "rota_duties", { edition_id: 7, name: "מטבח" }],
      ["PATCH", "rota_duties", { min_people: 12 }],
      ["DELETE", "rota_duties", null],
    ]);
  });

  it("assignments: by hand «hand»; busy → rota_group_busy, outside_week from the guard; a move sends the duty alone", async () => {
    const { r, sent } = port([row, pg("23505"), pg("P0001", "outside_week"), [200, [{ id: 9 }]], [200, [{ id: 9 }]], [200, []]]);
    await r.assign(7, { day: 1, shift: 0, duty_id: 5, group_id: 11 });
    expect(await code(r.assign(7, { day: 1, shift: 0, duty_id: 6, group_id: 11 }))).toBe("rota_group_busy");
    expect(await code(r.assign(7, { day: 4, shift: 2, duty_id: 5, group_id: 11 }))).toBe("outside_week");
    await r.moveAssignment(9, 6);
    await r.unassign(9);
    expect(await code(r.unassign(9))).toBe("forbidden");
    expect(await code(r.assign(7, { day: 5 as never, shift: 0, duty_id: 5, group_id: 11 }))).toBe("bad_value");
    expect(sent.map((s) => [s.method, s.body])).toEqual([
      ["POST", { edition_id: 7, day: 1, shift: 0, duty_id: 5, group_id: 11, source: "hand" }],
      ["POST", { edition_id: 7, day: 1, shift: 0, duty_id: 6, group_id: 11, source: "hand" }],
      ["POST", { edition_id: 7, day: 4, shift: 2, duty_id: 5, group_id: 11, source: "hand" }],
      ["PATCH", { duty_id: 6 }],
      ["DELETE", null],
      ["DELETE", null],
    ]);
  });

  it("«החלת ההצעה» is ONE insert of every row, «suggested»; a row taken or a group gone meanwhile is stale", async () => {
    const { r, sent } = port([[201, [{ id: 1 }, { id: 2 }]], pg("23505"), pg("23503"), pg("42501")]);
    const rows = [
      { day: 2 as const, shift: 0 as const, duty_id: 5, group_id: 11 },
      { day: 2 as const, shift: 1 as const, duty_id: 5, group_id: 12 },
    ];
    await r.applySuggestion(7, rows);
    expect(await code(r.applySuggestion(7, rows))).toBe("stale");
    expect(await code(r.applySuggestion(7, rows))).toBe("stale");
    expect(await code(r.applySuggestion(7, rows))).toBe("forbidden");
    await r.applySuggestion(7, []); // nothing to send
    expect(sent).toHaveLength(4);
    expect([sent[0].method, sent[0].path, q(sent[0]).select]).toEqual(["POST", "rota_assignments", "id"]);
    expect(sent[0].body).toEqual(rows.map((x) => ({ edition_id: 7, ...x, source: "suggested" })));
  });

  it("«ניקוי השיבוצים המוצעים» is ONE delete of the edition's suggested rows, and says how many — 0 for a member who may not write", async () => {
    const { r, sent } = port([[200, [{ id: 1 }, { id: 2 }, { id: 3 }]], [200, []], [200, []]]);
    expect(await r.clearSuggested(7)).toBe(3);
    expect(await r.clearSuggested(7)).toBe(0); // nothing left
    // a member who may not write (content, an archived edition's logistics): RLS filters every row and PostgREST answers
    // [] without an error, so the real port answers 0, not `forbidden` — DemoRota refuses (CONTRACT «תורנויות», the port)
    expect(await r.clearSuggested(7)).toBe(0);
    expect(sent).toHaveLength(3);
    for (const s of sent) expect([s.method, s.path, q(s)]).toEqual(["DELETE", "rota_assignments", { edition_id: "eq.7", source: "eq.suggested", select: "id" }]);
  });

  it("«כל השבוע»: the edition's row read once, then ONE insert of the shifts the week has (ON CONFLICT DO NOTHING); absent ONE delete", async () => {
    const { r, sent } = port([[200, [{ first_day_from: 870, last_day_until: 1140, settings: {} }]], [201, null], [200, [{ first_day_from: 510, last_day_until: 1140, settings: {} }]], [201, null], [204, null], [204, null], [200, []]]);
    await r.setPresence(7, 3, {}, true);
    await r.setPresence(7, 3, { day: 0 }, true);
    await r.setPresence(7, 3, { day: 2 }, false);
    await r.setPresence(7, 3, { day: 3, shift: 2 }, false);
    expect(await code(r.setPresence(8, 3, {}, true))).toBe("not_member");
    expect(await code(r.setPresence(7, 3, { shift: 3 as never }, true))).toBe("bad_value");
    expect(sent.map((s) => [s.method, s.path])).toEqual([
      ["GET", "editions"], ["POST", "rota_presence"], ["GET", "editions"], ["POST", "rota_presence"], ["DELETE", "rota_presence"], ["DELETE", "rota_presence"], ["GET", "editions"],
    ]);
    expect(q(sent[0])).toEqual({ select: "first_day_from,last_day_until,settings", id: "eq.7" });
    // Sunday opens at 14:30: its morning is not the week's; Thursday has no night — 13 rows
    const body = sent[1].body as { day: number; shift: number }[];
    expect(body).toHaveLength(13);
    expect(body[0]).toEqual({ edition_id: 7, cohort_id: 3, day: 0, shift: 1 });
    expect(body.some((x) => x.day === 4 && x.shift === 2)).toBe(false);
    expect(q(sent[1]).on_conflict).toBe("cohort_id,day,shift");
    expect(sent[1].prefer).toContain("resolution=ignore-duplicates");
    expect((sent[3].body as unknown[]).length).toBe(3);
    expect(q(sent[4])).toEqual({ edition_id: "eq.7", cohort_id: "eq.3", day: "eq.2" });
    expect(q(sent[5])).toEqual({ edition_id: "eq.7", cohort_id: "eq.3", day: "eq.3", shift: "eq.2" });
  });

  it("staff shifts: cleaned whole on insert; a patch cleaned field by field", async () => {
    const { r, sent } = port([row, pg("P0001", "bad_value"), [200, [{ id: 2 }]], [200, [{ id: 2 }]], [200, [{ id: 2 }]]]);
    const s = { day: 1 as const, start_min: 510, end_min: 780, member_id: null, name: " איש/אשת צוות לדוגמה ", cohort_id: null, note: " הקפצת מרצה " };
    await r.addStaffShift(7, s);
    expect(await code(r.addStaffShift(7, { ...s, member_id: 99 }))).toBe("bad_value"); // the guard: not an active member
    await r.updateStaffShift(2, { note: null });
    await r.updateStaffShift(2, { start_min: 540, end_min: 600 });
    await r.updateStaffShift(2, { name: null, cohort_id: 3, member_id: null });
    expect(await code(r.addStaffShift(7, { ...s, name: null }))).toBe("name_required");
    expect(await code(r.addStaffShift(7, { ...s, cohort_id: 3 }))).toBe("bad_value");
    expect(await code(r.addStaffShift(7, { ...s, start_min: 780, end_min: 510 }))).toBe("bad_value");
    expect(await code(r.updateStaffShift(2, { start_min: 512 }))).toBe("bad_value");
    expect(await code(r.updateStaffShift(2, { note: "טל' 1234567" }))).toBe("rota_contact_in_text");
    expect(sent.map((x) => x.body)).toEqual([
      { edition_id: 7, day: 1, start_min: 510, end_min: 780, member_id: null, name: "איש/אשת צוות לדוגמה", cohort_id: null, note: "הקפצת מרצה" },
      { edition_id: 7, day: 1, start_min: 510, end_min: 780, member_id: 99, name: "איש/אשת צוות לדוגמה", cohort_id: null, note: "הקפצת מרצה" },
      { note: null },
      { start_min: 540, end_min: 600 },
      { member_id: null, name: null, cohort_id: 3 },
    ]);
  });

  it("preparations: a pasted list goes after the last — its sort read once, then ONE insert, in order", async () => {
    const { r, sent } = port([[200, [{ sort: 7 }]], [201, [{ id: 1 }, { id: 2 }]], [200, []], [201, [{ id: 3 }]], [200, [{ id: 3 }]], [200, [{ id: 3 }]]]);
    await r.addPrepTasks(7, [" משימה לדוגמה 1 ", "משימה לדוגמה 2"]);
    await r.addPrepTasks(8, ["משימה לדוגמה"]);
    await r.updatePrepTask(3, { group_id: 11, done: true });
    await r.deletePrepTask(3);
    await r.addPrepTasks(7, []);
    expect(await code(r.addPrepTasks(7, ["להתקשר ל-000-000-0055"]))).toBe("rota_contact_in_text");
    expect(await code(r.updatePrepTask(3, { done: "yes" as never }))).toBe("bad_value");
    expect(sent.map((s) => [s.method, s.path])).toEqual([
      ["GET", "rota_prep_tasks"], ["POST", "rota_prep_tasks"], ["GET", "rota_prep_tasks"], ["POST", "rota_prep_tasks"], ["PATCH", "rota_prep_tasks"], ["DELETE", "rota_prep_tasks"],
    ]);
    expect(q(sent[0])).toEqual({ select: "sort", edition_id: "eq.7", order: "sort.desc", limit: "1" });
    expect(sent[1].body).toEqual([
      { edition_id: 7, text: "משימה לדוגמה 1", kind: "task", qty: null, group_id: null, done: false, sort: 8 },
      { edition_id: 7, text: "משימה לדוגמה 2", kind: "task", qty: null, group_id: null, done: false, sort: 9 },
    ]);
    expect(sent[3].body).toEqual([{ edition_id: 8, text: "משימה לדוגמה", kind: "task", qty: null, group_id: null, done: false, sort: 1 }]);
    expect(sent[4].body).toEqual({ group_id: 11, done: true });
  });

  it("v19: a shopping list — ONE insert of items with their quantities after the last of both lists; a task's quantity never sent (but cleaned)", async () => {
    const { r, sent } = port([[200, [{ sort: 4 }]], [201, [{ id: 5 }, { id: 6 }]], [200, [{ id: 5 }]], [200, [{ id: 5 }]], [200, [{ id: 5 }]]]);
    await r.addPrepTasks(7, [{ text: " פריט לדוגמה 1 ", qty: " 2 (לדוגמה) " }, "פריט לדוגמה 2"], "item");
    await r.updatePrepTask(5, { qty: "3" });
    await r.updatePrepTask(5, { kind: "task", qty: "3" });
    await r.updatePrepTask(5, { kind: "item" });
    expect(await code(r.addPrepTasks(7, [{ text: "פריט", qty: "טל' 1234567" }], "item"))).toBe("rota_contact_in_text");
    expect(await code(r.addPrepTasks(7, [{ text: "פריט", qty: "א".repeat(41) }], "item"))).toBe("bad_value");
    expect(await code(r.addPrepTasks(7, ["פריט"], "thing" as never))).toBe("bad_value");
    expect(await code(r.updatePrepTask(5, { kind: null as never }))).toBe("bad_value");
    expect(await code(r.updatePrepTask(5, { kind: "task", qty: "טל' 1234567" }))).toBe("rota_contact_in_text"); // ≡ the guard
    expect(sent.map((s) => [s.method, s.path])).toEqual([["GET", "rota_prep_tasks"], ["POST", "rota_prep_tasks"], ["PATCH", "rota_prep_tasks"], ["PATCH", "rota_prep_tasks"], ["PATCH", "rota_prep_tasks"]]);
    expect(sent[1].body).toEqual([
      { edition_id: 7, text: "פריט לדוגמה 1", kind: "item", qty: "2 (לדוגמה)", group_id: null, done: false, sort: 5 },
      { edition_id: 7, text: "פריט לדוגמה 2", kind: "item", qty: null, group_id: null, done: false, sort: 6 },
    ]);
    expect(sent[2].body).toEqual({ qty: "3" }); // the guard nulls it on a task
    expect(sent[3].body).toEqual({ kind: "task", qty: null });
    expect(sent[4].body).toEqual({ kind: "item" });
  });

  it("v19: «יכול להסיע» — sent only when given, as a boolean; null or anything else refused before the wire (v20: no helps_rota)", async () => {
    const { r, sent } = port([[201, [{ id: 3 }]], [201, [{ id: 4 }]], [200, [{ id: 3 }]]]);
    expect(await r.addCohort(7, { letter: "א", name: "מכינה לדוגמה א" })).toBe(3);
    expect(await r.addCohort(7, { letter: "ב", name: "מכינה לדוגמה ב", can_drive: true })).toBe(4);
    await r.updateCohort(3, { can_drive: true });
    expect(await code(r.addCohort(7, { letter: "ג", name: "מכינה", can_drive: null as never }))).toBe("bad_value");
    expect(await code(r.updateCohort(3, { can_drive: "yes" as never }))).toBe("bad_value");
    expect(sent.map((s) => s.body)).toEqual([
      { edition_id: 7, letter: "א", name: "מכינה לדוגמה א", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null },
      { edition_id: 7, letter: "ב", name: "מכינה לדוגמה ב", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, can_drive: true },
      { can_drive: true },
    ]);
  });
});
