// The schedule link's page — the guests' site since the reset's phase 5 (SchedulePage.tsx, GuestCard.tsx), drawn on the
// server: the fixed rows among the lessons, a day with only fixed rows, which lesson is a button «עוד פרטים», an answer
// written before v19 (a database not yet re-run) drawn as the plain schedule, and the card: text nodes only, a photo
// only when it is one the database would store. The page's markup carries no description, bio or photo — they are
// the card's alone (the e2e opens it in a browser, links.spec.ts).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { PublicPerson, ScheduleView } from "../../data/publicPort";
import { photoDataUrl } from "../../domain/photo";
import { photoBase64 } from "../../testing/photos";
import type { ScheduleAnswer } from "./guestDays";

// the page's module reaches src/lib/config.ts (through the public pages' port), which reads the address when it loads:
// a window of our own, with no ?demo and no stored persona, before it is imported
vi.stubGlobal("window", { location: { search: "", hash: "" }, sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
const { Schedule } = await import("./SchedulePage");
const { CardBody, GuestCardDialog } = await import("./GuestCard");
afterAll(() => {
  vi.unstubAllGlobals();
});

const BIO = "תיאור לדוגמה לאורחים";
const NOTE = "הערה לדוגמה לאורחים";
const FIXED = "ארוחה לדוגמה";
const PHOTO = photoDataUrl(photoBase64("clean"));

/** A closed lesson, a lesson with nothing more, and a memorial slot; the week's date TBD — as answered before v19. */
const before: ScheduleAnswer = {
  edition: { label: "מחזור לדוגמה", start_date: null },
  rows: [
    { kind: "lesson", day: 0, date: null, start_min: 510, end_min: 600, speaker: "מרצה לדוגמה · מרצה לדוגמה ב", title: "שיעור לדוגמה", category: "קטגוריה לדוגמה", room: "חדר לדוגמה", parallel: false },
    { kind: "lesson", day: 0, date: null, start_min: 780, end_min: 870, speaker: "מרצה לדוגמה ג", title: "שיעור לדוגמה ב", category: "", room: "חדר לדוגמה", parallel: false },
    { kind: "memorial", day: 1, date: null, start_min: 780, end_min: 795, speaker: "", title: null, category: "", room: "חדר לדוגמה", parallel: false },
  ],
};

/** The same schedule as v19 answers it: a note and an approved speaker on the first lesson, the fixed rows. */
const v19: ScheduleView = {
  ...before,
  rows: [
    { ...before.rows[0], note: NOTE, people: [0] },
    { ...before.rows[1], note: null, people: [] },
    { ...before.rows[2], note: null, people: [] },
  ],
  people: [{ label: "מרצה לדוגמה", bio: BIO, photo: PHOTO }],
  fixed: [
    { day: 0, start_min: 420, end_min: 480, label: FIXED },
    { day: 0, start_min: 780, end_min: 840, label: "צהריים לדוגמה" },
    { day: 0, start_min: 1440, end_min: 1470, label: "חצות לדוגמה" },
    { day: 2, start_min: 795, end_min: 840, label: FIXED },
  ],
};

const render = (view: ScheduleView | ScheduleAnswer, extra: { preview?: boolean; now?: string } = {}) => renderToStaticMarkup(createElement(Schedule, { view, ...extra }));

/** The order in which the markup draws these words. */
const order = (out: string, words: string[]) => words.map((w) => out.indexOf(w));

describe("the schedule link's page: the guests' schedule", () => {
  it("draws the fixed rows among the lessons by time, and a day that has only fixed rows", () => {
    const out = render(v19);
    expect(out.match(/data-schedule-row/g)).toHaveLength(3); // lessons and memorial times only
    expect(out.match(/data-fixed-row/g)).toHaveLength(4);
    const at = order(out, [FIXED, "08:30–10:00", "צהריים לדוגמה", "13:00–14:30", "חצות לדוגמה"]);
    expect(at.every((x) => x >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // the night's fixed row carries the night's name; a lesson's row keeps its ten keys
    expect(out).toContain("ליל ראשון–שני");
    expect(out).toContain("מרצה לדוגמה · מרצה לדוגמה ב");
    expect(out).toContain("קטגוריה לדוגמה · חדר לדוגמה");
    expect(out).toContain("זמן זיכרון");
    for (const day of ["ראשון", "שני", "שלישי"]) expect(out).toContain(`aria-label="יום ${day}"`); // Tuesday: fixed rows only
    expect(out).toContain('data-guest-day="2"');
  });

  it("a lesson with more is a button «עוד פרטים»; one without and a memorial time are plain rows", () => {
    const out = render(v19);
    expect(out.match(/data-guest-lesson=/g)).toHaveLength(1);
    expect(out).toContain('data-guest-lesson="0"');
    expect(out).toContain('aria-haspopup="dialog"');
    expect(out.match(/>עוד פרטים</g)).toHaveLength(1);
    expect(out).toContain("שיעור שמסומן «עוד פרטים» נפתח בלחיצה: תיאור השיעור והמרצים.");
    expect(out).toMatch(/data-kind="lesson"/);
    expect(out).toMatch(/data-kind="memorial"/);
  });

  it("the page's markup itself carries no description, bio or photo (the card's alone), and no link inside the page", () => {
    const out = render(v19);
    for (const word of [NOTE, BIO, "data:image", "<img", "data-guest-card"]) expect(out).not.toContain(word);
    // the day bar is buttons: the address's hash is the link's token
    expect(out).toContain('aria-label="ימי השבוע"');
    expect(out.match(/data-day-jump=/g)).toHaveLength(3);
    expect(out).not.toMatch(/href="#/);
  });

  it("an answer written before v19 draws its rows, no fixed row and no button — and v19's empty keys draw the same", () => {
    const out = render(before);
    expect(out.match(/data-schedule-row/g)).toHaveLength(3);
    expect(out).not.toContain("data-fixed-row");
    expect(out).not.toContain("data-guest-lesson");
    expect(out).not.toContain("עוד פרטים");
    expect(out).not.toContain('aria-label="יום שלישי"');
    const empty: ScheduleView = { ...v19, rows: v19.rows.map((r) => ({ ...r, note: null, people: [] })), people: [], fixed: [] };
    expect(render(empty)).toBe(out);
  });

  it("an answer with no rows says so, whatever people or fixed rows it carries", () => {
    const empty = render({ ...v19, rows: [] });
    expect(empty).toBe(render({ ...before, rows: [] }));
    expect(empty).toContain("עוד אין שיעורים סגורים בלו&quot;ז."); // the markup escapes the gershayim
    expect(empty).not.toContain(FIXED);
    expect(empty).not.toContain("<section");
    expect(empty).not.toContain("הדפסה"); // nothing to print
  });

  it("the week's date: the day's, «היום» on the day «now» falls in, the TBD line while there is none", () => {
    expect(render(v19)).toContain("תאריך השבוע עוד לא נקבע (TBD).");
    const dated = render({ ...v19, edition: { ...v19.edition, start_date: "2027-02-14" } }, { now: "2027-02-15T10:00:00Z" });
    expect(dated).not.toContain("(TBD)");
    expect(dated).toContain("14.2.2027");
    expect(dated.match(/>היום</g)).toHaveLength(2); // the day bar's and Monday's heading
    expect(dated.indexOf(">היום<")).toBeGreaterThan(dated.indexOf('data-day-jump="1"'));
  });

  it("a preview (a team page) has no print setup and no «הדפסה»; the guest's page has both", () => {
    expect(render(v19)).toContain("@page { size: A4 portrait");
    expect(render(v19)).toContain(">הדפסה<");
    const preview = render(v19, { preview: true });
    expect(preview).not.toContain("@page");
    expect(preview).not.toContain("הדפסה");
    expect(preview).toContain('data-guest-lesson="0"');
  });
});

const card = (people: PublicPerson[], over: Partial<ScheduleView["rows"][number]> = {}, startDate: string | null = null) =>
  renderToStaticMarkup(createElement(CardBody, { row: { ...v19.rows[0], ...over }, people, startDate, titleId: "t" }));

describe("the guests' card (CardBody)", () => {
  it("the title, when and where, the names, the description, each approved person's description and photo", () => {
    const out = card(v19.people);
    expect(out).toContain('id="t"');
    expect(out).toContain("שיעור לדוגמה");
    expect(out).toContain("יום ראשון · ");
    expect(out).toContain("08:30–10:00");
    expect(out).toContain("חדר לדוגמה · קטגוריה לדוגמה");
    expect(out).toContain("מרצה לדוגמה · מרצה לדוגמה ב"); // every name, approved or not, as on the poster
    expect(out).toContain("data-guest-note");
    expect(out).toContain(NOTE);
    expect(out).toContain('data-guest-person="0"');
    expect(out).toContain(BIO);
    expect(out).toContain(`src="${PHOTO}"`);
    expect(out).toContain('alt="תמונה של מרצה לדוגמה"');
    expect(out.match(/<img/g)).toHaveLength(1);
    expect(out).not.toContain("TBD"); // the date omitted while TBD
  });

  it("a dated night lesson: the night's name and the calendar's date (the next morning's)", () => {
    const out = card(v19.people, { day: 0, start_min: 1470, end_min: 1530 }, "2027-02-14");
    expect(out).toContain("ליל ראשון–שני");
    expect(out).toContain("00:30–01:30");
    expect(out).toContain("15.2.2027");
  });

  it("text nodes only: markup in a description or a name comes out as text", () => {
    const out = card([{ label: "<i>שם</i>", bio: '<img src="x" onerror="alert(1)">', photo: null }], { note: "<b>מודגש</b>\nשורה" });
    expect(out).toContain("&lt;b&gt;מודגש&lt;/b&gt;");
    expect(out).toContain("&lt;i&gt;שם&lt;/i&gt;");
    expect(out).toContain("&lt;img src=&quot;x&quot;");
    expect(out).not.toContain("<b>");
    expect(out).not.toContain("<img");
  });

  it("an address or a broken photo is never drawn; a person with neither a description nor a photo is not listed", () => {
    const people: PublicPerson[] = [
      { label: "א", bio: null, photo: "https://example.org/x.jpg" },
      { label: "ב", bio: "תיאור לדוגמה ב", photo: "data:image/jpeg;base64,/9j/AAAA" },
      { label: "ג", bio: "  ", photo: null },
    ];
    const out = card(people, { people: [0, 1, 2, 7] });
    expect(out).not.toContain("<img");
    expect(out).not.toContain("example.org");
    expect(out).not.toContain('data-guest-person="0"');
    expect(out).toContain('data-guest-person="1"');
    expect(out).not.toContain('data-guest-person="2"');
    expect(out).not.toContain('data-guest-person="7"');
  });

  it("a lesson with no description draws no empty paragraph for it", () => {
    expect(card(v19.people, { note: null })).not.toContain("data-guest-note");
    expect(card(v19.people, { note: "   " })).not.toContain("data-guest-note");
  });
});

describe("the card's dialog (GuestCardDialog), before the browser opens it", () => {
  it("a dialog named by its heading, closed until showModal; «סגירה» at the top and at the bottom", () => {
    const out = renderToStaticMarkup(createElement(GuestCardDialog, { row: v19.rows[0], people: v19.people, startDate: null, onClose: () => {} }));
    expect(out.startsWith("<dialog")).toBe(true);
    expect(out).toContain("data-guest-card");
    const id = /aria-labelledby="([^"]+)"/.exec(out)![1];
    expect(out).toContain(`<h2 id="${id}"`);
    expect(out).not.toMatch(/<dialog[^>]* open[ =>]/);
    expect(out.match(/aria-label="סגירה"/g)).toHaveLength(1);
    expect(out.match(/>סגירה</g)).toHaveLength(1);
  });
});
