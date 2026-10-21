// The import's two privacy invariants, as properties (DECISIONS «ביקורת: ייבוא ואבן דרך 6», סבב שלישי and סבב רביעי) —
// random tables, seeded, thousands of them, through the whole wizard pipeline to the payload the commit would send:
//   1. a phone or an e-mail found ANYWHERE in the input — every cell, every position, every form the readers know: a
//      realistic number by Israel's numbering plan (a mobile, a 07X, a landline, +972 / 00972 / 972, 1-800) or abroad,
//      or seven digits beside «טל'» / «נייד» / ☎ (DECISIONS «סבב חמישי»); brackets, dashes of every kind, «/ · • _ : , | ;»
//      between the groups, a bidi mark or NEL between the digits, fullwidth or Arabic-Indic digits, a second line, two
//      numbers in a cell, an e-mail with spaces around its «@», «@@», «＠» — lands only in a contact field (phone,
//      email); never in a name, a title, an affiliation, a tag, a note, or a lesson's title / audience / sources note /
//      import note. And the commit's backstop (importRules — the engine's and the database's «contact_in_text») never
//      refuses what the wizard sends. What is NO phone — verses, dates and times in every form (the xlsx reader's ISO
//      too), pages, prices, years — survives whole (d).
//   2. an escort's name never reaches the payload: in the escorts' file STRUCTURALLY — a row is the channel chosen
//      from the list and the admin's own note, whatever the file says (and a note the admin typed with a phone in it is
//      never sent); in the tracking sheet and the candidates, the escorts' column is asked for and never read, and a
//      speaker cell's line that names an escort is proposed «לא לייבא» — by first name, surname, after up to four
//      prefix letters, with niqqud or a mark inside, «(מלווה: …)», a nickname the escorts' cell gives in brackets — on
//      a line under the name, in a bracket on the name's own line («מרצה 12 (מלווה: …)»), or beside it («פלוני + שירה…»).
// Every person and number here is made up at run time (the digits from the seed): none is in this file.
import { describe, expect, it } from "vitest";
import { cleanLessonRow, cleanPrefsRow, cleanSpeakerRow, PREFS_KEYS } from "../data/importRules";
import { DEFAULT_TITLES } from "../data/speakerRules";
import type { Speaker } from "../domain/types";
import { candidatesPayload, contextOf, type MatchContext, previewCandidates, readCandidateSheet, undecided } from "./candidates";
import { type EscortAnswer, escortColumns, escortLike, escortNames, escortsPayload, IMPORT_CHANNELS, NOT_A_NAME, previewEscorts, readEscorts } from "./escorts";
import type { Mapping } from "./fields";
import type { ExtraLine, LineAs } from "./lines";
import type { Choice } from "./match";
import { foldContact, hasContact } from "./phone";
import { archivePayload, doubleGroups, planLessons, previewTrackingSpeakers, readTracking, resolvedSpeakers, speakerAliases } from "./tracking";

/** mulberry32: a small seeded generator — the same cases on every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T,>(xs: readonly T[]): T => xs[int(xs.length)];
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}
type R = ReturnType<typeof rng>;

const LETTERS = "אבגדהזחטיכלמנסעפצקרשת";
const WORDS = ["שיעור", "על", "האמונה", "בדורנו", "עיון", "בספר", "מחשבה", "ותורה", "פרק", "חדש", "בית", "לימוד", "עם", "הלכה", "מוסר", "שאלות", "תשובות"];
const word = (g: R, min = 2, max = 6) => Array.from({ length: min + g.int(max - min + 1) }, () => g.pick([...LETTERS])).join("");
const words = (g: R, n: number) => Array.from({ length: n }, () => (g.chance(0.5) ? g.pick(WORDS) : word(g))).join(" ");
const latin = (g: R) => Array.from({ length: 3 + g.int(6) }, () => g.pick([..."abcdefghijklmnopqrstuvwxyz"])).join("");
const digits = (g: R, n: number) => Array.from({ length: n }, () => String(g.int(10))).join("");

/** The contacts a case wrote — every one, as generated (its digits, its address), to look for afterwards. */
let made: { phones: string[]; emails: string[] } = { phones: [], emails: [] };
/** Digits in another script now and then: Arabic-Indic, Persian, fullwidth, Devanagari. */
const script = (g: R, s: string) => {
  if (!g.chance(0.15)) return s;
  const zero = g.pick([0x660, 0x6f0, 0xff10, 0x966]);
  return s.replace(/[0-9]/g, (d) => String.fromCodePoint(zero + Number(d)));
};
/**
 * A phone as last year's files (and the reviewers) wrote one — realistic, by Israel's numbering plan or abroad (DECISIONS
 * «סבב חמישי»): a mobile or a 07X (ten digits), a landline (nine), 1-700 / 1-800 / 1-599, a number abroad — every digit
 * made up now, in one of the forms.
 */
