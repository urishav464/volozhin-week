// The pages' addresses (the reset, phases 2–3): one place that writes them and reads them back, so «היום שלי», «ימים»,
// the speakers' pages, the lesson page and «אחרי השבוע» link to each other the same way. Pure; a bad value in an address is dropped,
// never guessed.
import type { PoolSection } from "../grid/model";
import type { LessonStep, StageKey } from "./stages";
import { DAY_END, DAYS, type Day } from "./time";
import type { Gender } from "./types";

/** The lesson page's steps, in order (src/screens/lesson/). */
export type PageStep = "place" | "close" | "pay" | "msg" | "sources" | "escort";
export const PAGE_STEPS: readonly PageStep[] = ["place", "close", "pay", "msg", "sources", "escort"];

/** The speaker page's sections an address may open at (its `#…`); «לאתר האורחים» (`#guest`) since the reset, phase 5. */
export type SpeakerSection = "call" | "availability" | "placement" | "lessons" | "guest";
export const SPEAKER_SECTIONS: readonly SpeakerSection[] = ["call", "availability", "placement", "lessons", "guest"];

/**
 * The lesson page's parts an address may open at (its `#…`, the reset, phase 5): «לאתר האורחים» (`#guest`, below the
 * steps, a closed lesson's) and the «מצגות» part of «מקורות ומצגת» (`#presentations` — the page opens that step for it).
 */
export type LessonSection = "guest" | "presentations";
export const LESSON_SECTIONS: readonly LessonSection[] = ["guest", "presentations"];

/** One slot of a day: what «לבחור מרצה» filters the speakers by. */
export interface SlotRef {
  day: Day;
  start: number;
  end: number;
  /**
   * The draft it is (lessons.id), when it is one: two parallel drafts share the day and the time, so a proposal from the
   * list goes into THIS one. Absent: a free cell of the grid.
   */
  lesson?: number;
}

/** The speakers' list's filters, as its address holds them. */
export interface SpeakersQuery {
  q?: string;
  cat?: number;
  g?: Gender;
  s?: PoolSection;
  day?: Day;
  slot?: SlotRef;
  sort?: "name" | "status";
  /** «כל הצוות» (the reset, phase 3): the team's board instead of the list — a block per handler. */
  view?: "team";
}

const POOL_SECTIONS: readonly PoolSection[] = ["mine", "free", "others", "closed", "declined"];

/** `/lesson/7`, `/lesson/7?step=pay`, `/lesson/7#guest`, `/lesson/7?step=sources#presentations`. */
export function lessonPath(id: number, step?: PageStep | null, section?: LessonSection | null): string {
  return `/lesson/${id}${step ? `?step=${step}` : ""}${section ? `#${section}` : ""}`;
}

/** `/speakers/7`, `/speakers/7#call`. */
export function speakerPath(id: number, section?: SpeakerSection | null): string {
  return `/speakers/${id}${section ? `#${section}` : ""}`;
}

/** `/speakers/new`, `/speakers/new?name=…` (the name typed in the search, to check first). */
export function newSpeakerPath(name?: string | null): string {
  const n = name?.trim();
  return n ? `/speakers/new?name=${encodeURIComponent(n)}` : "/speakers/new";
}

/** «0:960-1050» — a slot as the address writes it. */
const slotText = (s: SlotRef) => `${s.day}:${s.start}-${s.end}`;

/** `/speakers?slot=0:960-1050&lesson=34&day=0&q=…&cat=3&g=f&s=mine&sort=name&view=team` — only what is set, in that order. */
export function speakersPath(q: SpeakersQuery = {}): string {
  const parts: string[] = [];
  if (q.slot) parts.push(`slot=${slotText(q.slot)}`);
  if (q.slot?.lesson != null) parts.push(`lesson=${q.slot.lesson}`);
  if (q.day != null) parts.push(`day=${q.day}`);
  const text = q.q?.trim();
  if (text) parts.push(`q=${encodeURIComponent(text)}`);
  if (q.cat != null) parts.push(`cat=${q.cat}`);
  if (q.g) parts.push(`g=${q.g}`);
  if (q.s) parts.push(`s=${q.s}`);
  if (q.sort) parts.push(`sort=${q.sort}`);
  if (q.view) parts.push(`view=${q.view}`);
  return parts.length ? `/speakers?${parts.join("&")}` : "/speakers";
}

const isDay = (n: number): n is Day => (DAYS as readonly number[]).includes(n);
const wholeNumber = (v: string | null): number | null => (v != null && /^\d{1,6}$/.test(v) ? Number(v) : null);

/** A slot from the address: a day, then a start before its end inside the day's clock (06:30 … 06:30); else null. */
export function parseSlot(v: string | null): SlotRef | null {
  const m = v ? /^(\d):(\d{1,4})-(\d{1,4})$/.exec(v) : null;
  if (!m) return null;
  const day = Number(m[1]);
  const start = Number(m[2]);
  const end = Number(m[3]);
  if (!isDay(day) || start >= end || end > DAY_END) return null;
  return { day, start, end };
}

