// «תורנויות»: what the board warns about (the plan's «rotaWarnings»), each with its SeverityMark («warn» / «info»).
// Pure: the loaded rota (or the rota with a suggestion added) and the edition's week. A warning names the groups by
// their codes and the duties by their names, a shift as «יום X · משמרת Y»; it carries the cell it is about (day,
// shift, duty) and the groups, so the board can mark them. Nothing is deleted or changed here — an assignment on a
// shift the week no longer has stays, warned about, until someone moves it. A cohort that helps in no duty (v20
// `cohortHelps`) still has its presence asked for — it feeds the meal counts — but it has no groups; a duty given by
// hand to a group whose cohort does not help in it is the `not_eligible` warning (v20, in place of v19's
// `not_helping`). v20 has no «אחראי/ת משמרת» (no `no_lead`), and the diets cannot exceed the trainees (the guard holds
// it: no `diets_exceed`).
import type { RotaAssignment, RotaData, RotaGroup, ShiftIndex } from "../data/rota";
import { byCohortOrder, cohortHelps, groupCode, groupHelpsIn, helpingGroups, loadsOf, needOf, presenceMarked, presentAt, rotaShiftActive, rotaShiftsOf, rotaSlots, SHIFTS, slotIndex } from "./rota";
import { overNeed, ROTA_LOAD_TOLERANCE } from "./rotaSuggest";
import { type Day, DAY_NAMES } from "./time";
import type { Edition } from "./types";

export type RotaWarningKind =
  | "absent"
  | "presence_unknown"
  | "under"
  | "over"
  | "short_people"
  | "size_unknown"
  | "back_to_back"
  | "outside_week"
  | "uneven"
  | "no_target"
  | "no_head"
  | "not_eligible";

export interface RotaWarning {
  key: string;
  kind: RotaWarningKind;
  severity: "warn" | "info";
  day?: Day;
  shift?: ShiftIndex;
  groupIds: number[];
  dutyId?: number;
  message: string;
}

export type RotaWarningData = Pick<RotaData, "cohorts" | "cohortDuties" | "presence" | "groups" | "duties" | "assignments">;
type WeekEdges = Pick<Edition, "first_day_from" | "last_day_until" | "settings">;

