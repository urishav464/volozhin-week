// The summary message to a speaker (DESIGN «תוצרים» 3, «הודעת סיכום») — pure,
// so every device composes the same text and a test can walk every rule.
//
// The template is the instructor's own wording, pasted from the bottom of last
// year's tracking sheet (editions.settings.confirm_template). Nothing here
// writes a sentence of its own: it only fills the template in. Anything left
// unresolved blocks sending, with a Hebrew list of what is missing — an empty
// template, a TBD (no title, no date), an unknown variable (in any branch, taken
// or not) or a broken bracket, a gender it cannot tell, an amount the template
// has no wording for, or a payment/transport still waiting for the instructor
// (DESIGN: «אין שליחת הודעת סיכום כשאישור תשלום או הסעה ממתין»).
//
// The template's language (docs/DECISIONS.md, אבן דרך 3):
//   {{פנייה}}   title + name («ד״ר פלונית אלמונית»)
//   {{יום}}     the weekday («שני») — of the calendar: 00:30 on the night after Sunday is Monday
//   {{תאריך}}   «15.2.2027 (ח׳ באדר א׳ תשפ״ז)» — Gregorian, then Hebrew (Intl he-IL-u-ca-hebrew); TBD while the week's date is
//   {{מקום}}    the room
//   {{כותרת}}   the lesson's title
//   {{שעה}}     the teaching time, start–end («20:00–21:15»)
//   {{משך}}     the teaching time in words: 60 «שעה», 75 «שעה ורבע», 90 «שעה וחצי», 45 «שלושת רבעי שעה», else «N דקות»
//   {{תשלום}}   the amount asked, digits only («1,500») — the template writes ₪ or ש״ח itself
//   [[זכר|נקבה]]                 by the speaker's gender
//   {{אני:זכר|נקבה}}             by the sender's gender (the team member sending it)
//   [[תשלום:כשיש תשלום|בהתנדבות]]  the first text when an amount was asked, else the second —
//                                   the only way a volunteer's wording enters: the template's own
// Brackets nest ([[תשלום:…[[זכר|נקבה]]…|…]]); a variable does not.
import { dateOf, fmtRange } from "./time";
import { displayName } from "./names";
import type { Approval, Gender, Lesson } from "./types";
import { hebrewNumeral } from "../settings/hebrewYear";

/** The variables a template may use, in the order the settings tab lists them. */
export const MESSAGE_VARIABLES = ["פנייה", "יום", "תאריך", "מקום", "כותרת", "שעה", "משך", "תשלום"] as const;
export type MessageVariable = (typeof MESSAGE_VARIABLES)[number];

/** DESIGN: «להודיע למרצים שהשיעור שעה ורבע» — the teaching time when the lesson says none, capped by its slot. */
export const DEFAULT_TEACH_MINUTES = 75;

export type ProblemCode =
  | "template_empty"
  | "syntax"
  | "unknown_variable"
  | "not_closed"
  | "no_speaker"
  | "approval_pending"
  | "approval_rejected"
  | "title_tbd"
  | "date_tbd"
  | "room_missing"
  | "speaker_gender"
  | "sender_gender"
  | "no_amount";

export interface Problem {
  code: ProblemCode;
  /** Hebrew, for the composer's list. */
  message: string;
}

export interface MessageInput {
  /** editions.settings.confirm_template — null/empty until the instructor pastes it. */
  template: string | null | undefined;
  lesson: Pick<Lesson, "state" | "day" | "start_min" | "end_min" | "title" | "teach_min" | "pay_amount"> & { approval: Approval };
  /** The lead speaker; null when the lesson has none. */
  speaker: { title: string | null; name: string; gender: Gender | null } | null;
  /** The team member sending it (their gender, from the team list). */
  sender: { gender: Gender | null } | null;
  /** The room's name. */
  room: string | null;
  /** The edition's opening Sunday (yyyy-mm-dd); null = TBD. */
  startDate: string | null;
  /** settings.lesson_minutes (75 when absent). */
  lessonMinutes?: number | null;
}

