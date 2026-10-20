// The import's two privacy invariants, as properties (DECISIONS «ביקורת: ייבוא ואבן דרך 6», סבב שלישי) — random
// tables, seeded, thousands of them, through the whole wizard pipeline to the payload the commit would send:
//   1. a phone or an e-mail found ANYWHERE in the input — every cell, every position, every form the readers know
//      («טל'», brackets, dashes of every kind, +972, a bidi mark between the digits, a second line, two numbers in a
//      cell) — lands only in a contact field (phone, email); never in a name, a title, an affiliation, a tag, a note, a
//      lesson's title / audience / sources note / import note, or the escorts' note (secretary_note). And the commit's
//      backstop (importRules — the engine's and the database's «contact_in_text») never refuses what the wizard sends.
//   2. an escort's name — by first name, by surname, whole, after a Hebrew prefix letter — is never pre-ticked, and
//      never saved in a note unedited (nor edited, while a word of it is still there).
// Every person and number here is made up at run time (the digits from the seed): none is in this file.
import { describe, expect, it } from "vitest";
import { cleanLessonRow, cleanPrefsRow, cleanSpeakerRow } from "../data/importRules";
import { DEFAULT_TITLES } from "../data/speakerRules";
import type { Speaker } from "../domain/types";
import { candidatesPayload, contextOf, type MatchContext, previewCandidates, readCandidates, undecided } from "./candidates";
import { escortColumns, escortNames, escortsPayload, NOT_A_NAME, phrasesOf, previewEscorts, readEscorts } from "./escorts";
import type { Mapping } from "./fields";
import type { Choice } from "./match";
import { hasContact } from "./phone";
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

