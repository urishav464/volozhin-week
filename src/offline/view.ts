// The read-only day view's words and its first day — pure, in Israel time whatever the device's clock zone says.
import { addDays, israelLocal } from "../domain/israelTime";
import { parseDay } from "../domain/routes";
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

/**
 * The week's own addresses (the reset, phase 2: a trainee's «השבוע» is /week, the old grid /grid; phase 3: the staff's
 * «ימים», /day/:d): the day view is them — read-only from the copy.
 */
const WEEK = new Set(["week", "grid", "day"]);

/** The team's sections by their first path segment, as the header names them — every one but the week needs a connection. */
const SECTIONS: Record<string, string> = {
  myday: "היום שלי",
  speakers: "מרצים",
  lesson: "עמוד השיעור",
  approvals: "אישורים",
  after: "אחרי השבוע",
  tracking: "תוצרים",
  print: "תוצרים",
  export: "תוצרים",
  reader: "תוצרים",
  logistics: "לוגיסטיקה",
  memorial: "זמני זיכרון",
  kk: "מכריכה לכריכה",
  knowledge: "ידע",
  help: "עזרה",
  settings: "הגדרות",
};

/**
 * The section an address asked for that the offline day view cannot show (it shows only the week): «לוגיסטיקה» (its
 * home, `/logistics` with no tab, and every tab — the home's tasks read the rota, מכריכה לכריכה and the transports),
 * «זמני זיכרון» and the rest read the server, one list at a time. null for the week itself — and for `/`, so a
 * logistics member who starts offline there sees the week's copy (offline, nothing redirects to their home).
 */
export function sectionNeedingConnection(path: string): string | null {
  const first = path.split("/").filter(Boolean)[0];
  if (!first || WEEK.has(first)) return null;
  return SECTIONS[first] ?? "המסך הזה";
}

/** The day an address asks the offline day view to open on: `/day/2` → 2; any other address (or a bad day) → null. */
export function offlineDayOf(path: string): Day | null {
  const [first, d] = path.split("/").filter(Boolean);
  return first === "day" ? parseDay(d) : null;
}
