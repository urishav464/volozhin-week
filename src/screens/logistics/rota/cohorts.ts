// What «קבוצות ומכינות» says and computes before it writes (v20; pure, unit-tested in cohorts.test.ts): a cohort's line
// — its trainees, its three diet numbers, the duties it helps in —, what deleting a cohort's groups takes with it (a
// re-split, or a cohort left helping in no duty), the split's preview («הצעה»), which cohorts help in a duty, and which
// cohorts a new duty is added to. Every count is the loaded rota's own; nothing here writes.
import type { RotaCohort, RotaData } from "../../../data/rota";
import { checkCohortCounts, type CohortCounts, ROTA_LIMITS } from "../../../data/rota";
import { CommandError } from "../../../data/commands";
import { cohortDutyIds, cohortHelps, dietSplit, groupCode } from "../../../domain/rota";
import { cohortsInOrder, dutiesInOrder } from "../../../exports/rota";

const n = (v: number | null) => (v == null ? "TBD" : String(v));

/** «48 חניכים · צמחוני/טבעוני 5 · ללא גלוטן 2 · מהם גם וגם 1» — TBD where not typed, «תזונה: TBD» when none of the three is. */
export function cohortNumbersText(c: Pick<RotaCohort, "trainees" | "diet_veg" | "diet_gf" | "diet_both">): string {
  const trainees = c.trainees == null ? "חניכים: TBD" : c.trainees === 1 ? "חניך/ה אחד/ת" : `${c.trainees} חניכים`;
  const diets = c.diet_veg == null && c.diet_gf == null && c.diet_both == null ? "תזונה: TBD" : `צמחוני/טבעוני ${n(c.diet_veg)} · ללא גלוטן ${n(c.diet_gf)} · מהם גם וגם ${n(c.diet_both)}`;
  return `${trainees} · ${diets}`;
}

/** The duties the cohort helps in, by name in the duties' order; [] — it helps in none («לא עוזרת בתורנויות»). */
export function cohortDutyNames(data: Pick<RotaData, "duties" | "cohortDuties">, cohortId: number): string[] {
  const mine = new Set(cohortDutyIds(data, cohortId));
  return dutiesInOrder(data)
    .filter((d) => mine.has(d.id))
    .map((d) => d.name);
}

/** The cohorts that help in a duty, by letter in the cohorts' order. */
export function dutyHelpers(data: Pick<RotaData, "cohorts" | "cohortDuties">, dutyId: number): RotaCohort[] {
  const on = new Set(data.cohortDuties.filter((x) => x.duty_id === dutyId).map((x) => x.cohort_id));
  return cohortsInOrder(data).filter((c) => on.has(c.id));
}

/**
 * The cohorts a new duty is added to when «כל המכינות העוזרות עוזרות בה» is ticked: those that help in some duty — and,
 * while the edition has no duty yet, every cohort (none could choose one: helping in nothing was not chosen).
 */
export function newDutyTargets(data: Pick<RotaData, "cohorts" | "cohortDuties" | "duties">): RotaCohort[] {
  const cohorts = cohortsInOrder(data);
  return data.duties.length === 0 ? cohorts : cohorts.filter((c) => cohortHelps(data, c.id));
}

/** «א1–א5» for numbers in a row from 1, else «א1, א3, א4». */
export function codesText(letter: string, numbers: readonly number[]): string {
  const s = [...numbers].sort((a, b) => a - b);
  if (s.length > 2 && s.every((x, i) => x === s[0] + i)) return `${groupCode(letter, s[0])}–${groupCode(letter, s[s.length - 1])}`;
  return s.map((x) => groupCode(letter, x)).join(", ");
}

/**
 * What deleting all of a cohort's groups takes with it (a re-split, or the last duty unticked): the groups by code, their
 * assignments, their heads' names and phones; their Saturday-night tasks stay, without a group. One sentence, no
 * full stop; «» when it has none.
 */
