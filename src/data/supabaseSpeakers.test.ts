// SupabaseSpeakers on the wire: the real supabase-js client, a stub fetch in
// place of PostgREST. tests/sql/speakers.test.ts pins the functions' parameter
// names in the database; this pins that the port sends exactly those, reads
// the answers right, and turns every refusal into its code.
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { errorMessage } from "../errors";
import { CommandError } from "./commands";
import { SupabaseSpeakers } from "./supabaseSpeakers";

function port(answers: [number, unknown][]) {
  const sent: { method: string; path: string; body: unknown }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const text = await req.text();
    sent.push({ method: req.method, path: new URL(req.url).pathname, body: text ? JSON.parse(text) : null });
    const [status, body] = answers.shift() ?? [404, {}];
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  const sb = createClient("https://stub.supabase.co", "stub-publishable-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  return { s: new SupabaseSpeakers(sb), sent };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${String(e)}`;
  }
};

describe("SupabaseSpeakers on the wire", () => {
  it("calls every pool function by its parameter names", async () => {
    const { s, sent } = port([
      [200, []], [200, { speaker_id: 41, approach_id: null }], [204, null], [204, null], [200, null], [204, null], [200, []], [200, []],
      [200, 17], [204, null], [204, null], [204, null], [204, null],
    ]);
    await s.matches("פלונית");
    expect(await s.create(7, { name: "פלונית", gender: "f", topics: ["תנ״ך"] }, { claim: true, confirmed: true })).toEqual({ speaker_id: 41, approach_id: null });
    await s.update(7, 41, 3, { bio_short: "ביו" });
    await s.vet([41, 42], "approved", "נבדק");
    expect(await s.contacts(41)).toBeNull();
    await s.setContacts(41, { phone: "555 0100 99", email: null, secretary_note: null, notes: null });
    await s.history(41);
    await s.activity(41);
    expect(await s.claim(7, 41)).toBe(17);
    await s.setStatus(7, 17, 2, "approached", "שלחתי");
    await s.handOver(7, 17, 3);
    await s.answerHandOver(7, 17, false);
    await s.setSlotAvailability(7, 41, 2, 14, "cannot", null);
    expect(sent.map((r) => [r.path.replace("/rest/v1/rpc/", ""), r.body])).toEqual([
      ["speaker_matches", { p_name: "פלונית" }],
      ["create_speaker", { p_edition: 7, p_fields: { name: "פלונית", gender: "f", topics: ["תנ״ך"] }, p_claim: true, p_approve: false, p_confirmed: true }],
      ["update_speaker", { p_edition: 7, p_speaker: 41, p_version: 3, p_patch: { bio_short: "ביו" } }],
      ["vet_speakers", { p_speakers: [41, 42], p_state: "approved", p_note: "נבדק" }],
      ["get_speaker_contacts", { p_speaker: 41 }],
      ["set_speaker_contacts", { p_speaker: 41, p_phone: "555 0100 99", p_email: null, p_secretary_note: null, p_notes: null }],
      ["speaker_history", { p_speaker: 41 }],
      ["speaker_activity", { p_speaker: 41 }],
      ["claim_speaker", { p_edition: 7, p_speaker: 41 }],
      ["set_approach_status", { p_approach: 17, p_version: 2, p_status: "approached", p_note: "שלחתי" }],
      ["hand_over", { p_approach: 17, p_to: 3, p_note: null }],
      ["answer_handover", { p_approach: 17, p_accept: false, p_note: null }],
      ["set_slot_availability", { p_edition: 7, p_speaker: 41, p_day: 2, p_row: 14, p_kind: "cannot", p_note: null }],
    ]);
    expect(sent.every((r) => r.method === "POST")).toBe(true);
  });

  it("v18: availability by ranges goes by its parameter names — the ranges as {day, start, end, kind} alone — and answers how many slots it marked", async () => {
    const { s, sent } = port([[200, 3], [200, "0"], [400, { code: "P0001", message: "bad_value", details: null, hint: null }], [400, { code: "P0001", message: "speaker_retired", details: null, hint: null }]]);
    const ranges = [{ day: 1 as const, start: 510, end: 780, kind: "can" as const }, { day: 1 as const, start: 650, end: 700, kind: "cannot" as const }];
    expect(await s.setAvailabilityRanges(7, 41, [1], ranges, "cannot")).toBe(3);
    // what an editor's row might carry besides (an id, a label) never goes on the wire: an extra key would be refused
    expect(await s.setAvailabilityRanges(7, 41, [3, 1], [{ ...ranges[0], id: "r1", label: "בוקר" } as never])).toBe(0);
    expect(await code(s.setAvailabilityRanges(7, 41, [1], [{ day: 2, start: 510, end: 600, kind: "can" }]))).toBe("bad_value");
    expect(await code(s.setAvailabilityRanges(7, 41, [1], []))).toBe("speaker_retired");
    expect(sent.map((r) => [r.path.replace("/rest/v1/rpc/", ""), r.body])).toEqual([
      ["set_availability_ranges", { p_edition: 7, p_speaker: 41, p_days: [1], p_ranges: [{ day: 1, start: 510, end: 780, kind: "can" }, { day: 1, start: 650, end: 700, kind: "cannot" }], p_rest: "cannot" }],
      ["set_availability_ranges", { p_edition: 7, p_speaker: 41, p_days: [3, 1], p_ranges: [{ day: 1, start: 510, end: 780, kind: "can" }], p_rest: null }],
      ["set_availability_ranges", { p_edition: 7, p_speaker: 41, p_days: [1], p_ranges: [{ day: 2, start: 510, end: 600, kind: "can" }], p_rest: null }],
      ["set_availability_ranges", { p_edition: 7, p_speaker: 41, p_days: [1], p_ranges: [], p_rest: null }],
    ]);
  });

  it("v19: the photo (get_speaker_photo, set_speaker_photo) and public_ok (set_public_ok) by their parameter names", async () => {
    const { s, sent } = port([
      [200, { photo: "QUJD", uploaded_at: "2026-11-19T10:00:00.000Z" }], [200, null], [204, null], [204, null], [204, null],
      [400, { code: "P0001", message: "bad_file", details: null, hint: null }],
    ]);
    expect(await s.photo(41)).toEqual({ photo: "QUJD", uploaded_at: "2026-11-19T10:00:00.000Z" });
    expect(await s.photo(42)).toBeNull();
    await s.setPhoto(7, 41, "QUJD");
    await s.setPhoto(7, 41, null);
    await s.setPublicOk(7, 17, 3, true);
    expect(await code(s.setPhoto(7, 41, "abc"))).toBe("bad_file");
    expect(sent.map((r) => [r.path.replace("/rest/v1/rpc/", ""), r.body])).toEqual([
      ["get_speaker_photo", { p_speaker: 41 }],
      ["get_speaker_photo", { p_speaker: 42 }],
      ["set_speaker_photo", { p_edition: 7, p_speaker: 41, p_photo: "QUJD" }],
      ["set_speaker_photo", { p_edition: 7, p_speaker: 41, p_photo: null }],
      ["set_public_ok", { p_approach: 17, p_version: 3, p_ok: true }],
      ["set_speaker_photo", { p_edition: 7, p_speaker: 41, p_photo: "abc" }],
    ]);
  });

  it("reads contacts as four fields, and the matches, history and timeline as numbers where ids are", async () => {
    const { s } = port([
      [200, { phone: "555 0100 99", email: null, secretary_note: "דרך המזכירות", notes: null }],
      [200, [{ id: 3, title: null, name: "פלונית", disambiguator: null, gender: "f", affiliation: null, vetted: "approved", retired: false, match: "similar", similarity: 0.6923077 }]],
      [200, [{ id: 9, at: "2026-11-01T10:00:00Z", actor: 2, edition_id: null, entity: "speakers", entity_id: 3, kind: "vet", detail: { vetted: "approved", note: null } }]],
    ]);
    expect(await s.contacts(3)).toEqual({ phone: "555 0100 99", email: null, secretary_note: "דרך המזכירות", notes: null });
    expect((await s.matches("פלונית"))[0]).toMatchObject({ id: 3, match: "similar", similarity: 0.6923077 });
    expect((await s.activity(3))[0]).toMatchObject({ id: 9, actor: 2, edition_id: null, entity_id: 3, kind: "vet" });
  });

  it("turns the database's refusals into their codes — and so into Hebrew", async () => {
    const p0001 = (message: string): [number, unknown] => [400, { code: "P0001", message, details: null, hint: null }];
    const { s } = port([p0001("speaker_similar"), p0001("contacts_hidden"), p0001("not_handler"), p0001("bad_member"), p0001("outside_grid"), [403, { code: "42501", message: "permission denied for function vet_speakers" }], [404, { code: "PGRST202", message: "Could not find the function" }]]);
    expect(await code(s.create(7, { name: "פלונית" }))).toBe("speaker_similar");
    expect(await code(s.setContacts(3, { phone: null, email: null, secretary_note: null, notes: null }))).toBe("contacts_hidden");
    expect(await code(s.setStatus(7, 17, 1, "positive"))).toBe("not_handler");
    expect(await code(s.handOver(7, 17, 5))).toBe("bad_member");
    expect(await code(s.setSlotAvailability(7, 3, 0, 1, "can"))).toBe("outside_grid"); // a row not in play that day
    expect(await code(s.vet([3], "approved"))).toBe("forbidden");
    expect(await code(s.matches("x"))).toMatch(/^raw:/); // schema.sql not re-run: a PortError, not a refusal
    expect(errorMessage("speaker_similar")).toMatch(/^ייתכן שהמרצה כבר במאגר/);
  });
});
