import { describe, expect, it } from "vitest";
import { buildModel } from "../grid/model";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek, pitch } from "../testing/week";
import { hasFresh, myDay, offeredTo, ownedDays, staffDay } from "./myDay";
import type { Day } from "./time";
import type { Approach, SlotAvailability, Week } from "./types";

// The team: 1 the instructor, 2 and 3 Monday's pair, 4 another trainee. TEMPLATE_2026's lesson rows by id: 1 06:30,
// 4 08:30, 5 10:00, 6 11:30, 10 14:30, 11 16:00, 12 17:30, 14 20:00, 16 22:30, 18 00:30, 19 02:00, 20 03:30.
const ME = 2;
const PARTNER = 3;
const OTHER = 4;

function week(): Week {
  const w = emptyWeek();
  w.team = [
    { id: 1, display_name: "מדריך/ה", gender: null, role: "admin" },
    { id: 2, display_name: "חניך/ה א׳", gender: null, role: "content" },
    { id: 3, display_name: "חניך/ה ב׳", gender: null, role: "content" },
    { id: 4, display_name: "חניך/ה ג׳", gender: null, role: "content" },
  ];
  w.dayOwners = [
    { day: 1, member_id: ME, seen_at: null },
    { day: 1, member_id: PARTNER, seen_at: null },
    { day: 3, member_id: ME, seen_at: null },
    { day: 0, member_id: OTHER, seen_at: null },
  ];
  return w;
}

const own = (a: Approach, owner: number | null) => Object.assign(a, { owner_member_id: owner });
function can(w: Week, speakerId: number, day: Day, row_id: number, kind: SlotAvailability["kind"] = "can") {
  w.slotAvailability.push({ id: w.slotAvailability.length + 1, speaker_id: speakerId, day, row_id, kind, note: null, updated_by: null });
}

describe("ownedDays", () => {
  it("my days, in the week's order, each once", () => {
    const w = week();
    w.dayOwners.push({ day: 1, member_id: ME, seen_at: null }); // a duplicate row is still one day
    expect(ownedDays(w, ME)).toEqual([1, 3]);
    expect(ownedDays(w, OTHER)).toEqual([0]);
    expect(ownedDays(w, 1)).toEqual([]);
    expect(ownedDays({ dayOwners: [] }, ME)).toEqual([]);
  });
});

describe("myDay: the owners", () => {
  it("the day's owners, my partner, and when I looked", () => {
    const w = week();
    w.dayOwners[0].seen_at = "2026-11-10T10:00:00Z";
    const d = myDay(buildModel(w), 1, ME);
    expect(d).toMatchObject({ day: 1, owners: [2, 3], partners: [3], seenAt: "2026-11-10T10:00:00Z" });
    expect(myDay(buildModel(w), 3, ME)).toMatchObject({ owners: [2], partners: [], seenAt: null });
  });

  it("a day I do not own (staff's preview): its owners, nothing seen", () => {
    const d = myDay(buildModel(week()), 1, 1);
    expect(d).toMatchObject({ owners: [2, 3], partners: [2, 3], seenAt: null });
  });
});

