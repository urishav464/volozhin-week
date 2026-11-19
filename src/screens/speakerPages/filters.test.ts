import { describe, expect, it } from "vitest";
import { DEMO_TRAINEE, DemoPort } from "../../data/demoPort";
import { myDay } from "../../domain/myDay";
import { parseSpeakersQuery } from "../../domain/routes";
import type { Day } from "../../domain/time";
import type { Week } from "../../domain/types";
import { buildModel, openSlots } from "../../grid/model";
import { rangesToSlots } from "../../domain/availability";
import { rangesCall, rangesFormOf } from "../../domain/rangesForm";
import { targetOf } from "../../domain/placement";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek, pitch } from "../../testing/week";
import { teamBoard } from "../../domain/mine";
import { filterSpeakers, filterTeam, slotFor } from "./filters";

const ME = 2;

function mark(w: Week, speakerId: number, day: Day, start: number, kind: "can" | "cannot") {
  const row = w.rows.find((r) => r.kind === "lesson" && r.start_min === start)!;
  w.slotAvailability.push({ id: w.slotAvailability.length + 1, speaker_id: speakerId, day, row_id: row.id, kind, note: null, updated_by: null });
}

/** Five speakers in every section, by name: אורה (free), בתיה (mine), גדעון (others), דניאל (closed), הדס (declined). */
function fixture() {
  const w = emptyWeek();
  const free = addSpeaker(w, "f", "אורה");
  const mine = addSpeaker(w, "f", "בתיה");
  const others = addSpeaker(w, "m", "גדעון");
  const closed = addSpeaker(w, "m", "דניאל");
  const declined = addSpeaker(w, "f", "הדס");
  const retired = addSpeaker(w, "f", "ורד");
  retired.retired = true;
  addApproach(w, mine, "claimed").owner_member_id = ME;
  addApproach(w, others, "approached").owner_member_id = 3;
  addApproach(w, closed, "positive").owner_member_id = 3;
  addApproach(w, declined, "declined").owner_member_id = 3;
  closeWith(w, addLesson(w, 1, 960, 1050), closed);
  mine.topics = ['תנ"ך', "שירה"];
  others.affiliation = "מכון לדוגמה";
  return { w, free, mine, others, closed, declined, retired };
}

const names = (rows: { speaker: { name: string } }[]) => rows.map((r) => r.speaker.name);

