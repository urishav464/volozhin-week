// The logistics home's tasks (the reset, phase 4): every task in each of its states — done, open, empty, unknown (or the
// states it has), the words exact; a read that failed turns only its own tasks «לא נטען»; the transports while the viewer
// may not decide here «לא זמין במחזור הזה»; the three groups always there, in order; «קרוב לשבוע»'s line.
import { describe, expect, it } from "vitest";
import type { LessonTransport } from "../../data/commands";
import type { KkData, KkGroup } from "../../data/kk";
import {
  EMPTY_ROTA, type RotaAssignment, type RotaCohort, type RotaData, type RotaDuty, type RotaGroup, type RotaPrepTask, type RotaPresence, type RotaStaffShift, type ShiftIndex,
} from "../../data/rota";
import type { Day } from "../../domain/time";
import type { SourceFile, Week } from "../../domain/types";
import { addLesson, addSpeaker, closeWith, emptyWeek } from "../../testing/week";
import { logisticsTasks, NOT_HERE, NOT_LOADED, type Task, type TaskKey, TASK_STATE_LABEL, type TasksInput, weekLine } from "./tasks";

const NOW = "2027-01-24T10:00:00Z"; // three weeks before the week (Sunday 14.2.2027)

const cohort = (id: number, letter: string, extra: Partial<RotaCohort> = {}): RotaCohort => ({ id, edition_id: 1, letter, name: `מכינה לדוגמה ${letter}`, trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: id, ...extra });
const group = (id: number, cohort_id: number, extra: Partial<RotaGroup> = {}): RotaGroup => ({ id, edition_id: 1, cohort_id, number: id, size: 10, head_name: "ראש/ת קבוצה לדוגמה", ...extra });
const duty = (id: number, extra: Partial<RotaDuty> = {}): RotaDuty => ({
  id, edition_id: 1, name: `תורנות לדוגמה ${id}`, description: null, need_morning: 0, need_afternoon: 0, need_night: 0, min_people: null, sort: id, ...extra,
});
const at = (cohort_id: number, day: number, shift: number): RotaPresence => ({ cohort_id, day: day as Day, shift: shift as ShiftIndex });
const assign = (id: number, day: number, shift: number, duty_id: number, group_id: number): RotaAssignment => ({ id, edition_id: 1, day: day as Day, shift: shift as ShiftIndex, duty_id, group_id, source: "hand" });
/** Someone of the staff on duty the whole of every day (v20: no «אחראי/ת משמרת» — nothing on the home asks for one). */
const leads = (): RotaStaffShift[] =>
  [0, 1, 2, 3, 4].map((day, i) => ({ id: 100 + i, edition_id: 1, day: day as Day, start_min: 390, end_min: 1830, member_id: null, name: "איש/אשת צוות לדוגמה", cohort_id: null, note: null }));
/** v20: every cohort given helps in every duty given (the duties a cohort helps in). */
const helping = (cohorts: number[], duties: number[]): RotaData["cohortDuties"] => cohorts.flatMap((cohort_id) => duties.map((duty_id) => ({ cohort_id, duty_id })));
const prep = (id: number, done: boolean, extra: Partial<RotaPrepTask> = {}): RotaPrepTask => ({ id, edition_id: 1, text: `משימה לדוגמה ${id}`, group_id: null, done, sort: id, ...extra });

/** v20: the three diet numbers typed (0 is a number, not TBD). */
const DIETS = { diet_veg: 0, diet_gf: 0, diet_both: 0 } as const;

/** A rota where nothing is left: one cohort on campus (its trainees typed) helping in its duty, one group with a size and a head, a duty that needs nobody, staff all week. */
function readyRota(): RotaData {
  return { ...EMPTY_ROTA, cohorts: [cohort(1, "א", { trainees: 10, ...DIETS })], cohortDuties: helping([1], [1]), presence: [at(1, 0, 1)], groups: [group(11, 1)], duties: [duty(1)], staff: leads() };
}

const kkGroup = (id: number, title: string | null): KkGroup => ({ id, title, author: null, place: null, capacity: null, open: false });
const kkOf = (groups: KkGroup[], orders: KkData["orders"] = []): KkData => ({ groups, leaders: [], signups: [], orders });

const transport = (lesson_id: number, arranged: boolean): LessonTransport => ({
  lesson_id, pickup_address: null, pickup_time: null, driver_name: null, driver_phone: null, arranged, approval: "approved", pickup_min: null,
});

