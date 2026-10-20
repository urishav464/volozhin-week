// «איך עבר» after the week, and the year it closes (DESIGN «שלבים», שלב 4): the
// pure rules both implementations and the screens share — when a lesson's review
// opens to its handler (Israel time, as the database counts it), which year is
// «earlier» than another (the summary's returning speakers), and the words.
// supabase/schema.sql has the same rules: app.review_opens_on, app.earlier_edition.
import type { Edition } from "./types";
import { addDays, israelDate } from "./israelTime";

/** «להזמין שוב?» — yes, no, maybe (null: not said). */
export type InviteAgain = "yes" | "no" | "maybe";
export const INVITE_AGAIN: readonly InviteAgain[] = ["yes", "no", "maybe"];
export const INVITE_LABEL: Record<InviteAgain, string> = { yes: "כן", no: "לא", maybe: "אולי" };

/** The longest «מה עבד» / «מה פחות», in characters (the CHECK on lesson_reviews). */
export const REVIEW_TEXT_MAX = 2000;

/**
 * The first Israel date on which a lesson's «איך עבר» opens to its handler: the day after the calendar day the lesson
 * ends on — a night lesson in a day's column (00:30, end_min 1560) ends on the next date (app.review_opens_on).
 */
export function reviewOpensOn(startDate: string, day: number, endMin: number): string {
  return addDays(startDate, day + Math.floor((endMin - 1) / 1440) + 1);
}

/**
 * Where a lesson's «איך עבר» stands for its handler today: the week's date is TBD («tbd»), the day has not passed yet
 * («before», with the date it opens), or open. An admin of the edition may write in all three.
 */
export type ReviewWindow = { state: "tbd" } | { state: "before"; opensOn: string } | { state: "open"; opensOn: string };

export function reviewWindow(edition: Pick<Edition, "start_date">, lesson: { day: number; end_min: number }, nowIso: string): ReviewWindow {
  if (!edition.start_date) return { state: "tbd" };
  const opensOn = reviewOpensOn(edition.start_date, lesson.day, lesson.end_min);
  return israelDate(nowIso) >= opensOn ? { state: "open", opensOn } : { state: "before", opensOn };
}

/** Has the edition's week ended — Friday 00:00 in Israel, start_date + 5 (when the links expire)? Never while TBD. */
export function weekOver(edition: Pick<Edition, "start_date">, nowIso: string): boolean {
  return !!edition.start_date && israelDate(nowIso) >= addDays(edition.start_date, 5);
}

/** May the edition's private data be purged now: its week is over, or it is archived (public.purge_edition_private). */
export function purgeAllowed(edition: Pick<Edition, "start_date" | "kind" | "status">, nowIso: string): boolean {
  return edition.kind === "archive" || edition.status === "archived" || weekOver(edition, nowIso);
}

const past = (e: Pick<Edition, "kind" | "status">) => e.kind === "archive" || e.status === "archived";

/**
 * Is `other` a year before `self`? By the weeks' dates when both are known; otherwise a past year (an archive, or an
 * archived real edition) is before one that is not (app.earlier_edition).
 */
export function earlierEdition(other: Pick<Edition, "start_date" | "kind" | "status">, self: Pick<Edition, "start_date" | "kind" | "status">): boolean {
  if (other.start_date && self.start_date) return other.start_date < self.start_date;
  return past(other) && !past(self);
}
