// The export for the poster's designer (DESIGN «תוצרים» 4): the public schedule
// and nothing else — day, date (or TBD), the teaching time, the speaker's name
// as it should be printed, the title, the category, the room, «במקביל» where
// lessons run side by side, and the memorial slots. Never a contact detail, an
// amount or a note. Each export is kept as a snapshot (export_snapshots — the
// database lets no other key in), and diffSchedules says what changed since the
// last one, field by field. Pure, from a loaded Week.
import { messageDate, teachMinutes } from "../domain/message";
import { displayName } from "../domain/names";
import { addDays } from "../domain/israelTime";
import { type Day, DAY_NAMES, fmtRange, overlaps } from "../domain/time";
import type { Lesson, Week } from "../domain/types";
import { gridOrder } from "./tracking";
import { LRM, type Table } from "./table";

/** One row of the public schedule — exactly the keys a snapshot may hold (app.export_snapshots_guard). */
export interface DesignerRow {
  lesson_id: number;
  kind: "lesson" | "memorial";
  day: string;
  date: string;
  time: string;
  speaker: string;
  title: string;
  category: string;
  room: string;
  parallel: boolean;
}

/** The fields a change is reported on, in the table's order. */
export const DESIGNER_FIELDS = ["kind", "day", "date", "time", "speaker", "title", "category", "room", "parallel"] as const;
export type DesignerField = (typeof DESIGNER_FIELDS)[number];

export const DESIGNER_FIELD_LABEL: Record<DesignerField, string> = {
  kind: "סוג",
  day: "יום",
  date: "תאריך",
  time: "שעה",
  speaker: "מרצה",
  title: "כותרת",
  category: "קטגוריה",
  room: "חדר",
  parallel: "במקביל",
};

const KIND_LABEL: Record<DesignerRow["kind"], string> = { lesson: "שיעור", memorial: "זמן זיכרון" };

/** What goes on the poster: the closed lessons and the memorial slots (drafts are not public). */
function isPublic(l: Lesson): boolean {
  return l.state !== "cancelled" && (l.kind === "memorial" || l.state === "closed");
}

/**
 * The public schedule's facts for one lesson — what public.schedule_view gives the schedule link (without the
 * lesson's id) and what a designer row is written from. tests/parity holds this equal to the SQL.
 */
export interface ScheduleEntry {
  kind: "lesson" | "memorial";
  day: Day;
  /** The day column's date (a night lesson stays under its column, as on the poster), or null while the week's date is TBD. */
  date: string | null;
  /** The teaching time (a memorial slot: the whole slot). */
  start_min: number;
  end_min: number;
  /** The speakers' names as printed, the lead first: «ד״ר פלונית · פלוני». */
  speaker: string;
  title: string | null;
  category: string;
  room: string;
  /** A closed lesson that overlaps another closed lesson of the day. */
  parallel: boolean;
}

/** The public schedule of a loaded Week, in grid order. */
export function scheduleEntries(week: Week): (ScheduleEntry & { lesson_id: number })[] {
  const speakers = new Map(week.speakers.map((s) => [s.id, s]));
  const categories = new Map(week.categories.map((c) => [c.id, c.name]));
  const rooms = new Map(week.rooms.map((r) => [r.id, r.name]));
  const lessonMinutes = week.edition.settings?.lesson_minutes;
  const shown = week.lessons.filter(isPublic).sort(gridOrder(week));
  const teaching = shown.filter((l) => l.kind === "lesson");
  const start = week.edition.start_date;
  return shown.map((l) => {
    const names = week.lessonSpeakers
      .filter((x) => x.lesson_id === l.id)
      .sort((a, b) => Number(a.role !== "lead") - Number(b.role !== "lead") || a.speaker_id - b.speaker_id)
      .map((x) => speakers.get(x.speaker_id))
      .filter((s) => !!s)
      .map((s) => displayName(s!));
    return {
      lesson_id: l.id,
      kind: l.kind,
      day: l.day,
      date: start ? addDays(start, l.day) : null,
      start_min: l.start_min,
      end_min: l.start_min + (l.kind === "memorial" ? l.end_min - l.start_min : teachMinutes(l, lessonMinutes)),
      speaker: names.join(" · "),
      title: l.title,
      category: (l.category_id != null && categories.get(l.category_id)) || "",
      room: rooms.get(l.room_id) ?? "",
      parallel: l.kind === "lesson" && teaching.some((o) => o.id !== l.id && o.day === l.day && overlaps(o.start_min, o.end_min, l.start_min, l.end_min)),
    };
  });
}