export function groupsLossText(data: Pick<RotaData, "cohorts" | "groups" | "assignments" | "prep">, cohortId: number): string {
  const c = data.cohorts.find((x) => x.id === cohortId);
  const mine = data.groups.filter((g) => g.cohort_id === cohortId);
  if (!c || mine.length === 0) return "";
  const ids = new Set(mine.map((g) => g.id));
  const a = data.assignments.filter((x) => ids.has(x.group_id)).length;
  const p = data.prep.filter((t) => t.group_id != null && ids.has(t.group_id)).length;
  const codes = codesText(c.letter, mine.map((g) => g.number));
  const one = mine.length === 1;
  const groups = one ? `הקבוצה שלה (${codes}) תימחק` : `${mine.length} הקבוצות שלה (${codes}) יימחקו`;
  const assigned = a === 0 ? "" : a === 1 ? (one ? "השיבוץ שלה" : "השיבוץ שלהן") : one ? `${a} השיבוצים שלה` : `${a} השיבוצים שלהן`;
  const heads = one ? "השם והטלפון של ראש/ת הקבוצה" : "השמות והטלפונים של ראשי הקבוצות";
  const tasks = p === 0 ? "" : p === 1 ? "; משימת מוצ״ש אחת שלהן תישאר בלי קבוצה" : `; ${p} משימות מוצ״ש שלהן יישארו בלי קבוצה`;
  return `${groups}, ${one ? "ואיתה" : "ואיתן"} ${assigned ? `${assigned}, ` : ""}${heads}${tasks}`;
}

/** «3 קבוצות: א1 — 8, א2 — 8, א3 — 7» — the split's preview (a «הצעה»); «» for none. */
export function splitPreviewText(letter: string, sizes: readonly number[]): string {
  if (sizes.length === 0) return "";
  const list = sizes.map((s, i) => `${groupCode(letter, i + 1)} — ${s}`).join(", ");
  return `${sizes.length === 1 ? "קבוצה אחת" : `${sizes.length} קבוצות`}: ${list}`;
}

/** Why sizes cannot be split into (rota_split_cohort's bad_value, said before anything is sent); null — they can. */
export function splitProblem(sizes: readonly number[]): string | null {
  if (sizes.length === 0) return "כמה חניכים בקבוצה — מספר שלם מ-1 ומעלה.";
  if (sizes.length > ROTA_LIMITS.groupNumber) return `יותר מ-${ROTA_LIMITS.groupNumber} קבוצות: מגדילים את הקבוצה.`;
  if (sizes.some((s) => s > ROTA_LIMITS.groupSize)) return `קבוצה של יותר מ-${ROTA_LIMITS.groupSize}: מקטינים את הקבוצה.`;
  return null;
}

/** «כל הגדלים יחד: 40 מתוך 48 החניכים» — the groups' sizes against the cohort's trainees, when both are known and differ; null otherwise. */
export function sizesAgainstTrainees(c: Pick<RotaCohort, "trainees">, sizes: readonly (number | null)[]): string | null {
  if (c.trainees == null || sizes.length === 0 || sizes.some((s) => s == null)) return null;
  const sum = (sizes as number[]).reduce((a, b) => a + b, 0);
  return sum === c.trainees ? null : `בקבוצות ${sum} מתוך ${c.trainees} החניכים`;
}

/**
 * The form's live line under the four numbers: what the meals are, once all four are known and agree
 * («כלומר: צמחוני/טבעוני בלבד 3 · ללא גלוטן בלבד 1 · גם וגם 1 · רגיל 25»); null while one is TBD or they do not agree
 * (the save says why, in the guard's words).
 */
export function dietSplitText(c: CohortCounts): string | null {
  if (c.trainees == null || c.diet_veg == null || c.diet_gf == null || c.diet_both == null) return null;
  if ([c.trainees, c.diet_veg, c.diet_gf, c.diet_both].some((x) => !Number.isInteger(x) || x < 0 || x > ROTA_LIMITS.count)) return null;
  try {
    checkCohortCounts(c);
  } catch (e) {
    if (e instanceof CommandError) return null;
    throw e;
  }
  const d = dietSplit(c);
  return `כלומר: צמחוני/טבעוני בלבד ${d.veg_only} · ללא גלוטן בלבד ${d.gf_only} · גם וגם ${d.both} · רגיל ${d.regular}`;
}

/** Two sets of duty ids are the same set (the form saves the duties only when they changed). */
export function sameIds(a: readonly number[], b: readonly number[]): boolean {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
}

/** v20: the duties' order is their place in the list (`sort`, moved by «למעלה» / «למטה») — the board's and the pages' order, and the suggestion's. */
export const DUTY_ORDER_HINT = "הסדר כאן הוא הסדר בלוח ובדפים. כשאין מספיק קבוצות, התורנות שלמעלה מתמלאת קודם.";
