// The import's two ports. DemoImports runs the engine's twin of public.import_commit (tests/parity holds the two
// equal): an archive becomes one more demo edition, «לימד/ה אצלנו» shows it, a re-run replaces it, a bad row leaves
// everything as it was. SupabaseImports on the wire: the real supabase-js client and a stub fetch — the parameter
// names, the answers read, a refused row turned into its ImportRowError. Synthetic data only.
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { CommandError } from "./commands";
import { DemoPort } from "./demoPort";
import { ImportRowError, type SpeakerRow } from "./imports";
import { SupabaseImports } from "./supabaseImports";

const row = (n: number, name: string, extra: Partial<SpeakerRow> = {}): SpeakerRow => ({
  row: n, action: "new", speaker_id: null, title: null, name, gender: null, affiliation: null, topics: [], phone: null, email: null, notes: null, ...extra,
});

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof ImportRowError) return `${e.code} ${e.row}:${e.reason}`;
    return e instanceof CommandError ? e.code : `raw:${String(e)}`;
  }
};

describe("DemoImports — the engine's import, in the demo", () => {
  it("adds candidates to the one pool (pending), completes a pool speaker by its name key, and adds no one on a re-run", async () => {
    const d = new DemoPort();
    const before = (await d.imports.pool()).length;
    const payload = { source: "brainstorm-5786", titles_from: null, rows: [row(2, "מרצה לדוגמה 1", { title: "הרב", gender: "m" as const, phone: "0000000001" }), row(3, "מרצה-07", { affiliation: "מוסד אחר" })] };
    const res = await d.imports.commit({ kind: "candidates", payload });
    expect(res).toMatchObject({ created: 1, merged: 1, filled: 0, contacts: 1 });
    const pool = await d.imports.pool();
    expect(pool).toHaveLength(before + 1);
    expect(pool.find((s) => s.name === "מרצה לדוגמה 1")).toMatchObject({ title: "הרב", gender: "m", vetted: "pending" });
    expect(pool.find((s) => s.name === "מרצה 07")!.affiliation).toBe("מוסד לדוגמה"); // never overwritten
    // every edition sees the same pool
    const [first] = await d.editions();
    expect((await d.loadWeek(first.id)).speakers).toHaveLength(before + 1);
    expect(await d.imports.commit({ kind: "candidates", payload })).toMatchObject({ created: 0, merged: 2 });
    expect(await d.imports.pool()).toHaveLength(before + 1);
    // the lookup: the phone it stored, by key — and booleans only
    const id = pool.find((s) => s.name === "מרצה לדוגמה 1")!.id;
    expect(await d.imports.lookup([], ["0000000001"])).toEqual({ phones: [{ key: "0000000001", speaker_id: id }], contacts: [{ speaker_id: id, phone: true, email: false, secretary_note: false, notes: false }] });
  });

  it("makes the archive an edition of its own: closed lessons, its speakers' history, the same label replacing it", async () => {
    const d = new DemoPort();
    const editions = (await d.editions()).length;
    const lesson = (n: number, start: number, speakers: number[], room = 0) => ({
      row: n, day: 0 as const, start_min: start, end_min: start + 90, room, title: `שיעור לדוגמה ${n}`, category_id: 1, audience: null,
      sources_kind: "sheet" as const, print_when: "none" as const, sources_note: null, pay_amount: null, import_note: null, speakers,
    });
    const payload = {
      label: "תשפ\"ו (לדוגמה)", start_date: null, source: "tracking-5786", titles_from: null,
      speakers: [row(2, "מרצה לדוגמה 9"), row(3, "מרצה 07")],
      lessons: [lesson(2, 510, [0]), lesson(3, 510, [1], 1), lesson(4, 600, [1, 0])],
    };
    const res = await d.imports.commit({ kind: "tracking", payload });
    expect(res).toMatchObject({ created: 1, merged: 1, lessons: 3, replaced: 0 });
    const all = await d.editions();
    expect(all).toHaveLength(editions + 1);
    const archive = all.find((e) => e.label === payload.label)!;
    expect(archive).toMatchObject({ kind: "archive", status: "archived", start_date: null });
    const w = await d.loadWeek(archive.id);
    expect(w.rooms.map((r) => r.name)).toEqual(["בית מדרש", "מקביל 2"]);
    expect(w.lessons.map((l) => [l.state, l.start_min, w.rooms.find((r) => r.id === l.room_id)!.name])).toEqual([
      ["closed", 510, "בית מדרש"],
      ["closed", 510, "מקביל 2"],
      ["closed", 600, "בית מדרש"],
    ]);
    const seven = (await d.imports.pool()).find((s) => s.name === "מרצה 07")!.id;
    const h = await d.speakers.history(seven);
    expect(h.filter((x) => x.edition_id === archive.id).map((x) => [x.edition_kind, x.start_min, x.role])).toEqual([
      ["archive", 510, "lead"],
      ["archive", 600, "lead"],
    ]);
    // again, with one lesson: replaced, the same edition
    expect(await d.imports.commit({ kind: "tracking", payload: { ...payload, lessons: [lesson(2, 510, [0])] } })).toMatchObject({ created: 0, merged: 2, lessons: 1, replaced: 3, edition_id: archive.id });
    expect(await d.editions()).toHaveLength(editions + 1);
    expect((await d.loadWeek(archive.id)).lessons).toHaveLength(1);
  });

  it("all or nothing: a bad row refuses the import, naming it — the pool, the contacts and the editions as they were", async () => {
    const d = new DemoPort();
    const [pool, editions] = [(await d.imports.pool()).length, (await d.editions()).length];
    expect(await failure(d.imports.commit({ kind: "candidates", payload: { source: "x", titles_from: null, rows: [row(2, "מרצה חדש/ה"), row(3, "מרצה", { phone: "12" })] } }))).toBe(
      "import_bad_row 3:bad_phone",
    );
    const lesson = { row: 5, day: 0 as const, start_min: 512, end_min: 600, room: 0, title: null, category_id: null, audience: null, sources_kind: "pending" as const, print_when: "none" as const, sources_note: null, pay_amount: null, import_note: null, speakers: [0] };
    expect(await failure(d.imports.commit({ kind: "tracking", payload: { label: "בדיקה", start_date: null, source: "x", titles_from: null, speakers: [row(2, "מרצה חדש/ה")], lessons: [lesson] } }))).toBe(
      "import_bad_row 5:bad_shape",
    );
    expect((await d.imports.pool()).length).toBe(pool);
    expect((await d.editions()).length).toBe(editions);
    expect(await failure(d.imports.commit({ kind: "tracking", payload: { label: "הדגמה", start_date: null, source: "x", titles_from: null, speakers: [], lessons: [] } }))).toBe("edition_exists");
  });

  it("the escorts' file: the channel and the note only where empty", async () => {
    const d = new DemoPort();
    const seven = (await d.imports.pool()).find((s) => s.name === "מרצה 07")!;
    expect(await d.imports.commit({ kind: "escorts", payload: { rows: [{ row: 2, speaker_id: seven.id, contact_pref: "secretary", secretary_note: "דרך המזכירה" }] } })).toMatchObject({ filled: 1 });
    expect((await d.imports.pool()).find((s) => s.id === seven.id)!.contact_pref).toBe("secretary");
    expect((await d.speakers.contacts(seven.id))!.secretary_note).toBe("דרך המזכירה");
    expect(await d.imports.commit({ kind: "escorts", payload: { rows: [{ row: 2, speaker_id: seven.id, contact_pref: "phone", secretary_note: "אחר" }] } })).toMatchObject({ filled: 0, contacts: 0 });
    expect((await d.speakers.contacts(seven.id))!.secretary_note).toBe("דרך המזכירה");
  });

  it("only a global admin", async () => {
    const d = new DemoPort({ memberId: 2, role: "admin", global: false });
    expect(await failure(d.imports.commit({ kind: "candidates", payload: { source: "x", titles_from: null, rows: [] } }))).toBe("forbidden");
    expect(await failure(d.imports.lookup([], []))).toBe("forbidden");
  });
});