let fileSeq = 1;
function addFile(w: Week, lessonId: number, speakerId: number, extra: Partial<SourceFile> = {}): SourceFile {
  const f: SourceFile = {
    id: fileSeq++, lesson_id: lessonId, cover: false, kind: "source", speaker_id: speakerId, fallen_id: null, storage_path: `1/${lessonId}/x-${fileSeq}.pdf`,
    display_name: "קובץ לדוגמה.pdf", mime: "application/pdf", size_bytes: 1000, page_count: 2, uploaded_by: null, uploaded_at: "2027-01-10T10:00:00.000Z", ...extra,
  };
  w.sourceFiles!.push(f);
  return f;
}

function input(patch: Partial<TasksInput> = {}): TasksInput {
  return { week: emptyWeek(), rota: EMPTY_ROTA, kk: kkOf([]), transports: [], mayDecide: true, ...patch };
}

function tasksOf(i: TasksInput, now = NOW): Map<TaskKey, Task> {
  return new Map(logisticsTasks(i, now).groups.flatMap((g) => g.tasks.map((t) => [t.key, t] as const)));
}
const one = (key: TaskKey, i: TasksInput, now = NOW) => tasksOf(i, now).get(key)!;
const stateLine = (t: Task) => [t.state, t.line];

describe("the three groups", () => {
  it("always all three, in order, each with its tasks, titles and pages — whatever was read", () => {
    for (const i of [input(), input({ rota: null, kk: null, transports: null }), input({ mayDecide: false, transports: null })]) {
      const { groups } = logisticsTasks(i, NOW);
      expect(groups.map((g) => [g.key, g.title])).toEqual([
        ["start", "בהתחלה"],
        ["content", "כשהתוכן מוכן"],
        ["near", "קרוב לשבוע"],
      ]);
      expect(groups.map((g) => g.tasks.map((t) => [t.key, t.title, t.to]))).toEqual([
        [
          ["presence", "נוכחות המכינות", "/logistics/rota/setup"],
          ["assign", "שיבוץ התורנויות", "/logistics/rota"],
        ],
        [
          ["requests", "בקשות שממתינות", "/approvals"],
          ["books", "ספרים", "/logistics/books"],
          ["prints", "הדפסות", "/logistics/prints"],
        ],
        [
          ["drivers", "נהגים", "/logistics/transports"],
          ["payments", "תשלומים", "/logistics/payments"],
          ["reader", "המקראה לדפוס", "/reader"],
          ["prep", "מוצ״ש", "/logistics/rota/prep"],
        ],
      ]);
      // only «קרוב לשבוע» has a line
      expect(groups.map((g) => g.line !== undefined)).toEqual([false, false, true]);
    }
  });

  it("an edition with nothing yet: every task «empty» but the transports' (none approved) — never a false «done»", () => {
    const states = [...tasksOf(input()).values()].map((t) => [t.key, t.state]);
    expect(states).toEqual([
      ["presence", "empty"],
      ["assign", "empty"],
      ["requests", "empty"],
      ["books", "empty"],
      ["prints", "empty"],
      ["drivers", "empty"],
      ["payments", "empty"],
      ["reader", "empty"],
      ["prep", "empty"],
    ]);
  });

  it("the chips' words", () => {
    expect(TASK_STATE_LABEL).toEqual({ done: "הושלם", open: "לטיפול", empty: "עוד לא התחיל", unknown: "לא ידוע" });
  });
});

describe("«קרוב לשבוע»'s line (daysToWeek, Israel's calendar days)", () => {
  it("in words", () => {
    expect([null, -3, -1, 0, 1, 2, 3, 21].map(weekLine)).toEqual([
      "תאריך השבוע עוד לא נקבע",
      "השבוע כבר התחיל",
      "השבוע כבר התחיל",
      "היום",
      "מחר",
      "בעוד יומיים",
      "בעוד 3 ימים",
      "בעוד 21 ימים",
    ]);
  });

  it("from the edition's start date and now, in Israel: TBD, weeks ahead, the evening before, the day, after", () => {
    const line = (start: string | null, now: string) => {
      const w = emptyWeek();
      w.edition.start_date = start;
      return logisticsTasks(input({ week: w }), now).groups[2].line;
    };
    expect(line(null, NOW)).toBe("תאריך השבוע עוד לא נקבע");
    expect(line("2027-02-14", NOW)).toBe("בעוד 21 ימים");
    expect(line("2027-02-14", "2027-02-12T21:59:00Z")).toBe("בעוד יומיים"); // Friday 23:59 in Israel
    expect(line("2027-02-14", "2027-02-12T22:00:00Z")).toBe("מחר"); // Saturday 00:00 in Israel
    expect(line("2027-02-14", "2027-02-13T22:30:00Z")).toBe("היום");
    expect(line("2027-02-14", "2027-02-16T08:00:00Z")).toBe("השבוע כבר התחיל");
  });
});

