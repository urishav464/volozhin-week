// «ידע» — the knowledge base and the milestones (DESIGN «ידע», schema v8),
// reached as `port.knowledge`, with the two implementations every port has:
// SupabaseKnowledge (direct writes under RLS — supabase/schema.sql «Milestone 4»)
// and DemoKnowledge (in memory, the same refusals). Every member reads; admins
// write — a cross-year note a global admin, an edition's note or milestone its
// admins. Nothing is seeded: it is the instructor's own (the demo's entries
// say «לדוגמה»).
import { CommandError } from "./commands";
import { cleanBlock, cleanLine } from "./speakerRules";

export const NOTE_SECTIONS = ["process", "lessons_learned", "challenges", "templates"] as const;
export type NoteSection = (typeof NOTE_SECTIONS)[number];

export const NOTE_SECTION_LABEL: Record<NoteSection, string> = {
  process: "תהליך",
  lessons_learned: "לקחים",
  challenges: "אתגרים",
  templates: "תבניות ונוסחים",
};

export interface Note {
  id: number;
  /** null = every year (cross-year). */
  edition_id: number | null;
  section: NoteSection;
  title: string;
  /** Markdown-lite (src/domain/markdown.ts): paragraphs, bullet lists, bold. */
  body_md: string;
  version: number;
  created_by: number | null;
  updated_by: number | null;
  updated_at: string;
}

export interface NewNote {
  edition_id: number | null;
  section: NoteSection;
  title: string;
  body_md: string;
}

export type NotePatch = Partial<Pick<Note, "section" | "title" | "body_md">>;

export interface Milestone {
  id: number;
  edition_id: number;
  title: string;
  /** Days before the week's opening Sunday (W−n, «הצעה»); negative = after the week (W+n). */
  days_before: number;
  done_at: string | null;
  done_by: number | null;
}

export interface KnowledgePort {
  /** The cross-year notes and the edition's. */
  notes(editionId: number): Promise<Note[]>;
  addNote(n: NewNote): Promise<void>;
  /** `version` as the screen saw it: a note saved by someone else meanwhile → stale. */
  updateNote(id: number, version: number, patch: NotePatch): Promise<void>;
  deleteNote(id: number): Promise<void>;
  milestones(editionId: number): Promise<Milestone[]>;
  addMilestone(editionId: number, m: { title: string; days_before: number }): Promise<void>;
  updateMilestone(id: number, patch: { title?: string; days_before?: number }): Promise<void>;
  /** Done now, by me (the database's clock) — or not done. */
  setMilestoneDone(id: number, done: boolean): Promise<void>;
  deleteMilestone(id: number): Promise<void>;
}

/** Characters, as the database's CHECKs and guard triggers count them. */
export const KNOWLEDGE_LIMITS = { title: 120, body: 20000, daysMin: -90, daysMax: 365 } as const;

const fail = (code: string): never => {
  throw new CommandError(code);
};

/** A note's or a milestone's title: one line (app.clean_line), required. */
export function cleanTitle(v: string | null | undefined): string {
  return cleanLine(v, KNOWLEDGE_LIMITS.title) ?? fail("title_required");
}

/** A note's body: a block (app.clean_block); empty is allowed. */
export function cleanBody(v: string | null | undefined): string {
  return cleanBlock(v, KNOWLEDGE_LIMITS.body) ?? "";
}

export function cleanSection(v: string): NoteSection {
  return (NOTE_SECTIONS as readonly string[]).includes(v) ? (v as NoteSection) : fail("bad_value");
}

/** Whole days, −90 … 365 (the CHECK on milestones.days_before). */
export function cleanDaysBefore(v: number): number {
  return Number.isInteger(v) && v >= KNOWLEDGE_LIMITS.daysMin && v <= KNOWLEDGE_LIMITS.daysMax ? v : fail("bad_value");
}
