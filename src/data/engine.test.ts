// docs/CONTRACT.md, clause by clause, against the in-memory engine.
import { beforeEach, describe, expect, it } from "vitest";
import { LESSON_STAGE_DEFAULTS, type Week } from "../domain/types";
import { addApproach, addLesson, addSpeaker, addTrainee, closeWith, emptyWeek } from "../testing/week";
import { CommandError } from "./commands";
import { type Actor, Engine } from "./engine";

const ME: Actor = { memberId: 1, role: "content" };
const OTHER: Actor = { memberId: 2, role: "content" };
const ADMIN: Actor = { memberId: 9, role: "admin" };
const LOGISTICS: Actor = { memberId: 5, role: "logistics" };

function code(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : String(e);
  }
}

let w: Week;
beforeEach(() => {
  w = emptyWeek();
});

const cell = (day: 0 | 1 | 2 | 3 | 4, start: number, end: number, room_id: number | null = null) => ({ day, start_min: start, end_min: end, room_id });

describe("propose", () => {
  it("creates the draft, claims the speaker and records the approach", () => {
    const s = addSpeaker(w, "f");
    const e = new Engine(w, ME);
    const r = e.propose(s.id, cell(1, 510, 600));
    const l = e.week.lessons.find((x) => x.id === r.lesson_id)!;
    expect([l.state, l.room_id, l.day, l.start_min, l.end_min]).toEqual(["draft", 1, 1, 510, 600]);
    expect(e.week.approaches).toMatchObject([{ speaker_id: s.id, owner_member_id: 1, status: "approached" }]);
    expect(e.week.pitches).toMatchObject([{ id: r.pitch_id, state: "approached", proposed_by: 1 }]);
  });

  it("reuses a draft that matches the cell exactly, and never duplicates a pitch", () => {
    const s = addSpeaker(w, "f");
    const e = new Engine(w, ME);
    const a = e.propose(s.id, cell(1, 510, 600));
    const b = e.propose(s.id, cell(1, 510, 600));
    expect(b).toEqual(a);
    expect(e.week.lessons).toHaveLength(1);
    expect(e.week.pitches).toHaveLength(1);
  });

  it("refuses a speaker someone else handles — and leaves no draft behind", () => {
    const s = addSpeaker(w, "m");
    new Engine(w, OTHER).propose(s.id, cell(1, 510, 600));
    const e = new Engine(w, ME);
    expect(code(() => e.propose(s.id, cell(2, 510, 600)))).toBe("approach_owned");
    expect(e.week.lessons.filter((l) => l.day === 2)).toEqual([]);
  });

  it("lets a member offer someone else's speaker: a candidate under the owner's approach", () => {
    const s = addSpeaker(w, "m");
    new Engine(w, OTHER).propose(s.id, cell(1, 510, 600));
    const e = new Engine(w, ME);
    const r = e.propose(s.id, cell(2, 510, 600), "offer");
    const p = e.week.pitches.find((x) => x.id === r.pitch_id)!;
    expect(p.state).toBe("candidate");
    expect(p.proposed_by).toBe(ME.memberId);
    expect(e.week.approaches).toHaveLength(1);
    expect(e.week.approaches[0].owner_member_id).toBe(OTHER.memberId);
  });

  it("makes an unvetted speaker a candidate only", () => {
    const s = addSpeaker(w, "f");
    s.vetted = "pending";
    const e = new Engine(w, ME);
    const r = e.propose(s.id, cell(1, 510, 600));
    expect(e.week.pitches.find((p) => p.id === r.pitch_id)!.state).toBe("candidate");
  });

  it("revives a withdrawn pitch instead of adding another", () => {
    const s = addSpeaker(w, "f");
    const e = new Engine(w, ME);
    const target = addLesson(e.week, 1, 510, 600, { title: "מעוצב" }); // shaped: survives unpropose
    const r = e.propose(s.id, { lesson_id: target.id });
    e.unpropose(r.pitch_id);
    expect(e.week.pitches[0].state).toBe("withdrawn");
    const again = e.propose(s.id, { lesson_id: target.id });
    expect(again.pitch_id).toBe(r.pitch_id);
    expect(e.week.pitches[0].state).toBe("approached");
  });

  it("refuses a cell outside the lesson rows, a closed lesson, a retired speaker, and logistics", () => {
    const s = addSpeaker(w, "f");
    const closed = closeWith(w, addLesson(w, 2, 510, 600), addSpeaker(w, "m"));
    const e = new Engine(w, ME);
    expect(code(() => e.propose(s.id, cell(1, 1140, 1200)))).toBe("outside_grid"); // dinner
    expect(code(() => e.propose(s.id, cell(4, 1200, 1290)))).toBe("outside_grid"); // Thursday after 19:00
    expect(code(() => e.propose(s.id, cell(1, 512, 600)))).toBe("bad_shape");
    expect(code(() => e.propose(s.id, { lesson_id: closed.id }))).toBe("cell_closed");
    const live = e.week.speakers.find((x) => x.id === s.id)!; // rows are fresh copies after a refused command
    live.retired = true;
    expect(code(() => e.propose(s.id, cell(1, 510, 600)))).toBe("speaker_retired");
    live.retired = false;
    expect(code(() => new Engine(w, LOGISTICS).propose(s.id, cell(1, 510, 600)))).toBe("forbidden");
  });

  it("refuses a room already taken at that time", () => {
    addLesson(w, 1, 510, 600, { state: "closed" });
    expect(code(() => new Engine(w, ME).propose(addSpeaker(w, "f").id, cell(1, 510, 600)))).toBe("room_taken");
  });
});

