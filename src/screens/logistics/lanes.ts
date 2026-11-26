// The transport board's lanes («לוגיסטיקה ← הסעות», the reset, phase 3) — pure, from a loaded Week, ONE transports read
// (cmds.transports(): pending and approved, each with its pickup_min) and the edition's staff shifts (port.rota.load).
// One day at a time, on the grid's clock (06:30 → 06:30 the next morning, AXIS):
//   a transport lane per closed lesson that asked for one and waits for the decision or was approved — its outbound leg
//   a bar from the pickup to the lesson's start (a pickup before 06:30 drawn from the axis' edge, `clamped`, its true
//   time said in the text), or a bar-less marker at the start when the pickup time is not known (no time typed: boardPickupMin) — and,
//   for «הלוך ושוב», the return as a marker at the END OF THE TEACHING (app.teach_end: start + teachMinutes — what the
//   speaker's message, the escort's page and the files say; not the grid row's end) with no length: the data has no
//   return time, no travel time, no car, one driver per lesson — never invented here;
//   a shift lane per staff shift of that day (a team member, a name as typed or a cohort's staff — v20: no lead), so
//   whoever finds a driver sees who is on duty; and (v19) beside them the cohorts whose staff can drive («הצוות שלה
//   יכול להסיע», canDrive), those on campus that day first — names only. No phone: shifts and cohorts have none, and a
//   lane carries none but what the read returned for whom it may show it.
// v20 — the driver's two suggestion lists for an approved transport (driverSuggestions; the owner's «הצעה: נהג/ת
// מהמשמרת»): «במשמרת בשעת האיסוף», the staff whose hours overlap the trip [pickup, the lesson's start] — a pickup before
// 06:30 against the night of the day before, as the staff's clock has it (onStaffClock) — and «אחריות של מכינה», the
// cohorts whose staff can drive and that are on campus in the pickup's shift. A pick only FILLS the form's fields (the
// cohort's contact's phone only for whom app.may_see_rota_contacts lets read it, fetched on the click): saving is still
// set_transport_driver, typing by hand stays, and no transport ever reaches the rota.
import type { LessonTransport, TransportDriverPatch } from "../../data/commands";
import type { RotaCohort, RotaData, RotaStaffShift } from "../../data/rota";
import { STAGE_LIMITS } from "../../data/stageRules";
import { lessonHandler } from "../../domain/handler";
import { teachMinutes } from "../../domain/message";
import { typedPickupMin } from "../../domain/pickup";
import { byCohortOrder, canDrive, presentAt } from "../../domain/rota";
import { DAY_END, DAY_START, type Day, DAYS, fmt } from "../../domain/time";
import type { Lesson, TransportDetails, Week } from "../../domain/types";
import { speakersOf } from "../../exports/logistics";
import { shiftAt, staffInOrder, staffWho } from "../../exports/rota";
import { onStaffClock } from "../../exports/staffSchedule";
import { todayColumn } from "../../offline/view";

/** The board's time axis: the grid's day, fixed — 06:30 to 06:30 the next morning. */
export const AXIS = { start: DAY_START, end: DAY_END } as const;

/** Where a transport stands on the board: waits for the decision, approved, approved and arranged («סודר»). */
export type BoardState = "pending" | "approved" | "arranged";

/** The outbound leg: a bar from the pickup to the lesson's start, or a marker (`known` false: no pickup time). */
export type Outbound = { kind: "bar"; from: number; to: number; clamped: boolean } | { kind: "marker"; at: number; known: boolean };

export interface TransportLane {
  lesson: Lesson;
  state: BoardState;
  /** «הלוך ושוב». */
  roundTrip: boolean;
  /** The lesson's speakers, lead first («» when none is named). */
  speaker: string;
  title: string;
  /** members.id of the lesson's handler (the lead speaker's approach's owner), or null. */
  handler: number | null;
  /** What the transports read returned for the lesson; null: nothing came back (not the viewer's to see, or no read yet). */
  details: LessonTransport | null;
  outbound: Outbound;
  /** The minute the teaching ends (app.teach_end): the lesson's block on the axis ends there. */
  teachEnd: number;
  /** The return marker's minute (the teaching's end, `teachEnd`) for «הלוך ושוב»; null otherwise. */
  returnAt: number | null;
}

export interface ShiftLane {
  shift: RotaStaffShift;
  /** The team member's name, the name as typed, or «צוות <מכינה>». (v20: no «אחראי/ת משמרת».) */
  who: string;
}