describe("a read that failed (null) turns only its own tasks «לא נטען»", () => {
  it("the rota: «נוכחות המכינות», «שיבוץ התורנויות» and «מוצ״ש» — nothing else", () => {
    const t = tasksOf(input({ rota: null }));
    for (const k of ["presence", "assign", "prep"] as const) expect(stateLine(t.get(k)!)).toEqual(["unknown", NOT_LOADED]);
    expect([...t.values()].filter((x) => x.state === "unknown").map((x) => x.key)).toEqual(["presence", "assign", "prep"]);
    expect(NOT_LOADED).toBe("לא נטען");
  });

  it("מכריכה לכריכה: «ספרים» alone", () => {
    const t = tasksOf(input({ kk: null }));
    expect(stateLine(t.get("books")!)).toEqual(["unknown", "לא נטען"]);
    expect([...t.values()].filter((x) => x.state === "unknown").map((x) => x.key)).toEqual(["books"]);
  });

  it("the transports: «נהגים» alone — the requests come from the Week", () => {
    const t = tasksOf(input({ transports: null }));
    expect(stateLine(t.get("drivers")!)).toEqual(["unknown", "לא נטען"]);
    expect([...t.values()].filter((x) => x.state === "unknown").map((x) => x.key)).toEqual(["drivers"]);
  });

  it("all three at once: the Week's own tasks still say what stands", () => {
    const t = tasksOf(input({ rota: null, kk: null, transports: null }));
    expect([...t.values()].filter((x) => x.state === "unknown").map((x) => x.key)).toEqual(["presence", "assign", "books", "drivers", "prep"]);
    expect(["requests", "prints", "payments", "reader"].map((k) => t.get(k as TaskKey)!.state)).toEqual(["empty", "empty", "empty", "empty"]);
  });
});

describe("a viewer who may not decide here (mayDecide false: a practice or demo week, an archive)", () => {
  it("«בקשות שממתינות» and «נהגים» are «לא זמין במחזור הזה» — whatever the read says (get_transports_for answers [] there)", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "f");
    closeWith(w, addLesson(w, 0, 510, 600, { approval: "pending", pay_amount: 300, transport: "one_way" }), s);
    closeWith(w, addLesson(w, 1, 510, 600, { approval: "approved", transport: "one_way" }), s);
    for (const transports of [[], null]) {
      const t = tasksOf(input({ week: w, transports, mayDecide: false }));
      expect(stateLine(t.get("requests")!)).toEqual(["unknown", NOT_HERE]);
      expect(stateLine(t.get("drivers")!)).toEqual(["unknown", NOT_HERE]);
    }
    expect(NOT_HERE).toBe("לא זמין במחזור הזה");
    // the payments come from the Week: still counted
    expect(one("payments", input({ week: w, mayDecide: false })).state).toBe("empty"); // the approved one has no amount
  });
});