describe("unpropose", () => {
  it("withdraws and gives a plain cell back", () => {
    const e = new Engine(w, ME);
    const r = e.propose(addSpeaker(w, "f").id, cell(1, 510, 600));
    e.unpropose(r.pitch_id);
    expect(e.week.lessons).toEqual([]);
  });

  it("keeps a draft that still has another live pitch", () => {
    const e = new Engine(w, ME);
    const a = e.propose(addSpeaker(w, "f").id, cell(1, 510, 600));
    e.propose(addSpeaker(w, "m").id, { lesson_id: a.lesson_id });
    e.unpropose(a.pitch_id);
    expect(e.week.lessons).toHaveLength(1);
  });

  it("is for the owner, the proposer or an admin", () => {
    const r = new Engine(w, ME).propose(addSpeaker(w, "f").id, cell(1, 510, 600));
    expect(code(() => new Engine(w, OTHER).unpropose(r.pitch_id))).toBe("forbidden");
    expect(code(() => new Engine(w, ADMIN).unpropose(r.pitch_id))).toBe("ok");
  });
});

describe("close_lesson and reopen_lesson", () => {
  it("closes: lead speaker, accepted, rivals superseded, the speaker's other pitches withdrawn", () => {
    const e = new Engine(w, ME);
    const s = addSpeaker(w, "f");
    const rival = addSpeaker(w, "m");
    const a = e.propose(s.id, cell(1, 510, 600));
    const b = e.propose(rival.id, { lesson_id: a.lesson_id });
    const elsewhere = e.propose(s.id, cell(2, 510, 600));
    e.closeLesson(a.pitch_id);
    const state = (id: number) => e.week.pitches.find((p) => p.id === id)!.state;
    expect(e.week.lessons.find((l) => l.id === a.lesson_id)!.state).toBe("closed");
    expect(e.week.lessonSpeakers).toEqual([{ lesson_id: a.lesson_id, speaker_id: s.id, role: "lead" }]);
    expect([state(a.pitch_id), state(b.pitch_id), state(elsewhere.pitch_id)]).toEqual(["accepted", "superseded", "withdrawn"]);
    expect(e.week.approaches.find((x) => x.speaker_id === s.id)!.status).toBe("positive");
  });

  it("refuses an unvetted speaker, an unknown gender, and a speaker busy at that time", () => {
    const e = new Engine(w, ME);
    const unvetted = addSpeaker(w, "f");
    unvetted.vetted = "pending";
    const r1 = e.propose(unvetted.id, cell(1, 510, 600));
    expect(code(() => e.closeLesson(r1.pitch_id))).toBe("not_vetted");

    const nobody = addSpeaker(w, null);
    const r2 = e.propose(nobody.id, cell(1, 600, 690));
    expect(code(() => e.closeLesson(r2.pitch_id))).toBe("gender_unknown");

    const busy = addSpeaker(w, "m");
    const first = e.propose(busy.id, cell(2, 510, 600));
    e.closeLesson(first.pitch_id);
    const parallel = e.propose(busy.id, cell(2, 510, 600, 2));
    expect(code(() => e.closeLesson(parallel.pitch_id))).toBe("speaker_busy");
    expect(e.week.lessons.find((l) => l.id === parallel.lesson_id)!.state).toBe("draft"); // nothing changed
  });

  it("is for the approach's owner or an admin", () => {
    const r = new Engine(w, ME).propose(addSpeaker(w, "f").id, cell(1, 510, 600));
    expect(code(() => new Engine(w, OTHER).closeLesson(r.pitch_id))).toBe("forbidden");
  });

  it("reopens to a draft; an approved payment locks it for non-admins", () => {
    const e = new Engine(w, ME);
    const r = e.propose(addSpeaker(w, "f").id, cell(1, 510, 600));
    e.closeLesson(r.pitch_id);
    const l = e.week.lessons[0];
    l.approval = "approved";
    expect(code(() => e.reopenLesson(l.id))).toBe("approved_locked");
    const admin = new Engine(e.week, ADMIN);
    admin.reopenLesson(l.id);
    expect(admin.week.lessons[0].state).toBe("draft");
    expect(admin.week.lessonSpeakers).toEqual([]);
    expect(admin.week.pitches[0].state).toBe("approached");
  });
});

