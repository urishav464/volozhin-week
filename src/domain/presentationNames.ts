// The names in the week's presentations zip (v20, «הורדת כל המצגות של השבוע») — pure and small, so the escort's public
// page (/e) imports it without the rest of the presentations code. The zip has a folder per day, «1-ראשון/» …
// «5-חמישי/», and the week's own decks once, in «0-השבוע/». A lesson's file is «<folder>/<HHMM>_<room>_<its name>»: the
// lesson's day column (a lesson after midnight stays in the folder of the day before, as on the poster), its start, its
// room. No two lessons share a room at one time, so that prefix is the lesson's alone — the escort's page (which never
// sees a file's name) says «the file that starts with …» from the day, the start and the room escort_view gives it, by
// THIS function, and src/domain/presentations.ts names every entry by it.
import { safeEntryName } from "../exports/download";
import { type Day, DAY_NAMES } from "./time";

/** The week's own decks (the cover path), once. */
export const WEEK_FOLDER = "0-השבוע";
/** In each day's folder: always the order, and the links when a lesson has a link only. */
export const ORDER_FILE = "סדר-היום.txt";
export const LINKS_FILE = "links.txt";

/** «1-ראשון» … «5-חמישי» — the archive's convention for the sources' folders. */
export function dayFolder(day: Day): string {
  return `${day + 1}-${DAY_NAMES[day]}`;
}

/** «0830», and a night item after midnight «2430» (its hour 24–29), so the names sort in the day's order. */
export function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}${String(min % 60).padStart(2, "0")}`;
}

/** A lesson's files start with this in the week's zip: «2-שני/1030_בית מדרש_». No room name (never): «חדר». */
export function entryPrefix(day: Day, startMin: number, roomName: string): string {
  return `${dayFolder(day)}/${hhmm(startMin)}_${safeEntryName(roomName || "חדר")}_`;
}

/** A path of the zip as the page shows it: its folder and its name. */
export function splitEntry(path: string): { folder: string; name: string } {
  const i = path.indexOf("/");
  return i < 0 ? { folder: "", name: path } : { folder: path.slice(0, i), name: path.slice(i + 1) };
}

/** One piece of a sentence: plain text, or a name the page isolates (`<bdi>`) — a room may be written in Latin letters. */
export type Segment = { text: string } | { name: string };

/**
 * What the escort's page says of a lesson's presentation (escort_view's `presentation`): nothing for «none» — nor for a
 * value it does not know (an answer without the key says nothing, never «a file»).
 */
export function escortPresentationLine(state: "file" | "link" | "missing" | "none" | undefined, day: Day, startMin: number, roomName: string): Segment[] | null {
  if (state === "missing") return [{ text: "המצגת עוד לא הועלתה — בודקים עם הצוות" }];
  const folder = dayFolder(day);
  if (state === "link") return [{ text: `המצגת בקישור — בקובץ ${LINKS_FILE} בתיקייה של היום, «` }, { name: folder }, { text: "»" }];
  if (state !== "file") return null;
  return [
    { text: "מצגת: במחשב של האולם, בתיקייה «" },
    { name: folder },
    { text: "», הקובץ שמתחיל ב-«" },
    { name: splitEntry(entryPrefix(day, startMin, roomName)).name },
    { text: "»" },
  ];
}

/** The line as plain text (a test's, a screen reader's). */
export function segmentsText(s: readonly Segment[]): string {
  return s.map((x) => ("text" in x ? x.text : x.name)).join("");
}
