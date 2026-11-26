// `?as=logistics` (the reset, phase 3): the demo acts as the edition's logistics member — in a `real` edition, so a
// request can be decided and a driver set as in production — and the transport board has synthetic pickups and staff
// shifts to draw. The default and the trainee's demos keep no pickup_min and the rota's own three staff shifts.
import { describe, expect, it } from "vitest";
import { photoToBase64 } from "../domain/photo";
import { CommandError } from "./commands";
import { demoPhotoBytes } from "./demoPhoto";
import { DEMO_LOGISTICS, DEMO_TRAINEE, DemoPort } from "./demoPort";
import { DEMO_GUEST_BIOS, DEMO_GUEST_NOTE, demoLogisticsStart } from "./demoWeek";
import { Engine } from "./engine";
import { personaOf } from "./gate";

const NOW = "2026-11-19T10:00:00.000Z";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${String(e)}`;
  }
};

const logisticsDemo = () => new DemoPort(DEMO_LOGISTICS, { logistics: true });

describe("the logistics demo", () => {
  it("signs in as «לוגיסטיקה (הדגמה)»: logistics, member 5, of edition 1", async () => {
    const port = logisticsDemo();
    const w = await port.whoami();
    if (w.status !== "ok") throw new Error(w.status);
    expect(w).toMatchObject({ email: "demo@example.org", display_name: "לוגיסטיקה (הדגמה)", global_admin: false });
    expect(w.memberships).toEqual([{ edition_id: 1, role: "logistics", member_id: 5 }]);
    expect(personaOf(w, 1)).toBe("logistics");
    // the instructor keeps their place in the team, with the address logistics had
    expect(port.members.find((m) => m.id === 1)).toMatchObject({ email: "team.d@example.org", role: "admin", edition_id: null });
    expect(new Set(port.members.map((m) => m.email)).size).toBe(port.members.length);
  });

  it("the edition is real, and the board's three transports have synthetic pickup times", async () => {
    const port = logisticsDemo();
    const week = await port.loadWeek(1);
    expect(week.edition.kind).toBe("real");
    const closedAt = (day: number, start: number) => week.lessons.find((l) => l.kind === "lesson" && l.state === "closed" && l.day === day && l.start_min === start)!;
    const rows = await port.commands(1).transports();
    const of = (day: number, start: number) => rows.find((t) => t.lesson_id === closedAt(day, start).id);
    expect(of(0, 510)).toMatchObject({ approval: "approved", pickup_min: 435, arranged: true });
    expect(of(1, 510)).toMatchObject({ approval: "pending", pickup_time: "06:10", pickup_min: 370 });
    expect(of(3, 600)).toMatchObject({ approval: "approved", pickup_address: "כתובת לדוגמה", pickup_time: "08:45", pickup_min: 525, driver_name: null, arranged: false });
    expect(JSON.stringify(week)).not.toMatch(/pickup_min|כתובת לדוגמה/); // never in a Week
  });

  it("decides a request, then sets its driver — never before the approval", async () => {
    const port = logisticsDemo();
    const cmds = port.commands(1);
    const monday = (await port.loadWeek(1)).lessons.find((l) => l.kind === "lesson" && l.state === "closed" && l.day === 1 && l.start_min === 510)!;
    expect(monday.approval).toBe("pending");
    expect(await code(cmds.setTransportDriver(monday.id, { driver_name: "נהג/ת לדוגמה" }))).toBe("transport_hidden");
    await cmds.decidePayments([{ lesson_id: monday.id, version: monday.version }], "approved", null);
    expect((await port.loadWeek(1)).lessons.find((l) => l.id === monday.id)).toMatchObject({ approval: "approved", approved_by: 5 });
    await cmds.setTransportDriver(monday.id, { driver_name: "נהג/ת לדוגמה", driver_phone: "555 0100", arranged: true });
    expect((await cmds.transports()).find((t) => t.lesson_id === monday.id)).toMatchObject({ driver_name: "נהג/ת לדוגמה", driver_phone: "555 0100", arranged: true, pickup_min: 370 });
    // a second answer on the same version is stale: one approval decides
    expect(await code(cmds.decidePayments([{ lesson_id: monday.id, version: monday.version }], "rejected", null))).toBe("stale");
  });

  it("the rota has two more staff shifts: a typed name on Monday morning, the logistics member's on Wednesday (v20: no kind)", async () => {
    const port = logisticsDemo();
    const staff = (await port.rota.load(1)).staff;
    expect(staff).toHaveLength(5);
    expect(staff.find((s) => s.day === 1 && s.start_min === 390)).toMatchObject({ end_min: 720, member_id: null, name: "איש/אשת צוות לדוגמה ב׳" });
    expect(staff.find((s) => s.day === 3 && s.start_min === 510)).toMatchObject({ end_min: 870, member_id: 5 });
    expect(staff.every((s) => !("kind" in s))).toBe(true);
  });
});

describe("the other demos keep no pickup times and the rota's own staff shifts", () => {
  for (const [name, make] of [
    ["the default (the global admin)", () => new DemoPort()],
    ["the trainee's", () => new DemoPort(DEMO_TRAINEE, { trainee: true })],
  ] as const) {
    it(name, async () => {
      const port = make();
      expect(Object.values(port.shared.transport).every((t) => (t as { pickup_min?: number | null }).pickup_min == null)).toBe(true);
      expect((await port.rota.load(1)).staff).toHaveLength(3);
    });
  }
});

describe("v19 (the reset, phase 4): the logistics home's demo", () => {
  it("`?as=logistics`: a date three weeks ahead (a Sunday), «ב» can drive, «ד» helps in no duty and has no groups, a shopping list — and every demo's guests' sample", async () => {
    const port = new DemoPort(DEMO_LOGISTICS, { logistics: true, now: () => NOW });
    const week = await port.loadWeek(1);
    expect(week.edition.start_date).toBe(demoLogisticsStart(NOW));
    const rota = await port.rota.load(1);
    const helps = (id: number) => rota.cohortDuties.some((x) => x.cohort_id === id);
    expect(rota.cohorts.map((c) => [c.letter, helps(c.id), c.can_drive])).toEqual([["א", true, false], ["ב", true, true], ["נ", true, false], ["ד", false, false]]);
    // v20: the one that does not help has no groups, but is on campus (Wednesday and Thursday) with its trainees and diets
    const dalet = rota.cohorts.find((c) => c.letter === "ד")!;
    expect(rota.groups.filter((g) => g.cohort_id === dalet.id)).toEqual([]);
    expect(new Set(rota.presence.filter((p) => p.cohort_id === dalet.id).map((p) => p.day))).toEqual(new Set([3, 4]));
    expect(dalet).toMatchObject({ trainees: 30, diet_veg: 4, diet_gf: 2, diet_both: 1, contact_name: "איש/אשת קשר לדוגמה ד" });
    expect(rota.prep.filter((p) => p.kind === "item").map((p) => [p.text, p.qty, p.done])).toEqual([
      ["פריט לדוגמה 1", "2 (לדוגמה)", false],
      ["פריט לדוגמה 2", "2 (לדוגמה)", false],
    ]);
    expect(rota.prep.filter((p) => p.kind === "task").every((p) => p.qty === null)).toBe(true);
    // the guests' schedule shows every demo's two approved speakers (a link the demo's instructor issues — logistics issues none)
    const { token } = new Engine(port.engine(1).week, { memberId: 1, role: "admin", global: true }, undefined, port.shared).issueLink("schedule");
    const view = await port.public.scheduleView(token);
    expect(view.people.map((p) => [p.bio, p.photo != null])).toEqual([["תיאור לדוגמה", true], ["תיאור לדוגמה ב׳", false]]);
  });

  it("the default demo and `?as=trainee` stay as they were: no date, every cohort helping, none driving, no items", async () => {
    for (const port of [new DemoPort(), new DemoPort(DEMO_TRAINEE, { trainee: true })]) {
      const week = await port.loadWeek(1);
      expect(week.edition.start_date).toBeNull();
      const rota = await port.rota.load(1);
      expect(rota.cohorts.every((c) => rota.cohortDuties.some((x) => x.cohort_id === c.id) && c.can_drive === false)).toBe(true);
      expect(rota.prep.every((p) => p.kind === "task" && p.qty === null)).toBe(true);
    }
  });
});

describe("the reset, phase 5: the guests' sample and the presentations, in every demo", () => {
  const demos = () => [new DemoPort(), new DemoPort(DEMO_TRAINEE, { trainee: true }), new DemoPort(DEMO_LOGISTICS, { logistics: true, now: () => NOW })];
  const closedAt = (week: Awaited<ReturnType<DemoPort["loadWeek"]>>, day: number, start: number, room = 1) =>
    week.lessons.find((l) => l.kind === "lesson" && l.state === "closed" && l.day === day && l.start_min === start && l.room_id === room)!;
  const leadOf = (week: Awaited<ReturnType<DemoPort["loadWeek"]>>, lessonId: number) => week.lessonSpeakers.find((x) => x.lesson_id === lessonId && x.role === "lead")!.speaker_id;

  it("two lessons with a description; Sunday's 08:30 lead approved with a description and the photo, Tuesday's 16:00 with a description only; Sunday's 14:30 lead not approved", async () => {
    for (const port of demos()) {
      const week = await port.loadWeek(1);
      const notes = week.lessons.filter((l) => l.public_note != null);
      expect(notes.map((l) => [l.day, l.start_min, l.public_note])).toEqual([
        [0, 510, DEMO_GUEST_NOTE],
        [3, 600, DEMO_GUEST_NOTE],
      ]);
      const full = leadOf(week, closedAt(week, 0, 510).id);
      const bioOnly = leadOf(week, closedAt(week, 2, 960, 1).id);
      const notMarked = leadOf(week, closedAt(week, 0, 870).id);
      expect(week.approaches.filter((a) => a.public_ok).map((a) => a.speaker_id)).toEqual([full, bioOnly]);
      expect(week.speakers.find((s) => s.id === full)).toMatchObject({ public_bio: DEMO_GUEST_BIOS.photo, has_photo: true });
      expect(week.speakers.find((s) => s.id === bioOnly)).toMatchObject({ public_bio: DEMO_GUEST_BIOS.bioOnly, has_photo: false });
      expect(week.speakers.find((s) => s.id === notMarked)).toMatchObject({ public_bio: DEMO_GUEST_BIOS.notMarked, has_photo: false });
      expect(week.approaches.find((a) => a.speaker_id === notMarked)?.public_ok).toBe(false);
      expect(week.speakers.filter((s) => s.public_bio != null)).toHaveLength(3);
      expect(Object.keys(port.shared.photos).map(Number)).toEqual([full]);
      expect((await port.speakers.photo(full))?.photo).toBe(photoToBase64(demoPhotoBytes()));
      // Sunday's 08:30 is «חניך/ה א׳»'s speaker: the trainee may take the mark back
      expect(week.approaches.find((a) => a.speaker_id === full)?.owner_member_id).toBe(DEMO_TRAINEE.memberId);
    }
  });

  it("two lessons' presentations and the week's deck — PDFs, kind «presentation», never in the reader; every file readable by the team", async () => {
    for (const port of demos()) {
      const week = await port.loadWeek(1);
      const decks = week.sourceFiles.filter((f) => f.kind === "presentation");
      expect(decks.map((f) => [f.lesson_id, f.display_name, f.mime, f.cover])).toEqual([
        [closedAt(week, 0, 510).id, "מצגת לדוגמה.pdf", "application/pdf", false],
        [closedAt(week, 2, 960, 2).id, "שקפים לדוגמה.pdf", "application/pdf", false],
        [null, "המצגת המלווה לשבוע (לדוגמה).pdf", "application/pdf", false],
      ]);
      expect(decks[2].storage_path).toMatch(/^1\/cover\//);
      expect(decks[0].speaker_id).toBe(leadOf(week, closedAt(week, 0, 510).id));
      expect(new Set(week.sourceFiles.map((f) => f.id)).size).toBe(week.sourceFiles.length);
      expect(week.sourceFiles.filter((f) => f.kind !== "presentation")).toHaveLength(4); // seedDemoSources' own, unchanged
      for (const f of decks) expect(port.shared.objects[f.storage_path]).toMatchObject({ mime: "application/pdf", size: f.size_bytes });
      expect(port.samples.get(decks[0].storage_path)).toMatchObject({ kind: "pdf", heading: "מצגת לדוגמה", size: [960, 540] });
    }
  });

});