/** v19: a cohort whose staff can drive («הצוות שלה יכול להסיע») — its name only — and whether it is on campus that day. */
export interface DriveCohort {
  cohort: RotaCohort;
  /** Marked on campus in any shift of the day (no row: not marked, never assumed). */
  present: boolean;
}

export interface DayLanes {
  day: Day;
  transports: TransportLane[];
  shifts: ShiftLane[];
  /** The cohorts whose staff can drive: those on campus that day first, then by the cohorts' order (sort, letter). */
  drivers: DriveCohort[];
}

type BoardWeek = Pick<Week, "lessons" | "lessonSpeakers" | "speakers" | "approaches" | "team" | "edition">;

/** app.teach_end of a lesson: its start plus the teaching time (the lesson's own, else the edition's, within the row). */
export function teachEndOf(l: Pick<Lesson, "start_min" | "end_min" | "teach_min">, lessonMinutes?: number | null): number {
  return l.start_min + teachMinutes(l, lessonMinutes);
}

/** A lesson the board shows: closed, a lesson (not a memorial slot), a transport asked for, pending or approved. */
export function onBoard(l: Lesson): boolean {
  return l.state === "closed" && l.kind === "lesson" && l.transport !== "none" && (l.approval === "pending" || l.approval === "approved");
}

const byStart = (a: Pick<Lesson, "start_min" | "id">, b: Pick<Lesson, "start_min" | "id">) => a.start_min - b.start_min || a.id - b.id;

function stateOf(l: Lesson, d: LessonTransport | null): BoardState {
  if (l.approval === "pending") return "pending";
  return d?.arranged ? "arranged" : "approved";
}

/**
 * The outbound leg from the pickup minute (the lesson's grid day: 0 … 1830): unknown → a marker at the start; before the
 * start → a bar to it, from 06:30 at the earliest (`clamped` when the pickup is earlier); at or after the start (a pickup
 * typed after the lesson begins) → a marker at the pickup, never a bar backwards.
 */
export function outboundOf(start: number, pickupMin: number | null | undefined): Outbound {
  if (pickupMin == null) return { kind: "marker", at: start, known: false };
  if (pickupMin < start) return { kind: "bar", from: Math.max(pickupMin, AXIS.start), to: start, clamped: pickupMin < AXIS.start };
  return { kind: "marker", at: Math.min(pickupMin, AXIS.end), known: true };
}

function laneOf(week: BoardWeek, l: Lesson, details: Map<number, LessonTransport>): TransportLane {
  const d = details.get(l.id) ?? null;
  const teachEnd = teachEndOf(l, week.edition.settings?.lesson_minutes);
  return {
    lesson: l,
    state: stateOf(l, d),
    roundTrip: l.transport === "round_trip",
    speaker: speakersOf(week, l.id),
    title: l.title ?? "TBD",
    handler: lessonHandler(week, l.id),
    details: d,
    outbound: outboundOf(l.start_min, boardPickupMin(l.start_min, d)),
    teachEnd,
    returnAt: l.transport === "round_trip" ? teachEnd : null,
  };
}

/** The cohorts whose staff can drive, for one day: on campus that day first, then by sort, letter and id. */
export function driveCohorts(rota: Pick<RotaData, "cohorts" | "presence"> | null, day: Day): DriveCohort[] {
  if (!rota) return [];
  const here = new Set(rota.presence.filter((p) => p.day === day).map((p) => p.cohort_id));
  return rota.cohorts
    .filter(canDrive)
    .map((cohort) => ({ cohort, present: here.has(cohort.id) }))
    .sort((a, b) => Number(b.present) - Number(a.present) || byCohortOrder(a.cohort, b.cohort));
}

/**
 * One day of the board: its transport lanes by start (then id), its staff shifts by start (then id), and the cohorts
 * whose staff can drive (driveCohorts).
 */
export function transportLanes(
  week: BoardWeek,
  transports: readonly LessonTransport[] | null,
  rota: Pick<RotaData, "staff" | "cohorts" | "presence"> | null,
  day: Day,
): DayLanes {
  const details = new Map((transports ?? []).map((t) => [t.lesson_id, t]));
  const team = new Map(week.team.map((t) => [t.id, t.display_name]));
  return {
    day,
    transports: week.lessons
      .filter((l) => l.day === day && onBoard(l))
      .sort(byStart)
      .map((l) => laneOf(week, l, details)),
    shifts: (rota?.staff ?? [])
      .filter((s) => s.day === day)
      .sort((a, b) => a.start_min - b.start_min || a.id - b.id)
      .map((s) => ({ shift: s, who: (s.member_id != null ? team.get(s.member_id) : undefined) ?? staffWho(rota!, s) })),
    drivers: driveCohorts(rota, day),
  };
}