function phone(g: R): string {
  const kind = g.int(12);
  if (kind === 10) {
    // abroad: «+» or «00», a country code and seven to eleven digits
    const cc = g.pick(["1", "44", "33", "49", "39"]);
    const rest = digits(g, 7 + g.int(5));
    made.phones.push(`${cc}${rest}`);
    return g.pick([() => `+${cc} ${rest.slice(0, 3)} ${rest.slice(3)}`, () => `+${cc}-${rest}`, () => `00${cc} ${rest}`, () => `+${cc} (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6)}`])();
  }
  if (kind === 11) {
    const p = g.pick(["700", "800", "599"]);
    const six = digits(g, 6);
    made.phones.push(`1${p}${six}`);
    return g.pick([() => `1-${p}-${six.slice(0, 3)}-${six.slice(3)}`, () => `1${p}${six}`, () => `1-${p}-${six}`])();
  }
  const a = kind < 7 ? `0${g.pick(["5", "7"])}${g.int(10)}` : `0${g.pick(["2", "3", "4", "8", "9"])}`;
  const b = digits(g, 3);
  const c = digits(g, 4);
  made.phones.push(`${a}${b}${c}`);
  const sep = (x: string) => `${a}${x}${b}${x}${c}`;
  const nat = a.slice(1);
  return script(
    g,
    g.pick([
      () => `${a}-${b}${c}`,
      () => `${a} ${b} ${c}`,
      () => `${a}${b}${c}`,
      () => `${a}.${b}.${c}`,
      () => `+972-${nat}-${b}-${c}`,
      () => `+972 (0)${nat} ${b}${c}`,
      () => `00972${nat}${b}${c}`,
      () => `wa.me/972${nat}${b}${c}`,
      () => `(${a}) ${b}-${c}`,
      () => `${a}/${b}${c}`,
      () => sep("‏-‏"), // bidi marks, as a copy from WhatsApp carries them
      () => sep("‑"), // non-breaking hyphens
      () => `${a}–${b}${c}`,
      () => `${a}-${b}\n${c}`, // broken over a line
      () => `${a}${b}${c}`.replace(/(..)(?=.)/g, "$1-"), // in pairs
      () => sep(g.pick(["/", " / ", "·", "•", "‧", "_", ",", "|", ";", ...(a.length === 3 ? [":"] : [])])), // the reviewers' separators
      () => sep(g.pick(["\u0085", "᠎", "‍", "⁠", "\u{e0020}"])), // what shows nothing
    ])(),
  );
}
/** Seven digits with no area code — a phone only beside a word that says so («טל'», «נייד», ☎). */
function local(g: R): string {
  const n = `${1 + g.int(9)}${digits(g, 6)}`;
  made.phones.push(n);
  return g.pick([() => n, () => `${n.slice(0, 3)}-${n.slice(3)}`, () => `${n.slice(0, 3)} ${n.slice(3)}`])();
}
function email(g: R): string {
  const local = `${latin(g)}${g.chance(0.3) ? `.${latin(g)}` : ""}`;
  const [dom, tld] = g.pick([["example", "org"], ["example", "com"], ["test.example", "net"]]);
  made.emails.push(`${local}@${dom}.${tld}`);
  const at = `${local}@${dom}.${tld}`;
  return g.pick([
    () => at,
    () => `mailto:${at}`,
    () => `<${at}>`,
    () => `${local} @${dom}.${tld}`,
    () => `${local}@ ${dom}.${tld}`,
    () => `${local}@${dom} .${tld}`,
    () => `${local} @ ${dom} . ${tld}`,
    () => `${local}@@${dom}.${tld}`,
    () => `${local}＠${dom}.${tld}`,
  ])();
}
/** A contact as written beside other words: labelled, bracketed, two of them, or bare. */
function contact(g: R): string {
  const one = () => (g.chance(0.7) ? phone(g) : email(g));
  return g.pick([
    () => one(),
    () => `טל' ${phone(g)}`,
    () => `טלפון: ${phone(g)}`,
    () => `נייד ${phone(g)}`,
    () => `מייל: ${email(g)}`,
    () => `(${one()})`,
    () => `[${one()}]`,
    () => `(טל' ${phone(g)})`,
    () => `טל' ${local(g)}`,
    () => `נייד: ${local(g)}`,
    () => `☎ ${local(g)}`,
    () => `${local(g)} (נייד)`,
    () => `${phone(g)} / ${phone(g)}`,
    () => `${phone(g)}, ${phone(g)}`,
    () => `${phone(g)} או ${phone(g)}`,
  ])();
}
/** A cell's text with a contact sprinkled in at any position — or none. */
function sprinkle(g: R, text: string, p = 0.5): string {
  if (!g.chance(p)) return text;
  const c = contact(g);
  return g.pick([() => `${c} ${text}`, () => `${text} ${c}`, () => `${text}\n${c}`, () => `${c}\n${text}`, () => c, () => `${text} - ${c}`, () => `${text}, ${c} ${words(g, 1)}`])();
}

