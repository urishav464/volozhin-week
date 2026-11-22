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
    const { sb, sent } = client([[204, null], [204, null], [204, null], [204, null], [204, null], [204, null], [200, null]]);
    const c = supabaseCommands(sb, 7);
    await c.setPayment(41, 3, 500, "round_trip");
    await c.decidePayments([{ lesson_id: 41, version: 4 }, { lesson_id: 42, version: 1 }], "approved", "באצווה");
    await c.markConfirmSent(41, 5);
    await c.setEscort(41, 6, { roster_id: 2, self_intro: false, escort_note: null });
    await c.setSources(41, 7, { sources_kind: "presentation", print_when: "none", sources_note: null, presentation_url: "https://slides.example/a", in_reader: false });
    await c.setPaid(41, true);
    expect(await c.transport(41)).toBeNull();
    // set_transport_details: no screen calls it since the reset's phase 5 — the port has no command for it (CONTRACT)
    expect("setTransport" in c).toBe(false);
    expect(sent.map((r) => [r.path.replace("/rest/v1/rpc/", ""), r.body])).toEqual([
      ["set_payment", { p_lesson: 41, p_version: 3, p_pay_amount: 500, p_transport: "round_trip" }],
      ["decide_payments", { p_lessons: [41, 42], p_versions: [4, 1], p_decision: "approved", p_note: "באצווה" }],
      ["mark_confirm_sent", { p_lesson: 41, p_version: 5 }],
      ["set_escort", { p_lesson: 41, p_version: 6, p_roster: 2, p_self_intro: false, p_note: null }],
      ["set_sources", { p_lesson: 41, p_version: 7, p_kind: "presentation", p_print_when: "none", p_note: null, p_url: "https://slides.example/a", p_in_reader: false }],
      ["set_paid", { p_lesson: 41, p_paid: true }],
      ["get_transport_details", { p_lesson: 41 }],
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
    expect(await code(c.setTransportDriver(41, { driver_name: null }))).toBe("transport_hidden");
    expect(await code(c.setEscort(41, 1, { roster_id: 9, self_intro: false, escort_note: null }))).toBe("bad_escort");
    expect(await code(c.setPaid(41, true))).toBe("forbidden");
    expect(await code(c.setPayment(41, 1, null, "none"))).toMatch(/^raw:/); // schema.sql not re-run: a PortError, not a refusal
    expect(errorMessage("approval_pending")).toMatch(/^התשלום או ההסעה עוד ממתינים/);
  });

  it("v18: the two transport halves, the day's owners and «ראיתי» by their parameter names — a patch goes as the JSON object it is", async () => {
    const { sb, sent } = client([[204, null], [204, null], [204, null], [204, null], [204, null], [204, null], [204, null]]);
    const c = supabaseCommands(sb, 7);
    await c.setTransportRequest(41, { pickup_address: "כתובת לדוגמה", pickup_min: 435 });
    await c.setTransportRequest(41, { pickup_time: null, pickup_address: undefined }); // undefined is not sent: that field stays as it is
    await c.setTransportDriver(41, { driver_name: "נהג/ת לדוגמה", driver_phone: null, arranged: true });
    await c.setTransportDriver(41, {});
    await c.setDayOwners(2, [5, 3]);
    await c.setDayOwners(2, []);
    await c.markDaySeen(2);
    expect(sent.map((r) => [r.path.replace("/rest/v1/rpc/", ""), r.body])).toEqual([
      ["set_transport_request", { p_lesson: 41, p_fields: { pickup_address: "כתובת לדוגמה", pickup_min: 435 } }],
      ["set_transport_request", { p_lesson: 41, p_fields: { pickup_time: null } }],
      ["set_transport_driver", { p_lesson: 41, p_fields: { driver_name: "נהג/ת לדוגמה", driver_phone: null, arranged: true } }],
      ["set_transport_driver", { p_lesson: 41, p_fields: {} }],
      ["set_day_owners", { p_edition: 7, p_day: 2, p_members: [5, 3] }],
      ["set_day_owners", { p_edition: 7, p_day: 2, p_members: [] }],
      ["mark_day_seen", { p_edition: 7, p_day: 2 }],
    ]);
    expect(sent.every((r) => r.method === "POST")).toBe(true);
  });

  it("v18: the transports read says pending or approved and gives the pickup minute; a database from before it reads as approved, no minute", async () => {
    const five = { pickup_address: "כתובת לדוגמה", pickup_time: "07:15", driver_name: null, driver_phone: null, arranged: false };
    const { sb, sent } = client([
      [200, [{ lesson_id: "41", ...five, approval: "pending", pickup_min: "435" }, { lesson_id: 42, ...five, arranged: true, approval: "approved", pickup_min: null }]],
      [200, [{ lesson_id: 43, ...five }]], // v17's answer: approved transports only, neither key
      [200, null],
    ]);
    const c = supabaseCommands(sb, 7);
    expect(await c.transports()).toEqual([
      { lesson_id: 41, ...five, approval: "pending", pickup_min: 435 },
      { lesson_id: 42, ...five, arranged: true, approval: "approved", pickup_min: null },
    ]);
    expect(await c.transports()).toEqual([{ lesson_id: 43, ...five, approval: "approved", pickup_min: null }]);
    expect(await c.transports()).toEqual([]);
    expect(sent.map((r) => [r.path.replace("/rest/v1/rpc/", ""), r.body])).toEqual([["get_transports_for", { p_edition: 7 }], ["get_transports_for", { p_edition: 7 }], ["get_transports_for", { p_edition: 7 }]]);
  });

  it("v18: the new functions' refusals come back as their codes — and the one about a driver before the approval in Hebrew", async () => {
    const p0001 = (message: string): [number, unknown] => [400, { code: "P0001", message, details: null, hint: null }];
    const { sb } = client([p0001("not_handler"), p0001("no_transport"), p0001("transport_hidden"), p0001("bad_phone"), p0001("bad_value"), p0001("forbidden"), [403, { code: "42501", message: "permission denied for function set_day_owners" }], p0001("forbidden")]);
    const c = supabaseCommands(sb, 7);
    expect(await code(c.setTransportRequest(41, { pickup_time: "07:15" }))).toBe("not_handler");
    expect(await code(c.setTransportRequest(41, { pickup_min: 435 }))).toBe("no_transport");
    expect(await code(c.setTransportDriver(41, { arranged: true }))).toBe("transport_hidden");
    expect(await code(c.setTransportDriver(41, { driver_phone: "12-34" }))).toBe("bad_phone");
    expect(await code(c.setDayOwners(2, [1, 2, 3]))).toBe("bad_value");
    expect(await code(c.markDaySeen(2))).toBe("forbidden");
    expect(await code(c.setDayOwners(2, [1]))).toBe("forbidden");
    expect(await code(c.decidePayments([{ lesson_id: 41, version: 1 }], "approved"))).toBe("forbidden"); // a trainee, or staff of another edition
    expect(errorMessage("transport_hidden")).toBe("פרטי ההסעה גלויים רק למי שמטפל/ת במרצה, למדריך/ה, ולצוות הלוגיסטי מרגע שהתבקשה הסעה. פרטי הנהג/ת נקבעים אחרי האישור.");
  });

  it("settings: the templates and duty phrases are functions; a trainee's escorted lessons a read of lessons", async () => {
    const { sb, sent } = client([[204, null], [204, null], [204, null], [204, null], [200, [{ id: 5, day: 0, start_min: 600, end_min: 690, title: null }]]]);
    const s = new SupabaseSettings(sb);
    await s.setConfirmTemplate(7, "נוסח לדוגמה {{פנייה}}");
    await s.setDutyPhrases(7, [{ when: "self_intro", text: "ניסוח לדוגמה" }]);
    await s.setCallTemplate(7, "נקודות לדוגמה {{שמי}}");
    await s.setCallTemplate(7, null); // back to the instructor's built-in text
    expect(await s.rosterEscorts(7, 2)).toEqual([{ id: 5, day: 0, start_min: 600, end_min: 690, title: null }]);
    expect(sent.map((r) => [r.path, r.body])).toEqual([
      ["/rest/v1/rpc/set_confirm_template", { p_edition: 7, p_body: "נוסח לדוגמה {{פנייה}}" }],
      ["/rest/v1/rpc/set_duty_phrases", { p_edition: 7, p_phrases: [{ when: "self_intro", text: "ניסוח לדוגמה" }] }],
      ["/rest/v1/rpc/set_call_template", { p_edition: 7, p_body: "נקודות לדוגמה {{שמי}}" }],
      ["/rest/v1/rpc/set_call_template", { p_edition: 7, p_body: null }],
      ["/rest/v1/lessons", null],
    ]);
    expect(decodeURIComponent(sent[4].query)).toBe("?select=id,day,start_min,end_min,title&edition_id=eq.7&escort_roster_id=eq.2&order=day.asc,start_min.asc,id.asc");
  });
});