describe("«נוכחות המכינות»", () => {
  it("empty: no cohort entered", () => {
    expect(stateLine(one("presence", input()))).toEqual(["empty", "עוד לא הוזנו מכינות"]);
  });

  it("open: the cohorts never marked on campus (presence_unknown), by the cohorts' order", () => {
    const t = { trainees: 10, ...DIETS };
    const rota: RotaData = { ...EMPTY_ROTA, cohorts: [cohort(2, "ב", t), cohort(1, "א", t), cohort(3, "ג", t)], presence: [at(2, 1, 0)] };
    expect(stateLine(one("presence", input({ rota })))).toEqual(["open", "לא סומן מתי בקמפוס: מכינה לדוגמה א, מכינה לדוגמה ג"]);
    // a cohort that helps in no duty is still asked: its presence feeds the meal counts
    const notHelping: RotaData = { ...EMPTY_ROTA, cohorts: [cohort(1, "א", t)], presence: [] };
    expect(stateLine(one("presence", input({ rota: notHelping })))).toEqual(["open", "לא סומן מתי בקמפוס: מכינה לדוגמה א"]);
  });

  it("v20 open: a cohort whose trainees are TBD (the meals count them), after the presence — each by the cohorts' order", () => {
    const rota: RotaData = { ...EMPTY_ROTA, cohorts: [cohort(2, "ב", DIETS), cohort(1, "א", { trainees: 0, ...DIETS }), cohort(3, "ג", DIETS)], presence: [at(1, 0, 0), at(2, 1, 0), at(3, 2, 2)] };
    expect(stateLine(one("presence", input({ rota })))).toEqual(["open", "לא הוזן כמה חניכים: מכינה לדוגמה ב, מכינה לדוגמה ג"]); // 0 is a number, not TBD
    const both: RotaData = { ...rota, presence: [at(2, 1, 0)] };
    expect(stateLine(one("presence", input({ rota: both })))).toEqual([
      "open",
      "לא סומן מתי בקמפוס: מכינה לדוגמה א, מכינה לדוגמה ג · לא הוזן כמה חניכים: מכינה לדוגמה ב, מכינה לדוגמה ג",
    ]);
  });

  it("done: every cohort marked somewhere and its trainees typed — added up; those that help in a duty (v20) and those that can drive counted (absent: does not drive)", () => {
    const rota: RotaData = {
      ...EMPTY_ROTA,
      cohorts: [cohort(1, "א", { trainees: 48, diet_veg: 5, diet_gf: 2, diet_both: 1 }), cohort(2, "ב", { can_drive: true, trainees: 47, ...DIETS }), cohort(3, "ג", { can_drive: true, trainees: 40, ...DIETS }), cohort(4, "ד", { can_drive: false, trainees: 0, ...DIETS })],
      cohortDuties: [...helping([1, 2], [1]), ...helping([4], [1, 2])], // «ג» helps in none
      presence: [at(1, 0, 0), at(2, 4, 2), at(3, 2, 1), at(4, 1, 1)],
    };
    expect(stateLine(one("presence", input({ rota })))).toEqual(["done", "4 מכינות · 135 חניכים · עוזרות בתורנויות: 3 · יכולות להסיע: 2"]);
    const single: RotaData = { ...EMPTY_ROTA, cohorts: [cohort(1, "א", { trainees: 12, ...DIETS })], cohortDuties: helping([1], [1]), presence: [at(1, 0, 0)] };
    expect(stateLine(one("presence", input({ rota: single })))).toEqual(["done", "מכינה אחת · 12 חניכים · עוזרות בתורנויות: 1 · יכולות להסיע: 0"]);
  });

  it("the review: open while a cohort's diet numbers are TBD — four of the five columns of «כמויות אוכל» need them; after the trainees, by the cohorts' order", () => {
    const rota: RotaData = {
      ...EMPTY_ROTA,
      cohorts: [cohort(1, "א", { trainees: 40 }), cohort(2, "ב", { trainees: 20, diet_veg: 2, diet_gf: 1, diet_both: 0 }), cohort(3, "ג", { trainees: 10, diet_veg: 1, diet_gf: 0 })],
      presence: [at(1, 0, 0), at(2, 0, 0), at(3, 0, 0)],
    };
    expect(stateLine(one("presence", input({ rota })))).toEqual(["open", "לא הוזנה תזונה: מכינה לדוגמה א, מכינה לדוגמה ג"]);
    const both: RotaData = { ...rota, cohorts: [cohort(1, "א"), ...rota.cohorts.slice(1)] };
    expect(stateLine(one("presence", input({ rota: both })))).toEqual(["open", "לא הוזן כמה חניכים: מכינה לדוגמה א · לא הוזנה תזונה: מכינה לדוגמה א, מכינה לדוגמה ג"]);
  });
});

