// The archive's 5ב-2 additions: מכריכה לכריכה (with the trainees' names), the book orders, the escorts' ticks, the
// sources' list, the memorial plans and the fallen — the families' contact persons only in the personal-data file;
// and «כולל קבצי המקורות»: each file in its day's folder, a file that could not be read named (README, sources.json),
// never silently missing; a cancel stops it. Read through the port as the panel reads it (the demo).
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { DataPort } from "../data/port";
import { DemoPort } from "../data/demoPort";
import { demoWeek } from "../data/demoWeek";
import type { KkData } from "../data/kk";
import type { ArchiveExtras } from "../data/outputs";
import type { SourceFile, Week } from "../domain/types";
import { type ArchiveMore, archiveFiles, archiveZip, PERSONAL_FILE, safeEntryName, sourcePath, sourcesSize, touchedSpeakers } from "./archive";
import { fetchSources, gatherArchive } from "./archiveGather";

const extras: ArchiveExtras = { activity: [], contacts: [], transport: [], notes: [], milestones: [], snapshots: [] };
const AT = "2026-11-20T10:00:00.000Z";

let n = 700;
function file(w: Week, o: Partial<SourceFile>): SourceFile {
  const f: SourceFile = {
    id: ++n, lesson_id: null, cover: false, speaker_id: null, fallen_id: null, storage_path: `1/x/${n}`, display_name: `דף ${n}.pdf`,
    mime: "application/pdf", size_bytes: 100, page_count: 1, uploaded_by: 1, uploaded_at: "2026-11-01T00:00:00Z", ...o,
  };
  w.sourceFiles.push(f);
  return f;
}

function kk(): KkData {
  return {
    tracks: [{ id: 1, day: 1, start_min: 1260, end_min: 1350 }],
    groups: [{ id: 3, track_id: 1, title: "ספר לדוגמה", author: null, room_id: null, capacity: 5, open: true }],
    leaders: [{ id: 1, group_id: 3, kind: "trainee", roster_id: 2, label: null }],
    signups: [{ id: 9, track_id: 1, group_id: 3, roster_id: 1, via: "link", created_at: "2026-11-01T00:00:00Z" }],
    orders: [{ group_id: 3, copies: 6, ordered_at: null }],
  };
}

