// The archive export (DESIGN «סיכונים»: the free plan has no backup — this is
// it): one zip, made in the browser and downloaded, never uploaded. Inside:
//   README.txt       what is in it, in Hebrew, and that it may hold personal data
//   edition.json     the edition — its settings, grid rows, rooms, categories,
//                    team names (no e-mail), roster names, lessons, approaches,
//                    pitches, availability, the escorts' ticks, the activity log,
//                    notes, milestones and the designer's export snapshots
//   speakers.json    the pool's records of the speakers the edition touched
//                    (no contact detail)
//   kk.json          מכריכה לכריכה: tracks, groups, leaders and sign-ups (with the
//                    trainees' names), the book orders (5ב-2)
//   memorial.json    the edition's memorial plans and the fallen the caller reads
//                    (an admin: the whole cross-year list) — never a contact (5ב-2)
//   sources.json     the sources' files: what each is, whose, where in the zip
//   sources/<day>/   the files themselves — only when «כולל קבצי המקורות» was
//                    asked for; a file that could not be read is listed in
//                    sources.json and README.txt, not silently left out
//   tracking.xlsx    the tracking table, without phones
//   PERSONAL-DATA_contacts_and_transport.json — only when the caller's RLS
//                    showed any (a global admin): the speakers' contacts, the
//                    lessons' transport details and the families' contact persons
//                    of the fallen this edition has a plan for — never another
//                    year's family (admins only — so only here), apart, named so
//                    nobody mistakes it.
import { strToU8, zipSync } from "fflate";
import type { KkData } from "../data/kk";
import type { Fallen, FallenContacts } from "../data/memorial";
import type { ArchiveExtras } from "../data/outputs";
import { fallenName } from "../domain/memorial";
import { displayName } from "../domain/names";
import { DAY_NAMES, fmt } from "../domain/time";
import type { SourceFile, Week } from "../domain/types";
import { PERSONAL_FILE } from "./download";
import { speakersOf } from "./logistics";
import { trackingRows, trackingTable } from "./tracking";
import { toXlsx } from "./xlsx";

export const ARCHIVE_FORMAT = "volozhin-week-archive";
export { PERSONAL_FILE };

/** What the archive reads beyond the Week and the outputs' extras (5ב-2). */
export interface ArchiveMore {
  /** מכריכה לכריכה (load_kk); null: not read. */
  kk: KkData | null;
  /** The fallen the caller reads — an admin: the whole cross-year list. */
  fallen: Fallen[];
  /** The families' contact persons the caller may see, of the fallen this edition has a plan for (plannedFallen) — personal data. */
  fallenContacts: (FallenContacts & { fallen_id: number })[];
  /** «כולל קבצי המקורות»: the files' bytes by id, and those that could not be read. null: not asked for. */
  sources: { bytes: ReadonlyMap<number, Uint8Array>; skipped: { id: number; name: string }[] } | null;
}

export const NO_MORE: ArchiveMore = { kk: null, fallen: [], fallenContacts: [], sources: null };

/**
 * The fallen this edition has a plan for (placed or in the tray), in id order: the only families whose contact person
 * an edition's archive holds — as its speakers' contacts are only the speakers it touched. The cross-year list of the
 * fallen goes in memorial.json as names, never a contact.
 */
export function plannedFallen(week: Pick<Week, "memorialPlans">): number[] {
  return [...new Set((week.memorialPlans ?? []).map((p) => p.fallen_id))].sort((a, b) => a - b);
}

export interface ArchiveInput {
  week: Week;
  extras: ArchiveExtras;
  /** What 5ב-2 adds; absent: none of it (an older caller). */
  more?: ArchiveMore;
  schemaVersion: number;
  /** ISO time of the export. */
  exportedAt: string;
}

/** The sources' total size and count — what «כולל קבצי המקורות» will fetch, said before it starts. */
export function sourcesSize(week: Pick<Week, "sourceFiles">): { count: number; bytes: number } {
  const files = week.sourceFiles ?? [];
  return { count: files.length, bytes: files.reduce((a, f) => a + f.size_bytes, 0) };
}

/** A file's name as a zip entry may carry it: no folder separators or characters a file system refuses; at most 80 characters. */
export function safeEntryName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^[._\s]+|[.\s]+$/g, "").trim();
  return [...(clean || "file")].slice(-80).join("");
}

/**
 * Where a file goes in the zip: sources/<day>/<time>_<id>_<name>. A memorial file goes where its plan is placed now;
 * the poster to sources/שער; a file whose lesson is gone (or a plan in the tray) to sources/בלי-שיבוץ.
 */
