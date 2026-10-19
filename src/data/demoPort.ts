import type { Edition, Week } from "../domain/types";
import { EXPECTED_SCHEMA_VERSION } from "../lib/schema";
import type { CellTarget, LessonPatch, ReshapeOp, WeekCommands } from "./commands";
import { demoWeek } from "./demoWeek";
import { type Actor, Engine } from "./engine";
import type { DataPort } from "./port";
import type { WhoAmI } from "./types";

// Synthetic data only — never a real name, phone or address. The grid's
// commands run on the same engine the parity tests hold against the SQL, so
// the demo behaves like production; nothing leaves the browser tab.
export class DemoPort implements DataPort {
  readonly mode = "demo" as const;
  private readonly engine: Engine;
  private readonly listeners = new Set<() => void>();

  constructor(actor: Actor = { memberId: 1, role: "admin" }) {
    this.engine = new Engine(demoWeek(), actor);
  }

  async sessionEmail(): Promise<string | null> {
    return "demo@example.org";
  }

  async whoami(): Promise<WhoAmI> {
    return {
      status: "ok",
      schema_version: EXPECTED_SCHEMA_VERSION,
      email: "demo@example.org",
      display_name: "מדריך/ה (הדגמה)",
      global_admin: true,
      memberships: [{ edition_id: null, role: "admin", member_id: 1 }],
    };
  }

  async signInWithGoogle(): Promise<void> {}
  async signOut(): Promise<void> {}
  onAuthChange(): () => void {
    return () => {};
  }
  async authError(): Promise<string | null> {
    return null;
  }

  async editions(): Promise<Edition[]> {
    return [structuredClone(this.engine.week.edition)];
  }

  async loadWeek(): Promise<Week> {
    return structuredClone(this.engine.week);
  }

  commands(): WeekCommands {
    const run = async <T>(fn: () => T): Promise<T> => {
      const out = fn();
      this.listeners.forEach((l) => l());
      return out;
    };
    const e = this.engine;
    return {
      propose: (speakerId: number, target: CellTarget, mode?: "self" | "offer") => run(() => e.propose(speakerId, target, mode)),
      unpropose: (pitchId: number) => run(() => e.unpropose(pitchId)),
      setPitch: (pitchId, state) => run(() => e.setPitch(pitchId, state)),
      closeLesson: (pitchId: number) => run(() => e.closeLesson(pitchId)),
      reopenLesson: (lessonId: number) => run(() => e.reopenLesson(lessonId)),
      moveLesson: (lessonId, to) => run(() => e.moveLesson(lessonId, to)),
      reshape: (day, rowStart, op: ReshapeOp) => run(() => e.reshape(day, rowStart, op)),
      updateLesson: (lessonId: number, version: number, patch: LessonPatch) => run(() => e.updateLesson(lessonId, version, patch)),
    };
  }

  subscribe(_editionId: number, onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }
}
