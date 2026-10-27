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
import { type ArchiveMore, archiveFiles, archiveZip, PERSONAL_FILE, plannedFallen, safeEntryName, sourcePath, sourcesSize, touchedSpeakers } from "./archive";
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
    groups: [{ id: 3, title: "ספר לדוגמה", author: null, place: "מרחב לדוגמה", capacity: 5, open: true }],
    leaders: [{ id: 1, group_id: 3, kind: "trainee", roster_id: 2, label: null }, { id: 2, group_id: 3, kind: "staff", roster_id: null, label: "מדריך/ה לדוגמה" }],
    signups: [{ id: 9, group_id: 3, roster_id: 1, via: "link", created_at: "2026-11-01T00:00:00Z" }],
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
    expect(json("edition.json")).toMatchObject({ format_version: 4, escort_ticks: [{ lesson_id: 1, item: "met" }] });
    // v14: availability per slot, as the Week holds it
    expect(json("edition.json").slot_availability).toEqual(w.slotAvailability);
    expect(json("edition.json")).not.toHaveProperty("availability");
    // v15: the week's groups, each in its place — no tracks
    expect(json("kk.json")).toEqual({
      format: "volozhin-week-archive",
      exported_at: AT,
      window: w.edition.settings?.kk_window ?? null,
      groups: [{ id: 3, title: "ספר לדוגמה", author: null, place: "מרחב לדוגמה", capacity: 5, open: true }],
      leaders: [
        { id: 1, group_id: 3, kind: "trainee", roster_id: 2, label: null, name: "מלווה לדוגמה ב׳" },
        { id: 2, group_id: 3, kind: "staff", roster_id: null, label: "מדריך/ה לדוגמה", name: "מדריך/ה לדוגמה" },
      ],
      signups: [{ id: 9, group_id: 3, roster_id: 1, via: "link", created_at: "2026-11-01T00:00:00Z", name: "מלווה לדוגמה א׳" }],
      book_orders: [{ group_id: 3, copies: 6, ordered_at: null }],
    });
    expect(strFromU8(files["README.txt"])).toContain("kk.json: מכריכה לכריכה — הקבוצות של השבוע (הספר והמרחב), המעבירים");
    const memorial = json("memorial.json");
    expect(memorial.plans.map((p: { fallen: string }) => p.fallen)).toEqual(["חלל/ה לדוגמה 1", "חלל/ה לדוגמה 2", "חלל/ה לדוגמה 3"].map((x, i) => (i === 0 ? x : "חלל/ה")));
    expect(memorial.fallen).toEqual(more.fallen); // the whole list the caller reads, the inactive too
    expect(json("sources.json")).toMatchObject({ files_included: false, files: [{ id: lessonFile.id, lesson_title: w.lessons.find((l) => l.id === 1)!.title, in_zip: null, not_read: false }] });
    // a bereaved family's contact person: in the personal-data file, and nowhere else
    for (const k of Object.keys(files).filter((x) => x !== PERSONAL_FILE && x !== "tracking.xlsx")) {
      expect(strFromU8(files[k]), k).not.toMatch(/טלפון לדוגמה|family1@example\.org|איש\/אשת קשר לדוגמה/);
    }
    expect(json(PERSONAL_FILE).family_contacts).toEqual([{ fallen: "חלל/ה לדוגמה 1", ...more.fallenContacts[0] }]);
    expect(strFromU8(files["README.txt"])).toContain("אנשי הקשר של המשפחות של החללים שיש להם תוכנית במחזור הזה (לא של שנים אחרות)");
  });

  it("hold the families' contacts of the fallen THIS edition planned for only — another year's family never, though its name is in the cross-year list", () => {
    const w = demoWeek(); // plans for fallen 1, 2 and 3
    expect(plannedFallen(w)).toEqual([1, 2, 3]);
    const more: ArchiveMore = {
      kk: null,
      fallen: [1, 2, 9].map((id) => ({ id, name: `חלל/ה לדוגמה ${id}`, gender: null, note: null, active: true })),
      fallenContacts: [
        { fallen_id: 1, contact_name: "קשר אחד לדוגמה", relation: null, phone: null, email: null, note: null },
        { fallen_id: 9, contact_name: "קשר תשע לדוגמה", relation: "קרבה לדוגמה", phone: "טלפון תשע לדוגמה", email: null, note: null }, // no plan here
      ],
      sources: null,
    };
    const files = archiveFiles({ week: w, extras, more, schemaVersion: 11, exportedAt: AT });
    expect(JSON.parse(strFromU8(files[PERSONAL_FILE])).family_contacts.map((c: { fallen_id: number }) => c.fallen_id)).toEqual([1]);
    for (const k of Object.keys(files).filter((x) => x !== "tracking.xlsx")) expect(strFromU8(files[k]), k).not.toMatch(/קשר תשע לדוגמה|טלפון תשע לדוגמה/);
    expect(JSON.parse(strFromU8(files["memorial.json"])).fallen.map((f: { id: number }) => f.id)).toEqual([1, 2, 9]); // the names stay
    // only another year's family: no personal-data file at all
    const none = archiveFiles({ week: w, extras, more: { ...more, fallenContacts: [more.fallenContacts[1]] }, schemaVersion: 11, exportedAt: AT });
    expect(none[PERSONAL_FILE]).toBeUndefined();
  });

  it("make a personal-data file for a family's contact alone, and none for an empty one", () => {
    const w = demoWeek();
    const base = { kk: null, fallen: [{ id: 1, name: "חלל/ה לדוגמה 1", gender: null, note: null, active: true }], sources: null };
    const empty = archiveFiles({ week: w, extras, more: { ...base, fallenContacts: [{ fallen_id: 1, contact_name: null, relation: null, phone: null, email: null, note: null }] }, schemaVersion: 11, exportedAt: AT });
    expect(empty[PERSONAL_FILE]).toBeUndefined();
    const one = archiveFiles({ week: w, extras, more: { ...base, fallenContacts: [{ fallen_id: 1, contact_name: null, relation: "קרבה לדוגמה", phone: null, email: null, note: null }] }, schemaVersion: 11, exportedAt: AT });
    expect(JSON.parse(strFromU8(one[PERSONAL_FILE])).family_contacts).toHaveLength(1);
  });

  it("count a speaker whose slot was marked as touched (v14: no approach needed) — speakers.json names every speaker slot_availability does", () => {
    const w = demoWeek();
    const marked = w.speakers.find((s) => !touchedSpeakers(w).includes(s.id))!;
    w.slotAvailability.push({ id: 99, speaker_id: marked.id, day: 1, row_id: 4, kind: "can", note: null, updated_by: 2 });
    expect(touchedSpeakers(w)).toContain(marked.id);
    const files = archiveFiles({ week: w, extras, schemaVersion: 14, exportedAt: AT });
    const listed = new Set(JSON.parse(strFromU8(files["speakers.json"])).speakers.map((s: { id: number }) => s.id));
    for (const v of w.slotAvailability) expect(listed.has(v.speaker_id), String(v.speaker_id)).toBe(true);
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

  it("asks for the families' contacts of the fallen this edition planned for only — a fallen with a contact and no plan here is never read", async () => {
    const port = new DemoPort();
    // fallen 9 has no plan in the demo edition (its plans: fallen 1, 2 and 3) — another year's family
    await port.memorial.setContacts(9, { contact_name: "קשר תשע לדוגמה", relation: "קרבה לדוגמה", phone: null, email: "family9@example.org", note: null });
    const asked: number[] = [];
    const contacts = port.memorial.contacts.bind(port.memorial);
    port.memorial.contacts = async (id: number) => (asked.push(id), contacts(id));
    const { week, extras, more } = await gatherArchive(port, 1, touchedSpeakers);
    expect(asked).toEqual([1, 2, 3]);
    expect(more.fallenContacts.map((c) => c.fallen_id)).toEqual([1]);
    expect(more.fallen.map((f) => f.id)).toContain(9); // the name stays in the cross-year list
    const files = archiveFiles({ week, extras, more, schemaVersion: 11, exportedAt: AT });
    expect(JSON.parse(strFromU8(files[PERSONAL_FILE])).family_contacts.map((c: { fallen_id: number }) => c.fallen_id)).toEqual([1]);
  });

  it("keeps «איך עבר» (milestone 6) in reviews.json alone, with the speaker's name — in no other file of the zip", async () => {
    const port = new DemoPort();
    const { week, extras, more } = await gatherArchive(port, 1, touchedSpeakers);
    expect(more.reviews?.length).toBe(3);
    const files = archiveFiles({ week, extras, more, schemaVersion: 12, exportedAt: AT });
    const reviews = JSON.parse(strFromU8(files["reviews.json"])).reviews as { speaker: string; invite_again: string; went_well: string | null }[];
    expect(reviews.map((r) => [r.speaker, r.invite_again])).toEqual([["ד״ר מרצה 01", "yes"], ["פרופ׳ מרצה 03", "maybe"], ["הרב מרצה 21", "no"]]);
    const text = reviews[0].went_well!;
    for (const [name, bytes] of Object.entries(files)) if (name !== "reviews.json" && !name.endsWith(".xlsx")) expect(strFromU8(bytes), name).not.toContain(text);
    expect(strFromU8(files["README.txt"])).toContain("reviews.json");
    // not read (an older caller): no file, and the README says so
    const without = archiveFiles({ week, extras, more: { ...more, reviews: null }, schemaVersion: 12, exportedAt: AT });
    expect(without["reviews.json"]).toBeUndefined();
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