/** One entry as the designer's table (and the schedule link's page) writes it. */
export function designerRow(e: ScheduleEntry, lessonId: number): DesignerRow {
  return {
    lesson_id: lessonId,
    kind: e.kind,
    day: DAY_NAMES[e.day],
    // the day column's date, Gregorian and Hebrew, as in the summary message
    date: messageDate(e.date, 0, 390) ?? "TBD",
    time: fmtRange(e.start_min, e.end_min),
    speaker: e.speaker,
    title: e.title ?? (e.kind === "memorial" ? "זמן זיכרון" : "TBD"),
    category: e.category,
    room: e.room,
    parallel: e.parallel,
  };
}

export function designerRows(week: Week): DesignerRow[] {
  return scheduleEntries(week).map((e) => designerRow(e, e.lesson_id));
}

/** A field as the table writes it. */
export function designerCell(r: DesignerRow, f: DesignerField): string {
  if (f === "kind") return KIND_LABEL[r.kind];
  if (f === "parallel") return r.parallel ? "במקביל" : "";
  return r[f];
}

export function designerTable(rows: DesignerRow[], editionLabel: string): Table {
  return {
    name: `לו"ז ${editionLabel}`,
    headers: DESIGNER_FIELDS.map((f) => DESIGNER_FIELD_LABEL[f]),
    widths: [12, 10, 26, 14, 28, 36, 22, 16, 10],
    landscape: true,
    rows: rows.map((r) => DESIGNER_FIELDS.map((f) => (f === "time" ? LRM : "") + designerCell(r, f))),
  };
}

export interface ScheduleChange {
  before: DesignerRow;
  after: DesignerRow;
  fields: DesignerField[];
}

export interface ScheduleDiff {
  added: DesignerRow[];
  removed: DesignerRow[];
  changed: ScheduleChange[];
}

/** What changed since the last export: rows added, rows gone, and rows whose fields differ — by lesson. */
export function diffSchedules(before: readonly DesignerRow[], after: readonly DesignerRow[]): ScheduleDiff {
  const old = new Map(before.map((r) => [r.lesson_id, r]));
  const now = new Map(after.map((r) => [r.lesson_id, r]));
  const changed: ScheduleChange[] = [];
  for (const r of after) {
    const o = old.get(r.lesson_id);
    if (!o) continue;
    const fields = DESIGNER_FIELDS.filter((f) => o[f] !== r[f]);
    if (fields.length) changed.push({ before: o, after: r, fields });
  }
  return {
    added: after.filter((r) => !old.has(r.lesson_id)),
    removed: before.filter((r) => !now.has(r.lesson_id)),
    changed,
  };
}

export function diffCount(d: ScheduleDiff): number {
  return d.added.length + d.removed.length + d.changed.length;
}

/** A snapshot read back: rows with the keys a DesignerRow has, whatever else (nothing, by the database's guard) came. */
export function readSnapshot(payload: unknown): DesignerRow[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      lesson_id: Number(r.lesson_id),
      kind: r.kind === "memorial" ? "memorial" : "lesson",
      day: String(r.day ?? ""),
      date: String(r.date ?? ""),
      time: String(r.time ?? ""),
      speaker: String(r.speaker ?? ""),
      title: String(r.title ?? ""),
      category: String(r.category ?? ""),
      room: String(r.room ?? ""),
      parallel: r.parallel === true,
    }));
}
