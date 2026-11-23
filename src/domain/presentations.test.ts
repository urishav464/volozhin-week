// «מצגות» (the reset, phase 5): the rows of a day and their states on the demo week (every state shows there), the week's
// decks and the presentations left without a lesson, the day's zip plan — its names, their order, the two text files —
// and this device's memory of the last download (a storage that throws forgets, never breaks the page).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { demoWeek, seedDemoPresentations, seedDemoSources } from "../data/demoWeek";
import { scheduleEntries } from "../exports/designer";
import {
  dayRows, dayZipPlan, hhmm, LINKS_FILE, lessonPresentations, markerTime, megabytes, newestUpload, newSinceDownload, ORDER_FILE, orphanPresentations, presentationRows,
  presentationsDay, presentationsRoomKey, presentationsZipKey, readRoom, readZipMarker, weekPresentations, writeRoom, writeZipMarker, zipLine,
} from "./presentations";
import { DOCX, PPTX } from "../data/sourceRules";
import type { SourceFile, Week } from "./types";

function week(): Week {
  const w = demoWeek();
  seedDemoSources(w);
  seedDemoPresentations(w);
  return w;
}

const at = (w: Week, day: number, start: number, room = 1) => w.lessons.find((l) => l.kind === "lesson" && l.day === day && l.start_min === start && l.room_id === room && l.state === "closed")!;

let nextId = 100;
/** The stored extension of a type, as app.source_mime_ok ties the two (the path's is what the zip names a file by). */
const EXT: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", [PPTX]: "pptx", [DOCX]: "docx" };

function deck(w: Week, lessonId: number | null, display: string, extra: Partial<SourceFile> = {}): SourceFile {
  const id = ++nextId;
  const lead = lessonId == null ? null : (w.lessonSpeakers.find((x) => x.lesson_id === lessonId && x.role === "lead")?.speaker_id ?? null);
  const mime = extra.mime ?? PPTX;
  const f: SourceFile = {
    id, lesson_id: lessonId, cover: false, kind: "presentation", speaker_id: lead, fallen_id: null,
    storage_path: `${w.edition.id}/${lessonId ?? "cover"}/00000000-0000-4000-9000-${String(id).padStart(12, "0")}-deck.${EXT[mime]}`, display_name: display,
    mime, size_bytes: 1000, page_count: null, uploaded_by: 2, uploaded_at: "2026-11-20T10:00:00Z", ...extra,
  };
  w.sourceFiles.push(f);
  return f;
}

/** A text file's lines, the BOM checked and taken off. */
function lines(t: { text: string }): string[] {
  expect(t.text.startsWith("﻿")).toBe(true);
  expect(t.text.endsWith("\r\n")).toBe(true);
  expect(t.text.replaceAll("\r\n", "")).not.toContain("\n"); // CRLF only
  return t.text.slice(1, -2).split("\r\n");
}

