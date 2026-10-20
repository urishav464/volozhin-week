// The archive export (DESIGN «סיכונים»: the free plan has no backup — this is
// it): one zip, made in the browser and downloaded, never uploaded. Inside:
//   README.txt       what is in it, in Hebrew, and that it may hold personal data
//   edition.json     the edition — its settings, grid rows, rooms, categories,
//                    team names (no e-mail), roster names, lessons, approaches,
//                    pitches, availability, the activity log, notes, milestones
//                    and the designer's export snapshots
//   speakers.json    the pool's records of the speakers the edition touched
//                    (no contact detail)
//   tracking.xlsx    the tracking table, without phones
//   PERSONAL-DATA_contacts_and_transport.json — only when the caller's RLS
//                    showed any (a global admin): the speakers' contacts and the
//                    lessons' transport details, apart, named so nobody mistakes it.
import { strToU8, zipSync } from "fflate";
import { displayName } from "../domain/names";
import type { Week } from "../domain/types";
import type { ArchiveExtras } from "../data/outputs";
import { PERSONAL_FILE } from "./download";
import { trackingRows, trackingTable } from "./tracking";
import { toXlsx } from "./xlsx";

export const ARCHIVE_FORMAT = "volozhin-week-archive";
export { PERSONAL_FILE };

export interface ArchiveInput {
  week: Week;
  extras: ArchiveExtras;
  schemaVersion: number;
  /** ISO time of the export. */
  exportedAt: string;
}

/** The speakers an edition touched: approached, pitched or teaching. */
export function touchedSpeakers(week: Week): number[] {
  const ids = new Set<number>();
  for (const a of week.approaches) ids.add(a.speaker_id);
  for (const x of week.lessonSpeakers) ids.add(x.speaker_id);
  return [...ids].sort((a, b) => a - b);
}

function readme(input: ArchiveInput, personal: boolean): string {
  const e = input.week.edition;
  return [
    `ייצוא ארכיון · שבוע וולוז'ין · ${e.label}`,
    `נוצר: ${input.exportedAt}`,
    "",
    "זה הגיבוי של המערכת: כל מה שנשמר על המחזור הזה, כפי שהיה ברגע הייצוא.",
    "",
    "הקבצים:",
    "- edition.json: המחזור, ההגדרות, שורות הרשת, החדרים, הקטגוריות, שמות הצוות (בלי מיילים), שמות החניכים, השיעורים, הפניות, ההצעות, הזמינות, יומן הפעולות, הערות הידע, אבני הדרך והייצואים למעצבת.",
    "- speakers.json: המרצים שהמחזור נגע בהם (בלי פרטי קשר).",
    "- tracking.xlsx: טבלת המעקב (בלי טלפונים).",
    personal
      ? `- ${PERSONAL_FILE}: מידע אישי — פרטי הקשר של המרצים ופרטי ההסעה (כתובות איסוף, נהגים).`
      : "- אין בקובץ הזה פרטי קשר או פרטי הסעה: מי שייצא/ה לא רשאי/ת לראות אותם.",
    "",
    personal
      ? "שימו לב: הארכיון כולל מידע אישי. שומרים אותו במקום מוגן, לא משתפים ולא מעלים אותו לשום מקום, ומוחקים עותקים ישנים."
      : "שימו לב: גם בלי פרטי קשר, הארכיון כולל שמות של מרצים, חניכים וצוות. שומרים אותו במקום מוגן.",
    "",
  ].join("\r\n");
}

/** The archive's files, by name (a test reads them; archiveZip zips them). */
export function archiveFiles(input: ArchiveInput): Record<string, Uint8Array> {
  const { week, extras } = input;
  const touched = new Set(touchedSpeakers(week));
  const speakers = week.speakers.filter((s) => touched.has(s.id));
  const json = (v: unknown) => strToU8(JSON.stringify(v, null, 2));
  const edition = {
    format: ARCHIVE_FORMAT,
    format_version: 1,
    schema_version: input.schemaVersion,
    exported_at: input.exportedAt,
    edition: week.edition,
    rows: week.rows,
    rooms: week.rooms,
    categories: week.categories,
    team: week.team.map(({ id, display_name, gender, role }) => ({ id, display_name, gender, role })),
    roster: week.roster.map(({ id, full_name, gender }) => ({ id, full_name, gender })),
    lessons: week.lessons,
    lesson_speakers: week.lessonSpeakers,
    approaches: week.approaches,
    pitches: week.pitches,
    availability: week.availability,
    activity: extras.activity,
    notes: extras.notes,
    milestones: extras.milestones,
    export_snapshots: extras.snapshots,
  };
  const files: Record<string, Uint8Array> = {
    "edition.json": json(edition),
    "speakers.json": json({ format: ARCHIVE_FORMAT, exported_at: input.exportedAt, speakers }),
    "tracking.xlsx": toXlsx([trackingTable(trackingRows(week), week.edition.label)], new Date(input.exportedAt)),
  };
  const contacts = extras.contacts.filter((c) => c.phone || c.email || c.secretary_note || c.notes);
  const transport = extras.transport.filter((t) => t.pickup_address || t.pickup_time || t.driver_name || t.driver_phone || t.arranged);
  const personal = contacts.length > 0 || transport.length > 0;
  if (personal) {
    const name = new Map(week.speakers.map((s) => [s.id, displayName(s)]));
    files[PERSONAL_FILE] = json({
      warning: "מידע אישי: פרטי קשר של מרצים ופרטי הסעה. לשמור במקום מוגן, לא לשתף ולא להעלות לשום מקום.",
      format: ARCHIVE_FORMAT,
      exported_at: input.exportedAt,
      edition: { id: week.edition.id, label: week.edition.label },
      speaker_contacts: contacts.map((c) => ({ speaker: name.get(c.speaker_id) ?? null, ...c })),
      transport_details: transport,
    });
  }
  files["README.txt"] = strToU8(readme(input, personal));
  return files;
}

export function archiveZip(input: ArchiveInput): Uint8Array {
  return zipSync(archiveFiles(input), { level: 6, mtime: new Date(input.exportedAt) });
}
