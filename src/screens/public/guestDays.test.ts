// The guests' schedule as the page draws it (guestDays.ts): a pre-v19 answer filled in empty, the photos a card may draw,
// which lesson opens a card, and the days — lessons, memorial times and fixed rows merged by time, the night, the date,
// «היום».
import { describe, expect, it } from "vitest";
import type { FixedRow, PublicScheduleRow, ScheduleView } from "../../data/publicPort";
import { messageDate } from "../../domain/message";
import { photoDataUrl } from "../../domain/photo";
import { photoBase64 } from "../../testing/photos";
import { guestDays, guestPeople, guestView, rowHasMore, type ScheduleAnswer } from "./guestDays";

const PHOTO = photoDataUrl(photoBase64("clean"));

const lesson = (over: Partial<PublicScheduleRow>): PublicScheduleRow => ({
  kind: "lesson",
  day: 0,
  date: null,
  start_min: 510,
  end_min: 585,
  speaker: "מרצה לדוגמה",
  title: "שיעור לדוגמה",
  category: "",
  room: "חדר לדוגמה",
  parallel: false,
  note: null,
  people: [],
  ...over,
});
const fixed = (day: FixedRow["day"], start_min: number, label: string): FixedRow => ({ day, start_min, end_min: start_min + 30, label });

const view = (over: Partial<ScheduleView>): ScheduleView => ({ edition: { label: "מחזור לדוגמה", start_date: null }, rows: [], people: [], fixed: [], ...over });

describe("guestView: every v19 key present", () => {
  it("fills an answer written before v19 in empty: no people, no fixed rows, no note, no people on a row", () => {
    const { note: _n, people: _p, ...plain } = lesson({});
    const before: ScheduleAnswer = { edition: { label: "מחזור לדוגמה", start_date: null }, rows: [plain] };
    const v = guestView(before);
    expect(v.people).toEqual([]);
    expect(v.fixed).toEqual([]);
    expect(v.rows).toEqual([{ ...plain, note: null, people: [] }]);
  });

  it("gives a v19 answer back equal, and is idempotent", () => {
    const v19 = view({
      rows: [lesson({ note: "תיאור לדוגמה", people: [0] })],
      people: [{ label: "מרצה לדוגמה", bio: "תיאור לדוגמה", photo: PHOTO }],
      fixed: [fixed(0, 420, "ארוחה לדוגמה")],
    });
    expect(guestView(v19)).toEqual(v19);
    expect(guestView(guestView(v19))).toEqual(v19);
  });

  it("drops what is not there: an index into people out of range or no integer, a memorial time's note and people, a broken fixed row", () => {
    const v = guestView({
      edition: { label: "מחזור לדוגמה", start_date: null },
      rows: [lesson({ people: [0, 1, -1, 0.5, "0" as unknown as number] }), lesson({ kind: "memorial", note: "לא לאורחים", people: [0] })],
      people: [{ label: "מרצה לדוגמה", bio: null, photo: null }],
      fixed: [fixed(0, 420, "ארוחה לדוגמה"), { day: 7, start_min: 1, end_min: 2, label: "x" }, null, { day: 1, start_min: "a", end_min: 2, label: "x" }],
    } as ScheduleAnswer);
    expect(v.rows[0].people).toEqual([0]);
    expect(v.rows[1]).toMatchObject({ note: null, people: [] });
    expect(v.fixed).toEqual([fixed(0, 420, "ארוחה לדוגמה")]);
  });
});

describe("guestPeople and rowHasMore: what opens a card", () => {
  const v = view({
    rows: [
      lesson({ people: [0] }), // a description
      lesson({ people: [1] }), // a photo only
      lesson({ people: [2] }), // neither: an approved name alone
      lesson({ people: [3] }), // a photo that is no photo the database stores, a blank description
      lesson({ note: "תיאור קצר לדוגמה" }),
      lesson({ note: "  \n " }),
      lesson({ kind: "memorial" }),
    ],
    people: [
      { label: "א", bio: "תיאור לדוגמה", photo: null },
      { label: "ב", bio: null, photo: PHOTO },
      { label: "ג", bio: null, photo: null },
      { label: "ד", bio: "   ", photo: "https://example.org/x.jpg" },
    ],
  });
  const people = guestPeople(v);

  it("keeps a photo only when guestPhotoSrc accepts it", () => {
    expect(people.map((p) => p.src)).toEqual([null, PHOTO, null, null]);
    expect(people[0]).toMatchObject({ label: "א", bio: "תיאור לדוגמה", photo: null });
  });

  it("a lesson opens a card with a description, or a person with a description or a photo; a memorial time never", () => {
    expect(v.rows.map((r) => rowHasMore(r, people))).toEqual([true, true, false, false, true, false, false]);
  });
});

