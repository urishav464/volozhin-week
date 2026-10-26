// «נקודות לשיחה» (v14) — what a trainee says when phoning a speaker they proposed: the call is the first step.
//
// The text is the instructor's own, word for word (the list the team wrote last year, as the instructor gave it):
// the built-in default below, which the instructor may replace in «הגדרות ← תבניות» (editions.settings.call_template).
// The language is the summary message's (src/domain/message.ts): [[זכר|נקבה]] by the speaker's gender, {{אני:זכר|נקבה}}
// by the caller's, and one variable, {{שמי}} — the caller's display name (the «X» of the instructor's text).
// Unlike the summary message nothing here blocks: a gender not yet known reads «שתגיע/י», a missing name «השם שלך»,
// and what cannot be filled in is listed under the points (the call still happens).
import { parseTemplate, type TemplateNode } from "./message";
import type { Gender } from "./types";

export const CALL_VARIABLES = ["שמי"] as const;

/**
 * The instructor's text, with its «X» as {{שמי}} and the three words that address the speaker in both genders.
 * «שעה ורבע», «בדכ», «וולוזין» and the asterisks stay exactly as written — src/domain/callPoints.test.ts holds the
 * masculine rendering to the original, letter for letter.
 */
export const DEFAULT_CALL_TEMPLATE = [
  "*נקודות להתייחסות בשיחת טלפון:*",
  "*אני {{שמי}} מהמדרשה הגבוהה בעין פרת",
  "*היא מעורבת דתיים חילונים לפני צבא",
  "*אנחנו מרימים בפברואר שבוע וולוזין לזכר ישיבת וולוזין",
  "*לומדים 5 ימים 24/7 ומחליפים מרצה כל שעה וחצי",
  "*נשמח [[שתגיע|שתגיעי]] ללמד שעה ורבע, [[תסכים|תסכימי]]?",
  "*בדכ השבוע קורה בהתנדבות. זה בסדר מבחינתך? (אם לא להבין כמה רוצה ולומר שאדבר עם המנהלנית)",
  "*מה נושא השיעור?",
  "*נבקש [[שתתחיל|שתתחילי]] להכין דף מקורות",
].join("\n");

export interface CallInput {
  /** editions.settings.call_template — absent or blank: the instructor's text above. */
  template?: string | null;
  speakerGender: Gender | null;
  caller: { name: string | null; gender: Gender | null } | null;
}

export interface CallPointsText {
  text: string;
  /** What could not be filled in (Hebrew) — said under the points, never blocking. */
  problems: string[];
  /** True when the instructor's saved text is used, not the built-in one. */
  custom: boolean;
}

const MEDIAL: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };

/**
 * Both forms when the gender is not known: «שתגיע/י» when the feminine extends the masculine — a final letter taken
 * as its medial form, so «תסכים/תסכימי» reads «תסכים/י» — else both whole, «ענה/ענתה».
 */
export function slashed(m: string, f: string): string {
  const base = m.slice(0, -1) + (MEDIAL[m.slice(-1)] ?? m.slice(-1));
  return m && f.startsWith(base) && f.length > base.length ? `${m}/${f.slice(base.length)}` : `${m}/${f}`;
}

export function composeCallPoints(input: CallInput): CallPointsText {
  const saved = (input.template ?? "").replace(/\r\n?/g, "\n");
  const custom = saved.trim() !== "";
  const problems: string[] = [];
  const add = (p: string) => {
    if (!problems.includes(p)) problems.push(p);
  };
  const { nodes, errors } = parseTemplate(custom ? saved : DEFAULT_CALL_TEMPLATE);
  for (const e of errors) add(`בנקודות יש סוגריים שלא נסגרו כמו שצריך: ${e}`);

  const name = input.caller?.name?.trim() || null;
  const render = (list: TemplateNode[]): string =>
    list
      .map((n) => {
        switch (n.t) {
          case "text":
            return n.v;
          case "var":
            if (n.name === "שמי") {
              if (name) return name;
              add("השם שלך לא רשום ברשימת הצוות.");
              return "השם שלך";
            }
            add(`משתנה לא מוכר בנקודות לשיחה: {{${n.name}}}. אפשר רק {{שמי}}.`);
            return `{{${n.name}}}`;
          case "me":
            if (input.caller?.gender === "m") return n.m;
            if (input.caller?.gender === "f") return n.f;
            return slashed(n.m, n.f);
          case "gender":
            if (input.speakerGender === "m") return render(n.m);
            if (input.speakerGender === "f") return render(n.f);
            return slashed(render(n.m), render(n.f));
          case "pay":
            add("[[תשלום:…]] שייך להודעת הסיכום, לא לנקודות לשיחה.");
            return slashed(render(n.paid), render(n.free));
        }
      })
      .join("");

  return { text: render(nodes), problems, custom };
}