export interface Composed {
  /** True only when nothing is missing: then `text` may be copied and sent. */
  ok: boolean;
  /** The message — with «TBD: …» where something is missing (a preview, never to send). */
  text: string;
  problems: Problem[];
}

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** {{משך}}: the teaching time in words. */
export function durationWords(minutes: number): string {
  switch (minutes) {
    case 60:
      return "שעה";
    case 75:
      return "שעה ורבע";
    case 90:
      return "שעה וחצי";
    case 45:
      return "שלושת רבעי שעה";
    default:
      return `${minutes} דקות`;
  }
}

/** The teaching time: the lesson's own, else min(settings.lesson_minutes ?? 75, the slot). */
export function teachMinutes(l: Pick<Lesson, "start_min" | "end_min" | "teach_min">, lessonMinutes?: number | null): number {
  return l.teach_min ?? Math.min(lessonMinutes ?? DEFAULT_TEACH_MINUTES, l.end_min - l.start_min);
}

/** Days after the opening Sunday on the calendar: the night after a day column (00:00 and on) is the next date. */
function calendarOffset(day: number, startMin: number): number {
  return day + (startMin >= 1440 ? 1 : 0);
}

/** {{יום}}: the calendar weekday of the lesson's start. */
export function weekdayOf(day: number, startMin: number): string {
  return WEEKDAYS[calendarOffset(day, startMin) % 7];
}

