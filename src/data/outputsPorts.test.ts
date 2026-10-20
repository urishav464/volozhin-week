// The outputs' and the knowledge base's two ports. On the wire (the real
// supabase-js client, a stub fetch): the phones are one get_contacts_for call
// by its parameter name, a snapshot one insert of the edition, kind and rows —
// never an author or a time — a note's save carries the version it saw, and an
// empty answer under RLS is a refusal, not «saved». In the demo: the same
// refusals, done_at's first time kept, snapshots with the public keys only,
// phones only through the contacts rule, and milestones carried to a new edition.
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { CommandError } from "./commands";
import { DemoPort } from "./demoPort";
import { SupabaseKnowledge, SupabaseOutputs } from "./supabaseOutputs";
import type { DesignerRow } from "../exports/designer";

interface Sent {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

function stub(answers: [number, unknown][]) {
  const sent: Sent[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const u = new URL(req.url);
    const text = await req.text();
    sent.push({ method: req.method, path: u.pathname, query: u.searchParams, body: text ? JSON.parse(text) : null });
    const [status, body] = answers.shift() ?? [404, {}];
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  const sb = createClient("https://stub.supabase.co", "stub-publishable-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  return { outputs: new SupabaseOutputs(sb), knowledge: new SupabaseKnowledge(sb), sent };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${String(e)}`;
  }
};

const ROW: DesignerRow = { lesson_id: 3, kind: "lesson", day: "ראשון", date: "TBD", time: "08:30–09:45", speaker: "מרצה לדוגמה", title: "כותרת", category: "", room: "בית מדרש", parallel: false };

describe("SupabaseOutputs and SupabaseKnowledge on the wire", () => {
  it("asks for phones in one get_contacts_for call, by its parameter name", async () => {
    const { outputs, sent } = stub([[200, [{ lesson_id: "3", speaker_id: "9", phone: "טלפון לדוגמה" }]]]);
    expect(await outputs.phones(7, [3, 4])).toEqual([{ lesson_id: 3, speaker_id: 9, phone: "טלפון לדוגמה" }]);
    expect(sent.map((r) => [r.method, r.path, r.body])).toEqual([["POST", "/rest/v1/rpc/get_contacts_for", { p_lessons: [3, 4] }]]);
    expect(await outputs.phones(7, [])).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("saves a snapshot as one insert of edition, kind and rows — RLS's empty answer is a refusal", async () => {
    const { outputs, sent } = stub([[201, [{ id: 1 }]], [201, []]]);
    await outputs.saveSnapshot(7, "designer", [ROW]);
    expect(sent[0]).toMatchObject({ method: "POST", path: "/rest/v1/export_snapshots", body: { edition_id: 7, kind: "designer", payload: [ROW] } });
    expect(await code(outputs.saveSnapshot(7, "designer", []))).toBe("forbidden");
  });

  it("reads the edition's snapshots newest first, as rows", async () => {
    const { outputs, sent } = stub([[200, [{ id: "2", kind: "designer", payload: [ROW], created_by: "1", created_at: "2026-11-10T10:00:00Z" }]]]);
    expect(await outputs.snapshots(7, "designer")).toEqual([{ id: 2, kind: "designer", rows: [ROW], created_by: 1, created_at: "2026-11-10T10:00:00Z" }]);
    expect(sent[0].query.get("edition_id")).toBe("eq.7");
    expect(sent[0].query.get("order")).toBe("created_at.desc,id.desc");
  });

  it("saves a note at the version it saw, and reads «nothing changed» as stale", async () => {
    const { knowledge, sent } = stub([[200, [{ id: 5 }]], [200, []], [400, { code: "P0001", message: "title_required" }]]);
    await knowledge.updateNote(5, 3, { title: "  כותרת   חדשה ", body_md: "גוף\r\n" });
    expect(sent[0]).toMatchObject({ method: "PATCH", path: "/rest/v1/notes", body: { title: "כותרת חדשה", body_md: "גוף" } });
    expect([sent[0].query.get("id"), sent[0].query.get("version")]).toEqual(["eq.5", "eq.3"]);
    expect(await code(knowledge.updateNote(5, 3, { body_md: "x" }))).toBe("stale");
    expect(await code(knowledge.addNote({ edition_id: null, section: "process", title: "x", body_md: "" }))).toBe("title_required");
    // a title the browser already knows is empty never leaves it
    expect(await code(knowledge.addNote({ edition_id: null, section: "process", title: "   ", body_md: "" }))).toBe("title_required");
    expect(sent).toHaveLength(3);
  });

  it("reads the cross-year notes and the edition's in one request", async () => {
    const { knowledge, sent } = stub([[200, []]]);
    await knowledge.notes(7);
    expect(sent[0].query.get("or")).toBe("(edition_id.is.null,edition_id.eq.7)");
  });

  it("marks a milestone done with any time (the database stamps its own) and writes no author", async () => {
    const { knowledge, sent } = stub([[200, [{ id: 2 }]], [200, [{ id: 2 }]], [201, [{ id: 3 }]]]);
    await knowledge.setMilestoneDone(2, true);
    await knowledge.setMilestoneDone(2, false);
    await knowledge.addMilestone(7, { title: "אבן דרך לדוגמה", days_before: 42 });
    expect(typeof (sent[0].body as { done_at: unknown }).done_at).toBe("string");
    expect(sent[1].body).toEqual({ done_at: null });
    expect(sent[2].body).toEqual({ edition_id: 7, title: "אבן דרך לדוגמה", days_before: 42 });
    expect(await code(knowledge.addMilestone(7, { title: "x", days_before: 400 }))).toBe("bad_value");
    expect(await code(knowledge.addMilestone(7, { title: "x", days_before: 1.5 }))).toBe("bad_value");
  });
});

describe("the demo's outputs and knowledge base", () => {
  it("phones only through the contacts rule, for the lessons asked", async () => {
    const p = new DemoPort();
    const w = await p.loadWeek(1);
    const ids = w.lessons.map((l) => l.id);
    const phones = await p.outputs.phones(1, ids);
    // the demo user is the global admin: every speaker with a phone on file
    expect(phones.length).toBeGreaterThan(0);
    for (const x of phones) expect(x.phone).toBe("טלפון לדוגמה");
    // a handler in a demo week sees none: a sandbox gives no contacts (app.contacts_edition counts real editions only)
    const content = new DemoPort({ memberId: 1, role: "content" });
    expect(w.approaches.some((a) => a.owner_member_id === 1 && phones.some((x) => x.speaker_id === a.speaker_id))).toBe(true);
    expect(await content.outputs.phones(1, ids)).toEqual([]);
  });

  it("keeps snapshots with the public schedule's keys only, newest first", async () => {
    const p = new DemoPort();
    await p.outputs.saveSnapshot(1, "designer", [ROW]);
    await p.outputs.saveSnapshot(1, "designer", [{ ...ROW, title: "חדשה" }]);
    const list = await p.outputs.snapshots(1, "designer");
    expect(list.map((x) => x.rows[0].title)).toEqual(["חדשה", "כותרת"]);
    expect(list[0].created_by).toBe(1);
    expect(await code(p.outputs.saveSnapshot(1, "designer", [{ ...ROW, phone: "x" } as DesignerRow]))).toBe("bad_value");
  });

  it("refuses what the database refuses, and keeps a milestone's first «done»", async () => {
    const p = new DemoPort();
    const k = p.knowledge;
    expect(await code(k.addNote({ edition_id: 1, section: "process", title: " ", body_md: "" }))).toBe("title_required");
    expect(await code(k.addNote({ edition_id: 1, section: "gossip" as never, title: "x", body_md: "" }))).toBe("bad_value");
    await k.addNote({ edition_id: 1, section: "challenges", title: "  אתגר   לדוגמה ", body_md: "" });
    const n = (await k.notes(1)).find((x) => x.title === "אתגר לדוגמה")!;
    await k.updateNote(n.id, n.version, { body_md: "גוף" });
    expect(await code(k.updateNote(n.id, n.version, { body_md: "ישן" }))).toBe("stale");
    const [m] = await k.milestones(1);
    await k.setMilestoneDone(m.id, true);
    const first = (await k.milestones(1)).find((x) => x.id === m.id)!.done_at;
    await k.setMilestoneDone(m.id, true);
    expect((await k.milestones(1)).find((x) => x.id === m.id)!.done_at).toBe(first);
    await k.setMilestoneDone(m.id, false);
    expect((await k.milestones(1)).find((x) => x.id === m.id)).toMatchObject({ done_at: null, done_by: null });
    expect(await code(k.addMilestone(1, { title: "x", days_before: -91 }))).toBe("bad_value");
  });

  it("lets a content member read but not write", async () => {
    const p = new DemoPort();
    p.members.find((m) => m.id === 1)!.role = "content";
    p.members.find((m) => m.id === 1)!.edition_id = 1;
    expect((await p.knowledge.notes(1)).length).toBeGreaterThan(0);
    expect(await code(p.knowledge.addNote({ edition_id: 1, section: "process", title: "x", body_md: "" }))).toBe("forbidden");
    expect(await code(p.knowledge.addMilestone(1, { title: "x", days_before: 1 }))).toBe("forbidden");
    expect(await code(p.outputs.saveSnapshot(1, "designer", []))).toBe("forbidden");
    expect(await p.outputs.snapshots(1, "designer")).toEqual([]);
  });

  it("carries the milestones to a new real edition, none of them done", async () => {
    const p = new DemoPort();
    const id = await p.settings.startEdition({ label: "מחזור לדוגמה", start_date: null, first_day_from: null });
    // the demo's own edition is a demo, not real: nothing to carry from
    expect(await p.knowledge.milestones(id)).toEqual([]);
    await p.knowledge.addMilestone(id, { title: "אבן דרך לדוגמה", days_before: 14 });
    await p.knowledge.setMilestoneDone((await p.knowledge.milestones(id))[0].id, true);
    const next = await p.settings.startEdition({ label: "מחזור לדוגמה ב", start_date: null, first_day_from: null });
    expect((await p.knowledge.milestones(next)).map((m) => [m.title, m.days_before, m.done_at])).toEqual([["אבן דרך לדוגמה", 14, null]]);
  });
});