/** Every warning of the rota. */
export function rotaWarnings(data: RotaWarningData, edition: WeekEdges): RotaWarning[] {
  const out: RotaWarning[] = [];
  const labels = rotaShiftsOf(edition).labels;
  const when = (day: number, shift: number) => `יום ${DAY_NAMES[day as Day]} · משמרת ${labels[shift]}`;
  const cohorts = [...data.cohorts].sort(byCohortOrder);
  const cohortOf = new Map(cohorts.map((c) => [c.id, c]));
  const rank = new Map(cohorts.map((c, i) => [c.id, i]));
  const groups = [...data.groups].sort((a, b) => (rank.get(a.cohort_id) ?? 1e9) - (rank.get(b.cohort_id) ?? 1e9) || a.number - b.number || a.id - b.id);
  const groupOf = new Map(groups.map((g) => [g.id, g]));
  const code = (g: RotaGroup | undefined) => (g ? groupCode(cohortOf.get(g.cohort_id)?.letter ?? "?", g.number) : "?");
  const codeById = (id: number) => code(groupOf.get(id));
  const codes = (ids: number[]) => ids.map(codeById).join(", ");
  const duties = [...data.duties].sort((a, b) => a.sort - b.sort || a.id - b.id);
  const dutyOf = new Map(duties.map((d) => [d.id, d]));
  const dutyName = (id: number) => dutyOf.get(id)?.name ?? "?";
  const dutyRank = new Map(duties.map((d, i) => [d.id, i]));
  const assignments = [...data.assignments].sort(
    (a, b) => a.day - b.day || a.shift - b.shift || (dutyRank.get(a.duty_id) ?? -1) - (dutyRank.get(b.duty_id) ?? -1) || a.group_id - b.group_id || a.id - b.id,
  );
  const slots = rotaSlots(edition);

  // ---- the cohorts and the groups
  for (const c of cohorts) {
    const mine = groups.filter((g) => g.cohort_id === c.id).map((g) => g.id);
    if (!presenceMarked(data, c.id)) {
      // a cohort that helps in no duty has no groups to place — only its presence (the meals) is missing
      const message = cohortHelps(data, c.id) ? `לא סומן מתי ${c.name} בקמפוס — ההצעה לא משבצת את הקבוצות שלה` : `לא סומן מתי ${c.name} בקמפוס`;
      out.push({ key: `presence_unknown:${c.id}`, kind: "presence_unknown", severity: "warn", groupIds: mine, message });
    }
  }
  const headless = groups.filter((g) => g.head_name == null).map((g) => g.id);
  if (headless.length > 0) {
    out.push({ key: "no_head", kind: "no_head", severity: "info", groupIds: headless, message: `${headless.length === 1 ? "אין ראש/ת קבוצה ל-" : "אין ראשי קבוצות ל-"}${codes(headless)}` });
  }

  // ---- the duties' needs
  const weekShifts = SHIFTS.filter((s) => slots.some((x) => x.shift === s));
  for (const d of duties) {
    const unset = weekShifts.filter((s) => needOf(d, s) == null);
    if (unset.length > 0) {
      out.push({
        key: `no_target:${d.id}`, kind: "no_target", severity: "info", groupIds: [], dutyId: d.id,
        ...(unset.length === 1 ? { shift: unset[0] } : {}),
        message: `לא נקבע כמה קבוצות צריך ב«${d.name}»: ${unset.map((s) => `משמרת ${labels[s]}`).join(", ")}`,
      });
    }
  }

  // ---- each shift: the week's, the cohorts on campus, the needs, the people
  for (const a of assignments) {
    const g = groupOf.get(a.group_id);
    const c = g ? cohortOf.get(g.cohort_id) : undefined;
    // v20: a hand-made row on a duty its cohort does not help in (the suggestion never makes one)
    if (g && c && dutyOf.has(a.duty_id) && !groupHelpsIn(data, g, a.duty_id)) {
      out.push({
        key: `not_eligible:${a.id}`, kind: "not_eligible", severity: "warn", day: a.day, shift: a.shift, groupIds: [a.group_id], dutyId: a.duty_id,
        message: `${codeById(a.group_id)} שובצה ב«${dutyName(a.duty_id)}» (${when(a.day, a.shift)}), אבל ${c.name} לא עוזרת ב«${dutyName(a.duty_id)}»`,
      });
    }
    if (!rotaShiftActive(edition, a.day, a.shift)) {
      out.push({
        key: `outside_week:${a.id}`, kind: "outside_week", severity: "warn", day: a.day, shift: a.shift, groupIds: [a.group_id], dutyId: a.duty_id,
        message: `${codeById(a.group_id)} ב«${dutyName(a.duty_id)}» ב${when(a.day, a.shift)} — המשמרת הזו כבר לא חלק מהשבוע`,
      });
    } else if (g && !presentAt(data, g.cohort_id, a.day, a.shift)) {
      out.push({
        key: `absent:${a.id}`, kind: "absent", severity: "warn", day: a.day, shift: a.shift, groupIds: [a.group_id], dutyId: a.duty_id,
        message: `${codeById(a.group_id)} שובצה ל«${dutyName(a.duty_id)}» ב${when(a.day, a.shift)}, ו${cohortOf.get(g.cohort_id)?.name ?? "המכינה"} לא סומנה בקמפוס במשמרת הזו`,
      });
    }
  }
  for (const s of slots) {
    for (const d of duties) {
      const on = assignments.filter((a) => a.day === s.day && a.shift === s.shift && a.duty_id === d.id).map((a) => a.group_id);
      const need = needOf(d, s.shift);
      const base = { day: s.day, shift: s.shift, dutyId: d.id };
      const k = `${s.day}:${s.shift}:${d.id}`;
      if (need != null && on.length < need) {
        const missing = need - on.length;
        out.push({ ...base, key: `under:${k}`, kind: "under", severity: "warn", groupIds: on, message: `${missing === 1 ? "חסרה קבוצה אחת" : `חסרות ${missing} קבוצות`} ב«${d.name}» (${when(s.day, s.shift)})` });
      }
      // «too many» is one rule with the suggestion's (overNeed): the groups a minimum of people needs are not too many
      if (overNeed(need, d.min_people, on.map((id) => groupOf.get(id)?.size ?? null))) {
        out.push({ ...base, key: `over:${k}`, kind: "over", severity: "warn", groupIds: on, message: `${on.length} קבוצות ב«${d.name}» (${when(s.day, s.shift)}), וצריך ${need}` });
      }
      // a shift that needs no group (0) is not asked for more people: «over» already says it
      if (d.min_people != null && on.length > 0 && need !== 0) {
        const known = on.reduce((sum, id) => sum + (groupOf.get(id)?.size ?? 0), 0);
        const unknown = on.filter((id) => groupOf.get(id)?.size == null);
        if (known < d.min_people) {
          if (unknown.length > 0) {
            out.push({ ...base, key: `size_unknown:${k}`, kind: "size_unknown", severity: "info", groupIds: unknown, message: `לא ידוע אם יש מספיק אנשים ב«${d.name}» (${when(s.day, s.shift)}): חסר הגודל של ${codes(unknown)}` });
          } else {
            out.push({ ...base, key: `short_people:${k}`, kind: "short_people", severity: "warn", groupIds: on, message: `ב«${d.name}» (${when(s.day, s.shift)}) ${known} אנשים, והמינימום ${d.min_people}` });
          }
        }
      }
    }
  }

  // ---- each group: two shifts in a row; and the load across the groups
  for (const g of groups) {
    const mine = assignments.filter((a) => a.group_id === g.id).sort((a, b) => slotIndex(a.day, a.shift) - slotIndex(b.day, b.shift));
    for (let i = 1; i < mine.length; i++) {
      const [p, q] = [mine[i - 1], mine[i]];
      if (slotIndex(q.day, q.shift) - slotIndex(p.day, p.shift) !== 1) continue;
      out.push({
        key: `back_to_back:${g.id}:${slotIndex(q.day, q.shift)}`, kind: "back_to_back", severity: "warn", day: q.day, shift: q.shift, groupIds: [g.id],
        message: `${code(g)} בשתי משמרות ברצף: ${when(p.day, p.shift)}, ואז ${when(q.day, q.shift)}`,
      });
    }
  }
  const uneven = unevenLoad(data, edition);
  if (uneven) {
    const [hi, lo] = uneven;
    out.push({
      key: "uneven", kind: "uneven", severity: "info", groupIds: [hi.id, lo.id],
      message: `העומס לא שווה: ${code(groupOf.get(hi.id))} ב-${hi.shifts} משמרות מתוך ${hi.present} בקמפוס, ${code(groupOf.get(lo.id))} ב-${lo.shifts} מתוך ${lo.present}`,
    });
  }
  return out;
}

