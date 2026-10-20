// Finding a row's speaker in the pool, before anything is written — «חדש · תואם · עמום · מדולג»:
//   the same name key (app.name_key: titles, quotes, niqqud and dashes aside) → «תואם»;
//   the same phone (by its key, public.import_lookup answers which pool speaker has it) → «תואם»;
//   a name key at least 0.6 alike (pg_trgm's similarity, «הצעה» — the pool's own SIMILAR_THRESHOLD) → «עמום»,
//   the admin chooses per row: complete one of the candidates, a new speaker, or skip it;
//   nothing → «חדש» — unless an EARLIER row of the same table, also new to the pool, has the same phone or a name
//   0.6 alike (sheetMatches): then «עמום» too, the admin choosing «אותו/ה מרצה כמו שורה N», a new speaker (a couple
//   on one line are two people), or skip.
// A match only FILLS what the pool speaker lacks — never overwrites, never a gender the speaker's own title
// contradicts — and the preview says what it would fill.
import { SIMILAR_THRESHOLD } from "../data/speakerRules";
import type { ContactFlags } from "../data/imports";
import { displayName } from "../domain/names";
import { titleGender } from "./speakerName";
import { similarity, trigrams } from "../domain/trigram";
import type { ContactPref, Gender, Speaker } from "../domain/types";

export type RowStatus = "new" | "match" | "ambiguous" | "skip";

export interface MatchCandidate {
  id: number;
  /** «ד״ר מרצה 07 (ירושלים)». */
  label: string;
  via: "name" | "phone" | "similar";
  /** pg_trgm similarity, for «similar». */
  similarity: number | null;
}

/** An earlier row of the same table a row may be the same speaker as. */
export interface SheetCandidate {
  /** The row's reference: its row number (the candidates) or its speaker's key (the tracking sheet). */
  ref: string;
  /** «שורה 3 · הרב מרצה לדוגמה». */
  label: string;
  via: "phone" | "similar";
  similarity: number | null;
}

export interface SpeakerMatch {
  status: "new" | "match" | "ambiguous";
  /** «ambiguous» within the table: the earlier rows it may be (empty: none). */
  sheet?: SheetCandidate[];
  /** «match»: the pool speaker it completes. */
  target: number | null;
  via: "name" | "phone" | "similar" | null;
  candidates: MatchCandidate[];
  /** «ambiguous»: may the admin make it a new speaker? Not when the very name key is taken twice (a namesake needs a disambiguator). */
  allowNew: boolean;
}

/** What the admin chose for a row: complete a pool speaker, add a new one, be an earlier row's speaker, or leave the row out. */
export type Choice = { action: "merge"; target: number } | { action: "new" } | { action: "same"; ref: string } | { action: "skip" };

const label = (s: Speaker) => `${displayName(s)}${s.disambiguator ? ` (${s.disambiguator})` : ""}`;

/** The pool speaker a row is — or the candidates it may be. `phones`: phone key → pool speakers with it (import_lookup). */
export function matchSpeaker(key: string, phone: string | null, pool: readonly Speaker[], phones: ReadonlyMap<string, readonly number[]>): SpeakerMatch {
  const same = pool.filter((s) => s.name_key === key);
  if (same.length === 1) return { status: "match", target: same[0].id, via: "name", candidates: [{ id: same[0].id, label: label(same[0]), via: "name", similarity: null }], allowNew: false };
  if (same.length > 1) {
    return { status: "ambiguous", target: null, via: "name", candidates: same.map((s) => ({ id: s.id, label: label(s), via: "name" as const, similarity: null })), allowNew: false };
  }
  const byPhone = phone ? (phones.get(phone) ?? []).map((id) => pool.find((s) => s.id === id)).filter((s): s is Speaker => !!s) : [];
  if (byPhone.length === 1) return { status: "match", target: byPhone[0].id, via: "phone", candidates: [{ id: byPhone[0].id, label: label(byPhone[0]), via: "phone", similarity: null }], allowNew: false };
  if (byPhone.length > 1) {
    return { status: "ambiguous", target: null, via: "phone", candidates: byPhone.map((s) => ({ id: s.id, label: label(s), via: "phone" as const, similarity: null })), allowNew: true };
  }
  const min = Math.fround(SIMILAR_THRESHOLD);
  const alike = pool
    .map((s) => ({ s, sim: similarity(s.name_key, key) }))
    .filter((x) => x.sim >= min)
    .sort((a, b) => b.sim - a.sim || a.s.id - b.s.id)
    .slice(0, 5);
  if (alike.length) {
    return { status: "ambiguous", target: null, via: "similar", candidates: alike.map(({ s, sim }) => ({ id: s.id, label: label(s), via: "similar" as const, similarity: sim })), allowNew: true };
  }
  return { status: "new", target: null, via: null, candidates: [], allowNew: true };
}

/** pg_trgm's similarity of two trigram sets made once (similarity() makes them on every call). */
function setSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return Math.fround(shared / (a.size + b.size - shared));
}