/** Text that is no phone (DECISIONS «סבב חמישי»): verses, dates and times in every form, pages, prices, years — made up now. */
function nonPhone(g: R): string {
  const n = (lo: number, hi: number) => lo + g.int(hi - lo + 1);
  const p2 = (x: number) => String(x).padStart(2, "0");
  const p3 = (x: number) => String(x).padStart(3, "0");
  return g.pick([
    () => `תהלים ${n(1, 150)}:${n(1, 9)}-${n(10, 176)}`,
    () => `ישעיהו ${n(1, 66)}:${n(1, 20)}-${n(1, 66)}:${n(1, 20)}`,
    () => `${n(2020, 2027)}-${p2(n(1, 12))}-${p2(n(1, 28))}`, // the xlsx reader's date
    () => `${n(2020, 2027)}-${p2(n(1, 12))}-${p2(n(1, 28))} ${p2(n(0, 23))}:${p2(n(0, 59))}`, // …and its date and time
    () => `${p2(n(1, 28))}.${p2(n(1, 12))}.${n(2020, 2027)} ${p2(n(0, 23))}:${p2(g.pick([0, 15, 30, 45]))}`,
    () => `${p2(n(1, 28))}-${p2(n(1, 12))}-${n(2020, 2027)} ${n(0, 23)}:00`,
    () => `${n(1, 28)}/${n(1, 12)}/${n(2020, 2027)}`,
    () => `${n(1, 28)}.${n(1, 12)} ${n(0, 23)}:${p2(g.pick([0, 30]))}-${n(0, 23)}:${p2(g.pick([0, 30]))}`,
    () => `${n(1, 14)}-${n(15, 28)}/${n(1, 12)}/${n(2020, 2027)}`,
    () => `${p2(n(1, 9))}.${p2(n(1, 12))}-${p2(n(1, 9))}.${p2(n(1, 12))}.${p2(n(20, 27))}`,
    () => `עמ' ${n(100, 999)},${n(100, 999)},${n(100, 999)}`,
    () => `${n(1, 9)},${p3(n(0, 999))},${p3(n(0, 999))} ₪`,
    () => `${n(1900, 2026)}-${n(1900, 2026)}-${n(1900, 2026)}`,
    () => `${n(5700, 5790)}-${n(5700, 5790)}`,
    () => `${n(1900, 2026)} ${n(1900, 2026)}`,
    () => `${n(0, 23)}:${p2(g.pick([0, 30]))}-${n(0, 23)}:${p2(g.pick([0, 30]))}`,
  ])();
}

/**
 * Every line of a cell decided — the read's own proposal kept where it has one, the rest at random — read again until
 * no new line appears (a line made a speaker may bring brackets of its own). `seen`: each line as first read (its «הצעה»).
 */
function decideAll<T extends { lines: ExtraLine[] }>(g: R, read: (lineAs: ReadonlyMap<string, LineAs>) => T): { read: T; seen: ExtraLine[] } {
  const lineAs = new Map<string, LineAs>();
  const seen: ExtraLine[] = [];
  for (;;) {
    const r = read(lineAs);
    const fresh = r.lines.filter((l) => !lineAs.has(l.id));
    if (fresh.length === 0) return { read: r, seen };
    for (const l of fresh) {
      seen.push(l);
      lineAs.set(l.id, l.as ?? g.pick(LINE_AS));
    }
  }
}

/** What a field kept of the case's contacts: one (hasContact), the last 7 digits of a phone, or an address. */
function leaked(fields: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (!f) continue;
    if (hasContact(f)) out.push(`contact: ${JSON.stringify(f)}`);
    const d = foldContact(f).replace(/[^0-9]/g, "");
    for (const p of made.phones) if (d.includes(p.slice(-7))) out.push(`digits of ${p}: ${JSON.stringify(f)}`);
    const flat = foldContact(f).replace(/\s+/g, "").replace(/[@＠]+/g, "@");
    for (const e of made.emails) if (flat.includes(e)) out.push(`e-mail ${e}: ${JSON.stringify(f)}`);
  }
  return out;
}

const sp = (id: number, name: string): Speaker => ({
  id, title: null, name, disambiguator: null, gender: null, affiliation: null, bio_short: null, topics: [], contact_pref: null,
  vetted: "approved", vetted_by: null, vetted_note: null, retired: false, name_key: name, version: 1,
});
const POOL = [sp(1, "מרצה 07"), sp(2, "מרצה 12"), sp(3, "דוגמה אלף")];
const CTX: MatchContext = contextOf(POOL, { phones: [], contacts: [] });
const TITLE = (g: R) => (g.chance(0.5) ? `${g.pick(["הרב", "הרבנית", "ד״ר", "פרופ׳"])} ` : "");
const NAME = (g: R) => (g.chance(0.15) ? g.pick(POOL).name : `${word(g, 3, 5)} ${word(g, 3, 6)}`);
/** A choice for every speaker the preview leaves open: new where allowed, else skip; a few left out on purpose. */
function choose(g: R, status: string, allowNew: boolean | undefined, candidates: { id: number }[]): Choice | null {
  if (status === "ambiguous") return candidates.length && g.chance(0.4) ? { action: "merge", target: candidates[0].id } : allowNew ? { action: "new" } : { action: "skip" };
  return g.chance(0.1) ? { action: "skip" } : null;
}
const LINE_AS: readonly LineAs[] = ["speaker", "affiliation", "skip"];
const CASES = 1500;
/** Each property's time: thousands of tables through the whole pipeline (a few seconds; more on a loaded machine). */
const SLOW = 60_000;

