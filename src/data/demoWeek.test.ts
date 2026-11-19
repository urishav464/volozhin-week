// The demo shows every stage a closed lesson can be in (milestone 3) — and,
// like the database, keeps transport details out of the Week and the
// instructor's wording (template, duty phrases) unwritten.
import { describe, expect, it } from "vitest";
import { DAYS } from "../domain/time";
import { transportRows } from "../exports/logistics";
import { warningsFor } from "../rules/warnings";
import { boardCounts, pickupText, transportLanes } from "../screens/logistics/lanes";
import { CommandError } from "./commands";
import { DEMO_LOGISTICS, DemoPort } from "./demoPort";
import { demoTransport, demoWeek, seedDemoLogistics } from "./demoWeek";
import { emptyRota } from "./engine";
import { mergeTransport } from "./stageRules";

const EMPTY_DETAILS = { pickup_address: null, pickup_time: null, driver_name: null, driver_phone: null, arranged: false };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${String(e)}`;
  }
};

describe("the demo's stages", () => {
  it("has a lesson in every state of payment, message, escort and sources", async () => {
    const port = new DemoPort();
    const w = await port.loadWeek(1);
    const closed = w.lessons.filter((l) => l.state === "closed");
    const has = (pred: (l: (typeof closed)[number]) => boolean) => closed.some(pred);
    for (const a of ["none", "pending", "approved", "rejected"]) expect(has((l) => l.approval === a), a).toBe(true);
    for (const t of ["none", "one_way", "round_trip"]) expect(has((l) => l.transport === t), t).toBe(true);
    for (const k of ["pending", "sheet", "presentation", "sheet_presentation", "sheet_video", "none", "other"]) expect(has((l) => l.sources_kind === k), k).toBe(true);
    for (const p of ["none", "before", "same_day"]) expect(has((l) => l.print_when === p), p).toBe(true);
    expect(has((l) => l.paid_at != null)).toBe(true);
    expect(has((l) => l.approval === "approved" && l.pay_amount != null && l.paid_at == null)).toBe(true);
    expect(has((l) => l.confirm_sent_at != null && !l.needs_reconfirm)).toBe(true);
    expect(has((l) => l.needs_reconfirm)).toBe(true);
    expect(has((l) => l.escort_roster_id != null && l.escort_note != null)).toBe(true);
    expect(has((l) => l.self_intro)).toBe(true);
    expect(has((l) => l.in_reader)).toBe(true);
    expect(has((l) => l.presentation_url?.startsWith("https://") ?? false)).toBe(true);
    expect(w.roster.length).toBeGreaterThan(3);
    expect(warningsFor(w).some((x) => x.kind === "escort_gap")).toBe(true);
    // the instructor's wording is never ours
    expect(w.edition.settings.confirm_template).toBeUndefined();
    expect(w.edition.settings.duty_phrases).toBeUndefined();
  });

  it("keeps transport details apart: the demo user (the global admin) reads them through the port, never in the Week", async () => {
    const port = new DemoPort();
    const w = await port.loadWeek(1);
    expect(JSON.stringify(w)).not.toMatch(/כתובת לדוגמה|נהג\/ת לדוגמה/);
    const first = w.lessons.find((l) => l.state === "closed" && l.day === 0 && l.start_min === 510)!;
    expect(await port.commands(1).transport(first.id)).toMatchObject({ pickup_address: "כתובת לדוגמה", arranged: true });
  });

  it("runs the stage commands on the engine: the queue's request approved, the message then sent", async () => {
    const port = new DemoPort();
    const c = port.commands(1);
    const pending = () => port.loadWeek(1).then((w) => w.lessons.find((l) => l.approval === "pending")!);
    const p = await pending();
    const refused = await c.markConfirmSent(p.id, p.version).then(() => "ok", (e: CommandError) => e.code);
    expect(refused).toBe("approval_pending");
    await c.decidePayments([{ lesson_id: p.id, version: p.version }], "approved");
    const after = (await port.loadWeek(1)).lessons.find((l) => l.id === p.id)!;
    await c.markConfirmSent(after.id, after.version);
    expect((await port.loadWeek(1)).lessons.find((l) => l.id === p.id)).toMatchObject({ approval: "approved", needs_reconfirm: false, confirm_sent_by: 1 });
  });
});

describe("the demo and schema v18", () => {
  it("starts with no day owners; an admin gives a day its pair, an owner says «ראיתי» — on the engine, through the port", async () => {
    const port = new DemoPort();
    const c = port.commands(1);
    expect((await port.loadWeek(1)).dayOwners).toEqual([]);
    await c.setDayOwners(2, [3, 1]);
    await c.setDayOwners(0, [2]);
    expect((await port.loadWeek(1)).dayOwners).toEqual([
      { day: 0, member_id: 2, seen_at: null },
      { day: 2, member_id: 1, seen_at: null },
      { day: 2, member_id: 3, seen_at: null },
    ]);
    await c.markDaySeen(2); // the demo user is member 1
    const owners = (await port.loadWeek(1)).dayOwners;
    expect(owners.map((o) => o.seen_at != null)).toEqual([false, true, false]);
    expect(Number.isNaN(Date.parse(owners[1].seen_at!))).toBe(false);
    expect(await code(c.markDaySeen(0))).toBe("forbidden"); // not theirs
    expect(await code(c.setDayOwners(2, [5]))).toBe("bad_value"); // the demo's logistics member does not handle speakers
    expect(await code(c.setDayOwners(2, [2, 3, 4]))).toBe("bad_value");
    // a trainee does not give days out, and marks only a day of their own
    const trainee = new DemoPort({ memberId: 2, role: "content" });
    expect(await code(trainee.commands(1).setDayOwners(1, [2]))).toBe("forbidden");
    expect(await code(trainee.commands(1).markDaySeen(1))).toBe("forbidden");
    // the load hands out a copy: a screen cannot change the engine's rows
    (await port.loadWeek(1)).dayOwners.length = 0;
    expect((await port.loadWeek(1)).dayOwners).toHaveLength(3);
  });

  it("the transports read lists the request that still waits beside the approved ones — «לוגיסטיקה ← הסעות» keeps to the approved", async () => {
    const port = new DemoPort();
    const c = port.commands(1);
    const w = await port.loadWeek(1);
    const withTransport = w.lessons.filter((l) => l.state === "closed" && l.transport !== "none");
    const approved = withTransport.filter((l) => l.approval === "approved").map((l) => l.id);
    const pending = withTransport.filter((l) => l.approval === "pending").map((l) => l.id);
    expect(approved.length).toBeGreaterThan(0);
    expect(pending.length).toBeGreaterThan(0);
    const read = await c.transports();
    expect(read.map((t) => [t.lesson_id, t.approval])).toEqual([...approved.map((id) => [id, "approved"]), ...pending.map((id) => [id, "pending"])].sort((a, b) => Number(a[0]) - Number(b[0])));
    expect(read.every((t) => t.pickup_min === null)).toBe(true); // nobody entered one
    const rows = transportRows(w, read);
    expect(rows.map((r) => r.lesson.id).sort((a, b) => a - b)).toEqual([...approved].sort((a, b) => a - b));
    expect(rows.every((r) => r.details != null && !("approval" in r.details) && !("pickup_min" in r.details))).toBe(true);
  });

  it("the two halves of a transport: the request before the approval, the driver only after it — and none of it in the Week", async () => {
    const port = new DemoPort();
    const c = port.commands(1);
    const p = (await port.loadWeek(1)).lessons.find((l) => l.state === "closed" && l.transport !== "none" && l.approval === "pending")!;
    await c.setTransportRequest(p.id, { pickup_address: "כתובת איסוף לדוגמה", pickup_time: "07:15", pickup_min: 435 });
    expect(await code(c.setTransportDriver(p.id, { driver_name: "נהג/ת לדוגמה", arranged: true }))).toBe("transport_hidden");
    expect((await c.transports()).find((t) => t.lesson_id === p.id)).toEqual({
      lesson_id: p.id, pickup_address: "כתובת איסוף לדוגמה", pickup_time: "07:15", driver_name: null, driver_phone: null, arranged: false, approval: "pending", pickup_min: 435,
    });
    expect(await c.transport(p.id)).toEqual({ pickup_address: "כתובת איסוף לדוגמה", pickup_time: "07:15", driver_name: null, driver_phone: null, arranged: false }); // the five, as before
    await c.decidePayments([{ lesson_id: p.id, version: p.version }], "approved");
    await c.setTransportDriver(p.id, { driver_name: "נהג/ת לדוגמה", arranged: true });
    await c.setTransportRequest(p.id, { pickup_min: null });
    expect((await c.transports()).find((t) => t.lesson_id === p.id)).toMatchObject({ driver_name: "נהג/ת לדוגמה", arranged: true, approval: "approved", pickup_min: null, pickup_time: "07:15" });
    expect(await code(c.setTransportRequest(p.id, { driver_name: "נהג/ת לדוגמה" } as never))).toBe("bad_value");
    expect(JSON.stringify(await port.loadWeek(1))).not.toMatch(/כתובת איסוף לדוגמה|pickup_min|נהג\/ת לדוגמה/);
  });

  it("in the demo edition (not a real one) only the global admin decides a request or sees a pickup: the staff's wider rights are a real edition's", async () => {
    for (const actor of [{ memberId: 5, role: "logistics" as const }, { memberId: 9, role: "admin" as const }]) {
      const port = new DemoPort(actor);
      const c = port.commands(1);
      const lessons = (await port.loadWeek(1)).lessons;
      const p = lessons.find((l) => l.approval === "pending")!;
      expect(await code(c.decidePayments([{ lesson_id: p.id, version: p.version }], "approved"))).toBe("forbidden");
      expect(await c.transports()).toEqual([]);
      expect(await c.transport(p.id)).toBeNull();
      // and who reads no pickup or driver writes none: the request (logistics never: `forbidden`), the driver
      const asked = lessons.find((l) => l.state === "closed" && l.transport !== "none" && l.approval === "pending")!;
      const approved = lessons.find((l) => l.state === "closed" && l.transport !== "none" && l.approval === "approved")!;
      expect(await code(c.setTransportRequest(asked.id, { pickup_time: "07:15" }))).toBe(actor.role === "admin" ? "transport_hidden" : "forbidden");
      expect(await code(c.setTransportDriver(approved.id, { arranged: true }))).toBe("transport_hidden");
    }
    const trainee = new DemoPort({ memberId: 2, role: "content" });
    const p = (await trainee.loadWeek(1)).lessons.find((l) => l.approval === "pending")!;
    expect(await code(trainee.commands(1).decidePayments([{ lesson_id: p.id, version: p.version }], "approved"))).toBe("forbidden");
  });
});

describe("the logistics demo's seed (`?as=logistics` only): what the transport board draws", () => {
  const at = (week: ReturnType<typeof demoWeek>, day: number, start: number) => week.lessons.find((l) => l.kind === "lesson" && l.state === "closed" && l.day === day && l.start_min === start)!;

  it("gives the three transports synthetic pickup times — placeholder words, a 06:10 before the board's 06:30 — and two staff shifts", () => {
    const week = demoWeek();
    const shared = { transport: demoTransport(week), rota: emptyRota() };
    const before = structuredClone(shared.transport);
    seedDemoLogistics(shared, week, { id: 5, display_name: "לוגיסטיקה (הדגמה)" });
    const row = (day: number, start: number) => shared.transport[`1:${at(week, day, start).id}`];
    expect(row(0, 510)).toEqual({ ...before[`1:${at(week, 0, 510).id}`], pickup_time: "07:15", pickup_min: 435 }); // its driver and «סודר» kept
    expect(row(1, 510)).toEqual({ pickup_address: "כתובת לדוגמה", pickup_time: "06:10", pickup_min: 370, driver_name: null, driver_phone: null, arranged: false });
    expect(row(3, 600)).toEqual({ pickup_address: "כתובת לדוגמה", pickup_time: "08:45", pickup_min: 525, driver_name: null, driver_phone: null, arranged: false });
    expect(Object.keys(shared.transport)).toHaveLength(3);
    expect(shared.rota.staff).toEqual([
      { id: 1, edition_id: 1, day: 1, start_min: 390, end_min: 720, member_id: null, name: "איש/אשת צוות לדוגמה ב׳", cohort_id: null, kind: "shift", note: null },
      { id: 2, edition_id: 1, day: 3, start_min: 510, end_min: 870, member_id: 5, name: "לוגיסטיקה (הדגמה)", cohort_id: null, kind: "lead", note: null },
    ]);
    // no logistics member to lead: the typed shift alone
    const bare = { transport: demoTransport(week), rota: emptyRota() };
    seedDemoLogistics(bare, week, null);
    expect(bare.rota.staff.map((s) => s.name)).toEqual(["איש/אשת צוות לדוגמה ב׳"]);
    // synthetic only: no digits in a pickup address, and the times are what the board needs
    expect(Object.values(shared.transport).every((t) => !/\d/.test(t.pickup_address ?? ""))).toBe(true);
  });

  it("on the board, as the logistics demo reads it: Sunday arranged, Monday's round trip waiting and clamped, Wednesday approved and led", async () => {
    const port = new DemoPort(DEMO_LOGISTICS, { logistics: true });
    const week = await port.loadWeek(1);
    const read = await port.commands(1).transports();
    const rota = await port.rota.load(1);
    const day = (d: (typeof DAYS)[number]) => transportLanes(week, read, rota, d);
    expect(day(0).transports.map((t) => [t.state, t.outbound])).toEqual([["arranged", { kind: "bar", from: 435, to: 510, clamped: false }]]);
    // the return from the teaching's end, 09:45 (08:30 + 75) — the escort's page and the speaker's message say the same
    expect(day(1).transports.map((t) => [t.state, t.outbound, t.returnAt])).toEqual([["pending", { kind: "bar", from: 390, to: 510, clamped: true }, 585]]);
    expect(day(3).transports.map((t) => [t.state, t.outbound, t.returnAt])).toEqual([["approved", { kind: "bar", from: 525, to: 600, clamped: false }, null]]);
    expect(day(3).shifts.map((s) => [s.who, s.lead])).toEqual([["לוגיסטיקה (הדגמה)", true]]);
    expect(day(1).shifts.map((s) => [s.who, s.lead])).toEqual([
      ["איש/אשת צוות לדוגמה ב׳", false],
      ["צוות מכינה לדוגמה נ", false],
    ]);
    expect(day(2)).toEqual({ day: 2, transports: [], shifts: [] });
    expect(boardCounts(week, read)).toEqual({ pending: 1, approved: 2, arranged: 1 });
    // the default demo draws the same transports with no pickup time known: markers at the lessons' starts
    const plain = new DemoPort();
    const w = await plain.loadWeek(1);
    const r = await plain.commands(1).transports();
    const lanes = DAYS.flatMap((d) => transportLanes(w, r, null, d).transports);
    expect(lanes.map((t) => [t.lesson.day, t.outbound])).toEqual([
      [0, { kind: "marker", at: 510, known: false }],
      [1, { kind: "marker", at: 510, known: false }],
      [3, { kind: "marker", at: 600, known: false }],
    ]);
  });

  it("a pickup changed through the old screens' form (set_transport_details keeps pickup_min): the board shows the new time, as the files do", async () => {
    const port = new DemoPort(DEMO_LOGISTICS, { logistics: true });
    const cmds = port.commands(1);
    const week = await port.loadWeek(1);
    const wed = at(week, 3, 600);
    // the grid's panel saves as TransportBlock does: the whole five over what is there
    await cmds.setTransport(wed.id, mergeTransport(EMPTY_DETAILS, { ...EMPTY_DETAILS, pickup_address: "כתובת לדוגמה", pickup_time: "07:30" }, await cmds.transport(wed.id)));
    const read = await cmds.transports();
    expect(read.find((t) => t.lesson_id === wed.id)).toMatchObject({ pickup_time: "07:30", pickup_min: 525 }); // the minute left behind
    const [lane] = transportLanes(week, read, null, 3).transports;
    expect(pickupText(lane)).toEqual({ time: "07:30", early: false, words: null });
    expect(lane.outbound).toEqual({ kind: "bar", from: 450, to: 600, clamped: false });
    expect(transportRows(week, read).find((r) => r.lesson.id === wed.id)?.details?.pickup_time).toBe("07:30"); // the tab's own print says the same
  });
});
