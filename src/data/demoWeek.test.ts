// The demo shows every stage a closed lesson can be in (milestone 3) — and,
// like the database, keeps transport details out of the Week and the
// instructor's wording (template, duty phrases) unwritten.
import { describe, expect, it } from "vitest";
import { warningsFor } from "../rules/warnings";
import { CommandError } from "./commands";
import { DemoPort } from "./demoPort";

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
