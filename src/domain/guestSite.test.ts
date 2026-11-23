import { describe, expect, it } from "vitest";
import { DEMO_LOGISTICS, DEMO_TRAINEE, DemoPort } from "../data/demoPort";
import { DEMO_GUEST_BIOS, DEMO_GUEST_NOTE } from "../data/demoWeek";
import { photoToBase64 } from "./photo";
import { demoPhotoBytes } from "../data/demoPhoto";
import { publicSchedule } from "../exports/publicSchedule";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek } from "../testing/week";
import {
  filterGuests, type GuestActor, guestLine, guestPhotoIds, guestPreview, guestRows, guestSummary, mayChangePublicOk, mayEditSpeaker, mayMarkPublic, mayUnmarkPublic, publicOkOffered,
  readPhotos,
} from "./guestSite";
import { displayName } from "./names";
import type { Week } from "./types";

/** guestRows' approved people, each once, in the rows' order — as publicSchedule would list them (no photos asked). */
const okPeople = (week: Week) => {
  const seen = new Set<number>();
  const out: { label: string; bio: string | null; photo: null }[] = [];
  for (const r of guestRows(week)) {
    for (const p of r.people) {
      if (!p.ok || seen.has(p.speakerId)) continue;
      seen.add(p.speakerId);
      const s = week.speakers.find((x) => x.id === p.speakerId)!;
      out.push({ label: displayName(s), bio: s.public_bio ?? null, photo: null });
    }
  }
  return out;
};

const admin: GuestActor = { memberId: 1, isAdmin: true, global: false, canEdit: true };
const global: GuestActor = { memberId: 9, isAdmin: true, global: true, canEdit: true };
const handler: GuestActor = { memberId: 2, isAdmin: false, global: false, canEdit: true };
const other: GuestActor = { memberId: 3, isAdmin: false, global: false, canEdit: true };
const logistics: GuestActor = { memberId: 5, isAdmin: false, global: false, canEdit: false };
const live = { kind: "real", status: "planning" } as const;

