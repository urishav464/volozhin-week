// «לוגיסטיקה»'s four lists, from a Week: the approved transports (the pickup address and the driver's phone only
// when asked for), the approved payments and their totals, the book orders (never a number nobody entered), and
// the prints by «מתי» and day (the current speaker's files, their pages, «אין קבצים»).
import { describe, expect, it } from "vitest";
import type { LessonTransport } from "../data/commands";
import type { KkData } from "../data/kk";
import type { SourceFile } from "../domain/types";
import { addLesson, addSpeaker, addTrainee, closeWith, emptyWeek } from "../testing/week";
import { toCsv } from "./csv";
import { bookRows, bookTable, pagesText, paymentRows, paymentTable, paymentTotals, printGroups, printRows, printTable, transportCounts, transportRows, transportTable } from "./logistics";
import { LRM } from "./table";

function week() {
  const w = emptyWeek();
  const a = addSpeaker(w, "f", "פלונית לדוגמה");
  a.title = "ד״ר";
  const b = addSpeaker(w, "m", "פלוני לדוגמה");
  const c = addSpeaker(w, null, "אלמוני/ת לדוגמה");
  const paidRide = closeWith(w, addLesson(w, 1, 510, 600, { title: "שיעור א", transport: "round_trip", approval: "approved", pay_amount: 1500, paid_at: "2026-11-12T10:00:00Z", print_when: "same_day" }), a);
  const ride = closeWith(w, addLesson(w, 0, 960, 1050, { title: "שיעור ב", transport: "one_way", approval: "approved", print_when: "before" }), b);
  const waiting = closeWith(w, addLesson(w, 0, 510, 600, { title: "שיעור ג", transport: "one_way", approval: "pending", pay_amount: 800, print_when: "before" }), c);
  const unpaid = closeWith(w, addLesson(w, 2, 510, 600, { title: "שיעור ד", approval: "approved", pay_amount: 700 }), c);
  const draft = addLesson(w, 0, 690, 780, { transport: "one_way", approval: "approved", print_when: "before" });
  return { w, a, b, c, paidRide, ride, waiting, unpaid, draft };
}

let n = 0;
function file(lessonId: number, speakerId: number | null, o: Partial<SourceFile> = {}): SourceFile {
  n++;
  return {
    id: n, lesson_id: lessonId, cover: false, speaker_id: speakerId, fallen_id: null, storage_path: `1/${lessonId}/${n}`, display_name: `דף ${n}.pdf`,
    mime: "application/pdf", size_bytes: 10, page_count: 2, uploaded_by: 1, uploaded_at: "2026-11-01T00:00:00Z", ...o,
  };
}

describe("the transports", () => {
  it("list the closed lessons whose transport was approved, in grid order — never one waiting, never a draft's", () => {
    const { w, ride, paidRide } = week();
    const rows = transportRows(w, [{ lesson_id: ride.id, pickup_address: "כתובת לדוגמה", pickup_time: "07:15", driver_name: "נהג/ת לדוגמה", driver_phone: "טלפון לדוגמה", arranged: true }]);
    expect(rows.map((r) => r.lesson.id)).toEqual([ride.id, paidRide.id]);
    expect(rows[0]).toMatchObject({ dayLabel: "ראשון", speaker: "פלוני לדוגמה", title: "שיעור ב", legs: "הלוך" });
    expect(rows[1]).toMatchObject({ speaker: "ד״ר פלונית לדוגמה", legs: "הלוך ושוב", details: null }); // nothing came back for it
    expect(transportCounts(rows)).toEqual({ total: 2, arranged: 1 });
  });

  it("leave the pickup address and the driver's phone out of the file unless «כולל כתובות וטלפונים» — and guard every cell", () => {
    const { w, ride } = week();
    const details: LessonTransport[] = [{ lesson_id: ride.id, pickup_address: "כתובת לדוגמה", pickup_time: "=אחרי השיעור", driver_name: "נהג/ת לדוגמה", driver_phone: "טלפון לדוגמה", arranged: false }];
    const rows = transportRows(w, details);
    const plain = transportTable(rows, "הדגמה", false);
    expect(plain.headers).toEqual(["יום ושעה", "מרצה", "כותרת", "הסעה", "שעת איסוף", "נהג/ת", "סודר"]);
    expect(JSON.stringify(plain)).not.toMatch(/כתובת לדוגמה|טלפון לדוגמה/);
    expect(plain.rows[0]).toEqual([`ראשון ${LRM}16:00–17:15`, "פלוני לדוגמה", "שיעור ב", "הלוך", "=אחרי השיעור", "נהג/ת לדוגמה", "טרם סודר"]);
    expect(toCsv(plain)).toContain(",'=אחרי השיעור,"); // the formula guard
    const full = transportTable(rows, "הדגמה", true);
    expect(full.headers).toEqual(["יום ושעה", "מרצה", "כותרת", "הסעה", "שעת איסוף", "כתובת איסוף", "נהג/ת", "טלפון הנהג/ת", "סודר"]);
    expect(full.rows[0].slice(5, 8)).toEqual(["כתובת לדוגמה", "נהג/ת לדוגמה", `${LRM}טלפון לדוגמה`]);
    expect(full.rows[1][8]).toBe(""); // no details: no «טרם סודר» made up
    expect(full.widths).toHaveLength(full.headers.length);
  });
});

