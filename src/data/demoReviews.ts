// «איך עבר» in the demo: the engine's store (shared.reviews), by the same rules
// and refusal codes as the database — and, across the years, the synthetic past
// edition the demo's history names (src/data/demoWeek.ts: demoHistory,
// demoPastReviews). Synthetic only.
import type { Engine } from "./engine";
import type { LessonReview, ReturningSpeaker, ReviewFields, ReviewsPort, SpeakerReview } from "./reviews";
import type { HistoryLesson } from "./speakers";

export interface DemoReviewStore {
  engine(editionId: number): Engine;
  readonly engines: Map<number, Engine>;
  /** The synthetic past year's lessons, by speaker (the speaker sheet's «לימד/ה אצלנו»). */
  readonly history: Record<number, HistoryLesson[]>;
  /** That past year's reviews, by speaker. */
  readonly pastReviews: Record<number, SpeakerReview[]>;
  notify(): void;
}

export class DemoReviews implements ReviewsPort {
  constructor(private readonly s: DemoReviewStore) {}

  async ofEdition(editionId: number): Promise<LessonReview[]> {
    return structuredClone(this.s.engine(editionId).reviewsOf());
  }

  async save(editionId: number, lessonId: number, version: number, fields: ReviewFields): Promise<number> {
    const v = this.s.engine(editionId).saveReview(lessonId, version, fields);
    this.s.notify();
    return v;
  }

  async ofSpeaker(speakerId: number): Promise<SpeakerReview[]> {
    // the newest edition still live (the demo's own, or a real one opened in it): its actor decides, as the database's
    // app.may_read_reviews would — never an archive the import of 5786 made, though its id is newer
    const editions = [...this.s.engines.values()].map((e) => e.week.edition).sort((a, b) => b.id - a.id);
    const reader = editions.find((e) => e.kind !== "archive" && e.status !== "archived") ?? editions[0];
    const here = this.s.engine(reader.id).speakerReviews(speakerId);
    return structuredClone([...here, ...(this.s.pastReviews[speakerId] ?? [])]);
  }

  async returning(editionId: number): Promise<ReturningSpeaker[]> {
    const e = this.s.engine(editionId);
    const out = new Map(e.returning().map((r) => [r.speaker_id, r.editions]));
    // the synthetic past year (an archive, its date unknown) is earlier than every edition the demo opens
    const w = e.week;
    for (const x of w.lessonSpeakers) {
      const closed = w.lessons.some((l) => l.id === x.lesson_id && l.state === "closed" && l.kind === "lesson");
      const past = (this.s.history[x.speaker_id] ?? []).map((h) => h.edition_label);
      if (!closed || past.length === 0 || w.edition.kind === "archive" || w.edition.status === "archived") continue;
      out.set(x.speaker_id, [...new Set([...past, ...(out.get(x.speaker_id) ?? [])])]);
    }
    return [...out.entries()].sort(([a], [b]) => a - b).map(([speaker_id, editions]) => ({ speaker_id, editions }));
  }
}
