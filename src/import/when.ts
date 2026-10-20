// «שיעור ב» — when a lesson was, as last year's tracking sheet wrote it: «ראשון 8:30», «יום ב' 10:00-11:30»,
// «רביעי 00:30» (the night belongs to the day named, as on the grid: 00:30 is 1470, «הצעה»), «חמישי 17:30 שיעור
// להורים», a range typed right to left («11:30-10:00»). Whatever is not a day or a time is kept as the rest (the
// words «כפולה», «שיעור להורים») for the caller. Unreadable → null: the row is «מדולג», with the reason, never
// guessed. A lesson's end, when only its start is written, is the end of the grid's lesson row starting then.
import { TEMPLATE_2026 } from "../domain/template2026";
import { type Day, DAY_END, DAY_START } from "../domain/time";
import { cleanCell } from "./table";

export interface When {
  day: Day;
  /** Minutes on the grid's day, 390–1830. */
  start: number;
  /** null: only a start was written. */
  end: number | null;
  /** What else the cell said, without the day and the times. */
  rest: string;
}

/** Why a «שיעור ב» cell was not read (the preview says it in Hebrew). */
export type WhenProblem = "no_day" | "not_in_week" | "no_time" | "bad_time";

const DAYS: [RegExp, Day][] = [
  [/ראשון/, 0],
  [/שני(?!ם|ת|ות)/, 1],
  [/שלישי/, 2],
  [/רביעי/, 3],
  [/חמישי/, 4],
];
const LETTER: Record<string, Day> = { א: 0, ב: 1, ג: 2, ד: 3, ה: 4 };

/** The day a cell names: «ראשון», «יום שני», «ב'», «יום ג׳» — or what it says instead. */
function dayOf(t: string): { day: Day; match: string } | "not_in_week" | null {
  if (/שישי|שבת|מוצ["״]ש/.test(t)) return "not_in_week";
  for (const [re, d] of DAYS) {
    const m = re.exec(t);
    if (m) return { day: d, match: m[0] };
  }
  const m = /(?:^|[\s,(])(?:יום\s*)?([א-ה])['׳](?=$|[\s,).:])/.exec(t) ?? /יום\s+([א-ה])(?=$|[\s,).:])/.exec(t);
  if (m) return { day: LETTER[m[1]], match: m[0] };
  return null;
}

const TIME = /(?<![0-9])([0-9]{1,2})[:.]([0-9]{2})(?![0-9])/g;

/** A clock time as minutes on the grid's day: before 06:30 (or, for an end, at it) is the night after the day named. */
function onGrid(h: number, m: number, asEnd: boolean): number | null {
  if (m > 59 || h > 30) return null;
  const t = h * 60 + m;
  return t < DAY_START || (asEnd && t === DAY_START) ? t + 1440 : t;
}

/** A «שיעור ב» cell read, or why not. */
export function parseWhen(cell: string): When | WhenProblem {
  const t = cleanCell(cell).replace(/\n/g, " ");
  const d = dayOf(t);
  if (d === "not_in_week") return "not_in_week";
  if (!d) return "no_day";
  const times = [...t.matchAll(TIME)].slice(0, 3);
  if (times.length === 0) return "no_time";
  if (times.length > 2) return "bad_time";
  const [a, b] = times.map((m) => [Number(m[1]), Number(m[2])] as const);
  let start: number | null = null;
  let end: number | null = null;
  if (!b) start = onGrid(a[0], a[1], false);
  else {
    // as written, else right to left (a range typed in a Hebrew line); a lesson is at most ten hours
    for (const [s, e] of [
      [a, b],
      [b, a],
    ]) {
      const ss = onGrid(s[0], s[1], false);
      const ee = onGrid(e[0], e[1], true);
      if (ss != null && ee != null && ss < ee && ee - ss <= 600) {
        [start, end] = [ss, ee];
        break;
      }
    }
    if (start == null) return "bad_time";
  }
  if (start == null || start < DAY_START || start % 5 !== 0 || (end != null && (end > DAY_END || end % 5 !== 0))) return "bad_time";
  let rest = t.replace(d.match, " ");
  for (const m of times) rest = rest.replace(m[0], " ");
  rest = rest
    .replace(/(?:^|\s)יום(?=\s|$)/g, " ")
    .replace(/[-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.()]+|[\s,.()]+$/g, "");
  return { day: d.day, start, end, rest };
}

/** The end of the grid's lesson row that starts at `start` (the 2026 template's rows), or null. */
export function rowEnd(start: number): number | null {
  return TEMPLATE_2026.find((r) => r.kind === "lesson" && r.start_min === start)?.end_min ?? null;
}
