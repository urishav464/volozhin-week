// The transport board's lane model (the reset, phase 3): which lessons get a lane, the outbound leg (a bar, clamped at
// 06:30; a marker when the pickup is unknown; the time typed over a stale pickup_min), the return marker of a round trip
// at the teaching's end with no length,
// the three states, the staff shifts of the day (a member, a typed name, a cohort's staff; leads), and a day with nothing.
import { describe, expect, it } from "vitest";
import type { LessonTransport } from "../../data/commands";
import type { RotaCohort, RotaStaffShift } from "../../data/rota";
import type { Day } from "../../domain/time";
import { type Approach, LESSON_STAGE_DEFAULTS, type Lesson, type LessonSpeaker, type Speaker, type Week } from "../../domain/types";
import {
  AXIS, AXIS_TICKS, axisPercent, boardCounts, boardDayParam, boardPickupMin, defaultBoardDay, driveCohorts, driverPatch, lanesPerDay, onBoard, outboundOf, pickupText, teachEndOf,
  transportLanes,
} from "./lanes";

const speaker = (id: number, title: string | null = null): Speaker => ({
  id, title, name: `מרצה לדוגמה ${id}`, disambiguator: null, gender: null, affiliation: null, bio_short: null, topics: [], contact_pref: null,
  vetted: "approved", vetted_by: 1, vetted_note: null, retired: false, name_key: `מרצה לדוגמה ${id}`, version: 1,
});

const lesson = (id: number, extra: Partial<Lesson> = {}): Lesson => ({
  id, kind: "lesson", state: "closed", day: 0, start_min: 510, end_min: 600, room_id: 1, title: `שיעור לדוגמה ${id}`, category_id: null, audience: null,
  teach_min: null, parallel_reason: null, ...LESSON_STAGE_DEFAULTS, transport: "one_way", approval: "approved", version: 1, updated_by: null, ...extra,
});

const transport = (lesson_id: number, extra: Partial<LessonTransport> = {}): LessonTransport => ({
  lesson_id, pickup_address: "כתובת לדוגמה", pickup_time: null, driver_name: null, driver_phone: null, arranged: false, approval: "approved", pickup_min: null, ...extra,
});

const shift = (id: number, day: Day, start: number, end: number, extra: Partial<RotaStaffShift> = {}): RotaStaffShift => ({
  id, edition_id: 1, day, start_min: start, end_min: end, member_id: null, name: null, cohort_id: null, kind: "shift", note: null, ...extra,
});

type BoardWeek = Pick<Week, "lessons" | "lessonSpeakers" | "speakers" | "approaches" | "team" | "edition">;

function weekOf(lessons: Lesson[], links: [number, number, number | null][] = []): BoardWeek {
  // links: [lesson, lead speaker, its approach's owner]
  const lessonSpeakers: LessonSpeaker[] = links.map(([lesson_id, speaker_id]) => ({ lesson_id, speaker_id, role: "lead" }));
  const approaches: Approach[] = links.map(([, speaker_id, owner], i) => ({ id: i + 1, speaker_id, owner_member_id: owner, status: "positive", avail_note: null, offered_to: null, version: 1 }));
  return {
    lessons,
    lessonSpeakers,
    approaches,
    speakers: links.map(([, s]) => speaker(s, s === 1 ? "ד״ר" : null)),
    team: [
      { id: 1, display_name: "מדריך/ה לדוגמה", gender: null, role: "admin" },
      { id: 2, display_name: "חניך/ה לדוגמה", gender: null, role: "content" },
      { id: 5, display_name: "לוגיסטיקה לדוגמה", gender: null, role: "logistics" },
    ],
    edition: { id: 1, label: "לדוגמה", kind: "real", start_date: null, first_day_from: 510, last_day_until: 1140, status: "planning", settings: {} },
  };
}