export interface SheetItem {
  ref: string;
  key: string;
  phoneKey: string | null;
  label: string;
}

/**
 * The rows the pool left «חדש», each against the EARLIER such rows of the same table: the same phone, or a name key
 * at least 0.6 alike (the pool's threshold) — two rows the commit would otherwise make two speakers of, or one, without
 * the admin seeing it. ref → its candidates (at most five; none: not there).
 */
export function sheetMatches(items: readonly SheetItem[]): Map<string, SheetCandidate[]> {
  const min = Math.fround(SIMILAR_THRESHOLD);
  const sets = items.map((i) => trigrams(i.key));
  const out = new Map<string, SheetCandidate[]>();
  items.forEach((it, i) => {
    const found: SheetCandidate[] = [];
    for (let j = 0; j < i; j++) {
      const o = items[j];
      if (it.phoneKey != null && it.phoneKey === o.phoneKey) found.push({ ref: o.ref, label: o.label, via: "phone", similarity: null });
      else {
        const sim = setSimilarity(sets[i], sets[j]);
        if (sim >= min) found.push({ ref: o.ref, label: o.label, via: "similar", similarity: sim });
      }
    }
    if (found.length) out.set(it.ref, found.sort((a, b) => (a.via === b.via ? (b.similarity ?? 0) - (a.similarity ?? 0) : a.via === "phone" ? -1 : 1)).slice(0, 5));
  });
  return out;
}

/** A pool «חדש» made «עמום» by the earlier rows of its table it may be. */
export const ambiguousInSheet = (m: SpeakerMatch, sheet: SheetCandidate[] | undefined): SpeakerMatch =>
  sheet?.length ? { ...m, status: "ambiguous", via: null, sheet, allowNew: true } : m;

/** What the commit does for a row — «אותו/ה מרצה כמו …» followed to the row it names (null: still undecided). */
export type Resolved = { action: "skip" } | { action: "merge"; target: number } | { action: "new"; as: string | null };

/**
 * A row's action with the earlier rows it may name followed: «כמו שורה N» is a new speaker under row N's name (the
 * commit completes the speaker row N makes — filling only what is empty), or nothing when row N is left out.
 */
export function resolveChoice(ref: string, own: (ref: string) => Choice | null, depth = 0): Resolved | null {
  const a = own(ref);
  if (a == null || depth > 50) return null;
  if (a.action !== "same") return a.action === "new" ? { action: "new", as: null } : a;
  const to = resolveChoice(a.ref, own, depth + 1);
  if (to == null || to.action === "skip") return null;
  return to.action === "new" ? { action: "new", as: to.as ?? a.ref } : to;
}

/** What a row brings for a speaker (what a match could fill). */
export interface SpeakerFill {
  title: string | null;
  gender: Gender | null;
  affiliation: string | null;
  topics: string[];
  contact_pref?: ContactPref | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  secretary_note?: string | null;
}

/** The fields a match would fill — each empty in the pool and given by the row (the commit's rule, app.import_fill). */
export function fillPlan(existing: Speaker, flags: ContactFlags | undefined, d: SpeakerFill): string[] {
  const c = flags ?? { phone: false, email: false, secretary_note: false, notes: false };
  const out: string[] = [];
  if (existing.title == null && d.title) out.push("תואר");
  if (existing.gender == null && d.gender) {
    // the pool's own title says the other gender: never filled (app.import_speaker)
    const own = titleGender(existing.title);
    if (own != null && own !== d.gender) out.push(`מגדר: לא ימולא — במאגר התואר ${existing.title}`);
    else out.push(`מגדר: ${d.gender === "m" ? "זכר" : "נקבה"} (הצעה, מהתואר)`);
  }
  if (existing.affiliation == null && d.affiliation) out.push("מוסד");
  if (existing.topics.length === 0 && d.topics.length) out.push("נושאים");
  if (existing.contact_pref == null && d.contact_pref) out.push("ערוץ קשר");
  if (!c.phone && d.phone) out.push("טלפון");
  if (!c.email && d.email) out.push("מייל");
  if (!c.notes && d.notes) out.push("הערות");
  if (!c.secretary_note && d.secretary_note) out.push("איך פונים");
  return out;
}

/** The action a row takes now: its match, a new speaker, or the admin's choice (null: an «עמום» not decided yet). */
export function actionOf(status: RowStatus, m: SpeakerMatch | null, choice: Choice | undefined): Choice | null {
  if (choice?.action === "skip" || status === "skip") return { action: "skip" };
  if (status === "match" && m?.target != null) return { action: "merge", target: m.target };
  if (status === "new") return { action: "new" };
  if (!choice) return null;
  if (choice.action === "same") return m?.sheet?.some((c) => c.ref === choice.ref) ? choice : null;
  if (choice.action === "new" && !m?.allowNew) return null;
  if (choice.action === "merge" && !m?.candidates.some((c) => c.id === choice.target)) return null;
  return choice;
}
