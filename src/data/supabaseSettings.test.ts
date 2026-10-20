// SupabaseSettings on the wire: the real supabase-js client, a stub fetch in
// place of PostgREST. The SQL tests prove the database and demoSettings.test.ts
// the demo; this proves the real port asks the database the right way and reads
// its answers right — a regression here would otherwise reach production only.
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { errorMessage } from "../errors";
import { CommandError } from "./commands";
import { SupabaseSettings } from "./supabaseSettings";

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
    sent.push({ method: req.method, path: u.pathname, query: u.searchParams, prefer: req.headers.get("prefer") ?? "", body: text ? JSON.parse(text) : null });
    const [status, body] = answers.shift() ?? [404, {}];
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  const sb = createClient("https://stub.supabase.co", "stub-publishable-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  return { s: new SupabaseSettings(sb), sent };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${String(e)}`;
  }
};

describe("SupabaseSettings on the wire", () => {
  it("pastes the roster as one insert that skips names already there (never a merge: no UPDATE grant on roster.edition_id)", async () => {
    const { s, sent } = port([[201, [{ id: 11 }, { id: 12 }]]]);
    expect(await s.addRoster(7, [{ full_name: " חניך/ה  לדוגמה 01 ", gender: "f" }, { full_name: "חניך/ה לדוגמה 02", gender: null }, { full_name: "חניך/ה לדוגמה 03", gender: null }])).toBe(2);
    expect(sent).toHaveLength(1);
    const [r] = sent;
    expect([r.method, r.path]).toEqual(["POST", "/rest/v1/roster"]);
    expect(r.query.get("on_conflict")).toBe("edition_id,name_key");
    expect(r.prefer).toContain("resolution=ignore-duplicates");
    expect(r.prefer).toContain("return=representation");
    expect(r.body).toEqual([
      { edition_id: 7, full_name: "חניך/ה לדוגמה 01", gender: "f" },
      { edition_id: 7, full_name: "חניך/ה לדוגמה 02", gender: null },
      { edition_id: 7, full_name: "חניך/ה לדוגמה 03", gender: null },
    ]);
  });

  it("reads a write RLS filtered out (no row back) as «forbidden», never as saved", async () => {
    const { s, sent } = port([[200, []]]);
    expect(await code(s.updateMember(5, { display_name: "שם לדוגמה", gender: "m", role: "content", active: true }))).toBe("forbidden");
    expect([sent[0].method, sent[0].path, sent[0].query.get("id")]).toEqual(["PATCH", "/rest/v1/members", "eq.5"]);
    expect(sent[0].body).toEqual({ display_name: "שם לדוגמה", gender: "m", role: "content", active: true });
  });

  it("sends a member's four editable columns only — never an address or an edition", async () => {
    const { s, sent } = port([[200, [{ id: 5 }]]]);
    const sneaky = { display_name: "שם לדוגמה", email: "sock@example.org", edition_id: 9 } as unknown as Parameters<SupabaseSettings["updateMember"]>[1];
    expect(await code(s.updateMember(5, sneaky))).toBe("ok");
    expect(sent[0].body).toEqual({ display_name: "שם לדוגמה" });
  });

  it("turns the database's own refusals (P0001) into their codes — and so into Hebrew", async () => {
    const p0001 = (message: string): [number, unknown] => [400, { code: "P0001", message, details: null, hint: null }];
    const { s, sent } = port([p0001("member_has_history"), p0001("room_in_use"), p0001("room_default"), p0001("category_in_use"), p0001("self_lockout"), p0001("bad_color")]);
    expect(await code(s.deleteMember(5))).toBe("member_has_history");
    expect(await code(s.deleteRoom(3))).toBe("room_in_use");
    expect(await code(s.deleteRoom(1))).toBe("room_default");
    expect(await code(s.deleteCategory(2))).toBe("category_in_use");
    expect(await code(s.updateMember(1, { active: false }))).toBe("self_lockout");
    expect(await code(s.updateCategory(4, { name: "שם לדוגמה" }))).toBe("bad_color");
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual([
      "DELETE /rest/v1/members",
      "DELETE /rest/v1/rooms",
      "DELETE /rest/v1/rooms",
      "DELETE /rest/v1/categories",
      "PATCH /rest/v1/members",
      "PATCH /rest/v1/categories",
    ]);
    expect(errorMessage("room_in_use")).toMatch(/^יש שיעורים בחדר הזה/);
  });

  it("maps Postgres codes: a duplicate per table, a missing grant or RLS, a value out of range", async () => {
    const { s } = port([
      [409, { code: "23505", message: 'duplicate key value violates unique constraint "members_email_edition_key"' }],
      [403, { code: "42501", message: 'new row violates row-level security policy for table "members"' }],
      [409, { code: "23505", message: "duplicate key value" }],
      [400, { code: "23514", message: "new row violates check constraint" }],
    ]);
    expect(await code(s.addMember({ email: "a@example.org", display_name: "שם לדוגמה", gender: null, role: "content", edition_id: 7 }))).toBe("member_exists");
    expect(await code(s.addMember({ email: "b@example.org", display_name: "שם לדוגמה", gender: null, role: "admin", edition_id: 7 }))).toBe("forbidden");
    expect(await code(s.renameRoom(3, "בית מדרש"))).toBe("room_exists");
    expect(await code(s.updateRoster(4, { gender: "f" }))).toBe("bad_value");
  });

  it("calls set_my_profile and set_default_room by their parameter names", async () => {
    const { s, sent } = port([[204, null], [204, null]]);
    await s.setMyProfile({ display_name: "  מדריך/ה   לדוגמה ", gender: "f" });
    await s.setDefaultRoom(3);
    expect(sent.map((r) => [r.method, r.path, r.body])).toEqual([
      ["POST", "/rest/v1/rpc/set_my_profile", { p_display_name: "מדריך/ה לדוגמה", p_gender: "f" }],
      ["POST", "/rest/v1/rpc/set_default_room", { p_room: 3 }],
    ]);
  });
});
