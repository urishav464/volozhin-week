// «תורנויות» (milestone 7, schema v16) — every page the duty roster prints and downloads (the plan's «הדפים»), each a
// pure builder of a Table (src/exports/table.ts) from the loaded rota (port.rota.load — never a phone) and the
// edition: the screen (/print/rota, src/screens/outputs/RotaScreen.tsx), the printed A4 and the xlsx/CSV are this one
// list. The heads' phones come in only as `phones` (port.rota.contacts, behind «כולל טלפונים של ראשי הקבוצות»):
// null — no phone column, no phone text, anywhere. The formula guard is the writers' (toCsv / toXlsx put every cell,
// headers included, through guardCell), as for every other export.
//
//   groupSchedule   a group's own week: the grid's active rows (rowActive) with the closed lessons, «זמן זיכרון»,
//                   the meals and מכריכה לכריכה by their labels, and per shift a band naming the group's duty. Its
//                   input has NO Week and NO phone — the public schedule (scheduleEntries), the rows, the edition,
//                   one group, the duties and that group's assignments — so a trainees' page could be fed the same
//                   (DECISIONS «תורנויות — גרסה 16»: a /g link would be anon's seventh function, and waits).
//   rotaBoardTable  the board: shift × duty, a column a day, the groups' codes in each cell
//   daySheet        one day: per shift its staff and each duty's groups, the heads (and their phones if given)
//   kitchenSheet    one duty (the caller's pick; «מטבח» by default, kitchenDutyId) in every shift: who, how many,
//                   the trainees on campus, their diets, the meals of the shift
//   headsTable · staffTable · prepTable (the tasks) · shoppingTable (v19: the shopping list, its quantities) ·
//   mealsTable      v20 «כמויות אוכל»: a row per day × meal (the grid's fixed rows whose label is a meal's, as the
//                   kitchen sheet finds them), the cohorts on campus in the shift the meal starts in, their trainees
//                   and the four diet columns — mealCounts is its model (the cohorts page draws the same rows)
//   foodTable (per cohort, «חניכים בלבד»: its trainees and its meals by diet) · campusTable · loadsTable
//   rotaWorkbook    all of them, a sheet each, for «הורדת xlsx (כל הגיליונות)» (v20: the staff's schedule is
//                   src/exports/staffSchedule.ts's — the day × grid rows sheet, never a transport)
//
// Nothing here fills in a number nobody entered: a cohort whose trainees are TBD is TBD, and so is every sum it is part
// of. v20: a cohort's trainees are its own field (never the groups' sizes), its diets three numbers (dietSplit:
// «צמחוני/טבעוני» only, «ללא גלוטן» only, both, the regular rest); a staff shift has no kind.
import { isHeadContact, type PrepKind, prepKindOf, type RotaAssignment, type RotaCohort, type RotaContactRow, type RotaData, type RotaDuty, type RotaGroup, type RotaPrepTask, type RotaStaffShift, type ShiftIndex } from "../data/rota";
import { nameKey } from "../domain/nameKey";
import { type DietSplit, dietSplit, groupCode, loadsOf, presenceMarked, presentAt, ROTA_DAYS, rotaShiftActive, rotaShiftRange, rotaShiftsOf, rotaSlots, SHIFTS, shiftBounds, staffOn, type RotaSlot } from "../domain/rota";
import { DAY_NAMES, type Day, dateOf, fmtRange, LRM, nightLabel, overlaps, shortDate } from "../domain/time";
import type { Edition, GridRow, Week } from "../domain/types";
import { rowActive } from "../grid/layout";
import { type ScheduleEntry, scheduleEntries } from "./designer";
import { staffScheduleTable } from "./staffSchedule";
import type { Table } from "./table";
import { phoneCell } from "./tracking";

/** What the builders read of the edition. */
export type RotaEdition = Pick<Edition, "first_day_from" | "last_day_until" | "settings">;

/** The heads' phones the caller was given (port.rota.contacts), by group id; null: «כולל טלפונים» is off. */
export type HeadPhones = ReadonlyMap<number, string> | null;

export function phonesOf(contacts: readonly RotaContactRow[]): Map<number, string> {
  return new Map(contacts.filter(isHeadContact).map((c) => [c.group_id, c.head_phone]));
}

/** A band's fill in the xlsx: the brand's sage, soft (index.css --color-sage-soft). */
export const BAND_FILL = "E5EBD8";

/** «מוצ״ש» and «לו״ז» in a sheet's name: gershayim (U+05F4), never an ASCII quote. */
export const SHEET = {
  board: "לוח התורנויות",
  group: (code: string) => `לו״ז ${code}`,
  day: (d: Day) => `יום ${DAY_NAMES[d]}`,
  kitchen: "מטבח",
  heads: "ראשי קבוצות",
  staff: "משמרות צוות",
  prep: "מוצ״ש",
  shopping: "קניות מוצ״ש",
  food: "אוכל",
  foodCohorts: "תזונה לפי מכינה",
  campus: "מי בקמפוס",
  loads: "עומס",
} as const;

/** v20: a staff row's word on a day sheet (there is no «אחראי/ת משמרת»: every staff shift is the team's). */
export const STAFF_LABEL = "צוות";

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ------------------------------------------------------------------ the order everything is listed in

