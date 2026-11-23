// v19 on the in-memory engine and the demo (docs/CONTRACT.md «v19»; tests/parity holds the engine to the SQL): «נשלח
// לדפוס», a file's kind, the guests' words, a speaker's photo kept as its bytes, the approval to show a speaker, the
// guests' schedule through the link — and what the demo sends (DemoPort.loadWeek), seeds (`?as=logistics` only) and
// carries to the next edition. Synthetic only.
import { describe, expect, it } from "vitest";
import { addDays, israelDate } from "../domain/israelTime";
import { photoToBase64 } from "../domain/photo";
import type { Week } from "../domain/types";
import { assertWeekOnly } from "../offline/snapshot";
import { nonCanonical, photoBase64, photoBytes } from "../testing/photos";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek } from "../testing/week";
import { CommandError } from "./commands";
import { demoPhotoBytes } from "./demoPhoto";
import { DEMO_LOGISTICS, DemoPort } from "./demoPort";
import { demoLogisticsStart } from "./demoWeek";
import { type Actor, emptyShared, Engine } from "./engine";
import { BUCKET_MIMES, checkPicked, DOCX, PPTX, sourcePath } from "./sourceRules";

const HANDLER: Actor = { memberId: 1, role: "content" };
const OTHER: Actor = { memberId: 2, role: "content" };
const ADMIN: Actor = { memberId: 9, role: "admin" };
const LOGISTICS: Actor = { memberId: 5, role: "logistics" };
const NOW = "2026-11-19T10:00:00.000Z";

