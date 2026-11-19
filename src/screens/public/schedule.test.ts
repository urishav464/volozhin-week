// The schedule link's page (SchedulePage.tsx) in phase 4 of the reset: v19's schedule_view adds a row's `note` and
// `people`, and the top-level `people` (the approved speakers' public_bio and photo) and `fixed` (meals, prayers,
// «מכריכה לכריכה») — the guests' site is phase 5's. Until then the page TOLERATES them: it draws exactly what it drew
// from an answer written before v19, and none of the new words, pictures or rows.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ScheduleView } from "../../data/publicPort";
import type { ScheduleEntry } from "../../exports/designer";

// the page's module reaches src/lib/config.ts (through the public pages' port), which reads the address when it loads:
// a window of our own, with no ?demo and no stored persona, before it is imported
vi.stubGlobal("window", { location: { search: "", hash: "" }, sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
const { Schedule } = await import("./SchedulePage");
afterAll(() => {
  vi.unstubAllGlobals();
});

const BIO = "תיאור לדוגמה לאורחים";
const NOTE = "הערה לדוגמה לאורחים";
const FIXED = "ארוחה לדוגמה";
const PHOTO = "data:image/jpeg;base64,/9j/AAAA";

/**
 * What schedule_view answered before v19 (a database the owner has not re-run yet): the ten keys a row had, no `people`
 * and no `fixed` — not a ScheduleView any more (its v19 keys are required), yet the page must draw it as it did.
 */
type AnswerBefore19 = Pick<ScheduleView, "edition"> & { rows: ScheduleEntry[] };

/** A closed lesson and a memorial slot, the week's date TBD. */
const before: AnswerBefore19 = {
  edition: { label: "מחזור לדוגמה", start_date: null },
  rows: [
    { kind: "lesson", day: 0, date: null, start_min: 510, end_min: 600, speaker: "מרצה לדוגמה · מרצה לדוגמה ב", title: "שיעור לדוגמה", category: "קטגוריה לדוגמה", room: "חדר לדוגמה", parallel: false },
    { kind: "memorial", day: 1, date: null, start_min: 780, end_min: 795, speaker: "", title: null, category: "", room: "חדר לדוגמה", parallel: false },
  ],
};

/** The same schedule as v19 answers it: a note on the lesson, its approved speaker, the fixed rows. */
const v19: ScheduleView = {
  ...before,
  rows: [
    { ...before.rows[0], note: NOTE, people: [0] },
    { ...before.rows[1], note: null, people: [] },
  ],
  people: [{ label: "מרצה לדוגמה", bio: BIO, photo: PHOTO }],
  fixed: [
    { day: 0, start_min: 420, end_min: 480, label: FIXED },
    { day: 2, start_min: 795, end_min: 840, label: FIXED },
  ],
};

const render = (view: ScheduleView | AnswerBefore19) => renderToStaticMarkup(createElement(Schedule, { view: view as ScheduleView }));

describe("the schedule link's page tolerates v19's answer (the guests' site is phase 5's)", () => {
  it("draws a v19 answer exactly as the same answer written before v19", () => {
    expect(render(v19)).toBe(render(before));
  });

  it("shows none of the new keys: no note, bio, photo or fixed row — and no day only a fixed row has", () => {
    const out = render(v19);
    for (const word of [NOTE, BIO, FIXED, "data:image", "<img"]) expect(out).not.toContain(word);
    // the ten keys still drawn: the speakers' string, the title, the category and room, the memorial time
    expect(out).toContain("מרצה לדוגמה · מרצה לדוגמה ב");
    expect(out).toContain("שיעור לדוגמה");
    expect(out).toContain("קטגוריה לדוגמה · חדר לדוגמה");
    expect(out).toContain("זמן זיכרון");
    // two rows, two days (Sunday, Monday): Tuesday has only a fixed row, and stays out
    expect(out.match(/data-schedule-row/g)).toHaveLength(2);
    expect(out).toContain('aria-label="יום ראשון"');
    expect(out).toContain('aria-label="יום שני"');
    expect(out).not.toContain('aria-label="יום שלישי"');
  });

  it("an answer with no rows says so, whatever people or fixed rows it carries", () => {
    const empty = render({ ...v19, rows: [] });
    expect(empty).toBe(render({ ...before, rows: [] }));
    expect(empty).toContain("עוד אין שיעורים סגורים בלו&quot;ז."); // the markup escapes the gershayim
    expect(empty).not.toContain(FIXED);
  });
});
