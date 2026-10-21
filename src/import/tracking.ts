// (b) Last year's tracking sheet → an archive edition of closed lessons (DESIGN «ייבוא תשפ"ו»; the appendix's
// columns: מרצה · שיעור ב · כותרת · מקורות (נשלח?) · הסעה/תשלום · טלפון · «קיבל הודעת סיכום מ» · נושא).
//   * when: «שיעור ב» read by parseWhen; unreadable → the row is «מדולג» with the reason. Only a start written: the
//     end of the grid's lesson row that starts then — else «מדולג».
//   * speakers: one or more names per row, each matched to the pool as the candidates are (one choice per speaker,
//     not per row). A name on a line under the first is an ExtraLine (src/import/lines.ts): «מרצה נוסף/ת», «שיוך
//     מוסדי» or «לא לייבא» — the read proposes an affiliation only for an institution's word («ישיבת…»), «לא לייבא»
//     for an escort's name; any other line the admin decides. The row's phone goes to its speaker's contacts — decided
//     after the admin's choices: to the one speaker of the row still imported (planLessons), never when two are.
//   * a phone or an e-mail in the speaker's cell (beside a name, a line of its own, «(טל' …)») or in the title is
//     taken out (stripContacts) — never a name, an affiliation or a title: the speaker cell's one phone is the row's
//     when «טלפון» is empty, its one e-mail the speaker's when the row has one; any other is dropped, and said.
//   * «כפולה» where the sheet writes it — «שיעור ב», beside the name, or a cell that says only it; never a word of a
//     title («זהות כפולה»: the title whole, the row not double). «שיעור להורים» where a cell begins with it.
//   * «כפולה» rows: consecutive rows marked so are one group; the admin decides per group — parallel lessons (each
//     its own room) or one merged lesson (the speakers together; its range from the first start to the last end,
//     and when every row is the same slot, that slot and the next one: «הצעה», shown).
//   * «נושא» → a category through a table the admin confirms (a category of the same name is proposed; else none).
//   * «מקורות» → the lesson's sources through the translations table (src/import/sources.ts).
//   * «הסעה/תשלום»: a plain number is the amount; anything else is kept, as the sheet's words, in the import note —
//     with «קיבל הודעת סיכום מ» (a trainee's name: a note, never a member) and any other note column. Phones and
//     e-mails are taken out of the note (scrubContacts): the team reads it.
//   * memorial times are not imported («זמן זיכרון» rows: the fallen are entered in the app only).
// Rooms: lessons that overlap get «מקביל 2», «מקביל 3»… (the sheet does not say where).
import type { ArchiveLessonRow, ArchivePayload, SpeakerRow } from "../data/imports";
import { ARCHIVE_LAST_DAY_UNTIL, IMPORT_RULES } from "../data/importRules";
import { LIMITS } from "../data/speakerRules";
import { STAGE_LIMITS } from "../data/stageRules";
import { nameKey } from "../domain/nameKey";
import { TEMPLATE_2026 } from "../domain/template2026";
import { type Day, overlaps } from "../domain/time";
import type { Category, Gender, PrintWhen, SourcesKind } from "../domain/types";
import type { Mapping } from "./fields";
import { actionOf, ambiguousInSheet, type Choice, fillPlan, matchSpeaker, type Resolved, resolveChoice, type RowStatus, sheetMatches, type SpeakerMatch } from "./match";
import type { MatchContext } from "./candidates";
import { normalizeEmail, normalizePhone, scrubContacts, stripContacts } from "./phone";
import { affiliationText, escortWords, type ExtraLine, extraLine, type LineAs } from "./lines";
import { cellOf, columnNames, dataRows, labelledCells, noteLines } from "./rows";
import { type SourcesRule, sourcesKey, translateSources } from "./sources";
import { splitSpeakers, splitTitle, titleGender } from "./speakerName";
import type { Grid } from "./table";
import { parseWhen, rowEnd, type When, type WhenProblem } from "./when";

export const WHEN_PROBLEM: Record<WhenProblem, string> = {
  no_day: "לא כתוב יום (ראשון עד חמישי)",
  not_in_week: "יום מחוץ לשבוע (ראשון עד חמישי)",
  no_time: "לא כתובה שעה",
  bad_time: "השעה לא נקראה (צריך למשל 8:30 או 8:30-10:00, בכפולות של 5 דקות)",
  two_days: "בתא כתובים שני ימים — לא מנחשים איזה מהם",
  ambiguous_night: "«ליל» ויום אחד — לא ברור אם הלילה שלפני היום או שאחריו (כותבים «ליל שני–שלישי» או «שני 00:30»)",
};

