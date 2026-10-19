// The week's clock. A day column runs from 06:30 to 06:30 the next morning,
// stored as minutes since that day's midnight: 390 … 1830. A lesson at 00:30
// on the night after Sunday is (day 0, 1470) — the night belongs to the day
// before it by construction, the way the poster draws it.

export const DAY_START = 390; // 06:30
export const DAY_END = 1830; // 06:30 next morning
export const DAYS = [0, 1, 2, 3, 4] as const;
export type Day = (typeof DAYS)[number];

export const DAY_NAMES: Record<Day, string> = {
  0: "ראשון",
  1: "שני",
  2: "שלישי",
  3: "רביעי",
  4: "חמישי",
};

/** 1470 → "00:30", 510 → "08:30". */
export function fmt(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "14:30–16:00" (start first; the caller wraps it in <bdi> for RTL). */
export function fmtRange(start: number, end: number): string {
  return `${fmt(start)}–${fmt(end)}`;
}

/**
 * "00:30" → 1470: anything before 06:30 is the night after the day.
 * Returns null for anything that is not HH:MM.
 */
export function parseClock(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  const v = h * 60 + mm;
  return v < DAY_START ? v + 1440 : v;
}

/** Absolute minute of the week: day*1440 + minute — what the database's `span` uses. */
export function weekMinute(day: Day, min: number): number {
  return day * 1440 + min;
}

/** Half-open overlap: a lesson ending at 15:30 does not clash with one starting at 15:30. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** The calendar date of a day column (night hours still belong to the column's date). */
export function dateOf(startDate: string | null, day: Day): Date | null {
  if (!startDate) return null;
  const [y, m, d] = startDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + day));
}

/** "15.2" — the poster's short date. */
export function shortDate(date: Date): string {
  return `${date.getUTCDate()}.${date.getUTCMonth() + 1}`;
}

/** "כ״ח בשבט" — Hebrew calendar date, without the year. */
export function hebrewDate(date: Date): string {
  return new Intl.DateTimeFormat("he-IL-u-ca-hebrew", { day: "numeric", month: "long", timeZone: "UTC" }).format(date);
}