export function sourcePath(week: Pick<Week, "lessons" | "memorialPlans">, f: SourceFile): string {
  const name = `${f.id}_${safeEntryName(f.display_name)}`;
  if (f.cover) return `sources/שער/${name}`;
  const placed = f.fallen_id != null ? (week.memorialPlans ?? []).find((p) => p.fallen_id === f.fallen_id)?.lesson_id : undefined;
  const lessonId = f.fallen_id != null ? (placed ?? null) : f.lesson_id;
  const l = lessonId == null ? undefined : week.lessons.find((x) => x.id === lessonId);
  if (!l) return `sources/בלי-שיבוץ/${name}`;
  return `sources/${l.day + 1}-${DAY_NAMES[l.day]}/${fmt(l.start_min).replace(":", "")}_${name}`;
}

/** The speakers an edition touched: approached, pitched or teaching. */
export function touchedSpeakers(week: Week): number[] {
  const ids = new Set<number>();
  for (const a of week.approaches) ids.add(a.speaker_id);
  for (const x of week.lessonSpeakers) ids.add(x.speaker_id);
  return [...ids].sort((a, b) => a - b);
}

function readme(input: ArchiveInput, more: ArchiveMore, personal: boolean): string {
  const e = input.week.edition;
  const skipped = more.sources?.skipped ?? [];
  return [
    `ייצוא ארכיון · שבוע וולוז'ין · ${e.label}`,
    `נוצר: ${input.exportedAt}`,
    "",
    "זה הגיבוי של המערכת: כל מה שנשמר על המחזור הזה, כפי שהיה ברגע הייצוא.",
    "",
    "הקבצים:",
    "- edition.json: המחזור, ההגדרות, שורות הרשת, החדרים, הקטגוריות, שמות הצוות (בלי מיילים), שמות החניכים, השיעורים, הפניות, ההצעות, הזמינות, הסימונים של המלווים, יומן הפעולות, הערות הידע, אבני הדרך והייצואים למעצבת.",
    "- speakers.json: המרצים שהמחזור נגע בהם (בלי פרטי קשר).",
    more.kk ? "- kk.json: מכריכה לכריכה — המשבצות, הקבוצות והספרים, המובילים, ההרשמות (עם שמות החניכים) והזמנות הספרים." : "- מכריכה לכריכה לא נקרא בייצוא הזה.",
    "- memorial.json: תוכניות זמני הזיכרון של המחזור ורשימת החללים של כל השנים (בלי פרטי קשר).",
    "- sources.json: רשימת קבצי המקורות — מה כל קובץ, של איזה שיעור, ואיפה הוא בזיפ.",
    more.sources
      ? `- sources/: קבצי המקורות עצמם, בתיקייה לכל יום.${skipped.length ? ` ${skipped.length} קבצים לא נקראו ולא נכללו: ${skipped.map((x) => x.name).join(", ")}.` : ""}`
      : "- קבצי המקורות עצמם לא נכללו (אפשר לבחור «כולל קבצי המקורות»).",
    "- tracking.xlsx: טבלת המעקב (בלי טלפונים).",
    personal
      ? `- ${PERSONAL_FILE}: מידע אישי — פרטי הקשר של המרצים, פרטי ההסעה (כתובות איסוף, נהגים) ואנשי הקשר של המשפחות של החללים שיש להם תוכנית במחזור הזה (לא של שנים אחרות).`
      : "- אין בקובץ הזה פרטי קשר או פרטי הסעה: מי שייצא/ה לא רשאי/ת לראות אותם.",
    "",
    personal
      ? "שימו לב: הארכיון כולל מידע אישי, גם של משפחות שכולות. שומרים אותו במקום מוגן, לא משתפים ולא מעלים אותו לשום מקום, ומוחקים עותקים ישנים."
      : "שימו לב: גם בלי פרטי קשר, הארכיון כולל שמות של מרצים, חניכים וצוות. שומרים אותו במקום מוגן.",
    "",
  ].join("\r\n");
}