/** «כפולה» as a word of its own — never inside one («הכפולה», «כפולות»). */
const DOUBLE = /(?<![א-ת])כפולה(?![א-ת])/;
/** The marker with the dash, comma or brackets around it, on one line («הרב פלוני - כפולה», «(כפולה)»). */
const DOUBLE_MARK = /[ \t\-–—־,]*\(?[ \t]*(?<![א-ת])כפולה(?![א-ת])[ \t]*\)?[ \t\-–—־,]*/g;
/** «שיעור להורים» where it marks the lesson: a cell (or the rest of «שיעור ב») that BEGINS with it — never a title that mentions it. */
const PARENTS = /^[\s\-–—־,.:()]*שיעור\s+להורים/;
/** A memorial row: a speaker, title or time cell that BEGINS with «זמן זיכרון» («זמן זיכרון א», «זמן זיכרון – …»). */
const MEMORIAL = /^\s*זמן\s*זיכרון/;
/**
 * «כפולה» set off in a title — in any bracket («(כפולה)», «[כפולה]», «(כפולה!)»), after a dash or a comma at the end
 * («- כפולה.»), or before one at the start: no marker — the title is never cut — but said («השורה לא סומנה ככפולה»).
 */
const DOUBLE_SET_OFF = /[([{]\s*כפולה\s*[.!?]*\s*[)\]}]|[-–—־,]\s*כפולה\s*[.!?]*\s*$|^\s*כפולה\s*[.!?]*\s*[-–—־,:]/m;
const chars = (s: string) => [...s].length;
const oneLine = (s: string) => s.replace(/\n/g, " ").trim();

export interface TrackingRow {
  row: number;
  /** Why the row is «מדולג» (null: read). */
  skip: string | null;
  warnings: string[];
  /** Marked «כפולה». */
  double: boolean;
  when: When | null;
  /** Why «שיעור ב» was not read (a «כפולה» row may take its group's time). */
  whenProblem: string | null;
  /** Its speakers' name keys, in order (the first leads). */
  speakerKeys: string[];
  title: string | null;
  topic: string;
  sources: string;
  transport: string;
  confirmFrom: string;
  audience: string | null;
  /** «כותרת: ערך» lines for the import note (not yet cleared of phones). */
  notes: string[];
  /** The row's phone, read (it goes to the row's speaker — the one still imported after the admin's choices). */
  phone: { value: string; key: string | null } | null;
}

export interface TrackingSpeaker {
  key: string;
  title: string | null;
  name: string;
  gender: Gender | null;
  /** «שיוך מוסדי»: a line under the name in its cell («(ישיבת דוגמה)»), when it was read as one. */
  affiliation: string | null;
  phone: string | null;
  phoneKey: string | null;
  /** An e-mail its cell held (a row of one speaker): taken out of the cell, kept as the speaker's. */
  email: string | null;
  /** The rows it teaches in. */
  rows: number[];
}

export type { ExtraLine, LineAs };

export interface TrackingRead {
  rows: TrackingRow[];
  speakers: TrackingSpeaker[];
  /** The speaker cells' lines that may be an affiliation (in the sheet's order). */
  lines: ExtraLine[];
}

export interface TrackingOptions {
  headerRow: number | null;
  titles: readonly string[];
  genderFromTitle: boolean;
  /** The escorts' names (the column the admin named): a line that holds one is proposed «לא לייבא». */
  escorts?: readonly string[];
  /** The admin's choice for a line (ExtraLine.id → what it is). */
  lineAs?: ReadonlyMap<string, LineAs>;
}

