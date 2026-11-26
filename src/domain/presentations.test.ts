// «מצגות» (the reset, phase 5; v20 the week's zip): the rows and their states on the demo week (every state shows there),
// the week's decks and the presentations left without a lesson, the week's zip plan — a folder per day, the week's decks
// once, every lesson file's path starting with the entryPrefix the escort's page is told, the day's two text files, the
// parts when it is too big — and this device's memory of the last download (ids and fingerprints; a storage that throws
// forgets, never breaks the page).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { demoWeek, seedDemoPresentations, seedDemoSources } from "../data/demoWeek";
import { scheduleEntries } from "../exports/designer";
import {
  dayFolder, dayZipPlan, decksZipPlan, entryPrefix, hhmm, LINKS_FILE, lessonPresentations, markerTime, megabytes, nameFingerprint, ORDER_FILE, orphanPresentations, presentationEntries,
  presentationRows, presentationsZipKey, readZipMarker, sinceDownload, splitEntry, WEEK_FOLDER, weekPresentations, weekZipPlan, writeZipMarker, zipLine, zipMarker,
} from "./presentations";
import { DAYS, fmt } from "./time";
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


/** The room's name of a lesson — as escort_view gives it (rm.name). */
const roomOf = (w: Week, l: { room_id: number }) => w.rooms.find((r) => r.id === l.room_id)!.name;