/** The cohorts as load_rota orders them (sort, letter by code point, id) — whatever order they came in. */
export function cohortsInOrder(data: Pick<RotaData, "cohorts">): RotaCohort[] {
  return [...data.cohorts].sort((a, b) => a.sort - b.sort || cmp(a.letter, b.letter) || a.id - b.id);
}

/** The groups by their cohort's place, then number: א1 … א6, ב1 …, נ5. */
export function groupsInOrder(data: Pick<RotaData, "cohorts" | "groups">): RotaGroup[] {
  const at = new Map(cohortsInOrder(data).map((c, i) => [c.id, i]));
  return [...data.groups].sort((a, b) => (at.get(a.cohort_id) ?? Infinity) - (at.get(b.cohort_id) ?? Infinity) || a.number - b.number || a.id - b.id);
}

export function dutiesInOrder(data: Pick<RotaData, "duties">): RotaDuty[] {
  return [...data.duties].sort((a, b) => a.sort - b.sort || a.id - b.id);
}

export function staffInOrder(data: Pick<RotaData, "staff">): RotaStaffShift[] {
  return [...data.staff].sort((a, b) => a.day - b.day || a.start_min - b.start_min || a.id - b.id);
}

/** A group's code by id (TBD's «?» when its cohort is gone — never happens: a cohort with groups is not deleted). */
function codes(data: Pick<RotaData, "cohorts" | "groups">): Map<number, string> {
  const letter = new Map(data.cohorts.map((c) => [c.id, c.letter]));
  return new Map(data.groups.map((g) => [g.id, letter.has(g.cohort_id) ? groupCode(letter.get(g.cohort_id)!, g.number) : `?${g.number}`]));
}

// ------------------------------------------------------------------ shifts

/** The shift a minute of the day falls in, by the edition's cuts: [390, a) · [a, b) · [b, 1830). */
export function shiftAt(edition: RotaEdition, min: number): ShiftIndex {
  const [a, b] = rotaShiftsOf(edition).cuts;
  return min < a ? 0 : min < b ? 1 : 2;
}

/**
 * The shift something that starts at `min` on `day` belongs to: the one its start falls in — on Sunday counted from
 * the opening (a row that begins before it and ends after it belongs to the first shift the week has).
 */
export function shiftOfStart(edition: RotaEdition, day: Day, min: number): ShiftIndex {
  return shiftAt(edition, day === 0 && edition.first_day_from != null ? Math.max(min, edition.first_day_from) : min);
}

/** «בוקר ‎06:30–14:30» — the shift as the week has it that day (Sunday from the opening, Thursday to the close); the base block when no day is given. */
export function shiftText(edition: RotaEdition, shift: ShiftIndex, day?: Day): string {
  const label = rotaShiftsOf(edition).labels[shift];
  if (day == null) {
    const b = shiftBounds(rotaShiftsOf(edition), shift);
    return `${label} ${LRM}${fmtRange(b.from, b.to)}`;
  }
  const r = rotaShiftRange(edition, day, shift);
  return r ? `${label} ${LRM}${fmtRange(r.start, r.end)}` : `${label} (מחוץ לשבוע)`;
}

/** The shifts a day lists: those the week has, and one it has not only when something is still assigned there (warned about on screen). */
function shiftsOfDay(edition: RotaEdition, day: Day, assignments: readonly Pick<RotaAssignment, "day" | "shift">[]): ShiftIndex[] {
  return SHIFTS.filter((s) => rotaShiftActive(edition, day, s) || assignments.some((a) => a.day === day && a.shift === s));
}

/** Every slot to list: the week's, and any other one that still has an assignment — in time order. */
function slotsToList(edition: RotaEdition, assignments: readonly Pick<RotaAssignment, "day" | "shift">[]): RotaSlot[] {
  return ROTA_DAYS.flatMap((day) => shiftsOfDay(edition, day, assignments).map((shift) => ({ day, shift })));
}

// ------------------------------------------------------------------ sizes and sums

/** Σ of known numbers, or null (TBD) when any is unknown. */
function sumOrTbd(xs: readonly (number | null)[]): number | null {
  let s = 0;
  for (const x of xs) {
    if (x == null) return null;
    s += x;
  }
  return s;
}

const num = (n: number | null): string => (n == null ? "TBD" : String(n));

/** v20: a cohort's trainees — its own field («חניכים»), never the groups' sizes; TBD (null) until it is typed. */
export function cohortTotal(data: Pick<RotaData, "cohorts">, cohortId: number): number | null {
  return data.cohorts.find((c) => c.id === cohortId)?.trainees ?? null;
}

/** The trainees on campus in a shift (the cohorts marked present there); TBD when one of them is. */
export function presentTotal(data: Pick<RotaData, "cohorts" | "presence">, day: number, shift: number): number | null {
  return sumOrTbd(data.cohorts.filter((c) => presentAt(data, c.id, day, shift)).map((c) => cohortTotal(data, c.id)));
}

