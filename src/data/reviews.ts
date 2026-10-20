// «איך עבר» (milestone 6, schema v12) — reached as `port.reviews`, with the two
// implementations every port has: SupabaseReviews (the v12 functions) and
// DemoReviews (the engine). A review is an opinion about a person: the edition's
// admins and content members read it — never logistics, never a link, never the
// designer's export, never a Week (so never the offline copy) or Realtime. It is
// read when the lesson panel or the summary opens, and after a save.
// docs/CONTRACT.md «After the week» has the rules.
import type { InviteAgain } from "../domain/reviews";
import { INVITE_AGAIN, REVIEW_TEXT_MAX } from "../domain/reviews";
import { CommandError } from "./commands";
import { cleanBlock } from "./speakerRules";

/** One lesson's «איך עבר» (lesson_reviews). */
export interface LessonReview {
  lesson_id: number;
  /** The lesson's lead speaker when it was written — the review is about them. */
  speaker_id: number | null;
  went_well: string | null;
  issues: string | null;
  invite_again: InviteAgain | null;
  overran: boolean;
  /** 1–5, or none. */
  rating: number | null;
  /** members.id */
  written_by: number | null;
  written_at: string;
  version: number;
}

/** What a review says — every field is the writer's; none is required alone, but one must be said. */
export interface ReviewFields {
  went_well: string | null;
  issues: string | null;
  invite_again: InviteAgain | null;
  overran: boolean;
  rating: number | null;
}

/** A review of the speaker in some year, for the speaker sheet (public.speaker_reviews) — never who wrote it. */
export interface SpeakerReview {
  edition_id: number;
  edition_label: string;
  edition_kind: "real" | "archive";
  start_date: string | null;
  lesson_id: number;
  day: number;
  start_min: number;
  end_min: number;
  title: string | null;
  went_well: string | null;
  issues: string | null;
  invite_again: InviteAgain | null;
  overran: boolean;
  rating: number | null;
  written_at: string;
}

/** A speaker of the edition who taught in an earlier year, and those years' labels (public.edition_returning). */
export interface ReturningSpeaker {
  speaker_id: number;
  editions: string[];
}

export interface ReviewsPort {
  /** The edition's reviews, as the caller may read them (admins and content: all; anyone else: none). */
  ofEdition(editionId: number): Promise<LessonReview[]>;
  /** The handler or an admin; `version` as the screen saw it (0: none yet). Returns the version saved. */
  save(editionId: number, lessonId: number, version: number, fields: ReviewFields): Promise<number>;
  /** The speaker's reviews across the years — `forbidden` unless the caller may read them (a live real edition's admins and content, a global admin). */
  ofSpeaker(speakerId: number): Promise<SpeakerReview[]>;
  /** «חדשים / חוזרים»: the edition's speakers who taught in an earlier year (admins and content). */
  returning(editionId: number): Promise<ReturningSpeaker[]>;
}

const fail = (code: string): never => {
  throw new CommandError(code);
};

/**
 * What save_lesson_review keeps of the fields, refusing as it does: each text a block of at most 2000 (`bad_value`),
 * an answer of yes/no/maybe, a whole rating 1–5 (`bad_value`), and something said (`review_empty`).
 */
export function cleanReview(f: ReviewFields): ReviewFields {
  const went_well = cleanBlock(f.went_well, REVIEW_TEXT_MAX);
  const issues = cleanBlock(f.issues, REVIEW_TEXT_MAX);
  const ia = typeof f.invite_again === "string" ? f.invite_again.trim() : f.invite_again;
  const invite_again = ia == null || ia === "" ? null : (INVITE_AGAIN as readonly string[]).includes(ia) ? (ia as InviteAgain) : fail("bad_value");
  const overran = f.overran === true;
  const rating = f.rating == null ? null : Number.isInteger(f.rating) && f.rating >= 1 && f.rating <= 5 ? f.rating : fail("bad_value");
  if (went_well == null && issues == null && invite_again == null && rating == null && !overran) fail("review_empty");
  return { went_well, issues, invite_again, overran, rating };
}

/** Has the review been written at all (a row exists)? «חסר» in the summary otherwise. */
export const EMPTY_REVIEW: ReviewFields = { went_well: null, issues: null, invite_again: null, overran: false, rating: null };
