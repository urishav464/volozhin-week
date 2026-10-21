// «סיכום המחזור» (milestone 6): the year in numbers, made in the browser from the
// loaded Week, the edition's «איך עבר» and the returning speakers — pure, so a
// test reads every number. Counts only, never a threshold: no «too few», no
// «unbalanced» (nobody decided one). Memorial times never count in the gender
// balance or the categories (DESIGN «צורות התא»). Out: the screen, print, and an
// xlsx through the one writer (src/exports/xlsx.ts — every cell through guardCell).
import type { LessonReview, ReturningSpeaker } from "../data/reviews";
import { displayName } from "../domain/names";
import type { InviteAgain } from "../domain/reviews";
import { DAY_NAMES, DAYS, type Day } from "../domain/time";
import type { Lesson, Week } from "../domain/types";
import { dayBalance } from "../rules/balance";
import type { Table } from "./table";
import { gridOrder, teachingWhen, whenCell } from "./tracking";

/** A closed lesson as the summary names it. */
export interface SummaryLesson {
  lesson_id: number;
  day: Day;
  /** «ראשון 08:30–09:45» as a file's cell writes it (the time left to right). */
  when: string;
  speaker: string;
  title: string | null;
}

export interface SummaryReviewed extends SummaryLesson {
  rating: number | null;
  overran: boolean;
  went_well: string | null;
  issues: string | null;
}

export interface EditionSummary {
  label: string;
  /** Closed lessons (not memorial times). */
  held: number;
  /** Memorial times with a plan placed on them. */
  memorial: number;
  /** Per day: closed lessons by their speakers' gender (a co-taught lesson splits its one), memorial times never. */
  days: { day: Day; f: number; m: number; unknown: number; lessons: number }[];
  /** Closed lessons per category, in the categories' order; «בלי קטגוריה» last when there are any. */
  categories: { name: string; count: number }[];
  /** The speakers of the closed lessons: who taught in an earlier year, and who is new. */
  speakers: { total: number; returning: { id: number; name: string; editions: string[] }[]; fresh: { id: number; name: string }[] };
  /** «איך עבר»: written for how many of the closed lessons, and which are missing. */
  reviews: { done: number; total: number; missing: SummaryLesson[] };
  /** The reviews' «להזמין שוב?» answers, each list in grid order. */
  invite: Record<InviteAgain, SummaryReviewed[]>;
}

export const NO_CATEGORY = "בלי קטגוריה";

/** The closed lessons the summary is about: kind lesson, closed. */
function heldLessons(week: Week): Lesson[] {
  return week.lessons.filter((l) => l.kind === "lesson" && l.state === "closed").sort(gridOrder(week));
}

export function editionSummary(week: Week, reviews: LessonReview[], returning: ReturningSpeaker[]): EditionSummary {
  const held = heldLessons(week);
  const speakers = new Map(week.speakers.map((s) => [s.id, s]));
  const leadOf = (id: number) => week.lessonSpeakers.find((x) => x.lesson_id === id && x.role === "lead")?.speaker_id ?? null;
  const nameOf = (id: number | null) => {
    const s = id == null ? undefined : speakers.get(id);
    return s ? displayName(s) : "TBD";
  };
  const asLesson = (l: Lesson): SummaryLesson => ({
    lesson_id: l.id, day: l.day, when: whenCell(teachingWhen(l, week.edition.settings?.lesson_minutes)), speaker: nameOf(leadOf(l.id)), title: l.title,
  });

  const days = DAYS.map((day) => {
    const t = dayBalance(day, week, 0).closed;
    return { day, f: t.f, m: t.m, unknown: t.unknown, lessons: held.filter((l) => l.day === day).length };
  });

  const byCategory = new Map<number | null, number>();
  for (const l of held) byCategory.set(l.category_id, (byCategory.get(l.category_id) ?? 0) + 1);
  const categories = [...week.categories]
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
    .filter((c) => byCategory.has(c.id))
    .map((c) => ({ name: c.name, count: byCategory.get(c.id)! }));
  const none = [...byCategory.entries()].filter(([id]) => id == null || !week.categories.some((c) => c.id === id)).reduce((a, [, n]) => a + n, 0);
  if (none > 0) categories.push({ name: NO_CATEGORY, count: none });

  const taught = [...new Set(week.lessonSpeakers.filter((x) => held.some((l) => l.id === x.lesson_id)).map((x) => x.speaker_id))];
  const past = new Map(returning.map((r) => [r.speaker_id, r.editions]));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "he");
  const returningList = taught.filter((id) => (past.get(id) ?? []).length > 0).map((id) => ({ id, name: nameOf(id), editions: past.get(id)! })).sort(byName);
  const fresh = taught.filter((id) => !(past.get(id) ?? []).length).map((id) => ({ id, name: nameOf(id) })).sort(byName);

  const reviewOf = new Map(reviews.map((r) => [r.lesson_id, r]));
  const missing = held.filter((l) => !reviewOf.has(l.id)).map(asLesson);
  const invite: Record<InviteAgain, SummaryReviewed[]> = { yes: [], no: [], maybe: [] };
  for (const l of held) {
    const r = reviewOf.get(l.id);
    if (!r?.invite_again) continue;
    // the review is about the lead speaker it was written about (a reopened lesson may have another now)
    invite[r.invite_again].push({ ...asLesson(l), speaker: nameOf(r.speaker_id ?? leadOf(l.id)), rating: r.rating, overran: r.overran, went_well: r.went_well, issues: r.issues });
  }

  return {
    label: week.edition.label,
    held: held.length,
    memorial: (week.memorialPlans ?? []).filter((p) => p.lesson_id != null && week.lessons.some((l) => l.id === p.lesson_id && l.kind === "memorial")).length,
    days,
    categories,
    speakers: { total: taught.length, returning: returningList, fresh },
    reviews: { done: held.length - missing.length, total: held.length, missing },
    invite,
  };
}