describe("the week's zip (v20): a folder per day, the week's decks once", () => {
  it("paths: «0-השבוע/<name>» for the week's decks, «<n>-<day>/HHMM_<room>_<name>» for a lesson's; the bytes the rows say; a day's order in every folder", () => {
    const w = week();
    const plan = weekZipPlan(w);
    expect(plan.entries.map((e) => e.name)).toEqual([
      `${WEEK_FOLDER}/המצגת המלווה לשבוע (לדוגמה).pdf`,
      "1-ראשון/0830_בית מדרש_מצגת לדוגמה.pdf",
      "3-שלישי/1600_כיתת בית מדרש_שקפים לדוגמה.pdf",
    ]);
    expect(plan.bytes).toBe(220_000 + 640_000 + 410_000);
    // an order in each of the five folders, links.txt only where a lesson has a link and no file (Sunday's)
    expect(plan.texts.map((t) => t.name)).toEqual([
      `1-ראשון/${ORDER_FILE}`, `1-ראשון/${LINKS_FILE}`, `2-שני/${ORDER_FILE}`, `3-שלישי/${ORDER_FILE}`, `4-רביעי/${ORDER_FILE}`, `5-חמישי/${ORDER_FILE}`,
    ]);
    expect(DAYS.map(dayFolder)).toEqual(["1-ראשון", "2-שני", "3-שלישי", "4-רביעי", "5-חמישי"]);
    // the one naming: every file of the zip, once, by its id
    expect([...presentationEntries(w)]).toEqual(plan.entries.map((e) => [e.file.id, e.name]));
  });

  it("every lesson file's path starts with its lesson's entryPrefix (day, start, room — what the escort's page has); the week's decks are in the zip once", () => {
    const w = week();
    // more of everything: two decks of the week, a night lesson's two files, a lesson in the second room, names twice
    deck(w, null, "פתיח.pdf", { mime: "application/pdf" });
    deck(w, null, "פתיח.PDF", { mime: "application/pdf" });
    for (const l of w.lessons.filter((x) => x.kind === "lesson" && x.state === "closed")) deck(w, l.id, "שקפים.pptx");
    const night = at(w, 0, 1470);
    deck(w, night.id, "שקפים.pptx");
    const plan = weekZipPlan(w);
    const lessons = new Map(w.lessons.map((l) => [l.id, l]));
    const ids = plan.entries.map((e) => e.file.id);
    expect(new Set(ids).size).toBe(ids.length); // a file once
    expect(new Set(plan.entries.map((e) => e.name.toLowerCase())).size).toBe(ids.length); // a path once
    const decks = plan.entries.filter((e) => e.file.lesson_id == null);
    expect(decks.map((e) => e.file.id).sort((a, b) => a - b)).toEqual(weekPresentations(w).map((f) => f.id));
    for (const e of decks) expect(e.name.startsWith(`${WEEK_FOLDER}/`)).toBe(true);
    for (const day of DAYS) expect(dayZipPlan(w, day).entries.some((e) => e.file.lesson_id == null)).toBe(false); // never in a day's folder
    const lessonEntries = plan.entries.filter((e) => e.file.lesson_id != null);
    expect(lessonEntries.length).toBeGreaterThan(20);
    for (const e of lessonEntries) {
      const l = lessons.get(e.file.lesson_id!)!;
      expect(e.name.startsWith(entryPrefix(l.day, l.start_min, roomOf(w, l))), e.name).toBe(true);
    }
    // a night lesson is in its day column's folder — the day before the calendar's — at its hour 24–29
    expect(lessonEntries.filter((e) => e.file.lesson_id === night.id).map((e) => e.name)).toEqual(["1-ראשון/2430_בית מדרש_שקפים.pptx", `1-ראשון/2430_בית מדרש_שקפים_${nextId}.pptx`]);
    // in each folder, sorted by name = the day's order
    for (const day of DAYS) {
      const names = dayZipPlan(w, day).entries.map((e) => e.name);
      expect([...names].sort(), dayFolder(day)).toEqual(names);
    }
    // the second deck of the same name to a file system that ignores case gets its id
    expect(decks.map((e) => e.name)).toContain(`${WEEK_FOLDER}/פתיח_${decks.at(-1)!.file.id}.pdf`);
  });

  it("entryPrefix: the day's folder, HHMM (a night hour 24–29) and the room made safe; no room, «חדר»", () => {
    expect([hhmm(390), hhmm(510), hhmm(1439), hhmm(1440), hhmm(1470), hhmm(1829)]).toEqual(["0630", "0830", "2359", "2400", "2430", "3029"]);
    expect(entryPrefix(1, 630, "בית מדרש")).toBe("2-שני/1030_בית מדרש_");
    expect(entryPrefix(0, 1470, "בית מדרש")).toBe("1-ראשון/2430_בית מדרש_");
    expect(entryPrefix(4, 510, 'א/ב:"ג"')).toBe("5-חמישי/0830_א_ב__ג__"); // the room's own last «"» made safe, then the separator
    expect(entryPrefix(2, 600, "")).toBe("3-שלישי/1000_חדר_");
    expect(splitEntry("2-שני/1030_בית מדרש_x.pdf")).toEqual({ folder: "2-שני", name: "1030_בית מדרש_x.pdf" });
    expect(splitEntry("x.pdf")).toEqual({ folder: "", name: "x.pdf" });
  });

  it("a lesson moved or a room renamed: its files' paths change with it (what «שיעור זז מאז ההורדה» compares)", () => {
    const w = week();
    const opening = at(w, 0, 510);
    const before = presentationEntries(w).get(5);
    expect(before).toBe("1-ראשון/0830_בית מדרש_מצגת לדוגמה.pdf");
    opening.day = 1;
    opening.start_min = 630;
    expect(presentationEntries(w).get(5)).toBe("2-שני/1030_בית מדרש_מצגת לדוגמה.pdf");
    w.rooms.find((r) => r.id === opening.room_id)!.name = "אולם";
    expect(presentationEntries(w).get(5)).toBe("2-שני/1030_אולם_מצגת לדוגמה.pdf");
    expect(presentationEntries(w).get(7)).toBe(`${WEEK_FOLDER}/המצגת המלווה לשבוע (לדוגמה).pdf`); // the decks stay where they are
  });

  it("a name ends in the STORED file's extension, never its own, and carries no control or bidi character (the review's disguised file)", () => {
    const w = week();
    const l = at(w, 0, 690).id;
    const rlo = deck(w, l, "שקפים‮fdp.scr", { mime: "application/pdf" }); // shows as «…rcs.pdf» on Windows
    const exe = deck(w, l, "slides.pdf.exe", { mime: "application/pdf" });
    const bare = deck(w, l, "1000012345", { mime: "application/pdf" }); // a phone's picked file: a type, no extension
    const pptx = deck(w, l, "deck.pdf"); // PowerPoint bytes registered under a PDF's name
    const marks = deck(w, l, "\u0085a\u007f‏⁦b⁩.pdf", { mime: "application/pdf" });
    const names = presentationEntries(w);
    expect(names.get(rlo.id)).toBe("1-ראשון/1130_בית מדרש_שקפים_fdp.pdf");
    expect(names.get(exe.id)).toBe("1-ראשון/1130_בית מדרש_slides.pdf.pdf");
    expect(names.get(bare.id)).toBe("1-ראשון/1130_בית מדרש_1000012345.pdf");
    expect(names.get(pptx.id)).toBe("1-ראשון/1130_בית מדרש_deck.pptx");
    expect(names.get(marks.id)).toBe("1-ראשון/1130_בית מדרש_a___b_.pdf");
    for (const n of names.values()) expect(n).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    // the order names the same entries, in its own folder
    expect(lines(weekZipPlan(w).texts[0]).some((x) => x.endsWith("— 1130_בית מדרש_שקפים_fdp.pdf / 1130_בית מדרש_slides.pdf.pdf / 1130_בית מדרש_1000012345.pdf / 1130_בית מדרש_deck.pptx / 1130_בית מדרש_a___b_.pdf"))).toBe(true);
  });

  it("סדר-היום.txt in each folder: the day's head, where the week's deck is, every row's time (a night's «ליל ראשון–שני»), room, speaker · title and what to open — UTF-8 with a BOM, CRLF", () => {
    const w = week();
    const night = at(w, 0, 1470);
    const nightDeck = deck(w, night.id, "לילה.pptx");
    const text = (name: string) => weekZipPlan(w).texts.find((t) => t.name === name)!;
    const order = lines(text(`1-ראשון/${ORDER_FILE}`));
    expect(order[0]).toBe("סדר היום — יום ראשון · TBD · הדגמה");
    expect(order[1]).toBe(`המצגת של השבוע — ${WEEK_FOLDER}/המצגת המלווה לשבוע (לדוגמה).pdf`);
    expect(order[2]).toBe("");
    const entries = scheduleEntries(w).filter((e) => e.day === 0);
    const lesson = (start: number) => entries.find((e) => e.kind === "lesson" && e.start_min === start)!;
    const head = (start: number) => `${lesson(start).speaker} · ${lesson(start).title}`;
    expect(order).toContain(`08:30–09:45 · בית מדרש · ${head(510)} — 0830_בית מדרש_מצגת לדוגמה.pdf`);
    expect(order).toContain(`10:00–11:15 · בית מדרש · ${head(600)} — קישור: https://slides.example/presentation-demo`);
    expect(order).toContain(`11:30–12:45 · בית מדרש · ${head(690)} — בלי מצגת`);
    expect(order).toContain("13:00–13:15 · בית מדרש · זמן זיכרון"); // never a name
    const n = lesson(1470);
    expect(order).toContain(`${[`00:30–${fmt(n.end_min)}`, "ליל ראשון–שני", "בית מדרש", head(1470)].join(" · ")} — 2430_בית מדרש_${nightDeck.display_name}`);
    expect(order).toHaveLength(3 + entries.length);
    const tuesday = lines(text(`3-שלישי/${ORDER_FILE}`));
    expect(tuesday.some((x) => x.startsWith("16:00–17:15 · בית מדרש · ") && x.endsWith(" — מצגת צפויה — עוד לא הועלתה"))).toBe(true);
    expect(tuesday.some((x) => x.startsWith("16:00–17:15 · כיתת בית מדרש · ") && x.endsWith(" — 1600_כיתת בית מדרש_שקפים לדוגמה.pdf"))).toBe(true);
    // a date once the week has one
    w.edition.start_date = "2027-02-14";
    expect(lines(text(`3-שלישי/${ORDER_FILE}`))[0]).toBe("סדר היום — יום שלישי · 16.2.2027 · הדגמה");
  });

  it("a file the download could not fetch is named so in its day's order; links.txt has a line per link-only row: «HH:MM · speaker · URL»", () => {
    const w = week();
    const failed = lines(weekZipPlan(w, new Set([5])).texts[0]);
    expect(failed.some((x) => x.endsWith("— 0830_בית מדרש_מצגת לדוגמה.pdf (לא ירדה — מורידים מדף המצגות)"))).toBe(true);
    expect(lines(weekZipPlan(w, new Set([7])).texts[0])[1]).toBe(`המצגת של השבוע — ${WEEK_FOLDER}/המצגת המלווה לשבוע (לדוגמה).pdf (לא ירדה — מורידים מדף המצגות)`);
    const links = lines(weekZipPlan(w).texts.find((t) => t.name === `1-ראשון/${LINKS_FILE}`)!);
    const speaker = scheduleEntries(w).find((e) => e.lesson_id === at(w, 0, 600).id)!.speaker;
    expect(links).toEqual(["קישורים למצגות — יום ראשון · TBD · הדגמה", "", `10:00 · ${speaker} · https://slides.example/presentation-demo`]);
    // a row with a file AND a link: the order says both, links.txt only the link-only rows
    deck(w, at(w, 0, 600).id, "גם קובץ.pdf", { mime: "application/pdf" });
    const both = weekZipPlan(w);
    expect(both.texts.some((t) => t.name.endsWith(LINKS_FILE))).toBe(false);
    expect(lines(both.texts[0]).some((x) => x.endsWith("— 1000_בית מדרש_גם קובץ.pdf / קישור: https://slides.example/presentation-demo"))).toBe(true);
  });

  it("an empty day: its folder holds its order alone, which says so; the line before the download counts and sizes", () => {
    const w = week();
    w.lessons = w.lessons.filter((l) => l.day !== 4);
    const thursday = dayZipPlan(w, 4);
    expect(thursday.entries).toEqual([]);
    expect(thursday.texts.map((t) => t.name)).toEqual([`5-חמישי/${ORDER_FILE}`]);
    expect(lines(thursday.texts[0]).at(-1)).toBe("אין שיעורים סגורים ביום הזה.");
    expect(zipLine(thursday, "day")).toBe("עוד אין מצגות ליום הזה — בקובץ רק סדר היום");
    expect(zipLine({ entries: [], bytes: 0 })).toBe("עוד אין מצגות — בקובץ רק סדר היום של כל יום");
    expect(zipLine(weekZipPlan(week()))).toBe("3 מצגות · כ-1.2 MB");
    expect(zipLine(decksZipPlan(week()))).toBe("מצגת אחת · כ-0.2 MB");
    expect([megabytes(1), megabytes(5 * 1024 * 1024), megabytes(123.4 * 1024 * 1024)]).toEqual(["כ-0.1 MB", "כ-5 MB", "כ-123 MB"]);
  });

  it("the parts (the week too big for one file): the decks and each day under the week's own paths — together, the week's zip", () => {
    const w = week();
    const plan = weekZipPlan(w);
    const parts = [decksZipPlan(w), ...DAYS.map((d) => dayZipPlan(w, d))];
    expect(parts.flatMap((p) => p.entries)).toEqual(plan.entries);
    expect(parts.flatMap((p) => p.texts)).toEqual(plan.texts);
    expect(parts.reduce((n, p) => n + p.bytes, 0)).toBe(plan.bytes);
    expect(decksZipPlan(w).texts).toEqual([]);
    expect(dayZipPlan(w, 2, new Set([6])).texts[0].text).toContain("(לא ירדה — מורידים מדף המצגות)");
  });
});

