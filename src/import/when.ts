// «שיעור ב» — when a lesson was, as last year's tracking sheet wrote it: «ראשון 8:30», «יום ב' 10:00-11:30»,
// «רביעי 00:30» (the night belongs to the day named, as on the grid: 00:30 is 1470, «הצעה»), «חמישי 17:30 שיעור
// להורים», a range typed right to left («11:30-10:00»), «ליל שני–שלישי 00:30» (the night of Monday into Tuesday, as
// the app's own tracking table writes it). Whatever is not a day or a time is kept as the rest (the words «כפולה»,
// «שיעור להורים») for the caller. Unreadable → a problem: the row is «מדולג», with the reason, never guessed — a cell
// naming two days («רביעי 10:00 (שיעור שני)»), or the night of one day only («ליל שלישי»: the night before it, or
// after?). A day is a whole word: «שנייה», «שניים», «שלישית», «חמישים» and «השני» (an ordinal) name none. A
// lesson's end, when only its start is written, is the end of the grid's lesson row starting then.
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
export type WhenProblem = "no_day" | "not_in_week" | "no_time" | "bad_time" | "two_days" | "ambiguous_night";

const DAY_WORD: Record<string, Day> = { ראשון: 0, שני: 1, שלישי: 2, רביעי: 3, חמישי: 4 };
const LETTER: Record<string, Day> = { א: 0, ב: 1, ג: 2, ד: 3, ה: 4 };
/** A day's name as a whole word — after a start, a space or a mark, with ב or ו before it (never ה: «השני»). */
const DAY_NAME = /(?<![א-ת])[בו]?(ראשון|שני|שלישי|רביעי|חמישי)(?![א-ת])/g;
/** A day's letter: «ב'», «יום ג׳», «יום ה». */
const DAY_LETTER = /(?:(?<=^|[\s,(])(?:יום\s*)?([א-ה])['׳](?=$|[\s,).:])|יום\s+([א-ה])(?=$|[\s,).:]))/g;
/** «ליל X–Y»: the night of one day into the next — the app's own way of writing it. */
const NIGHT_OF = /(?<![א-ת])ב?ליל\s+(ראשון|שני|שלישי|רביעי|חמישי)\s*[-–—־]\s*(ראשון|שני|שלישי|רביעי|חמישי|שישי)(?![א-ת])/;
/** Friday, Shabbat, its end — outside the week (whole words: «שישים» is a number). */
const OUTSIDE = /(?<![א-ת])[בו]?(?:שישי|שבת)(?![א-ת])|מוצ["״]ש/;
/** «ליל» alone, before one day: which night it is is not said. */
const NIGHT = /(?<![א-ת])ב?ליל(?=\s)/;

/** The day a cell names — every mention of one, which must agree — or what it says instead. */
function dayOf(t: string): { day: Day; matches: string[] } | "not_in_week" | "two_days" | "ambiguous_night" | null {
  if (OUTSIDE.test(t) && !NIGHT_OF.test(t)) return "not_in_week";
  const night = NIGHT_OF.exec(t);
  if (night) {
    const [a, b] = [DAY_WORD[night[1]], night[2] === "שישי" ? 5 : DAY_WORD[night[2]]];
    if (b !== a + 1) return "two_days";
    const rest = t.replace(night[0], " ");
    const other = dayOf(rest);
    if (other === "two_days" || other === "not_in_week" || other === "ambiguous_night") return other;
    if (other && other.day !== a) return "two_days";
    return { day: a, matches: [night[0], ...(other?.matches ?? [])] };
  }
  const found: { day: Day; match: string }[] = [];
  for (const m of t.matchAll(DAY_NAME)) found.push({ day: DAY_WORD[m[1]], match: m[0] });
  for (const m of t.matchAll(DAY_LETTER)) found.push({ day: LETTER[m[1] ?? m[2]], match: m[0] });
  if (found.length === 0) return null;
  if (new Set(found.map((f) => f.day)).size > 1) return "two_days";
  if (NIGHT.test(t)) return "ambiguous_night";
  return { day: found[0].day, matches: found.map((f) => f.match) };
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
  if (d === "not_in_week" || d === "two_days" || d === "ambiguous_night") return d;
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
  let rest = t;
  for (const m of d.matches) rest = rest.replace(m, " ");
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
