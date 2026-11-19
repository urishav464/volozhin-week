// The demo shows every stage a closed lesson can be in (milestone 3) — and,
// like the database, keeps transport details out of the Week and the
// instructor's wording (template, duty phrases) unwritten.
import { describe, expect, it } from "vitest";
import { transportRows } from "../exports/logistics";
import { warningsFor } from "../rules/warnings";
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
