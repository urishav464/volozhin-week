// The grid's commands — their semantics are fixed in docs/CONTRACT.md, and
// both SupabasePort (SQL RPCs) and DemoPort (src/data/engine.ts) follow it.
import type { Day } from "../domain/time";
import type { Lesson } from "../domain/types";

/** An existing draft, or a cell: a range of a day in a room (null = the default room). */
export type CellTarget = { lesson_id: number } | { day: Day; start_min: number; end_min: number; room_id: number | null };

export type ReshapeOp =
  | { op: "split_parallel"; count: 2 | 3; reason: string }
  | { op: "split_time"; parts: number[] }
  | { op: "merge_next" }
  | { op: "reset" };

export type LessonPatch = Partial<Pick<Lesson, "title" | "category_id" | "audience" | "teach_min">>;

export interface WeekCommands {
  propose(speakerId: number, target: CellTarget, mode?: "self" | "offer"): Promise<{ lesson_id: number; pitch_id: number }>;
  unpropose(pitchId: number): Promise<void>;
  setPitch(pitchId: number, state: "candidate" | "approached" | "declined"): Promise<void>;
  closeLesson(pitchId: number): Promise<void>;
  reopenLesson(lessonId: number): Promise<void>;
  moveLesson(lessonId: number, to: { day: Day; start_min: number; end_min: number; room_id: number }): Promise<void>;
  reshape(day: Day, rowStart: number, op: ReshapeOp): Promise<void>;
  updateLesson(lessonId: number, version: number, patch: LessonPatch): Promise<void>;
}

/** A refusal with one of the contract's codes (src/errors.ts has the Hebrew). */
export class CommandError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