/** Hebrew numerals with Hebrew punctuation (geresh, gershayim): 7 → ז׳, 15 → ט״ו, 5787 → תשפ״ז. */
function hebrewLetters(n: number): string {
  return hebrewNumeral(n).replace(/"/g, "״").replace(/'/g, "׳");
}

/** «ח׳ באדר א׳ תשפ״ז» — Intl gives the Hebrew calendar's day, month and year; the numerals are ours. null if the browser cannot. */
export function hebrewDateLong(date: Date): string | null {
  try {
    const parts = new Intl.DateTimeFormat("he-IL-u-ca-hebrew", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = Number(get("day").replace(/\D/g, ""));
    const year = Number(get("year").replace(/\D/g, ""));
    const month = get("month");
    if (!day || year < 5000 || !month) return null;
    return `${hebrewLetters(day)} ב${month} ${hebrewLetters(year)}`;
  } catch {
    return null;
  }
}

/** {{תאריך}}: «15.2.2027 (ח׳ באדר א׳ תשפ״ז)»; null while the week's date is TBD. */
export function messageDate(startDate: string | null, day: number, startMin: number): string | null {
  const base = dateOf(startDate, 0);
  if (!base) return null;
  const d = new Date(base.getTime() + calendarOffset(day, startMin) * 86_400_000);
  const greg = `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
  const heb = hebrewDateLong(d);
  return heb ? `${greg} (${heb})` : greg;
}

/** {{תשלום}}: digits with a thousands separator, nothing more. */
export function amountText(n: number): string {
  return new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(n);
}

// ------------------------------------------------------------------ the template's grammar

type Node =
  | { t: "text"; v: string }
  | { t: "var"; name: string }
  | { t: "me"; m: string; f: string }
  | { t: "gender"; m: Node[]; f: Node[] }
  | { t: "pay"; paid: Node[]; free: Node[] };

/** «[[תשלום:» and «{{אני:» — spaces around the word and the colon are forgiven, so a payment switch is never read as a gender pair. */
const PAY_PREFIX = /^[ \t]*תשלום[ \t]*:[ \t]*/;
const ME_PREFIX = /^אני[ \t]*:/;

/** The template as a tree, and what is wrong with its brackets (Hebrew). */
export function parseTemplate(src: string): { nodes: Node[]; errors: string[] } {
  const s = src;
  let i = 0;
  const errors: string[] = [];

  const seq = (inBracket: boolean): Node[] => {
    const out: Node[] = [];
    let text = "";
    const flush = () => {
      if (text) out.push({ t: "text", v: text });
      text = "";
    };
    while (i < s.length) {
      if (s.startsWith("{{", i)) {
        flush();
        out.push(variable());
      } else if (s.startsWith("[[", i)) {
        flush();
        out.push(bracket());
      } else if (inBracket && (s.startsWith("]]", i) || s[i] === "|")) {
        break;
      } else if (s.startsWith("]]", i) || s.startsWith("}}", i)) {
        errors.push(`«${s.slice(i, i + 2)}» בלי פתיחה`);
        text += s.slice(i, i + 2);
        i += 2;
      } else {
        text += s[i++];
      }
    }
    flush();
    return out;
  };

  const variable = (): Node => {
    const from = i;
    i += 2;
    const end = s.indexOf("}}", i);
    const body = end < 0 ? s.slice(i) : s.slice(i, end);
    if (end < 0 || /\{\{|\[\[|\]\]/.test(body)) {
      errors.push(`«{{» בלי «}}»: ${s.slice(from, from + 20)}`);
      i = end < 0 ? s.length : end + 2;
      return { t: "text", v: s.slice(from, i) };
    }
    i = end + 2;
    const name = body.trim();
    const me = ME_PREFIX.exec(name);
    if (me) {
      const forms = name.slice(me[0].length).split("|").map((f) => f.trim());
      if (forms.length !== 2) {
        errors.push(`«{{${name}}}»: צריך בדיוק שתי צורות, זכר|נקבה`);
        return { t: "text", v: s.slice(from, i) };
      }
      return { t: "me", m: forms[0], f: forms[1] };
    }
    return { t: "var", name };
  };

  const bracket = (): Node => {
    const from = i;
    i += 2;
    const pay = PAY_PREFIX.exec(s.slice(i));
    if (pay) i += pay[0].length;
    const alts: Node[][] = [];
    for (;;) {
      alts.push(seq(true));
      if (s.startsWith("]]", i)) {
        i += 2;
        break;
      }
      if (s[i] === "|") {
        i++;
        continue;
      }
      errors.push(`«[[» בלי «]]»: ${s.slice(from, from + 20)}`);
      break;
    }
    if (alts.length !== 2) {
      errors.push(pay ? `«[[תשלום:…]]»: צריך בדיוק שתי חלופות, כשיש תשלום|בהתנדבות` : `«[[…]]»: צריך בדיוק שתי צורות, זכר|נקבה`);
    }
    const [a = [], b = []] = alts;
    return pay ? { t: "pay", paid: a, free: b } : { t: "gender", m: a, f: b };
  };

  const nodes = seq(false);
  return { nodes, errors };
}

// ------------------------------------------------------------------ composing

const PROBLEM_TEXT: Record<Exclude<ProblemCode, "syntax" | "unknown_variable">, string> = {
  template_empty: "אין עדיין נוסח להודעת הסיכום. המדריך/ה מדביק/ה אותו בהגדרות, בלשונית «תבניות» (הנוסח של אשתקד, מתחתית גיליון המעקב).",
  not_closed: "השיעור עוד לא נסגר.",
  no_speaker: "לשיעור אין מרצה.",
  approval_pending: "התשלום או ההסעה עוד ממתינים לאישור המדריך/ה.",
  approval_rejected: "המדריך/ה לא אישר/ה את התשלום או את ההסעה — צריך לעדכן את הבקשה.",
  title_tbd: "חסרה כותרת לשיעור (TBD).",
  date_tbd: "תאריך השבוע עוד לא נקבע (TBD).",
  room_missing: "חסר חדר לשיעור.",
  speaker_gender: "חסר מגדר למרצה, והנוסח משתנה לפי מגדר המרצה ([[…|…]]).",
  sender_gender: "חסר המגדר שלך ברשימת הצוות, והנוסח משתנה לפי מגדר השולח/ת ({{אני:…|…}}).",
  no_amount: "לא התבקש סכום (התנדבות), והנוסח לא אומר מה לכתוב במקרה כזה. צריך בנוסח [[תשלום:…|…]], עם הנוסח להתנדבות אחרי ה-|.",
};

const tbd = (label: string) => `«TBD: ${label}»`;

const unknownText = (name: string) => `משתנה לא מוכר בנוסח: {{${name}}}. המשתנים שאפשר: ${MESSAGE_VARIABLES.map((v) => `{{${v}}}`).join(" ")}.`;

/** Every {{variable}} the template names, in every branch (taken or not), in order, once each. */
function templateVariables(list: Node[], out: string[] = []): string[] {
  for (const n of list) {
    if (n.t === "var" && !out.includes(n.name)) out.push(n.name);
    else if (n.t === "gender") templateVariables([...n.m, ...n.f], out);
    else if (n.t === "pay") templateVariables([...n.paid, ...n.free], out);
  }
  return out;
}

/** The summary message for one closed lesson. `ok` only when nothing is missing. */
export function composeConfirmation(input: MessageInput): Composed {
  const problems: Problem[] = [];
  const add = (code: ProblemCode, message: string = PROBLEM_TEXT[code as keyof typeof PROBLEM_TEXT]) => {
    if (!problems.some((p) => p.code === code && p.message === message)) problems.push({ code, message });
  };
  const { lesson: l, speaker, sender } = input;
  const template = (input.template ?? "").replace(/\r\n?/g, "\n");
  const empty = template.trim() === "";
  if (empty) add("template_empty");
  // the lesson's own blockers too, so pasting the wording never reveals a second one
  if (l.state !== "closed") add("not_closed");
  else if (!speaker) add("no_speaker");
  if (l.approval === "pending") add("approval_pending");
  if (l.approval === "rejected") add("approval_rejected");
  if (empty) return { ok: false, text: "", problems };

  const { nodes, errors } = parseTemplate(template);
  for (const e of errors) add("syntax", `בנוסח יש סוגריים שלא נסגרו כמו שצריך: ${e}`);
  // every variable in every branch — a typo in the masculine form or the volunteer wording blocks now, not on the day it is taken
  for (const name of templateVariables(nodes)) if (!(MESSAGE_VARIABLES as readonly string[]).includes(name)) add("unknown_variable", unknownText(name));

  const teach = teachMinutes(l, input.lessonMinutes);
  const value = (name: string): string => {
    switch (name as MessageVariable) {
      case "פנייה":
        if (speaker) return displayName(speaker);
        add("no_speaker");
        return tbd("פנייה");
      case "יום":
        return weekdayOf(l.day, l.start_min);
      case "תאריך": {
        const d = messageDate(input.startDate, l.day, l.start_min);
        if (d) return d;
        add("date_tbd");
        return tbd("תאריך");
      }
      case "מקום":
        if (input.room) return input.room;
        add("room_missing");
        return tbd("מקום");
      case "כותרת":
        if (l.title) return l.title;
        add("title_tbd");
        return tbd("כותרת");
      case "שעה":
        return fmtRange(l.start_min, l.start_min + teach);
      case "משך":
        return durationWords(teach);
      case "תשלום":
        if (l.pay_amount != null) return amountText(l.pay_amount);
        add("no_amount");
        return tbd("תשלום");
      default:
        add("unknown_variable", unknownText(name));
        return tbd(name);
    }
  };

  const render = (list: Node[]): string =>
    list
      .map((n) => {
        switch (n.t) {
          case "text":
            return n.v;
          case "var":
            return value(n.name);
          case "me":
            if (sender?.gender === "m") return n.m;
            if (sender?.gender === "f") return n.f;
            add("sender_gender");
            return `«${n.m}/${n.f}»`;
          case "gender": {
            if (speaker?.gender === "m") return render(n.m);
            if (speaker?.gender === "f") return render(n.f);
            add("speaker_gender");
            return `«${render(n.m)}/${render(n.f)}»`;
          }
          case "pay":
            return l.pay_amount != null ? render(n.paid) : render(n.free);
        }
      })
      .join("");

  const text = render(nodes);
  return { ok: problems.length === 0, text, problems };
}

// ------------------------------------------------------------------ sending

/** The mail's subject: the week's name and the edition's label — nothing else of ours. */
export function confirmSubject(editionLabel: string | null | undefined): string {
  return `שבוע וולוז'ין ${editionLabel ?? ""}`.trim();
}