describe("which lessons get a lane", () => {
  it("closed lessons that asked for a transport and wait for the decision or were approved — by start, then id, of that day only", () => {
    const w = weekOf([
      lesson(1, { start_min: 870, end_min: 960 }),
      lesson(2, { start_min: 510, approval: "pending" }),
      lesson(3, { start_min: 510 }),
      lesson(4, { state: "draft" }),
      lesson(5, { kind: "memorial", start_min: 780, end_min: 795 }),
      lesson(6, { transport: "none", approval: "approved" }),
      lesson(7, { approval: "rejected" }),
      lesson(8, { approval: "none", transport: "none" }),
      lesson(9, { day: 1 }),
    ]);
    expect(transportLanes(w, null, null, 0).transports.map((t) => t.lesson.id)).toEqual([2, 3, 1]);
    expect(transportLanes(w, null, null, 1).transports.map((t) => t.lesson.id)).toEqual([9]);
    expect(w.lessons.filter(onBoard).map((l) => l.id)).toEqual([1, 2, 3, 9]);
    expect(lanesPerDay(w)).toEqual({ 0: 3, 1: 1, 2: 0, 3: 0, 4: 0 });
  });

  it("a day with nothing: no lanes, no shifts — with or without a read and a rota", () => {
    const w = weekOf([lesson(1)]);
    expect(transportLanes(w, null, null, 4)).toEqual({ day: 4, transports: [], shifts: [], drivers: [] });
    expect(transportLanes(w, [transport(1)], { staff: [shift(1, 0, 510, 870)], cohorts: [], presence: [] }, 4)).toEqual({ day: 4, transports: [], shifts: [], drivers: [] });
    expect(transportLanes(weekOf([]), [], { staff: [], cohorts: [], presence: [] }, 0)).toEqual({ day: 0, transports: [], shifts: [], drivers: [] });
  });

  it("names the speakers (lead first), the title (TBD when none) and the handler — the lead speaker's approach's owner", () => {
    const w = weekOf([lesson(1), lesson(2, { start_min: 600, end_min: 690, title: null })], [
      [1, 1, 2],
      [2, 3, null],
    ]);
    const [a, b] = transportLanes(w, null, null, 0).transports;
    expect(a).toMatchObject({ speaker: "ד״ר מרצה לדוגמה 1", title: "שיעור לדוגמה 1", handler: 2 });
    expect(b).toMatchObject({ speaker: "מרצה לדוגמה 3", title: "TBD", handler: null });
    // a lesson whose speaker is not in the Week: no name, no handler
    expect(transportLanes(weekOf([lesson(3)]), null, null, 0).transports[0]).toMatchObject({ speaker: "", handler: null });
  });
});