/** The board's counts, the whole week: waiting for the decision, approved (arranged among them), arranged. */
export function boardCounts(week: Pick<Week, "lessons">, transports: readonly LessonTransport[] | null): { pending: number; approved: number; arranged: number } {
  const arranged = new Set((transports ?? []).filter((t) => t.arranged).map((t) => t.lesson_id));
  const lessons = week.lessons.filter(onBoard);
  const approved = lessons.filter((l) => l.approval === "approved");
  return { pending: lessons.length - approved.length, approved: approved.length, arranged: approved.filter((l) => arranged.has(l.id)).length };
}

/** How many transport lanes a day has (the day tabs' counts). */
export function lanesPerDay(week: Pick<Week, "lessons">): Record<Day, number> {
  const n: Record<Day, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const l of week.lessons) if (onBoard(l)) n[l.day]++;
  return n;
}

/** `?day=` as a day column (0–4), or null for anything else. */
export function boardDayParam(v: string | null | undefined): Day | null {
  if (v == null || !/^[0-4]$/.test(v)) return null;
  return Number(v) as Day;
}

/** The day the board opens on: today's column while the week is on, else the first day with a transport, else Sunday. */
export function defaultBoardDay(week: Pick<Week, "lessons" | "edition">, nowIso: string): Day {
  const today = todayColumn(week.edition.start_date, nowIso);
  if (today != null) return today;
  const n = lanesPerDay(week);
  return DAYS.find((d) => n[d] > 0) ?? 0;
}

/** A minute's place on the axis, 0–100 (outside it: its edge). */
export function axisPercent(min: number): number {
  const m = Math.min(Math.max(min, AXIS.start), AXIS.end);
  return ((m - AXIS.start) / (AXIS.end - AXIS.start)) * 100;
}

/** The axis' ticks: every two hours on the hour, 08:00 … 06:00 the next morning. */
export const AXIS_TICKS: readonly number[] = Array.from({ length: 12 }, (_, i) => 480 + i * 120);

/**
 * The pickup's minute on the lesson's grid day, as the board draws and says it — the one rule of every logistics view
 * (typedPickupMin, src/domain/pickup.ts): pickup_min counts only while it is the time typed in `pickup_time`; a time typed
 * since → its own minute; words («אחרי השיעור») or no time at all → null (not a time).
 */
export function boardPickupMin(start: number, d: Pick<LessonTransport, "pickup_time" | "pickup_min"> | null | undefined): number | null {
  return typedPickupMin(start, d);
}

/**
 * What the list says of a lane's pickup time: the minute as «HH:MM» (`early`: before 06:30, where the axis clamps it),
 * else the words typed («אחרי השיעור»), else nothing known (both null). One rule with the bar: boardPickupMin.
 */
export function pickupText(t: Pick<TransportLane, "details" | "lesson">): { time: string | null; early: boolean; words: string | null } {
  const m = boardPickupMin(t.lesson.start_min, t.details);
  if (m != null) return { time: fmt(m), early: m < AXIS.start, words: null };
  return { time: null, early: false, words: t.details?.pickup_time?.trim() || null };
}

/**
 * The driver form's patch for set_transport_driver: only the keys that differ from what was loaded — a name or a phone
 * trimmed, empty → null (as the database keeps it), «סודר» as ticked. Nothing changed → {} (nothing is sent).
 */
export function driverPatch(
  loaded: Pick<TransportDetails, "driver_name" | "driver_phone" | "arranged">,
  draft: { name: string; phone: string; arranged: boolean },
): TransportDriverPatch {
  const text = (v: string) => v.trim() || null;
  const p: TransportDriverPatch = {};
  const name = text(draft.name);
  const phone = text(draft.phone);
  if (name !== (loaded.driver_name ?? null)) p.driver_name = name;
  if (phone !== (loaded.driver_phone ?? null)) p.driver_phone = phone;
  if (draft.arranged !== loaded.arranged) p.arranged = draft.arranged;
  return p;
}

