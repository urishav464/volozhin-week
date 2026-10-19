import { TEMPLATE_2026 } from "../domain/template2026";
import type { Category, Edition, Room, Week } from "../domain/types";
import { EXPECTED_SCHEMA_VERSION } from "../lib/schema";
import type { CellTarget, LessonPatch, ReshapeOp, WeekCommands } from "./commands";
import { DemoSettings, type DemoStore } from "./demoSettings";
import { demoWeek } from "./demoWeek";
import { type Actor, Engine } from "./engine";
import type { DataPort } from "./port";
import type { MemberRow, RosterEntry } from "./settings";
import type { WhoAmI } from "./types";

const DEMO_EMAIL = "demo@example.org";

// Synthetic data only — never a real name, phone or address. The grid's
// commands run on the same engine the parity tests hold against the SQL, so
// the demo behaves like production; nothing leaves the browser tab. Each
// edition has its own engine (a new one opens from «הגדרות»); the pool, the
// categories and the team are shared, as in the database.
export class DemoPort implements DataPort, DemoStore {
  readonly mode = "demo" as const;
  readonly myEmail = DEMO_EMAIL;
  readonly engines = new Map<number, Engine>();
  readonly settings: DemoSettings;
  members: MemberRow[];
  roster: (RosterEntry & { edition_id: number })[] = [];
  categories: Category[];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly actor: Actor = { memberId: 1, role: "admin" }) {
    const week = demoWeek();
    this.engines.set(week.edition.id, new Engine(week, actor));
    this.categories = structuredClone(week.categories);
    // The demo team, with placeholder addresses (example.org never delivers).
    this.members = week.team.map((t, i) => ({
      ...t,
      email: i === 0 ? DEMO_EMAIL : `team.${String.fromCharCode(96 + i)}@example.org`,
      edition_id: t.role === "admin" ? null : week.edition.id,
      active: true,
    }));
    this.settings = new DemoSettings(this);
  }

  addEngine(edition: Edition, room: Room): void {
    const first = [...this.engines.values()][0].week;
    const week: Week = {
      edition,
      rows: structuredClone(TEMPLATE_2026),
      rooms: [room],
      categories: structuredClone(this.categories),
      speakers: structuredClone(first.speakers),
      approaches: [],
      availability: [],
      lessons: [],
      lessonSpeakers: [],
      pitches: [],
      team: [],
    };
    this.engines.set(edition.id, new Engine(week, this.actor));
  }

  changed(): void {
    for (const e of this.engines.values()) e.week.categories = structuredClone(this.categories);
    this.listeners.forEach((l) => l());
  }

  private engine(editionId: number): Engine {
    return this.engines.get(editionId) ?? [...this.engines.values()][0];
  }

  async sessionEmail(): Promise<string | null> {
    return DEMO_EMAIL;
  }

  async whoami(): Promise<WhoAmI> {
    const mine = this.members.filter((m) => m.active && m.email === DEMO_EMAIL);
    return {
      status: "ok",
      schema_version: EXPECTED_SCHEMA_VERSION,
      email: DEMO_EMAIL,
      display_name: mine.find((m) => m.role === "admin")?.display_name ?? mine[0]?.display_name ?? null,
      global_admin: mine.some((m) => m.role === "admin" && m.edition_id == null),
      memberships: mine.map((m) => ({ edition_id: m.edition_id, role: m.role, member_id: m.id })),
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
    return [...this.engines.values()].map((e) => structuredClone(e.week.edition)).sort((a, b) => b.id - a.id);
  }

  async loadWeek(editionId: number): Promise<Week> {
    const week = structuredClone(this.engine(editionId).week);
    week.categories = structuredClone(this.categories);
    week.team = this.members
      .filter((m) => m.active && (m.edition_id == null || m.edition_id === week.edition.id))
      .map(({ id, display_name, gender, role }) => ({ id, display_name, gender, role }));
    return week;
  }

  commands(editionId: number): WeekCommands {
    const run = async <T>(fn: () => T): Promise<T> => {
      const out = fn();
      this.listeners.forEach((l) => l());
      return out;
    };
    const e = this.engine(editionId);
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