const code = (fn: () => unknown): string => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : String(e);
  }
};
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${String(e)}`;
  }
};

/**
 * A real, live edition: a speaker with an approach of HANDLER's and a closed lesson of theirs. A refused command puts
 * the week's rows back from its snapshot (new objects), so the rows are read afresh (`S()`, `A()`, `L()`); every engine
 * of a test shares one store (`engine`), as DemoPort's do.
 */
function real() {
  const w: Week = emptyWeek();
  w.edition.kind = "real";
  const s0 = addSpeaker(w, "f", "מרצה לדוגמה");
  const a0 = addApproach(w, s0);
  const l0 = closeWith(w, addLesson(w, 1, 510, 600), s0);
  const shared = emptyShared();
  return {
    w,
    shared,
    S: () => w.speakers.find((x) => x.id === s0.id)!,
    A: () => w.approaches.find((x) => x.id === a0.id)!,
    L: () => w.lessons.find((x) => x.id === l0.id)!,
    engine: (actor: Actor) => new Engine(w, actor, () => NOW, shared),
  };
}

describe("«נשלח לדפוס» (set_reader_sent)", () => {
  it("logistics or an admin stamps it — again, a new stamp; false removes it; a content member never; an archive's admins only", () => {
    const { w, engine } = real();
    expect(code(() => engine(LOGISTICS).setReaderSent(true))).toBe("ok");
    expect(w.edition.settings.reader_sent).toEqual({ at: NOW, by: 5 });
    expect(code(() => engine(HANDLER).setReaderSent(true))).toBe("forbidden");
    expect(code(() => engine(LOGISTICS).setReaderSent(null))).toBe("bad_value");
    expect(code(() => engine(HANDLER).setReaderSent(null))).toBe("forbidden"); // the role first
    const later = new Engine(w, ADMIN, () => "2026-11-20T10:00:00.000Z");
    later.setReaderSent(true);
    expect(w.edition.settings.reader_sent).toEqual({ at: "2026-11-20T10:00:00.000Z", by: 9 });
    engine(LOGISTICS).setReaderSent(false);
    expect(w.edition.settings.reader_sent).toBeUndefined();
    expect(code(() => engine(LOGISTICS).setReaderSent(false))).toBe("ok"); // nothing to remove
    w.edition.status = "archived";
    expect(code(() => engine(LOGISTICS).setReaderSent(true))).toBe("archived");
    expect(code(() => engine(ADMIN).setReaderSent(true))).toBe("ok");
  });
});

describe("a file's kind (register_source_file's p_kind)", () => {
  const path = (lesson: number | "cover", name: string, ext: string) => `1/${lesson}/00000000-0000-4000-8000-000000000001-${name}.${ext}`;

  it("a pptx only as a presentation; a presentation never touches the lesson; the first SOURCE file puts it in the reader", () => {
    const { L, engine } = real();
    const e = engine(HANDLER);
    const id = L().id;
    const deck = path(id, "deck", "pptx");
    e.storeObject(deck, PPTX, 2000);
    expect(code(() => e.registerSourceFile(id, deck, "מצגת.pptx", null))).toBe("bad_file");
    expect(code(() => e.registerSourceFile(id, deck, "מצגת.pptx", null, "slides"))).toBe("bad_value");
    expect(code(() => e.registerSourceFile(id, deck, "מצגת.pptx", null, null))).toBe("bad_value");
    const v = L().version;
    const row = e.registerSourceFile(id, deck, "מצגת.pptx", 7, "presentation");
    expect(row).toMatchObject({ kind: "presentation", cover: false, page_count: null, mime: PPTX });
    expect([L().sources_kind, L().in_reader, L().version]).toEqual(["pending", false, v]);
    const sheet = path(id, "sheet", "pdf");
    e.storeObject(sheet, "application/pdf", 1000);
    expect(e.registerSourceFile(id, sheet, "דף.pdf", 2)).toMatchObject({ kind: "source" });
    expect([L().sources_kind, L().in_reader]).toEqual(["sheet", true]);
  });

  it("the week's presentation on the cover path: admins only, never the cover; a memorial slot takes none", () => {
    const { w, engine } = real();
    const admin = engine(ADMIN);
    const deck = path("cover", "week", "pptx");
    expect(code(() => engine(HANDLER).storeObject(deck, PPTX, 100))).toBe("upload_refused");
    admin.storeObject(deck, PPTX, 100);
    const row = admin.registerSourceFile(null, deck, "מצגת השבוע.pptx", null, "presentation");
    expect([row.cover, row.kind, row.lesson_id]).toEqual([false, "presentation", null]);
    const pdf = path("cover", "weekpdf", "pdf");
    admin.storeObject(pdf, "application/pdf", 100);
    const p = admin.registerSourceFile(null, pdf, "מצגת.pdf", 3, "presentation");
    expect(w.edition.settings.reader_cover).toBeUndefined(); // a readable PDF, but a presentation: no cover
    expect(code(() => admin.setReaderCover(p.id))).toBe("bad_value");
    // a memorial slot with a plan
    const slot = addLesson(w, 0, 780, 795, { kind: "memorial" });
    w.memorialPlans.push({ id: 1, fallen_id: 1, lesson_id: slot.id, family_status: "not_contacted", speaker_text: null, planned_minutes: null, hard_stop: false, materials_note: null, version: 1 });
    const m = path(slot.id, "mdeck", "pptx");
    engine(HANDLER).storeObject(m, PPTX, 100);
    expect(code(() => engine(HANDLER).registerSourceFile(slot.id, m, "מצגת.pptx", null, "presentation"))).toBe("bad_value");
    expect(code(() => engine(HANDLER).registerSourceFile(slot.id, m, "מצגת.pptx", null))).toBe("bad_file");
  });

  it("the browser's pre-check never lets through what the bucket then refuses (a Word presentation on the cover path) — each type, each kind, the cover and a lesson", () => {
    const { L, engine } = real();
    const NAMES: Record<string, string> = { "application/pdf": "a.pdf", "image/png": "a.png", "image/jpeg": "a.jpg", [DOCX]: "a.docx", [PPTX]: "a.pptx" };
    let n = 0;
    for (const [who, lesson] of [[ADMIN, null], [HANDLER, L().id]] as const) {
      for (const mime of BUCKET_MIMES) {
        for (const kind of ["source", "presentation"] as const) {
          const picked = code(() => checkPicked({ name: NAMES[mime], type: mime, size: 10 }, lesson == null, kind));
          if (picked !== "ok") continue; // refused before the bytes go up: said in its own words
          n++;
          const path = sourcePath(1, lesson, `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, NAMES[mime], mime);
          expect(code(() => engine(who).storeObject(path, mime, 10)), `${lesson ?? "cover"} ${kind} ${mime}`).toBe("ok");
        }
      }
    }
    expect(code(() => checkPicked({ name: "a.docx", type: DOCX, size: 10 }, true, "presentation"))).toBe("week_presentation_bad_file");
    expect(n).toBe(16); // the cover: 3 as a source, 4 as a presentation; a lesson: 4 and 5 — pinned, so a twin cannot quietly drop one
  });
});

