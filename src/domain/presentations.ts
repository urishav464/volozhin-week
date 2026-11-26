// «מצגות» (/presentations) — pure. The hall's computer is not signed in (DECISIONS «הריסט, שלב 5», decision 1): someone of
// the team downloads the week's presentations in ONE zip (v20, «הורדת כל המצגות של השבוע») and copies it there on a USB
// stick — the week's decks once in «0-השבוע/», then a folder per day, «1-ראשון/» … «5-חמישי/», each with its files, its
// `סדר-היום.txt` and (when a lesson has a link only) `links.txt`. The lesson's escort opens the file in the hall: their
// page says the folder and the name's start (src/domain/presentationNames.ts `entryPrefix`, the function every entry is
// named by). So this is what the team's page reads off a loaded Week: each closed lesson's and memorial slot's row — its
// files (the current lead speaker's presentations), its link (`presentation_url`) and its state —, the week's own decks
// (the cover path, `lesson_id` null), the presentations left without a lesson (for removal), the week's zip plan and the
// one map of every file to its path in it (`presentationEntries`: the zip, «עלו מאז ההורדה» and the lesson page read
// it), and this device's memory of its last download. A presentation is a source_files row of kind `presentation`
// (v19): never in the reader, the manifest or the prints. Nothing here reads anything but the Week.
import { fromPreviousSpeaker, isPresentation, parseSourcePath } from "../data/sourceRules";
import { scheduleEntries } from "../exports/designer";
import { storedFileName } from "../exports/download";
import { addDays, israelDate, israelLocal } from "./israelTime";
import { dayFolder, entryPrefix, LINKS_FILE, ORDER_FILE, splitEntry, WEEK_FOLDER } from "./presentationNames";
import { type Day, DAY_NAMES, DAYS, fmt, fmtRange, nightLabel } from "./time";
import type { Lesson, SourceFile, Week } from "./types";

export { dayFolder, entryPrefix, hhmm, LINKS_FILE, ORDER_FILE, splitEntry, WEEK_FOLDER } from "./presentationNames";

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

// ------------------------------------------------------------------ the week's zip

/**
 * The zip is built in the browser's memory: above this the week is downloaded a part at a time — the week's decks, then
 * each day (`decksZipPlan`, `dayZipPlan`: the same paths, so the parts unzipped side by side are the week's zip).
 */
export const PRESENTATION_ZIP_MAX = 250 * 1024 * 1024;

/** The page reads the week again this often while its tab is visible: source_files is not in Realtime. */
export const PRESENTATIONS_POLL_MS = 120_000;

export interface ZipEntry {
  /** Its path in the zip: «0-השבוע/<name>» or «<n>-<day>/<HHMM>_<room>_<name>». */
  name: string;
  file: SourceFile;
}

export interface ZipText {
  name: string;
  text: string;
}

export interface ZipPlan {
  /** The week's decks first, then each day's files by time and room — every file once. */
  entries: ZipEntry[];
  /** The entries' bytes as the rows say (size_bytes). */
  bytes: number;
  /** Each day's `סדר-היום.txt` always, its `links.txt` when a row has a link and no file: UTF-8 with a BOM, CRLF. */
  texts: ZipText[];
}