describe("the day's rows", () => {
  it("every closed lesson and memorial slot, in the schedule's order, each with its state — the demo shows all five", () => {
    const w = week();
    const rows = presentationRows(w);
    expect(rows.map((r) => r.lessonId)).toEqual(scheduleEntries(w).map((e) => e.lesson_id));
    const row = (l: { id: number }) => rows.find((r) => r.lessonId === l.id)!;
    const opening = row(at(w, 0, 510));
    expect(opening).toMatchObject({ state: "file", day: 0, start_min: 510, end_min: 585, room: "בית מדרש", title: "פתיחת השבוע (לדוגמה)", link: null });
    expect(opening.files.map((f) => f.display_name)).toEqual(["מצגת לדוגמה.pdf"]); // the sources are not presentations
    expect(row(at(w, 0, 600))).toMatchObject({ state: "link", link: "https://slides.example/presentation-demo", files: [] });
    expect(row(at(w, 0, 690))).toMatchObject({ state: "none", title: at(w, 0, 690).title });
    at(w, 0, 690).title = null;
    expect(presentationRows(w).find((r) => r.lessonId === at(w, 0, 690).id)!.title).toBe("TBD");
    expect(row(at(w, 2, 960, 1))).toMatchObject({ state: "missing", files: [] }); // «מצגת» marked, nothing uploaded
    expect(row(at(w, 2, 960, 2)).files.map((f) => f.display_name)).toEqual(["שקפים לדוגמה.pdf"]);
    const memorial = rows.filter((r) => r.kind === "memorial");
    expect(memorial).toHaveLength(10);
    for (const m of memorial) expect(m).toMatchObject({ state: "memorial", speaker: "", title: "זמן זיכרון", files: [], link: null });
    expect(new Set(rows.map((r) => r.state))).toEqual(new Set(["file", "link", "missing", "none", "memorial"]));
  });

  it("a link must be http(s) to be one; a file outranks a link, a link outranks «expected»", () => {
    const w = week();
    const l = at(w, 0, 600);
    l.presentation_url = "javascript:alert(1)";
    expect(lessonPresentations(w, l)).toMatchObject({ state: "missing", link: null }); // sources_kind presentation
    l.presentation_url = " https://slides.example/x ";
    expect(lessonPresentations(w, l)).toMatchObject({ state: "link", link: "https://slides.example/x" });
    deck(w, l.id, "שקפים.pptx");
    expect(lessonPresentations(w, l).state).toBe("file");
  });

  it("only the current lead's presentations are the row's; a previous speaker's are the lesson page's «מהמרצה הקודם»", () => {
    const w = week();
    const l = at(w, 0, 510);
    const old = deck(w, l.id, "ישן.pptx", { speaker_id: 999 });
    const p = lessonPresentations(w, l);
    expect(p.files.map((f) => f.id)).toEqual([5]);
    expect(p.previous.map((f) => f.id)).toEqual([old.id]);
    // a lesson that is not closed has no current files: they are all a previous speaker's
    l.state = "draft";
    expect(lessonPresentations(w, l)).toMatchObject({ files: [], state: "none" });
    expect(lessonPresentations(w, l).previous.map((f) => f.id)).toEqual([5, old.id]);
  });

  it("dayRows: one day, all rooms or one", () => {
    const w = week();
    const rows = presentationRows(w);
    expect(dayRows(rows, 2, null).filter((r) => r.start_min === 960).map((r) => r.roomId)).toEqual([1, 2]);
    expect(dayRows(rows, 2, 2).map((r) => r.roomId)).toEqual([2]);
    expect(dayRows(rows, 2, 3)).toEqual([]);
  });
});

describe("the week's decks and the presentations without a lesson", () => {
  it("the week's: a presentation on the cover path; never a source, never a lesson's", () => {
    const w = week();
    expect(weekPresentations(w).map((f) => f.display_name)).toEqual(["המצגת המלווה לשבוע (לדוגמה).pdf"]);
    expect(orphanPresentations(w)).toEqual([]);
  });

  it("left without a lesson: reopened, cancelled, deleted (its path still names it) or another lead's — each with why", () => {
    const w = week();
    const opening = at(w, 0, 510);
    const parallel = at(w, 2, 960, 2);
    const previous = deck(w, at(w, 0, 600).id, "של מרצה קודם.pptx", { speaker_id: 999 });
    const deleted = deck(w, null, "שיעור שנמחק.pptx");
    deleted.storage_path = `${w.edition.id}/77/00000000-0000-4000-9000-000000000777-deck.pptx`; // lesson_id null since the lesson was deleted
    opening.state = "draft";
    parallel.state = "cancelled";
    const out = orphanPresentations(w);
    expect(out.map((o) => [o.file.id, o.reason])).toEqual([
      [5, "draft"],
      [6, "cancelled"],
      [previous.id, "previous"],
      [deleted.id, "gone"],
    ]);
    expect(out.find((o) => o.reason === "gone")!.lesson).toBeNull();
    expect(weekPresentations(w).map((f) => f.id)).toEqual([7]); // a deleted lesson's deck is not the week's
  });
});