describe("myDay: the slots and their one next step", () => {
  it("every slot of the day in time order: free, drafts, closed", () => {
    const w = week();
    closeWith(w, addLesson(w, 1, 600, 690), addSpeaker(w, "f"));
    addLesson(w, 1, 870, 960); // shaped, nobody pitched
    const d = myDay(buildModel(w), 1, ME);
    expect(d.slots.map((s) => [s.start, s.state])).toEqual([
      [390, "free"], [510, "free"], [600, "closed"], [690, "free"], [870, "draft"], [960, "free"], [1050, "free"],
      [1200, "free"], [1350, "free"], [1470, "free"], [1560, "free"], [1650, "free"],
    ]);
    expect(d.slots[0]).toMatchObject({ key: "free:1:390", label: "פתיחת יום", lessonId: null, candidates: [], handlers: [] });
  });

  it("a free slot, and a draft nobody is pitched in: choose a speaker for that slot", () => {
    const w = week();
    const bare = addLesson(w, 1, 870, 960);
    const declined = addLesson(w, 1, 960, 1050);
    pitch(w, declined, addApproach(w, addSpeaker(w, "m")), "declined");
    const d = myDay(buildModel(w), 1, ME);
    expect(d.slots.find((s) => s.start === 510)?.step).toEqual({ kind: "choose", to: "/speakers?slot=1:510-600" });
    // a draft by its id: the list proposes into it, not into a parallel one at the same time
    expect(d.slots.find((s) => s.lessonId === bare.id)?.step).toEqual({ kind: "choose", to: `/speakers?slot=1:870-960&lesson=${bare.id}` });
    expect(d.slots.find((s) => s.lessonId === declined.id)).toMatchObject({ state: "draft", candidates: [], step: { kind: "choose" } });
  });

  it("my candidate: the call → their page at the call; agreed and waiting → their page; approved → close the lesson", () => {
    const w = week();
    const toCall = addSpeaker(w, "f");
    const agreed = addSpeaker(w, "m");
    agreed.vetted = "pending";
    const ready = addSpeaker(w, "f");
    const a = addLesson(w, 1, 510, 600);
    const b = addLesson(w, 1, 600, 690);
    const c = addLesson(w, 1, 690, 780);
    pitch(w, a, own(addApproach(w, toCall, "claimed"), ME), "candidate");
    pitch(w, b, own(addApproach(w, agreed, "positive"), ME), "candidate");
    pitch(w, c, own(addApproach(w, ready, "positive"), ME), "candidate");
    const d = myDay(buildModel(w), 1, ME);
    const at = (id: number) => d.slots.find((s) => s.lessonId === id)!;
    expect(at(a.id).step).toEqual({ kind: "speaker", speakerId: toCall.id, group: "to_call", to: `/speakers/${toCall.id}#call` });
    expect(at(b.id).step).toEqual({ kind: "speaker", speakerId: agreed.id, group: "agreed", to: `/speakers/${agreed.id}` });
    expect(at(c.id).step).toEqual({ kind: "lesson", lessonId: c.id, step: "close", to: `/lesson/${c.id}?step=close` });
    expect(at(a.id).candidates).toEqual([{ pitchId: expect.any(Number), speakerId: toCall.id, status: "claimed", handler: ME, group: "to_call" }]);
    expect(at(a.id).handlers).toEqual([ME]);
  });

  it("the no-answer and the awaiting are both «the call»; a declined approach pitched again opens the speaker", () => {
    const w = week();
    const retry = addSpeaker(w, "f");
    const awaiting = addSpeaker(w, "m");
    const again = addSpeaker(w, "m");
    const a = addLesson(w, 1, 510, 600);
    const b = addLesson(w, 1, 600, 690);
    const c = addLesson(w, 1, 690, 780);
    pitch(w, a, own(addApproach(w, retry, "no_answer"), ME), "candidate");
    pitch(w, b, own(addApproach(w, awaiting, "approached"), ME), "candidate");
    pitch(w, c, own(addApproach(w, again, "declined"), ME), "candidate");
    const d = myDay(buildModel(w), 1, ME);
    const at = (id: number) => d.slots.find((s) => s.lessonId === id)!.step;
    expect(at(a.id)).toMatchObject({ kind: "speaker", group: "retry", to: `/speakers/${retry.id}#call` });
    expect(at(b.id)).toMatchObject({ kind: "speaker", group: "awaiting", to: `/speakers/${awaiting.id}#call` });
    expect(at(c.id)).toMatchObject({ kind: "speaker", group: "declined", to: `/speakers/${again.id}` });
  });

  it("a draft whose candidates are someone else's (a partner's included): theirs, to read", () => {
    const w = week();
    const l = addLesson(w, 1, 870, 960);
    pitch(w, l, own(addApproach(w, addSpeaker(w, "f"), "positive"), PARTNER), "candidate");
    pitch(w, l, own(addApproach(w, addSpeaker(w, "m"), "claimed"), OTHER), "candidate");
    pitch(w, l, own(addApproach(w, addSpeaker(w, "m"), "claimed"), PARTNER), "candidate");
    const card = myDay(buildModel(w), 1, ME).slots.find((s) => s.lessonId === l.id)!;
    expect(card.handlers).toEqual([PARTNER, OTHER]);
    expect(card.step).toEqual({ kind: "theirs", handlers: [PARTNER, OTHER], to: `/lesson/${l.id}` });
  });

  it("with candidates of mine and of others: my most advanced one leads the step", () => {
    const w = week();
    const l = addLesson(w, 1, 870, 960);
    const theirs = addSpeaker(w, "f");
    const mineLate = addSpeaker(w, "m");
    const mineAhead = addSpeaker(w, "f");
    pitch(w, l, own(addApproach(w, theirs, "positive"), OTHER), "candidate");
    pitch(w, l, own(addApproach(w, mineLate, "claimed"), ME), "candidate");
    pitch(w, l, own(addApproach(w, mineAhead, "approached"), ME), "candidate");
    const card = myDay(buildModel(w), 1, ME).slots.find((s) => s.lessonId === l.id)!;
    expect(card.candidates.map((c) => c.speakerId)).toEqual([theirs.id, mineAhead.id, mineLate.id]);
    expect(card.step).toMatchObject({ kind: "speaker", speakerId: mineAhead.id, group: "awaiting" });
  });

  it("a closed lesson of mine, or of my partner: the lesson page at its next step; all done: no step", () => {
    const w = week();
    const s1 = addSpeaker(w, "f");
    const s2 = addSpeaker(w, "m");
    const s3 = addSpeaker(w, "f");
    own(addApproach(w, s1, "positive"), ME);
    own(addApproach(w, s2, "positive"), PARTNER);
    own(addApproach(w, s3, "positive"), ME);
    const waiting = closeWith(w, addLesson(w, 1, 510, 600, { pay_amount: 100, approval: "pending" }), s1);
    const toSend = closeWith(w, addLesson(w, 1, 600, 690), s2);
    const done = closeWith(w, addLesson(w, 1, 690, 780, { confirm_sent_at: "2026-11-01T10:00:00Z", self_intro: true, sources_kind: "none" }), s3);
    const d = myDay(buildModel(w), 1, ME);
    const at = (id: number) => d.slots.find((s) => s.lessonId === id)!;
    expect(at(waiting.id)).toMatchObject({ state: "closed", leadId: s1.id, handlers: [ME], step: { kind: "lesson", lessonId: waiting.id, step: "pay", to: `/lesson/${waiting.id}?step=pay` } });
    expect(at(toSend.id).step).toEqual({ kind: "lesson", lessonId: toSend.id, step: "msg", to: `/lesson/${toSend.id}?step=msg` });
    expect(at(done.id).step).toEqual({ kind: "lesson", lessonId: done.id, step: null, to: `/lesson/${done.id}` });
  });

  it("a closed lesson's sources step reads its files (the reader's verdict)", () => {
    const w = week();
    const s = addSpeaker(w, "f");
    own(addApproach(w, s, "positive"), ME);
    const l = closeWith(w, addLesson(w, 1, 510, 600, { confirm_sent_at: "2026-11-01T10:00:00Z", self_intro: true, sources_kind: "sheet", in_reader: true }), s);
    expect(myDay(buildModel(w), 1, ME).slots[1].step).toMatchObject({ kind: "lesson", step: "sources" });
    w.sourceFiles.push({
      id: 1, lesson_id: l.id, cover: false, speaker_id: s.id, fallen_id: null, storage_path: "1/x/a.pdf", display_name: "a.pdf", mime: "application/pdf",
      size_bytes: 10, page_count: 2, uploaded_by: ME, uploaded_at: "2026-11-02T10:00:00Z",
    });
    expect(myDay(buildModel(w), 1, ME).slots[1].step).toMatchObject({ kind: "lesson", step: null });
  });

  it("a closed lesson someone else handles, or nobody: theirs", () => {
    const w = week();
    const s = addSpeaker(w, "m");
    own(addApproach(w, s, "positive"), OTHER);
    const l = closeWith(w, addLesson(w, 1, 510, 600), s);
    const nobody = closeWith(w, addLesson(w, 1, 600, 690), addSpeaker(w, "f"));
    const d = myDay(buildModel(w), 1, ME);
    expect(d.slots.find((x) => x.lessonId === l.id)!.step).toEqual({ kind: "theirs", handlers: [OTHER], to: `/lesson/${l.id}` });
    expect(d.slots.find((x) => x.lessonId === nobody.id)).toMatchObject({ handlers: [], step: { kind: "theirs", handlers: [] } });
  });

  it("memorial slots, cancelled lessons and other days are not the day's slots", () => {
    const w = week();
    addLesson(w, 1, 780, 795, { kind: "memorial" });
    addLesson(w, 1, 510, 600, { state: "cancelled" });
    closeWith(w, addLesson(w, 2, 510, 600), addSpeaker(w, "f"));
    const d = myDay(buildModel(w), 1, ME);
    expect(d.slots.every((s) => s.state === "free")).toBe(true);
    expect(d.slots.find((s) => s.start === 510)?.state).toBe("free");
  });
});