describe("«שיבוץ התורנויות»", () => {
  it("empty: no groups yet; groups but no duties yet", () => {
    expect(stateLine(one("assign", input()))).toEqual(["empty", "עוד אין קבוצות"]);
    expect(stateLine(one("assign", input({ rota: { ...EMPTY_ROTA, duties: [duty(1)] } })))).toEqual(["empty", "עוד אין קבוצות"]);
    expect(stateLine(one("assign", input({ rota: { ...EMPTY_ROTA, cohorts: [cohort(1, "א")], groups: [group(11, 1)] } })))).toEqual(["empty", "עוד אין תורנויות"]);
  });

  it("done: nothing the board asks to fill in", () => {
    expect(stateLine(one("assign", input({ rota: readyRota() })))).toEqual(["done", "כל המשמרות שובצו"]);
    // one target not set is enough to keep it open
    const unset = readyRota();
    unset.duties = [duty(1, { need_afternoon: null })];
    expect(stateLine(one("assign", input({ rota: unset })))).toEqual(["open", "תורנות אחת בלי מספר קבוצות"]);
  });

  it("open, one of each in the singular", () => {
    const r = readyRota();
    r.cohorts = [cohort(1, "א"), cohort(2, "נ")];
    r.presence = [at(1, 1, 1), at(2, 1, 0)];
    r.groups = [group(11, 1, { size: null }), group(12, 1, { head_name: null }), group(21, 2)];
    // duty 1 needs nobody in the afternoon; duty 2's night is not set; duty 3 needs a group every morning but Monday's
    r.duties = [duty(1), duty(2, { need_night: null }), duty(3, { need_morning: 1 })];
    // «א» helps in every duty; «נ» (v20) only in duty 1
    r.cohortDuties = [...helping([1], [1, 2, 3]), ...helping([2], [1])];
    r.assignments = [
      assign(1, 1, 1, 1, 11), // Monday afternoon on duty 1 (needs 0): too many in one shift
      assign(2, 0, 0, 3, 21), // Sunday morning, by hand, a group whose cohort does not help in duty 3
      assign(3, 1, 0, 3, 12),
      assign(4, 2, 0, 3, 12),
      assign(5, 3, 0, 3, 11),
    ];
    // Thursday morning is short; the staff's hours ask for nothing (v20: no «אחראי/ת משמרת»)
    r.staff = [];
    expect(stateLine(one("assign", input({ rota: r })))).toEqual([
      "open",
      [
        "קבוצה אחת בלי גודל",
        "קבוצה אחת בלי ראש/ת קבוצה",
        "תורנות אחת בלי מספר קבוצות",
        "חסרות קבוצות במשמרת אחת",
        "יותר מדי קבוצות במשמרת אחת",
        "שיבוץ אחד בתורנות שהמכינה לא עוזרת בה",
      ].join(" · "),
    ]);
  });

  it("open, in the plural — the shifts counted once each, whatever the duties in them", () => {
    const r = readyRota();
    r.groups = [group(11, 1, { size: null, head_name: null }), group(12, 1, { size: null, head_name: null })];
    r.cohorts = [cohort(1, "א")];
    // duties 1 and 2 need nobody (two groups on them are too many); 3 and 4 are short every afternoon; 5 and 6 have no target
    r.duties = [duty(1), duty(2), duty(3, { need_afternoon: 1 }), duty(4, { need_afternoon: 2 }), duty(5, { need_afternoon: null }), duty(6, { need_morning: null, need_night: null })];
    // v20: «א» helps in duties 3–6 only — the four rows on duties 1 and 2 are on duties it does not help in
    r.cohortDuties = helping([1], [3, 4, 5, 6]);
    r.assignments = [assign(1, 2, 2, 1, 11), assign(2, 2, 2, 2, 12), assign(3, 3, 0, 1, 11), assign(4, 3, 0, 2, 12)];
    r.staff = [];
    const line = one("assign", input({ rota: r })).line.split(" · ");
    expect(line).toEqual([
      "2 קבוצות בלי גודל",
      "2 קבוצות בלי ראש/ת קבוצה",
      "2 תורנויות בלי מספר קבוצות",
      "חסרות קבוצות ב-5 משמרות", // duties 3 and 4 both short every afternoon: five afternoons, each once
      "יותר מדי קבוצות ב-2 משמרות", // Tuesday night and Wednesday morning, each with two duties over
      "4 שיבוצים בתורנויות שהמכינה לא עוזרת בהן",
    ]);
  });

  it("an assignment on a duty the group's cohort helps in is not counted as «לא עוזרת»", () => {
    const r = readyRota();
    r.duties = [duty(1, { need_afternoon: 1 })];
    r.presence = [0, 1, 2, 3, 4].map((d) => at(1, d, 1));
    r.assignments = [0, 1, 2, 3, 4].map((d) => assign(d + 1, d, 1, 1, 11));
    expect(stateLine(one("assign", input({ rota: r })))).toEqual(["done", "כל המשמרות שובצו"]);
  });
});

describe("«בקשות שממתינות»", () => {
  it("empty: nobody asked for a payment or a transport yet (a draft's or a «none» does not count)", () => {
    const w = emptyWeek();
    closeWith(w, addLesson(w, 0, 510, 600), addSpeaker(w, "m"));
    addLesson(w, 1, 510, 600, { approval: "pending" }); // a draft: not a request
    expect(stateLine(one("requests", input({ week: w })))).toEqual(["empty", "עוד לא התבקשו תשלומים או הסעות"]);
  });

  it("open: the requests that wait (pendingPayments), singular and plural; done: none waits", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "f");
    const a = closeWith(w, addLesson(w, 0, 510, 600, { approval: "pending", pay_amount: 300 }), s);
    expect(stateLine(one("requests", input({ week: w })))).toEqual(["open", "בקשה אחת ממתינה"]);
    closeWith(w, addLesson(w, 1, 510, 600, { approval: "pending", transport: "round_trip" }), s);
    closeWith(w, addLesson(w, 2, 510, 600, { approval: "pending", pay_amount: 100 }), s);
    expect(stateLine(one("requests", input({ week: w })))).toEqual(["open", "3 בקשות ממתינות"]);
    for (const l of w.lessons) l.approval = l.id === a.id ? "rejected" : "approved";
    expect(stateLine(one("requests", input({ week: w })))).toEqual(["done", "אין בקשות שממתינות"]);
  });
});

