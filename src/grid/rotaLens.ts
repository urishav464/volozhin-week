// «תורנויות» as a lens of the week (8.11, the instructor's: «רק תורנויות, בלי שיעורים»): every shift of the week, the
// duties in it with their groups' codes («בית מדרש: נ1 נ2 · מטבח: א3»), and (v20) all its staff — there is no
// «אחראי/ת משמרת». Pure; src/grid/RotaWeek.tsx draws it. The rota's own order (dutiesInOrder, groupsInOrder) and rules
// (rotaShiftRange, staffOn, staffWho) — and nothing of a phone: it reads load_rota's RotaData alone.
// (Stream B owns the lens's look; the foundation only replaced the leads with the shift's whole staff.)
import type { RotaData, ShiftIndex } from "../data/rota";
import { codeOf, ROTA_DAYS, rotaShiftRange, SHIFTS, staffOn } from "../domain/rota";
import type { Day } from "../domain/time";
import { dutiesInOrder, groupsInOrder, type RotaEdition, staffWho } from "../exports/rota";

export interface LensGroup {
  id: number;
  code: string;
  /** Put there by «הצעה הוגנת» and not touched since. */
  suggested: boolean;
}

export interface LensDuty {
  id: number;
  name: string;
  groups: LensGroup[];
}

export interface LensShift {
  day: Day;
  shift: ShiftIndex;
  /** The shift as the week has it that day (Sunday from the opening, Thursday to the close); null: not part of the week. */
  range: { start: number; end: number } | null;
  /** The duties with a group in this shift, in the duties' order — a duty with none is left out. */
  duties: LensDuty[];
  /** v20: the staff whose hours overlap the shift (staffOn), by name or cohort's staff, in their order. */
  staff: string[];
}

/** The week's shifts, [day][shift]: five days of three. */
export function rotaLens(edition: RotaEdition, data: RotaData): LensShift[][] {
  const place = new Map(groupsInOrder(data).map((g, i) => [g.id, i]));
  const groupById = new Map(data.groups.map((g) => [g.id, g]));
  const duties = dutiesInOrder(data);
  return ROTA_DAYS.map((day) =>
    SHIFTS.map((shift): LensShift => {
      const here = data.assignments.filter((a) => a.day === day && a.shift === shift && groupById.has(a.group_id));
      return {
        day,
        shift,
        range: rotaShiftRange(edition, day, shift),
        duties: duties
          .map((d) => ({
            id: d.id,
            name: d.name,
            groups: here
              .filter((a) => a.duty_id === d.id)
              .sort((a, b) => (place.get(a.group_id) ?? Infinity) - (place.get(b.group_id) ?? Infinity) || a.id - b.id)
              .map((a) => ({ id: a.group_id, code: codeOf(data, groupById.get(a.group_id)!), suggested: a.source === "suggested" })),
          }))
          .filter((d) => d.groups.length > 0),
        staff: staffOn(edition, [...data.staff].sort((a, b) => a.start_min - b.start_min || a.id - b.id), day, shift).map((s) => staffWho(data, s)),
      };
    }),
  );
}

/** One shift said in words — the cell's accessible name: «בית מדרש: א6 ב1 · מטבח: ב6 · צוות: …». */
export function lensShiftText(s: Pick<LensShift, "duties" | "staff">): string {
  const duties = s.duties.map((d) => `${d.name}: ${d.groups.map((g) => g.code).join(" ")}`).join(" · ") || "אין שיבוצים";
  return s.staff.length ? `${duties} · צוות: ${s.staff.join(", ")}` : duties;
}