describe("the speakers' list (filterSpeakers)", () => {
  it("never a retired speaker; by section (mine, free, others, closed, declined), else by name", () => {
    const { w, mine, closed } = fixture();
    const m = buildModel(w);
    const rows = filterSpeakers(m, ME, {});
    expect(names(rows)).toEqual(["בתיה", "אורה", "גדעון", "דניאל", "הדס"]);
    expect(rows.map((r) => r.section)).toEqual(["mine", "free", "others", "closed", "declined"]);
    expect(rows.find((r) => r.speaker.id === mine.id)).toMatchObject({ handler: ME, closed: 0, fit: null });
    expect(rows.find((r) => r.speaker.id === closed.id)?.closed).toBe(1);
    expect(names(filterSpeakers(m, ME, { sort: "name" }))).toEqual(["אורה", "בתיה", "גדעון", "דניאל", "הדס"]);
  });

  it("the search, a topic of the week, the gender and the section", () => {
    const { w } = fixture();
    const m = buildModel(w);
    expect(names(filterSpeakers(m, ME, { q: "מכון" }))).toEqual(["גדעון"]);
    expect(names(filterSpeakers(m, ME, { q: "שירה" }))).toEqual(["בתיה"]);
    expect(names(filterSpeakers(m, ME, { cat: 1 }))).toEqual(["בתיה"]); // 'תנ"ך', the week's first topic
    expect(names(filterSpeakers(m, ME, { cat: 99 }))).toEqual([]); // not a topic of the week: nobody
    expect(names(filterSpeakers(m, ME, { g: "m" }))).toEqual(["גדעון", "דניאל"]);
    expect(names(filterSpeakers(m, ME, { s: "others" }))).toEqual(["גדעון"]);
    expect(names(filterSpeakers(m, ME, { g: "f", s: "mine" }))).toEqual(["בתיה"]);
  });

  it("«מתאים/ה ליום»: «יכול/ה» on some slot of that day", () => {
    const { w, free, others } = fixture();
    mark(w, free.id, 2, 960, "can");
    mark(w, others.id, 2, 960, "cannot");
    mark(w, others.id, 3, 960, "can");
    const m = buildModel(w);
    expect(names(filterSpeakers(m, ME, { day: 2 }))).toEqual(["אורה"]);
    expect(names(filterSpeakers(m, ME, { day: 3 }))).toEqual(["גדעון"]);
  });

  it("«מתאים/ה ליום» keeps a day saved as «רק בשעות…» (part «יכול/ה», the rest «לא»)", () => {
    const { w, free, others } = fixture();
    // the ranges editor's «רק בשעות…» 16:00–17:30 on Monday: «יכול/ה» on that row, «לא» on every other
    const initial = rangesFormOf(w.rows, w.edition, []);
    const call = rangesCall(w.rows, w.edition, initial, { ...initial, 1: { mode: "hours", pairs: [{ from: "16:00", to: "17:30" }] } });
    for (const x of rangesToSlots(w.rows, w.edition, call.days, call.ranges, null)) mark(w, free.id, x.day, w.rows.find((r) => r.id === x.row_id)!.start_min, x.kind);
    // a «לא» alone is still not a day they fit
    mark(w, others.id, 1, 960, "cannot");
    const m = buildModel(w);
    expect(names(filterSpeakers(m, ME, { day: 1 }))).toEqual(["אורה"]);
  });

  it("a slot: «יכול/ה» first, then who said nothing — never «לא», a time they teach, or who declined", () => {
    const { w, free, mine, others, closed } = fixture();
    mark(w, others.id, 1, 960, "can");
    mark(w, mine.id, 1, 960, "cannot");
    const m = buildModel(w);
    const rows = filterSpeakers(m, ME, { slot: { day: 1, start: 960, end: 1050 } });
    expect(names(rows)).toEqual(["גדעון", "אורה"]);
    expect(rows.map((r) => r.fit)).toEqual(["can", "neutral"]);
    expect(rows.some((r) => r.speaker.id === closed.id)).toBe(false); // «כבר משובץ» then
    // another time of the day: the closed speaker fits (they may teach twice); still «יכול/ה» first, then by section
    mark(w, free.id, 1, 1200, "can");
    const later = filterSpeakers(buildModel(w), ME, { slot: { day: 1, start: 1200, end: 1290 } });
    expect(names(later)).toEqual(["אורה", "בתיה", "גדעון", "דניאל"]);
    expect(names(filterSpeakers(buildModel(w), ME, { slot: { day: 1, start: 1200, end: 1290 }, sort: "name" }))).toEqual(["אורה", "בתיה", "גדעון", "דניאל"]);
  });

  it("the slot the list is for: the draft the address names, never its parallel twin", () => {
    const w = emptyWeek();
    // a parallel pair of bare drafts: the same day, start and end, two rooms
    const l1 = addLesson(w, 0, 1050, 1140, { room_id: 1 });
    const l2 = addLesson(w, 0, 1050, 1140, { room_id: 2 });
    const m = buildModel(w);
    expect(slotFor(m, { day: 0, start: 1050, end: 1140, lesson: l2.id })?.lessonId).toBe(l2.id);
    expect(targetOf(slotFor(m, { day: 0, start: 1050, end: 1140, lesson: l2.id })!)).toEqual({ lesson_id: l2.id });
    expect(slotFor(m, { day: 0, start: 1050, end: 1140, lesson: l1.id })?.lessonId).toBe(l1.id);
    // L2 filled meanwhile: the address still names it, never L1
    const s = addSpeaker(w, "f");
    pitch(w, l2, addApproach(w, s, "claimed"), "candidate");
    expect(slotFor(buildModel(w), { day: 0, start: 1050, end: 1140, lesson: l2.id })?.lessonId).toBe(l2.id);
    // L2 gone (cancelled): no draft of it to propose into — not L1
    l2.state = "cancelled";
    expect(slotFor(buildModel(w), { day: 0, start: 1050, end: 1140, lesson: l2.id })).toBeNull();
    // a free cell (no draft named): the cell, not a draft at its time
    const cell = slotFor(buildModel(w), { day: 0, start: 1200, end: 1290 });
    expect(cell).toMatchObject({ lessonId: null, start: 1200 });
    expect(slotFor(buildModel(w), { day: 0, start: 1200, end: 1250 })).toBeNull();
  });

  it("end to end on the demo engine: the second of two parallel drafts, from «היום שלי» through the list, is the one proposed into", async () => {
    const port = new DemoPort(DEMO_TRAINEE, { trainee: true });
    const cmds = port.commands(1);
    let w = await port.loadWeek(1);
    const free = openSlots(buildModel(w), 0).find((o) => o.lessonId == null)!;
    await cmds.reshape(0, free.start, { op: "split_parallel", count: 2, reason: "שתי קבוצות" });
    w = await port.loadWeek(1);
    const [l1, l2] = w.lessons.filter((l) => l.day === 0 && l.start_min === free.start && l.state === "draft").sort((a, b) => a.id - b.id);
    expect(l2).toBeDefined();
    const m = buildModel(w);
    // L2's card on the home: «לבחור מרצה» → the list for L2 itself
    const step = myDay(m, 0, DEMO_TRAINEE.memberId).slots.find((c) => c.lessonId === l2.id)!.step;
    expect(step.kind).toBe("choose");
    const to = (step as { to: string }).to;
    const q = parseSpeakersQuery(to.slice(to.indexOf("?")));
    const slot = slotFor(m, q.slot!)!;
    expect(slot.lessonId).toBe(l2.id);
    const speaker = w.speakers.find((s) => !s.retired && !m.approachBySpeaker.get(s.id))!;
    await cmds.propose(speaker.id, targetOf(slot), "self");
    w = await port.loadWeek(1);
    const into = w.pitches.filter((p) => w.approaches.find((a) => a.id === p.approach_id)?.speaker_id === speaker.id).map((p) => p.lesson_id);
    expect(into).toEqual([l2.id]);
    expect(w.pitches.some((p) => p.lesson_id === l1.id)).toBe(false);
  });
});