describe("«ספרים»", () => {
  it("empty: no group has a book yet (an order line on a group with no book does not count)", () => {
    expect(stateLine(one("books", input()))).toEqual(["empty", "עוד אין ספרים"]);
    expect(stateLine(one("books", input({ kk: kkOf([kkGroup(1, null)], [{ group_id: 1, copies: 5, ordered_at: null }]) })))).toEqual(["empty", "עוד אין ספרים"]);
  });

  it("open: a book with no order line, or a line not marked «הוזמן» — singular and plural", () => {
    const kk = kkOf([kkGroup(1, "ספר לדוגמה א"), kkGroup(2, "ספר לדוגמה ב"), kkGroup(3, "ספר לדוגמה ג"), kkGroup(4, null)], [
      { group_id: 1, copies: 12, ordered_at: "2027-01-20T10:00:00Z" },
      { group_id: 2, copies: 8, ordered_at: null },
    ]);
    expect(stateLine(one("books", input({ kk })))).toEqual(["open", "2 ספרים עוד לא הוזמנו"]);
    kk.orders.push({ group_id: 3, copies: 4, ordered_at: "2027-01-21T10:00:00Z" });
    expect(stateLine(one("books", input({ kk })))).toEqual(["open", "ספר אחד עוד לא הוזמן"]);
  });

  it("«ההרשמה עדיין פתוחה» while the sign-up window is open (kkWindowState), not before or after", () => {
    const w = emptyWeek();
    w.edition.settings = { kk_window: { opens_at: "2027-01-20T10:00:00.000Z", closes_at: "2027-01-30T10:00:00.000Z" } };
    const kk = kkOf([kkGroup(1, "ספר לדוגמה")]);
    expect(one("books", input({ week: w, kk })).line).toBe("ספר אחד עוד לא הוזמן · ההרשמה עדיין פתוחה");
    expect(one("books", input({ week: w, kk }), "2027-01-19T10:00:00Z").line).toBe("ספר אחד עוד לא הוזמן");
    expect(one("books", input({ week: w, kk }), "2027-01-30T10:00:00Z").line).toBe("ספר אחד עוד לא הוזמן");
  });

  it("done: every book ordered", () => {
    const kk = kkOf([kkGroup(1, "ספר לדוגמה א"), kkGroup(2, null)], [{ group_id: 1, copies: 12, ordered_at: "2027-01-20T10:00:00Z" }]);
    expect(stateLine(one("books", input({ kk })))).toEqual(["done", "כל הספרים הוזמנו"]);
  });
});

describe("«הדפסות»", () => {
  it("empty: no lesson is printed ahead or on the day", () => {
    const w = emptyWeek();
    closeWith(w, addLesson(w, 0, 510, 600, { print_when: "none" }), addSpeaker(w, "m"));
    addLesson(w, 1, 510, 600, { print_when: "before" }); // a draft: not printed
    expect(stateLine(one("prints", input({ week: w })))).toEqual(["empty", "אין שיעורים להדפסה"]);
  });

  it("open: lessons to print with no file of their current speaker — singular and plural; done: every one has files", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "m");
    const other = addSpeaker(w, "f");
    const a = closeWith(w, addLesson(w, 0, 510, 600, { print_when: "before" }), s);
    const b = closeWith(w, addLesson(w, 1, 510, 600, { print_when: "same_day" }), s);
    addFile(w, b.id, other.id); // a previous speaker's file is not printed
    expect(stateLine(one("prints", input({ week: w })))).toEqual(["open", "2 שיעורים עוד בלי קבצים"]);
    addFile(w, a.id, s.id);
    expect(stateLine(one("prints", input({ week: w })))).toEqual(["open", "שיעור אחד עוד בלי קבצים"]);
    addFile(w, b.id, s.id, { kind: "presentation" }); // a presentation is never printed
    expect(one("prints", input({ week: w })).state).toBe("open");
    addFile(w, b.id, s.id);
    expect(stateLine(one("prints", input({ week: w })))).toEqual(["done", "לכל השיעורים להדפסה יש קבצים"]);
  });
});

