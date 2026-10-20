// (b) Last year's tracking sheet → an archive edition of closed lessons (DESIGN «ייבוא תשפ"ו»; the appendix's
// columns: מרצה · שיעור ב · כותרת · מקורות (נשלח?) · הסעה/תשלום · טלפון · «קיבל הודעת סיכום מ» · נושא).
//   * when: «שיעור ב» read by parseWhen; unreadable → the row is «מדולג» with the reason. Only a start written: the
//     end of the grid's lesson row that starts then — else «מדולג».
//   * speakers: one or more names per row, each matched to the pool as the candidates are (one choice per speaker,
//     not per row); the row's phone goes to its speaker's contacts — only when the row has one speaker.
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
import { normalizePhone, scrubContacts } from "./phone";
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
const PARENTS = /שיעור להורים/;
/** A memorial row: a speaker, title or time cell that BEGINS with «זמן זיכרון» («זמן זיכרון א», «זמן זיכרון – …»). */
const MEMORIAL = /^\s*זמן\s*זיכרון/;
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
}

export interface TrackingSpeaker {
  key: string;
  title: string | null;
  name: string;
  gender: Gender | null;
  phone: string | null;
  phoneKey: string | null;
  /** The rows it teaches in. */
  rows: number[];
}

export interface TrackingRead {
  rows: TrackingRow[];
  speakers: TrackingSpeaker[];
}

export interface TrackingOptions {
  headerRow: boolean;
  titles: readonly string[];
  genderFromTitle: boolean;
}

/** A cell that only says «כפולה» marks the row; it is not a value. */
const value = (s: string) => (DOUBLE.test(s) && s.replace(DOUBLE, "").replace(/[\s()'"-]/g, "") === "" ? "" : s);
/** A name or a title with the «כפולה» marker beside it: the marker out, the lines kept. */
export const withoutMark = (s: string) =>
  s
    .split("\n")
    .map((line) => line.replace(DOUBLE_MARK, " ").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

export function readTracking(grid: Grid, m: Mapping, o: TrackingOptions): TrackingRead {
  const names = columnNames(grid, o.headerRow);
  const speakers = new Map<string, TrackingSpeaker>();
  const rows = dataRows(grid, o.headerRow).map(({ row, cells }): TrackingRow => {
    const warnings: string[] = [];
    // the markers are read in the mapped columns only — a column left «לא לייבא» is not read at all
    const mapped = cells.filter((_, i) => m[i] != null);
    const double = mapped.some((c) => DOUBLE.test(c));
    const base: Omit<TrackingRow, "skip"> = {
      row, warnings, double, when: null, whenProblem: null, speakerKeys: [], title: null, topic: "", sources: "", transport: "", confirmFrom: "", audience: null, notes: [],
    };
    // the title first: a row skipped (a memorial time, its time unread) is still recognized by it in the preview
    base.title = oneLine(withoutMark(cellOf(cells, m, "title"))) || null;
    if (["speaker", "title", "when"].some((f) => MEMORIAL.test(cellOf(cells, m, f)))) return { ...base, skip: "זמן זיכרון — לא מיובא (זמני הזיכרון נבנים במסך «זמני זיכרון»)" };
    const whenCell = oneLine(cellOf(cells, m, "when"));
    const w = whenCell ? parseWhen(whenCell) : "no_time";
    const when = typeof w === "string" ? null : w;
    const whenProblem = typeof w === "string" ? WHEN_PROBLEM[w] : null;
    const notes: string[] = [];
    const rest = when?.rest.replace(new RegExp(DOUBLE, "g"), "").replace(PARENTS, "").replace(/[\s,.()-]+/g, " ").trim();
    if (rest) notes.push(`שיעור ב: ${whenCell}`);
    // the speakers
    const speakerKeys: string[] = [];
    const list = splitSpeakers(withoutMark(cellOf(cells, m, "speaker")));
    for (const raw of list) {
      const { title, name } = splitTitle(raw, o.titles);
      const key = nameKey(name);
      if (!key) continue;
      if (chars(name) > LIMITS.name) return { ...base, skip: `שם המרצה ארוך מ-${LIMITS.name} תווים` };
      if (!speakerKeys.includes(key)) speakerKeys.push(key);
      const s = speakers.get(key) ?? { key, title, name, gender: o.genderFromTitle ? titleGender(title) : null, phone: null, phoneKey: null, rows: [] };
      if (!s.title && title) Object.assign(s, { title, gender: o.genderFromTitle ? titleGender(title) : null });
      s.rows.push(row);
      speakers.set(key, s);
    }
    if (speakerKeys.length === 0 && !double) return { ...base, when, whenProblem, skip: "אין מרצה" };
    base.speakerKeys = speakerKeys;
    // the phone: to the speaker's contacts, when the row has exactly one
    const phone = normalizePhone(cellOf(cells, m, "phone"));
    if (phone.problem) warnings.push("הטלפון לא נשמר: לא נראה כמו מספר");
    else if (phone.value && speakerKeys.length === 1) {
      const s = speakers.get(speakerKeys[0])!;
      if (!s.phone) Object.assign(s, { phone: phone.value, phoneKey: phone.key });
    } else if (phone.value) warnings.push("הטלפון לא נשמר: יש בשורה יותר ממרצה אחד/ת");
    const title = base.title;
    if (title && chars(title) > IMPORT_RULES.lesson_title) return { ...base, title: null, skip: `הכותרת ארוכה מ-${IMPORT_RULES.lesson_title} תווים` };
    notes.push(...noteLines(labelledCells(cells, m, "note", names)));
    const audience = mapped.some((c) => PARENTS.test(c)) ? "שיעור להורים" : null;
    return {
      row,
      skip: when || double ? null : whenProblem,
      warnings,
      double,
      when,
      whenProblem,
      speakerKeys,
      title,
      topic: oneLine(value(cellOf(cells, m, "topic"))),
      sources: value(cellOf(cells, m, "sources")),
      transport: value(cellOf(cells, m, "transport")),
      confirmFrom: oneLine(value(cellOf(cells, m, "confirmFrom"))),
      audience,
      notes,
    };
  });
  return { rows, speakers: [...speakers.values()] };
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
}

export interface PlanInput {
  decisions: ReadonlyMap<number, GroupDecision>;
  /** A speaker the admin said is another row's speaker («אותו/ה מרצה כמו …»): its key → that speaker's key. */
  alias?: ReadonlyMap<string, string>;
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
      pay_amount: null, import_note: null, speakerKeys: keysOf(rs),
    };
  };

  /** One lesson from some rows of the sheet (one row, or a merged group). */
  const lessonOf = (rs: TrackingRow[], at: { day: Day; start: number; end: number; suggested: boolean; slots?: number }): LessonPlan => {
    const warnings = rs.flatMap((r) => r.warnings);
    const speakerKeys = keysOf(rs);
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
    const d = { title: s.title, gender: s.gender, affiliation: null, topics: [], phone: s.phone, email: null, notes: null };
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
  const rows: SpeakerRow[] = [];
  const ref = new Map<string, number>();
  for (const s of speakers) {
    const a = action.get(s.speaker.key);
    const as = aliasOf(s);
    if (a == null || a.action === "skip" || !used.includes(as ?? s.speaker.key)) continue;
    if (!as) ref.set(s.speaker.key, rows.length);
    rows.push({
      row: s.speaker.rows[0], action: a.action, speaker_id: a.action === "merge" ? a.target : null,
      title: s.speaker.title, name: as ? byKey.get(as)!.name : s.speaker.name, gender: s.speaker.gender, affiliation: null, topics: [], phone: s.speaker.phone, email: null, notes: null,
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
