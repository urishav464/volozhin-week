// «אישורים» (the reset, phase 3): who may decide a request (public.decide_payments' rule), the header's badge per
// viewer, and the requests' rows with the pickup from one transports read.
import { describe, expect, it } from "vitest";
import type { LessonTransport } from "../data/commands";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek } from "../testing/week";
import { approvalsBadge, type DecideActor, mayDecide, requestRows } from "./approvals";
import type { Edition, Week } from "./types";

const globalAdmin: DecideActor = { global: true, isAdmin: true, role: "admin" };
const editionAdmin: DecideActor = { global: false, isAdmin: true, role: "admin" };
const logistics: DecideActor = { global: false, isAdmin: false, role: "logistics" };
const trainee: DecideActor = { global: false, isAdmin: false, role: "content" };

const edition = (kind: Edition["kind"], status: Edition["status"] = "planning") => ({ kind, status });

describe("mayDecide", () => {
  it("a global admin anywhere — a demo, a practice week, an archive", () => {
    for (const e of [edition("real"), edition("demo"), edition("practice"), edition("archive"), edition("real", "archived"), null]) expect(mayDecide(globalAdmin, e)).toBe(true);
  });

  it("an edition's admin and logistics only in a real, live edition; a trainee never", () => {
    for (const a of [editionAdmin, logistics]) {
      expect(mayDecide(a, edition("real"))).toBe(true);
      expect(mayDecide(a, edition("real", "active"))).toBe(true);
      expect(mayDecide(a, edition("real", "archived"))).toBe(false);
      expect(mayDecide(a, edition("demo"))).toBe(false);
      expect(mayDecide(a, edition("practice"))).toBe(false);
      expect(mayDecide(a, edition("archive"))).toBe(false);
      expect(mayDecide(a, null)).toBe(false);
    }
    expect(mayDecide(trainee, edition("real"))).toBe(false);
  });
});

/** A week with one request waiting and one speaker who agreed and waits for the vetting. */
function waiting(kind: Edition["kind"]): Week {
  const w = emptyWeek();
  w.edition.kind = kind;
  const s = addSpeaker(w, "f", "א");
  addApproach(w, s, "positive");
  closeWith(w, addLesson(w, 0, 870, 960, { pay_amount: 300, approval: "pending" }), s);
  const agreed = addSpeaker(w, "m", "ב");
  agreed.vetted = "pending";
  addApproach(w, agreed, "positive");
  return w;
}

describe("approvalsBadge", () => {
  it("a global admin: the vetting and the requests", () => {
    expect(approvalsBadge(waiting("demo"), globalAdmin)).toBe(2);
    expect(approvalsBadge(waiting("real"), globalAdmin)).toBe(2);
  });

  it("an edition's admin and logistics of a live real edition: the requests only; elsewhere nothing", () => {
    for (const a of [editionAdmin, logistics]) {
      expect(approvalsBadge(waiting("real"), a)).toBe(1);
      expect(approvalsBadge(waiting("demo"), a)).toBe(0);
      const archived = waiting("real");
      archived.edition.status = "archived";
      expect(approvalsBadge(archived, a)).toBe(0);
    }
  });

  it("a trainee, or no week loaded yet: nothing", () => {
    expect(approvalsBadge(waiting("real"), trainee)).toBe(0);
    expect(approvalsBadge(null, globalAdmin)).toBe(0);
  });

  it("counts who agreed and waits for the vetting — not every speaker waiting for it", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "f", "א");
    addApproach(w, s, "positive");
    closeWith(w, addLesson(w, 0, 870, 960, { pay_amount: 300, approval: "pending" }), s);
    expect(approvalsBadge(w, globalAdmin)).toBe(1);
    const [agreed, toCall] = [addSpeaker(w, "f", "ב"), addSpeaker(w, "m", "ג")];
    Object.assign(addSpeaker(w, null, "ד"), { vetted: "pending" }); // no approach this edition
    agreed.vetted = toCall.vetted = "pending";
    const a = addApproach(w, agreed, "approached");
    addApproach(w, toCall, "claimed");
    expect(approvalsBadge(w, globalAdmin)).toBe(1); // nobody of them agreed yet
    a.status = "positive";
    expect(approvalsBadge(w, globalAdmin)).toBe(2);
    agreed.vetted = "approved";
    expect(approvalsBadge(w, globalAdmin)).toBe(1);
  });
});

describe("requestRows", () => {
  const details = (lesson_id: number, patch: Partial<LessonTransport> = {}): LessonTransport => ({
    lesson_id, approval: "pending", pickup_address: "כתובת לדוגמה", pickup_time: "08:45", pickup_min: 525, driver_name: null, driver_phone: null, arranged: false, ...patch,
  });

  it("the pending requests by time, each with its pickup from the one read — or none", () => {
    const w = emptyWeek();
    const [a, b, c] = ["א", "ב", "ג"].map((n) => addSpeaker(w, "f", n));
    [a, b, c].forEach((s) => addApproach(w, s, "positive"));
    const later = closeWith(w, addLesson(w, 2, 510, 600, { transport: "one_way", approval: "pending" }), a);
    const sooner = closeWith(w, addLesson(w, 0, 870, 960, { transport: "round_trip", pay_amount: 200, approval: "pending" }), b);
    const payOnly = closeWith(w, addLesson(w, 1, 510, 600, { pay_amount: 300, approval: "pending" }), c);
    closeWith(w, addLesson(w, 3, 510, 600, { transport: "one_way", approval: "approved" }), c); // decided: not a request

    const rows = requestRows(w, [details(sooner.id), details(payOnly.id), details(9999)]);
    expect(rows.map((r) => r.lesson.id)).toEqual([sooner.id, payOnly.id, later.id]);
    expect(rows[0].pickup).toEqual({ pickup_address: "כתובת לדוגמה", pickup_time: "08:45", pickup_min: 525 });
    expect(rows[0].speaker?.name).toBe("ב");
    expect(rows[1].pickup).toBeNull(); // no transport asked: a stray row is not shown
    expect(rows[2].pickup).toBeNull(); // not in the read (not sent, or not visible to this viewer)
    expect(requestRows(w, null).every((r) => r.pickup === null)).toBe(true); // the read failed: the rows stay, without pickups
  });
});