/** v20: the given cohorts' meals by diet, added up (dietSplit of each) — a column TBD while one of them is. */
export function dietsOf(cohorts: readonly Pick<RotaCohort, "trainees" | "diet_veg" | "diet_gf" | "diet_both">[]): DietSplit {
  const parts = cohorts.map(dietSplit);
  const add = (k: keyof DietSplit) => sumOrTbd(parts.map((p) => p[k]));
  return { trainees: add("trainees"), veg_only: add("veg_only"), gf_only: add("gf_only"), both: add("both"), regular: add("regular") };
}

/** v20: the four meal columns' headers, in the food pages' order. */
export const DIET_HEADERS = ["צמחוני/טבעוני בלבד", "ללא גלוטן בלבד", "גם וגם", "רגיל"] as const;

/** v20: a DietSplit's four meal cells (TBD where unknown), DIET_HEADERS' order. */
export function dietCells(d: DietSplit): string[] {
  return [num(d.veg_only), num(d.gf_only), num(d.both), num(d.regular)];
}

const dietsText = (d: DietSplit) => DIET_HEADERS.map((h, i) => `${h} ${dietCells(d)[i]}`).join("; ");

// ------------------------------------------------------------------ לו"ז לכל קבוצה

/** The group as its schedule names it — never a phone. */
export interface GroupInfo {
  code: string;
  cohort: string;
  size: number | null;
  head: string | null;
}

/**
 * Everything a group's schedule is made of — no Week, no phone: what a trainees' page (a future /g link) could be
 * given as it is.
 */
export interface GroupScheduleInput {
  edition: RotaEdition & Pick<Edition, "label" | "start_date">;
  rows: readonly GridRow[];
  /** The public schedule (scheduleEntries): the closed lessons and the memorial slots. */
  entries: readonly ScheduleEntry[];
  /**
   * The whole cells the public lessons take (a merged lesson's every row; times only, no names) — so a row inside one
   * is not a TBD. Absent: the entries' teaching times are all there is.
   */
  spans?: readonly { day: Day; start: number; end: number }[];
  group: GroupInfo;
  duties: readonly Pick<RotaDuty, "id" | "name">[];
  /** That group's assignments (others are ignored if given). */
  assignments: readonly Pick<RotaAssignment, "day" | "shift" | "duty_id">[];
}

export type ScheduleItemKind = "lesson" | "memorial" | "fixed" | "kk" | "open";

export interface ScheduleItem {
  start: number;
  end: number;
  text: string;
  kind: ScheduleItemKind;
}

export interface GroupShift {
  shift: ShiftIndex;
  label: string;
  /** The shift as the week has it that day. */
  start: number;
  end: number;
  /** The group's duty in this shift, by name; null: none. */
  duty: string | null;
  items: ScheduleItem[];
}

export interface GroupDay {
  day: Day;
  label: string;
  /** «15.2», or null while the week's date is TBD. */
  date: string | null;
  shifts: GroupShift[];
}

export interface GroupWeek {
  group: GroupInfo;
  editionLabel: string;
  days: GroupDay[];
}

/** «כותרת · מרצה», TBD where the title is not known. */
function lessonText(e: ScheduleEntry): string {
  return [e.title ?? "TBD", e.speaker].filter(Boolean).join(" · ");
}

/** A day's items: the closed lessons (side by side ones in one item), the memorial slots, the fixed and kk rows, and a lesson row nobody closed yet. */
function dayItems(input: GroupScheduleInput, day: Day): ScheduleItem[] {
  const rows = [...input.rows].filter((r) => rowActive(r, day, input.edition)).sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min || a.id - b.id);
  // rowActive's rule on the lesson itself: one left before Sunday's opening or after Thursday's close is not the week's
  const ofDay = input.entries
    .filter((e) => e.day === day && rowActive({ id: 0, kind: "lesson", label: "", start_min: e.start_min, end_min: e.end_min, days: [day] }, day, input.edition))
    .sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min || cmp(a.room, b.room) || cmp(a.title ?? "", b.title ?? "") || cmp(a.speaker, b.speaker));
  const items: ScheduleItem[] = [];
  // the lessons: a cluster of overlapping ones is one item, «במקביל: …», each with its room
  const lessons = ofDay.filter((e) => e.kind === "lesson");
  for (let i = 0; i < lessons.length; ) {
    let end = lessons[i].end_min;
    let j = i + 1;
    while (j < lessons.length && lessons[j].start_min < end) end = Math.max(end, lessons[j++].end_min);
    const group = lessons.slice(i, j);
    items.push({
      start: group[0].start_min,
      end,
      text: group.length === 1 ? lessonText(group[0]) : `במקביל: ${group.map((e) => `${lessonText(e)}${e.room ? ` (${e.room})` : ""}`).join(" / ")}`,
      kind: "lesson",
    });
    i = j;
  }
  // the memorial slots that are there (an empty memorial row is no memorial time)
  const memorial = ofDay.filter((e) => e.kind === "memorial");
  for (let i = 0; i < memorial.length; ) {
    let end = memorial[i].end_min;
    let j = i + 1;
    while (j < memorial.length && memorial[j].start_min < end) end = Math.max(end, memorial[j++].end_min);
    items.push({ start: memorial[i].start_min, end, text: "זמן זיכרון", kind: "memorial" });
    i = j;
  }
  for (const r of rows) {
    if (r.kind === "fixed" || r.kind === "kk") items.push({ start: r.start_min, end: r.end_min, text: r.label || (r.kind === "kk" ? "מכריכה לכריכה" : "TBD"), kind: r.kind });
    else if (r.kind === "lesson") {
      // nothing closed in it yet (and no lesson running into it from an earlier row, nor a merged cell taking it): its label, or TBD
      const used =
        lessons.some((e) => (e.start_min >= r.start_min && e.start_min < r.end_min) || (e.start_min < r.start_min && overlaps(e.start_min, e.end_min, r.start_min, r.end_min))) ||
        (input.spans ?? []).some((x) => x.day === day && overlaps(x.start, x.end, r.start_min, r.end_min));
      if (!used) items.push({ start: r.start_min, end: r.end_min, text: r.label || "TBD", kind: "open" });
    }
  }
  const order: Record<ScheduleItemKind, number> = { fixed: 0, memorial: 1, lesson: 2, open: 3, kk: 4 };
  return items.sort((a, b) => a.start - b.start || a.end - b.end || order[a.kind] - order[b.kind] || cmp(a.text, b.text));
}