/** A path another entry already has (as a file system that ignores case compares them) gets `_<id>` before its extension. */
function uniqueName(name: string, id: number, used: Set<string>): string {
  let out = name;
  if (used.has(out.toLowerCase())) {
    const m = /(\.[A-Za-z0-9]{1,5})$/.exec(name);
    out = m ? `${name.slice(0, -m[1].length)}_${id}${m[1]}` : `${name}_${id}`;
  }
  used.add(out.toLowerCase());
  return out;
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
 * The week's zip: what goes in and under which path, and each day's two text files. A lesson's files start with its
 * `entryPrefix` (a night lesson is in its day column's folder, the day before the calendar's); a name twice in one
 * folder gets its id. `failed`: files the download could not fetch — the day's order says so beside their names.
 */
export function weekZipPlan(week: Week, failed: ReadonlySet<number> = new Set()): ZipPlan {
  const used = new Set<string>();
  // each name ends in the STORED file's extension (its path's, tied to its type), never the one its display name types
  const fileName = (file: SourceFile) => storedFileName(file.display_name, parseSourcePath(file.storage_path)?.ext);
  const decks = weekPresentations(week).map((file) => ({ name: uniqueName(`${WEEK_FOLDER}/${fileName(file)}`, file.id, used), file }));
  const rows = presentationRows(week);
  const byRow = new Map<number, ZipEntry[]>();
  for (const r of rows) {
    if (r.state !== "file") continue;
    const prefix = entryPrefix(r.day, r.start_min, r.room);
    byRow.set(r.lessonId, r.files.map((file) => ({ name: uniqueName(`${prefix}${fileName(file)}`, file.id, used), file })));
  }
  const entries = [...decks, ...rows.flatMap((r) => byRow.get(r.lessonId) ?? [])];
  // in a day's order the files are named as in its folder; the week's decks with theirs
  const named = (e: ZipEntry, folder: boolean) => {
    const n = folder ? e.name : splitEntry(e.name).name;
    return failed.has(e.file.id) ? `${n} (לא ירדה — מורידים מדף המצגות)` : n;
  };

  const texts: ZipText[] = [];
  for (const day of DAYS) {
    const ofDay = rows.filter((r) => r.day === day);
    const head = [`יום ${DAY_NAMES[day]}`, dateText(week.edition.start_date, day), week.edition.label].join(" · ");
    const order: string[] = [`סדר היום — ${head}`];
    if (decks.length > 0) order.push(`המצגת של השבוע — ${decks.map((e) => named(e, true)).join(" / ")}`);
    order.push("");
    for (const r of ofDay) {
      const when = [fmtRange(r.start_min, r.end_min), nightLabel(r.day, r.start_min)];
      if (r.kind === "memorial") {
        order.push([...when, r.room, PRESENTATION_STATE_LABEL.memorial].filter(Boolean).join(" · "));
        continue;
      }
      const what =
        r.state === "file"
          ? [...(byRow.get(r.lessonId) ?? []).map((e) => named(e, false)), ...(r.link ? [`קישור: ${r.link}`] : [])].join(" / ")
          : r.state === "link"
            ? `קישור: ${r.link}`
            : PRESENTATION_STATE_LABEL[r.state];
      order.push(`${[...when, r.room, r.speaker, r.title].filter(Boolean).join(" · ")} — ${what}`);
    }
    if (ofDay.length === 0) order.push("אין שיעורים סגורים ביום הזה.");
    texts.push({ name: `${dayFolder(day)}/${ORDER_FILE}`, text: text(order) });
    const linkOnly = ofDay.filter((r) => r.state === "link");
    if (linkOnly.length > 0) {
      const lines = linkOnly.map((r) => [fmt(r.start_min), nightLabel(r.day, r.start_min), r.speaker, r.link].filter(Boolean).join(" · "));
      texts.push({ name: `${dayFolder(day)}/${LINKS_FILE}`, text: text([`קישורים למצגות — ${head}`, "", ...lines]) });
    }
  }
  return { entries, bytes: sumBytes(entries), texts };
}

const sumBytes = (entries: readonly ZipEntry[]) => entries.reduce((n, e) => n + e.file.size_bytes, 0);

/** One folder of the week's plan, under the same paths. */
function folderPlan(plan: ZipPlan, folder: string): ZipPlan {
  const inside = (name: string) => name.startsWith(`${folder}/`);
  const entries = plan.entries.filter((e) => inside(e.name));
  return { entries, bytes: sumBytes(entries), texts: plan.texts.filter((t) => inside(t.name)) };
}

/** A day's part of the week (its folder: files, order, links) — when the whole week is more than PRESENTATION_ZIP_MAX. */
export function dayZipPlan(week: Week, day: Day, failed: ReadonlySet<number> = new Set()): ZipPlan {
  return folderPlan(weekZipPlan(week, failed), dayFolder(day));
}

/** The week's decks alone («0-השבוע/») — the part before the days. */
export function decksZipPlan(week: Week): ZipPlan {
  return folderPlan(weekZipPlan(week), WEEK_FOLDER);
}

/** Every file of the week's zip → its path in it: the ONE naming the zip, «עלו מאז ההורדה» and the lesson page show. */
export function presentationEntries(week: Week): Map<number, string> {
  return new Map(weekZipPlan(week).entries.map((e) => [e.file.id, e.name]));
}

/** «כ-12 MB», «כ-0.6 MB». */
export function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `כ-${mb >= 10 ? Math.round(mb) : Math.max(0.1, Math.round(mb * 10) / 10)} MB`;
}