describe("the guests' words", () => {
  it("public_bio: ≤ 600, no contact, through create and update — a field of the log; a row without one reads as null", () => {
    const { w, S, engine } = real();
    const e = engine(HANDLER);
    const id = S().id;
    expect(code(() => e.updateSpeaker(id, S().version, { public_bio: "א".repeat(601) }))).toBe("bad_value");
    expect(code(() => e.updateSpeaker(id, S().version, { public_bio: "לפרטים: someone@example.org" }))).toBe("contact_in_text");
    const v = S().version;
    e.updateSpeaker(id, v, { public_bio: null }); // null, and the row had none: nothing changed
    expect([S().version, e.shared.log.length]).toEqual([v, 0]);
    e.updateSpeaker(id, v, { public_bio: "  תיאור לדוגמה  " });
    expect([S().public_bio, S().version]).toEqual(["תיאור לדוגמה", v + 1]);
    expect(e.shared.log.at(-1)).toMatchObject({ entity: "speakers", kind: "update", detail: { fields: ["public_bio"] } });
    const created = e.createSpeaker({ name: "מרצה לדוגמה אחר", public_bio: "תיאור" }, { confirmed: true });
    expect(w.speakers.find((x) => x.id === created.speaker_id)?.public_bio).toBe("תיאור");
    expect(code(() => e.createSpeaker({ name: "מרצה לדוגמה שלישי", public_bio: "טל' 000-000-0082" }, { confirmed: true }))).toBe("contact_in_text");
  });

  it("public_note: ≤ 400, no contact, through update_lesson; a memorial slot's never; a reopen keeps it", () => {
    const { w, L, engine } = real();
    const e = engine(HANDLER);
    const id = L().id;
    expect(code(() => e.updateLesson(id, L().version, { public_note: "א".repeat(401) }))).toBe("bad_value");
    expect(code(() => e.updateLesson(id, L().version, { public_note: "לשאלות: 000-000-0083" }))).toBe("contact_in_text");
    expect(code(() => e.updateLesson(id, L().version - 1, { public_note: "א".repeat(401) }))).toBe("stale");
    e.updateLesson(id, L().version, { public_note: "  שורה לאורחים\r\n" });
    expect(L().public_note).toBe("שורה לאורחים");
    e.updateLesson(id, L().version, { title: "כותרת" }); // another key: the note stays
    expect(L().public_note).toBe("שורה לאורחים");
    e.updateLesson(id, L().version, { public_note: undefined }); // a key JSON drops: nothing
    expect(L().public_note).toBe("שורה לאורחים");
    w.approaches[0].owner_member_id = 1;
    e.reopenLesson(id);
    expect([L().state, L().public_note]).toEqual(["draft", "שורה לאורחים"]);
    e.updateLesson(id, L().version, { public_note: null });
    expect(L().public_note).toBeNull();
    const slot = addLesson(w, 0, 780, 795, { kind: "memorial" });
    expect(code(() => e.updateLesson(slot.id, slot.version, { public_note: "שורה" }))).toBe("memorial_slot");
  });
});

