// The two parts of v12 together, in the demo (DemoPort on the engine, DemoSettings): the archive the import makes is
// a past year for «סיכום המחזור» and «איך עבר בשנים קודמות»; a re-run of its label never deletes a review
// (`archive_reviewed`); its purge clears what last year's sheet said; start_edition and its dry run take the live real
// edition as the previous one — never the import, though its id is newer. tests/sql/importAfter.test.ts is the same in
// the database. Synthetic data only.
import { describe, expect, it } from "vitest";
import { CommandError } from "./commands";
import { DemoPort } from "./demoPort";
import type { ArchiveLessonRow, SpeakerRow } from "./imports";
import { EMPTY_REVIEW } from "./reviews";

const LABEL = "תשפ\"ו (לדוגמה)";
const NOTE = "הסעה/תשלום: איסוף מתחנה לדוגמה";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof CommandError ? e.code : `raw:${String(e)}`;
  }
};
const merge = (n: number, id: number): SpeakerRow => ({
  row: n, action: "merge", speaker_id: id, title: null, name: "x", gender: null, affiliation: null, topics: [], phone: null, email: null, notes: null,
});
const lesson = (n: number, start: number, speakers: number[], import_note: string | null = null): ArchiveLessonRow => ({
  row: n, day: 0, start_min: start, end_min: start + 90, room: 0, title: `שיעור לדוגמה ${n}`, category_id: null, audience: null,
  sources_kind: "pending", print_when: "none", sources_note: null, pay_amount: null, import_note, speakers,
});
/** The demo, with last year imported: speaker 1 (who teaches this week's Sunday 08:30) taught there, with a note. */
async function imported() {
  const d = new DemoPort();
  const res = await d.imports.commit({
    kind: "tracking",
    payload: { label: LABEL, start_date: null, source: "tracking-5786", titles_from: null, speakers: [merge(2, 1)], lessons: [lesson(2, 510, [0], NOTE), lesson(3, 600, [0])] },
  });
  return { d, archive: Number(res.edition_id) };
}

describe("the archive's label by its key, in the demo (app.label_key ≡ labelKey)", () => {
  it("an edition stored with gershayim answers to the label typed with an ASCII quote — and with curly ones", async () => {
    const d = new DemoPort();
    await d.settings.startEdition({ label: "מחזור ״בדיקה״", start_date: null, first_day_from: null });
    const payload = (label: string) => ({ label, start_date: null, source: "tracking-5786", titles_from: null, speakers: [merge(2, 1)], lessons: [lesson(2, 510, [0])] });
    expect(await code(d.imports.commit({ kind: "tracking", payload: payload('מחזור "בדיקה"') }))).toBe("edition_exists");
    const first = await d.imports.commit({ kind: "tracking", payload: payload("ארכיון ״בדיקה״") });
    const again = await d.imports.commit({ kind: "tracking", payload: payload("ארכיון “בדיקה”") });
    expect([again.edition_id, again.replaced]).toEqual([first.edition_id, 1]);
    expect((await d.editions()).filter((e) => e.kind === "archive").map((e) => e.label)).toEqual(['ארכיון "בדיקה"']);
  });
});

