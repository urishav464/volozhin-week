// After the week on the wire (SupabaseReviews and SupabaseSettings' v12 calls: the real supabase-js client, a stub
// fetch in place of PostgREST — every function by the parameter names tests/sql/after.test.ts pins, the answers read
// right, a refusal its code) and in the demo (DemoPort on the engine and DemoSettings: the same rules and codes as
// tests/sql/after.test.ts — the review window, the purge, start_edition's option and its dry run).
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { addDays, israelDate } from "../domain/israelTime";
import { CommandError } from "./commands";
import { DemoPort } from "./demoPort";
import { EMPTY_REVIEW } from "./reviews";
import { SupabaseReviews } from "./supabaseReviews";
import { SupabaseSettings } from "./supabaseSettings";

function client(answers: [number, unknown][]) {
  const sent: { path: string; body: unknown }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const text = await req.text();
    sent.push({ path: new URL(req.url).pathname.replace("/rest/v1/rpc/", ""), body: text ? JSON.parse(text) : null });
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
const today = () => israelDate(new Date().toISOString());

describe("after the week on the wire", () => {
  it("calls the review functions by their parameter names and reads their answers", async () => {
    const { sb, sent } = client([
      [200, [{ lesson_id: "4", speaker_id: "9", went_well: "x", issues: null, invite_again: "maybe", overran: true, rating: 3, written_by: "2", written_at: "2027-02-20T10:00:00.000Z", version: 2 }]],
      [200, 3],
      [200, [{ edition_id: "3", edition_label: "שנה קודמת", edition_kind: "real", start_date: "2026-02-15", lesson_id: "8", day: 0, start_min: 510, end_min: 600, title: null, went_well: null, issues: "y", invite_again: "no", overran: false, rating: null, written_at: "2026-02-20T10:00:00.000Z" }]],
      [200, [{ speaker_id: "9", editions: ["שנה קודמת"] }]],
      [400, { code: "P0001", message: "review_closed" }],
    ]);
    const r = new SupabaseReviews(sb);
    expect(await r.ofEdition(7)).toEqual([
      { lesson_id: 4, speaker_id: 9, went_well: "x", issues: null, invite_again: "maybe", overran: true, rating: 3, written_by: 2, written_at: "2027-02-20T10:00:00.000Z", version: 2 },
    ]);
    expect(await r.save(7, 4, 2, { went_well: "x", issues: null, invite_again: "yes", overran: false, rating: 5 })).toBe(3);
    expect((await r.ofSpeaker(9))[0]).toMatchObject({ edition_id: 3, lesson_id: 8, invite_again: "no", issues: "y" });
    expect(await r.returning(7)).toEqual([{ speaker_id: 9, editions: ["שנה קודמת"] }]);
    expect(await code(r.save(7, 4, 3, { ...EMPTY_REVIEW, went_well: "x" }))).toBe("review_closed");
    expect(sent.map((x) => [x.path, x.body])).toEqual([
      ["load_reviews", { p_edition: 7 }],
      ["save_lesson_review", { p_lesson: 4, p_version: 2, p_went_well: "x", p_issues: null, p_invite_again: "yes", p_overran: false, p_rating: 5 }],
      ["speaker_reviews", { p_speaker: 9 }],
      ["edition_returning", { p_edition: 7 }],
      ["save_lesson_review", { p_lesson: 4, p_version: 3, p_went_well: "x", p_issues: null, p_invite_again: null, p_overran: false, p_rating: null }],
    ]);
  });

  it("starts an edition with the option, previews it, purges with the typed label — by their parameter names", async () => {
    const preview = {
      archive: [{ id: "7", label: "תשפ\"ז" }], carry_from: { id: "7", label: "תשפ\"ז" }, grid_rows: "21", milestones: "2", confirm_template: true, call_template: true, duty_phrases: 1, deactivate: 4,
      admins_stay: 1, stays: { speakers: 60, categories: 10, fallen: 9, notes: 2 },
    };
    const { sb, sent } = client([[200, 8], [200, preview], [200, { transport_details: 3, import_notes: 4, links_revoked: 5, link_hits: 2, purged_at: "2027-02-20T10:00:00.000Z" }], [400, { code: "P0001", message: "confirm_mismatch" }]]);
    const s = new SupabaseSettings(sb);
    expect(await s.startEdition({ label: "תשפ\"ח", start_date: null, first_day_from: null }, { deactivateTeam: true })).toBe(8);
    expect(await s.previewStart(true)).toEqual({ ...preview, archive: [{ id: 7, label: "תשפ\"ז" }], carry_from: { id: 7, label: "תשפ\"ז" }, grid_rows: 21, milestones: 2 });
    expect(await s.purgeEdition(7, "תשפ\"ז")).toEqual({ transport_details: 3, import_notes: 4, links_revoked: 5, link_hits: 2, purged_at: "2027-02-20T10:00:00.000Z" });
    expect(await code(s.purgeEdition(7, "x"))).toBe("confirm_mismatch");
    expect(sent.map((x) => [x.path, x.body])).toEqual([
      ["start_edition", { p_label: "תשפ\"ח", p_start_date: null, p_first_day_from: null, p_deactivate_team: true }],
      ["start_edition_preview", { p_deactivate_team: true }],
      ["purge_edition_private", { p_edition: 7, p_confirm: "תשפ\"ז" }],
      ["purge_edition_private", { p_edition: 7, p_confirm: "x" }],
    ]);
  });
});

describe("after the week in the demo", () => {
  it("has three synthetic reviews in its week, and writes one as its admin at any time (the week's date TBD)", async () => {
    const port = new DemoPort();
    const reviews = await port.reviews.ofEdition(1);
    expect(reviews.map((r) => r.invite_again)).toEqual(["yes", "maybe", "no"]);
    expect(reviews.every((r) => (r.went_well ?? r.issues ?? "").includes("לדוגמה"))).toBe(true);
    const week = await port.loadWeek(1);
    const free = week.lessons.find((l) => l.state === "closed" && l.kind === "lesson" && !reviews.some((r) => r.lesson_id === l.id))!;
    expect(await port.reviews.save(1, free.id, 0, { ...EMPTY_REVIEW, went_well: "  נכתב בבדיקה  ", rating: 4 })).toBe(1);
    expect((await port.reviews.ofEdition(1)).find((r) => r.lesson_id === free.id)).toMatchObject({ went_well: "נכתב בבדיקה", rating: 4, version: 1, written_by: 1 });
    expect(await code(port.reviews.save(1, free.id, 0, { ...EMPTY_REVIEW, went_well: "שוב" }))).toBe("stale");
    // never in the Week (so never the offline copy)
    expect(JSON.stringify(await port.loadWeek(1))).not.toContain("נכתב בבדיקה");
  });

  it("closes a review to a content handler until the lesson's day has passed; never logistics", async () => {
    const content = new DemoPort({ memberId: 2, role: "content" });
    const week = await content.loadWeek(1);
    const mine = week.lessons.find((l) => {
      const lead = week.lessonSpeakers.find((x) => x.lesson_id === l.id && x.role === "lead");
      return l.state === "closed" && l.day === 1 && l.end_min <= 1440 && week.approaches.find((a) => a.speaker_id === lead?.speaker_id)?.owner_member_id === 2;
    })!;
    const fields = { ...EMPTY_REVIEW, went_well: "x" };
    expect(await code(content.reviews.save(1, mine.id, 0, fields))).toBe("review_closed"); // the week's date TBD
    content.engine(1).week.edition.start_date = today(); // Monday is tomorrow
    expect(await code(content.reviews.save(1, mine.id, 0, fields))).toBe("review_closed");
    content.engine(1).week.edition.start_date = addDays(today(), -2); // Monday was yesterday
    expect(await code(content.reviews.save(1, mine.id, 0, fields))).toBe("ok");
    const logistics = new DemoPort({ memberId: 5, role: "logistics" });
    expect(await logistics.reviews.ofEdition(1)).toEqual([]);
    expect(await code(logistics.reviews.save(1, mine.id, 0, fields))).toBe("forbidden");
    expect(await code(logistics.reviews.ofSpeaker(1))).toBe("forbidden");
    expect(await code(logistics.reviews.returning(1))).toBe("forbidden");
  });

  it("shows a speaker's past year across the years, and names the returning speakers", async () => {
    const port = new DemoPort();
    expect((await port.reviews.ofSpeaker(1)).map((r) => [r.edition_label, r.invite_again])).toEqual([["מחזור קודם (לדוגמה)", "yes"]]);
    expect(await port.reviews.ofSpeaker(2)).toEqual([]);
    // speaker 1 teaches this week's Sunday 08:30 and taught in the past edition; speaker 4 too (Monday 08:30)
    const returning = await port.reviews.returning(1);
    expect(returning.map((r) => r.speaker_id)).toEqual(expect.arrayContaining([1, 4]));
    expect(returning.find((r) => r.speaker_id === 1)?.editions).toEqual(["מחזור קודם (לדוגמה)"]);
  });

  it("purges only after the week (or in an archive), the label typed — the edition's transport details and links go, the rest stays", async () => {
    const port = new DemoPort();
    const s = port.settings;
    const engine = port.engine(1);
    expect(await code(s.purgeEdition(1, "הדגמה"))).toBe("week_not_over"); // the demo's date is TBD
    engine.week.edition.start_date = addDays(today(), -4);
    expect(await code(s.purgeEdition(1, "הדגמה"))).toBe("week_not_over"); // Thursday
    engine.week.edition.start_date = addDays(today(), -5);
    expect(await code(s.purgeEdition(1, "הדגמה2"))).toBe("confirm_mismatch");
    const transport = Object.keys(port.shared.transport).filter((k) => k.startsWith("1:")).length;
    const live = port.shared.links.filter((l) => l.edition_id === 1 && l.revoked_at == null).length;
    expect(transport).toBeGreaterThan(0);
    expect(live).toBeGreaterThan(0);
    const before = { lessons: engine.week.lessons.length, roster: engine.week.roster.length, ticks: engine.week.escortTicks.length, reviews: port.shared.reviews.length, contacts: Object.keys(port.shared.contacts).length };
    const report = await s.purgeEdition(1, " הדגמה ");
    expect(report).toMatchObject({ transport_details: transport, import_notes: 0, links_revoked: live });
    expect(Object.keys(port.shared.transport).filter((k) => k.startsWith("1:"))).toEqual([]);
    expect(port.shared.links.filter((l) => l.edition_id === 1 && l.revoked_at == null)).toEqual([]);
    expect({ lessons: engine.week.lessons.length, roster: engine.week.roster.length, ticks: engine.week.escortTicks.length, reviews: port.shared.reviews.length, contacts: Object.keys(port.shared.contacts).length }).toEqual(before);
    expect((await port.editions())[0].purged_at).toBe(report.purged_at);
    // the anon pages refuse the edition's links now
    const token = port.shared.links.find((l) => l.edition_id === 1 && l.scope === "schedule")!.token;
    expect(await code(port.public.scheduleView(token))).toBe("link_invalid");
    // again: nothing more, the first time kept, and logged with counts only
    expect(await s.purgeEdition(1, "הדגמה")).toEqual({ transport_details: 0, import_notes: 0, links_revoked: 0, link_hits: 0, purged_at: report.purged_at });
    const logged = port.shared.log.filter((x) => x.kind === "purge");
    const keys = ["import_notes", "link_hits", "links_revoked", "transport_details"];
    expect(logged.map((x) => Object.keys(x.detail).sort())).toEqual([keys, keys]);
    // a content member may not
    expect(await code(new DemoPort({ memberId: 2, role: "content" }).settings.purgeEdition(1, "הדגמה"))).toBe("forbidden");
  });

  it("the dry run answers what start_edition would do, writes nothing — and the real thing deactivates exactly that team", async () => {
    const port = new DemoPort();
    const s = port.settings;
    // the demo week is a demo: nothing real to archive yet
    expect(await s.previewStart(true)).toMatchObject({ archive: [], carry_from: null, deactivate: 0, grid_rows: 21 });
    const real = await s.startEdition({ label: "מחזור לדוגמה", start_date: null, first_day_from: null });
    await s.addMember({ email: "content.demo@example.org", display_name: "תוכן לדוגמה", gender: null, role: "content", edition_id: real });
    await s.addMember({ email: "logistics.demo@example.org", display_name: "לוגיסטיקה לדוגמה", gender: null, role: "logistics", edition_id: real });
    const members = JSON.stringify(port.members);
    const preview = await s.previewStart(true);
    expect(preview).toMatchObject({ archive: [{ id: real, label: "מחזור לדוגמה" }], carry_from: { id: real }, deactivate: 2, admins_stay: 0 });
    expect((await s.previewStart(false)).deactivate).toBe(0);
    expect(JSON.stringify(port.members)).toBe(members); // nothing written
    const next = await s.startEdition({ label: "מחזור לדוגמה ב", start_date: null, first_day_from: null }, { deactivateTeam: true });
    expect(port.members.filter((m) => m.edition_id === real).map((m) => m.active)).toEqual([false, false]);
    expect(port.members.filter((m) => m.edition_id == null).every((m) => m.active)).toBe(true);
    expect((await port.editions()).find((e) => e.id === real)?.status).toBe("archived");
    expect(next).toBeGreaterThan(real);
    // without the option, nobody is deactivated
    await s.addMember({ email: "content.next@example.org", display_name: "תוכן ב", gender: null, role: "content", edition_id: next });
    await s.startEdition({ label: "מחזור לדוגמה ג", start_date: null, first_day_from: null });
    expect(port.members.find((m) => m.email === "content.next@example.org")?.active).toBe(true);
    // an edition's admin, not of every edition: not theirs to rehearse
    port.members[0].edition_id = real;
    expect(await code(s.previewStart(true))).toBe("forbidden");
  });
});