describe("the outbound leg", () => {
  it("no pickup_min (or no read at all): a bar-less marker at the lesson's start, «שעת איסוף לא ידועה»", () => {
    const w = weekOf([lesson(1, { start_min: 600, end_min: 690 })]);
    expect(transportLanes(w, null, null, 0).transports[0]).toMatchObject({ details: null, outbound: { kind: "marker", at: 600, known: false } });
    const [t] = transportLanes(w, [transport(1, { pickup_time: "אחרי השיעור" })], null, 0).transports;
    expect(t.outbound).toEqual({ kind: "marker", at: 600, known: false });
    expect(t.details).toMatchObject({ lesson_id: 1, pickup_time: "אחרי השיעור" });
  });

  it("a pickup before the start: a bar from it to the start; before 06:30, from the axis' edge and `clamped`", () => {
    expect(outboundOf(510, 435)).toEqual({ kind: "bar", from: 435, to: 510, clamped: false });
    expect(outboundOf(510, 390)).toEqual({ kind: "bar", from: 390, to: 510, clamped: false }); // exactly 06:30: on the axis
    expect(outboundOf(510, 370)).toEqual({ kind: "bar", from: 390, to: 510, clamped: true }); // 06:10
    expect(outboundOf(510, 0)).toEqual({ kind: "bar", from: AXIS.start, to: 510, clamped: true }); // midnight before the day
    expect(outboundOf(1470, 1420)).toEqual({ kind: "bar", from: 1420, to: 1470, clamped: false }); // 23:40 before a 00:30 lesson
    const w = weekOf([lesson(1, { approval: "pending", transport: "round_trip" })]);
    expect(transportLanes(w, [transport(1, { approval: "pending", pickup_time: "06:10", pickup_min: 370 })], null, 0).transports[0].outbound).toEqual({ kind: "bar", from: 390, to: 510, clamped: true });
  });

  it("a pickup at or after the start (typed so): a marker at the pickup, never a bar backwards", () => {
    expect(outboundOf(510, 510)).toEqual({ kind: "marker", at: 510, known: true });
    expect(outboundOf(510, 540)).toEqual({ kind: "marker", at: 540, known: true });
    expect(outboundOf(510, undefined)).toEqual({ kind: "marker", at: 510, known: false });
  });

  it("what the list says of it: the minute (and «before 06:30»), the words typed, or nothing known", () => {
    const at510 = lesson(1);
    const night = lesson(1, { start_min: 1470, end_min: 1560 });
    expect(pickupText({ lesson: at510, details: transport(1, { pickup_min: 435, pickup_time: "07:15" }) })).toEqual({ time: "07:15", early: false, words: null });
    expect(pickupText({ lesson: at510, details: transport(1, { pickup_min: 370, pickup_time: "06:10" }) })).toEqual({ time: "06:10", early: true, words: null });
    expect(pickupText({ lesson: night, details: transport(1, { pickup_min: 1450, pickup_time: "00:10" }) })).toEqual({ time: "00:10", early: false, words: null });
    expect(pickupText({ lesson: at510, details: transport(1, { pickup_time: " אחרי השיעור " }) })).toEqual({ time: null, early: false, words: "אחרי השיעור" });
    expect(pickupText({ lesson: at510, details: transport(1, { pickup_time: "  " }) })).toEqual({ time: null, early: false, words: null });
    expect(pickupText({ lesson: at510, details: null })).toEqual({ time: null, early: false, words: null });
  });

  // the old screens' «עריכת פרטי ההסעה» (set_transport_details: the grid's panel) rewrites pickup_time and never
  // pickup_min — the board says and draws what every other reader shows, never the minute left behind
  it("a pickup_min that is not the time typed (changed since by the old form) gives way to the time; words or a cleared time leave nothing", () => {
    const wed = lesson(1, { start_min: 600, end_min: 690 });
    // (a) approved, «08:45» / 525, then 07:30 typed in the old form: 07:30 in the list and the bar from it
    const moved = transport(1, { pickup_time: "07:30", pickup_min: 525 });
    expect(boardPickupMin(600, moved)).toBe(450);
    expect(pickupText({ lesson: wed, details: moved })).toEqual({ time: "07:30", early: false, words: null });
    expect(transportLanes(weekOf([wed]), [moved], null, 0).transports[0].outbound).toEqual({ kind: "bar", from: 450, to: 600, clamped: false });
    // words typed there: said as typed, no bar; a cleared time: nothing known
    const words = transport(1, { pickup_time: "אחרי השיעור", pickup_min: 525 });
    expect(pickupText({ lesson: wed, details: words })).toEqual({ time: null, early: false, words: "אחרי השיעור" });
    expect(transportLanes(weekOf([wed]), [words], null, 0).transports[0].outbound).toEqual({ kind: "marker", at: 600, known: false });
    const cleared = transport(1, { pickup_time: null, pickup_min: 525 });
    expect(pickupText({ lesson: wed, details: cleared })).toEqual({ time: null, early: false, words: null });
    expect(transportLanes(weekOf([wed]), [cleared], null, 0).transports[0].outbound).toEqual({ kind: "marker", at: 600, known: false });
    // (b) pending, «06:10» / 370 (clamped), then 07:00: no longer early, no longer clamped
    const mon = lesson(1, { approval: "pending", transport: "round_trip" });
    const later = transport(1, { approval: "pending", pickup_time: "07:00", pickup_min: 370 });
    expect(pickupText({ lesson: mon, details: later })).toEqual({ time: "07:00", early: false, words: null });
    expect(transportLanes(weekOf([mon]), [later], null, 0).transports[0].outbound).toEqual({ kind: "bar", from: 420, to: 510, clamped: false });
    // the same minute of the clock: pickup_min kept — it holds the request's choice of the night after the day
    expect(boardPickupMin(510, transport(1, { pickup_time: "00:10", pickup_min: 1450 }))).toBe(1450);
    expect(boardPickupMin(1470, transport(1, { pickup_time: "23:40", pickup_min: 1420 }))).toBe(1420);
    // a time typed by the old form on a row that never had a minute: its own minute on the lesson's day
    expect(boardPickupMin(510, transport(1, { pickup_time: "7:05" }))).toBe(425);
    expect(boardPickupMin(510, null)).toBeNull();
  });
});

