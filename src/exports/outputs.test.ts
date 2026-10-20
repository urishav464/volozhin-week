// The outputs' content, from a Week: the tracking table (last year's columns,
// the stage colours, the filters, phones only when given), the escorts' list
// (grouped, gendered, the duty phrases), the designer's public schedule (no
// contact, no amount, no note; «במקביל»; memorial slots) and its diff, and the
// archive (personal data apart, and only what the caller's RLS showed).
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { demoWeek } from "../data/demoWeek";
import type { ArchiveExtras } from "../data/outputs";
import { addApproach, addLesson, addSpeaker, addTrainee, closeWith, emptyWeek, pitch } from "../testing/week";
import { archiveFiles, PERSONAL_FILE, touchedSpeakers } from "./archive";
import { fileName } from "./download";
import { type DesignerRow, designerRows, designerTable, diffCount, diffSchedules, readSnapshot } from "./designer";
import { escortGroups, introOf } from "./escorts";
import { LRM } from "./table";
import { filterTracking, israelDate, teachingWhen, TRACKING_HEADERS, trackingRows, trackingTable, whenCell } from "./tracking";

function week() {
  const w = emptyWeek();
  w.team = [
    { id: 1, display_name: "מדריך/ה לדוגמה", gender: null, role: "admin" },
    { id: 2, display_name: "חניך/ה לדוגמה", gender: null, role: "content" },
  ];
  const f = addSpeaker(w, "f", "פלונית לדוגמה");
  f.title = "ד״ר";
  const m = addSpeaker(w, "m", "פלוני לדוגמה");
  const cand = addSpeaker(w, "f", "מועמדת לדוגמה");
  addApproach(w, f, "positive");
  const am = addApproach(w, m, "positive");
  am.owner_member_id = 2;
  const ac = addApproach(w, cand);
  const escort = addTrainee(w, "מלווה לדוגמה", "f");
  const a = closeWith(w, addLesson(w, 0, 510, 600, { title: "שיעור א", category_id: 1, teach_min: 75, sources_kind: "sheet", print_when: "before", pay_amount: 1500, transport: "round_trip", approval: "approved", paid_at: "2026-11-12T10:00:00Z", confirm_sent_at: "2026-11-10T22:30:00Z", confirm_sent_by: 2, escort_roster_id: escort.id }), f);
  const b = closeWith(w, addLesson(w, 0, 960, 1050, { title: "שיעור ב", category_id: 2, room_id: 2, sources_kind: "presentation", approval: "pending", transport: "one_way", needs_reconfirm: true, confirm_sent_at: "2026-11-09T10:00:00Z", confirm_sent_by: 1, self_intro: true, escort_note: "הערה לדוגמה" }), m);
  const c = addLesson(w, 0, 960, 1050, { parallel_reason: "דוגמה" });
  pitch(w, c, ac);
  const memorial = addLesson(w, 0, 780, 795, { kind: "memorial", title: "זמן זיכרון" });
  const night = closeWith(w, addLesson(w, 1, 1470, 1560, { title: "שיעור לילה" }), cand);
  return { w, f, m, cand, escort, a, b, c, memorial, night };
}