/** A group's week, day by day and shift by shift — what GroupSheet draws and groupSchedule writes. */
export function groupWeek(input: GroupScheduleInput): GroupWeek {
  const e = input.edition;
  const labels = rotaShiftsOf(e).labels;
  const dutyName = new Map(input.duties.map((d) => [d.id, d.name]));
  const days = ROTA_DAYS.map((day): GroupDay => {
    const items = dayItems(input, day);
    const date = dateOf(e.start_date, day);
    const shifts = SHIFTS.filter((s) => rotaShiftActive(e, day, s)).map((shift): GroupShift => {
      const r = rotaShiftRange(e, day, shift)!;
      const names = input.assignments
        .filter((a) => a.day === day && a.shift === shift)
        .map((a) => dutyName.get(a.duty_id) ?? "TBD")
        .sort(cmp);
      return { shift, label: labels[shift], start: r.start, end: r.end, duty: names.length ? names.join(" · ") : null, items: items.filter((it) => shiftOfStart(e, day, it.start) === shift) };
    });
    return { day, label: DAY_NAMES[day], date: date ? shortDate(date) : null, shifts };
  });
  return { group: input.group, editionLabel: e.label, days };
}

/** What a group's page says under its code: its cohort, its size, its head (TBD while not known). */
export function groupDetails(g: GroupInfo): string[] {
  return [g.cohort, g.size == null ? "גודל: TBD" : `${g.size} חניכים`, `ראש/ת קבוצה: ${g.head ?? "TBD"}`];
}

/** A group's week as a file writes it: a band row per shift (filled), naming the group's duty or «—», and the shift's items under it. */
export function groupSchedule(input: GroupScheduleInput): Table {
  const w = groupWeek(input);
  const rows: string[][] = [];
  const fills: (string | null)[] = [];
  for (const d of w.days) {
    const dayLabel = d.date ? `${d.label} ${d.date}` : d.label;
    for (const s of d.shifts) {
      rows.push([dayLabel, `${LRM}${fmtRange(s.start, s.end)}`, `משמרת ${s.label}`, s.duty ?? "—"]);
      fills.push(BAND_FILL);
      for (const it of s.items) {
        rows.push([dayLabel, `${LRM}${fmtRange(it.start, it.end)}`, it.text, ""]);
        fills.push(null);
      }
    }
  }
  return { name: SHEET.group(w.group.code), headers: ["יום", "שעה", "מה", `התורנות של ${w.group.code}`], widths: [14, 14, 60, 18], landscape: true, rows, fills };
}

/** Each group's schedule input from the loaded week and rota, in the groups' order. */
export function groupScheduleInputs(week: Week, data: RotaData): { groupId: number; input: GroupScheduleInput }[] {
  const entries = scheduleEntries(week);
  const spans = week.lessons
    .filter((l) => l.state === "closed" && l.kind === "lesson")
    .map((l) => ({ day: l.day, start: l.start_min, end: l.end_min }))
    .sort((a, b) => a.day - b.day || a.start - b.start || a.end - b.end);
  const cohort = new Map(data.cohorts.map((c) => [c.id, c.name]));
  const code = codes(data);
  const duties = dutiesInOrder(data).map(({ id, name }) => ({ id, name }));
  return groupsInOrder(data).map((g) => ({
    groupId: g.id,
    input: {
      edition: week.edition,
      rows: week.rows,
      entries,
      spans,
      group: { code: code.get(g.id)!, cohort: cohort.get(g.cohort_id) ?? "TBD", size: g.size, head: g.head_name },
      duties,
      assignments: data.assignments.filter((a) => a.group_id === g.id).map(({ day, shift, duty_id }) => ({ day, shift, duty_id })),
    },
  }));
}

// ------------------------------------------------------------------ the board

/** The groups on a duty in a shift, as their codes, in the groups' order. */
function cellCodes(data: Pick<RotaData, "cohorts" | "groups" | "assignments">, day: number, shift: number, dutyId: number): string[] {
  const code = codes(data);
  const on = new Set(data.assignments.filter((a) => a.day === day && a.shift === shift && a.duty_id === dutyId).map((a) => a.group_id));
  return groupsInOrder(data).filter((g) => on.has(g.id)).map((g) => code.get(g.id)!);
}