describe("the archive's 5ב-2 files", () => {
  it("hold מכריכה לכריכה with names, the ticks, the plans and the fallen, the sources' list — the families' contacts only apart", () => {
    const w = demoWeek();
    w.escortTicks = [{ lesson_id: 1, item: "met", at: "2026-11-15T07:00:00Z" }];
    const lessonFile = file(w, { lesson_id: 1, speaker_id: w.lessonSpeakers.find((x) => x.lesson_id === 1)!.speaker_id });
    const more: ArchiveMore = {
      kk: kk(),
      fallen: [{ id: 1, name: "חלל/ה לדוגמה 1", gender: null, note: "הערה לדוגמה", active: true }, { id: 4, name: "חלל/ה לדוגמה 4", gender: "m", note: null, active: false }],
      fallenContacts: [{ fallen_id: 1, contact_name: "איש/אשת קשר לדוגמה", relation: "קרבה לדוגמה", phone: "טלפון לדוגמה", email: "family1@example.org", note: null }],
      sources: null,
    };
    const files = archiveFiles({ week: w, extras, more, schemaVersion: 11, exportedAt: AT });
    expect(Object.keys(files).sort()).toEqual(["README.txt", "edition.json", "kk.json", "memorial.json", PERSONAL_FILE, "sources.json", "speakers.json", "tracking.xlsx"].sort());
    const json = (k: string) => JSON.parse(strFromU8(files[k]));
    expect(json("edition.json")).toMatchObject({ format_version: 2, escort_ticks: [{ lesson_id: 1, item: "met" }] });
    expect(json("kk.json")).toMatchObject({
      groups: [{ id: 3, title: "ספר לדוגמה" }],
      leaders: [{ roster_id: 2, name: "מלווה לדוגמה ב׳" }],
      signups: [{ roster_id: 1, name: "מלווה לדוגמה א׳", via: "link" }],
      book_orders: [{ group_id: 3, copies: 6, ordered_at: null }],
    });
    const memorial = json("memorial.json");
    expect(memorial.plans.map((p: { fallen: string }) => p.fallen)).toEqual(["חלל/ה לדוגמה 1", "חלל/ה לדוגמה 2", "חלל/ה לדוגמה 3"].map((x, i) => (i === 0 ? x : "חלל/ה")));
    expect(memorial.fallen).toEqual(more.fallen); // the whole list the caller reads, the inactive too
    expect(json("sources.json")).toMatchObject({ files_included: false, files: [{ id: lessonFile.id, lesson_title: w.lessons.find((l) => l.id === 1)!.title, in_zip: null, not_read: false }] });
    // a bereaved family's contact person: in the personal-data file, and nowhere else
    for (const k of Object.keys(files).filter((x) => x !== PERSONAL_FILE && x !== "tracking.xlsx")) {
      expect(strFromU8(files[k]), k).not.toMatch(/טלפון לדוגמה|family1@example\.org|איש\/אשת קשר לדוגמה/);
    }
    expect(json(PERSONAL_FILE).family_contacts).toEqual([{ fallen: "חלל/ה לדוגמה 1", ...more.fallenContacts[0] }]);
    expect(strFromU8(files["README.txt"])).toContain("אנשי הקשר של משפחות החללים");
  });

  it("make a personal-data file for a family's contact alone, and none for an empty one", () => {
    const w = demoWeek();
    const base = { kk: null, fallen: [{ id: 1, name: "חלל/ה לדוגמה 1", gender: null, note: null, active: true }], sources: null };
    const empty = archiveFiles({ week: w, extras, more: { ...base, fallenContacts: [{ fallen_id: 1, contact_name: null, relation: null, phone: null, email: null, note: null }] }, schemaVersion: 11, exportedAt: AT });
    expect(empty[PERSONAL_FILE]).toBeUndefined();
    const one = archiveFiles({ week: w, extras, more: { ...base, fallenContacts: [{ fallen_id: 1, contact_name: null, relation: "קרבה לדוגמה", phone: null, email: null, note: null }] }, schemaVersion: 11, exportedAt: AT });
    expect(JSON.parse(strFromU8(one[PERSONAL_FILE])).family_contacts).toHaveLength(1);
  });

  it("put each source file in its day's folder — a memorial file where its plan is now, the poster apart — and name the unread", () => {
    const w = demoWeek(); // Sunday's 13:00 slot holds fallen 1's plan
    const sunday = w.lessons.find((l) => l.id === 1)!;
    const lesson = file(w, { lesson_id: 1, display_name: "../דף/מקורות.pdf" });
    const memorial = file(w, { lesson_id: 24, fallen_id: 1, display_name: "עמוד זיכרון.pdf" }); // uploaded on Monday's slot, the plan is on Sunday's
    const poster = file(w, { cover: true, display_name: "שער.png", mime: "image/png" });
    const orphan = file(w, { lesson_id: 999 });
    const lost = file(w, { lesson_id: 1, display_name: "לא נקרא.pdf" });
    expect(sourcePath(w, lesson)).toBe(`sources/1-ראשון/${String(sunday.start_min / 60 | 0).padStart(2, "0")}${String(sunday.start_min % 60).padStart(2, "0")}_${lesson.id}_דף_מקורות.pdf`);
    expect(sourcePath(w, memorial)).toBe(`sources/1-ראשון/1300_${memorial.id}_עמוד זיכרון.pdf`);
    expect(sourcePath(w, poster)).toBe(`sources/שער/${poster.id}_שער.png`);
    expect(sourcePath(w, orphan)).toBe(`sources/בלי-שיבוץ/${orphan.id}_דף ${orphan.id}.pdf`);
    expect(safeEntryName('..\\a:b*?"<>|')).toBe("a_b______");
    expect(sourcesSize(w)).toEqual({ count: 5, bytes: 500 });
    const bytes = new Map([lesson, memorial, poster, orphan].map((f) => [f.id, new Uint8Array([f.id % 256, 1, 2])]));
    const zip = unzipSync(archiveZip({ week: w, extras, more: { kk: null, fallen: [], fallenContacts: [], sources: { bytes, skipped: [{ id: lost.id, name: lost.display_name }] } }, schemaVersion: 11, exportedAt: AT }));
    expect(Object.keys(zip).filter((k) => k.startsWith("sources/")).sort()).toEqual([lesson, memorial, poster, orphan].map((f) => sourcePath(w, f)).sort());
    expect([...zip[sourcePath(w, memorial)]]).toEqual([memorial.id % 256, 1, 2]);
    const list = JSON.parse(strFromU8(zip["sources.json"]));
    expect(list.files_included).toBe(true);
    expect(list.files.find((f: { id: number }) => f.id === lost.id)).toMatchObject({ in_zip: null, not_read: true });
    expect(list.files.find((f: { id: number }) => f.id === memorial.id)).toMatchObject({ fallen: "חלל/ה לדוגמה 1", in_zip: sourcePath(w, memorial) });
    expect(strFromU8(zip["README.txt"])).toContain("1 קבצים לא נקראו ולא נכללו: לא נקרא.pdf");
  });
});

describe("reading the archive through the port", () => {
  it("gathers the week, מכריכה לכריכה, every fallen and the families' contacts the caller may see (the demo's admin)", async () => {
    const port = new DemoPort();
    const { week, more } = await gatherArchive(port, 1, touchedSpeakers);
    expect(week.edition.id).toBe(1);
    expect(more.kk?.groups.length).toBeGreaterThan(0);
    expect(more.fallen.map((f) => f.name)).toEqual(Array.from({ length: 9 }, (_, i) => `חלל/ה לדוגמה ${i + 1}`));
    expect(more.fallenContacts).toEqual([expect.objectContaining({ fallen_id: 1, phone: "טלפון לדוגמה" })]);
    expect(more.sources).toBeNull();
  });

  it("fetches each file through a signed URL, names one that could not be read, and stops when cancelled", async () => {
    const w = demoWeek();
    const ok = file(w, { lesson_id: 1, storage_path: "1/1/ok" });
    const gone = file(w, { lesson_id: 1, storage_path: "1/1/gone" });
    const broken = file(w, { lesson_id: 1, storage_path: "1/1/broken" });
    const port = { sources: { urls: async (_e: number, paths: string[]) => new Map(paths.filter((p) => p !== "1/1/gone").map((p) => [p, `data:application/pdf;base64,${p.endsWith("ok") ? "JVBERg==" : ""}`])) } } as unknown as DataPort;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => (url.endsWith(",") ? new Response(null, { status: 404 }) : realFetch(url))) as typeof fetch;
    try {
      const seen: number[] = [];
      const got = await fetchSources(port, w, new AbortController().signal, (p) => seen.push(p.done));
      expect([...got.bytes.keys()]).toEqual([ok.id]);
      expect(strFromU8(got.bytes.get(ok.id)!)).toBe("%PDF");
      expect(got.skipped).toEqual([{ id: gone.id, name: gone.display_name }, { id: broken.id, name: broken.display_name }]);
      expect(seen).toEqual([0, 1, 2, 3]);
      const ctl = new AbortController();
      ctl.abort();
      await expect(fetchSources(port, w, ctl.signal, () => {})).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