// ------------------------------------------------------------------ v20: who could drive

/** A staff shift a driver could come from: who (the team's name for a member, else as the rota says), on which day. */
export interface StaffPick {
  shift: RotaStaffShift;
  who: string;
}

/** A cohort whose staff could take the transport, and what a pick writes into «שם הנהג/ת». */
export interface CohortPick {
  cohort: RotaCohort;
  /** «צוות מכינת X — איש/אשת קשר: Y» (no contact named: «צוות מכינת X»), within the field's 80 characters. */
  fill: string;
}

export interface DriverSuggestions {
  /** The pickup on the staff's clock (a pickup before 06:30 is the night of the day before); null: no pickup time — no suggestion. */
  at: { day: Day; min: number } | null;
  /** «במשמרת בשעת האיסוף»: whose hours overlap the trip [pickup, the lesson's start], those of the night before first; a name once. */
  staff: StaffPick[];
  /** «אחריות של מכינה»: the cohorts whose staff can drive, marked on campus in the pickup's shift (no row: not marked, never assumed). */
  cohorts: CohortPick[];
}

/** What a cohort pick writes: «צוות מכינת X — איש/אשת קשר: Y» — «צוות X» when the name already says «מכינ…»; the contact left out when none is named or it would not fit. */
export function cohortDriverText(c: Pick<RotaCohort, "name" | "contact_name">): string {
  const base = (c.name.startsWith("מכינ") ? `צוות ${c.name}` : `צוות מכינת ${c.name}`).slice(0, STAGE_LIMITS.driver_name);
  if (!c.contact_name) return base;
  const full = `${base} — איש/אשת קשר: ${c.contact_name}`;
  return [...full].length <= STAGE_LIMITS.driver_name ? full : base;
}

/**
 * The pieces of the trip [pickup, the lesson's start] on the staff's clock, as (day, from, to): from 06:30 it is the
 * lesson's own day; a pickup before it starts in the night of the day before (+24h, to 06:30) and goes on to the start
 * — on Sunday, with no day before it in the week, from 06:30. A pickup at or after the start: that minute alone.
 */
export function tripPieces(day: Day, pickup: number, start: number): { day: Day; from: number; to: number }[] {
  const at = onStaffClock(day, pickup);
  const out: { day: Day; from: number; to: number }[] = [];
  if (at && at.day !== day) out.push({ day: at.day, from: at.min, to: DAY_END });
  const from = Math.max(pickup, DAY_START);
  out.push({ day, from, to: Math.max(start, from + 1) });
  return out;
}

/**
 * v20: who could drive an approved transport — the staff on shift during the trip and the cohorts that can drive and are
 * on campus in the pickup's shift. Nothing without a pickup time (the form still takes a name typed by hand). Pure; the
 * rota as load_rota gave it (no phone) — or null while it loads.
 */
export function driverSuggestions(
  week: Pick<Week, "team" | "edition">,
  rota: Pick<RotaData, "staff" | "cohorts" | "presence"> | null,
  lesson: Pick<Lesson, "day" | "start_min">,
  pickup: number | null,
): DriverSuggestions {
  if (pickup == null) return { at: null, staff: [], cohorts: [] };
  // Sunday before 06:30 has no night before it in the week: its own morning
  const at = onStaffClock(lesson.day, pickup) ?? { day: lesson.day, min: DAY_START };
  if (!rota) return { at, staff: [], cohorts: [] };
  const team = new Map(week.team.map((t) => [t.id, t.display_name]));
  const ordered = staffInOrder(rota);
  const seen = new Set<string>();
  const staff: StaffPick[] = [];
  for (const p of tripPieces(lesson.day, pickup, lesson.start_min)) {
    for (const s of ordered) {
      if (s.day !== p.day || !(s.start_min < p.to && s.end_min > p.from)) continue;
      const who = (s.member_id != null ? team.get(s.member_id) : undefined) ?? staffWho(rota, s);
      if (seen.has(who)) continue;
      seen.add(who);
      staff.push({ shift: s, who });
    }
  }
  const shift = shiftAt(week.edition, at.min);
  const cohorts = rota.cohorts
    .filter((c) => canDrive(c) && presentAt(rota, c.id, at.day, shift))
    .sort(byCohortOrder)
    .map((cohort) => ({ cohort, fill: cohortDriverText(cohort) }));
  return { at, staff, cohorts };
}
