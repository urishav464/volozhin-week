// The transport request's pickup time (the reset, phase 2 — the lesson page): typed in a time input as «HH:MM», kept
// as typed in `pickup_time`, and as `pickup_min` — minutes from 00:00 of the lesson's grid day (the grid's clock: a
// day runs 06:30 … 06:30, so 00:30 of the night after it is 1470). Pure.

/** The latest pickup_min the database takes (CONTRACT «Transport in two parts»: 0 … 1830). */
export const PICKUP_MIN_MAX = 1830;

/** «7:05» / «07:05» / «07.05» → 425 (minutes of the clock, 0 … 1439); anything else null. */
function clockMinutes(text: string): number | null {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/**
 * The pickup's minute on the lesson's grid day: of the clock's minute m and m + 1440 (the night after, while it is
 * still the day's — at most 1830), the one nearer the lesson's start; on a tie, m. null when `hhmm` is not a time.
 * So «23:40» before a 00:30 lesson (1470) is 1420, and «00:10» before it is 1450; «08:00» before a 10:00 lesson is 480.
 */
export function pickupMin(hhmm: string, lessonStart: number): number | null {
  const m = clockMinutes(hhmm);
  if (m == null) return null;
  const night = m + 1440;
  if (night > PICKUP_MIN_MAX) return m;
  return Math.abs(night - lessonStart) < Math.abs(m - lessonStart) ? night : m;
}

/**
 * What a time input can start from: a stored pickup time that is a clock time, as «HH:MM» (zero-padded); "" for
 * anything else — a pickup typed as words by an older screen («אחרי השיעור»), which the form shows beside the input.
 */
export function pickupInput(text: string | null | undefined): string {
  const m = text == null ? null : clockMinutes(text);
  if (m == null) return "";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * The pickup's minute on the lesson's grid day as every logistics view reads it (moved here from the transport board in
 * v20, so the «הסעות וצוות» print and the staff's schedule read it the same way): `pickup_time` is what every reader
 * shows, and set_transport_details rewrote it while leaving pickup_min as it was — so pickup_min counts only while it is
 * the time typed (the same minute of the clock: it keeps the request's day-or-night choice); a time typed since → its
 * own minute (pickupMin); words («אחרי השיעור») or no time at all → null (not a time).
 */
export function typedPickupMin(start: number, d: { pickup_time: string | null; pickup_min: number | null } | null | undefined): number | null {
  const typed = d?.pickup_time?.trim();
  if (!typed) return null;
  const fresh = pickupMin(typed, start);
  if (fresh == null) return null;
  return d!.pickup_min != null && d!.pickup_min % 1440 === fresh % 1440 ? d!.pickup_min : fresh;
}
