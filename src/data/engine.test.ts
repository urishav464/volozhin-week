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
  it("creates the draft, claims the speaker «לפני שיחה» and records the approach — placing is not calling (v14)", () => {
    const s = addSpeaker(w, "f");
    const e = new Engine(w, ME);
    const r = e.propose(s.id, cell(1, 510, 600));
    const l = e.week.lessons.find((x) => x.id === r.lesson_id)!;
    expect([l.state, l.room_id, l.day, l.start_min, l.end_min]).toEqual(["draft", 1, 1, 510, 600]);
    expect(e.week.approaches).toMatchObject([{ speaker_id: s.id, owner_member_id: 1, status: "claimed", version: 1 }]);
    expect(e.week.pitches).toMatchObject([{ id: r.pitch_id, state: "candidate", proposed_by: 1 }]);
    expect(e.shared.log).toMatchObject([{ entity: "approaches", kind: "insert", detail: { status: "claimed", owner: 1, speaker: s.id } }]);
  });

  it("reuses a draft that matches the cell exactly, never duplicates a pitch, and writes nothing to an approach already mine", () => {
    const s = addSpeaker(w, "f");
    const e = new Engine(w, ME);
    const a = e.propose(s.id, cell(1, 510, 600));
    e.setApproachStatus(e.week.approaches[0].id, 1, "approached");
    const b = e.propose(s.id, cell(1, 510, 600));
    e.propose(s.id, cell(2, 510, 600));
    expect(b).toEqual(a);
    expect(e.week.lessons).toHaveLength(2);
    expect(e.week.pitches.map((p) => p.state)).toEqual(["candidate", "candidate"]);
    expect(e.week.approaches).toMatchObject([{ status: "approached", version: 2 }]);
    expect(e.shared.log.map((x) => x.kind)).toEqual(["insert", "update"]);
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

  it("places and calls an unvetted speaker like any other — the instructor's approval is close_lesson's alone (v14)", () => {
    const s = addSpeaker(w, "f");
    s.vetted = "pending";
    const e = new Engine(w, ME);
    const r = e.propose(s.id, cell(1, 510, 600));
    const a = () => e.week.approaches[0];
    for (const status of ["no_answer", "approached", "positive"] as const) expect(code(() => e.setApproachStatus(a().id, a().version, status, "נתון לדוגמה"))).toBe("ok");
    expect(code(() => e.setPitch(r.pitch_id, "approached"))).toBe("ok");
    expect(code(() => e.closeLesson(r.pitch_id))).toBe("not_vetted");
    new Engine(e.week, { memberId: 9, role: "admin", global: true }, undefined, e.shared).vetSpeakers([s.id], "approved");
    e.closeLesson(r.pitch_id);
    expect(e.week.lessons[0].state).toBe("closed");
  });

  it("takes an approach nobody holds: owner, no offer, one version more — as claim_speaker does", () => {
    const s = addSpeaker(w, "m");
    Object.assign(addApproach(w, s, "no_answer"), { owner_member_id: null, offered_to: 2 });
    const e = new Engine(w, ME);
    e.propose(s.id, cell(1, 510, 600), "offer");
    expect(e.week.approaches[0]).toMatchObject({ owner_member_id: ME.memberId, offered_to: null, status: "no_answer", version: 2 });
    expect(e.shared.log).toMatchObject([{ kind: "update", detail: { owner: ME.memberId, status: "no_answer" } }]);
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
    expect(e.week.pitches[0].state).toBe("candidate");
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
    expect(e.week.pitches).toMatchObject([{ id: r.pitch_id, lesson_id: ls[0].id, state: "candidate" }]);
    expect(code(() => e.reshape(1, 510, { op: "split_time", parts: [60, 20] }))).toBe("bad_shape");
    expect(code(() => e.reshape(1, 510, { op: "split_time", parts: [80, 10] }))).toBe("bad_shape");
  });

  it("split_parallel on a merged cell adds lanes of its whole length, from either of its rows (v13)", () => {
    const e = new Engine(w, ME);
    e.reshape(2, 510, { op: "merge_next" });
    e.reshape(2, 510, { op: "split_parallel", count: 2, reason: "x" });
    expect(e.week.lessons.map((l) => [l.start_min, l.end_min, l.room_id])).toEqual([[510, 690, 1], [510, 690, 2]]);
    e.reshape(2, 600, { op: "split_parallel", count: 2, reason: "x" }); // already two lanes of the cell
    expect(e.week.lessons).toHaveLength(2);
  });

  it("split_time on a merged cell divides its whole length; each part starts and ends in a lesson row (v13)", () => {
    const e = new Engine(w, ME);
    const r = e.propose(addSpeaker(w, "f").id, cell(1, 510, 600));
    e.reshape(1, 510, { op: "merge_next" });
    expect(code(() => e.reshape(1, 510, { op: "split_time", parts: [90, 60] }))).toBe("bad_shape");
    e.reshape(1, 600, { op: "split_time", parts: [60, 120] });
    const ls = e.week.lessons.sort((a, b) => a.start_min - b.start_min);
    expect(ls.map((l) => [l.start_min, l.end_min])).toEqual([[510, 570], [570, 690]]);
    expect(e.week.pitches).toMatchObject([{ id: r.pitch_id, lesson_id: ls[0].id }]);
    e.reshape(3, 1200, { op: "merge_next" }); // 20:00–00:00, over מכריכה לכריכה
    expect(code(() => e.reshape(3, 1200, { op: "split_time", parts: [90, 150] }))).toBe("bad_shape");
  });

  it("split_time refuses a cell with a lesson that sticks out of it — never deletes it whole (v13 review)", () => {
    const e = new Engine(w, ME);
    e.reshape(1, 510, { op: "merge_next" }); // 08:30–11:30 in room 1
    addLesson(e.week, 1, 600, 780, { room_id: 2, title: "מקביל שזז" }); // 10:00–13:00 in room 2
    expect(code(() => e.reshape(1, 510, { op: "split_time", parts: [90, 90] }))).toBe("bad_shape");
    expect(e.week.lessons.map((l) => [l.start_min, l.end_min, l.room_id])).toEqual([[510, 690, 1], [600, 780, 2]]);
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

  it("an approach owned by nobody is taken by the first proposer, its status as it was", () => {
    const s = addSpeaker(w, "f");
    addApproach(w, s, "claimed").owner_member_id = null;
    const e = new Engine(w, ME);
    e.propose(s.id, cell(1, 510, 600));
    expect(e.week.approaches[0]).toMatchObject({ owner_member_id: ME.memberId, status: "claimed", version: 2 });
  });
});

describe("the call's result and «החזרה לתהליך» (v14)", () => {
  it("«סירב/ה» declines every live pitch; bringing one back puts the approach «לפני שיחה» again, one version more", () => {
    const s = addSpeaker(w, "m");
    const e = new Engine(w, ME);
    const first = e.propose(s.id, cell(1, 510, 600));
    const second = e.propose(s.id, cell(2, 510, 600));
    const a = () => e.week.approaches[0];
    e.setApproachStatus(a().id, a().version, "declined", "לא השנה (נתון לדוגמה)");
    expect(e.week.pitches.map((p) => p.state)).toEqual(["declined", "declined"]);
    e.setPitch(first.pitch_id, "candidate");
    expect(a()).toMatchObject({ status: "claimed", version: 3 });
    expect(e.week.pitches.map((p) => p.state)).toEqual(["candidate", "declined"]);
    expect(e.shared.log.at(-1)).toMatchObject({ kind: "update", detail: { status: "claimed" } });
    // the approach is live again: the other declined pitch comes back on its own, the approach untouched
    e.setPitch(second.pitch_id, "candidate");
    expect(a()).toMatchObject({ status: "claimed", version: 3 });
  });

  it("a declined pitch under a live approach comes back alone; declining one pitch leaves the approach", () => {
    const s = addSpeaker(w, "f");
    const e = new Engine(w, ME);
    const r = e.propose(s.id, cell(1, 510, 600));
    e.setPitch(r.pitch_id, "declined");
    expect(e.week.approaches[0]).toMatchObject({ status: "claimed", version: 1 });
    e.setPitch(r.pitch_id, "approached");
    expect(e.week.approaches[0]).toMatchObject({ status: "claimed", version: 1 });
    expect(e.week.pitches[0].state).toBe("approached");
    expect(code(() => new Engine(w, OTHER).setPitch(r.pitch_id, "declined"))).toBe("forbidden");
  });

  it("refuses logistics, another member's approach, a stale version, a closed lesson's speaker", () => {
    const s = addSpeaker(w, "f");
    const e = new Engine(w, ME);
    const r = e.propose(s.id, cell(1, 510, 600));
    const id = e.week.approaches[0].id;
    expect(code(() => new Engine(w, LOGISTICS).setApproachStatus(id, 1, "no_answer"))).toBe("forbidden");
    expect(code(() => new Engine(w, OTHER).setApproachStatus(id, 1, "no_answer"))).toBe("not_handler");
    expect(code(() => e.setApproachStatus(id, 0, "no_answer"))).toBe("stale");
    e.closeLesson(r.pitch_id);
    expect(code(() => e.setApproachStatus(id, e.week.approaches[0].version, "declined"))).toBe("lesson_closed");
  });
});

describe("availability per slot (v14)", () => {
  const GLOBAL: Actor = { memberId: 7, role: "admin", global: true };
  // TEMPLATE_2026's rows by id: 1 = 06:30, 4 = 08:30, 13 = dinner (fixed), 14 = 20:00
  it("any editor marks a slot — no approach needed; a note is cleaned; the same again is nothing; null deletes", () => {
    const s = addSpeaker(w, "f");
    const e = new Engine(w, OTHER);
    e.setSlotAvailability(s.id, 1, 4, "can", "  רק עד   09:30  ");
    expect(e.week.slotAvailability).toEqual([{ id: 1, speaker_id: s.id, day: 1, row_id: 4, kind: "can", note: "רק עד 09:30", updated_by: OTHER.memberId }]);
    expect(e.week.approaches).toEqual([]);
    expect(e.shared.log).toMatchObject([{ edition_id: 1, entity: "approaches", entity_id: null, kind: "availability", detail: { speaker: s.id, day: 1, start: 510, end: 600, kind: "can" } }]);
    expect(e.shared.log[0].detail).not.toHaveProperty("note"); // the fact, never the note
    e.setSlotAvailability(s.id, 1, 4, "can", "רק עד 09:30");
    expect(e.shared.log).toHaveLength(1); // nothing changed: nothing logged
    new Engine(e.week, ME, undefined, e.shared).setSlotAvailability(s.id, 1, 4, "cannot");
    expect(e.week.slotAvailability).toMatchObject([{ id: 1, kind: "cannot", note: null, updated_by: ME.memberId }]);
    e.setSlotAvailability(s.id, 1, 4, null, "נשכח");
    expect(e.week.slotAvailability).toEqual([]);
    expect(e.shared.log.at(-1)!.detail).toEqual({ speaker: s.id, day: 1, start: 510, end: 600, kind: null });
    e.setSlotAvailability(s.id, 1, 4, null);
    expect(e.shared.log).toHaveLength(3);
  });

  it("logs under the speaker's approach when there is one; an admin and a global admin write too", () => {
    const s = addSpeaker(w, "m");
    const a = addApproach(w, s, "claimed");
    const admin = new Engine(w, ADMIN);
    admin.setSlotAvailability(s.id, 2, 14, "can");
    new Engine(w, GLOBAL, undefined, admin.shared).setSlotAvailability(s.id, 2, 14, "cannot");
    expect(admin.week.slotAvailability).toMatchObject([{ day: 2, row_id: 14, kind: "cannot", updated_by: GLOBAL.memberId }]);
    expect(admin.shared.log).toMatchObject([
      { actor: ADMIN.memberId, entity_id: a.id, detail: { start: 1200, end: 1290, kind: "can" } },
      { actor: GLOBAL.memberId, entity_id: a.id, detail: { kind: "cannot" } },
    ]);
  });

  it("refuses logistics, an archive (but its admin), a speaker missing or retired, a day, a row not in play, a kind, a long note", () => {
    const s = addSpeaker(w, "f");
    const retired = addSpeaker(w, "m");
    retired.retired = true;
    const e = new Engine(w, ME);
    const at = (...args: Parameters<Engine["setSlotAvailability"]>) => code(() => e.setSlotAvailability(...args));
    expect(code(() => new Engine(w, LOGISTICS).setSlotAvailability(s.id, 1, 4, "can"))).toBe("forbidden");
    expect(at(9999, 1, 4, "can")).toBe("speaker_retired");
    expect(at(retired.id, 1, 4, "can")).toBe("speaker_retired");
    expect(at(s.id, 5, 4, "can")).toBe("bad_value");
    expect(at(s.id, 1.5, 4, "can")).toBe("bad_value");
    expect(at(s.id, 1, 13, "can")).toBe("outside_grid"); // dinner: no lesson row
    expect(at(s.id, 0, 1, "can")).toBe("outside_grid"); // Sunday before the opening
    expect(at(s.id, 4, 14, "can")).toBe("outside_grid"); // Thursday after the close
    expect(at(s.id, 1, 999, "can")).toBe("outside_grid"); // no such row here
    expect(at(s.id, 1, 4, "maybe" as never)).toBe("bad_value");
    expect(at(s.id, 1, 4, "can", "א".repeat(121))).toBe("bad_value");
    expect(at(s.id, 1, 4, null, "א".repeat(121))).toBe("bad_value"); // checked before the kind says «delete»
    expect(e.week.slotAvailability).toEqual([]);
    expect(e.shared.log).toEqual([]);
    w.edition.status = "archived";
    expect(code(() => new Engine(w, ME).setSlotAvailability(s.id, 1, 4, "can"))).toBe("archived");
    expect(code(() => new Engine(w, ADMIN).setSlotAvailability(s.id, 1, 4, "can"))).toBe("ok");
  });
});

describe("availability by ranges (v18)", () => {
  // TEMPLATE_2026's lesson rows by id: 1 = 06:30, 4 = 08:30, 5 = 10:00, 6 = 11:30, 10 = 14:30, 11 = 16:00, 12 = 17:30, 14 = 20:00, 16 = 22:30, 18/19/20 = the night
  const can = (day: 0 | 1 | 2 | 3 | 4, start: number, end: number) => ({ day, start, end, kind: "can" as const });
  const cannot = (day: 0 | 1 | 2 | 3 | 4, start: number, end: number) => ({ day, start, end, kind: "cannot" as const });
  const marks = (e: Engine, speakerId: number) =>
    e.week.slotAvailability.filter((v) => v.speaker_id === speakerId).map((v) => `${v.day}:${v.row_id}:${v.kind}`).sort();

  it("replaces the listed days' slots — their notes with them — by what the ranges say; other days and other speakers stay", () => {
    const s = addSpeaker(w, "f");
    const other = addSpeaker(w, "m");
    const e = new Engine(w, ME);
    e.setSlotAvailability(s.id, 1, 14, "can", "רק עד 21:00"); // goes: day 1 is replaced
    e.setSlotAvailability(s.id, 1, 4, "cannot");
    e.setSlotAvailability(s.id, 2, 4, "can", "הערה לדוגמה"); // stays: day 2 is not listed
    e.setSlotAvailability(other.id, 1, 4, "can");
    const logged = e.shared.log.length;
    const n = new Engine(e.week, OTHER, undefined, e.shared).setAvailabilityRanges(s.id, [1], [can(1, 510, 780), cannot(1, 650, 700)]);
    expect(n).toBe(3);
    expect(marks(e, s.id)).toEqual(["1:4:can", "1:5:cannot", "1:6:cannot", "2:4:can"]);
    expect(e.week.slotAvailability.filter((v) => v.speaker_id === s.id && v.day === 1).every((v) => v.note === null && v.updated_by === OTHER.memberId)).toBe(true);
    expect(e.week.slotAvailability.find((v) => v.speaker_id === s.id && v.day === 2)).toMatchObject({ note: "הערה לדוגמה", updated_by: ME.memberId });
    expect(marks(e, other.id)).toEqual(["1:4:can"]);
    expect(new Set(e.week.slotAvailability.map((v) => v.id)).size).toBe(e.week.slotAvailability.length);
    // ONE event, counts only — never a note, never one per slot
    expect(e.shared.log.slice(logged)).toMatchObject([{ actor: OTHER.memberId, edition_id: 1, entity: "approaches", entity_id: null, kind: "availability" }]);
    expect(e.shared.log.at(-1)!.detail).toEqual({ speaker: s.id, days: [1], ranges: 2, marked: 3, rest: null });
  });

  it("a partly covered row and two adjacent can-ranges mark nothing; the rest fills what no range decides; several days at once", () => {
    const s = addSpeaker(w, "f");
    const a = addApproach(w, s, "claimed");
    const e = new Engine(w, ME);
    expect(e.setAvailabilityRanges(s.id, [1], [can(1, 540, 690), can(1, 690, 735), can(1, 735, 780)])).toBe(1);
    expect(marks(e, s.id)).toEqual(["1:5:can"]);
    expect(e.shared.log.at(-1)).toMatchObject({ entity_id: a.id, detail: { speaker: s.id, days: [1], ranges: 3, marked: 1, rest: null } }); // under the approach
    // the same day again, with a rest: every lesson row of the day is decided; day 3 too (given out of order)
    expect(e.setAvailabilityRanges(s.id, [3, 1], [cannot(1, 1200, 1830)], "can")).toBe(24);
    expect(marks(e, s.id).filter((m) => m.startsWith("1:")).sort()).toEqual(
      ["1:1:can", "1:4:can", "1:5:can", "1:6:can", "1:10:can", "1:11:can", "1:12:can", "1:14:cannot", "1:16:cannot", "1:18:cannot", "1:19:cannot", "1:20:cannot"].sort(),
    );
    expect(marks(e, s.id).filter((m) => m.startsWith("3:")).every((m) => m.endsWith(":can"))).toBe(true);
    expect(e.shared.log.at(-1)!.detail).toEqual({ speaker: s.id, days: [1, 3], ranges: 1, marked: 24, rest: "can" });
  });

  it("the cut days: Sunday before the opening and Thursday after the close are never marked", () => {
    const s = addSpeaker(w, "m");
    const e = new Engine(w, ME);
    expect(e.setAvailabilityRanges(s.id, [0, 4], [can(0, 390, 600)], "cannot")).toBe(11 + 7);
    const sunday = marks(e, s.id).filter((m) => m.startsWith("0:"));
    expect(sunday).toContain("0:4:can");
    expect(sunday.some((m) => m.startsWith("0:1:"))).toBe(false); // 06:30 on Sunday: not in play
    expect(marks(e, s.id).filter((m) => m.startsWith("4:")).map((m) => Number(m.split(":")[1])).sort((x, y) => x - y)).toEqual([1, 4, 5, 6, 10, 11, 12]);
  });

  it("is always logged, once — also when it marks nothing; no ranges and no rest clear the days", () => {
    const s = addSpeaker(w, "f");
    const e = new Engine(w, ME);
    e.setAvailabilityRanges(s.id, [2], [], "can");
    expect(marks(e, s.id)).toHaveLength(12);
    expect(e.setAvailabilityRanges(s.id, [2], null)).toBe(0);
    expect(marks(e, s.id)).toEqual([]);
    expect(e.shared.log.map((x) => [x.kind, x.detail.marked, x.detail.ranges])).toEqual([["availability", 12, 0], ["availability", 0, 0]]);
    expect(e.setAvailabilityRanges(s.id, [2], [can(2, 520, 590)])).toBe(0); // inside one row: nothing covered
    expect(e.shared.log).toHaveLength(3);
  });

  it("refuses in order: who (logistics, an archive but its admin), the speaker, then the input — and changes nothing", () => {
    const s = addSpeaker(w, "f");
    const retired = addSpeaker(w, "m");
    retired.retired = true;
    const e = new Engine(w, ME);
    e.setSlotAvailability(s.id, 1, 4, "can", "הערה לדוגמה");
    const before = JSON.stringify(e.week.slotAvailability);
    const at = (...args: Parameters<Engine["setAvailabilityRanges"]>) => code(() => e.setAvailabilityRanges(...args));
    expect(code(() => new Engine(w, LOGISTICS).setAvailabilityRanges(retired.id, [9], "x"))).toBe("forbidden"); // who comes first
    expect(at(9999, [1], [])).toBe("speaker_retired");
    expect(at(retired.id, [9], "x")).toBe("speaker_retired"); // the speaker before the input
    expect(at(s.id, [], [])).toBe("bad_value");
    expect(at(s.id, [1, 1], [])).toBe("bad_value");
    expect(at(s.id, [5], [])).toBe("bad_value");
    expect(at(s.id, [1], [can(2, 510, 600)])).toBe("bad_value"); // a day this call does not replace
    expect(at(s.id, [1], [can(1, 600, 510)])).toBe("bad_value");
    expect(at(s.id, [1], [can(1, 510, 1835)])).toBe("bad_value");
    expect(at(s.id, [1], [{ ...can(1, 510, 600), note: "הערה לדוגמה" }])).toBe("bad_value");
    expect(at(s.id, [1], [{ day: 1, start: 510, end: 600, kind: "maybe" }])).toBe("bad_value");
    expect(at(s.id, [1], Array.from({ length: 41 }, () => can(1, 510, 600)))).toBe("bad_value");
    expect(at(s.id, [1], [], "maybe" as never)).toBe("bad_value");
    expect(JSON.stringify(e.week.slotAvailability)).toBe(before); // the day's slots and its note are still there
    expect(e.shared.log).toHaveLength(1);
    w.edition.status = "archived";
    expect(code(() => new Engine(w, ME).setAvailabilityRanges(s.id, [1], []))).toBe("archived");
    expect(code(() => new Engine(w, ADMIN).setAvailabilityRanges(s.id, [1], []))).toBe("ok");
  });
});

describe("the call template (v14)", () => {
  it("is the edition admin's: cleaned, a limit, empty removes it", () => {
    for (const actor of [ME, LOGISTICS]) expect(code(() => new Engine(w, actor).setCallTemplate("נוסח לדוגמה {{שמי}}"))).toBe("forbidden");
    const e = new Engine(w, ADMIN);
    e.setCallTemplate("  נוסח לדוגמה {{שמי}}\r\nשורה שנייה  ");
    expect(e.week.edition.settings.call_template).toBe("נוסח לדוגמה {{שמי}}\nשורה שנייה");
    expect(code(() => e.setCallTemplate("א".repeat(4001)))).toBe("bad_value");
    expect(e.week.edition.settings.call_template).toBe("נוסח לדוגמה {{שמי}}\nשורה שנייה");
    e.setCallTemplate("   ");
    expect("call_template" in e.week.edition.settings).toBe(false);
    e.setCallTemplate(null);
    expect(e.week.edition.settings).toEqual({});
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
    expect(new Engine(e.week, LOGISTICS, undefined, e.shared).transportOf(id)?.pickup_address).toBe("כתובת לדוגמה"); // v18: from the request on
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

describe("day owners (v18)", () => {
  const GLOBAL: Actor = { memberId: 7, role: "admin", global: true };
  const AT = "2026-11-18T10:00:00.000Z";
  beforeEach(() => {
    w.team = [
      { id: 1, display_name: "חניך/ה א׳", gender: null, role: "content" },
      { id: 2, display_name: "חניך/ה ב׳", gender: null, role: "content" },
      { id: 5, display_name: "לוגיסטיקה לדוגמה", gender: null, role: "logistics" },
      { id: 9, display_name: "מדריך/ה לדוגמה", gender: null, role: "admin" },
    ];
  });

  it("an admin of the edition gives a day its pair: by day and member, never seen yet — logged once, the ids ascending", () => {
    const e = new Engine(w, ADMIN);
    e.setDayOwners(2, [2, 1]);
    e.setDayOwners(0, [9]); // an admin handles speakers too; a member may own more than one day
    e.setDayOwners(4, [1]);
    expect(e.week.dayOwners).toEqual([
      { day: 0, member_id: 9, seen_at: null },
      { day: 2, member_id: 1, seen_at: null },
      { day: 2, member_id: 2, seen_at: null },
      { day: 4, member_id: 1, seen_at: null },
    ]);
    expect(e.shared.log).toMatchObject([
      { actor: ADMIN.memberId, edition_id: 1, entity: "editions", entity_id: 1, kind: "day_owners", detail: { day: 2, members: [1, 2] } },
      { detail: { day: 0, members: [9] } },
      { detail: { day: 4, members: [1] } },
    ]);
    new Engine(e.week, GLOBAL, undefined, e.shared).setDayOwners(3, [2]); // a global admin is an admin of the edition
    expect(e.week.dayOwners.filter((o) => o.day === 3)).toEqual([{ day: 3, member_id: 2, seen_at: null }]);
  });

  it("replaces the day's owners: whoever stays keeps their seen_at, a new one has none; the same pair again is nothing; none empties the day", () => {
    const e = new Engine(w, ADMIN, () => AT);
    e.setDayOwners(1, [1, 2]);
    new Engine(e.week, OTHER, () => AT, e.shared).markDaySeen(1);
    e.setDayOwners(1, [2, 1]); // the same pair, the other way round
    expect(e.shared.log).toHaveLength(1);
    e.setDayOwners(1, [9, 2]);
    expect(e.week.dayOwners).toEqual([
      { day: 1, member_id: 2, seen_at: AT }, // stayed
      { day: 1, member_id: 9, seen_at: null }, // new
    ]);
    expect(e.shared.log.at(-1)!.detail).toEqual({ day: 1, members: [2, 9] });
    e.setDayOwners(1, null);
    expect(e.week.dayOwners).toEqual([]);
    expect(e.shared.log.at(-1)!.detail).toEqual({ day: 1, members: [] });
    e.setDayOwners(1, []);
    expect(e.shared.log).toHaveLength(3); // already empty: nothing
  });

  it("refuses: not an admin (first); a day off the week; more than two, a repeat, or a member who cannot handle speakers here", () => {
    const e = new Engine(w, ADMIN);
    for (const actor of [ME, LOGISTICS]) expect(code(() => new Engine(w, actor).setDayOwners(9, [1, 1, 1]))).toBe("forbidden");
    expect(code(() => e.setDayOwners(5, [1]))).toBe("bad_value");
    expect(code(() => e.setDayOwners(-1, [1]))).toBe("bad_value");
    expect(code(() => e.setDayOwners(1.5, [1]))).toBe("bad_value");
    expect(code(() => e.setDayOwners(1, [1, 2, 9]))).toBe("bad_value");
    expect(code(() => e.setDayOwners(1, [1, 1]))).toBe("bad_value");
    expect(code(() => e.setDayOwners(1, [5]))).toBe("bad_value"); // logistics does not handle speakers
    expect(code(() => e.setDayOwners(1, [1, 404]))).toBe("bad_value"); // not on this edition's team
    expect(code(() => e.setDayOwners(1, [null as never]))).toBe("bad_value");
    expect(e.week.dayOwners).toEqual([]);
    expect(e.shared.log).toEqual([]);
    w.edition.status = "archived"; // as set_grid_rules: an archived edition's admin still may
    expect(code(() => new Engine(w, ADMIN).setDayOwners(1, [1]))).toBe("ok");
    expect(code(() => new Engine(w, ME).setDayOwners(1, [1]))).toBe("forbidden");
  });

  it("«ראיתי»: an owner marks their own row, now — nobody else's, and nobody who is not an owner; not logged", () => {
    const e = new Engine(w, ADMIN);
    e.setDayOwners(1, [1, 2]);
    e.setDayOwners(2, [2]);
    const logged = e.shared.log.length;
    new Engine(e.week, ME, () => AT, e.shared).markDaySeen(1);
    expect(e.week.dayOwners).toEqual([
      { day: 1, member_id: 1, seen_at: AT },
      { day: 1, member_id: 2, seen_at: null },
      { day: 2, member_id: 2, seen_at: null },
    ]);
    const later = "2026-11-19T08:00:00.000Z";
    new Engine(e.week, ME, () => later, e.shared).markDaySeen(1);
    expect(e.week.dayOwners[0].seen_at).toBe(later);
    expect(code(() => new Engine(e.week, ME, undefined, e.shared).markDaySeen(2))).toBe("forbidden"); // not this day's owner
    for (const actor of [ADMIN, GLOBAL, LOGISTICS]) expect(code(() => new Engine(e.week, actor, undefined, e.shared).markDaySeen(1))).toBe("forbidden");
    expect(code(() => new Engine(e.week, ME, undefined, e.shared).markDaySeen(7))).toBe("bad_value");
    expect(code(() => new Engine(e.week, LOGISTICS, undefined, e.shared).markDaySeen(7))).toBe("bad_value"); // the day before who
    expect(e.shared.log).toHaveLength(logged);
    e.week.edition.status = "archived"; // no archived refusal: an owner still may
    expect(code(() => new Engine(e.week, OTHER, () => AT, e.shared).markDaySeen(2))).toBe("ok");
  });

  it("a Week built before v18 (no dayOwners) reads as none", () => {
    delete (w as Partial<Week>).dayOwners;
    const e = new Engine(w, ADMIN);
    expect(code(() => new Engine(w, ME).markDaySeen(1))).toBe("forbidden");
    e.setDayOwners(1, [1]);
    expect(e.week.dayOwners).toEqual([{ day: 1, member_id: 1, seen_at: null }]);
  });
});

describe("transport in two parts, approvals by both teams (v18)", () => {
  const GLOBAL: Actor = { memberId: 7, role: "admin", global: true };
  const FIVE_EMPTY = { pickup_address: null, pickup_time: null, driver_name: null, driver_phone: null, arranged: false };
  /** A real edition, a lesson ME closed; `ask` requests a round trip (approval pending). */
  function closedByMe(ask = true) {
    w.edition.kind = "real";
    const e = new Engine(w, ME);
    const r = e.propose(addSpeaker(w, "f").id, cell(1, 510, 600));
    e.closeLesson(r.pitch_id);
    const l = () => e.week.lessons.find((x) => x.id === r.lesson_id)!;
    if (ask) e.setPayment(r.lesson_id, l().version, null, "round_trip");
    const as = (actor: Actor) => new Engine(e.week, actor, undefined, e.shared);
    const decide = (decision: "approved" | "rejected" = "approved", actor: Actor = GLOBAL) => as(actor).decidePayments([{ lesson_id: r.lesson_id, version: l().version }], decision);
    return { e, id: r.lesson_id, l, as, decide };
  }

  it("the request's half: the handler fills it BEFORE the approval — only the keys present, the fields logged, the lesson's version as it was", () => {
    const { e, id, l, as } = closedByMe();
    const version = l().version;
    e.setTransportRequest(id, { pickup_address: "  כתובת   לדוגמה ", pickup_min: 435 });
    expect(l().approval).toBe("pending");
    expect(l().version).toBe(version);
    expect(e.shared.transport[`1:${id}`]).toEqual({ ...FIVE_EMPTY, pickup_address: "כתובת לדוגמה", pickup_min: 435 });
    expect(e.shared.log.at(-1)).toMatchObject({ actor: ME.memberId, edition_id: 1, entity: "lessons", entity_id: id, kind: "transport", detail: { fields: ["pickup_address", "pickup_min"] } });
    expect(JSON.stringify(e.shared.log)).not.toContain("כתובת לדוגמה"); // the names, never the values
    expect(JSON.stringify(e.week)).not.toMatch(/כתובת לדוגמה|pickup_min/); // never in the Week
    // a key left out stays; null clears; the same again is nothing
    as(ADMIN).setTransportRequest(id, { pickup_time: "07:15" });
    expect(e.shared.transport[`1:${id}`]).toEqual({ ...FIVE_EMPTY, pickup_address: "כתובת לדוגמה", pickup_time: "07:15", pickup_min: 435 });
    expect(e.shared.log.at(-1)).toMatchObject({ actor: ADMIN.memberId, detail: { fields: ["pickup_time"] } });
    const logged = e.shared.log.length;
    e.setTransportRequest(id, { pickup_time: "07:15", pickup_address: "כתובת לדוגמה", pickup_min: 435 });
    e.setTransportRequest(id, {});
    expect(e.shared.log).toHaveLength(logged);
    e.setTransportRequest(id, { pickup_min: null, pickup_address: "", pickup_time: "07:30" });
    expect(e.shared.transport[`1:${id}`]).toEqual({ ...FIVE_EMPTY, pickup_time: "07:30" });
    expect(e.shared.log.at(-1)!.detail).toEqual({ fields: ["pickup_address", "pickup_time", "pickup_min"] }); // in the function's order
    // get_transport_details still shows the five fields; the minute comes with the transports read alone
    e.setTransportRequest(id, { pickup_min: 440 });
    expect(e.transportOf(id)).toEqual({ ...FIVE_EMPTY, pickup_time: "07:30" });
    expect(e.transportsOf()).toEqual([{ lesson_id: id, ...FIVE_EMPTY, pickup_time: "07:30", approval: "pending", pickup_min: 440 }]);
  });

  it("the request refuses in order: the lesson, an editor, a closed lesson, its handler, a transport asked for, then the patch", () => {
    const { e, id, l, as } = closedByMe(false);
    const draft = addLesson(e.week, 2, 510, 600);
    expect(code(() => as(LOGISTICS).setTransportRequest(9999, { nope: 1 } as never))).toBe("stale"); // the lesson first
    expect(code(() => as(LOGISTICS).setTransportRequest(draft.id, {}))).toBe("forbidden"); // then who
    expect(code(() => e.setTransportRequest(draft.id, { nope: 1 } as never))).toBe("not_closed");
    expect(code(() => as(OTHER).setTransportRequest(id, { nope: 1 } as never))).toBe("not_handler"); // before the transport and the patch
    expect(code(() => e.setTransportRequest(id, { nope: 1 } as never))).toBe("no_transport"); // nothing asked for
    e.setPayment(id, l().version, 300, "one_way");
    expect(code(() => e.setTransportRequest(id, { nope: 1 } as never))).toBe("bad_value");
    expect(code(() => e.setTransportRequest(id, { driver_name: "נהג/ת לדוגמה" } as never))).toBe("bad_value"); // the other half's key
    expect(code(() => e.setTransportRequest(id, { pickup_min: 1831 }))).toBe("bad_value");
    expect(code(() => e.setTransportRequest(id, { pickup_min: 7.5 }))).toBe("bad_value");
    expect(code(() => e.setTransportRequest(id, { pickup_address: "א".repeat(201) }))).toBe("bad_value");
    expect(code(() => e.setTransportRequest(id, null as never))).toBe("bad_value");
    expect(e.shared.transport).toEqual({});
    expect(e.shared.log.filter((x) => x.kind === "transport")).toEqual([]);
    Object.assign(l(), { state: "cancelled" });
    expect(code(() => e.setTransportRequest(id, {}))).toBe("stale");
  });

  it("the request is filled whatever the decision — but only by who may read it back: never a practice, demo or archived edition's own team", () => {
    const { e, id, as, decide } = closedByMe();
    decide("rejected");
    expect(code(() => e.setTransportRequest(id, { pickup_time: "07:15" }))).toBe("ok"); // rejected: still the handler's to fix
    for (const kind of ["practice", "demo"] as const) {
      e.week.edition.kind = kind;
      // a sandbox shows transport details to the global admin alone — so its handler and its admin write none either
      expect(e.transportOf(id)).toBeNull();
      expect(code(() => e.setTransportRequest(id, { pickup_time: "07:20" })), kind).toBe("transport_hidden");
      expect(code(() => as(ADMIN).setTransportRequest(id, { pickup_time: "07:20" })), kind).toBe("transport_hidden");
      expect(code(() => e.setTransportRequest(id, { nope: 1 } as never)), kind).toBe("transport_hidden"); // who reads, before the patch
    }
    expect(as(GLOBAL).transportOf(id)).toEqual({ ...FIVE_EMPTY, pickup_time: "07:15" }); // nothing was written
    expect(code(() => as(GLOBAL).setTransportRequest(id, { pickup_time: "07:20" }))).toBe("ok"); // the global admin reads, so writes
    e.week.edition.kind = "real";
    e.week.edition.status = "archived";
    expect(code(() => e.setTransportRequest(id, { pickup_time: "07:25" }))).toBe("archived");
    expect(code(() => as(ADMIN).setTransportRequest(id, { pickup_time: "07:25" }))).toBe("transport_hidden"); // its own admin reads nothing there
    expect(code(() => as(GLOBAL).setTransportRequest(id, { pickup_time: "07:25" }))).toBe("ok");
    expect(as(GLOBAL).transportOf(id)).toEqual({ ...FIVE_EMPTY, pickup_time: "07:25" });
  });

  it("the driver's half: logistics or an admin, only once the transport is approved — the request's fields stay", () => {
    const { e, id, as, decide } = closedByMe();
    e.setTransportRequest(id, { pickup_address: "כתובת לדוגמה", pickup_min: 435 });
    for (const actor of [LOGISTICS, ADMIN, GLOBAL]) expect(code(() => as(actor).setTransportDriver(id, { arranged: true }))).toBe("transport_hidden"); // not approved yet
    decide();
    as(LOGISTICS).setTransportDriver(id, { driver_name: " נהג/ת   לדוגמה ", driver_phone: "555 0100", arranged: true });
    expect(e.shared.transport[`1:${id}`]).toEqual({ pickup_address: "כתובת לדוגמה", pickup_time: null, driver_name: "נהג/ת לדוגמה", driver_phone: "555 0100", arranged: true, pickup_min: 435 });
    expect(e.shared.log.at(-1)).toMatchObject({ actor: LOGISTICS.memberId, entity: "lessons", entity_id: id, kind: "transport", detail: { fields: ["driver_name", "driver_phone", "arranged"] } });
    expect(JSON.stringify(e.shared.log)).not.toMatch(/נהג\/ת לדוגמה|555 0100/);
    const logged = e.shared.log.length;
    as(ADMIN).setTransportDriver(id, { driver_name: "נהג/ת לדוגמה", arranged: true }); // the same: nothing
    as(ADMIN).setTransportDriver(id, {});
    expect(e.shared.log).toHaveLength(logged);
    as(ADMIN).setTransportDriver(id, { arranged: false });
    expect(e.shared.transport[`1:${id}`]).toMatchObject({ driver_name: "נהג/ת לדוגמה", driver_phone: "555 0100", arranged: false });
    expect(e.shared.log.at(-1)!.detail).toEqual({ fields: ["arranged"] });
    as(LOGISTICS).setTransportDriver(id, { driver_phone: null });
    expect(e.shared.transport[`1:${id}`].driver_phone).toBeNull();
    // the old five-field write keeps the minute it does not know
    e.setTransport(id, { pickup_address: "כתובת אחרת לדוגמה", pickup_time: "07:15", driver_name: null, driver_phone: null, arranged: false });
    expect(e.shared.transport[`1:${id}`]).toEqual({ pickup_address: "כתובת אחרת לדוגמה", pickup_time: "07:15", driver_name: null, driver_phone: null, arranged: false, pickup_min: 435 });
    expect(as(LOGISTICS).transportsOf()).toEqual([{ lesson_id: id, pickup_address: "כתובת אחרת לדוגמה", pickup_time: "07:15", driver_name: null, driver_phone: null, arranged: false, approval: "approved", pickup_min: 435 }]);
  });

  it("the driver refuses in order: the lesson, logistics or an admin, a transport, the approval, the shape, then the values", () => {
    const { e, id, l, as, decide } = closedByMe(false);
    expect(code(() => e.setTransportDriver(9999, {}))).toBe("stale"); // the lesson before who
    expect(code(() => e.setTransportDriver(id, { nope: 1 } as never))).toBe("forbidden"); // a content member, the handler included
    expect(code(() => as(LOGISTICS).setTransportDriver(id, { nope: 1 } as never))).toBe("no_transport");
    e.setPayment(id, l().version, 300, "one_way");
    expect(code(() => as(LOGISTICS).setTransportDriver(id, { nope: 1 } as never))).toBe("transport_hidden"); // pending
    decide("rejected");
    expect(code(() => as(LOGISTICS).setTransportDriver(id, { arranged: true }))).toBe("transport_hidden"); // rejected
    e.setPayment(id, l().version, 300, "one_way"); // asked again
    decide();
    expect(code(() => as(LOGISTICS).setTransportDriver(id, { nope: 1 } as never))).toBe("bad_value");
    expect(code(() => as(LOGISTICS).setTransportDriver(id, { pickup_time: "07:15" } as never))).toBe("bad_value"); // the other half's key
    expect(code(() => as(LOGISTICS).setTransportDriver(id, { arranged: null as never }))).toBe("bad_value");
    expect(code(() => as(LOGISTICS).setTransportDriver(id, { driver_phone: "12-34" }))).toBe("bad_phone");
    expect(code(() => as(LOGISTICS).setTransportDriver(id, { driver_phone: "12-34", arranged: "yes" as never }))).toBe("bad_value");
    expect(e.shared.transport).toEqual({});
    // a practice or demo week: its logistics and its admin read no driver, so they write none
    for (const kind of ["practice", "demo"] as const) {
      e.week.edition.kind = kind;
      for (const actor of [LOGISTICS, ADMIN]) expect(code(() => as(actor).setTransportDriver(id, { arranged: true })), kind).toBe("transport_hidden");
    }
    e.week.edition.kind = "real";
    e.week.edition.status = "archived";
    expect(code(() => as(LOGISTICS).setTransportDriver(id, { arranged: true }))).toBe("archived");
    expect(code(() => as(ME).setTransportDriver(id, { arranged: true }))).toBe("forbidden");
    expect(code(() => as(ADMIN).setTransportDriver(id, { arranged: true }))).toBe("transport_hidden"); // an archived edition's own admin reads nothing
    expect(e.shared.transport).toEqual({});
    expect(code(() => as(GLOBAL).setTransportDriver(id, { arranged: true }))).toBe("ok");
  });

  it("the details go with the transport and with the speaker: no transport any more, or a reopen, and the minute is gone too", () => {
    const { e, id, l, as } = closedByMe();
    e.setTransportRequest(id, { pickup_min: 435 });
    e.setPayment(id, l().version, 300, "none");
    expect(e.shared.transport).toEqual({});
    e.setPayment(id, l().version, 300, "one_way");
    e.setTransportRequest(id, { pickup_min: 440 });
    as(ADMIN).reopenLesson(id);
    expect(e.shared.transport).toEqual({});
  });

  it("who sees a request's pickup (may_see_transport): the handler and the edition's admins always; logistics while it waits or was approved; nobody else", () => {
    const { e, id, l, as, decide } = closedByMe(false);
    const sees = () => [ME, OTHER, ADMIN, LOGISTICS, GLOBAL].map((actor) => as(actor).transportOf(id) != null);
    const lists = () => [ME, OTHER, ADMIN, LOGISTICS, GLOBAL].map((actor) => as(actor).transportsOf().map((t) => t.approval));
    //                        handler, another trainee, edition admin, logistics, global admin
    expect(sees()).toEqual([true, false, true, false, true]); // nothing asked: «none»
    expect(lists()).toEqual([[], [], [], [], []]);
    e.setPayment(id, l().version, null, "one_way");
    e.setTransportRequest(id, { pickup_address: "כתובת לדוגמה", pickup_min: 435 });
    expect(sees()).toEqual([true, false, true, true, true]); // pending: logistics from the request on
    expect(lists()).toEqual([["pending"], [], ["pending"], ["pending"], ["pending"]]);
    expect(as(LOGISTICS).transportsOf()[0]).toMatchObject({ pickup_address: "כתובת לדוגמה", pickup_min: 435 });
    decide("rejected");
    expect(sees()).toEqual([true, false, true, false, true]); // rejected: not logistics
    expect(lists()).toEqual([[], [], [], [], []]); // and in nobody's list
    e.setPayment(id, l().version, null, "one_way"); // asked again
    decide("approved");
    expect(sees()).toEqual([true, false, true, true, true]);
    expect(lists()).toEqual([["approved"], [], ["approved"], ["approved"], ["approved"]]);
    // the handler changes: the new one sees, the old one no more
    e.week.approaches[0].owner_member_id = OTHER.memberId;
    expect(sees()).toEqual([false, true, true, true, true]);
    // a sandbox, and an archived edition: the global admin alone — the edition's admin and logistics included
    for (const change of [{ kind: "practice" as const }, { kind: "demo" as const }, { kind: "real" as const, status: "archived" as const }]) {
      Object.assign(e.week.edition, { kind: "real", status: "planning" }, change);
      expect(sees()).toEqual([false, false, false, false, true]);
      expect(lists()).toEqual([[], [], [], [], ["approved"]]);
    }
  });

  it("an imported archive's note keeps its rule (the same predicate): the global admin alone, as before v18", () => {
    w.edition.kind = "archive";
    w.edition.status = "archived";
    const s = addSpeaker(w, "f");
    addApproach(w, s, "positive");
    const lesson = closeWith(w, addLesson(w, 1, 510, 600, { transport: "one_way", approval: "approved" }), s);
    const e = new Engine(w, GLOBAL);
    e.shared.importNotes[`1:${lesson.id}`] = "הערה מהגיליון לדוגמה";
    const as = (actor: Actor) => new Engine(w, actor, undefined, e.shared);
    expect(as(GLOBAL).importNoteOf(lesson.id)).toBe("הערה מהגיליון לדוגמה");
    for (const actor of [ME, OTHER, ADMIN, LOGISTICS]) {
      expect(as(actor).importNoteOf(lesson.id)).toBeNull();
      expect(as(actor).transportOf(lesson.id)).toBeNull();
    }
  });

  it("approvals: a global admin, or an admin or logistics of the lesson's real, live edition — one is enough; approved_by is whoever gave it", () => {
    const { e, id, l, as, decide } = closedByMe();
    expect(code(() => decide("approved", ME))).toBe("forbidden"); // a trainee, the handler included
    expect(code(() => decide("approved", OTHER))).toBe("forbidden");
    decide("approved", LOGISTICS);
    expect(l()).toMatchObject({ approval: "approved", approved_by: LOGISTICS.memberId, updated_by: LOGISTICS.memberId, approval_note: null });
    expect(code(() => decide("approved", ADMIN))).toBe("stale"); // already decided: one approval is enough
    e.setPayment(id, l().version, 300, "round_trip");
    as(ADMIN).decidePayments([{ lesson_id: id, version: l().version }], "rejected", "  נימוק   לדוגמה ");
    expect(l()).toMatchObject({ approval: "rejected", approved_by: ADMIN.memberId, approval_note: "נימוק לדוגמה" });
    e.setPayment(id, l().version, 300, "round_trip");
    decide("approved", GLOBAL);
    expect(l()).toMatchObject({ approval: "approved", approved_by: GLOBAL.memberId });
  });

  it("approvals refuse in order: a trainee at once; a bad decision or note; then, lesson by lesson, a missing one, the edition, the version", () => {
    const { e, id, l, as } = closedByMe();
    const item = () => [{ lesson_id: id, version: l().version }];
    expect(code(() => as(ME).decidePayments(item(), "maybe" as never))).toBe("forbidden"); // who before the decision
    expect(code(() => as(LOGISTICS).decidePayments(item(), "maybe" as never))).toBe("bad_value");
    expect(code(() => as(LOGISTICS).decidePayments(item(), "approved", "א".repeat(301)))).toBe("bad_value");
    expect(code(() => as(LOGISTICS).decidePayments([{ lesson_id: 9999, version: 1 }], "approved"))).toBe("stale");
    expect(code(() => as(LOGISTICS).decidePayments([{ lesson_id: id, version: l().version - 1 }], "approved"))).toBe("stale");
    // outside a real, live edition only a global admin decides — said before the version is looked at, after a missing lesson
    for (const change of [{ kind: "practice" as const }, { kind: "demo" as const }, { kind: "real" as const, status: "archived" as const }]) {
      Object.assign(e.week.edition, { kind: "real", status: "planning" }, change);
      for (const actor of [LOGISTICS, ADMIN]) {
        expect(code(() => as(actor).decidePayments([{ lesson_id: id, version: l().version - 1 }], "approved"))).toBe("forbidden");
        expect(code(() => as(actor).decidePayments([{ lesson_id: 9999, version: 1 }], "approved"))).toBe("stale");
        expect(code(() => as(actor).decidePayments([], "approved"))).toBe("ok"); // nothing to decide: nothing refused
      }
      expect(l().approval).toBe("pending");
    }
    expect(code(() => as(GLOBAL).decidePayments(item(), "approved"))).toBe("ok"); // the archived edition's, by the global admin
    expect(l()).toMatchObject({ approval: "approved", approved_by: GLOBAL.memberId });
  });
});