/** The board: a row per shift × duty, a column per day; «אין משמרת» where the week has no such shift (and the codes still there, «מחוץ לשבוע»). */
export function rotaBoardTable(data: RotaData, edition: RotaEdition): Table {
  const rows: string[][] = [];
  for (const shift of SHIFTS) {
    for (const d of dutiesInOrder(data)) {
      rows.push([
        shiftText(edition, shift),
        d.name,
        ...ROTA_DAYS.map((day) => {
          const c = cellCodes(data, day, shift, d.id).join(", ");
          if (rotaShiftActive(edition, day, shift)) return c;
          return c ? `${c} (מחוץ לשבוע)` : "אין משמרת";
        }),
      ]);
    }
  }
  return { name: SHEET.board, headers: ["משמרת", "תורנות", ...ROTA_DAYS.map((d) => DAY_NAMES[d])], widths: [24, 16, 18, 18, 18, 18, 18], landscape: true, rows };
}

// ------------------------------------------------------------------ the staff

/** Who a staff shift is: the name (a team member's or typed), or «צוות <cohort>». */
export function staffWho(data: Pick<RotaData, "cohorts">, s: Pick<RotaStaffShift, "name" | "cohort_id">): string {
  if (s.name) return s.name;
  const c = data.cohorts.find((x) => x.id === s.cohort_id);
  return c ? `צוות ${c.name}` : "TBD";
}

/**
 * The staff of one shift (v20 — no «אחראי/ת»): every staff shift of the day whose hours overlap it as the week has it
 * (staffOn), then one whose hours overlap none of the week's shifts that day in the shift it starts in — never lost.
 */
function staffOfShift(data: RotaData, edition: RotaEdition, day: Day, shift: ShiftIndex): RotaStaffShift[] {
  const mine = staffInOrder(data).filter((s) => s.day === day);
  const placed = new Set(SHIFTS.flatMap((sh) => staffOn(edition, mine, day, sh)).map((s) => s.id));
  const stray = mine.filter((s) => !placed.has(s.id) && shiftOfStart(edition, day, s.start_min) === shift);
  return [...staffOn(edition, mine, day, shift), ...stray].sort((a, b) => a.start_min - b.start_min || a.id - b.id);
}

const staffCell = (data: RotaData, s: RotaStaffShift) => `${staffWho(data, s)} ${LRM}${fmtRange(s.start_min, s.end_min)}${s.note ? ` · ${s.note}` : ""}`;

/** The staff's shifts as a list: day, hours, who, note (v20: no kind). The workbook's sheet is the schedule (staffSchedule.ts). */
export function staffTable(data: RotaData): Table {
  return {
    name: SHEET.staff,
    headers: ["יום", "שעות", "מי", "הערה"],
    widths: [10, 14, 28, 36],
    rows: staffInOrder(data).map((s) => [DAY_NAMES[s.day], `${LRM}${fmtRange(s.start_min, s.end_min)}`, staffWho(data, s), s.note ?? ""]),
  };
}

// ------------------------------------------------------------------ דף יום

/**
 * One day: per shift its staff (everyone whose hours overlap it — v20: no «אחראי/ת משמרת», and no TBD row for one)
 * and each duty's groups with their size and head — and the head's phone only when `phones` is given (then a טלפון
 * column, filled only where a phone came back).
 */
export function daySheet(data: RotaData, edition: RotaEdition, day: Day, phones: HeadPhones): Table {
  const withPhones = phones != null;
  const code = codes(data);
  const groups = groupsInOrder(data);
  const blank = withPhones ? ["", "", ""] : ["", ""]; // a staff row: no size, no head (and no phone)
  const rows: string[][] = [];
  const fills: (string | null)[] = [];
  const push = (r: string[], fill: string | null = null) => {
    rows.push(r);
    fills.push(fill);
  };
  for (const shift of shiftsOfDay(edition, day, data.assignments)) {
    const st = shiftText(edition, shift, day);
    for (const s of staffOfShift(data, edition, day, shift)) push([st, STAFF_LABEL, staffCell(data, s), ...blank], BAND_FILL);
    for (const d of dutiesInOrder(data)) {
      const on = new Set(data.assignments.filter((a) => a.day === day && a.shift === shift && a.duty_id === d.id).map((a) => a.group_id));
      const mine = groups.filter((g) => on.has(g.id));
      if (mine.length === 0) push([st, d.name, "—", ...blank]);
      for (const g of mine) push([st, d.name, code.get(g.id)!, num(g.size), g.head_name ?? "", ...(withPhones ? [phoneCell(phones.get(g.id))] : [])]);
    }
  }
  return {
    name: SHEET.day(day),
    headers: ["משמרת", "תורנות / צוות", "קבוצה / מי", "גודל", "ראש/ת קבוצה", ...(withPhones ? ["טלפון"] : [])],
    widths: [24, 18, 30, 8, 24, ...(withPhones ? [16] : [])],
    landscape: true,
    rows,
    fills,
  };
}

// ------------------------------------------------------------------ לו"ז מטבח

export const KITCHEN = "מטבח";

/** The kitchen's duty: the one named «מטבח» (as names are compared — nameKey); null when there is none. */
export function kitchenDutyId(data: Pick<RotaData, "duties">): number | null {
  return dutiesInOrder(data).find((d) => nameKey(d.name) === nameKey(KITCHEN))?.id ?? null;
}

