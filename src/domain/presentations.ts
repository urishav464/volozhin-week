// «מצגות» (/presentations, the reset, phase 5) — pure. The hall's computer is not signed in (DECISIONS «הריסט, שלב 5»,
// decision 1): every morning someone of the team downloads the day's presentations in one zip and copies it there on a
// USB stick. So this is what the team's page reads off a loaded Week: each closed lesson's and memorial slot's row of the
// day — its files (the current lead speaker's presentations), its link (`presentation_url`) and its state —, the week's
// own decks (the cover path, `lesson_id` null), the presentations left without a lesson (for removal), and the day's zip
// plan: the entries' names in the day's order, `סדר-היום.txt` and `links.txt`. A presentation is a source_files row of
// kind `presentation` (v19): never in the reader, the manifest or the prints. Nothing here reads anything but the Week.
import { fromPreviousSpeaker, isPresentation, parseSourcePath } from "../data/sourceRules";
import { scheduleEntries } from "../exports/designer";
import { safeEntryName, storedFileName } from "../exports/download";
import { addDays, daysToWeek, israelDate, israelLocal } from "./israelTime";
import { type Day, DAY_NAMES, fmt, fmtRange } from "./time";
import type { Lesson, SourceFile, Week } from "./types";

/** What a row has for the room: a file, a link only, one expected and not there yet, none, or a memorial time (never one). */
export type PresentationState = "file" | "link" | "missing" | "none" | "memorial";

export const PRESENTATION_STATE_LABEL: Record<PresentationState, string> = {
  file: "מצגת",
  link: "קישור למצגת",
  missing: "מצגת צפויה — עוד לא הועלתה",
  none: "בלי מצגת",
  memorial: "זמן זיכרון",
};

/** One row of a day: a closed lesson or a memorial slot, as the public schedule has it (scheduleEntries' order). */
export interface PresentationRow {
  lessonId: number;
  kind: "lesson" | "memorial";
  day: Day;
  /** The teaching time (a memorial slot: the whole slot) — the schedule's. */
  start_min: number;
  end_min: number;
  roomId: number;
  room: string;
  /** The names as printed, the lead first; "" for a memorial time (never a name). */
  speaker: string;
  /** The designer's title: «TBD» while none; «זמן זיכרון» for a memorial time, whatever its title says. */
  title: string;
  /** The current lead speaker's presentations, by id. */
  files: SourceFile[];
  /** `presentation_url`, http(s) only. */
  link: string | null;
  state: PresentationState;
}

const httpLink = (v: string | null | undefined): string | null => {
  const s = v?.trim();
  return s && /^https?:\/\//i.test(s) ? s : null;
};

const presentations = (week: Pick<Week, "sourceFiles">): SourceFile[] => (week.sourceFiles ?? []).filter(isPresentation).sort((a, b) => a.id - b.id);

/**
 * A lesson's presentations as the lesson page shows them: the current lead speaker's (`files`), a previous speaker's
 * (`previous` — «מהמרצה הקודם», for removal), its link and its state. A lesson that is not closed has no current files.
 */
export function lessonPresentations(week: Pick<Week, "sourceFiles" | "lessonSpeakers">, l: Lesson): { files: SourceFile[]; previous: SourceFile[]; link: string | null; state: PresentationState } {
  if (l.kind === "memorial") return { files: [], previous: [], link: null, state: "memorial" };
  const lead = l.state === "closed" ? (week.lessonSpeakers.find((x) => x.lesson_id === l.id && x.role === "lead")?.speaker_id ?? null) : null;
  const own = presentations(week).filter((f) => f.lesson_id === l.id);
  const files = own.filter((f) => !fromPreviousSpeaker(f, lead));
  const previous = own.filter((f) => fromPreviousSpeaker(f, lead));
  const link = httpLink(l.presentation_url);
  const state: PresentationState =
    files.length > 0 ? "file" : link ? "link" : l.sources_kind === "presentation" || l.sources_kind === "sheet_presentation" ? "missing" : "none";
  return { files, previous, link, state };
}

