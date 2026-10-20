// The read-only day view's words and its first day — pure, in Israel time whatever the device's clock zone says.
import { addDays, israelLocal } from "../domain/israelTime";
import { DAY_START, type Day } from "../domain/time";

const TZ = "Asia/Jerusalem";
const WEEKDAY = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "long" });

/** «יום שלישי 20.10 בשעה 14:05» — when the snapshot was loaded, as the banner says it. */
export function savedAtText(iso: string): string {
  const ms = Date.parse(iso);
  const [date, hm] = israelLocal(iso).split("T");
  const [, m, d] = date.split("-").map(Number);
  return `${WEEKDAY.format(new Date(ms))} ${d}.${m} בשעה ${hm}`;
}

/**
 * The day column «now» falls in, when the week is on: its date in Israel, the small hours (before 06:30) still the
 * day before's column, as the grid draws them. null before or after the week, or while its date is TBD.
 */
export function todayColumn(startDate: string | null, nowIso: string): Day | null {
  if (!startDate) return null;
  const [date, hm] = israelLocal(nowIso).split("T");
  const [h, mi] = hm.split(":").map(Number);
  const column = h * 60 + mi < DAY_START ? addDays(date, -1) : date;
  for (let i = 0; i < 5; i++) if (addDays(startDate, i) === column) return i as Day;
  return null;
}