describe("the day's zip", () => {
  it("names: the week's decks first «0000_השבוע_…», then HHMM_<room>_<name> in the day's order; the bytes the rows say", () => {
    const w = week();
    const plan = dayZipPlan(w, 0, null);
    expect(plan.entries.map((e) => e.name)).toEqual(["0000_השבוע_המצגת המלווה לשבוע (לדוגמה).pdf", "0830_בית מדרש_מצגת לדוגמה.pdf"]);
    expect(plan.bytes).toBe(220_000 + 640_000);
    expect(plan.texts.map((t) => t.name)).toEqual([ORDER_FILE, LINKS_FILE]);
    const tuesday = dayZipPlan(w, 2, null);
    expect(tuesday.entries.map((e) => e.name)).toEqual(["0000_השבוע_המצגת המלווה לשבוע (לדוגמה).pdf", "1600_כיתת בית מדרש_שקפים לדוגמה.pdf"]);
    expect(tuesday.texts.map((t) => t.name)).toEqual([ORDER_FILE]); // no link-only row that day
    // one room: its files and the week's decks (they are every room's)
    expect(dayZipPlan(w, 2, 1).entries.map((e) => e.name)).toEqual(["0000_השבוע_המצגת המלווה לשבוע (לדוגמה).pdf"]);
    expect(dayZipPlan(w, 2, 2).entries.map((e) => e.file.id)).toEqual([7, 6]);
  });

  it("a night item's hour runs on (24–29) so the names sort as the day runs; a name twice gets its id before the extension; a name a file system refuses is cleaned", () => {
    expect([hhmm(390), hhmm(510), hhmm(1439), hhmm(1440), hhmm(1470), hhmm(1829)]).toEqual(["0630", "0830", "2359", "2400", "2430", "3029"]);
    const w = week();
    const night = at(w, 0, 1470);
    const a = deck(w, night.id, "שקפים.pptx");
    const b = deck(w, night.id, "שקפים.PPTX"); // the same name to a file system that ignores case
    const c = deck(w, at(w, 0, 690).id, 'א/ב:"ג".pptx');
    const plan = dayZipPlan(w, 0, null);
    const names = plan.entries.map((e) => e.name);
    expect(names).toEqual([
      "0000_השבוע_המצגת המלווה לשבוע (לדוגמה).pdf",
      "0830_בית מדרש_מצגת לדוגמה.pdf",
      "1130_בית מדרש_א_ב__ג_.pptx",
      "2430_בית מדרש_שקפים.pptx",
      `2430_בית מדרש_שקפים_${b.id}.pptx`, // the stored type's extension, whatever case the name typed
    ]);
    expect([...names].sort()).toEqual(names); // sorted by name = the day's order
    expect(plan.entries.map((e) => e.file.id)).toEqual([7, 5, c.id, a.id, b.id]);
  });

  it("a name ends in the STORED file's extension, never its own, and carries no control or bidi character (the review's disguised file)", () => {
    const w = week();
    const l = at(w, 0, 690).id;
    const rlo = deck(w, l, "שקפים\u202efdp.scr", { mime: "application/pdf" }); // shows as «…rcs.pdf» on Windows
    const exe = deck(w, l, "slides.pdf.exe", { mime: "application/pdf" });
    const bare = deck(w, l, "1000012345", { mime: "application/pdf" }); // a phone's picked file: a type, no extension
    const pptx = deck(w, l, "deck.pdf"); // PowerPoint bytes registered under a PDF's name
    const marks = deck(w, l, "\u0085a\u007f\u200f\u2066b\u2069.pdf", { mime: "application/pdf" });
    const names = new Map(dayZipPlan(w, 0, null).entries.map((e) => [e.file.id, e.name]));
    expect(names.get(rlo.id)).toBe("1130_בית מדרש_שקפים_fdp.pdf");
    expect(names.get(exe.id)).toBe("1130_בית מדרש_slides.pdf.pdf");
    expect(names.get(bare.id)).toBe("1130_בית מדרש_1000012345.pdf");
    expect(names.get(pptx.id)).toBe("1130_בית מדרש_deck.pptx");
    expect(names.get(marks.id)).toBe("1130_בית מדרש_a___b_.pdf");
    for (const n of names.values()) expect(n).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    // the order names the same entries
    expect(lines(dayZipPlan(w, 0, null).texts[0]).some((x) => x.includes("1130_בית מדרש_slides.pdf.pdf"))).toBe(true);
  });

  it("סדר-היום.txt: the day's head, the week's deck, every row's time, room, speaker · title and what to open — UTF-8 with a BOM, CRLF", () => {
    const w = week();
    const order = lines(dayZipPlan(w, 0, null).texts[0]);
    expect(order[0]).toBe("סדר היום — יום ראשון · TBD · הדגמה");
    expect(order[1]).toBe("המצגת של השבוע — 0000_השבוע_המצגת המלווה לשבוע (לדוגמה).pdf");
    expect(order[2]).toBe("");
    const entries = scheduleEntries(w).filter((e) => e.day === 0);
    const lesson = (start: number) => entries.find((e) => e.kind === "lesson" && e.start_min === start)!;
    const head = (start: number) => `${lesson(start).speaker} · ${lesson(start).title}`;
    expect(order).toContain(`08:30–09:45 · בית מדרש · ${head(510)} — 0830_בית מדרש_מצגת לדוגמה.pdf`);
    expect(order).toContain(`10:00–11:15 · בית מדרש · ${head(600)} — קישור: https://slides.example/presentation-demo`);
    expect(order).toContain(`11:30–12:45 · בית מדרש · ${head(690)} — בלי מצגת`);
    expect(order).toContain("13:00–13:15 · בית מדרש · זמן זיכרון"); // never a name
    expect(order).toHaveLength(3 + entries.length);
    const tuesday = lines(dayZipPlan(w, 2, null).texts[0]);
    expect(tuesday.some((x) => x.startsWith("16:00–17:15 · בית מדרש · ") && x.endsWith(" — מצגת צפויה — עוד לא הועלתה"))).toBe(true);
    // a date once the week has one, and the room when the zip is one room's
    w.edition.start_date = "2027-02-14";
    expect(lines(dayZipPlan(w, 2, 2).texts[0])[0]).toBe("סדר היום — יום שלישי · 16.2.2027 · הדגמה · כיתת בית מדרש");
  });

  it("a file the download could not fetch is named so in the order; links.txt has a line per link-only row: «HH:MM · speaker · URL»", () => {
    const w = week();
    const failed = lines(dayZipPlan(w, 0, null, new Set([5])).texts[0]);
    expect(failed.some((x) => x.endsWith("— 0830_בית מדרש_מצגת לדוגמה.pdf (לא ירדה — מורידים מדף המצגות)"))).toBe(true);
    const links = lines(dayZipPlan(w, 0, null).texts[1]);
    const speaker = scheduleEntries(w).find((e) => e.lesson_id === at(w, 0, 600).id)!.speaker;
    expect(links).toEqual(["קישורים למצגות — יום ראשון · TBD · הדגמה", "", `10:00 · ${speaker} · https://slides.example/presentation-demo`]);
    // a row with a file AND a link: the order says both, links.txt only the link-only rows
    deck(w, at(w, 0, 600).id, "גם קובץ.pdf", { mime: "application/pdf" });
    const both = dayZipPlan(w, 0, null);
    expect(both.texts.map((t) => t.name)).toEqual([ORDER_FILE]);
    expect(lines(both.texts[0]).some((x) => x.endsWith("— 1000_בית מדרש_גם קובץ.pdf / קישור: https://slides.example/presentation-demo"))).toBe(true);
  });

  it("an empty day: no entries but the week's, the order says so; the line before the download counts and sizes", () => {
    const w = week();
    w.lessons = w.lessons.filter((l) => l.day !== 4);
    const plan = dayZipPlan(w, 4, null);
    expect(plan.entries.map((e) => e.file.id)).toEqual([7]);
    expect(lines(plan.texts[0]).at(-1)).toBe("אין שיעורים סגורים ביום הזה.");
    expect(zipLine(plan)).toBe("מצגת אחת · כ-0.2 MB");
    expect(zipLine({ entries: [], bytes: 0 })).toMatch(/^עוד אין מצגות ליום הזה/);
    expect(zipLine(dayZipPlan(week(), 0, null))).toBe("2 מצגות · כ-0.8 MB");
    expect([megabytes(1), megabytes(5 * 1024 * 1024), megabytes(123.4 * 1024 * 1024)]).toEqual(["כ-0.1 MB", "כ-5 MB", "כ-123 MB"]);
  });
});