/** Every closed lesson and memorial slot of the week, in the schedule's order (day, time, the room's place, id). */
export function presentationRows(week: Week): PresentationRow[] {
  const lessons = new Map(week.lessons.map((l) => [l.id, l]));
  return scheduleEntries(week).map((e) => {
    const l = lessons.get(e.lesson_id)!;
    const memorial = e.kind === "memorial";
    const p = lessonPresentations(week, l);
    return {
      lessonId: l.id,
      kind: e.kind,
      day: e.day,
      start_min: e.start_min,
      end_min: e.end_min,
      roomId: l.room_id,
      room: e.room,
      speaker: memorial ? "" : e.speaker,
      title: memorial ? PRESENTATION_STATE_LABEL.memorial : (e.title ?? "TBD"),
      files: p.files,
      link: memorial ? null : p.link,
      state: p.state,
    };
  });
}

/** The week's own presentations: kind presentation on the cover path (`<edition>/cover/…`, `lesson_id` null), by id. */
export function weekPresentations(week: Pick<Week, "sourceFiles">): SourceFile[] {
  return presentations(week).filter((f) => f.lesson_id == null && parseSourcePath(f.storage_path)?.lesson === null);
}

/** Why a presentation has no row: a previous speaker's, its lesson no longer closed (reopened or cancelled), or gone. */
export type OrphanReason = "previous" | "draft" | "cancelled" | "gone";

export const ORPHAN_LABEL: Record<OrphanReason, string> = {
  previous: "מהמרצה הקודם",
  draft: "השיעור נפתח מחדש",
  cancelled: "השיעור בוטל",
  gone: "השיעור נמחק",
};

/**
 * The presentations on a lesson's path that no row shows — its lesson gone (deleted: `lesson_id` null), not closed, or
 * closed for another lead speaker now — with the lesson (when there is one) and why. Listed for removal only; the
 * reader's «קבצים בלי שיעור» never lists a presentation (it drops them first).
 */
export function orphanPresentations(week: Week): { file: SourceFile; lesson: Lesson | null; reason: OrphanReason }[] {
  const shown = new Set([...weekPresentations(week), ...presentationRows(week).flatMap((r) => r.files)].map((f) => f.id));
  const lessons = new Map(week.lessons.map((l) => [l.id, l]));
  return presentations(week)
    .filter((f) => !shown.has(f.id))
    .map((file) => {
      const lesson = file.lesson_id == null ? null : (lessons.get(file.lesson_id) ?? null);
      const reason: OrphanReason = !lesson ? "gone" : lesson.state === "cancelled" ? "cancelled" : lesson.state === "draft" ? "draft" : lesson.kind === "lesson" ? "previous" : "gone";
      return { file, lesson, reason };
    });
}

// ------------------------------------------------------------------ the day's zip

/** The day's zip is built in the browser's memory: above this the files are downloaded one by one from the list. */
export const PRESENTATION_ZIP_MAX = 250 * 1024 * 1024;

/** The page reads the week again this often while its tab is visible: source_files is not in Realtime. */
export const PRESENTATIONS_POLL_MS = 120_000;

export const ORDER_FILE = "סדר-היום.txt";
export const LINKS_FILE = "links.txt";

export interface ZipEntry {
  name: string;
  file: SourceFile;
}

export interface ZipText {
  name: string;
  text: string;
}

export interface DayZipPlan {
  /** The week's decks first (`0000_השבוע_…`), then the day's files by time and room. */
  entries: ZipEntry[];
  /** The entries' bytes as the rows say (size_bytes). */
  bytes: number;
  /** `סדר-היום.txt` always, `links.txt` when a row has a link and no file: UTF-8 with a BOM, CRLF. */
  texts: ZipText[];
}

