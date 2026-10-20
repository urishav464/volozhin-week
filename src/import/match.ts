// Finding a row's speaker in the pool, before anything is written — «חדש · תואם · עמום · מדולג»:
//   the same name key (app.name_key: titles, quotes, niqqud and dashes aside) → «תואם»;
//   the same phone (by its key, public.import_lookup answers which pool speaker has it) → «תואם»;
//   a name key at least 0.6 alike (pg_trgm's similarity, «הצעה» — the pool's own SIMILAR_THRESHOLD) → «עמום»,
//   the admin chooses per row: complete one of the candidates, a new speaker, or skip it;
//   nothing → «חדש».
// A match only FILLS what the pool speaker lacks — never overwrites — and the preview says what it would fill.
import { SIMILAR_THRESHOLD } from "../data/speakerRules";
import type { ContactFlags } from "../data/imports";
import { displayName } from "../domain/names";
import { similarity } from "../domain/trigram";
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

export interface SpeakerMatch {
  status: "new" | "match" | "ambiguous";
  /** «match»: the pool speaker it completes. */
  target: number | null;
  via: "name" | "phone" | "similar" | null;
  candidates: MatchCandidate[];
  /** «ambiguous»: may the admin make it a new speaker? Not when the very name key is taken twice (a namesake needs a disambiguator). */
  allowNew: boolean;
}

/** What the admin chose for a row: complete a pool speaker, add a new one, or leave the row out. */
export type Choice = { action: "merge"; target: number } | { action: "new" } | { action: "skip" };

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
  if (existing.gender == null && d.gender) out.push("מגדר (הצעה, מהתואר)");
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
  if (choice.action === "new" && !m?.allowNew) return null;
  if (choice.action === "merge" && !m?.candidates.some((c) => c.id === choice.target)) return null;
  return choice;
}
