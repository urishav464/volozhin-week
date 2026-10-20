// Memorial times and logistics on the wire (SupabaseMemorial and the edition's new commands: the real supabase-js
// client, a stub fetch in place of PostgREST — every function by the parameter names tests/sql pins, the answers
// read right, a refusal its code) and in the demo (DemoPort on the engine: the same rules, the same codes).
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { CommandError } from "./commands";
import { DemoPort } from "./demoPort";
import { cleanPlanPatch, cleanPolicy, FAMILY_STATUS_LABEL, FAMILY_STATUSES } from "./memorial";
import { supabaseCommands } from "./supabaseCommands";
import { SupabaseMemorial } from "./supabaseMemorial";

function client(answers: [number, unknown][]) {
  const sent: { method: string; path: string; query: string; body: unknown }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const text = await req.text();
    const u = new URL(req.url);
    sent.push({ method: req.method, path: u.pathname, query: u.search, body: text ? JSON.parse(text) : null });
    const [status, body] = answers.shift() ?? [404, {}];
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  const sb = createClient("https://stub.supabase.co", "stub-publishable-key", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch } });
  return { sb, sent };
}
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${String(e)}`;
  }
};

describe("memorial times and logistics on the wire", () => {
  it("calls every memorial function, and get_transports_for, by its parameter names", async () => {
    const { sb, sent } = client([
      [200, [{ lesson_id: "41", pickup_address: null, pickup_time: "07:15", driver_name: null, driver_phone: null, arranged: true }]],
      [200, 501], [204, null], [200, 9], [204, null], [204, null], [204, null], [204, null],
    ]);
    const c = supabaseCommands(sb, 7);
    expect(await c.transports()).toEqual([{ lesson_id: 41, pickup_address: null, pickup_time: "07:15", driver_name: null, driver_phone: null, arranged: true }]);
    expect(await c.addMemorialSlot(0, 780, 795, null)).toBe(501);
    await c.removeMemorialSlot(501);
    expect(await c.addMemorialPlan(3)).toBe(9);
    await c.updateMemorialPlan(9, 2, { family_status: "invited", planned_minutes: 10 });
    await c.placeMemorialPlan(9, 3, 501);
    await c.deleteMemorialPlan(9);
    await c.setMemorialPolicy({ max_minutes: 10 });
    expect(sent.map((r) => [r.path.replace("/rest/v1/rpc/", ""), r.body])).toEqual([
      ["get_transports_for", { p_edition: 7 }],
      ["add_memorial_slot", { p_edition: 7, p_day: 0, p_start: 780, p_end: 795, p_room: null }],
      ["remove_memorial_slot", { p_lesson: 501 }],
      ["add_memorial_plan", { p_edition: 7, p_fallen: 3 }],
      ["update_memorial_plan", { p_plan: 9, p_version: 2, p_patch: { family_status: "invited", planned_minutes: 10 } }],
      ["place_memorial_plan", { p_plan: 9, p_version: 3, p_lesson: 501 }],
      ["delete_memorial_plan", { p_plan: 9 }],
      ["set_memorial_policy", { p_edition: 7, p_placement: null, p_max_minutes: 10, p_warn_adjacent_meal: null }],
    ]);
  });

  it("reads the fallen under RLS, a family's contact one at a time, and turns a refusal into its code", async () => {
    const { sb, sent } = client([
      [200, [{ id: "2", name: "חלל/ה לבדיקה", gender: null, note: null, active: true }]],
      [200, 2], [204, null], [200, null], [204, null],
      [400, { code: "P0001", message: "contacts_hidden" }],
    ]);
    const m = new SupabaseMemorial(sb);
    expect(await m.fallen()).toEqual([{ id: 2, name: "חלל/ה לבדיקה", gender: null, note: null, active: true }]);
    expect(await m.saveFallen(null, { name: "חלל/ה לבדיקה", gender: "f", note: null, active: true })).toBe(2);
    await m.deleteFallen(2);
    expect(await m.contacts(2)).toBeNull();
    await m.setContacts(2, { contact_name: "לבדיקה", relation: null, phone: null, email: null, note: null });
    expect(await code(m.setContacts(2, { contact_name: null, relation: null, phone: null, email: null, note: null }))).toBe("contacts_hidden");
    expect(sent[0]).toMatchObject({ method: "GET", path: "/rest/v1/fallen" });
    expect(sent[0].query).toContain("select=id%2Cname%2Cgender%2Cnote%2Cactive");
    expect(sent.slice(1).map((r) => [r.path.replace("/rest/v1/rpc/", ""), r.body])).toEqual([
      ["save_fallen", { p_fallen: null, p_name: "חלל/ה לבדיקה", p_gender: "f", p_note: null, p_active: true }],
      ["delete_fallen", { p_fallen: 2 }],
      ["get_fallen_contacts", { p_fallen: 2 }],
      ["set_fallen_contacts", { p_fallen: 2, p_contact_name: "לבדיקה", p_relation: null, p_phone: null, p_email: null, p_note: null }],
      ["set_fallen_contacts", { p_fallen: 2, p_contact_name: null, p_relation: null, p_phone: null, p_email: null, p_note: null }],
    ]);
  });
});

describe("memorial times in the demo", () => {
  it("holds nine synthetic fallen, three plans (one placed, with a liaison), a family's contact in placeholder words — and no policy", async () => {
    const port = new DemoPort();
    const [ed] = await port.editions();
    const w = await port.loadWeek(ed.id);
    expect((await port.memorial.fallen()).map((f) => f.name)).toEqual(Array.from({ length: 9 }, (_, i) => `חלל/ה לדוגמה ${i + 1}`));
    expect(w.memorialPlans.map((p) => [p.fallen_id, p.lesson_id != null])).toEqual([[1, true], [2, false], [3, false]]);
    expect(w.fallen.map((f) => f.name)).toEqual(["חלל/ה לדוגמה 1", "חלל/ה לדוגמה 2", "חלל/ה לדוגמה 3"]);
    expect(w.lessons.find((l) => l.id === w.memorialPlans[0].lesson_id)!.escort_roster_id).toBe(4);
    expect(w.edition.settings.memorial).toBeUndefined();
    expect(await port.memorial.contacts(1)).toMatchObject({ phone: "טלפון לדוגמה", email: "family1@example.org" });
    expect(JSON.stringify(w)).not.toContain("טלפון לדוגמה"); // a family's contact is never in a Week
  });

  it("logs a family's contact change in the edition whose plan gave access, as the admin who made it (the archive has it)", async () => {
    // an admin of this edition only (not of every edition), in a real, live week with a plan for fallen 1
    const port = new DemoPort({ memberId: 2, role: "admin", global: false });
    port.engine(1).week.edition.kind = "real";
    await port.memorial.setContacts(1, { contact_name: "איש/אשת קשר לדוגמה", relation: null, phone: null, email: null, note: null });
    expect(port.shared.log.at(-1)).toMatchObject({ actor: 2, edition_id: 1, entity: "fallen", entity_id: 1, kind: "contacts" });
    expect((await port.outputs.archiveExtras(1, [], [])).activity.filter((r) => r.entity === "fallen").map((r) => r.entity_id)).toEqual([1]);
    // a global admin, for a fallen no live edition plans for: no edition, their own id
    const admin = new DemoPort();
    await admin.memorial.setContacts(9, { contact_name: "איש/אשת קשר לדוגמה", relation: null, phone: null, email: null, note: null });
    expect(admin.shared.log.at(-1)).toMatchObject({ actor: 1, edition_id: null, entity: "fallen", entity_id: 9 });
    // adding and deleting a plan (the key to a family's contact) is logged too
    const id = await admin.commands(1).addMemorialPlan(9);
    await admin.commands(1).deleteMemorialPlan(id);
    expect(admin.shared.log.slice(-2)).toMatchObject([
      { actor: 1, edition_id: 1, entity: "memorial_plans", entity_id: id, kind: "insert", detail: { fallen: 9 } },
      { actor: 1, edition_id: 1, entity: "memorial_plans", entity_id: id, kind: "delete", detail: { fallen: 9 } },
    ]);
  });

  it("refuses what the database refuses: a second plan on a slot, a placed plan's removal", async () => {
    const port = new DemoPort();
    const [ed] = await port.editions();
    const c = port.commands(ed.id);
    const w = await port.loadWeek(ed.id);
    const [p1, p2] = w.memorialPlans;
    expect(await code(c.placeMemorialPlan(p2.id, p2.version, p1.lesson_id))).toBe("memorial_taken");
    expect(await code(c.deleteMemorialPlan(p1.id))).toBe("memorial_placed");
    const monday = w.lessons.find((l) => l.kind === "memorial" && l.day === 1)!;
    await c.placeMemorialPlan(p1.id, p1.version, monday.id);
    const after = await port.loadWeek(ed.id);
    expect(after.lessons.find((l) => l.id === monday.id)!.escort_roster_id).toBe(4); // the liaison went along
    expect(after.lessons.find((l) => l.id === p1.lesson_id)!.escort_roster_id).toBeNull();
  });
});

describe("what both sides accept", () => {
  it("cleans a plan's patch and a policy as the functions do", () => {
    expect(cleanPlanPatch({ speaker_text: "  א   ב ", planned_minutes: 12, other: 1 })).toEqual({ speaker_text: "א ב", planned_minutes: 12 });
    for (const bad of [{ planned_minutes: 0 }, { planned_minutes: 181 }, { planned_minutes: 2.5 }, { family_status: "x" }, { hard_stop: 1 }, { speaker_text: 5 }]) {
      expect(() => cleanPlanPatch(bad), JSON.stringify(bad)).toThrow(CommandError);
    }
    expect(cleanPolicy({ placement: "  ", max_minutes: undefined, warn_adjacent_meal: false })).toEqual({ warn_adjacent_meal: false });
    expect(() => cleanPolicy({ max_minutes: 0 })).toThrow(CommandError);
    expect(FAMILY_STATUSES.map((s) => FAMILY_STATUS_LABEL[s])).toEqual(["עוד לא נוצר קשר", "המשפחה הוזמנה", "המשפחה אישרה", "המשפחה לא תגיע", "דובר/ת אחר/ת"]);
  });
});