/** A cell that only says «כפולה» marks the row; it is not a value. */
const markOnly = (s: string) => DOUBLE.test(s) && s.replace(DOUBLE, "").replace(/[\s()'"\-–—־,.]/g, "") === "";
const value = (s: string) => (markOnly(s) ? "" : s);
/** A name with the «כפולה» marker beside it: the marker out, the lines kept. */
export const withoutMark = (s: string) =>
  s
    .split("\n")
    .map((line) => line.replace(DOUBLE_MARK, " ").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

/** A speaker cell as lines of names: «פלוני + פלמוני» on one line are two speakers, each line apart. */
const cellLines = (cell: string) => withoutMark(cell).split("\n").map((line) => splitSpeakers(line));

export function readTracking(grid: Grid, m: Mapping, o: TrackingOptions): TrackingRead {
  const names = columnNames(grid, o.headerRow);
  const data = dataRows(grid, o.headerRow);
  // each speaker cell without its phones and e-mails — a contact is never a name, a line or an affiliation
  const stripped = new Map(data.map(({ row, cells }) => [row, stripContacts(cellOf(cells, m, "speaker"))]));
  const escorts = escortWords(o.escorts ?? []);
  const speakers = new Map<string, TrackingSpeaker>();
  const lines: ExtraLine[] = [];
  const rows = data.map(({ row, cells }): TrackingRow => {
    const warnings: string[] = [];
    // the markers are read in the mapped columns only — a column left «לא לייבא» is not read at all
    const mapped = cells.filter((_, i) => m[i] != null);
    const inCell = stripped.get(row)!;
    const speakerCell = inCell.text;
    const whenRaw = cellOf(cells, m, "when");
    // «כפולה» where the sheet writes it: in «שיעור ב», beside the name in the speaker's cell, or a cell that says only
    // it — never a word of a title («זהות כפולה»), and a title is never cut
    const double = DOUBLE.test(speakerCell) || DOUBLE.test(whenRaw) || mapped.some(markOnly);
    const base: Omit<TrackingRow, "skip"> = {
      row, warnings, double, when: null, whenProblem: null, speakerKeys: [], title: null, topic: "", sources: "", transport: "", confirmFrom: "", audience: null, notes: [], phone: null,
    };
    // the title first: a row skipped (a memorial time, its time unread) is still recognized by it in the preview — a
    // phone or an e-mail never in it
    const titleCell = value(cellOf(cells, m, "title"));
    const inTitle = stripContacts(titleCell);
    if (inTitle.phones.length || inTitle.emails.length) warnings.push("הוסר טלפון או מייל מהכותרת — לא נשמר");
    base.title = oneLine(inTitle.text) || null;
    if (!double && DOUBLE_SET_OFF.test(titleCell)) warnings.push("בכותרת כתוב «כפולה» — השורה לא סומנה ככפולה. אם זו כפולה, כותבים «כפולה» בעמודת «שיעור ב»");
    if (["speaker", "title", "when"].some((f) => MEMORIAL.test(cellOf(cells, m, f)))) return { ...base, skip: "זמן זיכרון — לא מיובא (זמני הזיכרון נבנים במסך «זמני זיכרון»)" };
    const whenCell = oneLine(whenRaw);
    const w = whenCell ? parseWhen(whenCell) : "no_time";
    const when = typeof w === "string" ? null : w;
    const whenProblem = typeof w === "string" ? WHEN_PROBLEM[w] : null;
    const notes: string[] = [];
    // «שיעור ב» after its time, the «כפולה» marker out — ONE string, read for the parents' lesson and for the note
    // alike («כפולה שיעור להורים», «- כפולה, שיעור להורים»: the audience, and no note)
    const bare = when?.rest.replace(new RegExp(DOUBLE, "g"), "") ?? "";
    const whenParents = PARENTS.test(bare);
    const rest = bare.replace(PARENTS, "").replace(/[\s,.()-]+/g, " ").trim();
    if (rest) notes.push(`שיעור ב: ${whenCell}`);
    // the speakers: the first line's names; every name on a line under it is an ExtraLine — a speaker, the
    // affiliation of the name above, or left out, as the admin chooses (the read proposes only an institution's
    // affiliation and an escort's «לא לייבא»)
    const speakerKeys: string[] = [];
    const affiliations: { key: string; text: string }[] = [];
    let above: { key: string; name: string } | null = null;
    let index = 0;
    for (const [i, line] of cellLines(speakerCell).entries()) {
      for (const raw of line) {
        index++;
        const { title, name } = splitTitle(raw, o.titles);
        const key = nameKey(name);
        if (!key) continue;
        if (i > 0 && above) {
          const l = extraLine(`${row}:${index}`, row, raw, above, escorts, o.lineAs);
          lines.push(l);
          if (l.as === "affiliation") {
            affiliations.push({ key: above.key, text: affiliationText(raw) });
            continue;
          }
          if (l.as !== "speaker") continue; // «לא לייבא», or undecided: none, until the admin chooses («ייבוא» waits)
        }
        if (chars(name) > LIMITS.name) return { ...base, skip: `שם המרצה ארוך מ-${LIMITS.name} תווים` };
        if (!speakerKeys.includes(key)) speakerKeys.push(key);
        const s = speakers.get(key) ?? { key, title, name, gender: o.genderFromTitle ? titleGender(title) : null, affiliation: null, phone: null, phoneKey: null, email: null, rows: [] };
        if (!s.title && title) Object.assign(s, { title, gender: o.genderFromTitle ? titleGender(title) : null });
        s.rows.push(row);
        speakers.set(key, s);
        above = { key, name };
      }
    }
    // a speaker's affiliation lines, together (the first row that gives one; never past the pool's limit)
    for (const key of new Set(affiliations.map((a) => a.key))) {
      const s = speakers.get(key);
      if (!s || s.affiliation) continue;
      const text = affiliations.filter((a) => a.key === key).map((a) => a.text).join(", ");
      if (chars(text) > LIMITS.affiliation) warnings.push(`השיוך המוסדי ארוך מ-${LIMITS.affiliation} תווים — לא נשמר`);
      else s.affiliation = text;
    }
    if (speakerKeys.length === 0 && !double) return { ...base, when, whenProblem, skip: "אין מרצה" };
    base.speakerKeys = speakerKeys;
    // the phone: read here; it goes to the row's speaker — when one is left after the admin's choices (planLessons)
    let phone = normalizePhone(cellOf(cells, m, "phone"));
    if (phone.problem) warnings.push("הטלפון לא נשמר: לא נראה כמו מספר");
    // a phone the speaker's cell held: the row's when «טלפון» is empty and it is the only one; else dropped, and said
    const inCellPhones = [...new Map(inCell.phones.map((x) => normalizePhone(x)).filter((x) => x.value).map((x) => [x.key, x])).values()];
    if (inCellPhones.length === 1 && !phone.value && !phone.problem) {
      phone = inCellPhones[0];
      warnings.push("הטלפון שבתא המרצה נלקח כטלפון של השורה");
    } else if (inCellPhones.some((x) => x.key !== phone.key) || inCell.phones.length > inCellPhones.length) warnings.push("הוסר טלפון מתא המרצה — לא נשמר");
    // an e-mail the speaker's cell held: the speaker's, when the row has one speaker and the cell one address
    const inCellMails = [...new Set(inCell.emails.map((x) => normalizeEmail(x).value).filter((x): x is string => !!x))];
    if (inCellMails.length === 1 && inCell.emails.length === 1 && speakerKeys.length === 1) {
      const s = speakers.get(speakerKeys[0])!;
      if (s.email == null || s.email === inCellMails[0]) {
        s.email = inCellMails[0];
        warnings.push("המייל שבתא המרצה נשמר כמייל של המרצה");
      } else warnings.push("הוסר מייל מתא המרצה — לא נשמר (למרצה כבר מייל משורה אחרת)");
    } else if (inCell.emails.length) warnings.push("הוסר מייל מתא המרצה — לא נשמר");
    if (!phone.problem && phone.value) {
      base.phone = { value: phone.value, key: phone.key };
      if (speakerKeys.length === 1) {
        const s = speakers.get(speakerKeys[0])!;
        if (!s.phone) Object.assign(s, { phone: phone.value, phoneKey: phone.key });
      }
    }
    const title = base.title;
    if (title && chars(title) > IMPORT_RULES.lesson_title) return { ...base, title: null, skip: `הכותרת ארוכה מ-${IMPORT_RULES.lesson_title} תווים` };
    notes.push(...noteLines(labelledCells(cells, m, "note", names)));
    // «שיעור להורים»: a mapped cell that begins with it (the title «שיעור להורים», a note column), or «שיעור ב» after its time
    const audience = mapped.some((c) => PARENTS.test(c)) || whenParents ? "שיעור להורים" : null;
    return {
      ...base,
      skip: when || double ? null : whenProblem,
      when,
      whenProblem,
      topic: oneLine(value(cellOf(cells, m, "topic"))),
      sources: value(cellOf(cells, m, "sources")),
      transport: value(cellOf(cells, m, "transport")),
      confirmFrom: oneLine(value(cellOf(cells, m, "confirmFrom"))),
      audience,
      notes,
    };
  });
  return { rows, speakers: [...speakers.values()], lines };
}

export interface DoubleGroup {
  /** The first row's number — the group's name. */
  id: number;
  rows: number[];
}

/**
 * Consecutive rows marked «כפולה» (the same day, when both say one): one group each — until a row names speakers the
 * group has none of AND starts at a time none of its rows starts at: that is the next double lesson, not this one
 * (two double lessons one after the other). One speaker all night («כל הלילה», three rows) and two speakers in one
 * slot stay one group.
 */
export function doubleGroups(read: TrackingRead): DoubleGroup[] {
  const out: DoubleGroup[] = [];
  const byRow = new Map(read.rows.map((r) => [r.row, r]));
  let cur: { g: DoubleGroup; day: Day | null } | null = null;
  for (const r of read.rows) {
    if (r.skip || !r.double) {
      cur = null;
      continue;
    }
    const members = cur ? cur.g.rows.map((n) => byRow.get(n)!) : [];
    const shares = r.speakerKeys.some((k) => members.some((x) => x.speakerKeys.includes(k)));
    const sameSlot = r.when == null || members.some((x) => x.when?.start === r.when!.start);
    const another = cur != null && r.speakerKeys.length > 0 && !shares && !sameSlot;
    if (cur && !another && (cur.day == null || r.when == null || r.when.day === cur.day)) {
      cur.g.rows.push(r.row);
      cur.day ??= r.when?.day ?? null;
      continue;
    }
    cur = { g: { id: r.row, rows: [r.row] }, day: r.when?.day ?? null };
    out.push(cur.g);
  }
  return out;
}

export type GroupDecision = "parallel" | "merge";

/** A topic's key, as the category table compares it. */
export const topicKey = (s: string) => nameKey(s);

/** The distinct «נושא» values, with how many rows have each. */
export function topicsOf(read: TrackingRead): { key: string; text: string; count: number }[] {
  const m = new Map<string, { key: string; text: string; count: number }>();
  for (const r of read.rows) {
    if (r.skip || !r.topic) continue;
    const k = topicKey(r.topic);
    const e = m.get(k) ?? { key: k, text: r.topic, count: 0 };
    e.count++;
    m.set(k, e);
  }
  return [...m.values()];
}

/** The category the table proposes for a topic: one whose name is the same (quotes, spaces aside) — else none. */
export function proposedCategory(topic: string, categories: readonly Category[]): number | null {
  const k = topicKey(topic);
  return categories.find((c) => topicKey(c.name) === k)?.id ?? null;
}

/** The distinct «מקורות» values (by sourcesKey), with a sample of each and how many rows have it. */
export function sourcesValuesOf(read: TrackingRead): { key: string; text: string; count: number }[] {
  const m = new Map<string, { key: string; text: string; count: number }>();
  for (const r of read.rows) {
    if (r.skip) continue;
    const k = sourcesKey(r.sources);
    const e = m.get(k) ?? { key: k, text: oneLine(r.sources), count: 0 };
    e.count++;
    m.set(k, e);
  }
  return [...m.values()];
}

/** A plain number in «הסעה/תשלום» («300», «₪300», «300 ש"ח») — the amount; anything else is words. */
export function plainAmount(cell: string): number | null {
  const m = /^\s*(?:₪\s*)?([0-9]{1,6})\s*(?:₪|ש["״]?ח|שקלים|שקל)?\s*$/.exec(cell);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= STAGE_LIMITS.amount_max ? n : null;
}

export interface LessonPlan {
  /** The sheet rows it comes from (one; or a merged group's). */
  rows: number[];
  skip: string | null;
  warnings: string[];
  day: Day;
  start_min: number;
  end_min: number;
  /** Its range was inferred (a merged group in one slot → that slot and the next; three rows → three slots): «הצעה». */
  rangeSuggested: boolean;
  /** How many of the grid's lesson slots an inferred range spans (null when it was not inferred). */
  rangeSlots: number | null;
  room: number;
  title: string | null;
  category_id: number | null;
  audience: string | null;
  sources_kind: SourcesKind;
  print_when: PrintWhen;
  sources_note: string | null;
  pay_amount: number | null;
  import_note: string | null;
  speakerKeys: string[];
  /** Its rows' phones, each to the row's one speaker still imported after the admin's choices (the speaker's key). */
  phones: { speaker: string; value: string; key: string | null; row: number }[];
}

export interface PlanInput {
  decisions: ReadonlyMap<number, GroupDecision>;
  /** A speaker the admin said is another row's speaker («אותו/ה מרצה כמו …»): its key → that speaker's key. */
  alias?: ReadonlyMap<string, string>;
  /** The speakers the admin left out («לא לייבא», «דילוג»): a row's phone goes to the one speaker left, if one is. */
  skipped?: ReadonlySet<string>;
  /** topic key → category id (null: none). */
  categories: ReadonlyMap<string, number | null>;
  sources: ReadonlyMap<string, SourcesRule>;
}

/** The lesson rows of the template that day, in order. */
const lessonRows = () => TEMPLATE_2026.filter((r) => r.kind === "lesson").sort((a, b) => a.start_min - b.start_min);

/** Thursday ended at 19:00 last year (DESIGN, «הסיום בחמישי ב-19:00»; an archive edition's last_day_until). */
const THURSDAY_ENDED = ARCHIVE_LAST_DAY_UNTIL;

/** The lessons the sheet makes, with the admin's decisions — null while a «כפולה» group waits for one. */
export function planLessons(read: TrackingRead, input: PlanInput): LessonPlan[] | null {
  const groups = doubleGroups(read);
  if (groups.some((g) => !input.decisions.has(g.id))) return null;
  const byRow = new Map(read.rows.map((r) => [r.row, r]));
  const inGroup = new Map(groups.flatMap((g) => g.rows.map((n) => [n, g] as const)));
  const plans: LessonPlan[] = [];
  /** A row's speakers as the commit will have them: each through the admin's «אותו/ה מרצה כמו …». */
  const keysOf = (rs: TrackingRow[]) => [...new Set(rs.flatMap((r) => r.speakerKeys.map((k) => input.alias?.get(k) ?? k)))];
  /** A row (or group) that makes no lesson — its title and speakers kept, so the preview names it. */
  const skipped = (rows: number[], why: string, at?: When | null): LessonPlan => {
    const rs = rows.map((n) => byRow.get(n)).filter((r): r is TrackingRow => !!r);
    return {
      rows, skip: why, warnings: rs.flatMap((r) => r.warnings), day: (at?.day ?? 0) as Day, start_min: at?.start ?? 0, end_min: at?.end ?? 0, rangeSuggested: false,
      rangeSlots: null, room: 0, title: rs.find((r) => r.title)?.title ?? null, category_id: null, audience: null, sources_kind: "pending", print_when: "none", sources_note: null,
      pay_amount: null, import_note: null, speakerKeys: keysOf(rs), phones: [],
    };
  };

  /** One lesson from some rows of the sheet (one row, or a merged group). */
  const lessonOf = (rs: TrackingRow[], at: { day: Day; start: number; end: number; suggested: boolean; slots?: number }): LessonPlan => {
    const warnings = rs.flatMap((r) => r.warnings);
    const speakerKeys = keysOf(rs);
    // a row's phone: to its speaker — a row of one speaker gave it when read; a row of more is decided now, after the
    // admin's choices: to the one speaker of the row still imported, if one is
    const phones: LessonPlan["phones"] = [];
    for (const r of rs) {
      if (!r.phone || r.speakerKeys.length < 2) continue;
      const left = [...new Set(r.speakerKeys.filter((k) => !input.skipped?.has(k)).map((k) => input.alias?.get(k) ?? k))];
      if (left.length === 1) phones.push({ speaker: left[0], value: r.phone.value, key: r.phone.key, row: r.row });
      else if (left.length > 1) warnings.push("הטלפון לא נשמר: יש בשורה יותר ממרצה אחד/ת");
    }
    const where = { day: at.day, start: at.start, end: at.end, rest: "" };
    if (speakerKeys.length === 0) return skipped(rs.map((r) => r.row), "אין מרצה", where);
    if (at.day === 4 && at.end > THURSDAY_ENDED) return skipped(rs.map((r) => r.row), "השבוע של אשתקד נגמר בחמישי ב-19:00 — לא היה שיעור בשעה הזו", where);
    const titles = [...new Set(rs.map((r) => r.title).filter((t): t is string => !!t))];
    const notes: string[] = [];
    if (titles.length > 1) notes.push(...titles.slice(1).map((t) => `כותרת נוספת: ${t}`));
    const topicRow = rs.find((r) => r.topic);
    const sourcesRow = rs.find((r) => r.sources.trim()) ?? rs[0];
    const src = translateSources(sourcesRow.sources, input.sources);
    // the sources' own words («אחר») are read by the team too: no phone, no e-mail in them
    if (src.sources_note) {
      const sc = scrubContacts(src.sources_note);
      if (sc.scrubbed) warnings.push("הוסר טלפון או מייל מהערת המקורות");
      src.sources_note = sc.text.trim() || null;
    }
    let pay: number | null = null;
    for (const r of rs) {
      if (!r.transport.trim()) continue;
      const n = plainAmount(r.transport);
      if (n != null && pay == null) pay = n;
      else notes.push(`הסעה/תשלום: ${oneLine(r.transport)}`);
    }
    for (const r of rs) {
      if (r.confirmFrom) notes.push(`קיבל הודעת סיכום מ: ${r.confirmFrom}`);
      notes.push(...r.notes);
    }
    const scrub = scrubContacts(notes.join("\n"));
    if (scrub.scrubbed) warnings.push("הוסר טלפון או מייל מההערה");
    const note = scrub.text.trim() || null;
    if (note && chars(note) > IMPORT_RULES.import_note) return skipped(rs.map((r) => r.row), `ההערות ארוכות מ-${IMPORT_RULES.import_note} תווים`);
    if (src.sources_note && chars(src.sources_note) > STAGE_LIMITS.sources_note) return skipped(rs.map((r) => r.row), `ערך המקורות ארוך מ-${STAGE_LIMITS.sources_note} תווים`);
    return {
      rows: rs.map((r) => r.row),
      skip: null,
      warnings,
      day: at.day,
      start_min: at.start,
      end_min: at.end,
      rangeSuggested: at.suggested,
      rangeSlots: at.suggested ? (at.slots ?? null) : null,
      room: 0,
      title: titles[0] ?? null,
      category_id: topicRow ? (input.categories.get(topicKey(topicRow.topic)) ?? null) : null,
      audience: rs.some((r) => r.audience) ? "שיעור להורים" : null,
      sources_kind: src.sources_kind,
      print_when: src.print_when,
      sources_note: src.sources_note,
      pay_amount: pay,
      import_note: note,
      speakerKeys,
      phones,
    };
  };

  /** A row's own range: as written, or its start's grid row. */
  const rangeOf = (r: TrackingRow, fallback: When | null): { day: Day; start: number; end: number } | string => {
    const w = r.when ?? fallback;
    if (!w) return r.whenProblem ?? WHEN_PROBLEM.no_time;
    const end = w.end ?? rowEnd(w.start);
    if (end == null) return "רק שעת התחלה, והיא אינה תחילת שורה ברשת";
    return { day: w.day, start: w.start, end };
  };

  const done = new Set<number>();
  for (const r of read.rows) {
    if (done.has(r.row)) continue;
    if (r.skip) {
      plans.push(skipped([r.row], r.skip, r.when));
      continue;
    }
    const g = inGroup.get(r.row);
    if (!g) {
      const at = rangeOf(r, null);
      plans.push(typeof at === "string" ? skipped([r.row], at) : lessonOf([r], { ...at, suggested: false }));
      continue;
    }
    g.rows.forEach((n) => done.add(n));
    const rs = g.rows.map((n) => byRow.get(n)!);
    const first = rs.find((x) => x.when)?.when ?? null;
    if (input.decisions.get(g.id) === "parallel") {
      for (const x of rs) {
        const at = rangeOf(x, first);
        plans.push(typeof at === "string" ? skipped([x.row], at) : lessonOf([x], { ...at, suggested: x.when == null }));
      }
      continue;
    }
    // one merged lesson: from the first start to the last end; every row the same slot → that slot and the next ones,
    // one more per row past the first, at least one («הצעה» — «כל הלילה» was three such rows)
    const ranges = rs.map((x) => rangeOf(x, first));
    const ok = ranges.filter((x): x is { day: Day; start: number; end: number } => typeof x !== "string");
    if (ok.length === 0) {
      plans.push(skipped(g.rows, typeof ranges[0] === "string" ? ranges[0] : WHEN_PROBLEM.no_time));
      continue;
    }
    const start = Math.min(...ok.map((x) => x.start));
    let end = Math.max(...ok.map((x) => x.end));
    let suggested = false;
    let slots = 1;
    if (ok.every((x) => x.start === ok[0].start && x.end === ok[0].end)) {
      for (let k = 0; k < Math.max(1, ok.length - 1); k++) {
        const next = lessonRows().find((x) => x.start_min >= end);
        if (!next) break;
        end = next.end_min;
        slots++;
        suggested = true;
      }
    }
    plans.push(lessonOf(rs, { day: ok[0].day, start, end, suggested, slots }));
  }

  // rooms: a lesson takes the first room free at its time; a speaker is never in two lessons at once
  const kept = plans.filter((p) => !p.skip).sort((a, b) => a.day - b.day || a.start_min - b.start_min || a.rows[0] - b.rows[0]);
  const placed: LessonPlan[] = [];
  for (const p of kept) {
    const clash = placed.find((q) => q.day === p.day && overlaps(q.start_min, q.end_min, p.start_min, p.end_min) && q.speakerKeys.some((k) => p.speakerKeys.includes(k)));
    if (clash) {
      p.skip = `המרצה כבר משובץ/ת בשעה הזו (שורה ${clash.rows[0]})`;
      continue;
    }
    let room = 0;
    while (placed.some((q) => q.day === p.day && q.room === room && overlaps(q.start_min, q.end_min, p.start_min, p.end_min))) room++;
    if (room >= IMPORT_RULES.rooms) {
      p.skip = `יותר מ-${IMPORT_RULES.rooms} שיעורים באותה שעה`;
      continue;
    }
    p.room = room;
    placed.push(p);
  }
  return plans.sort((a, b) => a.rows[0] - b.rows[0]);
}

/** The rows left out anyway — by the read («מדולג»: no time, a memorial…) or by the plan: a line of one waits for nothing. */
export function skippedRows(read: TrackingRead, plans: readonly LessonPlan[] | null): Set<number> {
  return new Set([...read.rows.filter((r) => r.skip).map((r) => r.row), ...(plans ?? []).filter((p) => p.skip).flatMap((p) => p.rows)]);
}

/** The lines still waiting for the admin's choice — never one of a row left out anyway (deciding it changes nothing). */
export function openLines(read: TrackingRead, plans: readonly LessonPlan[] | null): ExtraLine[] {
  const skipped = skippedRows(read, plans);
  return read.lines.filter((l) => l.as == null && !skipped.has(l.row));
}

export interface TrackingSpeakerPreview {
  speaker: TrackingSpeaker;
  status: RowStatus;
  match: SpeakerMatch;
  fills: string[];
}

export function previewTrackingSpeakers(read: TrackingRead, ctx: MatchContext): TrackingSpeakerPreview[] {
  const out = read.speakers.map((s): TrackingSpeakerPreview => {
    const match = matchSpeaker(s.key, s.phoneKey, ctx.pool, ctx.phones);
    const target = match.status === "match" ? ctx.pool.find((x) => x.id === match.target) : undefined;
    const d = { title: s.title, gender: s.gender, affiliation: s.affiliation, topics: [], phone: s.phone, email: s.email, notes: null };
    return { speaker: s, status: match.status, match, fills: target ? fillPlan(target, ctx.flags.get(target.id), d) : [] };
  });
  // the speakers new to the pool, against the earlier ones of the sheet: the same phone, or a name 0.6 alike
  const fresh = out.filter((x) => x.status === "new");
  const sheet = sheetMatches(
    fresh.map((x) => ({ ref: x.speaker.key, key: x.speaker.key, phoneKey: x.speaker.phoneKey, label: `${x.speaker.title ? `${x.speaker.title} ` : ""}${x.speaker.name} (שורה ${x.speaker.rows[0]})` })),
  );
  return out.map((x) => (sheet.has(x.speaker.key) ? { ...x, status: "ambiguous" as const, match: ambiguousInSheet(x.match, sheet.get(x.speaker.key)) } : x));
}

/** Each sheet speaker's action as the commit takes it — «כמו …» followed (null: undecided). */
export function resolvedSpeakers(speakers: TrackingSpeakerPreview[], choices: ReadonlyMap<string, Choice>): Map<string, Resolved | null> {
  const by = new Map(speakers.map((s) => [s.speaker.key, s]));
  const own = (k: string) => {
    const s = by.get(k);
    return s ? actionOf(s.status, s.match, choices.get(k)) : null;
  };
  return new Map(speakers.map((s) => [s.speaker.key, resolveChoice(s.speaker.key, own)]));
}

/** «אותו/ה מרצה כמו …»: a speaker's key → the key of the one it is (its lessons are that speaker's). */
export function speakerAliases(speakers: TrackingSpeakerPreview[], choices: ReadonlyMap<string, Choice>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, r] of resolvedSpeakers(speakers, choices)) if (r?.action === "new" && r.as != null) out.set(k, r.as);
  return out;
}

/**
 * The phones the admin's choices give (planLessons): a row of two speakers, one left — that speaker's key → the row's
 * phone (its key, and the row). What the preview shows («יש טלפון (משורה N, אחרי הבחירות)») is what the payload sends.
 */
export function phonesAfterChoices(plans: readonly LessonPlan[]): Map<string, { value: string; key: string | null; row: number }> {
  const out = new Map<string, { value: string; key: string | null; row: number }>();
  for (const p of plans) if (!p.skip) for (const ph of p.phones) if (!out.has(ph.speaker)) out.set(ph.speaker, { value: ph.value, key: ph.key, row: ph.row });
  return out;
}

export interface ArchiveMeta {
  label: string;
  start_date: string | null;
  source: string;
  titles_from: number | null;
}

/**
 * The commit's payload: the lessons kept, and the speakers they need (each once). Null while a speaker waits for a
 * choice. A lesson whose every speaker was skipped is left out.
 */
export function archivePayload(plans: LessonPlan[], speakers: TrackingSpeakerPreview[], choices: ReadonlyMap<string, Choice>, meta: ArchiveMeta): ArchivePayload | null {
  const action = resolvedSpeakers(speakers, choices);
  const lessons = plans.filter((p) => !p.skip);
  const used = lessons.flatMap((p) => p.speakerKeys);
  // a speaker the admin said is another's («כמו …»): its lessons are that one's (planLessons, `alias`); it still
  // goes — under that speaker's name — so the commit completes that speaker with what it brings (its phone)
  const aliasOf = (s: TrackingSpeakerPreview) => {
    const a = action.get(s.speaker.key);
    return a?.action === "new" && a.as != null ? a.as : null;
  };
  if (used.some((k) => action.get(k) == null)) return null;
  if (speakers.some((s) => action.get(s.speaker.key) == null && used.includes(s.speaker.key))) return null;
  const byKey = new Map(speakers.map((s) => [s.speaker.key, s.speaker]));
  // a row's phone to its one speaker left after the choices (planLessons) — for a speaker the read gave none
  const rowPhone = phonesAfterChoices(plans);
  const rows: SpeakerRow[] = [];
  const ref = new Map<string, number>();
  for (const s of speakers) {
    const a = action.get(s.speaker.key);
    const as = aliasOf(s);
    if (a == null || a.action === "skip" || !used.includes(as ?? s.speaker.key)) continue;
    if (!as) ref.set(s.speaker.key, rows.length);
    rows.push({
      row: s.speaker.rows[0], action: a.action, speaker_id: a.action === "merge" ? a.target : null,
      title: s.speaker.title, name: as ? byKey.get(as)!.name : s.speaker.name, gender: s.speaker.gender, affiliation: s.speaker.affiliation, topics: [],
      phone: s.speaker.phone ?? (as ? null : (rowPhone.get(s.speaker.key)?.value ?? null)), email: s.speaker.email, notes: null,
    });
  }
  const out: ArchiveLessonRow[] = [];
  for (const p of lessons) {
    const refs = p.speakerKeys.flatMap((k) => (ref.has(k) ? [ref.get(k)!] : []));
    if (refs.length === 0) continue;
    out.push({
      row: p.rows[0], day: p.day, start_min: p.start_min, end_min: p.end_min, room: p.room, title: p.title, category_id: p.category_id, audience: p.audience,
      sources_kind: p.sources_kind, print_when: p.print_when, sources_note: p.sources_note, pay_amount: p.pay_amount, import_note: p.import_note, speakers: refs,
    });
  }
  return { label: meta.label, start_date: meta.start_date, source: meta.source, titles_from: meta.titles_from, speakers: rows, lessons: out };
}
