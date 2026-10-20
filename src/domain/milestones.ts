// Milestones are counted back from the week's opening Sunday (W): days_before 42
// is W−42, 0 is W itself, a negative number is after the week (W+7). The numbers
// are the instructor's suggestion («הצעה»). Once the week has a date, each
// milestone has a real one; while it is TBD, only «W−n».
import { dateOf } from "./time";

/** «W−42», «W», «W+7» (a real minus sign). */
export function milestoneLabel(daysBefore: number): string {
  if (daysBefore === 0) return "W";
  return daysBefore > 0 ? `W−${daysBefore}` : `W+${-daysBefore}`;
}

/** The milestone's date (UTC midnight): the opening Sunday minus days_before; null while the week's date is TBD. */
export function milestoneDate(startDate: string | null, daysBefore: number): Date | null {
  const w = dateOf(startDate, 0);
  return w ? new Date(w.getTime() - daysBefore * 86_400_000) : null;
}

/** «3.1.2027». */
export function fmtDate(d: Date): string {
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
}

/** Today in Israel, as a UTC midnight — to compare with milestone dates. */
export function israelToday(now: Date = new Date()): Date {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now)
    .split("-")
    .map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Not done and its date has passed («באיחור»); false while the date is TBD. */
export function isLate(startDate: string | null, daysBefore: number, done: boolean, today: Date): boolean {
  const d = milestoneDate(startDate, daysBefore);
  return !done && d != null && d.getTime() < today.getTime();
}

/** The furthest from the week first; ties by title. */
export function byDue<T extends { days_before: number; title: string; id: number }>(a: T, b: T): number {
  return b.days_before - a.days_before || a.title.localeCompare(b.title, "he") || a.id - b.id;
}