describe("guestDays: by day, by time", () => {
  it("merges the fixed rows among the lessons by start; at the same minute a fixed row first; parallel lessons in the answer's order", () => {
    const v = view({
      rows: [
        lesson({ start_min: 510, title: "א" }),
        lesson({ start_min: 780, title: "ב", room: "חדר א" }),
        lesson({ start_min: 780, title: "ג", room: "חדר ב" }),
        lesson({ kind: "memorial", start_min: 1140, end_min: 1155, speaker: "", title: null }),
      ],
      fixed: [fixed(0, 420, "בוקר"), fixed(0, 780, "צהריים"), fixed(0, 1440, "חצות")],
    });
    const [d] = guestDays(v, "2026-11-22T10:00:00Z");
    expect(d.items.map((i) => (i.type === "fixed" ? `f:${i.fixed.label}` : `${i.type}:${i.row.title}`))).toEqual([
      "f:בוקר",
      "lesson:א",
      "f:צהריים",
      "lesson:ב",
      "lesson:ג",
      "memorial:null",
      "f:חצות",
    ]);
    expect(d.items.map((i) => i.night)).toEqual([false, false, false, false, false, false, true]);
    // a row's index is its place in the answer's rows (the card is opened by it)
    expect(d.items.flatMap((i) => (i.type === "fixed" ? [] : [i.index]))).toEqual([0, 1, 2, 3]);
  });

  it("a day that has only fixed rows is drawn; no day at all while no lesson is closed", () => {
    const v = view({ rows: [lesson({ day: 0 }), lesson({ day: 3 })], fixed: [fixed(1, 420, "בוקר"), fixed(3, 420, "בוקר")] });
    expect(guestDays(v, "2026-11-22T10:00:00Z").map((d) => d.day)).toEqual([0, 1, 3]);
    expect(guestDays({ ...v, rows: [] }, "2026-11-22T10:00:00Z")).toEqual([]);
  });

  it("the column's date, or null while TBD; «היום» in Israel time, the small hours still the day before's column", () => {
    const rows = [lesson({ day: 0 }), lesson({ day: 1, start_min: 1470 }), lesson({ day: 2 })];
    const dated = view({ edition: { label: "מחזור לדוגמה", start_date: "2027-02-14" }, rows });
    const days = guestDays(dated, "2027-02-16T03:00:00Z"); // 05:00 on Tuesday in Israel: Monday's night
    expect(days.map((d) => d.date)).toEqual([0, 1, 2].map((day) => messageDate("2027-02-14", day, 390)));
    expect(days[1].date?.startsWith("15.2.2027")).toBe(true); // the column's own date, not the night's morning
    expect(days.map((d) => d.today)).toEqual([false, true, false]);
    expect(guestDays(dated, "2027-02-16T05:00:00Z").map((d) => d.today)).toEqual([false, false, true]);
    expect(guestDays(dated, "2027-03-01T10:00:00Z").some((d) => d.today)).toBe(false); // after the week
    const tbd = guestDays(view({ rows }), "2027-02-16T05:00:00Z");
    expect(tbd.map((d) => [d.date, d.today])).toEqual([
      [null, false],
      [null, false],
      [null, false],
    ]);
  });

  it("marks the lessons that open a card", () => {
    const v = view({ rows: [lesson({ note: "תיאור לדוגמה" }), lesson({})] });
    const [d] = guestDays(v, "2026-11-22T10:00:00Z");
    expect(d.items.map((i) => i.type === "lesson" && i.more)).toEqual([true, false]);
  });
});