/** The archive's files, by name (a test reads them; archiveZip zips them). */
export function archiveFiles(input: ArchiveInput): Record<string, Uint8Array> {
  const { week, extras } = input;
  const more = input.more ?? NO_MORE;
  const touched = new Set(touchedSpeakers(week));
  const speakers = week.speakers.filter((s) => touched.has(s.id));
  const json = (v: unknown) => strToU8(JSON.stringify(v, null, 2));
  const rosterName = new Map(week.roster.map((r) => [r.id, r.full_name]));
  const edition = {
    format: ARCHIVE_FORMAT,
    format_version: 2,
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
    escort_ticks: week.escortTicks ?? [],
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
  if (more.kk) {
    const kk = more.kk;
    files["kk.json"] = json({
      format: ARCHIVE_FORMAT,
      exported_at: input.exportedAt,
      window: week.edition.settings?.kk_window ?? null,
      tracks: kk.tracks,
      groups: kk.groups,
      leaders: kk.leaders.map((x) => ({ ...x, name: x.roster_id != null ? (rosterName.get(x.roster_id) ?? null) : x.label })),
      signups: kk.signups.map((x) => ({ ...x, name: rosterName.get(x.roster_id) ?? null })),
      book_orders: kk.orders,
    });
  }
  files["memorial.json"] = json({
    format: ARCHIVE_FORMAT,
    exported_at: input.exportedAt,
    policy: week.edition.settings?.memorial ?? null,
    plans: (week.memorialPlans ?? []).map((p) => ({ ...p, fallen: fallenName({ fallen: more.fallen.length ? more.fallen : week.fallen }, p.fallen_id) })),
    fallen: (more.fallen.length ? more.fallen : (week.fallen ?? []).map((f) => ({ ...f, note: null, active: true }))).map(({ id, name, gender, note, active }) => ({ id, name, gender, note, active })),
  });
  const included = more.sources?.bytes;
  const skipped = new Set((more.sources?.skipped ?? []).map((x) => x.id));
  const lessonTitle = new Map(week.lessons.map((l) => [l.id, l.title]));
  files["sources.json"] = json({
    format: ARCHIVE_FORMAT,
    exported_at: input.exportedAt,
    files_included: more.sources != null,
    files: (week.sourceFiles ?? []).map((f) => ({
      ...f,
      lesson_title: f.lesson_id != null ? (lessonTitle.get(f.lesson_id) ?? null) : null,
      speakers: f.lesson_id != null ? speakersOf(week, f.lesson_id) || null : null,
      fallen: f.fallen_id != null ? fallenName(week, f.fallen_id) : null,
      in_zip: included?.has(f.id) ? sourcePath(week, f) : null,
      not_read: skipped.has(f.id),
    })),
  });
  if (included) {
    for (const f of week.sourceFiles ?? []) {
      const b = included.get(f.id);
      if (b) files[sourcePath(week, f)] = b;
    }
  }
  const contacts = extras.contacts.filter((c) => c.phone || c.email || c.secretary_note || c.notes);
  const transport = extras.transport.filter((t) => t.pickup_address || t.pickup_time || t.driver_name || t.driver_phone || t.arranged);
  const planned = new Set(plannedFallen(week));
  const families = more.fallenContacts.filter((c) => planned.has(c.fallen_id) && (c.contact_name || c.relation || c.phone || c.email || c.note));
  const personal = contacts.length > 0 || transport.length > 0 || families.length > 0;
  if (personal) {
    const name = new Map(week.speakers.map((s) => [s.id, displayName(s)]));
    const fallen = new Map(more.fallen.map((f) => [f.id, f.name]));
    files[PERSONAL_FILE] = json({
      warning: "מידע אישי: פרטי קשר של מרצים, פרטי הסעה ואנשי הקשר של משפחות שכולות. לשמור במקום מוגן, לא לשתף ולא להעלות לשום מקום.",
      format: ARCHIVE_FORMAT,
      exported_at: input.exportedAt,
      edition: { id: week.edition.id, label: week.edition.label },
      speaker_contacts: contacts.map((c) => ({ speaker: name.get(c.speaker_id) ?? null, ...c })),
      transport_details: transport,
      family_contacts: families.map((c) => ({ fallen: fallen.get(c.fallen_id) ?? null, ...c })),
    });
  }
  files["README.txt"] = strToU8(readme(input, more, personal));
  return files;
}

/** The zip: the sources' bytes stored as they are (PDFs and pictures are compressed already), the rest deflated. */
export function archiveZip(input: ArchiveInput): Uint8Array {
  const files = archiveFiles(input);
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  for (const [name, bytes] of Object.entries(files)) entries[name] = name.startsWith("sources/") ? [bytes, { level: 0 }] : bytes;
  return zipSync(entries, { level: 6, mtime: new Date(input.exportedAt) });
}
