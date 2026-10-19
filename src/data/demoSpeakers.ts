// The speaker pool in demo mode: every command runs on src/data/engine.ts —
// the engine tests/parity holds to the SQL — so a preview link refuses and
// logs exactly what production would. Speakers are one list across the demo's
// editions (as in the database): after each command the engine that ran it
// hands its list to the others. Synthetic people only.
import type { DayPart } from "../domain/dayParts";
import type { Day } from "../domain/time";
import type { ApproachStatus, SpeakerContacts, Vetting } from "../domain/types";
import type { Engine, PoolShared } from "./engine";
import type { ActivityEntry, CreateOptions, HistoryLesson, NewSpeaker, SpeakerMatch, SpeakerPatch, SpeakerPort } from "./speakers";

/** What DemoPort shares with its pool. */
export interface DemoPool {
  readonly engines: Map<number, Engine>;
  readonly shared: PoolShared;
  /** Past editions' lessons of a few demo speakers (synthetic). */
  readonly history: Record<number, HistoryLesson[]>;
  /** The engine of an edition (the first one when the id is unknown, as loadWeek does). */
  engine(editionId: number): Engine;
  /** After a command: the speaker list to every engine, and open screens told. */
  poolChanged(from: Engine): void;
}

export class DemoSpeakers implements SpeakerPort {
  constructor(private readonly p: DemoPool) {}

  private any(): Engine {
    return [...this.p.engines.values()][0];
  }

  private async run<T>(e: Engine, fn: (e: Engine) => T): Promise<T> {
    try {
      return structuredClone(fn(e));
    } finally {
      this.p.poolChanged(e);
    }
  }

  async matches(name: string): Promise<SpeakerMatch[]> {
    return this.any().matches(name);
  }

  create(editionId: number, s: NewSpeaker, opts?: CreateOptions) {
    return this.run(this.p.engine(editionId), (e) => e.createSpeaker(s, opts));
  }

  update(editionId: number, speakerId: number, version: number, patch: SpeakerPatch) {
    return this.run(this.p.engine(editionId), (e) => e.updateSpeaker(speakerId, version, patch));
  }

  vet(speakerIds: number[], state: Vetting, note?: string | null) {
    return this.run(this.any(), (e) => e.vetSpeakers(speakerIds, state, note ?? null));
  }

  async contacts(speakerId: number): Promise<SpeakerContacts | null> {
    return this.any().contactsOf(speakerId);
  }

  setContacts(speakerId: number, c: SpeakerContacts) {
    return this.run(this.any(), (e) => e.setContacts(speakerId, c));
  }

  async history(speakerId: number): Promise<HistoryLesson[]> {
    const here: HistoryLesson[] = [];
    for (const { week: w } of this.p.engines.values()) {
      if (w.edition.kind !== "real" && w.edition.kind !== "archive") continue;
      for (const x of w.lessonSpeakers.filter((y) => y.speaker_id === speakerId)) {
        const l = w.lessons.find((y) => y.id === x.lesson_id && y.state === "closed");
        if (!l) continue;
        here.push({
          edition_id: w.edition.id, edition_label: w.edition.label, edition_kind: w.edition.kind, start_date: w.edition.start_date,
          day: l.day, start_min: l.start_min, end_min: l.end_min, title: l.title,
          category: w.categories.find((c) => c.id === l.category_id)?.name ?? null, role: x.role,
        });
      }
    }
    const all = [...here, ...(this.p.history[speakerId] ?? [])];
    return structuredClone(all.sort((a, b) => b.edition_id - a.edition_id || a.day - b.day || a.start_min - b.start_min));
  }

  async activity(speakerId: number): Promise<ActivityEntry[]> {
    const ofSpeaker = (r: ActivityEntry) =>
      (r.entity === "speakers" && r.entity_id === speakerId) || (r.entity === "approaches" && r.detail.speaker === speakerId);
    return structuredClone(this.p.shared.log.filter(ofSpeaker).sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id));
  }

  claim(editionId: number, speakerId: number) {
    return this.run(this.p.engine(editionId), (e) => e.claim(speakerId));
  }

  setStatus(editionId: number, approachId: number, version: number, status: ApproachStatus, note?: string | null) {
    return this.run(this.p.engine(editionId), (e) => e.setApproachStatus(approachId, version, status, note ?? null));
  }

  handOver(editionId: number, approachId: number, to: number | null, note?: string | null) {
    return this.run(this.p.engine(editionId), (e) => e.handOver(approachId, to, note ?? null));
  }

  answerHandOver(editionId: number, approachId: number, accept: boolean, note?: string | null) {
    return this.run(this.p.engine(editionId), (e) => e.answerHandOver(approachId, accept, note ?? null));
  }

  setAvailability(editionId: number, speakerId: number, day: Day, part: DayPart, kind: "can" | "cannot" | null, note?: string | null) {
    return this.run(this.p.engine(editionId), (e) => e.setAvailability(speakerId, day, part, kind, note ?? null));
  }
}