describe("invariant 1: a phone or an e-mail lands only in a contact field — and the commit's backstop agrees", () => {
  it(`(a) the candidates: ${CASES} random tables, every other name of a cell decided at random`, () => {
    const head = ["מרצה", "תואר", "מוסד", "נושאים", "טלפון", "מייל", "טווח ימים", "הערות"];
    const m: Mapping = ["name", "title", "affiliation", "topics", "phone", "email", "status", "note"];
    let checked = 0;
    for (let seed = 1; seed <= CASES; seed++) {
      const g = rng(seed);
      made = { phones: [], emails: [] };
      const rows = Array.from({ length: 1 + g.int(6) }, () => [
        sprinkle(g, `${TITLE(g)}${NAME(g)}${g.pick(["", "", ` + ${NAME(g)}`, `\n${NAME(g)}`, `\n(ישיבת ${word(g)})`, `\n${contact(g)}`, ` (ישיבת ${word(g)})`, ` (${words(g, 1)})`, ` (${contact(g)})`, ` + ${NAME(g)} (מכון ${word(g)})`])}`, 0.4),
        sprinkle(g, g.pick(["", "הרב", "רבי", words(g, 1)]), 0.2),
        sprinkle(g, g.chance(0.5) ? `ישיבת ${word(g)}` : "", 0.3),
        sprinkle(g, `${words(g, 1)}, ${words(g, 2)}`, 0.3),
        g.pick(["", "", phone(g), "אין", `${phone(g)} / ${phone(g)}`]),
        g.pick(["", "", email(g), "לא ידוע"]),
        sprinkle(g, g.pick(["", "א-ב", "נסגר"]), 0.2),
        sprinkle(g, words(g, 3), 0.5),
      ]);
      const grid = [head, ...rows];
      const o = { headerRow: 0, titles: DEFAULT_TITLES, genderFromTitle: true };
      const { read } = decideAll(g, (lineAs) => readCandidateSheet(grid, m, { ...o, lineAs }));
      expect(read.lines.every((l) => l.as != null)).toBe(true);
      const preview = previewCandidates(read.rows, CTX);
      const choices = new Map<string, Choice>();
      for (const r of undecided(preview, choices)) choices.set(r.ref, choose(g, r.status, r.match?.allowNew, r.match?.candidates ?? []) ?? { action: "skip" });
      const p = candidatesPayload(preview, choices, "brainstorm-5786", null);
      expect(p, `seed ${seed}`).not.toBeNull();
      for (const row of p!.rows) {
        if (process.env.R5_DBG && leaked([row.name, row.title, row.affiliation, ...row.topics, row.notes]).length) console.log("DBG", seed, JSON.stringify(grid[row.row - 1]), JSON.stringify(row));
        expect(leaked([row.name, row.title, row.affiliation, ...row.topics, row.notes]), `seed ${seed} row ${row.row}`).toEqual([]);
        expect(() => cleanSpeakerRow(row, DEFAULT_TITLES), `seed ${seed}`).not.toThrow();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(CASES);
  }, SLOW);

  it(`(b) the tracking sheet: ${CASES} random sheets, every line and group decided at random`, () => {
    const head = ["מרצה", "שיעור ב", "כותרת", "מקורות (נשלח?)", "הסעה/תשלום", "טלפון", "קיבל הודעת סיכום מ", "נושא", "הערות"];
    const m: Mapping = ["speaker", "when", "title", "sources", "transport", "phone", "confirmFrom", "topic", "note"];
    const WHEN = ["ראשון 8:30", "ראשון 10:00", "שני 11:30", "שני 20:00 כפולה", "שלישי 8:30-10:00", "רביעי 22:00", "רביעי 00:30", "חמישי 10:00", "שלישי 20:00 - שיעור להורים"];
    let lessons = 0;
    for (let seed = 1; seed <= CASES; seed++) {
      const g = rng(10_000 + seed);
      made = { phones: [], emails: [] };
      const speakerCell = () => {
        const first = `${TITLE(g)}${NAME(g)}`;
        const second = g.pick(["", ` + ${NAME(g)}`, ` / ${NAME(g)}`, `\n(ישיבת ${word(g)})`, `\nמכון ${word(g)}`, `\n${NAME(g)}`, `\n${contact(g)}`, ` ${phone(g)}`, ` (ישיבת ${word(g)})`, ` (${words(g, 1)})`, ` (${contact(g)})`]);
        return sprinkle(g, first + second, 0.3);
      };
      const rows = Array.from({ length: 1 + g.int(6) }, () => [
        speakerCell(),
        g.pick(WHEN),
        sprinkle(g, words(g, 1 + g.int(4)), 0.3),
        sprinkle(g, g.pick(["כן", "לא", "כן+סרטון", "להדפיס לפני", words(g, 2)]), 0.3),
        sprinkle(g, g.pick(["", "300", "הסעה הלוך וחזור", words(g, 2)]), 0.3),
        g.pick(["", "", phone(g), "טלפון לדוגמה"]),
        sprinkle(g, g.chance(0.5) ? NAME(g) : "", 0.3),
        g.pick(["", "תנ״ך", "פילוסופיה"]),
        sprinkle(g, g.chance(0.5) ? words(g, 3) : "", 0.4),
      ]);
      const grid = [head, ...rows];
      const base = { headerRow: 0, titles: DEFAULT_TITLES, genderFromTitle: true };
      const { read } = decideAll(g, (lineAs) => readTracking(grid, m, { ...base, lineAs }));
      expect(read.lines.every((l) => l.as != null)).toBe(true);
      const speakers = previewTrackingSpeakers(read, CTX);
      const choices = new Map<string, Choice>();
      for (const s of speakers) {
        const c = choose(g, s.status, s.match.allowNew, s.match.candidates);
        if (c) choices.set(s.speaker.key, c);
      }
      const decisions = new Map(doubleGroups(read).map((x) => [x.id, g.chance(0.5) ? ("parallel" as const) : ("merge" as const)]));
      const resolved = resolvedSpeakers(speakers, choices);
      const skipped = new Set([...resolved].filter(([, a]) => a?.action === "skip").map(([k]) => k));
      const plans = planLessons(read, { decisions, categories: new Map(), sources: new Map(), alias: speakerAliases(speakers, choices), skipped })!;
      const p = archivePayload(plans, speakers, choices, { label: "ארכיון", start_date: null, source: "tracking-5786", titles_from: null });
      expect(p, `seed ${seed}`).not.toBeNull();
      for (const s of p!.speakers) {
        expect(leaked([s.name, s.title, s.affiliation, ...s.topics, s.notes]), `seed ${seed}`).toEqual([]);
        expect(() => cleanSpeakerRow(s, DEFAULT_TITLES), `seed ${seed}`).not.toThrow();
      }
      for (const l of p!.lessons) {
        expect(leaked([l.title, l.audience, l.sources_note, l.import_note]), `seed ${seed} lesson ${l.row}`).toEqual([]);
        expect(() => cleanLessonRow(l, new Set(), p!.speakers.length, { first_day_from: null, last_day_until: 1140 }), `seed ${seed}`).not.toThrow();
        lessons++;
      }
    }
    expect(lessons).toBeGreaterThan(CASES);
  }, SLOW);

  it(`(c) the escorts' file: ${CASES} random files — a row is a channel from the list and the admin's note; a note with a contact is never sent`, () => {
    const head = ["מרצה", "מלווה", "הערות"];
    const m: Mapping = ["speaker", null, "phrases"];
    const PHRASES = ["דרך המזכירה", "רק בוואטסאפ", "רק במייל", "להתקשר ערב לפני", "זמין בשעות הבוקר", "לא לשלוח הודעות בשבת"];
    const NOTES = ["בבוקר", "אחרי הצהריים", "בימי חול", "רק בערב", "לא בשבת"];
    let rowsSent = 0;
    let refused = 0;
    for (let seed = 1; seed <= CASES; seed++) {
      const g = rng(20_000 + seed);
      made = { phones: [], emails: [] };
      const rows = Array.from({ length: 1 + g.int(6) }, () => [
        sprinkle(g, g.pick(POOL).name, 0.2),
        g.chance(0.3) ? sprinkle(g, NAME(g), 0.5) : "",
        Array.from({ length: 1 + g.int(3) }, () => sprinkle(g, g.pick(PHRASES), 0.4)).join(g.pick(["\n", ". ", "; "])),
      ]);
      const fileWords = new Set(rows.flatMap((r) => [r[1], r[2]]).join(" ").split(/[^א-ת]+/).filter((w) => w.length >= 2));
      const grid = [head, ...rows];
      const read = readEscorts(grid, m, { headerRow: 0, titles: DEFAULT_TITLES });
      const preview = previewEscorts(read, CTX, escortNames(grid, 0, escortColumns(grid, 0)));
      // the admin's answers: the suggestion or another channel or none; a note of their own — now and then with a contact
      const answers = new Map<string, EscortAnswer>(
        preview.map((x) => [x.key, { channel: g.chance(0.6) ? x.suggested : g.pick([null, ...IMPORT_CHANNELS]), note: g.chance(0.5) ? sprinkle(g, g.pick(NOTES), 0.3) : "" }]),
      );
      const choices = new Map(preview.filter((x) => x.status === "ambiguous").map((x) => [x.key, x.match?.candidates.length ? ({ action: "merge", target: x.match.candidates[0].id } as Choice) : ({ action: "skip" } as Choice)]));
      let p = escortsPayload(preview, choices, answers);
      if (p == null) {
        // a note holds a contact: nothing is sent — the admin takes it out
        refused++;
        expect([...answers.values()].some((a) => a.channel && hasContact(a.note)), `seed ${seed}`).toBe(true);
        for (const [k, a] of answers) answers.set(k, { ...a, note: hasContact(a.note) ? g.pick(NOTES) : a.note });
        p = escortsPayload(preview, choices, answers);
      }
      expect(p, `seed ${seed}`).not.toBeNull();
      for (const row of p!.rows) {
        expect(Object.keys(row).every((k) => PREFS_KEYS.includes(k)), `seed ${seed}`).toBe(true);
        expect(leaked([row.note]), `seed ${seed}`).toEqual([]);
        // not a word of the file: the note is the admin's
        expect((row.note ?? "").split(/[^א-ת]+/).filter((w) => fileWords.has(w) && !NOTES.join(" ").includes(w)), `seed ${seed}`).toEqual([]);
        expect(() => cleanPrefsRow(row), `seed ${seed}`).not.toThrow();
        rowsSent++;
      }
    }
    expect(rowsSent).toBeGreaterThan(CASES / 2); // not vacuous: channels are sent
    expect(refused).toBeGreaterThan(10); // and a note with a contact was held back
  }, SLOW);

  it(`(d) ${CASES} random sheets of both kinds — what is no phone (verses, dates and times, pages, prices, years) survives whole, beside phones that do not`, () => {
    let kept = 0;
    for (let seed = 1; seed <= CASES; seed++) {
      const g = rng(60_000 + seed);
      made = { phones: [], emails: [] };
      // a word on each side: a number of no fixed length right before other digits takes them with it (a residual)
      const text = () => {
        const np = nonPhone(g);
        expect(hasContact(np), `seed ${seed}: ${JSON.stringify(np)}`).toBe(false);
        const t = `${words(g, 1)} ${np} ${words(g, 1)}`;
        const c = g.chance(0.5) ? contact(g) : null;
        return { np, cell: c ? g.pick([`${c} ${t}`, `${t} ${c}`, `${t}\n${c}`, `${c}\n${t}`, `${t} - ${c}`, `${t}, ${c} ${words(g, 1)}`]) : t };
      };
      // the tracking sheet: the title and a note column
      const rows = Array.from({ length: 1 + g.int(4) }, (_, i) => ({ title: text(), note: text(), speaker: `${TITLE(g)}${NAME(g)}`, when: `${["ראשון", "שני", "שלישי"][i % 3]} ${["8:30", "10:00", "11:30", "17:00"][Math.floor(i / 3)]}` }));
      const grid = [["מרצה", "שיעור ב", "כותרת", "הערות"], ...rows.map((r) => [r.speaker, r.when, r.title.cell, r.note.cell])];
      const read = readTracking(grid, ["speaker", "when", "title", "note"], { headerRow: 0, titles: DEFAULT_TITLES, genderFromTitle: true });
      const speakers = previewTrackingSpeakers(read, CTX);
      const choices = new Map<string, Choice>(speakers.filter((x) => x.status === "ambiguous").map((x) => [x.speaker.key, { action: x.match.allowNew ? "new" : "skip" } as Choice]));
      const plans = planLessons(read, { decisions: new Map(), categories: new Map(), sources: new Map(), alias: speakerAliases(speakers, choices) })!;
      const p = archivePayload(plans, speakers, choices, { label: "ארכיון", start_date: null, source: "tracking-5786", titles_from: null })!;
      for (const l of p.lessons) {
        const r = rows[l.row - 2];
        expect(l.title ?? "", `seed ${seed}: ${JSON.stringify(r.title.cell)}`).toContain(r.title.np);
        expect(l.import_note ?? "", `seed ${seed}: ${JSON.stringify(r.note.cell)}`).toContain(r.note.np);
        expect(leaked([l.title, l.import_note]), `seed ${seed}`).toEqual([]);
        kept += 2;
      }
      // the candidates: the note column and the affiliation
      const cand = Array.from({ length: 1 + g.int(4) }, () => ({ name: `${TITLE(g)}${NAME(g)}`, aff: nonPhone(g), note: text() }));
      const cg = [["מרצה", "מוסד", "הערות"], ...cand.map((c) => [c.name, `מכון ${c.aff}`, c.note.cell])];
      const cp = previewCandidates(readCandidateSheet(cg, ["name", "affiliation", "note"], { headerRow: 0, titles: DEFAULT_TITLES, genderFromTitle: true }).rows, CTX);
      const cc = new Map<string, Choice>();
      for (const r of undecided(cp, cc)) cc.set(r.ref, r.match?.allowNew ? { action: "new" } : { action: "skip" });
      for (const row of candidatesPayload(cp, cc, "x", null)!.rows) {
        const c = cand[row.row - 2];
        expect(row.affiliation, `seed ${seed}`).toBe(`מכון ${c.aff}`);
        expect(row.notes ?? "", `seed ${seed}: ${JSON.stringify(c.note.cell)}`).toContain(c.note.np);
        expect(leaked([row.name, row.affiliation, row.notes]), `seed ${seed}`).toEqual([]);
        kept += 2;
      }
    }
    expect(kept).toBeGreaterThan(CASES * 4); // not vacuous
  }, SLOW);
});

/** An escort's made-up name — words of seven letters, never a speaker's (3–6) nor a word that is no one's name. */
function escortPerson(g: R): { first: string; last: string } {
  const w = (): string => {
    const x = word(g, 7, 7);
    return NOT_A_NAME.has(x) ? w() : x;
  };
  return { first: w(), last: w() };
}
/** A word of a name as a text may write it: after up to four prefix letters, with niqqud or a mark inside. */
function spelled(g: R, w: string): string {
  const prefix = g.pick(["", "", "ו", "ל", "ש", "וה", "מה", "וכש", "ושכש"]);
  const mark = g.pick(["", "", "", "‌", "­", "​", "ִ"]);
  const at = 1 + g.int(w.length - 1);
  return `${prefix}${w.slice(0, at)}${mark}${w.slice(at)}`;
}
/** The escorts' cell as last year wrote it — and the words of every name it gives (a nickname in brackets too). */
function escortCell(g: R, a: { first: string; last: string }, b: { first: string; last: string }): [string, string[]] {
  const nick = word(g, 7, 7);
  return g.pick([
    () => [`${a.first} ${a.last}`, [a.first, a.last]],
    () => [`${a.first} ${a.last} ${phone(g)}`, [a.first, a.last]],
    () => [`${a.first} ${a.last} (שנה ב)`, [a.first, a.last]],
    () => [`${a.first} ${a.last} ו${b.first} ${b.last}`, [a.first, a.last, b.first, b.last]],
    () => [`${a.first} ${a.last} (ו${b.first} ${b.last})`, [a.first, a.last, b.first, b.last]],
    () => [`${a.first} (${nick}) ${a.last}`, [a.first, a.last, nick]],
    () => [`${a.first} ${a.last} [מחליפה: ${b.first} ${b.last}]`, [a.first, a.last, b.first, b.last]],
    () => [`${a.first[0]}. ${a.last}`, [a.last]],
  ] as (() => [string, string[]])[])();
}

describe("invariant 2: an escort's name never reaches the payload", () => {
  it(`(c) ${CASES} random escorts' files — named every way in the phrases, whatever the admin answers: no escort's word is sent`, () => {
    let warned = 0;
    let sent = 0;
    for (let seed = 1; seed <= CASES; seed++) {
      const g = rng(30_000 + seed);
      made = { phones: [], emails: [] };
      const people = Array.from({ length: 2 + g.int(3) }, () => escortPerson(g));
      const said: string[] = [];
      const rows = Array.from({ length: 2 + g.int(5) }, (_, i) => {
        const [cell, ws] = escortCell(g, people[i % people.length], people[(i + 1) % people.length]);
        said.push(...ws);
        const phrase = `${g.pick(["דרך המזכירה", "רק בוואטסאפ", "רק במייל", "להתקשר"])} ${g.pick(["עם", "מול", ""])} ${spelled(g, g.pick(ws.length ? ws : [people[0].first]))}`;
        return [g.pick(POOL).name, cell, phrase];
      });
      const head = ["מרצה", g.pick(["מלווה", "מלוה", "מלווה/ת", "ליווי", "חניך/ה", "שם החניך/ה"]), "הערות"];
      const grid = [head, ...rows];
      // the wizard asks which column: the admin answers it (escortCols ∪ the answer)
      const cols = new Set([...escortColumns(grid, 0), 1]);
      const m: Mapping = ["speaker", null, "phrases"];
      const read = readEscorts(grid, m, { headerRow: 0, titles: DEFAULT_TITLES });
      const preview = previewEscorts(read, CTX, escortNames(grid, 0, cols));
      warned += preview.flatMap((x) => x.phrases).filter((p) => p.escort).length;
      const answers = new Map<string, EscortAnswer>(preview.map((x) => [x.key, { channel: g.pick([x.suggested, ...IMPORT_CHANNELS]), note: g.chance(0.3) ? "בבוקר" : "" }]));
      const p = escortsPayload(preview, new Map(), answers)!;
      const text = JSON.stringify(p);
      for (const w of said) expect(text.includes(w), `seed ${seed}: «${w}» in ${text}`).toBe(false);
      expect(text.replace(/בבוקר/g, ""), `seed ${seed}`).not.toMatch(/[א-ת]/); // not one Hebrew letter of the file
      sent += p.rows.length;
    }
    expect(sent).toBeGreaterThan(CASES); // not vacuous: rows are sent
    expect(warned).toBeGreaterThan(CASES); // and the names are said beside their phrases
  }, SLOW);

  it(`(b) ${CASES} random tracking sheets — the escorts' column asked for and never read; a line naming an escort proposed «לא לייבא»`, () => {
    let proposed = 0;
    for (let seed = 1; seed <= CASES; seed++) {
      const g = rng(40_000 + seed);
      made = { phones: [], emails: [] };
      const people = Array.from({ length: 2 + g.int(3) }, () => escortPerson(g));
      const said: string[] = [];
      const rows = Array.from({ length: 1 + g.int(6) }, (_, i) => {
        const [cell, ws] = escortCell(g, people[i % people.length], people[(i + 1) % people.length]);
        said.push(...ws);
        const w = g.pick(ws.length ? ws : [people[0].first]);
        const line = g.pick([
          "", "", `\n${spelled(g, w)}`, `\n(מלווה: ${w})`, `\n(${w})`, `\nהמלווה ${w}`, `\n${NAME(g)}`, `\n(ישיבת ${word(g)})`,
          // on the name's own line (סבב חמישי): a bracket at its end, or a name beside it
          ` (מלווה: ${w})`, ` (${spelled(g, w)})`, ` (ישיבת ${word(g)})`, ` + ${spelled(g, w)}`, ` / ${w}`, ` + ${NAME(g)} (${w})`,
        ]);
        return [`${TITLE(g)}${NAME(g)}${line}`, g.pick(["ראשון 8:30", "שני 10:00", "שלישי 11:30"]), words(g, 2), cell];
      });
      const head = ["מרצה", "שיעור ב", "כותרת", g.pick(["מלווה", "מלוה", "מלווה/ת", "ליווי", "חניך/ה", "שם החניך/ה"])];
      const grid = [head, ...rows];
      expect(escortLike(grid, 0), `seed ${seed}`).toBe(true); // the wizard asks
      const cols = new Set([...escortColumns(grid, 0), 3]); // …and the admin answers
      const m: Mapping = ["speaker", "when", "title", null];
      const escorts = escortNames(grid, 0, cols);
      const base = { headerRow: 0, titles: DEFAULT_TITLES, genderFromTitle: true, escorts };
      // the proposals accepted, the rest decided at random
      const { read, seen } = decideAll(g, (lineAs) => readTracking(grid, m, { ...base, lineAs }));
      for (const l of seen) {
        if (said.some((w) => foldContact(l.text).replace(/[֑-ׇ]/g, "").includes(w)) || /מלוו/.test(l.text)) {
          expect(l.as, `seed ${seed}: «${l.text}»`).toBe("skip");
          proposed++;
        }
      }
      const speakers = previewTrackingSpeakers(read, CTX);
      const choices = new Map<string, Choice>(speakers.filter((s) => s.status === "ambiguous").map((s) => [s.speaker.key, { action: s.match.allowNew ? "new" : "skip" } as Choice]));
      const plans = planLessons(read, { decisions: new Map(doubleGroups(read).map((x) => [x.id, "parallel" as const])), categories: new Map(), sources: new Map(), alias: speakerAliases(speakers, choices) })!;
      const p = archivePayload(plans, speakers, choices, { label: "ארכיון", start_date: null, source: "tracking-5786", titles_from: null })!;
      const text = JSON.stringify(p);
      for (const w of said) expect(text.includes(w), `seed ${seed}: «${w}»`).toBe(false);
    }
    expect(proposed).toBeGreaterThan(CASES / 2); // not vacuous: escorts' lines were placed, and proposed «לא לייבא»
  }, SLOW);

  it(`(a) ${CASES} random candidates' tables — a name beside or under the candidate's that names an escort proposed «לא לייבא»`, () => {
    let proposed = 0;
    for (let seed = 1; seed <= CASES; seed++) {
      const g = rng(50_000 + seed);
      made = { phones: [], emails: [] };
      const people = Array.from({ length: 2 + g.int(3) }, () => escortPerson(g));
      const said: string[] = [];
      const rows = Array.from({ length: 1 + g.int(6) }, (_, i) => {
        const [cell, ws] = escortCell(g, people[i % people.length], people[(i + 1) % people.length]);
        said.push(...ws);
        const w = g.pick(ws.length ? ws : [people[0].first]);
        const extra = g.pick([
          "", "", `\n${spelled(g, w)}`, ` + ${w}`, `\n(מלווה: ${w})`, `\n${NAME(g)}`, ` + ${NAME(g)}`,
          // a bracket at the end of the name (סבב חמישי) — of the candidate, or of a name beside it
          ` (מלווה: ${w})`, ` (${spelled(g, w)})`, ` (ישיבת ${word(g)})`, ` + ${NAME(g)} (${spelled(g, w)})`,
        ]);
        return [`${TITLE(g)}${NAME(g)}${extra}`, cell];
      });
      const grid = [["מרצה", g.pick(["מלווה", "מלוה", "ליווי", "חניך/ה"])], ...rows];
      const cols = escortColumns(grid, 0);
      expect([...cols], `seed ${seed}`).toEqual([1]);
      const o = { headerRow: 0, titles: DEFAULT_TITLES, genderFromTitle: true, escorts: escortNames(grid, 0, cols) };
      const { read, seen } = decideAll(g, (lineAs) => readCandidateSheet(grid, ["name", null], { ...o, lineAs }));
      for (const l of seen) {
        if (said.some((w) => foldContact(l.text).replace(/[֑-ׇ]/g, "").includes(w)) || /מלוו/.test(l.text)) {
          expect(l.as, `seed ${seed}: «${l.text}»`).toBe("skip");
          proposed++;
        }
      }
      const preview = previewCandidates(read.rows, CTX);
      const choices = new Map<string, Choice>();
      for (const r of undecided(preview, choices)) choices.set(r.ref, r.match?.allowNew ? { action: "new" } : { action: "skip" });
      const text = JSON.stringify(candidatesPayload(preview, choices, "x", null));
      for (const w of said) expect(text.includes(w), `seed ${seed}: «${w}»`).toBe(false);
    }
    expect(proposed).toBeGreaterThan(CASES / 2);
  }, SLOW);
});