describe("the import of 5786 meets after the week, in the demo", () => {
  it("the imported year is a past year: a returning speaker in the summary, its review on the speaker's sheet", async () => {
    const { d, archive } = await imported();
    expect(archive).toBeGreaterThan(1);
    expect((await d.reviews.returning(1)).find((r) => r.speaker_id === 1)?.editions).toEqual(expect.arrayContaining([LABEL]));
    const w = await d.loadWeek(archive);
    const first = w.lessons.find((l) => l.start_min === 510)!;
    expect(await d.reviews.save(archive, first.id, 0, { ...EMPTY_REVIEW, went_well: "עבר טוב באשתקד", invite_again: "yes" })).toBe(1);
    // read as this year's edition reads it — not as the archive (the newest edition by id) would
    expect((await d.reviews.ofSpeaker(1)).filter((r) => r.edition_label === LABEL).map((r) => [r.edition_kind, r.went_well])).toEqual([["archive", "עבר טוב באשתקד"]]);
  });

  it("a content member's speaker sheet still reads the live edition's reviews when a newer archive exists", async () => {
    const content = new DemoPort({ memberId: 3, role: "content" });
    content.engine(1).week.edition.kind = "real"; // a real edition's content team (a demo week gives no access across the years)
    const before = await content.reviews.ofSpeaker(1);
    expect(before.length).toBeGreaterThan(0);
    // an archive edition newer than the live one (as the import installs it)
    const live = content.engine(1).week;
    content.installWeek({ ...structuredClone({ ...live, speakers: [] }), speakers: live.speakers, edition: { ...live.edition, id: 50, label: LABEL, kind: "archive", status: "archived" }, lessons: [], lessonSpeakers: [] });
    expect(await content.reviews.ofSpeaker(1)).toEqual(before);
  });

  it("a re-run of the label is refused once a review is on it — the lessons and the review stay", async () => {
    const { d, archive } = await imported();
    const w = await d.loadWeek(archive);
    await d.reviews.save(archive, w.lessons[0].id, 0, { ...EMPTY_REVIEW, went_well: "נכתב" });
    const again = { label: LABEL, start_date: null, source: "tracking-5786", titles_from: null, speakers: [merge(2, 1)], lessons: [lesson(2, 870, [0])] };
    expect(await code(d.imports.commit({ kind: "tracking", payload: again }))).toBe("archive_reviewed");
    expect((await d.loadWeek(archive)).lessons.map((l) => l.start_min)).toEqual([510, 600]);
    expect((await d.reviews.ofEdition(archive)).map((r) => r.went_well)).toEqual(["נכתב"]);
  });

  it("the purge of the imported archive: no date needed, the sheet's notes cleared, reported; the lessons kept", async () => {
    const { d, archive } = await imported();
    const before = await d.loadWeek(archive);
    const cmds = d.commands(archive);
    expect(await Promise.all(before.lessons.map((l) => cmds.importNote(l.id)))).toEqual([NOTE, null]);
    // never in the Week (nor so in the offline copy): read one lesson at a time, under the transport details' rule
    expect(JSON.stringify(before)).not.toContain(NOTE);
    const report = await d.settings.purgeEdition(archive, LABEL);
    expect(report).toMatchObject({ transport_details: 0, import_notes: 1, links_revoked: 0, link_hits: 0 });
    const w = await d.loadWeek(archive);
    expect(w.lessons.map((l) => l.state)).toEqual(["closed", "closed"]);
    expect(await Promise.all(w.lessons.map((l) => cmds.importNote(l.id)))).toEqual([null, null]);
    expect((await d.editions()).find((e) => e.id === archive)?.purged_at).toBe(report.purged_at);
    expect((await d.settings.purgeEdition(archive, LABEL)).import_notes).toBe(0);
  });

  it("start_edition and its dry run carry from the live real edition, archive only it, and leave the import as it is", async () => {
    const d = new DemoPort();
    const real = await d.settings.startEdition({ label: "מחזור לדוגמה", start_date: null, first_day_from: null });
    d.engine(real).week.edition.settings.confirm_template = "נוסח של השנה";
    const res = await d.imports.commit({
      kind: "tracking",
      payload: { label: LABEL, start_date: null, source: "tracking-5786", titles_from: null, speakers: [merge(2, 1)], lessons: [lesson(2, 510, [0])] },
    });
    const archive = Number(res.edition_id);
    expect(archive).toBeGreaterThan(real); // the import is the newest edition by id
    d.engine(archive).week.edition.settings = { lesson_minutes: 75, row_minutes: 90, confirm_template: "נוסח של הארכיון" };
    const preview = await d.settings.previewStart(true);
    expect(preview.archive).toEqual([{ id: real, label: "מחזור לדוגמה" }]);
    expect(preview.carry_from).toEqual({ id: real, label: "מחזור לדוגמה" });
    const next = await d.settings.startEdition({ label: "מחזור לדוגמה ב", start_date: null, first_day_from: null }, { deactivateTeam: true });
    const all = await d.editions();
    expect(all.find((e) => e.id === archive)).toMatchObject({ kind: "archive", status: "archived" });
    expect(all.find((e) => e.id === real)).toMatchObject({ kind: "real", status: "archived" });
    expect(all.find((e) => e.id === next)?.settings.confirm_template).toBe("נוסח של השנה");
  });
});