describe("the return of a round trip", () => {
  it("a marker at the END OF THE TEACHING with no length (the data has no return time); a one-way transport has none", () => {
    const w = weekOf([lesson(1, { transport: "round_trip", start_min: 870, end_min: 960 }), lesson(2, { transport: "one_way", start_min: 1200, end_min: 1290 })]);
    const [round, one] = transportLanes(w, null, null, 0).transports;
    // a 90-minute row teaches 75 (the default): back from 15:45, as the card's «14:30–15:45» says — not the row's 16:00
    expect(round).toMatchObject({ roundTrip: true, teachEnd: 945, returnAt: 945 });
    expect(one).toMatchObject({ roundTrip: false, teachEnd: 1275, returnAt: null });
    // the lane carries a minute, never a span: nothing says when the return ends
    expect(Object.keys(round)).not.toContain("returnEnd");
  });

  it("the teaching's end is app.teach_end — what the speaker's message and the escort's page say: the lesson's own time, else the edition's, within the row", () => {
    const round = (extra: Partial<Lesson>) => lesson(1, { transport: "round_trip", start_min: 510, end_min: 600, ...extra });
    const at = (l: Lesson, lesson_minutes?: number) => {
      const w = weekOf([l]);
      if (lesson_minutes != null) w.edition = { ...w.edition, settings: { lesson_minutes } };
      return transportLanes(w, null, null, 0).transports[0];
    };
    expect(at(round({}))).toMatchObject({ teachEnd: 585, returnAt: 585 }); // 08:30 + 75 = 09:45
    expect(at(round({}), 60)).toMatchObject({ teachEnd: 570, returnAt: 570 }); // the edition teaches 60
    expect(at(round({}), 120)).toMatchObject({ teachEnd: 600, returnAt: 600 }); // never past the row
    expect(at(round({ teach_min: 45 }), 60)).toMatchObject({ teachEnd: 555, returnAt: 555 }); // the lesson's own
    expect(teachEndOf({ start_min: 1470, end_min: 1560, teach_min: null })).toBe(1545); // a night lesson: 00:30 → 01:45
  });
});

describe("the states", () => {
  it("pending (whatever an old row says), approved, arranged (approved and «סודר»)", () => {
    const w = weekOf([
      lesson(1, { approval: "pending" }),
      lesson(2, { start_min: 600, end_min: 690 }),
      lesson(3, { start_min: 690, end_min: 780 }),
      lesson(4, { start_min: 870, end_min: 960 }),
    ]);
    const read = [transport(1, { approval: "pending", arranged: true }), transport(2, { arranged: true, driver_name: "נהג/ת לדוגמה" }), transport(3)];
    expect(transportLanes(w, read, null, 0).transports.map((t) => [t.lesson.id, t.state])).toEqual([
      [1, "pending"],
      [2, "arranged"],
      [3, "approved"],
      [4, "approved"], // not in the read (not the viewer's to see): approved, no details
    ]);
    expect(transportLanes(w, null, null, 0).transports.map((t) => t.state)).toEqual(["pending", "approved", "approved", "approved"]);
  });

  it("the counts, the whole week: pending · approved (arranged among them) · arranged", () => {
    const w = weekOf([
      lesson(1, { approval: "pending" }),
      lesson(2, { day: 1 }),
      lesson(3, { day: 2 }),
      lesson(4, { day: 3, approval: "pending" }),
      lesson(5, { approval: "rejected" }),
      lesson(6, { transport: "none" }),
    ]);
    const read = [transport(1, { approval: "pending", arranged: true }), transport(2, { arranged: true }), transport(3), transport(4, { approval: "pending" })];
    expect(boardCounts(w, read)).toEqual({ pending: 2, approved: 2, arranged: 1 });
    expect(boardCounts(w, null)).toEqual({ pending: 2, approved: 2, arranged: 0 });
    expect(boardCounts(weekOf([]), [])).toEqual({ pending: 0, approved: 0, arranged: 0 });
  });
});