describe("move_lesson", () => {
  it("moves a closed lesson and asks to reconfirm once the speaker was told", () => {
    const e = new Engine(w, ME);
    const r = e.propose(addSpeaker(w, "f").id, cell(1, 510, 600));
    e.closeLesson(r.pitch_id);
    e.week.lessons[0].confirm_sent_at = "2026-11-10T10:00:00Z";
    e.moveLesson(r.lesson_id, { day: 3, start_min: 870, end_min: 960, room_id: 1 });
    expect(e.week.lessons[0]).toMatchObject({ day: 3, start_min: 870, needs_reconfirm: true });
  });

  it("refuses a taken room, a busy speaker, and a range off the lesson rows", () => {
    const e = new Engine(w, ME);
    const s = addSpeaker(w, "f");
    const a = e.propose(s.id, cell(1, 510, 600));
    e.closeLesson(a.pitch_id);
    addLesson(e.week, 1, 600, 690, { state: "closed" });
    expect(code(() => e.moveLesson(a.lesson_id, { day: 1, start_min: 600, end_min: 690, room_id: 1 }))).toBe("room_taken");
    expect(code(() => e.moveLesson(a.lesson_id, { day: 1, start_min: 1140, end_min: 1200, room_id: 1 }))).toBe("outside_grid");
    const second = closeWith(e.week, addLesson(e.week, 2, 510, 600, { room_id: 2 }), s);
    expect(code(() => e.moveLesson(a.lesson_id, { day: 2, start_min: 510, end_min: 600, room_id: 1 }))).toBe("speaker_busy");
    expect(second.state).toBe("closed");
  });

  it("moves a merged lesson whole across night rows", () => {
    const e = new Engine(w, ME);
    const l = addLesson(e.week, 1, 1470, 1740);
    e.moveLesson(l.id, { day: 2, start_min: 1470, end_min: 1740, room_id: 1 });
    expect(e.week.lessons[0].day).toBe(2);
  });
});

