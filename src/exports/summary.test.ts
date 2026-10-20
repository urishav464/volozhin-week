// «סיכום המחזור» from the demo's week: lessons held, the gender balance per day without the memorial times, the
// categories, new and returning speakers, reviews done and missing, the «להזמין שוב» lists — and the xlsx sheets
// through the one writer (every cell guarded).
import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { demoReviews, demoWeek } from "../data/demoWeek";
import type { LessonReview } from "../data/reviews";
import type { Week } from "../domain/types";
import { editionSummary, NO_CATEGORY, summaryTables, tally } from "./summary";
import { toXlsx } from "./xlsx";

const reviewsOf = (week: Week): LessonReview[] => demoReviews(week).map(({ edition_id: _, ...r }) => r);

describe("editionSummary", () => {
  const week = demoWeek();
  const closed = week.lessons.filter((l) => l.kind === "lesson" && l.state === "closed");

  it("counts the closed lessons (not drafts, not memorial times) and the memorial times with a plan placed", () => {
    const s = editionSummary(week, [], []);
    expect(s.held).toBe(closed.length);
    expect(s.memorial).toBe(week.memorialPlans.filter((p) => p.lesson_id != null).length);
    expect(s.days.reduce((a, d) => a + d.lessons, 0)).toBe(closed.length);
  });

  it("tallies each day by the speakers' gender — the memorial times never count, a co-taught lesson splits its one", () => {
    const s = editionSummary(week, [], []);
    for (const d of s.days) expect(d.f + d.m + d.unknown, `day ${d.day}`).toBe(d.lessons);
    const w = structuredClone(week);
    const monday = w.lessons.find((l) => l.day === 1 && l.state === "closed" && l.kind === "lesson")!;
    const other = w.speakers.find((x) => x.gender != null && x.gender !== w.speakers.find((y) => y.id === w.lessonSpeakers.find((z) => z.lesson_id === monday.id)!.speaker_id)!.gender)!;
    w.lessonSpeakers.push({ lesson_id: monday.id, speaker_id: other.id, role: "co" });
    const before = editionSummary(week, [], []).days[1];
    const after = editionSummary(w, [], []).days[1];
    expect(after.lessons).toBe(before.lessons);
    expect(after.f + after.m).toBe(before.f + before.m);
    expect([after.f % 1, after.m % 1]).toEqual([0.5, 0.5]);
    expect(tally(2.5)).toBe("2.5");
    expect(tally(3)).toBe("3");
    // a memorial time with a speaker-like row never adds to a day
    const m = structuredClone(week);
    const slot = m.lessons.find((l) => l.kind === "memorial")!;
    m.lessonSpeakers.push({ lesson_id: slot.id, speaker_id: 1, role: "lead" });
    expect(editionSummary(m, [], []).days).toEqual(editionSummary(week, [], []).days);
  });

  it("counts the categories in their order, with «בלי קטגוריה» last when a lesson has none", () => {
    const s = editionSummary(week, [], []);
    expect(s.categories.reduce((a, c) => a + c.count, 0)).toBe(closed.length);
    const w = structuredClone(week);
    w.lessons.find((l) => l.state === "closed" && l.kind === "lesson")!.category_id = null;
    expect(editionSummary(w, [], []).categories.at(-1)).toEqual({ name: NO_CATEGORY, count: 1 });
  });

  it("splits the speakers into new and returning, with the years they taught", () => {
    const s = editionSummary(week, [], [{ speaker_id: 1, editions: ["מחזור קודם (לדוגמה)"] }, { speaker_id: 999, editions: ["x"] }]);
    expect(s.speakers.returning).toEqual([{ id: 1, name: "ד״ר מרצה 01", editions: ["מחזור קודם (לדוגמה)"] }]);
    expect(s.speakers.fresh.some((x) => x.id === 1)).toBe(false);
    expect(s.speakers.total).toBe(s.speakers.fresh.length + 1);
  });

  it("says how many reviews were written and which are missing; lists «להזמין שוב», «לא להזמין», «אולי»", () => {
    const reviews = reviewsOf(week);
    const s = editionSummary(week, reviews, []);
    expect(s.reviews).toMatchObject({ done: 3, total: closed.length });
    expect(s.reviews.missing).toHaveLength(closed.length - 3);
    expect(s.invite.yes.map((x) => x.speaker)).toEqual(["ד״ר מרצה 01"]);
    expect(s.invite.maybe).toMatchObject([{ overran: true, rating: 3 }]);
    expect(s.invite.no).toHaveLength(1);
    // a review without an answer is done, and on no list
    const silent = reviews.map((r, i) => (i === 0 ? { ...r, invite_again: null } : r));
    const t = editionSummary(week, silent, []);
    expect(t.reviews.done).toBe(3);
    expect(t.invite.yes).toEqual([]);
  });
});

describe("summaryTables", () => {
  it("writes five sheets of the same numbers, every cell through the guard — a review that starts like a formula stays text", () => {
    const week = demoWeek();
    const reviews = reviewsOf(week).map((r, i) => (i === 0 ? { ...r, went_well: "=HYPERLINK(\"x\")" } : r));
    const s = editionSummary(week, reviews, []);
    const tables = summaryTables(s);
    expect(tables.map((t) => t.name)).toEqual(["סיכום", "ימים", "קטגוריות", "מרצים", "איך עבר"]);
    expect(tables[0].rows[0]).toEqual(["שיעורים שהתקיימו", String(s.held)]);
    expect(tables[4].rows.filter((r) => r[0] === "עוד לא נכתב")).toHaveLength(s.reviews.missing.length);
    const xml = Object.entries(unzipSync(toXlsx(tables)))
      .filter(([n]) => n.startsWith("xl/worksheets/"))
      .map(([, b]) => strFromU8(b))
      .join("");
    expect(xml).toContain("'=HYPERLINK(&quot;x&quot;)");
    expect(xml).not.toMatch(/<f>/);
  });
});