describe("the payments", () => {
  it("list the approved amounts, «שולם» or not, with the totals — never a request still waiting, never a transport without an amount", () => {
    const { w, paidRide, unpaid } = week();
    const rows = paymentRows(w);
    expect(rows.map((r) => [r.lesson.id, r.amount, r.paidAt])).toEqual([
      [paidRide.id, 1500, "2026-11-12T10:00:00Z"],
      [unpaid.id, 700, null],
    ]);
    expect(paymentTotals(rows)).toEqual({ count: 2, total: 2200, paidCount: 1, paid: 1500, unpaid: 700 });
    const t = paymentTable(rows, "הדגמה", () => "12.11.2026");
    expect(t.rows.map((r) => r.slice(3))).toEqual([
      ["1500", "שולם · 12.11.2026"],
      ["700", "טרם שולם"],
      ["2200", "שולם 1500 · טרם שולם 700"],
    ]);
    expect(t.rows[2][0]).toBe("סה״כ");
  });
});

describe("the book orders", () => {
  it("list every group with a book or an order line — the week's, by title: its place, leaders and sign-ups; the copies only as logistics entered them", () => {
    const w = emptyWeek();
    const leader = addTrainee(w, "חניך/ה מעביר/ה");
    const kk: KkData = {
      groups: [
        { id: 5, title: "ספר ב", author: null, place: "הספרייה", capacity: 10, open: true },
        { id: 4, title: "ספר א", author: "מחבר/ת לדוגמה", place: "הדשא", capacity: null, open: false },
        { id: 6, title: null, author: null, place: null, capacity: null, open: true }, // leaders only, no book and no line: not a book row
        { id: 7, title: null, author: null, place: null, capacity: null, open: true }, // its book taken off after the line was written
      ],
      leaders: [
        { id: 2, group_id: 4, kind: "staff", roster_id: null, label: "מדריך/ה לדוגמה" },
        { id: 1, group_id: 4, kind: "trainee", roster_id: leader.id, label: null },
        { id: 3, group_id: 7, kind: "ein_prat", roster_id: null, label: "מעביר/ה לדוגמה" },
      ],
      signups: [
        { id: 1, group_id: 5, roster_id: 7, via: "link", created_at: "2026-11-01T00:00:00Z" },
        { id: 2, group_id: 5, roster_id: 8, via: "staff", created_at: "2026-11-01T00:00:00Z" },
      ],
      orders: [
        { group_id: 4, copies: 12, ordered_at: "2026-11-03T08:00:00Z" },
        { group_id: 7, copies: 3, ordered_at: null },
      ],
    };
    const rows = bookRows(w, kk);
    expect(rows.map((r) => [r.group.id, r.title, r.place, r.signups, r.copies, r.orderedAt])).toEqual([
      [4, "ספר א", "הדשא", 0, 12, "2026-11-03T08:00:00Z"],
      [5, "ספר ב", "הספרייה", 2, null, null], // 2 signed up — and still no copies until someone writes them
      [7, "עוד לא נבחר ספר · מעביר/ה לדוגמה", "", 0, 3, null],
    ]);
    expect(rows[0].leaders).toBe("מדריך/ה לדוגמה (מהצוות), חניך/ה מעביר/ה (חניך/ה)"); // in their order
    expect(rows[0].leaderCount).toBe(2);
    expect(rows[2].leaders).toBe("מעביר/ה לדוגמה (מעין פרת)");
    const t = bookTable(rows, "הדגמה", () => "3.11.2026");
    expect(t.headers).toEqual(["ספר", "מחבר/ת", "מרחב", "מעבירים", "נרשמו", "עותקים להזמנה", "הוזמן"]);
    expect(t.widths).toHaveLength(t.headers.length);
    expect(t.rows[0].slice(0, 3)).toEqual(["ספר א", "מחבר/ת לדוגמה", "הדשא"]);
    expect(t.rows.map((r) => r.slice(4))).toEqual([
      ["0", "12", "הוזמן · 3.11.2026"],
      ["2", "", ""],
      ["0", "3", "טרם הוזמן"],
    ]);
  });
});

describe("the prints", () => {
  it("group «להדפיס מראש» before «באותו יום», by day — the current speaker's files and their pages, «אין קבצים» when none", () => {
    const { w, a, b, paidRide, ride, waiting } = week();
    w.sourceFiles.push(
      file(ride.id, b.id, { page_count: 3 }),
      file(ride.id, b.id, { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", page_count: null, display_name: "דף.docx" }),
      file(ride.id, a.id, { page_count: 9 }), // a previous speaker's: never printed
      file(paidRide.id, a.id, { page_count: 1 }),
    );
    const rows = printRows(w);
    expect(rows.map((r) => [r.lesson.id, r.when])).toEqual([
      [waiting.id, "before"],
      [ride.id, "before"],
      [paidRide.id, "same_day"],
    ]);
    expect(rows[0]).toMatchObject({ heading: "אלמוני/ת לדוגמה – שיעור ג", files: [], pages: 0 });
    expect(rows.map(pagesText)).toEqual(["אין קבצים", "3 עמודים · קובץ אחד בלי ספירת עמודים", "עמוד אחד"]);
    expect(rows[1].files.map((f) => f.display_name)).toEqual(["דף 1.pdf", "דף.docx"]);
    expect(printGroups(rows).map((g) => [g.when, g.days.map((d) => [d.day, d.rows.length])])).toEqual([
      ["before", [[0, 2]]],
      ["same_day", [[1, 1]]],
    ]);
    const t = printTable(rows, "הדגמה");
    // «אין קבצים» once: the files' column says it, the pages' cell stays empty (the print, the CSV and the xlsx alike)
    expect(t.rows[0]).toEqual(["להדפיס מראש", `ראשון ${LRM}08:30–09:45`, "אלמוני/ת לדוגמה – שיעור ג", "אין קבצים", ""]);
    expect(t.rows.every((r) => r.filter((c) => c === "אין קבצים").length <= 1)).toBe(true);
    expect(JSON.stringify(t)).not.toMatch(/עותקים/); // no copy count nobody entered
  });
});