describe("filterTeam: «כל הצוות» under the search", () => {
  function team() {
    const f = fixture();
    f.w.team = [
      { id: ME, display_name: "חניך/ה א׳", gender: null, role: "content" },
      { id: 3, display_name: "חניך/ה ב׳", gender: null, role: "content" },
      { id: 9, display_name: "לוגיסטיקה", gender: null, role: "logistics" },
    ];
    addApproach(f.w, f.retired, "claimed").owner_member_id = ME;
    const nobody = addSpeaker(f.w, "m", "זאב");
    addApproach(f.w, nobody, "claimed").owner_member_id = null;
    return { ...f, nobody };
  }
  const ids = (b: ReturnType<typeof teamBoard>) => [b.owners.map((o) => [o.id, o.rows.map((r) => r.speaker.name)]), b.unowned.map((r) => r.speaker.name)];

  it("every handler's block in the team's order (never logistics), without a retired speaker; nothing typed keeps the board", () => {
    const { w } = team();
    const m = buildModel(w);
    expect(ids(filterTeam(m, teamBoard(w), {}))).toEqual([
      [
        [ME, ["בתיה"]],
        [3, ["גדעון", "דניאל", "הדס"]],
      ],
      ["זאב"],
    ]);
  });

  it("the search, the topic and the gender narrow every block; an emptied block stays", () => {
    const { w } = team();
    const m = buildModel(w);
    expect(ids(filterTeam(m, teamBoard(w), { q: "מכון" }))).toEqual([
      [
        [ME, []],
        [3, ["גדעון"]],
      ],
      [],
    ]);
    expect(ids(filterTeam(m, teamBoard(w), { cat: 1 }))[0]).toEqual([
      [ME, ["בתיה"]],
      [3, []],
    ]);
    expect(ids(filterTeam(m, teamBoard(w), { g: "m" }))).toEqual([
      [
        [ME, []],
        [3, ["גדעון", "דניאל"]],
      ],
      ["זאב"],
    ]);
  });
});