/** A row of the grid is a meal when its label says so («ארוחת בוקר / חבורות»). */
const isMeal = (r: GridRow) => r.kind === "fixed" && /ארוח/.test(r.label);

/**
 * One duty in every shift of the week — the kitchen's by default (kitchenDutyId): its groups, how many people they are,
 * their heads, the trainees on campus then and their diets, and the meals of the shift (the grid's fixed rows whose
 * label is a meal's, active that day).
 */
export function kitchenSheet(data: RotaData, edition: RotaEdition, rows: readonly GridRow[], dutyId: number): Table {
  const duty = data.duties.find((d) => d.id === dutyId);
  const groups = groupsInOrder(data);
  const code = codes(data);
  const cohorts = cohortsInOrder(data);
  const meals = [...rows].filter(isMeal).sort((a, b) => a.start_min - b.start_min || a.id - b.id);
  return {
    name: duty && nameKey(duty.name) !== nameKey(KITCHEN) ? `לו״ז ${duty.name}` : SHEET.kitchen,
    headers: ["יום", "משמרת", "קבוצה", "אנשים בקבוצה", "ראש/ת קבוצה", "חניכים בקמפוס", "תזונה בקמפוס", "ארוחות"],
    widths: [10, 22, 12, 12, 26, 12, 40, 36],
    landscape: true,
    rows: slotsToList(edition, data.assignments.filter((a) => a.duty_id === dutyId)).map(({ day, shift }) => {
      const on = new Set(data.assignments.filter((a) => a.day === day && a.shift === shift && a.duty_id === dutyId).map((a) => a.group_id));
      const mine = groups.filter((g) => on.has(g.id));
      const here = cohorts.filter((c) => presentAt(data, c.id, day, shift));
      const ofShift = meals.filter((r) => rowActive(r, day, edition) && shiftOfStart(edition, day, r.start_min) === shift);
      return [
        DAY_NAMES[day],
        shiftText(edition, shift, day),
        mine.length ? mine.map((g) => code.get(g.id)!).join(", ") : "—",
        mine.length ? num(sumOrTbd(mine.map((g) => g.size))) : "",
        mine.map((g) => g.head_name ?? "TBD").join(", "),
        num(presentTotal(data, day, shift)),
        dietsText(dietsOf(here)),
        ofShift.map((r) => `${LRM}${fmtRange(r.start_min, r.end_min)} ${r.label}`).join("; "),
      ];
    }),
  };
}

// ------------------------------------------------------------------ ראשי קבוצות

/** Every group and its head — and the head's phone only when `phones` is given. */
export function headsTable(data: RotaData, phones: HeadPhones): Table {
  const withPhones = phones != null;
  const cohort = new Map(data.cohorts.map((c) => [c.id, c.name]));
  const code = codes(data);
  return {
    name: SHEET.heads,
    headers: ["קבוצה", "מכינה", "גודל", "ראש/ת קבוצה", ...(withPhones ? ["טלפון"] : [])],
    widths: [10, 26, 8, 28, ...(withPhones ? [18] : [])],
    rows: groupsInOrder(data).map((g) => [code.get(g.id)!, cohort.get(g.cohort_id) ?? "TBD", num(g.size), g.head_name ?? "TBD", ...(withPhones ? [phoneCell(phones.get(g.id))] : [])]),
  };
}

// ------------------------------------------------------------------ מוצ"ש–ראשון

/**
 * One of the two Saturday-night lists (v19): «משימות» (kind task — every row from before v19) or «רשימת קניות» (kind
 * item), in its order (sort, id). The two share the edition's numbering in the database; each list is numbered by its
 * own place on screen and on paper.
 */
export function prepInOrder(data: Pick<RotaData, "prep">, kind: PrepKind): RotaPrepTask[] {
  return data.prep.filter((t) => prepKindOf(t) === kind).sort((a, b) => a.sort - b.sort || a.id - b.id);
}

/** How far the two lists are: tasks done of tasks, items bought («נקנה» is the row's `done`) of items. */
export function prepCounts(data: Pick<RotaData, "prep">): { tasks: number; tasksDone: number; items: number; itemsBought: number } {
  const tasks = prepInOrder(data, "task");
  const items = prepInOrder(data, "item");
  return { tasks: tasks.length, tasksDone: tasks.filter((t) => t.done).length, items: items.length, itemsBought: items.filter((t) => t.done).length };
}

/** The Saturday-night tasks, numbered by their place in the list (the shopping list is shoppingTable). */
export function prepTable(data: RotaData): Table {
  const code = codes(data);
  return {
    name: SHEET.prep,
    headers: ["#", "משימה", "קבוצה", "בוצע"],
    widths: [5, 60, 10, 10],
    rows: prepInOrder(data, "task").map((t, i) => [String(i + 1), t.text, t.group_id != null ? (code.get(t.group_id) ?? "") : "", t.done ? "בוצע" : ""]),
  };
}

