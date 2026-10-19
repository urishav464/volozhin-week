// The week's stage commands on the wire: the real supabase-js client, a stub
// fetch in place of PostgREST. tests/sql/stages.test.ts pins the functions'
// parameter names in the database; this pins that the port sends exactly
// those, reads the answers right, and turns every refusal into its code.
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { errorMessage } from "../errors";
import { CommandError } from "./commands";
import { SupabaseSettings } from "./supabaseSettings";
import { supabaseCommands } from "./supabaseCommands";

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
  const sb = createClient("https://stub.supabase.co", "stub-publishable-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
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

describe("the stage commands on the wire", () => {
  it("calls every stage function by its parameter names", async () => {
    const { sb, sent } = client([[204, null], [204, null], [204, null], [204, null], [204, null], [204, null], [200, null], [204, null]]);
    const c = supabaseCommands(sb, 7);
    await c.setPayment(41, 3, 500, "round_trip");
    await c.decidePayments([{ lesson_id: 41, version: 4 }, { lesson_id: 42, version: 1 }], "approved", "באצווה");
    await c.markConfirmSent(41, 5);
    await c.setEscort(41, 6, { roster_id: 2, self_intro: false, escort_note: null });
    await c.setSources(41, 7, { sources_kind: "presentation", print_when: "none", sources_note: null, presentation_url: "https://slides.example/a", in_reader: false });
    await c.setPaid(41, true);
    expect(await c.transport(41)).toBeNull();
    await c.setTransport(41, { pickup_address: "כתובת לדוגמה", pickup_time: "07:15", driver_name: null, driver_phone: null, arranged: true });
    expect(sent.map((r) => [r.path.replace("/rest/v1/rpc/", ""), r.body])).toEqual([
      ["set_payment", { p_lesson: 41, p_version: 3, p_pay_amount: 500, p_transport: "round_trip" }],
      ["decide_payments", { p_lessons: [41, 42], p_versions: [4, 1], p_decision: "approved", p_note: "באצווה" }],
      ["mark_confirm_sent", { p_lesson: 41, p_version: 5 }],
      ["set_escort", { p_lesson: 41, p_version: 6, p_roster: 2, p_self_intro: false, p_note: null }],
      ["set_sources", { p_lesson: 41, p_version: 7, p_kind: "presentation", p_print_when: "none", p_note: null, p_url: "https://slides.example/a", p_in_reader: false }],
      ["set_paid", { p_lesson: 41, p_paid: true }],
      ["get_transport_details", { p_lesson: 41 }],
      ["set_transport_details", { p_lesson: 41, p_pickup_address: "כתובת לדוגמה", p_pickup_time: "07:15", p_driver_name: null, p_driver_phone: null, p_arranged: true }],
    ]);
    expect(sent.every((r) => r.method === "POST")).toBe(true);
  });

  it("reads transport details as five fields; a decision note defaults to none", async () => {
    const { sb, sent } = client([[200, { pickup_address: "כתובת לדוגמה", pickup_time: null, driver_name: null, driver_phone: null, arranged: true }], [204, null]]);
    const c = supabaseCommands(sb, 7);
    expect(await c.transport(41)).toEqual({ pickup_address: "כתובת לדוגמה", pickup_time: null, driver_name: null, driver_phone: null, arranged: true });
    await c.decidePayments([{ lesson_id: 41, version: 2 }], "rejected");
    expect(sent[1].body).toEqual({ p_lessons: [41], p_versions: [2], p_decision: "rejected", p_note: null });
  });

  it("turns the database's refusals into their codes — and so into Hebrew", async () => {
    const p0001 = (message: string): [number, unknown] => [400, { code: "P0001", message, details: null, hint: null }];
    const { sb } = client([p0001("approval_pending"), p0001("transport_hidden"), p0001("bad_escort"), [403, { code: "42501", message: "permission denied for function set_paid" }], [404, { code: "PGRST202", message: "Could not find the function" }]]);
    const c = supabaseCommands(sb, 7);
    expect(await code(c.markConfirmSent(41, 1))).toBe("approval_pending");
    expect(await code(c.setTransport(41, { pickup_address: null, pickup_time: null, driver_name: null, driver_phone: null, arranged: false }))).toBe("transport_hidden");
    expect(await code(c.setEscort(41, 1, { roster_id: 9, self_intro: false, escort_note: null }))).toBe("bad_escort");
    expect(await code(c.setPaid(41, true))).toBe("forbidden");
    expect(await code(c.setPayment(41, 1, null, "none"))).toMatch(/^raw:/); // schema.sql not re-run: a PortError, not a refusal
    expect(errorMessage("approval_pending")).toMatch(/^התשלום או ההסעה עוד ממתינים/);
  });

  it("settings: the template and duty phrases are functions; a trainee's escorted lessons a read of lessons", async () => {
    const { sb, sent } = client([[204, null], [204, null], [200, [{ id: 5, day: 0, start_min: 600, end_min: 690, title: null }]]]);
    const s = new SupabaseSettings(sb);
    await s.setConfirmTemplate(7, "נוסח לדוגמה {{פנייה}}");
    await s.setDutyPhrases(7, [{ when: "self_intro", text: "ניסוח לדוגמה" }]);
    expect(await s.rosterEscorts(7, 2)).toEqual([{ id: 5, day: 0, start_min: 600, end_min: 690, title: null }]);
    expect(sent.map((r) => [r.path, r.body])).toEqual([
      ["/rest/v1/rpc/set_confirm_template", { p_edition: 7, p_body: "נוסח לדוגמה {{פנייה}}" }],
      ["/rest/v1/rpc/set_duty_phrases", { p_edition: 7, p_phrases: [{ when: "self_intro", text: "ניסוח לדוגמה" }] }],
      ["/rest/v1/lessons", null],
    ]);
    expect(decodeURIComponent(sent[2].query)).toBe("?select=id,day,start_min,end_min,title&edition_id=eq.7&escort_roster_id=eq.2&order=day.asc,start_min.asc,id.asc");
  });
});
