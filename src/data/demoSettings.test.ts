// The demo's settings refuse what the database refuses (tests/sql/settings.test.ts),
// with the same codes — so a preview link teaches the real behaviour.
import { describe, expect, it } from "vitest";
import { CommandError } from "./commands";
import { DemoPort } from "./demoPort";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${String(e)}`;
  }
};

describe("demo settings", () => {
  it("adds a member with a normalised address, once per edition", async () => {
    const port = new DemoPort();
    const s = port.settings;
    const added = await s.addMember({ email: "  New.Member@Example.org ", display_name: " חבר/ת  צוות לדוגמה ", gender: null, role: "content", edition_id: 1 });
    expect(added).toMatchObject({ email: "new.member@example.org", display_name: "חבר/ת צוות לדוגמה", active: true });
    expect(await code(s.addMember({ email: "new.member@example.org", display_name: "שוב", gender: null, role: "logistics", edition_id: 1 }))).toBe("member_exists");
    expect(await code(s.addMember({ email: "not-an-address", display_name: "x", gender: null, role: "content", edition_id: 1 }))).toBe("bad_email");
    expect(await code(s.addMember({ email: "x@example.org", display_name: "  ", gender: null, role: "content", edition_id: 1 }))).toBe("name_required");
    // the grid's team follows
    expect((await port.loadWeek(1)).team.map((t) => t.display_name)).toContain("חבר/ת צוות לדוגמה");
  });

  it("deletes only a member with no history; deactivating keeps the row", async () => {
    const port = new DemoPort();
    const s = port.settings;
    const fresh = await s.addMember({ email: "fresh@example.org", display_name: "חדש/ה", gender: "f", role: "content", edition_id: 1 });
    expect(await code(s.deleteMember(2))).toBe("member_has_history"); // owns approaches in the demo week
    await s.updateMember(2, { active: false });
    expect((await s.members(1)).find((m) => m.id === 2)?.active).toBe(false);
    expect(await code(s.deleteMember(fresh.id))).toBe("ok");
    expect((await s.members(1)).some((m) => m.id === fresh.id)).toBe(false);
  });

  it("never lets an admin lock themselves out, and sets their own name everywhere", async () => {
    const port = new DemoPort();
    const s = port.settings;
    expect(await code(s.updateMember(1, { active: false }))).toBe("self_lockout");
    expect(await code(s.updateMember(1, { role: "content" }))).toBe("self_lockout");
    expect(await code(s.deleteMember(1))).toBe("self_lockout");
    await s.setMyProfile({ display_name: "מדריך/ה לדוגמה", gender: "f" });
    const me = await port.whoami();
    expect(me.status === "ok" && me.display_name).toBe("מדריך/ה לדוגמה");
  });

  it("keeps the roster unique by name key and adds only the new names", async () => {
    const s = new DemoPort().settings;
    const seeded = (await s.roster(1)).length; // the demo's escorts (DEMO_ROSTER)
    expect(await s.addRoster(1, [{ full_name: "חניך/ה לדוגמה 01", gender: null }, { full_name: "חניך/ה לדוגמה 02", gender: "f" }])).toBe(2);
    expect(await s.addRoster(1, [{ full_name: "חניך/ה  לדוגמה-01", gender: null }, { full_name: "חניך/ה לדוגמה 03", gender: null }])).toBe(1);
    const list = (await s.roster(1)).filter((r) => r.full_name.startsWith("חניך/ה"));
    expect(list.map((r) => r.full_name)).toEqual(["חניך/ה לדוגמה 01", "חניך/ה לדוגמה 02", "חניך/ה לדוגמה 03"]);
    expect(await code(s.updateRoster(list[1].id, { full_name: "חניך/ה לדוגמה 01" }))).toBe("roster_exists");
    await s.deleteRoster(list[2].id);
    expect(await s.roster(1)).toHaveLength(seeded + 2);
  });

  it("deleting a trainee who escorts leaves their lessons without an escort — listed first (lessons_escort_roster_fk)", async () => {
    const port = new DemoPort();
    const s = port.settings;
    const escorts = await s.rosterEscorts(1, 2);
    expect(escorts.map((l) => [l.day, l.start_min])).toEqual([[0, 600], [0, 690]]);
    await s.deleteRoster(2);
    expect(await s.rosterEscorts(1, 2)).toEqual([]);
    const week = await port.loadWeek(1);
    expect(week.roster.some((r) => r.id === 2)).toBe(false);
    expect(week.lessons.filter((l) => l.escort_roster_id === 2)).toEqual([]);
  });

  it("keeps the template and the duty phrases on the edition — an admin's, cleaned as the database cleans them; a new edition carries them over", async () => {
    const port = new DemoPort();
    const s = port.settings;
    expect((await port.loadWeek(1)).edition.settings.confirm_template).toBeUndefined(); // never seeded
    await s.setConfirmTemplate(1, "  נוסח לדוגמה {{פנייה}}\r\n");
    await s.setDutyPhrases(1, [{ when: "always", text: " ניסוח לדוגמה " }, { when: "always", text: "ניסוח לדוגמה" }]);
    expect(await code(s.setDutyPhrases(1, [{ when: "sometimes" as "always", text: "x" }]))).toBe("bad_value");
    const settings = (await port.loadWeek(1)).edition.settings;
    expect(settings.confirm_template).toBe("נוסח לדוגמה {{פנייה}}");
    expect(settings.duty_phrases).toEqual([{ when: "always", text: "ניסוח לדוגמה" }]);
    // the demo edition is not a real one: the first real edition starts without them …
    const first = await s.startEdition({ label: "מחזור לדוגמה", start_date: null, first_day_from: null });
    expect((await port.loadWeek(first)).edition.settings.confirm_template).toBeUndefined();
    await s.setConfirmTemplate(first, "נוסח לדוגמה {{פנייה}}");
    await s.setDutyPhrases(first, [{ when: "self_intro", text: "ניסוח לדוגמה" }]);
    // … and the next real edition inherits the instructor's own
    const next = await s.startEdition({ label: "מחזור לדוגמה ב", start_date: null, first_day_from: null });
    expect((await port.loadWeek(next)).edition.settings).toMatchObject({ confirm_template: "נוסח לדוגמה {{פנייה}}", duty_phrases: [{ when: "self_intro", text: "ניסוח לדוגמה" }] });
    await s.setConfirmTemplate(next, "   ");
    expect((await port.loadWeek(next)).edition.settings.confirm_template).toBeUndefined();
  });

  it("keeps «נקודות לשיחה» on the edition only once an admin writes them (v14) — the dry run says so, and the next edition carries them", async () => {
    const port = new DemoPort();
    const s = port.settings;
    expect((await port.loadWeek(1)).edition.settings.call_template).toBeUndefined(); // the instructor's text lives in the code, never seeded
    const first = await s.startEdition({ label: "מחזור לדוגמה", start_date: null, first_day_from: null });
    expect((await s.previewStart(false)).call_template).toBe(false);
    await s.setCallTemplate(first, "  נקודות לדוגמה {{שמי}}\r\n");
    expect((await port.loadWeek(first)).edition.settings.call_template).toBe("נקודות לדוגמה {{שמי}}");
    expect(await code(s.setCallTemplate(first, "א".repeat(4001)))).toBe("bad_value");
    expect(await code(new DemoPort({ memberId: 2, role: "content" }).settings.setCallTemplate(1, "נקודות לדוגמה"))).toBe("forbidden");
    expect((await s.previewStart(false)).call_template).toBe(true);
    const next = await s.startEdition({ label: "מחזור לדוגמה ב", start_date: null, first_day_from: null });
    expect((await port.loadWeek(next)).edition.settings.call_template).toBe("נקודות לדוגמה {{שמי}}");
    await s.setCallTemplate(next, null); // «חזרה לנוסח של המדריך/ה»
    expect((await port.loadWeek(next)).edition.settings.call_template).toBeUndefined();
  });

  it("guards the default room and rooms in use; the default moves in one step", async () => {
    const port = new DemoPort();
    const s = port.settings;
    expect(await code(s.deleteRoom(1))).toBe("room_default");
    expect(await code(s.deleteRoom(2))).toBe("room_in_use"); // the demo's parallel lesson
    expect(await code(s.addRoom(1, "בית מדרש"))).toBe("room_exists");
    await s.addRoom(1, "חדר לדוגמה");
    const added = (await s.rooms(1)).find((r) => r.name === "חדר לדוגמה")!;
    expect(added).toMatchObject({ sort: 4, is_default: false });
    await s.setDefaultRoom(added.id);
    expect((await s.rooms(1)).filter((r) => r.is_default).map((r) => r.id)).toEqual([added.id]);
    await s.reorderRooms(1, [added.id, 1, 2, 3]);
    expect((await s.rooms(1)).map((r) => r.id)).toEqual([added.id, 1, 2, 3]);
    expect(await code(s.deleteRoom(3))).toBe("ok");
    expect((await port.loadWeek(1)).rooms.map((r) => r.id)).toEqual([1, 2, added.id]);
  });

  it("deactivates a used category instead of deleting it; colours come from the palette", async () => {
    const port = new DemoPort();
    const s = port.settings;
    expect(await code(s.deleteCategory(3))).toBe("category_in_use");
    await s.updateCategory(3, { active: false });
    expect((await port.loadWeek(1)).categories.find((c) => c.id === 3)?.active).toBe(false);
    expect(await code(s.addCategory({ name: "קטגוריה לדוגמה", color: "red" }))).toBe("bad_color");
    expect(await code(s.addCategory({ name: 'תנ"ך', color: "#a23b3b" }))).toBe("category_exists");
    await s.addCategory({ name: "קטגוריה לדוגמה", color: "#A23B3B" });
    const added = (await s.categories()).find((c) => c.name === "קטגוריה לדוגמה")!;
    expect(added).toMatchObject({ color: "#a23b3b", sort: 11, active: true });
    expect(await code(s.updateCategory(added.id, { color: "blue" }))).toBe("bad_color");
    // a colour typed in the SQL Editor before the palette stays until someone changes it
    const legacy = port.categories.find((c) => c.id === 4)!;
    legacy.color = "red";
    expect(await code(s.updateCategory(legacy.id, { active: false }))).toBe("ok");
    expect(await code(s.reorderCategories([legacy.id, ...(await s.categories()).filter((c) => c.id !== legacy.id).map((c) => c.id)]))).toBe("ok");
    expect(await code(s.updateCategory(legacy.id, { name: "שם חדש לדוגמה" }))).toBe("ok");
    expect(await code(s.deleteCategory(added.id))).toBe("ok");
  });

  it("opens a new real edition: label required and unique, the date a Sunday or TBD, the old real one archived", async () => {
    const port = new DemoPort();
    const s = port.settings;
    expect(await code(s.startEdition({ label: " ", start_date: null, first_day_from: null }))).toBe("label_required");
    expect(await code(s.startEdition({ label: "הדגמה", start_date: null, first_day_from: null }))).toBe("edition_exists");
    expect(await code(s.startEdition({ label: "מחזור לדוגמה", start_date: "2027-02-15", first_day_from: null }))).toBe("not_sunday");
    expect(await code(s.startEdition({ label: "מחזור לדוגמה", start_date: null, first_day_from: 200 }))).toBe("bad_time");
    const first = await s.startEdition({ label: "מחזור לדוגמה", start_date: null, first_day_from: null });
    const second = await s.startEdition({ label: "מחזור לדוגמה ב", start_date: "2027-02-14", first_day_from: 510 });
    const eds = await port.editions();
    expect(eds.map((e) => [e.label, e.kind, e.status])).toEqual([
      ["מחזור לדוגמה ב", "real", "planning"],
      ["מחזור לדוגמה", "real", "archived"],
      ["הדגמה", "demo", "planning"],
    ]);
    expect(eds.find((e) => e.id === first)).toMatchObject({ start_date: null, first_day_from: null });
    const week = await port.loadWeek(second);
    expect(week.rooms).toEqual([expect.objectContaining({ name: "בית מדרש", is_default: true })]);
    expect(week.lessons).toEqual([]);
    expect(week.rows.length).toBe(21);
    await s.updateEdition(second, { start_date: null, first_day_from: null });
    expect((await port.editions())[0]).toMatchObject({ start_date: null, first_day_from: null });
  });

  it("moving the week's date after messages went out asks to tell those speakers (app.editions_reconfirm); setting it the first time does not", async () => {
    const port = new DemoPort();
    const s = port.settings;
    const sent = (w: Awaited<ReturnType<typeof port.loadWeek>>) => w.lessons.filter((l) => l.state === "closed" && l.confirm_sent_at != null);
    const before = sent(await port.loadWeek(1));
    expect(before.length).toBeGreaterThan(1);
    const quiet = before.filter((l) => !l.needs_reconfirm);
    expect(quiet.length).toBeGreaterThan(0);
    await s.updateEdition(1, { start_date: "2027-02-14", first_day_from: 510 }); // TBD → a date: no message had one
    expect(sent(await port.loadWeek(1)).filter((l) => l.needs_reconfirm).length).toBe(before.length - quiet.length);
    await s.updateEdition(1, { start_date: "2027-02-21", first_day_from: 510 });
    const after = sent(await port.loadWeek(1));
    expect(after.every((l) => l.needs_reconfirm)).toBe(true);
    for (const l of quiet) expect(after.find((x) => x.id === l.id)?.version).toBe(l.version + 1);
    // a draft or an unsent lesson is not flagged
    expect((await port.loadWeek(1)).lessons.filter((l) => l.needs_reconfirm && l.confirm_sent_at == null)).toEqual([]);
  });
});