/** v19: the Saturday-night shopping list, numbered by its place — each item, its quantity as typed (blank when none), «נקנה». */
export function shoppingTable(data: RotaData): Table {
  return {
    name: SHEET.shopping,
    headers: ["#", "פריט", "כמות", "נקנה"],
    widths: [5, 50, 20, 10],
    rows: prepInOrder(data, "item").map((t, i) => [String(i + 1), t.text, t.qty ?? "", t.done ? "נקנה" : ""]),
  };
}

// ------------------------------------------------------------------ אוכל

/** v20: one meal of the week — a fixed row of the grid whose label is a meal's (isMeal), on a day the week has it. */
export interface MealCount {
  day: Day;
  start: number;
  end: number;
  /** The row's label as the grid has it («ארוחת צהריים / חבורות»). */
  label: string;
  /** The shift the meal starts in (shiftOfStart): the cohorts marked on campus in it are the ones counted. */
  shift: ShiftIndex;
  /** The cohorts marked on campus in that shift, in their order. */
  cohorts: RotaCohort[];
  /**
   * The cohorts not marked on campus in any shift of the week (presence_unknown): whether they eat here is not known —
   * never assumed either way, so while one is left every number of every meal is TBD.
   */
  unmarked: RotaCohort[];
  /** Their trainees and meals by diet, added up (dietsOf): TBD where a cohort's number is, and everywhere while `unmarked`. */
  counts: DietSplit;
}

const UNKNOWN: DietSplit = { trainees: null, veg_only: null, gf_only: null, both: null, regular: null };

/**
 * v20 «כמויות אוכל לכל יום» (the owner's words): per day, each meal — the grid's fixed rows whose label is a meal's
 * («ארוח», as the kitchen sheet finds them), active that day (rowActive: Sunday from the opening, Thursday to the close)
 * — with the cohorts marked on campus in the shift the meal starts in, and their trainees by diet: «צמחוני/טבעוני»
 * only, «ללא גלוטן» only, both, the regular rest (dietSplit — «מהם גם וגם» counted once). Trainees only: the staff and
 * the guests are not counted. Nothing is filled in: a cohort whose number is TBD makes the meal's sum TBD, and a cohort
 * not marked anywhere makes every meal TBD. A night meal (after midnight) is the night's, of the day before.
 */
export function mealCounts(data: Pick<RotaData, "cohorts" | "presence">, edition: RotaEdition, rows: readonly GridRow[]): MealCount[] {
  const cohorts = cohortsInOrder(data);
  const unmarked = cohorts.filter((c) => !presenceMarked(data, c.id));
  const meals = [...rows].filter(isMeal).sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min || a.id - b.id);
  return ROTA_DAYS.flatMap((day) =>
    meals
      .filter((r) => rowActive(r, day, edition))
      .map((r): MealCount => {
        const shift = shiftOfStart(edition, day, r.start_min);
        const here = cohorts.filter((c) => presentAt(data, c.id, day, shift));
        return { day, start: r.start_min, end: r.end_min, label: r.label, shift, cohorts: here, unmarked, counts: unmarked.length > 0 ? UNKNOWN : dietsOf(here) };
      }),
  );
}

/** A meal's day as the food page writes it: «ראשון 14.2» (the date while it is known), a night meal «ליל ראשון–שני». */
export function mealDay(edition: Partial<Pick<Edition, "start_date">>, m: Pick<MealCount, "day" | "start">): string {
  const night = nightLabel(m.day, m.start);
  if (night) return night;
  const date = dateOf(edition.start_date ?? null, m.day);
  return date ? `${DAY_NAMES[m.day]} ${shortDate(date)}` : DAY_NAMES[m.day];
}

/** Who a meal counts: the cohorts on campus then («אין מכינות בקמפוס» when none), and those never marked at all. */
export function mealCohorts(m: Pick<MealCount, "cohorts" | "unmarked">): string {
  const here = m.cohorts.length > 0 ? m.cohorts.map((c) => c.name).join(", ") : m.unmarked.length > 0 ? "" : "אין מכינות בקמפוס";
  const open = m.unmarked.length > 0 ? `לא סומן מתי בקמפוס: ${m.unmarked.map((c) => c.name).join(", ")}` : "";
  return [here, open].filter(Boolean).join(" · ");
}

/** The headers of the food page's meals table (mealsTable), DIET_HEADERS after the trainees. */
export const MEAL_HEADERS = ["יום", "ארוחה", "מכינות בקמפוס", "חניכים", ...DIET_HEADERS] as const;

/**
 * v20 «כמויות אוכל»: mealCounts as a table — a row per day × meal: the day, the meal and its hours, the cohorts
 * counted, the trainees, the four meal columns (TBD where unknown). /print/rota's food page, the xlsx's «אוכל» and the
 * cohorts page («קבוצות ומכינות») draw these rows.
 */
export function mealsTable(data: Pick<RotaData, "cohorts" | "presence">, edition: RotaEdition & Partial<Pick<Edition, "start_date">>, rows: readonly GridRow[]): Table {
  return {
    name: SHEET.food,
    headers: [...MEAL_HEADERS],
    widths: [16, 36, 36, 9, 14, 14, 10, 10],
    landscape: true,
    rows: mealCounts(data, edition, rows).map((m) => [
      mealDay(edition, m),
      `${m.label || "TBD"} ${LRM}${fmtRange(m.start, m.end)}`,
      mealCohorts(m),
      num(m.counts.trainees),
      ...dietCells(m.counts),
    ]),
  };
}