describe("the staff shifts of the day", () => {
  const cohorts: RotaCohort[] = [{ id: 7, edition_id: 1, letter: "נ", name: "מכינה לדוגמה נ", diets: [], sort: 1 }];
  const staff = [
    shift(1, 0, 870, 1350, { name: "איש/אשת צוות לדוגמה", note: "הקפצת מרצה (לדוגמה)" }),
    shift(2, 0, 510, 870, { member_id: 5, name: "שם שנשמר לדוגמה", kind: "lead" }),
    shift(3, 0, 510, 600, { cohort_id: 7 }),
    shift(4, 0, 1350, 1830, { cohort_id: 99 }),
    shift(5, 1, 390, 720, { name: "איש/אשת צוות לדוגמה ב׳" }),
    shift(6, 0, 600, 700, { member_id: 42, name: "חבר/ת צוות שעזב/ה" }),
  ];

  it("by start then id; a team member by the team's name, a typed name as typed, a cohort's whole staff; leads marked", () => {
    const shifts = transportLanes(weekOf([]), null, { staff, cohorts, presence: [] }, 0).shifts;
    expect(shifts.map((s) => [s.shift.id, s.who, s.lead])).toEqual([
      [2, "לוגיסטיקה לדוגמה", true],
      [3, "צוות מכינה לדוגמה נ", false],
      [6, "חבר/ת צוות שעזב/ה", false], // not in the team any more: the name it was saved with
      [1, "איש/אשת צוות לדוגמה", false],
      [4, "TBD", false], // a cohort that is gone
    ]);
    expect(shifts.find((s) => s.shift.id === 1)!.shift.note).toBe("הקפצת מרצה (לדוגמה)");
    expect(transportLanes(weekOf([]), null, { staff, cohorts, presence: [] }, 1).shifts.map((s) => s.who)).toEqual(["איש/אשת צוות לדוגמה ב׳"]);
  });

  it("no rota yet (loading, or the read failed): no shift lanes, no cohorts that drive, the transports still drawn", () => {
    const d = transportLanes(weekOf([lesson(1)]), null, null, 0);
    expect(d.shifts).toEqual([]);
    expect(d.drivers).toEqual([]);
    expect(d.transports).toHaveLength(1);
  });
});

describe("the cohorts whose staff can drive (v19), beside the shifts", () => {
  const cohort = (id: number, letter: string, sort: number, extra: Partial<RotaCohort> = {}): RotaCohort => ({
    id, edition_id: 1, letter, name: `מכינה לדוגמה ${letter}`, diets: [], sort, ...extra,
  });
  const cohorts = [
    cohort(1, "א", 1, { can_drive: true }),
    cohort(2, "ב", 2, { can_drive: true, helps_rota: false }), // not helping the rota: still drives
    cohort(3, "ג", 3), // can_drive absent = no
    cohort(4, "ד", 2, { can_drive: true }),
    cohort(5, "ה", 5, { can_drive: false }),
  ];
  const presence = [
    { cohort_id: 4, day: 0 as Day, shift: 2 as const },
    { cohort_id: 2, day: 0 as Day, shift: 0 as const },
    { cohort_id: 2, day: 0 as Day, shift: 1 as const },
    { cohort_id: 3, day: 0 as Day, shift: 0 as const },
    { cohort_id: 1, day: 1 as Day, shift: 0 as const },
  ];

  it("only those marked «הצוות שלה יכול להסיע»; on campus that day (any shift) first, then by sort, letter and id", () => {
    const d = transportLanes(weekOf([]), null, { staff: [], cohorts, presence }, 0).drivers;
    expect(d.map((x) => [x.cohort.letter, x.present])).toEqual([
      ["ב", true],
      ["ד", true],
      ["א", false],
    ]);
    expect(driveCohorts({ cohorts, presence }, 1).map((x) => [x.cohort.letter, x.present])).toEqual([
      ["א", true],
      ["ב", false],
      ["ד", false],
    ]);
    // no presence marked anywhere: none is on campus, never assumed
    expect(driveCohorts({ cohorts, presence: [] }, 0).map((x) => [x.cohort.id, x.present])).toEqual([
      [1, false],
      [2, false],
      [4, false],
    ]);
  });

  it("names only: the cohort as loaded (load_rota has no phone), nothing when none can drive", () => {
    const [first] = driveCohorts({ cohorts, presence }, 0);
    expect(Object.keys(first).sort()).toEqual(["cohort", "present"]);
    expect(first.cohort.name).toBe("מכינה לדוגמה ב");
    expect(driveCohorts({ cohorts: [cohort(9, "ט", 1)], presence: [] }, 0)).toEqual([]);
    expect(driveCohorts(null, 0)).toEqual([]);
  });
});