/** «3 מצגות · כ-1.2 MB», «מצגת אחת · כ-0.6 MB»; none: what the file still holds (the week's, or a day's). */
export function zipLine(plan: Pick<ZipPlan, "entries" | "bytes">, scope: "week" | "day" = "week"): string {
  const n = plan.entries.length;
  if (n === 0) return scope === "week" ? "עוד אין מצגות — בקובץ רק סדר היום של כל יום" : "עוד אין מצגות ליום הזה — בקובץ רק סדר היום";
  return `${n === 1 ? "מצגת אחת" : `${n} מצגות`} · ${megabytes(plan.bytes)}`;
}

// ------------------------------------------------------------------ this device's memory

type Store = Pick<Storage, "getItem" | "setItem"> | null | undefined;

/** The week's last zip on this device — localStorage, per edition (v20; the per-day keys of before simply stay unread). */
export function presentationsZipKey(editionId: number): string {
  return `volozhin-presentations-zip:${editionId}:week`;
}

/**
 * When this device downloaded the week's zip (`at`, its own clock — what the page says) and what it held: each file's id
 * and a fingerprint of its path then (`names` — numbers only, never a name). A file of the week not in it was uploaded
 * after (or did not come); one whose path changed since is in another place on the hall's computer — a lesson moved, a
 * room renamed.
 */
export interface ZipMarker {
  at: string;
  names: Record<string, number>;
}

/** A path's fingerprint (FNV-1a, 32 bits): the marker compares paths without keeping them. */
export function nameFingerprint(path: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The marker of a download: the entries that came, at `at`. A part of the week (`prev` given) adds its files to what this
 * device already had; the whole week replaces it.
 */
export function zipMarker(at: string, came: readonly ZipEntry[], prev: ZipMarker | null = null): ZipMarker {
  const names: Record<string, number> = { ...(prev?.names ?? {}) };
  for (const e of came) names[String(e.file.id)] = nameFingerprint(e.name);
  return { at, names };
}

const isTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

export function readZipMarker(store: Store, editionId: number): ZipMarker | null {
  try {
    const raw = store?.getItem(presentationsZipKey(editionId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ZipMarker> | null;
    if (!v || !isTime(v.at) || typeof v.names !== "object" || v.names === null || Array.isArray(v.names)) return null;
    const names: Record<string, number> = {};
    for (const [id, h] of Object.entries(v.names)) {
      if (/^[1-9]\d{0,15}$/.test(id) && typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 0xffffffff) names[id] = h;
    }
    return { at: v.at, names };
  } catch {
    return null; // a private window, blocked storage, a value someone edited: no marker
  }
}

export function writeZipMarker(store: Store, editionId: number, m: ZipMarker): void {
  try {
    store?.setItem(presentationsZipKey(editionId), JSON.stringify(m));
  } catch {
    // not kept: the page only forgets the mark
  }
}

/**
 * Since this device's download: the files of the week's zip it did not hold (`fresh`, in the zip's order — uploaded after,
 * or not fetched then) and those whose path changed (`moved`). Nothing without a marker.
 */
export function sinceDownload(entries: ReadonlyMap<number, string>, marker: ZipMarker | null): { fresh: number[]; moved: number[] } {
  const fresh: number[] = [];
  const moved: number[] = [];
  if (!marker) return { fresh, moved };
  for (const [id, path] of entries) {
    const had = marker.names[String(id)];
    if (had === undefined) fresh.push(id);
    else if (had !== nameFingerprint(path)) moved.push(id);
  }
  return { fresh, moved };
}

/** «14:05» when the marker is today's in Israel, else «20.11, 14:05». */
export function markerTime(at: string, nowIso: string): string {
  const local = israelLocal(at);
  const hm = local.slice(11);
  if (israelDate(at) === israelDate(nowIso)) return hm;
  const [, m, d] = local.slice(0, 10).split("-").map(Number);
  return `${d}.${m}, ${hm}`;
}