/**
 * Per cohort, trainees only («חניכים בלבד» — the staff and guests are not counted): its trainees (v20: its own field;
 * TBD while unknown) and its meals by diet (dietSplit — «צמחוני/טבעוני» only, «ללא גלוטן» only, both, regular); a last
 * row adds them up (TBD while one of them is). Who is on campus when is mealsTable's.
 */
export function foodTable(data: Pick<RotaData, "cohorts">): Table {
  const cohorts = cohortsInOrder(data);
  const rows = cohorts.map((c) => [c.name, num(cohortTotal(data, c.id)), ...dietCells(dietSplit(c))]);
  if (cohorts.length) {
    const all = dietsOf(cohorts);
    rows.push(["סה״כ", num(all.trainees), ...dietCells(all)]);
  }
  return {
    name: SHEET.foodCohorts,
    headers: ["מכינה (חניכים בלבד)", "חניכים", ...DIET_HEADERS],
    widths: [28, 9, 16, 16, 10, 10],
    rows,
  };
}

// ------------------------------------------------------------------ מי בקמפוס

/** Each shift of the week: the cohorts marked on campus, their trainees, and the staff whose shift overlaps it. */
export function campusTable(data: RotaData, edition: RotaEdition): Table {
  const cohorts = cohortsInOrder(data);
  return {
    name: SHEET.campus,
    headers: ["יום", "משמרת", "מכינות בקמפוס", "חניכים", "צוות"],
    widths: [10, 24, 40, 10, 44],
    landscape: true,
    rows: rotaSlots(edition).map(({ day, shift }) => {
      const r = rotaShiftRange(edition, day, shift)!;
      const here = cohorts.filter((c) => presentAt(data, c.id, day, shift));
      const staff = staffInOrder(data).filter((s) => s.day === day && overlaps(s.start_min, s.end_min, r.start, r.end));
      return [DAY_NAMES[day], shiftText(edition, shift, day), here.length ? here.map((c) => c.name).join(", ") : "לא סומן", here.length ? num(presentTotal(data, day, shift)) : "", staff.map((s) => staffCell(data, s)).join("; ")];
    }),
  };
}

// ------------------------------------------------------------------ עומס

/** Each group's load (loadsOf): shifts, nights, each duty, the shifts its cohort is on campus, back-to-back pairs. */
export function loadsTable(data: RotaData, edition: RotaEdition): Table {
  const loads = loadsOf(data, data.assignments, edition);
  const cohort = new Map(data.cohorts.map((c) => [c.id, c.name]));
  const code = codes(data);
  const duties = dutiesInOrder(data);
  return {
    name: SHEET.loads,
    headers: ["קבוצה", "מכינה", "גודל", "משמרות", "לילות", ...duties.map((d) => d.name), "משמרות בקמפוס", "צמודות"],
    widths: [10, 24, 8, 10, 8, ...duties.map(() => 12), 14, 10],
    landscape: true,
    rows: groupsInOrder(data).map((g) => {
      const l = loads.get(g.id)!;
      return [code.get(g.id)!, cohort.get(g.cohort_id) ?? "TBD", num(g.size), String(l.shifts), String(l.nights), ...duties.map((d) => String(l.byDuty.get(d.id) ?? 0)), String(l.present), String(l.backToBack)];
    }),
  };
}

// ------------------------------------------------------------------ the workbook and the CSV of a view

export interface RotaWorkbookInput {
  week: Week;
  data: RotaData;
  /** «כולל טלפונים של ראשי הקבוצות»: the phones given; null — none in any sheet. */
  phones: HeadPhones;
  /** The kitchen's duty (default: kitchenDutyId); null — no kitchen sheet. */
  kitchenDuty?: number | null;
}

/** Every page as a sheet, for «הורדת xlsx (כל הגיליונות)»: the board, a schedule per group, a sheet per day, the kitchen, the heads, the staff, מוצ״ש and its shopping list, the food (v20: per meal, then per cohort), on campus, the loads. */
export function rotaWorkbook({ week, data, phones, kitchenDuty }: RotaWorkbookInput): Table[] {
  const e = week.edition;
  const kitchen = kitchenDuty === undefined ? kitchenDutyId(data) : kitchenDuty;
  return [
    rotaBoardTable(data, e),
    ...groupScheduleInputs(week, data).map((g) => groupSchedule(g.input)),
    ...ROTA_DAYS.map((d) => daySheet(data, e, d, phones)),
    ...(kitchen != null && data.duties.some((d) => d.id === kitchen) ? [kitchenSheet(data, e, week.rows, kitchen)] : []),
    headsTable(data, phones),
    staffScheduleTable(week, data),
    prepTable(data),
    shoppingTable(data),
    mealsTable(data, e, week.rows),
    foodTable(data),
    campusTable(data, e),
    loadsTable(data, e),
  ];
}

/**
 * Several tables as one CSV (all the groups' schedules, every day): a title row, then each table's name, its header
 * row, its rows and an empty row.
 */
export function stackTables(name: string, tables: readonly Table[]): Table {
  return { name, headers: [name], rows: tables.flatMap((t) => [[t.name], t.headers, ...t.rows, []]) };
}