describe("the guests' site from the team's side (the reset, phase 5)", () => {
  it("«approved» is publicSchedule's own rule: the same speakers, in the same order — on every demo", async () => {
    for (const port of [new DemoPort(), new DemoPort(DEMO_TRAINEE, { trainee: true }), new DemoPort(DEMO_LOGISTICS, { logistics: true })]) {
      const week = await port.loadWeek(1);
      const people = okPeople(week);
      expect(people.length).toBe(2);
      expect(people).toEqual(publicSchedule(week, () => null).people);
    }
  });

  it("…and on a built week: a co-speaker approved, one not, a co-speaker with no approach, a memorial time, a draft", () => {
    const w = emptyWeek();
    const [a, b, c, d] = [addSpeaker(w, "f"), addSpeaker(w, "m"), addSpeaker(w, "f"), addSpeaker(w, null)];
    for (const s of [a, b, c]) addApproach(w, s, "positive");
    w.approaches.find((x) => x.speaker_id === b.id)!.public_ok = true;
    w.approaches.find((x) => x.speaker_id === c.id)!.public_ok = true;
    b.public_bio = "תיאור לדוגמה";
    closeWith(w, addLesson(w, 0, 510, 600), a, b, d);
    closeWith(w, addLesson(w, 1, 510, 600), c, b);
    addLesson(w, 0, 780, 795, { kind: "memorial" });
    addLesson(w, 2, 510, 600);
    expect(okPeople(w)).toEqual(publicSchedule(w, () => null).people);
    expect(okPeople(w).map((p) => p.label)).toEqual([displayName(b), displayName(c)]);
  });

  it("a row per closed lesson, what each lacks — the description, and per speaker with an approach the approval, a description, a photo", () => {
    const w = emptyWeek();
    const [lead, co, imported] = [addSpeaker(w, "f"), addSpeaker(w, "m"), addSpeaker(w, null)];
    const al = addApproach(w, lead, "positive");
    addApproach(w, co, "positive").public_ok = true;
    co.public_bio = "תיאור לדוגמה";
    co.has_photo = true;
    al.owner_member_id = 2;
    const l = closeWith(w, addLesson(w, 0, 510, 600, { title: "שיעור לדוגמה" }), lead, co, imported);
    const ready = closeWith(w, addLesson(w, 1, 510, 600, { public_note: "תיאור לדוגמה" }), co);
    addLesson(w, 0, 780, 795, { kind: "memorial", state: "closed" });
    addLesson(w, 2, 510, 600, { state: "cancelled" });
    const rows = guestRows(w);
    expect(rows.map((r) => r.lessonId)).toEqual([l.id, ready.id]);
    const [first, second] = rows;
    expect(first).toMatchObject({ day: 0, start_min: 510, title: "שיעור לדוגמה", handler: 2, note: false, missing: ["note", "ok", "bio", "photo"] });
    expect(first.people).toEqual([
      { speakerId: lead.id, role: "lead", approachId: al.id, ok: false, bio: false, photo: false },
      { speakerId: co.id, role: "co", approachId: expect.any(Number), ok: true, bio: true, photo: true },
      { speakerId: imported.id, role: "co", approachId: null, ok: false, bio: false, photo: false },
    ]);
    expect(second).toMatchObject({ note: true, missing: [] });
    expect(guestLine(first)).toBe("חסר לאתר האורחים: תיאור לשיעור, אישור להופיע, תיאור למרצה, תמונה");
    expect(guestLine(second)).toBe("מוכן לאתר האורחים");
    // a blank description is none
    ready.public_note = "   ";
    expect(guestRows(w)[1].missing).toEqual(["note"]);
    expect(guestLine(guestRows(w)[1])).toBe("חסר לאתר האורחים: תיאור לשיעור");
  });

  it("the counts: each speaker once; the filters: a day, a handler, «רק מה שחסר»", () => {
    const w = emptyWeek();
    const [a, b] = [addSpeaker(w, "f"), addSpeaker(w, "m")];
    addApproach(w, a, "positive").public_ok = true;
    addApproach(w, b, "positive").owner_member_id = 3;
    a.public_bio = "תיאור לדוגמה";
    const x = closeWith(w, addLesson(w, 0, 510, 600, { public_note: "תיאור לדוגמה" }), a);
    const y = closeWith(w, addLesson(w, 1, 510, 600), a, b);
    const rows = guestRows(w);
    expect(guestSummary(rows)).toEqual({ lessons: 2, withNote: 1, people: 2, ok: 1, okWithBio: 1, okWithPhoto: 0 });
    expect(filterGuests(rows, {}).map((r) => r.lessonId)).toEqual([x.id, y.id]);
    expect(filterGuests(rows, { day: 1 }).map((r) => r.lessonId)).toEqual([y.id]);
    expect(filterGuests(rows, { handler: 3 })).toEqual([]);
    expect(filterGuests(rows, { handler: 1, day: null }).map((r) => r.lessonId)).toEqual([x.id, y.id]);
    expect(filterGuests(rows, { missing: true }).map((r) => r.lessonId)).toEqual([x.id, y.id]); // x: the photo
    a.has_photo = true;
    expect(filterGuests(guestRows(w), { missing: true }).map((r) => r.lessonId)).toEqual([y.id]);
  });

  it("who marks, who takes a mark back — set_public_ok's rule; the box only once the speaker agreed, or to take it back", () => {
    const mine = { owner_member_id: 2 };
    const nobody = { owner_member_id: null };
    expect(mayMarkPublic(handler, live, mine)).toBe(true);
    expect(mayMarkPublic(other, live, mine)).toBe(false);
    expect(mayMarkPublic(admin, live, mine)).toBe(true);
    expect(mayMarkPublic(admin, live, nobody)).toBe(true);
    expect(mayMarkPublic(logistics, live, mine)).toBe(false);
    // a practice or demo week, an archived edition: only a global admin marks (app.may_edit_speaker) — anyone may take a mark back
    for (const e of [{ kind: "practice", status: "planning" }, { kind: "demo", status: "active" }, { kind: "real", status: "archived" }] as const) {
      expect(mayMarkPublic(handler, e, mine)).toBe(false);
      expect(mayMarkPublic(admin, e, mine)).toBe(false);
      expect(mayMarkPublic(global, e, mine)).toBe(true);
    }
    expect(mayUnmarkPublic(handler, mine)).toBe(true);
    expect(mayUnmarkPublic(other, mine)).toBe(false);
    expect(mayUnmarkPublic(admin, nobody)).toBe(true);
    expect(mayUnmarkPublic(logistics, mine)).toBe(false);
    expect(mayUnmarkPublic({ ...handler, canEdit: false }, mine)).toBe(false);
    expect(publicOkOffered({ status: "positive" })).toBe(true);
    expect(publicOkOffered({ status: "approached", public_ok: false })).toBe(false);
    expect(publicOkOffered({ status: "declined", public_ok: true })).toBe(true);
  });

  it("mayChangePublicOk — the box as it stands: offered, and this viewer's to mark or to take back (the lesson page's hint follows it)", () => {
    const agreed = { status: "positive", public_ok: false, owner_member_id: 2 } as const;
    const marked = { status: "positive", public_ok: true, owner_member_id: 2 } as const;
    const asked = { status: "approached", public_ok: false, owner_member_id: 2 } as const;
    expect(mayChangePublicOk(handler, live, agreed)).toBe(true);
    expect(mayChangePublicOk(admin, live, agreed)).toBe(true);
    expect(mayChangePublicOk(other, live, agreed)).toBe(false); // another trainee's speaker
    expect(mayChangePublicOk(logistics, live, agreed)).toBe(false);
    expect(mayChangePublicOk(logistics, live, marked)).toBe(false);
    expect(mayChangePublicOk(handler, live, asked)).toBe(false); // not offered before the speaker agreed
    // a practice week: nobody but a global admin marks — a mark already there is taken back as anywhere (set_public_ok's `false`)
    const practice = { kind: "practice", status: "planning" } as const;
    expect(mayChangePublicOk(handler, practice, agreed)).toBe(false);
    expect(mayChangePublicOk(global, practice, agreed)).toBe(true);
    expect(mayChangePublicOk(handler, practice, marked)).toBe(true);
    expect(mayChangePublicOk(admin, practice, marked)).toBe(true);
    expect(mayChangePublicOk(other, practice, marked)).toBe(false);
  });

  it("mayEditSpeaker moved here, unchanged: a global admin; else a live real edition's admin or the handler", () => {
    expect(mayEditSpeaker(global, { kind: "demo", status: "planning" }, false)).toBe(true);
    expect(mayEditSpeaker(admin, live, false)).toBe(true);
    expect(mayEditSpeaker(handler, live, true)).toBe(true);
    expect(mayEditSpeaker(handler, live, false)).toBe(false);
    expect(mayEditSpeaker(handler, { kind: "practice", status: "planning" }, true)).toBe(false);
    expect(mayEditSpeaker({ ...admin, canEdit: false }, live, false)).toBe(false);
  });

  it("a lesson's preview is the link's own row and people; a memorial time or a draft has none", async () => {
    const port = new DemoPort();
    const week = await port.loadWeek(1);
    const sunday = week.lessons.find((l) => l.kind === "lesson" && l.state === "closed" && l.day === 0 && l.start_min === 510)!;
    const photo = (await port.speakers.photo(week.lessonSpeakers.find((x) => x.lesson_id === sunday.id && x.role === "lead")!.speaker_id))!.photo;
    const p = guestPreview(week, sunday.id, () => photo)!;
    expect(p.row).toMatchObject({ kind: "lesson", day: 0, start_min: 510, note: DEMO_GUEST_NOTE });
    expect(p.row.people.map((i) => p.people[i].bio)).toEqual([DEMO_GUEST_BIOS.photo]);
    expect(p.people[p.row.people[0]].photo).toBe(`data:image/jpeg;base64,${photoToBase64(demoPhotoBytes())}`);
    expect(p.startDate).toBeNull();
    const memorial = week.lessons.find((l) => l.kind === "memorial")!;
    expect(guestPreview(week, memorial.id, () => null)).toBeNull();
    const draft = week.lessons.find((l) => l.state === "draft")!;
    expect(guestPreview(week, draft.id, () => null)).toBeNull();
  });

  it("a preview reads the photos of the approved speakers who have one, each once — and at most four at a time", async () => {
    const w = emptyWeek();
    const [a, b, c, d] = [addSpeaker(w, "f"), addSpeaker(w, "m"), addSpeaker(w, "f"), addSpeaker(w, "m")];
    for (const s of [a, b, c, d]) addApproach(w, s, "positive").public_ok = s !== c;
    a.has_photo = true;
    c.has_photo = true; // not approved: never read
    d.has_photo = true;
    closeWith(w, addLesson(w, 0, 510, 600), d, a);
    closeWith(w, addLesson(w, 1, 510, 600), a, b, c);
    expect(guestPhotoIds(guestRows(w))).toEqual([d.id, a.id]);

    let at = 0;
    let most = 0;
    const read = async (id: number) => {
      at++;
      most = Math.max(most, at);
      await new Promise((r) => setTimeout(r, 1));
      at--;
      if (id === 3) throw new Error("network");
      return id === 5 ? null : { photo: `p${id}` };
    };
    const ids = Array.from({ length: 11 }, (_, i) => i + 1);
    const { photos, failed } = await readPhotos(ids, read);
    expect(most).toBe(4);
    expect(failed).toBe(1);
    expect([...photos.keys()].sort((x, y) => x - y)).toEqual(ids.filter((i) => i !== 3 && i !== 5));
    expect(photos.get(7)).toBe("p7");
    expect(await readPhotos([], read)).toEqual({ photos: new Map(), failed: 0 });
  });
});
