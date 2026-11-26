// The logistics side's one transports read (useTransports.ts), the review: a pickup corrected (set_transport_request) or a
// driver set (set_transport_driver) changes no lesson — the board's key stays as it was — so the read also comes again when
// the tab is back in view and every two minutes while it is in view (whileVisible), never while it is hidden.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoPort } from "../../data/demoPort";
import { boardKey, sayFailure, TRANSPORTS_POLL_MS, type VisibleDoc, whileVisible } from "./useTransports";

/** A document whose visibility a test sets, and who listens to it. */
function fakeDoc(state: DocumentVisibilityState = "visible") {
  const fns = new Set<() => void>();
  const doc: VisibleDoc & { set: (s: DocumentVisibilityState) => void; listeners: () => number } = {
    visibilityState: state,
    addEventListener: (_t, fn) => void fns.add(fn),
    removeEventListener: (_t, fn) => void fns.delete(fn),
    set(s) {
      (this as { visibilityState: DocumentVisibilityState }).visibilityState = s;
      for (const fn of fns) fn();
    },
    listeners: () => fns.size,
  };
  return doc;
}

describe("whileVisible", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("again on the tab's return to view and every two minutes while in view — never while hidden; the cleanup stops both", () => {
    expect(TRANSPORTS_POLL_MS).toBe(120_000);
    const doc = fakeDoc();
    const fn = vi.fn();
    const stop = whileVisible(doc, TRANSPORTS_POLL_MS, fn);
    expect(fn).not.toHaveBeenCalled(); // the first read is the hook's own
    vi.advanceTimersByTime(TRANSPORTS_POLL_MS);
    expect(fn).toHaveBeenCalledTimes(1);
    doc.set("hidden");
    vi.advanceTimersByTime(3 * TRANSPORTS_POLL_MS);
    expect(fn).toHaveBeenCalledTimes(1); // hidden: nothing
    doc.set("visible");
    expect(fn).toHaveBeenCalledTimes(2); // back in view: at once
    stop();
    expect(doc.listeners()).toBe(0);
    vi.advanceTimersByTime(3 * TRANSPORTS_POLL_MS);
    doc.set("visible");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("a failed read, said or quiet (the last review)", () => {
  it("a read someone asked for is always said; a background one only while nothing was ever shown", () => {
    expect(sayFailure(false, false)).toBe(true); // the first read
    expect(sayFailure(false, true)).toBe(true); // «לנסות שוב», after a write, a lesson changed
    expect(sayFailure(true, false)).toBe(true); // the tab's return before any read came: nothing on screen to trust
    expect(sayFailure(true, true)).toBe(false); // the tab's return, the two minutes, with the board on screen
  });
});

describe("the board's key", () => {
  it("a pickup corrected or a driver arranged changes no lesson — the key stays, which is why the read polls too", async () => {
    const port = new DemoPort();
    const cmds = port.commands(1);
    const week = await port.loadWeek(1);
    const lesson = week.lessons.find((l) => l.state === "closed" && l.approval === "pending" && l.transport !== "none")!;
    expect(lesson, "a pending transport in the demo").toBeDefined();
    await cmds.setTransportRequest(lesson.id, { pickup_time: "07:00", pickup_min: 420 });
    const key = boardKey(await port.loadWeek(1));
    await cmds.setTransportRequest(lesson.id, { pickup_time: "05:30", pickup_min: 330 }); // the pickup corrected alone
    expect(boardKey(await port.loadWeek(1))).toBe(key);
    expect((await cmds.transports()).find((t) => t.lesson_id === lesson.id)).toMatchObject({ pickup_time: "05:30", pickup_min: 330 });
    // approved, then a driver arranged: the approval changes the key, the driver does not
    const v = (await port.loadWeek(1)).lessons.find((l) => l.id === lesson.id)!.version;
    await cmds.decidePayments([{ lesson_id: lesson.id, version: v }], "approved");
    const approved = boardKey(await port.loadWeek(1));
    expect(approved).not.toBe(key);
    await cmds.setTransportDriver(lesson.id, { driver_name: "נהג/ת לדוגמה", arranged: true });
    expect(boardKey(await port.loadWeek(1))).toBe(approved);
    expect((await cmds.transports()).find((t) => t.lesson_id === lesson.id)?.arranged).toBe(true);
  });
});
