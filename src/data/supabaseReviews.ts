// «איך עבר» against the real database (supabase/schema.sql «Milestone 6»): the
// edition's reviews through the invoker load_reviews (under lesson_reviews_read:
// its admins and content members), a save through save_lesson_review, a
// speaker's across the years through speaker_reviews, the summary's returning
// speakers through edition_returning. A refusal is a CommandError with a code
// from src/errors.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InviteAgain } from "../domain/reviews";
import type { LessonReview, ReturningSpeaker, ReviewFields, ReviewsPort, SpeakerReview } from "./reviews";
import { callRpc } from "./supabaseCommands";

const text = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const answer = (v: unknown) => (v === "yes" || v === "no" || v === "maybe" ? (v as InviteAgain) : null);

export class SupabaseReviews implements ReviewsPort {
  constructor(private readonly sb: SupabaseClient) {}

  async ofEdition(editionId: number): Promise<LessonReview[]> {
    const rows = ((await callRpc(this.sb, "load_reviews", { p_edition: editionId })) ?? []) as Record<string, unknown>[];
    return rows.map((r) => ({
      lesson_id: Number(r.lesson_id), speaker_id: num(r.speaker_id), went_well: text(r.went_well), issues: text(r.issues), invite_again: answer(r.invite_again),
      overran: r.overran === true, rating: num(r.rating), written_by: num(r.written_by), written_at: String(r.written_at), version: Number(r.version),
    }));
  }

  async save(_editionId: number, lessonId: number, version: number, f: ReviewFields): Promise<number> {
    return Number(
      await callRpc(this.sb, "save_lesson_review", {
        p_lesson: lessonId, p_version: version, p_went_well: f.went_well, p_issues: f.issues, p_invite_again: f.invite_again, p_overran: f.overran, p_rating: f.rating,
      }),
    );
  }

  async ofSpeaker(speakerId: number): Promise<SpeakerReview[]> {
    const rows = ((await callRpc(this.sb, "speaker_reviews", { p_speaker: speakerId })) ?? []) as Record<string, unknown>[];
    return rows.map((r) => ({
      edition_id: Number(r.edition_id), edition_label: String(r.edition_label), edition_kind: r.edition_kind === "archive" ? "archive" : "real", start_date: text(r.start_date),
      lesson_id: Number(r.lesson_id), day: Number(r.day), start_min: Number(r.start_min), end_min: Number(r.end_min), title: text(r.title),
      went_well: text(r.went_well), issues: text(r.issues), invite_again: answer(r.invite_again), overran: r.overran === true, rating: num(r.rating), written_at: String(r.written_at),
    }));
  }

  async returning(editionId: number): Promise<ReturningSpeaker[]> {
    const rows = ((await callRpc(this.sb, "edition_returning", { p_edition: editionId })) ?? []) as Record<string, unknown>[];
    return rows.map((r) => ({ speaker_id: Number(r.speaker_id), editions: Array.isArray(r.editions) ? r.editions.map(String) : [] }));
  }
}