describe("reshape", () => {
  it("split_parallel adds drafts in the next free rooms, with the reason", () => {
    const e = new Engine(w, ME);
    e.reshape(2, 960, { op: "split_parallel", count: 2, reason: "שני מסלולים" });
    expect(e.week.lessons.map((l) => [l.room_id, l.parallel_reason])).toEqual([[1, "שני מסלולים"], [2, "שני מסלולים"]]);
    expect(code(() => e.reshape(2, 960, { op: "split_parallel", count: 3, reason: "x" }))).toBe("room_taken");
    expect(code(() => e.reshape(2, 1050, { op: "split_parallel", count: 2, reason: " " }))).toBe("bad_shape");
  });

  it("split_parallel keeps an existing closed lesson as one of the lanes", () => {
    closeWith(w, addLesson(w, 2, 960, 1050), addSpeaker(w, "m"));
    const e = new Engine(w, ME);
    e.reshape(2, 960, { op: "split_parallel", count: 2, reason: "x" });
    expect(e.week.lessons.map((l) => [l.state, l.room_id])).toEqual([["closed", 1], ["draft", 2]]);
  });

  it("split_time makes back-to-back drafts and carries the pitches to the first", () => {
    const e = new Engine(w, ME);
    const r = e.propose(addSpeaker(w, "f").id, cell(1, 870, 960));
    e.reshape(1, 870, { op: "split_time", parts: [60, 30] });
    const ls = e.week.lessons.sort((a, b) => a.start_min - b.start_min);
    expect(ls.map((l) => [l.start_min, l.end_min])).toEqual([[870, 930], [930, 960]]);
    expect(e.week.pitches).toMatchObject([{ id: r.pitch_id, lesson_id: ls[0].id, state: "approached" }]);
    expect(code(() => e.reshape(1, 510, { op: "split_time", parts: [60, 20] }))).toBe("bad_shape");
    expect(code(() => e.reshape(1, 510, { op: "split_time", parts: [80, 10] }))).toBe("bad_shape");
  });

  it("split_time refuses a row with a closed lesson", () => {
    closeWith(w, addLesson(w, 1, 870, 960), addSpeaker(w, "m"));
    expect(code(() => new Engine(w, ME).reshape(1, 870, { op: "split_time", parts: [45, 45] }))).toBe("cell_closed");
  });

  it("merge_next builds the all-night lesson row by row, absorbing drafts' pitches", () => {
    const e = new Engine(w, ME);
    const p = e.propose(addSpeaker(w, "m").id, cell(1, 1560, 1650));
    e.reshape(1, 1470, { op: "merge_next" });
    e.reshape(1, 1470, { op: "merge_next" });
    expect(e.week.lessons.map((l) => [l.start_min, l.end_min])).toEqual([[1470, 1740]]);
    expect(e.week.pitches.find((x) => x.id === p.pitch_id)!.lesson_id).toBe(e.week.lessons[0].id);
  });

  it("merge_next refuses to swallow a closed lesson", () => {
    closeWith(w, addLesson(w, 1, 1560, 1650), addSpeaker(w, "m"));
    expect(code(() => new Engine(w, ME).reshape(1, 1470, { op: "merge_next" }))).toBe("merge_blocked");
  });

  it("reset clears a shaped row but keeps its live pitches on one plain draft", () => {
    const e = new Engine(w, ME);
    e.reshape(1, 870, { op: "split_time", parts: [60, 30] });
    const second = e.week.lessons.find((l) => l.start_min === 930)!;
    const r = e.propose(addSpeaker(w, "f").id, { lesson_id: second.id });
    e.reshape(1, 870, { op: "reset" });
    expect(e.week.lessons.map((l) => [l.start_min, l.end_min])).toEqual([[870, 960]]);
    expect(e.week.pitches.find((p) => p.id === r.pitch_id)!.lesson_id).toBe(e.week.lessons[0].id);
  });
});

describe("update_lesson", () => {
  it("writes the patch and bumps the version; a stale version is refused", () => {
    const l = addLesson(w, 1, 510, 600);
    const e = new Engine(w, ME);
    e.updateLesson(l.id, 1, { title: "כותרת", category_id: 2, teach_min: 75 });
    expect(e.week.lessons[0]).toMatchObject({ title: "כותרת", category_id: 2, teach_min: 75, version: 2 });
    expect(code(() => e.updateLesson(l.id, 1, { title: "שוב" }))).toBe("stale");
    expect(code(() => e.updateLesson(l.id, 2, { teach_min: 120 }))).toBe("bad_shape");
  });
});

describe("transactions and archives", () => {
  it("leaves the state untouched when a command refuses half-way", () => {
    const e = new Engine(w, ME);
    e.propose(addSpeaker(w, "f").id, cell(1, 870, 960));
    const snapshot = JSON.stringify(e.week);
    // split_time deletes the row's drafts first, then builds the parts: make the
    // building fail, after the deletion, and the deletion must be undone.
    (e as unknown as { defaultRoom: () => number }).defaultRoom = () => {
      throw new CommandError("bad_shape");
    };
    expect(code(() => e.reshape(1, 870, { op: "split_time", parts: [45, 45] }))).toBe("bad_shape");
    expect(JSON.stringify(e.week)).toBe(snapshot);
  });

  it("an archived edition is read-only except for admins", () => {
    w.edition.status = "archived";
    const s = addSpeaker(w, "f");
    expect(code(() => new Engine(w, ME).propose(s.id, cell(1, 510, 600)))).toBe("archived");
    expect(code(() => new Engine(w, ADMIN).propose(s.id, cell(1, 510, 600)))).toBe("ok");
  });

  it("an approach owned by nobody is taken by the first proposer", () => {
    const s = addSpeaker(w, "f");
    addApproach(w, s, "claimed").owner_member_id = null;
    const e = new Engine(w, ME);
    e.propose(s.id, cell(1, 510, 600));
    expect(e.week.approaches[0]).toMatchObject({ owner_member_id: ME.memberId, status: "approached" });
  });
});