describe("myDay: the lessons others handle (the notification)", () => {
  it("lists my day's lessons handled outside its owners; «חדש» while I never looked", () => {
    const w = week();
    const theirs = addSpeaker(w, "m");
    own(addApproach(w, theirs, "positive"), OTHER);
    const closed = closeWith(w, addLesson(w, 1, 510, 600), theirs);
    const draft = addLesson(w, 1, 870, 960);
    pitch(w, draft, own(addApproach(w, addSpeaker(w, "f"), "claimed"), 1), "candidate");
    // my partner's and mine are not «others»
    const partners = addLesson(w, 1, 960, 1050);
    pitch(w, partners, own(addApproach(w, addSpeaker(w, "f"), "claimed"), PARTNER), "candidate");
    const d = myDay(buildModel(w), 1, ME);
    expect(d.others).toEqual([
      { lessonId: closed.id, start: 510, end: 600, handlers: [OTHER], fresh: true },
      { lessonId: draft.id, start: 870, end: 960, handlers: [1], fresh: true },
    ]);
    expect(hasFresh(d)).toBe(true);
  });

  it("once seen, «חדש» only where someone was proposed since", () => {
    const w = week();
    w.dayOwners[0].seen_at = "2026-11-05T12:00:00Z";
    const s = addSpeaker(w, "m");
    const a = own(addApproach(w, s, "positive"), OTHER);
    const closed = closeWith(w, addLesson(w, 1, 510, 600), s);
    w.pitches.push({ id: 9001, lesson_id: closed.id, approach_id: a.id, state: "accepted", proposed_by: OTHER, at: "2026-11-01T10:00:00Z" });
    const later = addLesson(w, 1, 870, 960);
    const p = pitch(w, later, own(addApproach(w, addSpeaker(w, "f"), "claimed"), OTHER), "candidate");
    p.at = "2026-11-06T09:00:00.000+00:00"; // the database's own spelling of a time
    const d = myDay(buildModel(w), 1, ME);
    expect(d.others.map((o) => [o.lessonId, o.fresh])).toEqual([
      [closed.id, false],
      [later.id, true],
    ]);
    // my partner never looked: everything is new to them
    expect(myDay(buildModel(w), 1, PARTNER).others.every((o) => o.fresh)).toBe(true);
    p.at = "2026-11-04T09:00:00Z";
    expect(hasFresh(myDay(buildModel(w), 1, ME))).toBe(false);
  });

  it("a draft with my candidate and someone else's is theirs too; only the outsiders are named", () => {
    const w = week();
    const l = addLesson(w, 1, 870, 960);
    pitch(w, l, own(addApproach(w, addSpeaker(w, "f"), "claimed"), ME), "candidate");
    pitch(w, l, own(addApproach(w, addSpeaker(w, "m"), "claimed"), OTHER), "candidate");
    expect(myDay(buildModel(w), 1, ME).others).toEqual([{ lessonId: l.id, start: 870, end: 960, handlers: [OTHER], fresh: true }]);
  });
});