function wire(answers: [number, unknown][]) {
  const sent: { path: string; body: unknown }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const text = await req.text();
    sent.push({ path: `${new URL(req.url).pathname}${new URL(req.url).search}`, body: text ? JSON.parse(text) : null });
    const [status, body] = answers.shift() ?? [404, {}];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  const sb = createClient("https://stub.supabase.co", "stub-publishable-key", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch } });
  return { s: new SupabaseImports(sb), sent };
}

describe("SupabaseImports on the wire", () => {
  it("calls import_lookup and import_commit by their parameter names, and reads the answers", async () => {
    const { s, sent } = wire([
      [200, { phones: [{ key: "0000000001", speaker_id: "41" }], contacts: [{ speaker_id: 41, phone: true, email: false, secretary_note: false, notes: true }] }],
      [200, { created: 1, merged: 0, filled: 0, contacts: 1, notes: 1, lessons: 0, replaced: 0, edition_id: null, speakers: [{ row: 2, speaker_id: "42", created: true }] }],
      [200, [{ id: 41, name: "מרצה לדוגמה", name_key: "מרצה לדוגמה", topics: null, version: 1 }]],
    ]);
    expect(await s.lookup([41], ["0000000001"])).toEqual({ phones: [{ key: "0000000001", speaker_id: 41 }], contacts: [{ speaker_id: 41, phone: true, email: false, secretary_note: false, notes: true }] });
    const payload = { source: "brainstorm-5786", titles_from: null, rows: [row(2, "מרצה לדוגמה")] };
    expect(await s.commit({ kind: "candidates", payload })).toEqual({ created: 1, merged: 0, filled: 0, contacts: 1, notes: 1, lessons: 0, replaced: 0, edition_id: null, speakers: [{ row: 2, speaker_id: 42, created: true }] });
    expect((await s.pool())[0]).toMatchObject({ id: 41, topics: [] });
    expect(sent.slice(0, 2).map((r) => [r.path, r.body])).toEqual([
      ["/rest/v1/rpc/import_lookup", { p_speakers: [41], p_phone_keys: ["0000000001"] }],
      ["/rest/v1/rpc/import_commit", { p_kind: "candidates", p_payload: payload }],
    ]);
    // the pool: the speakers' own columns — never speaker_contacts
    expect(sent[2].path).toMatch(/^\/rest\/v1\/speakers\?select=id%2Ctitle%2Cname/);
    expect(decodeURIComponent(sent[2].path)).not.toMatch(/phone|email|secretary|notes|contacts/);
  });

  it("turns a refused row into its ImportRowError, any other refusal into its code", async () => {
    const { s } = wire([
      [400, { code: "P0001", message: "import_bad_row", details: "7:bad_phone", hint: null }],
      [400, { code: "P0001", message: "edition_exists", details: null, hint: null }],
      [403, { code: "42501", message: "permission denied for function import_commit", details: null, hint: null }],
    ]);
    const c = { kind: "candidates" as const, payload: { source: "x", titles_from: null, rows: [] } };
    expect(await failure(s.commit(c))).toBe("import_bad_row 7:bad_phone");
    expect(await failure(s.commit(c))).toBe("edition_exists");
    expect(await failure(s.commit(c))).toBe("forbidden");
  });
});