describe("the tracking table", () => {
  it("has one row per lesson in grid order with last year's columns", () => {
    const { w, a, b, c, memorial, night } = week();
    const rows = trackingRows(w);
    expect(rows.map((r) => r.lesson.id)).toEqual([a.id, memorial.id, c.id, b.id, night.id]); // 16:00: room 1 (the draft) before room 2
    const [ra, rm, rc, rb, rn] = rows;
    expect([ra.speaker, whenCell(ra), ra.title, ra.category, ra.sources, ra.payment, ra.escort, ra.confirmed]).toEqual([
      "ד״ר פלונית לדוגמה", `ראשון ${LRM}08:30–09:45`, "שיעור א", "תנ\"ך", "דף מקורות · להדפיס מראש", "1,500 ₪ · הלוך ושוב · אושר · שולם", "מלווה לדוגמה", "חניך/ה לדוגמה · 11.11.2026",
    ]);
    // a request waiting, the speaker to be told again, self-introduction
    expect([rb.payment, rb.confirmed, rb.escort, rb.sources]).toEqual(["בלי תשלום · הלוך · ממתין לאישור המדריך/ה", "לעדכן (השיעור השתנה אחרי ההודעה)", "הצגה עצמית", "מצגת"]);
    expect([rc.speaker, rc.title, rc.payment]).toEqual(["טרם נסגר · מועמדים: מועמדת לדוגמה", "TBD", ""]);
    expect([rm.speaker, rm.title, rm.confirmed]).toEqual(["", "זמן זיכרון", ""]);
    expect([rn.dayLabel, rn.time, rn.confirmed, rn.escort, rn.payment]).toEqual(["ליל שני–שלישי", "00:30–01:45", "לעדכן", "חסר/ה", "לא התבקשו"]);
  });

  it("tints rows with last year's colours: sources received, a presentation, a memorial slot, not closed", () => {
    const { w } = week();
    expect(trackingRows(w).map((r) => r.tone)).toEqual(["received", "memorial", "draft", "presentation", "pending"]);
    expect(trackingTable(trackingRows(w), "בדיקה").fills).toEqual(["CFFAFE", "FEF3C7", "E8E2D6", "FFEDD5", null]);
  });

  it("filters by day, by what is still missing, and «שלי»", () => {
    const { w, a, b, c, night } = week();
    const rows = trackingRows(w);
    expect(filterTracking(rows, { day: 1, stage: null, mine: null }).map((r) => r.lesson.id)).toEqual([night.id]);
    expect(filterTracking(rows, { day: null, stage: "draft", mine: null }).map((r) => r.lesson.id)).toEqual([c.id]);
    expect(filterTracking(rows, { day: null, stage: "payment", mine: null }).map((r) => r.lesson.id)).toEqual([b.id]);
    expect(filterTracking(rows, { day: null, stage: "send", mine: null }).map((r) => r.lesson.id)).toEqual([night.id]);
    expect(filterTracking(rows, { day: null, stage: "ready", mine: null }).map((r) => r.lesson.id)).toEqual([a.id]);
    // member 2 handles the male speaker's lesson; member 1 the others and pitched the candidate
    expect(filterTracking(rows, { day: null, stage: null, mine: 2 }).map((r) => r.lesson.id)).toEqual([b.id]);
    expect(filterTracking(rows, { day: null, stage: null, mine: 1 }).map((r) => r.lesson.id)).toEqual([a.id, c.id, night.id]);
  });

  it("adds a phone column only when phones are given, and only those phones", () => {
    const { w, a } = week();
    const rows = trackingRows(w);
    expect(trackingTable(rows, "בדיקה").headers).toEqual([...TRACKING_HEADERS]);
    const t = trackingTable(rows, "בדיקה", new Map([[a.id, "טלפון לדוגמה"]]));
    expect(t.headers.slice(0, 3)).toEqual(["מרצה", "טלפון", "יום ושעה"]);
    expect(t.rows.map((r) => r[1])).toEqual(["טלפון לדוגמה", "", "", "", ""]);
    expect(t.landscape).toBe(true);
  });

  it("writes the date a message went out in Israel's calendar, and the teaching time by the settings", () => {
    expect(israelDate("2026-11-10T22:30:00Z")).toBe("11.11.2026"); // after midnight in Jerusalem
    expect(teachingWhen({ day: 0, start_min: 510, end_min: 600, teach_min: null }, 60)).toEqual({ dayLabel: "ראשון", time: "08:30–09:30" });
    expect(teachingWhen({ day: 2, start_min: 1350, end_min: 1440, teach_min: null })).toEqual({ dayLabel: "שלישי", time: "22:30–23:45" });
    // in a file's right-to-left cell the range keeps its order: a LEFT-TO-RIGHT MARK before it
    expect(whenCell({ dayLabel: "שלישי", time: "22:30–23:45" })).toBe("שלישי \u200E22:30–23:45");
  });

  it("has a row for every lesson of the demo, and the demo's phones only where given", () => {
    const w = demoWeek();
    const rows = trackingRows(w);
    expect(rows).toHaveLength(w.lessons.filter((l) => l.state !== "cancelled").length);
    expect(new Set(rows.map((r) => r.tone))).toEqual(new Set(["received", "presentation", "pending", "none", "draft", "memorial"]));
  });
});