describe("myDay: the speakers who can come", () => {
  it("those who said «יכול/ה» for a slot nobody is pitched in: mine first, then nobody's, by name", () => {
    const w = week();
    const mine = addSpeaker(w, "f", "ת מרצה");
    const free = addSpeaker(w, "m", "א מרצה");
    const free2 = addSpeaker(w, "f", "ב מרצה");
    const others = addSpeaker(w, "m", "ג מרצה");
    const retired = addSpeaker(w, "f", "ד מרצה");
    retired.retired = true;
    own(addApproach(w, mine, "claimed"), ME);
    own(addApproach(w, others, "claimed"), OTHER);
    for (const s of [mine, free, free2, others, retired]) can(w, s.id, 1, 4); // 08:30
    can(w, free.id, 1, 11); // 16:00 too
    const d = myDay(buildModel(w), 1, ME);
    expect(d.speakers).toEqual([
      { speakerId: mine.id, mine: true, fits: [{ day: 1, start: 510, end: 600 }] },
      { speakerId: free.id, mine: false, fits: [{ day: 1, start: 510, end: 600 }, { day: 1, start: 960, end: 1050 }] },
      { speakerId: free2.id, mine: false, fits: [{ day: 1, start: 510, end: 600 }] },
    ]);
  });

  it("not for a slot already in process, a «לא», another day, or a speaker closed already or who declined", () => {
    const w = week();
    const s = addSpeaker(w, "f");
    const closedSpeaker = addSpeaker(w, "m");
    const declined = addSpeaker(w, "f");
    own(addApproach(w, declined, "declined"), ME);
    can(w, declined.id, 1, 5);
    own(addApproach(w, closedSpeaker, "positive"), ME);
    closeWith(w, addLesson(w, 2, 510, 600), closedSpeaker);
    can(w, closedSpeaker.id, 1, 5);
    can(w, s.id, 1, 4); // 08:30 — pitched below
    can(w, s.id, 1, 6, "cannot"); // 11:30
    can(w, s.id, 2, 5); // Tuesday
    const busy = addLesson(w, 1, 510, 600);
    pitch(w, busy, own(addApproach(w, addSpeaker(w, "m"), "claimed"), PARTNER), "candidate");
    expect(myDay(buildModel(w), 1, ME).speakers).toEqual([]);
    // a bare draft (nobody pitched) is a slot to fill: it counts
    const s2 = addSpeaker(w, "m");
    addLesson(w, 1, 870, 960);
    can(w, s2.id, 1, 10);
    expect(myDay(buildModel(w), 1, ME).speakers).toEqual([{ speakerId: s2.id, mine: false, fits: [{ day: 1, start: 870, end: 960 }] }]);
  });

  it("a parallel pair of bare drafts is one slot to the speaker", () => {
    const w = week();
    addLesson(w, 1, 870, 960, { room_id: 1 });
    addLesson(w, 1, 870, 960, { room_id: 2 });
    const s = addSpeaker(w, "f");
    can(w, s.id, 1, 10);
    expect(myDay(buildModel(w), 1, ME).speakers[0].fits).toEqual([{ day: 1, start: 870, end: 960 }]);
  });
});