describe("«נהגים»", () => {
  function withTransports() {
    const w = emptyWeek();
    w.edition.kind = "real";
    const s = addSpeaker(w, "f");
    const a = closeWith(w, addLesson(w, 0, 510, 600, { approval: "approved", transport: "one_way" }), s);
    const b = closeWith(w, addLesson(w, 1, 510, 600, { approval: "approved", transport: "round_trip" }), s);
    const c = closeWith(w, addLesson(w, 2, 510, 600, { approval: "approved", transport: "one_way" }), s);
    closeWith(w, addLesson(w, 3, 510, 600, { approval: "pending", transport: "one_way" }), s); // waits for the decision: not yet a driver's
    closeWith(w, addLesson(w, 3, 600, 690, { approval: "approved", transport: "none", pay_amount: 200 }), s); // a payment alone
    return { w, a, b, c };
  }

  it("empty: no transport approved", () => {
    const w = emptyWeek();
    closeWith(w, addLesson(w, 0, 510, 600, { approval: "pending", transport: "one_way" }), addSpeaker(w, "m"));
    expect(stateLine(one("drivers", input({ week: w })))).toEqual(["empty", "אין הסעות שאושרו"]);
  });

  it("open: approved and not «סודר» in the read (a row missing from it is not arranged) — singular and plural; done: all arranged", () => {
    const { w, a, b, c } = withTransports();
    expect(stateLine(one("drivers", input({ week: w, transports: [transport(a.id, true)] })))).toEqual(["open", "2 הסעות עוד בלי נהג/ת"]);
    expect(stateLine(one("drivers", input({ week: w, transports: [transport(a.id, true), transport(b.id, false), transport(c.id, true)] })))).toEqual(["open", "הסעה אחת עוד בלי נהג/ת"]);
    expect(stateLine(one("drivers", input({ week: w, transports: [transport(a.id, true), transport(b.id, true), transport(c.id, true)] })))).toEqual(["done", "כל ההסעות סודרו"]);
  });
});

describe("«תשלומים»", () => {
  it("empty: no amount approved (a pending one, or an approved transport with no amount, does not count)", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "m");
    closeWith(w, addLesson(w, 0, 510, 600, { approval: "pending", pay_amount: 300 }), s);
    closeWith(w, addLesson(w, 1, 510, 600, { approval: "approved", transport: "one_way" }), s);
    expect(stateLine(one("payments", input({ week: w })))).toEqual(["empty", "אין תשלומים שאושרו"]);
  });

  it("open: approved and not «שולם» — singular and plural; done: all paid", () => {
    const w = emptyWeek();
    const s = addSpeaker(w, "m");
    const a = closeWith(w, addLesson(w, 0, 510, 600, { approval: "approved", pay_amount: 300 }), s);
    const b = closeWith(w, addLesson(w, 1, 510, 600, { approval: "approved", pay_amount: 200 }), s);
    expect(stateLine(one("payments", input({ week: w })))).toEqual(["open", "2 תשלומים עוד לא שולמו"]);
    a.paid_at = "2027-02-10T10:00:00Z";
    expect(stateLine(one("payments", input({ week: w })))).toEqual(["open", "תשלום אחד עוד לא שולם"]);
    b.paid_at = "2027-02-11T10:00:00Z";
    expect(stateLine(one("payments", input({ week: w })))).toEqual(["done", "כל התשלומים שולמו"]);
  });
});