/**
 * The most and the least loaded groups when they are further apart than ROTA_LOAD_TOLERANCE shifts from their shares
 * (each share in proportion to the shifts its cohort is on campus, compared exactly); null when even. Only the groups
 * of a cohort that helps in some duty are weighed (v20: such a cohort has no groups).
 */
export function unevenLoad(data: RotaWarningData, edition: WeekEdges): [{ id: number; shifts: number; present: number }, { id: number; shifts: number; present: number }] | null {
  const loads = [...loadsOf({ groups: helpingGroups(data), presence: data.presence }, data.assignments, edition)].map(([id, l]) => ({ id, shifts: l.shifts, present: l.present })).filter((l) => l.present > 0);
  const P = loads.reduce((s, l) => s + l.present, 0);
  const T = loads.reduce((s, l) => s + l.shifts, 0);
  if (T === 0 || loads.length < 2) return null;
  const dev = (l: { shifts: number; present: number }) => l.shifts * P - l.present * T;
  const sorted = [...loads].sort((a, b) => dev(b) - dev(a) || a.id - b.id);
  const [hi, lo] = [sorted[0], sorted[sorted.length - 1]];
  return dev(hi) - dev(lo) > ROTA_LOAD_TOLERANCE * P ? [hi, lo] : null;
}

/** The warnings of one cell of the board (a duty in a shift). */
export function cellWarnings(warnings: readonly RotaWarning[], day: number, shift: number, dutyId: number): RotaWarning[] {
  return warnings.filter((w) => w.day === day && w.shift === shift && w.dutyId === dutyId);
}

/** For a group's mark on the board: the warnings that name it in that shift. */
export function groupWarnings(warnings: readonly RotaWarning[], a: Pick<RotaAssignment, "day" | "shift" | "group_id">): RotaWarning[] {
  return warnings.filter((w) => w.day === a.day && w.shift === a.shift && w.groupIds.includes(a.group_id));
}