describe("myDay: a day with no owners", () => {
  it("has no «חריגים» — never every handled lesson", () => {
    const w = week();
    const s = addSpeaker(w, "m");
    own(addApproach(w, s, "positive"), OTHER);
    closeWith(w, addLesson(w, 2, 510, 600), s);
    const draft = addLesson(w, 2, 870, 960);
    pitch(w, draft, own(addApproach(w, addSpeaker(w, "f"), "claimed"), ME), "candidate");
    const d = myDay(buildModel(w), 2, 1, { staff: true });
    expect(d.owners).toEqual([]);
    expect(d.others).toEqual([]);
    expect(hasFresh(d)).toBe(false);
  });
});

describe("myDay: staff mode («ימים»)", () => {
  it("every closed lesson opens at its step, whoever handles it", () => {
    const w = week();
    const s = addSpeaker(w, "m");
    own(addApproach(w, s, "positive"), OTHER);
    const l = closeWith(w, addLesson(w, 1, 510, 600), s);
    const nobody = closeWith(w, addLesson(w, 1, 600, 690), addSpeaker(w, "f"));
    const d = myDay(buildModel(w), 1, 1, { staff: true });
    expect(d.slots.find((x) => x.lessonId === l.id)!.step).toEqual({ kind: "lesson", lessonId: l.id, step: "msg", to: `/lesson/${l.id}?step=msg` });
    expect(d.slots.find((x) => x.lessonId === nobody.id)!.step).toMatchObject({ kind: "lesson", lessonId: nobody.id });
    // the same lessons without staff mode are someone else's
    expect(myDay(buildModel(w), 1, 1).slots.find((x) => x.lessonId === l.id)!.step).toMatchObject({ kind: "theirs" });
    // and the exceptions are still named: the day's pair does not handle them
    expect(d.others.map((o) => o.lessonId)).toEqual([l.id]);
  });

  it("a draft follows my candidate, else its first live one", () => {
    const w = week();
    const l = addLesson(w, 1, 870, 960);
    const theirs = addSpeaker(w, "f");
    const later = addSpeaker(w, "m");
    pitch(w, l, own(addApproach(w, theirs, "approached"), PARTNER), "candidate");
    pitch(w, l, own(addApproach(w, later, "claimed"), OTHER), "candidate");
    const step = (viewer: number) => myDay(buildModel(w), 1, viewer, { staff: true }).slots.find((x) => x.lessonId === l.id)!.step;
    expect(step(1)).toEqual({ kind: "speaker", speakerId: theirs.id, group: "awaiting", to: `/speakers/${theirs.id}#call` });
    const mine = addSpeaker(w, "f");
    pitch(w, l, own(addApproach(w, mine, "positive"), 1), "candidate");
    expect(step(1)).toEqual({ kind: "lesson", lessonId: l.id, step: "close", to: `/lesson/${l.id}?step=close` });
    // a draft nobody is pitched in: choose a speaker, as everywhere
    const bare = addLesson(w, 1, 960, 1050);
    expect(myDay(buildModel(w), 1, 1, { staff: true }).slots.find((x) => x.lessonId === bare.id)!.step).toMatchObject({ kind: "choose" });
  });

  it("I am not an owner: no «seen», the owners are all partners", () => {
    const d = myDay(buildModel(week()), 1, 1, { staff: true });
    expect(d).toMatchObject({ owners: [2, 3], partners: [2, 3], seenAt: null });
  });
});