describe("from placement to arrival (CONTRACT.md, milestone 3)", () => {
  const GLOBAL: Actor = { memberId: 9, role: "admin", global: true };
  /** A real edition, a lesson ME closed. */
  function closedByMe() {
    w.edition.kind = "real";
    const e = new Engine(w, ME);
    const r = e.propose(addSpeaker(w, "f").id, cell(1, 510, 600));
    e.closeLesson(r.pitch_id);
    return { e, id: r.lesson_id, l: () => e.week.lessons.find((x) => x.id === r.lesson_id)! };
  }

  it("flags «לעדכן את המרצה» for what the message says — and only after it was sent", () => {
    const { e, id, l } = closedByMe();
    e.updateLesson(id, l().version, { title: "כותרת לדוגמה" });
    expect(l().needs_reconfirm).toBe(false); // nothing sent yet
    e.markConfirmSent(id, l().version);
    expect(l()).toMatchObject({ confirm_sent_by: ME.memberId, needs_reconfirm: false });
    e.updateLesson(id, l().version, { category_id: 2, audience: "שיעור להורים" });
    expect(l().needs_reconfirm).toBe(false); // not in the message
    for (const change of [
      () => e.updateLesson(id, l().version, { title: "כותרת אחרת" }),
      () => e.updateLesson(id, l().version, { teach_min: 60 }),
      () => e.setPayment(id, l().version, 300, "none"),
      () => e.moveLesson(id, { day: 1, start_min: 510, end_min: 600, room_id: 2 }),
    ]) {
      if (l().approval === "pending") new Engine(e.week, GLOBAL).decidePayments([{ lesson_id: id, version: l().version }], "approved");
      e.markConfirmSent(id, l().version);
      change();
      expect(l().needs_reconfirm).toBe(true);
    }
  });

  it("a reopen starts the stages over — they were the speaker's: closing again is a first message, not a reconfirm", () => {
    const { e, id, l } = closedByMe();
    const t = addTrainee(w, "חניכה לדוגמה", "f");
    e.setPayment(id, l().version, 700, "round_trip");
    e.setTransport(id, { pickup_address: "כתובת לדוגמה", pickup_time: "07:15", driver_name: null, driver_phone: null, arranged: false });
    e.setEscort(id, l().version, { roster_id: t.id, self_intro: true, escort_note: "הערה לדוגמה" });
    e.setSources(id, l().version, { sources_kind: "presentation", print_when: "none", sources_note: null, presentation_url: "https://example.org/deck", in_reader: false });
    new Engine(e.week, GLOBAL, undefined, e.shared).decidePayments([{ lesson_id: id, version: l().version }], "approved");
    e.markConfirmSent(id, l().version);
    expect(code(() => e.reopenLesson(id))).toBe("approved_locked");
    const admin = new Engine(e.week, ADMIN, undefined, e.shared);
    admin.reopenLesson(id);
    expect(l()).toMatchObject({ state: "draft", ...LESSON_STAGE_DEFAULTS });
    expect(e.shared.transport).toEqual({});
    e.moveLesson(id, { day: 3, start_min: 870, end_min: 960, room_id: 1 });
    expect(l()).toMatchObject({ state: "draft", needs_reconfirm: false });
    // another member places another speaker: nothing of the first one's reaches them
    const other = new Engine(e.week, OTHER, undefined, e.shared);
    const s2 = addSpeaker(w, "m");
    const p2 = other.propose(s2.id, { lesson_id: id });
    other.closeLesson(p2.pitch_id);
    expect(l()).toMatchObject({ state: "closed", ...LESSON_STAGE_DEFAULTS });
    expect(other.transportOf(id)).toEqual({ pickup_address: null, pickup_time: null, driver_name: null, driver_phone: null, arranged: false });
    expect(code(() => new Engine(e.week, LOGISTICS, undefined, e.shared).setPaid(id, true))).toBe("payment_not_approved");
  });

  it("money paid is never erased: no reopen, no new amount, until «שולם» is undone", () => {
    const { e, id, l } = closedByMe();
    e.setPayment(id, l().version, 500, "none");
    const g = new Engine(e.week, GLOBAL, undefined, e.shared);
    g.decidePayments([{ lesson_id: id, version: l().version }], "approved");
    new Engine(e.week, LOGISTICS, undefined, e.shared).setPaid(id, true);
    expect(code(() => e.setPayment(id, l().version, 800, "none"))).toBe("paid_locked");
    expect(code(() => e.setPayment(id, l().version, null, "none"))).toBe("paid_locked");
    e.setPayment(id, l().version, 500, "one_way"); // the transport may change: pending again, still paid
    expect(l()).toMatchObject({ pay_amount: 500, approval: "pending", paid_at: expect.any(String) });
    expect(code(() => new Engine(e.week, ADMIN, undefined, e.shared).reopenLesson(id))).toBe("paid_locked");
    g.decidePayments([{ lesson_id: id, version: l().version }], "approved");
    new Engine(e.week, ADMIN, undefined, e.shared).setPaid(id, false);
    e.setPayment(id, l().version, 800, "one_way");
    expect(l()).toMatchObject({ pay_amount: 800, approval: "pending", paid_at: null });
  });

  it("a request on a lesson that is not closed is no one's to decide", () => {
    const { e, id, l } = closedByMe();
    e.setPayment(id, l().version, 300, "none");
    Object.assign(l(), { state: "draft" }); // as only a hand edit could leave it
    expect(code(() => new Engine(e.week, GLOBAL).decidePayments([{ lesson_id: id, version: l().version }], "approved"))).toBe("stale");
  });

  it("a batch decision is all or nothing", () => {
    const { e, id, l } = closedByMe();
    e.setPayment(id, l().version, 100, "none");
    const r2 = e.propose(addSpeaker(w, "m").id, cell(2, 510, 600));
    e.closeLesson(r2.pitch_id);
    const before = JSON.stringify(e.week.lessons);
    const g = new Engine(e.week, GLOBAL);
    expect(code(() => g.decidePayments([{ lesson_id: id, version: l().version }, { lesson_id: r2.lesson_id, version: 1 }], "approved"))).toBe("stale");
    expect(JSON.stringify(g.week.lessons)).toBe(before);
  });

  it("transport details: kept apart from the Week, gone with the transport, never seen by the team", () => {
    const { e, id, l } = closedByMe();
    e.setPayment(id, l().version, null, "round_trip");
    e.setTransport(id, { pickup_address: "כתובת לדוגמה", pickup_time: null, driver_name: null, driver_phone: null, arranged: false });
    expect(JSON.stringify(e.week)).not.toContain("כתובת לדוגמה");
    expect(e.transportOf(id)?.pickup_address).toBe("כתובת לדוגמה");
    expect(new Engine(e.week, OTHER, undefined, e.shared).transportOf(id)).toBeNull();
    expect(new Engine(e.week, LOGISTICS, undefined, e.shared).transportOf(id)).toBeNull(); // not approved yet
    new Engine(e.week, GLOBAL, undefined, e.shared).decidePayments([{ lesson_id: id, version: l().version }], "approved");
    expect(new Engine(e.week, LOGISTICS, undefined, e.shared).transportOf(id)?.pickup_address).toBe("כתובת לדוגמה");
    e.setPayment(id, l().version, null, "none");
    expect(Object.keys(e.shared.transport)).toEqual([]);
    expect(l()).toMatchObject({ transport: "none", approval: "none", approval_note: null, approved_by: null });
  });

  it("escorts come from this edition's roster", () => {
    const { e, id, l } = closedByMe();
    const t = addTrainee(w, "חניכה לדוגמה", "f");
    expect(code(() => e.setEscort(id, l().version, { roster_id: t.id + 1, self_intro: false, escort_note: null }))).toBe("bad_escort");
    e.setEscort(id, l().version, { roster_id: t.id, self_intro: false, escort_note: "  הערה לדוגמה " });
    expect(l()).toMatchObject({ escort_roster_id: t.id, escort_note: "הערה לדוגמה", version: 3 });
  });
});