/** A tally as the screen and the file write it: whole numbers plainly, a co-taught half as «2.5». */
export function tally(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export const INVITE_TITLE: Record<InviteAgain, string> = { yes: "להזמין שוב", no: "לא להזמין", maybe: "אולי" };

/** The summary as sheets of one xlsx (the same numbers as the screen). */
export function summaryTables(s: EditionSummary): Table[] {
  const lessonRow = (l: SummaryLesson) => [l.when, l.speaker, l.title ?? "TBD"];
  const reviewed = (l: SummaryReviewed) => [...lessonRow(l), l.rating == null ? "" : String(l.rating), l.overran ? "כן" : "", l.went_well ?? "", l.issues ?? ""];
  return [
    {
      name: "סיכום",
      headers: ["מה", "כמה"],
      rows: [
        ["שיעורים שהתקיימו", String(s.held)],
        ["זמני זיכרון (עם תוכנית)", String(s.memorial)],
        ["מרצים", String(s.speakers.total)],
        ["מרצים חדשים", String(s.speakers.fresh.length)],
        ["מרצים שלימדו בשנים קודמות", String(s.speakers.returning.length)],
        ["«איך עבר» נכתב", `${s.reviews.done} מתוך ${s.reviews.total}`],
        ...(Object.keys(INVITE_TITLE) as InviteAgain[]).map((k) => [`«${INVITE_TITLE[k]}»`, String(s.invite[k].length)]),
      ],
      widths: [34, 16],
    },
    {
      name: "ימים",
      headers: ["יום", "שיעורים", "נשים", "גברים", "מגדר לא ידוע"],
      rows: s.days.map((d) => [DAY_NAMES[d.day], String(d.lessons), tally(d.f), tally(d.m), tally(d.unknown)]),
      widths: [12, 10, 10, 10, 14],
    },
    { name: "קטגוריות", headers: ["קטגוריה", "שיעורים"], rows: s.categories.map((c) => [c.name, String(c.count)]), widths: [28, 10] },
    {
      name: "מרצים",
      headers: ["מרצה", "חדש/ה או לימד/ה קודם", "בשנים"],
      rows: [...s.speakers.fresh.map((x) => [x.name, "חדש/ה", ""]), ...s.speakers.returning.map((x) => [x.name, "לימד/ה קודם", x.editions.join(", ")])],
      widths: [28, 22, 30],
    },
    {
      name: "איך עבר",
      headers: ["רשימה", "יום ושעה", "מרצה", "כותרת", "ציון", "חרג/ה מהזמן", "מה עבד", "מה פחות"],
      rows: [
        ...(Object.keys(INVITE_TITLE) as InviteAgain[]).flatMap((k) => s.invite[k].map((l) => [INVITE_TITLE[k], ...reviewed(l)])),
        ...s.reviews.missing.map((l) => ["עוד לא נכתב", ...lessonRow(l), "", "", "", ""]),
      ],
      widths: [14, 20, 24, 28, 8, 12, 40, 40],
      landscape: true,
    },
  ];
}