/** «0830», and a night item after midnight «2430» (its hour 24–29), so the names sort in the day's order. */
export function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}${String(min % 60).padStart(2, "0")}`;
}

/** A name another entry already has (as a file system that ignores case compares them) gets `_<id>` before its extension. */
function uniqueName(name: string, id: number, used: Set<string>): string {
  let out = name;
  if (used.has(out.toLowerCase())) {
    const m = /(\.[A-Za-z0-9]{1,5})$/.exec(name);
    out = m ? `${name.slice(0, -m[1].length)}_${id}${m[1]}` : `${name}_${id}`;
  }
  used.add(out.toLowerCase());
  return out;
}

/** The day's rows, all rooms or one. */
export function dayRows(rows: PresentationRow[], day: Day, roomId: number | null): PresentationRow[] {
  return rows.filter((r) => r.day === day && (roomId == null || r.roomId === roomId));
}

/** «15.2.2027», or TBD while the week's date is not set. */
function dateText(startDate: string | null, day: Day): string {
  if (!startDate) return "TBD";
  const [y, m, d] = addDays(startDate, day).split("-").map(Number);
  return `${d}.${m}.${y}`;
}

const BOM = "﻿";
const text = (lines: string[]) => BOM + lines.join("\r\n") + "\r\n";

/**
 * The day's zip: what goes in and under which names, and its two text files. `failed`: files the download could not
 * fetch — the order says so beside their names (they are not in the zip). The room is the chip chosen (null: all).
 */
export function dayZipPlan(week: Week, day: Day, roomId: number | null, failed: ReadonlySet<number> = new Set()): DayZipPlan {
  const used = new Set<string>();
  // each name ends in the STORED file's extension (its path's, tied to its type), never the one its display name types
  const fileName = (file: SourceFile) => storedFileName(file.display_name, parseSourcePath(file.storage_path)?.ext);
  const decks = weekPresentations(week).map((file) => ({ name: uniqueName(`0000_השבוע_${fileName(file)}`, file.id, used), file }));
  const rows = dayRows(presentationRows(week), day, roomId);
  const byRow = new Map<number, ZipEntry[]>();
  for (const r of rows) {
    if (r.state !== "file") continue;
    byRow.set(
      r.lessonId,
      r.files.map((file) => ({ name: uniqueName(`${hhmm(r.start_min)}_${safeEntryName(r.room || "חדר")}_${fileName(file)}`, file.id, used), file })),
    );
  }
  const entries = [...decks, ...rows.flatMap((r) => byRow.get(r.lessonId) ?? [])];
  const named = (e: ZipEntry) => (failed.has(e.file.id) ? `${e.name} (לא ירדה — מורידים מדף המצגות)` : e.name);

  const room = roomId == null ? null : (week.rooms.find((x) => x.id === roomId)?.name ?? null);
  const head = [`יום ${DAY_NAMES[day]}`, dateText(week.edition.start_date, day), week.edition.label, ...(room ? [room] : [])].join(" · ");
  const order: string[] = [`סדר היום — ${head}`];
  if (decks.length > 0) order.push(`המצגת של השבוע — ${decks.map(named).join(" / ")}`);
  order.push("");
  for (const r of rows) {
    const time = fmtRange(r.start_min, r.end_min);
    if (r.kind === "memorial") {
      order.push([time, r.room, PRESENTATION_STATE_LABEL.memorial].filter(Boolean).join(" · "));
      continue;
    }
    const what =
      r.state === "file"
        ? [...(byRow.get(r.lessonId) ?? []).map(named), ...(r.link ? [`קישור: ${r.link}`] : [])].join(" / ")
        : r.state === "link"
          ? `קישור: ${r.link}`
          : PRESENTATION_STATE_LABEL[r.state];
    order.push(`${[time, r.room, r.speaker, r.title].filter(Boolean).join(" · ")} — ${what}`);
  }
  if (rows.length === 0) order.push("אין שיעורים סגורים ביום הזה.");
  const texts: ZipText[] = [{ name: ORDER_FILE, text: text(order) }];
  const linkOnly = rows.filter((r) => r.state === "link");
  if (linkOnly.length > 0) {
    texts.push({ name: LINKS_FILE, text: text([`קישורים למצגות — ${head}`, "", ...linkOnly.map((r) => [fmt(r.start_min), r.speaker, r.link].filter(Boolean).join(" · "))]) });
  }
  return { entries, bytes: entries.reduce((n, e) => n + e.file.size_bytes, 0), texts };
}

/** «כ-12 MB», «כ-0.6 MB». */
export function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `כ-${mb >= 10 ? Math.round(mb) : Math.max(0.1, Math.round(mb * 10) / 10)} MB`;
}

/** «3 מצגות · כ-1.2 MB», «מצגת אחת · כ-0.6 MB». */
export function zipLine(plan: Pick<DayZipPlan, "entries" | "bytes">): string {
  const n = plan.entries.length;
  if (n === 0) return "עוד אין מצגות ליום הזה — בקובץ רק סדר היום";
  return `${n === 1 ? "מצגת אחת" : `${n} מצגות`} · ${megabytes(plan.bytes)}`;
}

/** The day the page opens on: Israel's date today, when it is one of the five; else the first. */
export function presentationsDay(startDate: string | null, nowIso: string): Day {
  const d = daysToWeek(startDate, nowIso);
  return d != null && d <= 0 && d >= -4 ? ((0 - d) as Day) : 0;
}

// ------------------------------------------------------------------ this device's memory

type Store = Pick<Storage, "getItem" | "setItem"> | null | undefined;

/** The day's last zip on this device — localStorage, per edition and day. */
export function presentationsZipKey(editionId: number, day: Day): string {
  return `volozhin-presentations-zip:${editionId}:${day}`;
}

/** The room chip chosen on this device, per edition. */
export function presentationsRoomKey(editionId: number): string {
  return `volozhin-presentations-room:${editionId}`;
}

/**
 * When this device downloaded the day's zip (`at`, its own clock — what the page says), the newest upload the week it
 * was planned from held (`upTo`, the server's clock — what «חדש מאז ההורדה» compares, so a device whose clock is off
 * marks nothing wrongly; null: there was no presentation yet) and the room it was for (null: all rooms).
 */
export interface ZipMarker {
  at: string;
  upTo: string | null;
  room: number | null;
}

const isTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

export function readZipMarker(store: Store, editionId: number, day: Day): ZipMarker | null {
  try {
    const raw = store?.getItem(presentationsZipKey(editionId, day));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ZipMarker> | null;
    if (!v || !isTime(v.at)) return null;
    return { at: v.at, upTo: isTime(v.upTo) ? v.upTo : null, room: typeof v.room === "number" && Number.isInteger(v.room) && v.room > 0 ? v.room : null };
  } catch {
    return null; // a private window, blocked storage, a value someone edited: no marker
  }
}

export function writeZipMarker(store: Store, editionId: number, day: Day, m: ZipMarker): void {
  try {
    store?.setItem(presentationsZipKey(editionId, day), JSON.stringify(m));
  } catch {
    // not kept: the page only forgets the mark
  }
}

/** The room chip this device chose (null: all rooms, or nothing kept). */
export function readRoom(store: Store, editionId: number): number | null {
  try {
    const n = Number(store?.getItem(presentationsRoomKey(editionId)));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeRoom(store: Store, editionId: number, room: number | null): void {
  try {
    store?.setItem(presentationsRoomKey(editionId), room == null ? "all" : String(room));
  } catch {
    // not kept
  }
}

/** The newest upload among the files — the marker's `upTo`. */
export function newestUpload(files: readonly Pick<SourceFile, "uploaded_at">[]): string | null {
  let best: string | null = null;
  for (const f of files) if (isTime(f.uploaded_at) && (best == null || Date.parse(f.uploaded_at) > Date.parse(best))) best = f.uploaded_at;
  return best;
}

/**
 * The files uploaded after the zip this device downloaded was planned: empty without a marker; every file when the
 * week held no presentation then. The caller passes the files the zip was for (its room's, and the week's decks).
 */
export function newSinceDownload(files: readonly Pick<SourceFile, "id" | "uploaded_at">[], marker: ZipMarker | null): Set<number> {
  if (!marker) return new Set();
  const upTo = marker.upTo == null ? -Infinity : Date.parse(marker.upTo);
  return new Set(files.filter((f) => Date.parse(f.uploaded_at) > upTo).map((f) => f.id));
}

/** «14:05» when the marker is today's in Israel, else «20.11, 14:05». */
export function markerTime(at: string, nowIso: string): string {
  const local = israelLocal(at);
  const hm = local.slice(11);
  if (israelDate(at) === israelDate(nowIso)) return hm;
  const [, m, d] = local.slice(0, 10).split("-").map(Number);
  return `${d}.${m}, ${hm}`;
}