describe("a speaker's photo", () => {
  it("whoever may edit the speaker; kept as bytes and read back canonical; refused unless photoOk; removed (logged once)", () => {
    const { w, S, engine } = real();
    const e = engine(HANDLER);
    const s = S();
    expect(code(() => engine(OTHER).setSpeakerPhoto(s.id, photoBase64("clean")))).toBe("not_handler");
    expect(code(() => engine(LOGISTICS).setSpeakerPhoto(s.id, photoBase64("clean")))).toBe("forbidden");
    expect(code(() => e.setSpeakerPhoto(999, photoBase64("clean")))).toBe("stale");
    for (const bad of ["exif", "progressive", "trailer", "big", "garbage"] as const) expect(code(() => e.setSpeakerPhoto(s.id, photoBase64(bad))), bad).toBe("bad_file");
    expect(code(() => e.setSpeakerPhoto(s.id, ""))).toBe("bad_file");
    e.setSpeakerPhoto(s.id, nonCanonical(photoBase64("clean")));
    const stored = e.shared.photos[s.id];
    expect(stored.image).toBeInstanceOf(Uint8Array);
    expect(stored.image).toEqual(photoBytes("clean"));
    expect([stored.uploaded_by, stored.uploaded_at]).toEqual([1, NOW]);
    expect(engine(OTHER).speakerPhoto(s.id)).toEqual({ photo: photoBase64("clean"), uploaded_at: NOW }); // any member reads
    expect(e.shared.log.map((r) => [r.entity, r.kind, r.detail])).toEqual([["speakers", "photo", { set: true }]]);
    e.setSpeakerPhoto(s.id, null);
    e.setSpeakerPhoto(s.id, null);
    expect(e.speakerPhoto(s.id)).toBeNull();
    expect(e.shared.log.map((r) => r.detail)).toEqual([{ set: true }, { set: false }]);
    expect(JSON.stringify(e.shared.log)).not.toContain(photoBase64("clean").slice(0, 24));
    // a practice week gives no right over the pool's record
    w.edition.kind = "practice";
    expect(code(() => e.setSpeakerPhoto(s.id, photoBase64("clean")))).toBe("not_handler");
    expect(code(() => engine({ memberId: 1, role: "admin", global: true }).setSpeakerPhoto(s.id, photoBase64("clean")))).toBe("ok");
  });

  it("a refused command rolls the photos back with the rest", () => {
    const { S, engine } = real();
    const e = engine(HANDLER);
    const id = S().id;
    e.setSpeakerPhoto(id, photoBase64("clean"));
    expect(code(() => e.setSpeakerPhoto(id, "abc"))).toBe("bad_file");
    expect(e.shared.photos[id].image).toEqual(photoBytes("clean"));
    expect(code(() => e.setSpeakerPhoto(id, null))).toBe("ok");
    expect(code(() => engine(OTHER).setSpeakerPhoto(id, null))).toBe("not_handler");
    expect(e.shared.photos[id]).toBeUndefined();
  });
});

describe("public_ok (set_public_ok) and the guests' schedule", () => {
  it("set_approach_status's rule; unchanged is nothing; each change logged with public_ok", () => {
    const { A, engine } = real();
    const e = engine(HANDLER);
    const id = A().id;
    expect(code(() => engine(LOGISTICS).setPublicOk(id, A().version, true))).toBe("forbidden");
    expect(code(() => engine(OTHER).setPublicOk(id, A().version, true))).toBe("not_handler");
    expect(code(() => e.setPublicOk(id, A().version - 1, true))).toBe("stale");
    expect(code(() => e.setPublicOk(-1, 1, true))).toBe("stale");
    expect(code(() => e.setPublicOk(id, A().version, null))).toBe("bad_value");
    const v = A().version;
    e.setPublicOk(id, v, false); // as it is (absent = false)
    expect([A().version, e.shared.log.length]).toEqual([v, 0]);
    e.setPublicOk(id, v, true);
    expect([A().public_ok, A().version]).toEqual([true, v + 1]);
    engine(ADMIN).setPublicOk(id, A().version, false);
    expect(e.shared.log.map((r) => [r.entity, r.kind, r.actor, r.detail.public_ok])).toEqual([
      ["approaches", "update", 1, true],
      ["approaches", "update", 9, false],
    ]);
  });

  it("the schedule link shows the approved speaker with their words and photo — taken back, gone at once", () => {
    const { S, A, L, engine } = real();
    const admin = engine({ memberId: 9, role: "admin", global: true });
    const { token } = admin.issueLink("schedule");
    const guest = () => engine({ memberId: 0, role: "content" }).scheduleView(token);
    expect(guest().people).toEqual([]);
    const e = engine(HANDLER);
    e.updateSpeaker(S().id, S().version, { public_bio: "תיאור לדוגמה" });
    e.setSpeakerPhoto(S().id, photoBase64("clean"));
    e.updateLesson(L().id, L().version, { public_note: "שורה לאורחים" });
    e.setPublicOk(A().id, A().version, true);
    const v = guest();
    expect(v.people).toEqual([{ label: "מרצה לדוגמה", bio: "תיאור לדוגמה", photo: `data:image/jpeg;base64,${photoToBase64(demoPhotoBytes())}` }]);
    expect(v.rows.map((r) => [r.note, r.people])).toEqual([["שורה לאורחים", [0]]]);
    expect(v.fixed).toHaveLength(29);
    e.setPublicOk(A().id, A().version, false);
    expect(guest().people).toEqual([]);
    expect(guest().rows[0].people).toEqual([]);
  });
});