describe("offeredTo", () => {
  it("the hand-overs offered to me, by the speaker's name; a speaker not in the week is left out", () => {
    const w = week();
    const b = addSpeaker(w, "f", "ב מרצה");
    const a = addSpeaker(w, "m", "א מרצה");
    const toB = addApproach(w, b, "claimed");
    const toA = addApproach(w, a, "approached");
    toB.offered_to = ME;
    toA.offered_to = ME;
    addApproach(w, addSpeaker(w, "f"), "claimed").offered_to = OTHER;
    w.approaches.push({ id: 1, speaker_id: 424242, owner_member_id: 1, status: "claimed", avail_note: null, offered_to: ME, version: 1 });
    expect(offeredTo(w, ME).map((x) => x.id)).toEqual([toA.id, toB.id]);
    expect(offeredTo(w, OTHER)).toHaveLength(1);
    expect(offeredTo(w, PARTNER)).toEqual([]);
  });
});

describe("staffDay", () => {
  it("today's column during the week, else my first day, else Sunday", () => {
    const w = week(); // the week starts on 2027-02-14
    expect(staffDay(w, ME, "2027-02-16T10:00:00Z")).toBe(2);
    // 05:00 in Israel is still the night of the day before
    expect(staffDay(w, ME, "2027-02-16T03:00:00Z")).toBe(1);
    expect(staffDay(w, ME, "2026-11-19T10:00:00Z")).toBe(1);
    expect(staffDay(w, OTHER, "2026-11-19T10:00:00Z")).toBe(0);
    expect(staffDay(w, 1, "2026-11-19T10:00:00Z")).toBe(0);
    w.edition.start_date = null;
    expect(staffDay(w, PARTNER, "2027-02-16T10:00:00Z")).toBe(1);
  });
});
