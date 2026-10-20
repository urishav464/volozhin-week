// Calendar days in Israel, whatever the device's clock zone — what the links'
// rules count in (DESIGN «גישה בלי חשבון»): a speaker's phone from W−7, a link
// that ends with the week. The database counts the same way: `now() at time
// zone 'Asia/Jerusalem'` and `(date)::timestamp at time zone 'Asia/Jerusalem'`.

const TZ = "Asia/Jerusalem";

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function israelParts(ms: number): { date: string; hm: string } {
  const p = Object.fromEntries(parts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}

/** The date in Israel at an instant: «2027-02-07». */
export function israelDate(iso: string): string {
  return israelParts(Date.parse(iso)).date;
}

/** «2027-02-14» + n days (calendar arithmetic, no clock zone involved). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The instant of 00:00 in Israel on a date (Israel is UTC+2, or +3 in summer; its clock changes at 02:00, never at midnight). */
export function israelMidnight(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  for (const offset of [2, 3]) {
    const ms = Date.UTC(y, m - 1, d, -offset);
    const p = israelParts(ms);
    if (p.date === date && p.hm === "00:00") return new Date(ms).toISOString();
  }
  throw new Error(`no midnight in Israel on ${date}`);
}

/** An instant as Israel's wall clock, in the shape a datetime-local field takes: «2027-01-10T20:00». */
export function israelLocal(iso: string): string {
  const p = israelParts(Date.parse(iso));
  return `${p.date}T${p.hm}`;
}

/**
 * The instant Israel's wall clock reads «2027-01-10T20:00» — whatever the device's clock zone, so a window typed on a
 * laptop abroad still opens at that hour in Israel. null for anything else, and for an hour the clock skips (02:00–03:00
 * on the night summer time starts).
 */
export function israelInstant(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  // the later offset first: in the hour the clock repeats (the night summer time ends) the first of the two is kept
  for (const offset of [3, 2]) {
    const ms = Date.UTC(y, mo - 1, d, h - offset, mi);
    const p = israelParts(ms);
    if (`${p.date}T${p.hm}` === local.trim()) return new Date(ms).toISOString();
  }
  return null;
}

/** «10.1.2027 20:00» — an instant as Israel reads it. */
export function israelMoment(iso: string): string {
  const p = israelParts(Date.parse(iso));
  const [y, mo, d] = p.date.split("-").map(Number);
  return `${d}.${mo}.${y} ${p.hm}`;
}