describe("the demo", () => {
  it("loadWeek sends every new field — has_photo, never the photo — and the copy takes it", async () => {
    const port = new DemoPort(DEMO_LOGISTICS, { logistics: true, now: () => NOW });
    const week = await port.loadWeek(1);
    expect(week.speakers.every((s) => typeof s.has_photo === "boolean" && s.public_bio !== undefined)).toBe(true);
    expect(week.approaches.every((a) => typeof a.public_ok === "boolean")).toBe(true);
    expect(week.lessons.every((l) => l.public_note !== undefined)).toBe(true);
    expect(week.sourceFiles.every((f) => f.kind === "source" || f.kind === "presentation")).toBe(true);
    expect(week.speakers.filter((s) => s.has_photo)).toHaveLength(1);
    expect(JSON.stringify(week)).not.toContain(photoToBase64(demoPhotoBytes()).slice(0, 24));
    expect(() => assertWeekOnly(week)).not.toThrow();
  });

  it("demoLogisticsStart: the first Sunday on or after Israel's today + 21 days", () => {
    // Thursday 19.11.2026 (Israel) + 21 = Thursday 10.12 → Sunday 13.12
    expect(demoLogisticsStart(NOW)).toBe("2026-12-13");
    // late at night in UTC is already the next day in Israel
    expect(demoLogisticsStart("2026-11-21T23:30:00.000Z")).toBe(addDays(israelDate("2026-11-21T23:30:00.000Z"), 21)); // Sunday 22.11 + 21 = Sunday 13.12
    expect(demoLogisticsStart("2026-11-21T23:30:00.000Z")).toBe("2026-12-13");
    expect(demoLogisticsStart("2026-11-21T12:00:00.000Z")).toBe("2026-12-13"); // Saturday 21.11 + 21 = Saturday 12.12 → Sunday 13.12
    for (const iso of ["2026-01-01T00:00:00Z", "2027-03-15T21:59:00Z", "2027-10-30T22:30:00Z"]) {
      const d = demoLogisticsStart(iso);
      const [y, m, day] = d.split("-").map(Number);
      expect(new Date(Date.UTC(y, m - 1, day)).getUTCDay(), iso).toBe(0);
      const gap = (Date.UTC(y, m - 1, day) - Date.parse(`${addDays(israelDate(iso), 21)}T00:00:00Z`)) / 86_400_000;
      expect(gap >= 0 && gap < 7, iso).toBe(true);
    }
  });

  it("start_edition carries the tasks and the items with their quantities — «בוצע»/«נקנה» start over", async () => {
    const port = new DemoPort();
    const first = await port.settings.startEdition({ label: "מחזור לדוגמה", start_date: null, first_day_from: null });
    await port.rota.addPrepTasks(first, ["משימה לדוגמה"]);
    await port.rota.addPrepTasks(first, [{ text: "פריט לדוגמה", qty: "3" }], "item");
    const item = (await port.rota.load(first)).prep.find((p) => p.kind === "item")!;
    await port.rota.updatePrepTask(item.id, { done: true });
    const next = await port.settings.startEdition({ label: "מחזור לדוגמה ב", start_date: null, first_day_from: null });
    expect((await port.rota.load(next)).prep.map((p) => [p.text, p.kind, p.qty, p.done])).toEqual([
      ["משימה לדוגמה", "task", null, false],
      ["פריט לדוגמה", "item", "3", false],
    ]);
  });

  it("a photo is a member's history (app.member_has_history counts speaker_photos.uploaded_by)", async () => {
    const port = new DemoPort();
    const { id } = await port.settings.addMember({ email: "new.member@example.org", display_name: "חבר/ת צוות לדוגמה", gender: null, role: "content", edition_id: 1 });
    port.shared.photos[1] = { image: demoPhotoBytes(), uploaded_by: id, uploaded_at: NOW };
    expect(await codeOf(port.settings.deleteMember(id))).toBe("member_has_history");
    delete port.shared.photos[1];
    expect(await codeOf(port.settings.deleteMember(id))).toBe("ok");
  });
});
