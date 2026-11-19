// v19: the guests' schedule — what public.schedule_view gives the schedule link (/s#token), built from a loaded Week
// (the engine's twin; tests/parity holds the two equal). Three parts:
//   rows    the public schedule's facts (scheduleEntries, the designer's export — its ten keys unchanged) and, for a
//           lesson, its `public_note` and the indexes of its speakers in `people` (a memorial time: no note, no people);
//   people  the speakers a guest may see — only those whose approach in THIS edition has `public_ok` — each once, in the
//           order they first appear (the rows' grid order; in a lesson the lead first, then by speaker id): the name as
//           printed, the description for guests, the photo as a data URL;
//   fixed   the grid's fixed rows (meals, prayers, «מכריכה לכריכה») on each day they are in play there (rowActive — what
//           the grid itself shows): a label and the times, never a person.
// A co-speaker without an approval stays in the row's `speaker` string (as on the poster) and out of `people`.
import { displayName } from "../domain/names";
import { photoDataUrl } from "../domain/photo";
import type { Day } from "../domain/time";
import type { Week } from "../domain/types";
import type { FixedRow, GuestSchedule, PublicPerson } from "../data/publicPort";
import { rowActive } from "../grid/layout";
import { scheduleEntries } from "./designer";

const DAYS: readonly Day[] = [0, 1, 2, 3, 4];

/** Byte order of the labels, as `collate "C"` compares them (UTF-16 order equals it outside the surrogates). */
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The fixed rows of the week, by day, start, end and label. */
export function fixedRows(week: Pick<Week, "rows" | "edition">): FixedRow[] {
  const out: FixedRow[] = [];
  for (const r of week.rows) {
    if (r.kind !== "fixed" && r.kind !== "kk") continue;
    for (const day of DAYS) if (rowActive(r, day, week.edition)) out.push({ day, start_min: r.start_min, end_min: r.end_min, label: r.label });
  }
  return out.sort((a, b) => a.day - b.day || a.start_min - b.start_min || a.end_min - b.end_min || byCode(a.label, b.label));
}

/**
 * The guests' schedule of a loaded Week. `photoOf` gives a speaker's stored photo as base64 (or null) — the engine's
 * speaker_photos; it is asked only for a speaker the view shows.
 */
export function publicSchedule(week: Week, photoOf: (speakerId: number) => string | null): GuestSchedule {
  const e = week.edition;
  const speakers = new Map(week.speakers.map((s) => [s.id, s]));
  const lessons = new Map(week.lessons.map((l) => [l.id, l]));
  const shown = new Set(week.approaches.filter((a) => a.public_ok === true).map((a) => a.speaker_id));
  const people: PublicPerson[] = [];
  const index = new Map<number, number>();
  const rows: GuestSchedule["rows"] = scheduleEntries(week).map(({ lesson_id, ...entry }) => {
    if (entry.kind === "memorial") return { ...entry, note: null, people: [] };
    const ids = week.lessonSpeakers
      .filter((x) => x.lesson_id === lesson_id && shown.has(x.speaker_id) && speakers.has(x.speaker_id))
      .sort((a, b) => Number(a.role !== "lead") - Number(b.role !== "lead") || a.speaker_id - b.speaker_id)
      .map((x) => x.speaker_id);
    const mine: number[] = [];
    for (const id of ids) {
      let k = index.get(id);
      if (k == null) {
        const s = speakers.get(id)!;
        const photo = photoOf(id);
        k = people.length;
        people.push({ label: displayName(s), bio: s.public_bio ?? null, photo: photo == null ? null : photoDataUrl(photo) });
        index.set(id, k);
      }
      if (!mine.includes(k)) mine.push(k);
    }
    return { ...entry, note: lessons.get(lesson_id)?.public_note ?? null, people: mine };
  });
  return { edition: { label: e.label, start_date: e.start_date }, rows, people, fixed: fixedRows(week) };
}