/** A phone, in one of the forms last year's files wrote them — its digits made up now. */
function phone(g: R): string {
  const a = `0${digits(g, 2)}`;
  const b = digits(g, 3);
  const c = digits(g, 4);
  return g.pick([
    () => `${a}-${b}${c}`,
    () => `${a} ${b} ${c}`,
    () => `${a}${b}${c}`,
    () => `${a}.${b}.${c}`,
    () => `+972-${a.slice(1)}-${b}-${c}`,
    () => `+972 (0)${a.slice(1)} ${b}${c}`,
    () => `(0${digits(g, 1)}) ${b}-${c}`,
    () => `${a}‏-‏${b}‏-${c}`, // bidi marks, as a copy from WhatsApp carries them
    () => `${a}‑${b}‑${c}`, // non-breaking hyphens
    () => `${a}–${b}${c}`,
    () => `${a} ${b} ${c}`,
    () => `${a}-${b}\n${c}`, // broken over a line
  ])();
}
function email(g: R): string {
  const at = `${latin(g)}${g.chance(0.3) ? `.${latin(g)}` : ""}@${g.pick(["example.org", "example.com", "test.example.net"])}`;
  return g.pick([() => at, () => `mailto:${at}`, () => `<${at}>`])();
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

/** The digit runs of every phone the case wrote (7+ digits): none may be found in a field that is not a contact. */
function leaked(fields: (string | null | undefined)[], phones: string[], emails: string[]): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (!f) continue;
    if (hasContact(f)) out.push(`contact: ${JSON.stringify(f)}`);
    const d = f.replace(/[^0-9]/g, "");
    for (const p of phones) if (d.includes(p.replace(/[^0-9]/g, "").slice(-7))) out.push(`digits of ${p}: ${JSON.stringify(f)}`);
    for (const e of emails) if (f.includes(e)) out.push(`e-mail ${e}: ${JSON.stringify(f)}`);
  }
  return out;
}
/** Every contact a case's cells hold (as generated), to look for afterwards. */
function contactsIn(cells: string[]): { phones: string[]; emails: string[] } {
  const all = cells.join("\n");
  const phones = [...all.matchAll(/\+?[0-9][0-9 \n() ‏‑.–-]{6,}[0-9]/g)].map((m) => m[0]).filter((m) => m.replace(/[^0-9]/g, "").length >= 7);
  const emails = [...all.matchAll(/[a-z.]+@[a-z.]+\.[a-z]+/g)].map((m) => m[0]);
  return { phones, emails };
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
const CASES = 1500;

describe("invariant 1: a phone or an e-mail lands only in a contact field — and the commit's backstop agrees", () => {
  it(`(a) the candidates: ${CASES} random tables`, () => {
    const head = ["מרצה", "תואר", "מוסד", "נושאים", "טלפון", "מייל", "טווח ימים", "הערות"];
    const m: Mapping = ["name", "title", "affiliation", "topics", "phone", "email", "status", "note"];
    let checked = 0;
    for (let seed = 1; seed <= CASES; seed++) {
      const g = rng(seed);
      const rows = Array.from({ length: 1 + g.int(6) }, () => [
        sprinkle(g, `${TITLE(g)}${NAME(g)}`, 0.4),
        sprinkle(g, g.pick(["", "הרב", "רבי", words(g, 1)]), 0.2),
        sprinkle(g, g.chance(0.5) ? `ישיבת ${word(g)}` : "", 0.3),
        sprinkle(g, `${words(g, 1)}, ${words(g, 2)}`, 0.3),
        g.pick(["", "", phone(g), "אין", `${phone(g)} / ${phone(g)}`]),
        g.pick(["", "", email(g), "לא ידוע"]),
        sprinkle(g, g.pick(["", "א-ב", "נסגר"]), 0.2),
        sprinkle(g, words(g, 3), 0.5),
      ]);
      const { phones, emails } = contactsIn(rows.flatMap((r) => [r[0], r[1], r[2], r[3], r[6], r[7]]));
      const read = readCandidates([head, ...rows], m, { headerRow: 0, titles: DEFAULT_TITLES, genderFromTitle: true });
      const preview = previewCandidates(read, CTX);
      const choices = new Map<number, Choice>();
      for (const r of undecided(preview, choices)) choices.set(r.row, choose(g, r.status, r.match?.allowNew, r.match?.candidates ?? []) ?? { action: "skip" });
      const p = candidatesPayload(preview, choices, "brainstorm-5786", null);
      expect(p, `seed ${seed}`).not.toBeNull();
      for (const row of p!.rows) {
        const bad = leaked([row.name, row.title, row.affiliation, ...row.topics, row.notes], phones, emails);
        expect(bad, `seed ${seed} row ${row.row}`).toEqual([]);
        expect(() => cleanSpeakerRow(row, DEFAULT_TITLES), `seed ${seed}`).not.toThrow();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(CASES);
  });

  it(`(b) the tracking sheet: ${CASES} random sheets, every line and group decided at random`, () => {
    const head = ["מרצה", "שיעור ב", "כותרת", "מקורות (נשלח?)", "הסעה/תשלום", "טלפון", "קיבל הודעת סיכום מ", "נושא", "הערות"];
    const m: Mapping = ["speaker", "when", "title", "sources", "transport", "phone", "confirmFrom", "topic", "note"];
    const WHEN = ["ראשון 8:30", "ראשון 10:00", "שני 11:30", "שני 20:00 כפולה", "שלישי 8:30-10:00", "רביעי 22:00", "רביעי 00:30", "חמישי 10:00", "שלישי 20:00 - שיעור להורים"];
    let lessons = 0;
    for (let seed = 1; seed <= CASES; seed++) {
      const g = rng(10_000 + seed);
      const speakerCell = () => {
        const first = `${TITLE(g)}${NAME(g)}`;
        const second = g.pick(["", ` + ${NAME(g)}`, `\n(ישיבת ${word(g)})`, `\nמכון ${word(g)}`, `\n${NAME(g)}`, `\n${contact(g)}`, ` ${phone(g)}`]);
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
      const { phones, emails } = contactsIn(rows.flatMap((r) => [r[0], r[2], r[3], r[4], r[6], r[8]]));
      const grid = [head, ...rows];
      const base = { headerRow: 0, titles: DEFAULT_TITLES, genderFromTitle: true };
      const first = readTracking(grid, m, base);
      const lineAs = new Map(first.lines.map((l) => [l.id, l.as ?? (g.chance(0.5) ? "affiliation" : "speaker")] as const));
      const read = readTracking(grid, m, { ...base, known: new Set(POOL.map((s) => s.name_key)), lineAs });
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
        expect(leaked([s.name, s.title, s.affiliation, ...s.topics, s.notes], phones, emails), `seed ${seed}`).toEqual([]);
        expect(() => cleanSpeakerRow(s, DEFAULT_TITLES), `seed ${seed}`).not.toThrow();
      }
      for (const l of p!.lessons) {
        expect(leaked([l.title, l.audience, l.sources_note, l.import_note], phones, emails), `seed ${seed} lesson ${l.row}`).toEqual([]);
        expect(() => cleanLessonRow(l, new Set(), p!.speakers.length, { first_day_from: null, last_day_until: 1140 }), `seed ${seed}`).not.toThrow();
        lessons++;
      }
    }
    expect(lessons).toBeGreaterThan(CASES);
  });

  it(`(c) the escorts' file: ${CASES} random files, every phrase ticked, some edited to hold a contact`, () => {
    const head = ["מרצה", "מלווה", "הערות"];
    const m: Mapping = ["speaker", null, "phrases"];
    const PHRASES = ["דרך המזכירה", "רק בוואטסאפ", "רק במייל", "להתקשר ערב לפני", "זמין בשעות הבוקר", "לא לשלוח הודעות בשבת"];
    let notes = 0;
    for (let seed = 1; seed <= CASES; seed++) {
      const g = rng(20_000 + seed);
      const rows = Array.from({ length: 1 + g.int(6) }, () => [
        sprinkle(g, g.pick(POOL).name, 0.2),
        g.chance(0.3) ? sprinkle(g, NAME(g), 0.5) : "",
        Array.from({ length: 1 + g.int(3) }, () => sprinkle(g, g.pick(PHRASES), 0.4)).join(g.pick(["\n", ". ", "; "])),
      ]);
      const { phones, emails } = contactsIn(rows.map((r) => r[2]));
      const grid = [head, ...rows];
      const read = readEscorts(grid, m, { headerRow: 0, titles: DEFAULT_TITLES });
      const names = escortNames(grid, 0, escortColumns(grid, 0));
      const all = phrasesOf(read, names);
      const ticked = new Set(all.map((p) => p.key));
      const edits = new Map(all.filter(() => g.chance(0.2)).map((p) => [p.key, sprinkle(g, p.text, 1)] as const));
      const typed = contactsIn([...edits.values()]);
      const preview = previewEscorts(read, ticked, CTX, edits, names);
      const choices = new Map(preview.filter((x) => x.status === "ambiguous").map((x) => [x.key, x.match?.candidates.length ? ({ action: "merge", target: x.match.candidates[0].id } as Choice) : ({ action: "skip" } as Choice)]));
      const p = escortsPayload(preview, choices);
      expect(p, `seed ${seed}`).not.toBeNull();
      for (const row of p!.rows) {
        expect(leaked([row.secretary_note], [...phones, ...typed.phones], [...emails, ...typed.emails]), `seed ${seed}`).toEqual([]);
        expect(() => cleanPrefsRow(row), `seed ${seed}`).not.toThrow();
        if (row.secretary_note) notes++;
      }
    }
    expect(notes).toBeGreaterThan(CASES / 2); // not vacuous: notes are kept — without their numbers
  });
});

describe("invariant 2: an escort's name never lands in a saved note unless the admin edited it out", () => {
  it(`${CASES} random escorts' files: named by first name, surname, whole, after a prefix letter — never pre-ticked, never kept`, () => {
    const CHANNELS = ["דרך המזכירה", "רק בוואטסאפ", "רק במייל", "להתקשר בטלפון", "לפנות דרך המזכירות"];
    let kept = 0;
    let locked = 0;
    for (let seed = 1; seed <= CASES; seed++) {
      const g = rng(30_000 + seed);
      // a made-up name — never one of the words that are no one's name («של», «אין», «עם»…: escorts.ts NOT_A_NAME)
      const nameWord = (min: number, max: number): string => {
        const w = word(g, min, max);
        return NOT_A_NAME.has(w) ? nameWord(min, max) : w;
      };
      const people = Array.from({ length: 2 + g.int(4) }, () => ({ first: nameWord(2, 5), last: nameWord(3, 6) }));
      const roster = Array.from({ length: g.int(3) }, () => ({ first: nameWord(2, 5), last: nameWord(3, 6) }));
      // the escorts' cells as last year wrote them: a phone beside the name, «(שנה ב)», two joined by «ו», « - », an
      // initial, fillers — and the words of each name the file holds (an initial holds none of the first name)
      const known: string[][] = roster.map((x) => [x.first, x.last, `${x.first} ${x.last}`]);
      const cells = Array.from({ length: 2 + g.int(5) }, (_, i) => {
        const a = people[i % people.length];
        const b = people[(i + 1) % people.length];
        const full = (x: { first: string; last: string }) => [x.first, x.last, `${x.first} ${x.last}`];
        const [cell, names] = g.pick([
          () => [`${a.first} ${a.last}`, [full(a)]],
          () => [`${a.first} ${a.last} ${phone(g)}`, [full(a)]],
          () => [`${a.first} ${a.last} (שנה ב)`, [full(a)]],
          () => [`${a.first} ${a.last} ו${b.first} ${b.last}`, [full(a), full(b)]],
          () => [`${a.first} ${a.last} - ${phone(g)}`, [full(a)]],
          () => [`${a.first[0]}. ${a.last}`, [[a.last]]],
          () => [g.pick(["אין", "מגיע לבד", "—", "TBD", "?"]), []],
        ] as (() => [string, string[][]])[])();
        known.push(...names);
        return cell;
      });
      const rows = cells.map((cell) => {
        const said = known.length ? g.pick(g.pick(known)) : null;
        const prefix = g.pick(["", "", "ו", "ל", "ש", "וה", "מה"]);
        const named = said ? `${g.pick(CHANNELS)} ${g.pick(["עם", "מול", "דרך", ""])} ${prefix}${said}`.replace(/\s+/g, " ") : null;
        const plain = g.pick(CHANNELS);
        return [g.pick(POOL).name, cell, named && g.chance(0.6) ? `${named}\n${plain}` : plain];
      });
      const grid = [["מרצה", "מלווה", "הערות"], ...rows];
      const read = readEscorts(grid, ["speaker", null, "phrases"], { headerRow: 0, titles: DEFAULT_TITLES });
      const names = [...escortNames(grid, 0, escortColumns(grid, 0)), ...roster.map((r) => `${r.first} ${r.last}`)];
      const everyone = [...new Set(known.flat().flatMap((n) => n.split(" ")))].filter((w) => w.length >= 2);
      const holds = (text: string) => text.split(/[^א-ת]+/).some((w) => everyone.some((n) => w === n || (/^[והבכלמש]{1,2}$/.test(w.slice(0, w.length - n.length)) && w.endsWith(n))));
      const ps = phrasesOf(read, names);
      for (const p of ps) {
        if (!holds(p.text)) continue;
        expect(p.contact, `seed ${seed}: «${p.text}» pre-ticked`).toBe(false);
        expect(p.escort, `seed ${seed}: «${p.text}»`).not.toBeNull();
        locked++;
      }
      // ticked anyway — unedited, and edited with the name still in it
      const ticked = new Set(ps.map((p) => p.key));
      const editedKeepingName = new Map(ps.filter((p) => holds(p.text)).map((p) => [p.key, `${p.text} בבקשה`] as const));
      for (const edits of [new Map<string, string>(), editedKeepingName]) {
        const out = escortsPayload(previewEscorts(read, ticked, CTX, edits, names), new Map())!;
        for (const row of out.rows) {
          expect(holds(row.secretary_note ?? ""), `seed ${seed}: «${row.secretary_note}»`).toBe(false);
          if (row.secretary_note) kept++;
        }
      }
    }
    expect(locked).toBeGreaterThan(CASES); // not vacuous: names were placed, and caught
    expect(kept).toBeGreaterThan(CASES / 2); // and the channel phrases without a name are still kept
  });
});