describe("the escorts' list", () => {
  it("groups closed lessons by escort, in the escort's gender, with who introduces the speaker and the duty notes", () => {
    const { w, a, b, night, escort } = week();
    w.edition.settings.duty_phrases = [
      { when: "always", text: "ניסוח לדוגמה לכל שיעור" },
      { when: "self_intro", text: "ניסוח לדוגמה להצגה עצמית" },
      { when: "transport", text: "ניסוח לדוגמה להסעה" },
    ];
    const groups = escortGroups(w);
    expect(groups.map((g) => [g.heading, g.load])).toEqual([
      ["מלווה לדוגמה", "היא מלווה שיעור אחד"],
      ["עוד בלי מלווה", "2 שיעורים סגורים בלי מלווה"],
    ]);
    expect(groups[0].escort?.id).toBe(escort.id);
    const [la] = groups[0].lessons;
    expect([la.lesson.id, `${la.dayLabel} ${la.time}`, la.room, la.speaker, la.title, la.intro, la.introDetail]).toEqual([
      a.id, "ראשון 08:30–09:45", "בית מדרש", "ד״ר פלונית לדוגמה", "שיעור א", "הצגה על ידי המלווה", "מציגה את המרצה",
    ]);
    expect(la.notes).toEqual(["ניסוח לדוגמה לכל שיעור", "ניסוח לדוגמה להסעה"]);
    const [lb, ln] = groups[1].lessons;
    expect([lb.lesson.id, lb.intro, lb.introDetail]).toEqual([b.id, "הצגה עצמית", "המרצה מציג את עצמו"]);
    expect(lb.notes).toEqual(["ניסוח לדוגמה לכל שיעור", "ניסוח לדוגמה להצגה עצמית", "הערה לדוגמה"]); // the request waits: no transport phrase
    expect(ln.lesson.id).toBe(night.id);
  });

  it("speaks in each one's gender, and slashes while it is unknown", () => {
    expect(introOf(true, "f", null).detail).toBe("המרצה מציגה את עצמה");
    expect(introOf(true, null, null).detail).toBe("המרצה מציג/ה את עצמו/ה");
    expect(introOf(false, "m", "m").detail).toBe("מציג את המרצה");
    expect(introOf(false, "m", null).detail).toBe("מציג/ה את המרצה");
    const w = emptyWeek();
    const r = addTrainee(w, "מלווה ב", "m");
    closeWith(w, addLesson(w, 0, 510, 600, { escort_roster_id: r.id }), addSpeaker(w, "f"));
    closeWith(w, addLesson(w, 1, 510, 600, { escort_roster_id: r.id }), addSpeaker(w, "f"));
    expect(escortGroups(w)[0].load).toBe("הוא מלווה 2 שיעורים");
  });
});

describe("the designer's export", () => {
  it("is the public schedule only: closed lessons and memorial slots, «במקביל», the date or TBD — nothing else", () => {
    const { w, a, b, memorial, night } = week();
    const rows = designerRows(w);
    expect(rows.map((r) => r.lesson_id)).toEqual([a.id, memorial.id, b.id, night.id]); // the draft is not public
    expect(rows[0]).toEqual({
      lesson_id: a.id, kind: "lesson", day: "ראשון", date: "14.2.2027 (ז׳ באדר א׳ תשפ״ז)", time: "08:30–09:45", speaker: "ד״ר פלונית לדוגמה",
      title: "שיעור א", category: "תנ\"ך", room: "בית מדרש", parallel: false,
    });
    expect(rows[1]).toMatchObject({ kind: "memorial", time: "13:00–13:15", title: "זמן זיכרון", speaker: "", parallel: false });
    expect(rows[2]).toMatchObject({ room: "כיתה", parallel: false }); // its parallel cell is still a draft
    expect(rows[3]).toMatchObject({ day: "שני", date: "15.2.2027 (ח׳ באדר א׳ תשפ״ז)", time: "00:30–01:45" });
    w.edition.start_date = null;
    expect(designerRows(w)[0].date).toBe("TBD");
  });

  it("marks lessons that run side by side", () => {
    const { w, c, cand } = week();
    closeWith(w, c, cand);
    const rows = designerRows(w);
    expect(rows.filter((r) => r.parallel).map((r) => r.lesson_id).sort()).toEqual([c.id, w.lessons.find((l) => l.title === "שיעור ב")!.id].sort());
  });

  it("never carries a contact, an amount or a note — not even in the demo", () => {
    const rows = designerRows(demoWeek());
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["category", "date", "day", "kind", "lesson_id", "parallel", "room", "speaker", "time", "title"]);
    const text = JSON.stringify(rows);
    for (const secret of ["לדוגמה: לבדוק שוב", "₪", "טלפון", "@", "להגיע רבע שעה"]) expect(text).not.toContain(secret);
    const t = designerTable(rows, "הדגמה");
    expect(t.headers).toEqual(["סוג", "יום", "תאריך", "שעה", "מרצה", "כותרת", "קטגוריה", "חדר", "במקביל"]);
    expect(t.rows.find((r) => r[0] === "זמן זיכרון")).toBeTruthy();
    expect(t.rows.filter((r) => r[8] === "במקביל")).toHaveLength(2); // the demo's Tuesday pair
  });

  it("says what changed since the last export: added, removed, and changed fields", () => {
    const row = (id: number, extra: Partial<DesignerRow> = {}): DesignerRow => ({
      lesson_id: id, kind: "lesson", day: "ראשון", date: "TBD", time: "08:30–09:45", speaker: "מרצה", title: "כותרת", category: "", room: "בית מדרש", parallel: false, ...extra,
    });
    const before = [row(1), row(2), row(3)];
    const after = [row(1), row(2, { title: "כותרת חדשה", time: "10:00–11:15" }), row(4)];
    const d = diffSchedules(before, after);
    expect(d.added.map((r) => r.lesson_id)).toEqual([4]);
    expect(d.removed.map((r) => r.lesson_id)).toEqual([3]);
    expect(d.changed.map((c) => [c.after.lesson_id, c.fields])).toEqual([[2, ["time", "title"]]]);
    expect(d.changed[0].before.title).toBe("כותרת");
    expect(diffCount(d)).toBe(3);
    expect(diffCount(diffSchedules(after, after))).toBe(0);
    expect(diffSchedules([], after).added).toHaveLength(3);
    // a parallel mark that appears is a change too
    expect(diffSchedules([row(1)], [row(1, { parallel: true })]).changed[0].fields).toEqual(["parallel"]);
  });

  it("reads a snapshot back as rows, whatever junk a hand edit left", () => {
    expect(readSnapshot([{ lesson_id: "5", kind: "memorial", day: "ראשון", parallel: true }, null, 3])).toEqual([
      { lesson_id: 5, kind: "memorial", day: "ראשון", date: "", time: "", speaker: "", title: "", category: "", room: "", parallel: true },
    ]);
    expect(readSnapshot({ rows: [] })).toEqual([]);
  });
});