/** The list's filters from `location.search` (with or without its «?»); a value that is not one of them is dropped. */
export function parseSpeakersQuery(search: string): SpeakersQuery {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out: SpeakersQuery = {};
  const q = p.get("q")?.trim();
  if (q) out.q = q;
  const cat = wholeNumber(p.get("cat"));
  if (cat != null && cat > 0) out.cat = cat;
  const g = p.get("g");
  if (g === "m" || g === "f") out.g = g;
  const s = p.get("s");
  if (s && (POOL_SECTIONS as readonly string[]).includes(s)) out.s = s as PoolSection;
  const day = wholeNumber(p.get("day"));
  if (day != null && isDay(day)) out.day = day;
  const slot = parseSlot(p.get("slot"));
  if (slot) {
    // the draft, only with its slot
    const lesson = wholeNumber(p.get("lesson"));
    out.slot = lesson != null && lesson > 0 ? { ...slot, lesson } : slot;
  }
  const sort = p.get("sort");
  if (sort === "name" || sort === "status") out.sort = sort;
  if (p.get("view") === "team") out.view = "team";
  return out;
}

/** The staff's day page (the reset, phase 3): `/day` (the default day), `/day/2`. */
export function dayPath(d?: Day | null): string {
  return d == null ? "/day" : `/day/${d}`;
}

/** A day from an address («2» of `/day/2`, `?day=2`): one of the five, else null. */
export function parseDay(v?: string | null): Day | null {
  const n = v != null && /^\d$/.test(v) ? Number(v) : null;
  return n != null && isDay(n) ? n : null;
}

/** «אחרי השבוע»'s address: `/after`, `/after?all=1` (an admin's every lesson), `/after?all=1&lesson=7` (open at one). */
export function afterPath(q: { all?: boolean; lesson?: number } = {}): string {
  const parts: string[] = [];
  if (q.all) parts.push("all=1");
  if (q.lesson != null) parts.push(`lesson=${q.lesson}`);
  return parts.length ? `/after?${parts.join("&")}` : "/after";
}

/** «אחרי השבוע»'s query back: `all` only as «1», a lesson only as a whole number above 0. */
export function parseAfterQuery(search: string): { all: boolean; lesson: number | null } {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const lesson = wholeNumber(p.get("lesson"));
  return { all: p.get("all") === "1", lesson: lesson != null && lesson > 0 ? lesson : null };
}

/** The lesson page's step from its address (`?step=pay`); null when there is none, or it is not a step. */
export function parsePageStep(search: string): PageStep | null {
  const v = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("step");
  return v && (PAGE_STEPS as readonly string[]).includes(v) ? (v as PageStep) : null;
}

/** The lesson page's part from its address (`#guest`); null when there is none, or it is not one. */
export function parseLessonSection(hash: string): LessonSection | null {
  const v = hash.startsWith("#") ? hash.slice(1) : hash;
  return (LESSON_SECTIONS as readonly string[]).includes(v) ? (v as LessonSection) : null;
}

/** The speaker page's section from its address (`#call`); null when there is none, or it is not a section. */
export function parseSpeakerSection(hash: string): SpeakerSection | null {
  const v = hash.startsWith("#") ? hash.slice(1) : hash;
  return (SPEAKER_SECTIONS as readonly string[]).includes(v) ? (v as SpeakerSection) : null;
}

/** A closed lesson's next step («היום שלי»), or a stage of the card, as the lesson page's step. */
export function pageStepOf(k: LessonStep | StageKey): PageStep {
  switch (k) {
    case "payment":
    case "pay":
      return "pay";
    case "reconfirm":
    case "send":
    case "msg":
      return "msg";
    case "reader":
    case "sources":
      return "sources";
    case "escort":
      return "escort";
  }
}

/**
 * «אתר האורחים» (`/export/guests`, the reset, phase 5 — the edition's admins): the overview's filters, only what is set,
 * in this order — a day, a handler (members.id), «רק מה שחסר».
 */
export interface GuestsQuery {
  day?: Day;
  h?: number;
  missing?: boolean;
}

export function guestsPath(q: GuestsQuery = {}): string {
  const parts: string[] = [];
  if (q.day != null) parts.push(`day=${q.day}`);
  if (q.h != null) parts.push(`h=${q.h}`);
  if (q.missing) parts.push("missing=1");
  return parts.length ? `/export/guests?${parts.join("&")}` : "/export/guests";
}

/** The overview's filters back: a day of the five, a handler as a whole number above 0, «missing» only as «1». */
export function parseGuestsQuery(search: string): GuestsQuery {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out: GuestsQuery = {};
  const day = parseDay(p.get("day"));
  if (day != null) out.day = day;
  const h = wholeNumber(p.get("h"));
  if (h != null && h > 0) out.h = h;
  if (p.get("missing") === "1") out.missing = true;
  return out;
}

/**
 * «מצגות» (`/presentations`, the reset, phase 5 — every member of the edition reads it): the day's tab and the room's
 * chip, only what is set — `?day=2&room=3`. No room: «כל החדרים».
 */
export interface PresentationsQuery {
  day?: Day;
  room?: number;
}

export function presentationsPath(q: PresentationsQuery = {}): string {
  const parts: string[] = [];
  if (q.day != null) parts.push(`day=${q.day}`);
  if (q.room != null) parts.push(`room=${q.room}`);
  return parts.length ? `/presentations?${parts.join("&")}` : "/presentations";
}

/** The page's day and room back: a day of the five, a room as a whole number above 0; anything else dropped. */
export function parsePresentationsQuery(search: string): PresentationsQuery {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out: PresentationsQuery = {};
  const day = parseDay(p.get("day"));
  if (day != null) out.day = day;
  const room = wholeNumber(p.get("room"));
  if (room != null && room > 0) out.room = room;
  return out;
}
