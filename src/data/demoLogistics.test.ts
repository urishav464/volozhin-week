// `?as=logistics` (the reset, phase 3): the demo acts as the edition's logistics member — in a `real` edition, so a
// request can be decided and a driver set as in production — and the transport board has synthetic pickups and staff
// shifts to draw. The default and the trainee's demos keep no pickup_min and the rota's own three staff shifts.
import { describe, expect, it } from "vitest";
import { photoToBase64 } from "../domain/photo";
import { CommandError } from "./commands";
import { demoPhotoBytes } from "./demoPhoto";
import { DEMO_LOGISTICS, DEMO_TRAINEE, DemoPort } from "./demoPort";
import { demoLogisticsStart } from "./demoWeek";
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

  it("the rota has two more staff shifts: a typed name on Monday morning, the logistics member leading Wednesday", async () => {
    const port = logisticsDemo();
    const staff = (await port.rota.load(1)).staff;
    expect(staff).toHaveLength(5);
    expect(staff.find((s) => s.day === 1 && s.start_min === 390)).toMatchObject({ end_min: 720, member_id: null, name: "איש/אשת צוות לדוגמה ב׳", kind: "shift" });
    expect(staff.find((s) => s.day === 3 && s.start_min === 510)).toMatchObject({ end_min: 870, member_id: 5, kind: "lead" });
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
  it("`?as=logistics`: a date three weeks ahead (a Sunday), the two flags, a shopping list, one approved speaker with a photo", async () => {
    const port = new DemoPort(DEMO_LOGISTICS, { logistics: true, now: () => NOW });
    const week = await port.loadWeek(1);
    expect(week.edition.start_date).toBe(demoLogisticsStart(NOW));
    const rota = await port.rota.load(1);
    expect(rota.cohorts.map((c) => [c.letter, c.helps_rota, c.can_drive])).toEqual([["א", true, false], ["ב", true, true], ["נ", false, false]]);
    expect(rota.prep.filter((p) => p.kind === "item").map((p) => [p.text, p.qty, p.done])).toEqual([
      ["פריט לדוגמה 1", "2 (לדוגמה)", false],
      ["פריט לדוגמה 2", "2 (לדוגמה)", false],
    ]);
    expect(rota.prep.filter((p) => p.kind === "task").every((p) => p.qty === null)).toBe(true);
    const sunday = week.lessons.find((l) => l.kind === "lesson" && l.day === 0 && l.start_min === 510 && l.state === "closed")!;
    const lead = week.lessonSpeakers.find((x) => x.lesson_id === sunday.id && x.role === "lead")!.speaker_id;
    expect(week.approaches.filter((a) => a.public_ok).map((a) => a.speaker_id)).toEqual([lead]);
    expect(week.speakers.find((s) => s.id === lead)).toMatchObject({ public_bio: "תיאור לדוגמה", has_photo: true });
    expect((await port.speakers.photo(lead))?.photo).toBe(photoToBase64(demoPhotoBytes()));
    // the guests' schedule shows them (a link the demo's instructor issues — logistics issues none)
    const { token } = new Engine(port.engine(1).week, { memberId: 1, role: "admin", global: true }, undefined, port.shared).issueLink("schedule");
    const view = await port.public.scheduleView(token);
    expect(view.people.map((p) => [p.bio, p.photo != null])).toEqual([["תיאור לדוגמה", true]]);
  });

  it("the default demo and `?as=trainee` stay as they were: no date, no flags set, no items, nobody approved, no photo", async () => {
    for (const port of [new DemoPort(), new DemoPort(DEMO_TRAINEE, { trainee: true })]) {
      const week = await port.loadWeek(1);
      expect(week.edition.start_date).toBeNull();
      const rota = await port.rota.load(1);
      expect(rota.cohorts.every((c) => c.helps_rota === true && c.can_drive === false)).toBe(true);
      expect(rota.prep.every((p) => p.kind === "task" && p.qty === null)).toBe(true);
      expect(week.approaches.some((a) => a.public_ok)).toBe(false);
      expect(week.speakers.some((s) => s.has_photo || s.public_bio != null)).toBe(false);
      expect(Object.keys(port.shared.photos)).toEqual([]);
    }
  });

});