describe("the archive", () => {
  const extras = (over: Partial<ArchiveExtras> = {}): ArchiveExtras => ({ activity: [], contacts: [], transport: [], notes: [], milestones: [], snapshots: [], ...over });

  it("holds the edition, the speakers it touched and the tracking table — personal data only in its own, plainly named file", () => {
    const { w, f, m, cand, a } = week();
    const other = addSpeaker(w, "m", "לא נגעו בו");
    const files = archiveFiles({
      week: w,
      schemaVersion: 8,
      exportedAt: "2026-11-20T10:00:00.000Z",
      extras: extras({
        contacts: [{ speaker_id: f.id, phone: "טלפון לדוגמה", email: "speaker@example.org", secretary_note: null, notes: null }],
        transport: [{ lesson_id: a.id, pickup_address: "כתובת לדוגמה", pickup_time: null, driver_name: null, driver_phone: null, arranged: false }],
      }),
    });
    expect(Object.keys(files).sort()).toEqual(["README.txt", "edition.json", PERSONAL_FILE, "speakers.json", "tracking.xlsx"].sort());
    const json = (n: string) => JSON.parse(strFromU8(files[n]));
    expect(json("speakers.json").speakers.map((s: { id: number }) => s.id).sort()).toEqual([f.id, m.id, cand.id].sort());
    expect(touchedSpeakers(w)).not.toContain(other.id);
    const edition = json("edition.json");
    expect(edition).toMatchObject({ format: "volozhin-week-archive", schema_version: 8, edition: { label: "בדיקה" } });
    expect(edition.lessons).toHaveLength(w.lessons.length);
    expect(Object.keys(edition.team[0]).sort()).toEqual(["display_name", "gender", "id", "role"]);
    // the personal data is nowhere but its own file
    for (const n of ["edition.json", "speakers.json", "README.txt"]) {
      expect(strFromU8(files[n]), n).not.toContain("טלפון לדוגמה");
      expect(strFromU8(files[n]), n).not.toContain("כתובת לדוגמה");
    }
    expect(json(PERSONAL_FILE)).toMatchObject({ speaker_contacts: [{ speaker: "ד״ר פלונית לדוגמה", phone: "טלפון לדוגמה" }], transport_details: [{ pickup_address: "כתובת לדוגמה" }] });
    expect(strFromU8(files["README.txt"])).toContain("הארכיון כולל מידע אישי");
    // the tracking table inside is a real xlsx, without phones
    const sheet = strFromU8(unzipSync(files["tracking.xlsx"])["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain('rightToLeft="1"');
    expect(sheet).not.toContain("טלפון");
  });

  it("has no personal-data file when the caller's RLS showed none, and says so", () => {
    const { w } = week();
    const files = archiveFiles({ week: w, schemaVersion: 8, exportedAt: "2026-11-20T10:00:00.000Z", extras: extras({ contacts: [{ speaker_id: 1, phone: null, email: null, secretary_note: null, notes: null }] }) });
    expect(files[PERSONAL_FILE]).toBeUndefined();
    expect(strFromU8(files["README.txt"])).toContain("אין בקובץ הזה פרטי קשר או פרטי הסעה");
  });

  it("is named so every system accepts it: ASCII only", () => {
    expect(fileName("archive", { id: 7, label: 'תשפ"ז' }, "2026-11-20", "zip")).toBe("volozhin-archive-edition-7-2026-11-20.zip");
    expect(fileName("tracking", { id: 7, label: "practice-2027" }, "2026-11-20", "csv")).toBe("volozhin-tracking-practice-2027-2026-11-20.csv");
    expect(fileName("x", { id: 1, label: "a/b" }, "d", "csv")).toBe("volozhin-x-edition-1-d.csv");
  });
});