describe("the axis", () => {
  it("06:30 → 06:30 the next morning, a minute's place 0–100, clamped to its edges", () => {
    expect(AXIS).toEqual({ start: 390, end: 1830 });
    expect(axisPercent(390)).toBe(0);
    expect(axisPercent(1830)).toBe(100);
    expect(axisPercent(1110)).toBe(50);
    expect(axisPercent(370)).toBe(0);
    expect(axisPercent(2000)).toBe(100);
  });

  it("ticks every two hours on the hour, inside the axis", () => {
    expect(AXIS_TICKS[0]).toBe(480);
    expect(AXIS_TICKS.at(-1)).toBe(1800);
    expect(AXIS_TICKS.every((m, i) => i === 0 || m - AXIS_TICKS[i - 1] === 120)).toBe(true);
    expect(AXIS_TICKS.every((m) => m > AXIS.start && m < AXIS.end)).toBe(true);
  });
});

describe("the day the board opens on", () => {
  it("`?day=` 0–4, else nothing", () => {
    expect(["0", "4", "2"].map(boardDayParam)).toEqual([0, 4, 2]);
    expect(["5", "-1", "1.5", "", "x", null, undefined, " 1"].map(boardDayParam)).toEqual([null, null, null, null, null, null, null, null]);
  });

  it("today's column while the week is on; else the first day with a transport; else Sunday", () => {
    const w = weekOf([lesson(1, { day: 2 }), lesson(2, { day: 3, approval: "pending" })]);
    expect(defaultBoardDay(w, "2027-02-14T08:00:00Z")).toBe(2); // no date: the first day with a lane
    expect(defaultBoardDay(weekOf([]), "2027-02-14T08:00:00Z")).toBe(0);
    const dated = { ...w, edition: { ...w.edition, start_date: "2027-02-14" } };
    expect(defaultBoardDay(dated, "2027-02-15T09:00:00Z")).toBe(1); // Monday, Israel time
    expect(defaultBoardDay(dated, "2027-02-16T02:00:00Z")).toBe(1); // 04:00 Tuesday in Israel: still Monday's night
    expect(defaultBoardDay(dated, "2027-03-01T09:00:00Z")).toBe(2); // after the week
  });
});

describe("the driver form's patch", () => {
  const loaded = { driver_name: "נהג/ת לדוגמה", driver_phone: null, arranged: false };

  it("only the keys that changed; a text trimmed, empty → null", () => {
    expect(driverPatch(loaded, { name: "נהג/ת לדוגמה", phone: "", arranged: false })).toEqual({});
    expect(driverPatch(loaded, { name: " נהג/ת לדוגמה ", phone: "  ", arranged: true })).toEqual({ arranged: true });
    expect(driverPatch(loaded, { name: "", phone: "0000000001", arranged: false })).toEqual({ driver_name: null, driver_phone: "0000000001" });
    expect(driverPatch({ driver_name: null, driver_phone: "0000000001", arranged: true }, { name: "נהג/ת ב׳ לדוגמה", phone: "0000000001", arranged: false })).toEqual({
      driver_name: "נהג/ת ב׳ לדוגמה",
      arranged: false,
    });
  });
});
