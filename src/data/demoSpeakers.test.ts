// The pool in demo mode: the same engine as the parity tests, plus what only
// the demo has to get right — one speaker list across its editions, the
// contacts across them, the timeline, the hand-over's team, and synthetic data
// that shows every group of «המרצים שלי».
import { describe, expect, it } from "vitest";
import { mySpeakers, pendingSpeakers } from "../domain/mine";
import { CommandError } from "./commands";
import { DemoPort } from "./demoPort";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${String(e)}`;
  }
};

describe("the demo's speaker pool", () => {
  it("starts with a speaker in every group of «המרצים שלי», a hand-over for the demo user and a queue to approve", async () => {
    const port = new DemoPort();
    const week = await port.loadWeek(1);
    const g = mySpeakers(week, 1);
    for (const group of ["offered", "to_approach", "awaiting", "to_schedule", "closed"] as const) expect(g.get(group)!.length, group).toBeGreaterThan(0);
    expect(pendingSpeakers(week).length).toBe(5);
    expect(JSON.stringify(week)).not.toMatch(/טלפון לדוגמה|example\.org/); // contacts never travel with a week
  });

  it("searches first, then creates; the new speaker reaches every edition", async () => {
    const port = new DemoPort();
    const s = port.speakers;
    expect((await s.matches("מרצה 007")).map((m) => `${m.name}:${m.match}`)).toEqual(["מרצה 07:similar"]);
    expect(await s.matches("מרצה 7")).toEqual([]); // 0.5: not alike enough
    expect(await code(s.create(1, { name: "מרצה 07" }))).toBe("speaker_exists");
    expect(await code(s.create(1, { name: "מרצה 007" }))).toBe("speaker_similar");
    const second = await port.settings.startEdition({ label: "מחזור לדוגמה", start_date: null, first_day_from: null });
    const made = await s.create(second, { name: "מרצה 007", gender: "f" }, { confirmed: true, claim: true, approve: true });
    expect(made.approach_id).not.toBeNull();
    for (const ed of [1, second]) expect((await port.loadWeek(ed)).speakers.find((x) => x.id === made.speaker_id)).toMatchObject({ vetted: "approved" });
    // the demo user is the global admin: their new speaker is approved at once only when asked
    const other = await s.create(1, { name: "מרצה חדשה לגמרי" });
    expect((await port.loadWeek(second)).speakers.find((x) => x.id === other.speaker_id)?.vetted).toBe("pending");
    await s.vet([other.speaker_id], "approved", "נבדק");
    expect((await port.loadWeek(second)).speakers.find((x) => x.id === other.speaker_id)).toMatchObject({ vetted: "approved", vetted_by: 1, vetted_note: "נבדק" });
    expect((await port.speakers.activity(other.speaker_id)).map((r) => r.kind)).toEqual(["vet", "insert"]);
  });

  it("shows synthetic contacts, takes them in, and logs which fields changed — never the values", async () => {
    const port = new DemoPort();
    const s = port.speakers;
    expect(await s.contacts(4)).toMatchObject({ phone: "טלפון לדוגמה", email: "speaker04@example.org" });
    expect(await s.contacts(5)).toEqual({ phone: null, email: null, secretary_note: null, notes: null });
    expect(await code(s.setContacts(5, { phone: "12", email: null, secretary_note: null, notes: null }))).toBe("bad_phone");
    await s.setContacts(5, { phone: "555 0100 99", email: null, secretary_note: null, notes: null });
    expect((await s.contacts(5))?.phone).toBe("555 0100 99");
    const log = await s.activity(5);
    expect(log[0]).toMatchObject({ entity: "speakers", kind: "contacts", detail: { fields: ["phone"] } });
    expect(JSON.stringify(log)).not.toContain("0100");
  });

  it("answers the hand-over waiting for the demo user, with its timeline", async () => {
    const port = new DemoPort();
    const s = port.speakers;
    const a = (await port.loadWeek(1)).approaches.find((x) => x.speaker_id === 13)!;
    expect(a).toMatchObject({ owner_member_id: 2, offered_to: 1 });
    expect((await s.activity(13)).map((r) => r.detail.note)).toContain("פנייה ראשונה (נתון לדוגמה)");
    await s.answerHandOver(1, a.id, true, "לקחתי");
    expect((await port.loadWeek(1)).approaches.find((x) => x.id === a.id)).toMatchObject({ owner_member_id: 1, offered_to: null });
    expect((await s.activity(13))[0].detail).toMatchObject({ owner: 1, note: "לקחתי" });
    expect(mySpeakers(await port.loadWeek(1), 1).get("awaiting")!.some((r) => r.speaker.id === 13)).toBe(true);
  });

  it("hands over only to an active content member of the edition — the team follows «הגדרות»", async () => {
    const port = new DemoPort();
    const s = port.speakers;
    const a = (await port.loadWeek(1)).approaches.find((x) => x.speaker_id === 32)!; // the demo user's
    expect(await code(s.handOver(1, a.id, 5))).toBe("bad_member"); // logistics
    await port.settings.updateMember(3, { active: false });
    expect(await code(s.handOver(1, a.id, 3))).toBe("bad_member");
    const added = await port.settings.addMember({ email: "new.content@example.org", display_name: "חבר/ת צוות לדוגמה", gender: null, role: "content", edition_id: 1 });
    expect(await code(s.handOver(1, a.id, added.id))).toBe("ok"); // an admin reassigns at once
    expect((await port.loadWeek(1)).approaches.find((x) => x.id === a.id)?.owner_member_id).toBe(added.id);
    // and that member now has history: deactivate, never delete
    expect(await code(port.settings.deleteMember(added.id))).toBe("member_has_history");
  });

  it("keeps a refused command from changing anything, the pool's store included", async () => {
    const port = new DemoPort();
    const before = JSON.stringify([await port.loadWeek(1), port.shared]);
    expect(await code(port.speakers.vet([1, 9999], "rejected"))).toBe("stale"); // speaker 1 changes first, then 9999 is missing
    expect(await code(port.speakers.setAvailability(1, 9, 0, "morning", "can", "x".repeat(121)))).toBe("bad_value");
    expect(JSON.stringify([await port.loadWeek(1), port.shared])).toBe(before);
  });

  it("sets an availability chip and shows a past edition's lessons", async () => {
    const port = new DemoPort();
    await port.speakers.setAvailability(1, 32, 3, "evening", "cannot", "דוגמה");
    expect((await port.loadWeek(1)).availability.filter((v) => v.day === 3)).toMatchObject([{ from_min: 1140, to_min: 1440, kind: "cannot", note: "דוגמה" }]);
    expect((await port.speakers.history(1)).map((h) => h.edition_label)).toEqual(["מחזור קודם (לדוגמה)"]);
    expect(await port.speakers.history(2)).toEqual([]);
  });

  it("a sandbox's closed lesson pins nothing; a live real edition's does — and shows in the history only to whoever sees that edition", async () => {
    const port = new DemoPort();
    // the demo week is a demo edition: speaker 1 teaches a closed lesson there, and may still be rejected
    expect(await code(port.speakers.vet([1], "rejected", "דוגמה"))).toBe("ok");
    await port.speakers.vet([1], "approved");
    const real = await port.settings.startEdition({ label: "מחזור לדוגמה", start_date: null, first_day_from: 510 });
    const { pitch_id } = await port.commands(real).propose(1, { day: 1, start_min: 510, end_min: 600, room_id: null });
    await port.commands(real).closeLesson(pitch_id);
    expect(await code(port.speakers.vet([1], "rejected"))).toBe("lesson_closed");
    expect((await port.speakers.history(1)).map((h) => h.edition_id)).toContain(real);
    // a member of the demo edition only (not of every edition) does not see this year's lesson
    port.members[0].edition_id = 1;
    expect((await port.speakers.history(1)).map((h) => h.edition_id)).not.toContain(real);
  });
});