describe("this device's memory (v20: the week's download)", () => {
  it("the privacy page says what the week's zip holds and where it goes, and what this device keeps of it (the review)", () => {
    const html = readFileSync(new URL("../../public/privacy.html", import.meta.url), "utf8");
    const zip = html.split("\n").find((l) => l.includes("«הורדת כל המצגות של השבוע»"))!;
    for (const w of ["נבנית בדפדפן", "תיקייה לכל יום", "סדר היום", "הקישורים למצגות", "0-השבוע", "למחשב של האולם, שלא מחובר לאתר", "באחריות מי שהוריד/ה"]) expect(zip, w).toContain(w);
    const kept = html.split("\n").find((l) => l.includes("דף «מצגות» זוכר במכשיר הזה"))!;
    for (const w of ["מתי ירד ה-zip של השבוע", "מספרים בלבד", "בלי שמות", "«התנתקות» לא מוחקת את זה"]) expect(kept, w).toContain(w);
    expect(presentationsZipKey(1)).toMatch(/^volozhin-presentations-zip:/); // the key it speaks of
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

  it("the week's last zip: per edition (a new key — the per-day keys of before are never read); numbers only; a missing, broken or edited value is none; a storage that throws forgets quietly", () => {
    const s = store();
    expect(presentationsZipKey(7)).toBe("volozhin-presentations-zip:7:week");
    expect(readZipMarker(s, 7)).toBeNull();
    s.m.set("volozhin-presentations-zip:7:2", JSON.stringify({ at: "2026-11-22T06:10:00Z", upTo: null, room: null })); // v19's day marker
    expect(readZipMarker(s, 7)).toBeNull();
    const m = zipMarker("2026-11-22T06:10:00Z", weekZipPlan(week()).entries);
    writeZipMarker(s, 7, m);
    expect(readZipMarker(s, 7)).toEqual(m);
    expect(Object.keys(m.names)).toEqual(["5", "6", "7"]);
    expect(s.m.get(presentationsZipKey(7))).not.toMatch(/[֐-׿]/); // no name, no Hebrew: ids and fingerprints
    expect(readZipMarker(s, 8)).toBeNull();
    s.m.set(presentationsZipKey(7), "not json");
    expect(readZipMarker(s, 7)).toBeNull();
    s.m.set(presentationsZipKey(7), JSON.stringify({ at: "yesterday", names: {} }));
    expect(readZipMarker(s, 7)).toBeNull();
    s.m.set(presentationsZipKey(7), JSON.stringify({ at: "2026-11-22T06:10:00Z" }));
    expect(readZipMarker(s, 7)).toBeNull(); // the day's shape, or none: not a marker of the week
    s.m.set(presentationsZipKey(7), JSON.stringify({ at: "2026-11-22T06:10:00Z", names: { 5: 12, x: 1, 6: "3", 7: -1, 8: 1.5, 9: 2 ** 32 } }));
    expect(readZipMarker(s, 7)).toEqual({ at: "2026-11-22T06:10:00Z", names: { 5: 12 } });
    expect(readZipMarker(broken, 7)).toBeNull();
    expect(() => writeZipMarker(broken, 7, m)).not.toThrow();
    expect(readZipMarker(null, 7)).toBeNull();
  });

  it("since the download: a file it did not hold is fresh (uploaded after, or did not come), a path changed since is moved; nothing without a marker", () => {
    const w = week();
    const plan = weekZipPlan(w);
    expect(sinceDownload(presentationEntries(w), null)).toEqual({ fresh: [], moved: [] });
    // the download: every file but #6 came
    const m = zipMarker("2026-11-22T06:10:00Z", plan.entries.filter((e) => e.file.id !== 6));
    expect(sinceDownload(presentationEntries(w), m)).toEqual({ fresh: [6], moved: [] });
    // an upload after it, then the lesson moved
    const later = deck(w, at(w, 0, 690).id, "חדש.pdf", { mime: "application/pdf" });
    const opening = at(w, 0, 510);
    opening.start_min = 1470 + 60;
    expect(sinceDownload(presentationEntries(w), m)).toEqual({ fresh: [later.id, 6], moved: [5] }); // in the zip's order: Sunday's, then Tuesday's
    // a part downloaded later adds to the device's marker; the whole week replaces it
    const tuesday = zipMarker("2026-11-22T07:00:00Z", dayZipPlan(w, 2).entries, m);
    expect(tuesday.names["5"]).toBe(m.names["5"]);
    expect(sinceDownload(presentationEntries(w), tuesday)).toEqual({ fresh: [later.id], moved: [5] });
    const again = zipMarker("2026-11-22T08:00:00Z", weekZipPlan(w).entries);
    expect(sinceDownload(presentationEntries(w), again)).toEqual({ fresh: [], moved: [] });
    // a room renamed moves every file in it
    w.rooms.find((r) => r.id === 2)!.name = "כיתה";
    expect(sinceDownload(presentationEntries(w), again)).toEqual({ fresh: [], moved: [6] });
  });

  it("the fingerprint: the same path the same number, another path another; 32 bits", () => {
    const a = nameFingerprint("1-ראשון/0830_בית מדרש_מצגת לדוגמה.pdf");
    expect(nameFingerprint("1-ראשון/0830_בית מדרש_מצגת לדוגמה.pdf")).toBe(a);
    expect(nameFingerprint("1-ראשון/0830_אולם_מצגת לדוגמה.pdf")).not.toBe(a);
    expect(nameFingerprint("2-שני/0830_בית מדרש_מצגת לדוגמה.pdf")).not.toBe(a);
    for (const n of [a, nameFingerprint(""), nameFingerprint("x".repeat(500))]) expect(Number.isInteger(n) && n >= 0 && n <= 0xffffffff).toBe(true);
  });

  it("the time it says: HH:MM in Israel today, the date as well on another day", () => {
    expect(markerTime("2026-11-22T06:10:00Z", "2026-11-22T12:00:00Z")).toBe("08:10");
    expect(markerTime("2026-11-21T06:10:00Z", "2026-11-22T12:00:00Z")).toBe("21.11, 08:10");
  });
});