describe("this device's memory", () => {
  it("the privacy page says what the day's zip holds and where it goes, and what this device keeps of it (the review)", () => {
    const html = readFileSync(new URL("../../public/privacy.html", import.meta.url), "utf8");
    const zip = html.split("\n").find((l) => l.includes("«הורדת כל המצגות של היום»"))!;
    for (const w of ["נבנית בדפדפן", "סדר היום", "הקישורים למצגות", "למחשב של האולם, שלא מחובר לאתר", "באחריות מי שהוריד/ה"]) expect(zip, w).toContain(w);
    const kept = html.split("\n").find((l) => l.includes("דף «מצגות» זוכר במכשיר הזה"))!;
    for (const w of ["מתי ירד ה-zip", "איזה חדר נבחר", "בלי מידע אישי", "«התנתקות» לא מוחקת את זה"]) expect(kept, w).toContain(w);
    // the keys it speaks of
    expect(presentationsZipKey(1, 0)).toMatch(/^volozhin-presentations-zip:/);
    expect(presentationsRoomKey(1)).toMatch(/^volozhin-presentations-room:/);
  });

  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  const broken = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };

  it("the day's last zip: per edition and day; a missing, broken or edited value is none; a storage that throws forgets quietly", () => {
    const s = store();
    expect(presentationsZipKey(7, 2)).toBe("volozhin-presentations-zip:7:2");
    expect(readZipMarker(s, 7, 2)).toBeNull();
    writeZipMarker(s, 7, 2, { at: "2026-11-22T06:10:00Z", upTo: "2026-11-21T18:00:00Z", room: null });
    expect(readZipMarker(s, 7, 2)).toEqual({ at: "2026-11-22T06:10:00Z", upTo: "2026-11-21T18:00:00Z", room: null });
    expect(readZipMarker(s, 7, 3)).toBeNull();
    expect(readZipMarker(s, 8, 2)).toBeNull();
    s.m.set(presentationsZipKey(7, 1), "not json");
    expect(readZipMarker(s, 7, 1)).toBeNull();
    s.m.set(presentationsZipKey(7, 1), JSON.stringify({ at: "yesterday" }));
    expect(readZipMarker(s, 7, 1)).toBeNull();
    s.m.set(presentationsZipKey(7, 1), JSON.stringify({ at: "2026-11-22T06:10:00Z", upTo: 5, room: "3" }));
    expect(readZipMarker(s, 7, 1)).toEqual({ at: "2026-11-22T06:10:00Z", upTo: null, room: null });
    expect(readZipMarker(broken, 7, 2)).toBeNull();
    expect(() => writeZipMarker(broken, 7, 2, { at: "2026-11-22T06:10:00Z", upTo: null, room: 2 })).not.toThrow();
    expect(readZipMarker(null, 7, 2)).toBeNull();
  });

  it("the room chip: per edition; «all» and anything else is none", () => {
    const s = store();
    expect(presentationsRoomKey(7)).toBe("volozhin-presentations-room:7");
    expect(readRoom(s, 7)).toBeNull();
    writeRoom(s, 7, 3);
    expect(readRoom(s, 7)).toBe(3);
    writeRoom(s, 7, null);
    expect(s.m.get(presentationsRoomKey(7))).toBe("all");
    expect(readRoom(s, 7)).toBeNull();
    s.m.set(presentationsRoomKey(7), "-2");
    expect(readRoom(s, 7)).toBeNull();
    expect(readRoom(broken, 7)).toBeNull();
    expect(() => writeRoom(broken, 7, 1)).not.toThrow();
  });

  it("new since the download: by the server's clock (the newest upload the zip was planned from), none without a download, every file when there was none", () => {
    const files = [
      { id: 1, uploaded_at: "2026-11-21T18:00:00Z" },
      { id: 2, uploaded_at: "2026-11-22T07:30:00Z" },
      { id: 3, uploaded_at: "2026-11-22T06:00:00Z" },
    ];
    expect(newestUpload(files.slice(0, 1))).toBe("2026-11-21T18:00:00Z");
    expect(newestUpload([...files, { uploaded_at: "garbage" }])).toBe("2026-11-22T07:30:00Z");
    expect(newestUpload([])).toBeNull();
    expect(newSinceDownload(files, null)).toEqual(new Set());
    // the device's clock ran an hour ahead: its «at» says nothing about what came after
    const marker = { at: "2026-11-22T08:00:00Z", upTo: "2026-11-21T18:00:00Z", room: null };
    expect(newSinceDownload(files, marker)).toEqual(new Set([2, 3]));
    expect(newSinceDownload(files, { ...marker, upTo: null })).toEqual(new Set([1, 2, 3]));
  });

  it("the time it says: HH:MM in Israel today, the date as well on another day", () => {
    expect(markerTime("2026-11-22T06:10:00Z", "2026-11-22T12:00:00Z")).toBe("08:10");
    expect(markerTime("2026-11-21T06:10:00Z", "2026-11-22T12:00:00Z")).toBe("21.11, 08:10");
  });

  it("the day the page opens on: Israel's date when it is one of the five, else the first", () => {
    expect(presentationsDay(null, "2027-02-15T08:00:00Z")).toBe(0);
    expect(presentationsDay("2027-02-14", "2027-02-14T05:00:00Z")).toBe(0);
    expect(presentationsDay("2027-02-14", "2027-02-16T04:00:00Z")).toBe(2); // 06:00 in Israel: that day's, not the night before
    expect(presentationsDay("2027-02-14", "2027-02-18T21:30:00Z")).toBe(4); // 23:30 Thursday
    expect(presentationsDay("2027-02-14", "2027-02-10T08:00:00Z")).toBe(0);
    expect(presentationsDay("2027-02-14", "2027-02-20T08:00:00Z")).toBe(0);
  });
});