describe("«המקראה לדפוס»", () => {
  function readerWeek() {
    const w = emptyWeek();
    const s = addSpeaker(w, "f");
    const l = closeWith(w, addLesson(w, 0, 510, 600, { in_reader: true, sources_kind: "sheet" }), s);
    return { w, s, l };
  }

  it("empty: not sent, and nothing in the reader to print (a lesson not marked, a Word file, a presentation do not count)", () => {
    expect(stateLine(one("reader", input()))).toEqual(["empty", "עוד אין חומרים במקראה"]);
    const { w, s, l } = readerWeek();
    addFile(w, l.id, s.id, { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", page_count: null });
    addFile(w, l.id, s.id, { kind: "presentation" });
    const notMarked = closeWith(w, addLesson(w, 1, 510, 600, { in_reader: false, sources_kind: "sheet" }), s);
    addFile(w, notMarked.id, s.id);
    expect(stateLine(one("reader", input({ week: w })))).toEqual(["empty", "עוד אין חומרים במקראה"]);
  });

  it("open: something to print and not sent yet", () => {
    const { w, s, l } = readerWeek();
    addFile(w, l.id, s.id);
    expect(stateLine(one("reader", input({ week: w })))).toEqual(["open", "עוד לא נשלחה לדפוס"]);
  });

  it("done: sent (the date in Israel), nothing uploaded since; open again once a file came after it — singular and plural", () => {
    const { w, s, l } = readerWeek();
    addFile(w, l.id, s.id, { uploaded_at: "2027-02-01T10:00:00.000Z" });
    w.edition.settings = { reader_sent: { at: "2027-02-04T22:30:00.000Z", by: 5 } }; // 5.2 at 00:30 in Israel
    expect(stateLine(one("reader", input({ week: w })))).toEqual(["done", "נשלחה לדפוס ב-5.2.2027"]);
    addFile(w, l.id, s.id, { uploaded_at: "2027-02-06T10:00:00.000Z" });
    expect(stateLine(one("reader", input({ week: w })))).toEqual(["open", "נשלחה ב-5.2.2027 · נוסף קובץ אחד אחרי השליחה"]);
    addFile(w, l.id, s.id, { uploaded_at: "2027-02-07T10:00:00.000Z" });
    addFile(w, l.id, s.id, { uploaded_at: "2027-02-07T11:00:00.000Z", kind: "presentation" }); // never the reader's
    expect(stateLine(one("reader", input({ week: w })))).toEqual(["open", "נשלחה ב-5.2.2027 · נוספו 2 קבצים אחרי השליחה"]);
  });

  it("sent with nothing in it is still «done»: the mark is logistics' word", () => {
    const w = emptyWeek();
    w.edition.settings = { reader_sent: { at: "2027-02-04T10:00:00.000Z", by: null } };
    expect(stateLine(one("reader", input({ week: w })))).toEqual(["done", "נשלחה לדפוס ב-4.2.2027"]);
  });
});

describe("«מוצ״ש»", () => {
  it("empty: no task and no item", () => {
    expect(stateLine(one("prep", input()))).toEqual(["empty", "עוד אין משימות או קניות"]);
  });

  it("open: tasks done and items bought counted apart (absent kind = a task); a list with no rows is left out", () => {
    const both: RotaData = { ...EMPTY_ROTA, prep: [prep(1, true), prep(2, false, { kind: "task" }), prep(3, true, { kind: "item", qty: "2 (לדוגמה)" }), prep(4, false, { kind: "item" }), prep(5, false, { kind: "item" })] };
    expect(stateLine(one("prep", input({ rota: both })))).toEqual(["open", "1/2 משימות בוצעו · 1/3 פריטים נקנו"]);
    const tasksOnly: RotaData = { ...EMPTY_ROTA, prep: [prep(1, false), prep(2, true)] };
    expect(stateLine(one("prep", input({ rota: tasksOnly })))).toEqual(["open", "1/2 משימות בוצעו"]);
    const itemsOnly: RotaData = { ...EMPTY_ROTA, prep: [prep(1, false, { kind: "item" })] };
    expect(stateLine(one("prep", input({ rota: itemsOnly })))).toEqual(["open", "0/1 פריטים נקנו"]);
  });

  it("done: every task done and every item bought", () => {
    const all: RotaData = { ...EMPTY_ROTA, prep: [prep(1, true), prep(2, true, { kind: "item" })] };
    expect(stateLine(one("prep", input({ rota: all })))).toEqual(["done", "1/1 משימות בוצעו · 1/1 פריטים נקנו"]);
  });
});

describe("one week with every task done", () => {
  it("nine «done»s", () => {
    const w = emptyWeek();
    w.edition.kind = "real";
    w.edition.settings = { reader_sent: { at: "2027-02-10T10:00:00.000Z", by: 5 } };
    const s = addSpeaker(w, "f");
    const l = closeWith(w, addLesson(w, 0, 510, 600, { approval: "approved", pay_amount: 300, transport: "one_way", paid_at: "2027-02-09T10:00:00Z", print_when: "before", in_reader: true, sources_kind: "sheet" }), s);
    closeWith(w, addLesson(w, 1, 510, 600, { approval: "rejected", pay_amount: 900 }), s);
    addFile(w, l.id, s.id);
    const rota = readyRota();
    rota.prep = [prep(1, true)];
    const t = tasksOf({ week: w, rota, kk: kkOf([kkGroup(1, "ספר לדוגמה")], [{ group_id: 1, copies: 3, ordered_at: "2027-02-01T10:00:00Z" }]), transports: [transport(l.id, true)], mayDecide: true });
    expect([...t.values()].map((x) => [x.key, x.state])).toEqual([
      ["presence", "done"],
      ["assign", "done"],
      ["requests", "done"],
      ["books", "done"],
      ["prints", "done"],
      ["drivers", "done"],
      ["payments", "done"],
      ["reader", "done"],
      ["prep", "done"],
    ]);
  });
});
