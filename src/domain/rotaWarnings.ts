// «תורנויות»: what the board warns about (the plan's «rotaWarnings»), each with its SeverityMark («warn» / «info»).
// Pure: the loaded rota (or the rota with a suggestion added) and the edition's week. A warning names the groups by
// their codes and the duties by their names, a shift as «יום X · משמרת Y»; it carries the cell it is about (day,
// shift, duty) and the groups, so the board can mark them. Nothing is deleted or changed here — an assignment on a
// shift the week no longer has stays, warned about, until someone moves it.
import type { RotaAssignment, RotaCohort, RotaData, RotaDuty, RotaGroup, RotaStaffShift, ShiftIndex } from "../data/rota";
import { groupCode, loadsOf, needOf, presentAt, rotaShiftActive, rotaShiftRange, rotaShiftsOf, rotaSlots, SHIFTS, slotIndex } from "./rota";
import { ROTA_LOAD_TOLERANCE, ROTA_MAX_EXTRA } from "./rotaSuggest";
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
  | "no_lead"
  | "no_head"
  | "diets_exceed";

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

export type RotaWarningData = Pick<RotaData, "cohorts" | "presence" | "groups" | "duties" | "assignments"> & Partial<Pick<RotaData, "staff">>;
type WeekEdges = Pick<Edition, "first_day_from" | "last_day_until" | "settings">;

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every warning of the rota. `staff` (default: the data's) is what «אחראי/ת משמרת» is looked for in: without it, the
 * shifts' leads are not checked.
 */
export function rotaWarnings(data: RotaWarningData, edition: WeekEdges, staff: readonly RotaStaffShift[] | undefined = data.staff): RotaWarning[] {
  const out: RotaWarning[] = [];
  const labels = rotaShiftsOf(edition).labels;
  const when = (day: number, shift: number) => `יום ${DAY_NAMES[day as Day]} · משמרת ${labels[shift]}`;
  const cohorts = [...data.cohorts].sort((a: RotaCohort, b: RotaCohort) => a.sort - b.sort || cmpStr(a.letter, b.letter) || a.id - b.id);
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
    if (!data.presence.some((p) => p.cohort_id === c.id)) {
      out.push({ key: `presence_unknown:${c.id}`, kind: "presence_unknown", severity: "warn", groupIds: mine, message: `לא סומן מתי ${c.name} בקמפוס — ההצעה לא משבצת את הקבוצות שלה` });
    }
    const diets = c.diets.reduce((s, d) => s + d.count, 0);
    const sized = groups.filter((g) => g.cohort_id === c.id);
    if (diets > 0 && sized.length > 0 && sized.every((g) => g.size != null)) {
      const total = sized.reduce((s, g) => s + (g.size ?? 0), 0);
      if (diets > total) {
        out.push({ key: `diets_exceed:${c.id}`, kind: "diets_exceed", severity: "warn", groupIds: mine, message: `ב${c.name} ${diets} בדיאטות, יותר מ-${total} האנשים בקבוצות שלה` });
      }
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
      if (need != null && on.length > need && !extrasJustified(d, need, on, groupOf)) {
        out.push({ ...base, key: `over:${k}`, kind: "over", severity: "warn", groupIds: on, message: `${on.length} קבוצות ב«${d.name}» (${when(s.day, s.shift)}), וצריך ${need}` });
      }
      if (d.min_people != null && on.length > 0) {
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
    if (staff) {
      const range = rotaShiftRange(edition, s.day, s.shift)!;
      const lead = staff.some((x) => x.kind === "lead" && x.day === s.day && x.start_min < range.end && x.end_min > range.start);
      if (!lead) out.push({ key: `no_lead:${s.day}:${s.shift}`, kind: "no_lead", severity: "warn", day: s.day, shift: s.shift, groupIds: [], message: `אין אחראי/ת משמרת ב${when(s.day, s.shift)}` });
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

/** More groups than the need, to reach the minimum of people (as the suggestion adds them): not «too many». */
function extrasJustified(d: RotaDuty, need: number, on: number[], groupOf: Map<number, RotaGroup>): boolean {
  if (d.min_people == null || on.length > need + ROTA_MAX_EXTRA) return false;
  const sizes = on.map((id) => groupOf.get(id)?.size ?? null);
  if (sizes.some((x) => x == null)) return true; // unknown: the minimum may need them
  const people = (sizes as number[]).reduce((a, b) => a + b, 0);
  return people - Math.min(...(sizes as number[])) < d.min_people;
}

/**
 * The most and the least loaded groups when they are further apart than ROTA_LOAD_TOLERANCE shifts from their shares
 * (each share in proportion to the shifts its cohort is on campus, compared exactly); null when even.
 */
function unevenLoad(data: RotaWarningData, edition: WeekEdges): [{ id: number; shifts: number; present: number }, { id: number; shifts: number; present: number }] | null {
  const loads = [...loadsOf(data, data.assignments, edition)].map(([id, l]) => ({ id, shifts: l.shifts, present: l.present })).filter((l) => l.present > 0);
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
