// The speaker pool's storage operations — reached as `port.speakers`, with the
// same two implementations as the grid: SupabaseSpeakers (the RPCs of
// supabase/schema.sql «Milestone 2») and DemoSpeakers (src/data/engine.ts, in
// memory). Their semantics are docs/CONTRACT.md «The speaker pool»; a refusal
// is a CommandError whose code src/errors.ts turns into Hebrew.
//
// Contact details never travel with a Week (load_week leaves them out, and
// Realtime never carries them): `contacts()` fetches one speaker's, and only
// for the people the contacts policy names.
import type { AvailabilityRange, SlotKind } from "../domain/availability";
import type { Day } from "../domain/time";
import type { ApproachStatus, ContactPref, Edition, Gender, SpeakerContacts, Vetting } from "../domain/types";

/** What a person creating or editing a speaker fills in (contacts are separate — setContacts). */
export interface SpeakerFields {
  title: string | null;
  name: string;
  disambiguator: string | null;
  gender: Gender | null;
  affiliation: string | null;
  bio_short: string | null;
  /** v19: the guests' schedule's description (≤ 600, no phone or e-mail: contact_in_text). Kept with the speaker across years. */
  public_bio: string | null;
  topics: string[];
  contact_pref: ContactPref | null;
}

export type NewSpeaker = Partial<SpeakerFields> & { name: string };

/**
 * v19: a speaker's photo for the guests' schedule (public.get_speaker_photo) — a small JPEG (≤ 20KB, ≤ 512px, no
 * metadata: src/domain/photo.ts `photoOk`), read one speaker at a time, never in a Week (which says only `has_photo`).
 */
export interface SpeakerPhoto {
  /** Canonical base64, no newlines, no «data:» prefix. */
  photo: string;
  uploaded_at: string;
}

/** Only the keys present change. `retired` is a global admin's. */
export type SpeakerPatch = Partial<SpeakerFields & { retired: boolean }>;

export interface CreateOptions {
  /** Take the new speaker at once («אני מטפל/ת») — an approach in this edition, status claimed. */
  claim?: boolean;
  /** A global admin approves at once; anyone else is refused (forbidden). */
  approve?: boolean;
  /** «זה מרצה אחר»: create although `matches()` found similar names. Never skips the same-name rule. */
  confirmed?: boolean;
}

/** «ייתכן שזה…» — a pool speaker whose name key is the same as, or similar to, the name typed. */
export interface SpeakerMatch {
  id: number;
  title: string | null;
  name: string;
  disambiguator: string | null;
  gender: Gender | null;
  affiliation: string | null;
  vetted: Vetting;
  retired: boolean;
  match: "same" | "similar";
  /** pg_trgm similarity of the name keys, 0–1. */
  similarity: number;
}

/** A closed lesson the speaker taught, in a real or archived edition — no contact, no payment. */
export interface HistoryLesson {
  edition_id: number;
  edition_label: string;
  edition_kind: Edition["kind"];
  start_date: string | null;
  day: Day;
  start_min: number;
  end_min: number;
  title: string | null;
  category: string | null;
  role: "lead" | "co";
}

/**
 * One line of a speaker's timeline (public.activity). `actor`, and in `detail`
 * `owner` / `offered_to`, are members.id — names come from the edition's team.
 * Kinds: speakers insert | update {fields} | vet {vetted, note} | contacts {fields};
 * approaches insert | update {status, owner, offered_to?, note?} | availability — one slot {speaker, day, start, end,
 * kind} (before v14: {day, part, kind}) or, v18, a set of ranges {speaker, days, ranges, marked, rest}: counts only;
 * pitches insert | update | delete {state, lesson}.
 */
export interface ActivityEntry {
  id: number;
  at: string;
  actor: number | null;
  edition_id: number | null;
  entity: "speakers" | "approaches" | "pitches" | string;
  entity_id: number | null;
  kind: string;
  detail: Record<string, unknown>;
}

export interface SpeakerPort {
  // ------------------------------------------------ search first, then create
  /** Same name key first, then the similar ones (≥ SIMILAR_THRESHOLD), at most 20. Any member. */
  matches(name: string): Promise<SpeakerMatch[]>;
  /**
   * A new pool speaker, `vetted = pending` unless a global admin approves at once.
   * Refuses speaker_exists (same name and disambiguator), disambiguator_required
   * (same name, none given), speaker_similar (a similar name, not `confirmed`).
   */
  create(editionId: number, s: NewSpeaker, opts?: CreateOptions): Promise<{ speaker_id: number; approach_id: number | null }>;
  /**
   * A global admin; or, in a real edition that is not archived, its admin or the speaker's handler there
   * (a practice, demo or archived edition gives no right over the pool's record). `version` from the Week (stale otherwise).
   */
  update(editionId: number, speakerId: number, version: number, patch: SpeakerPatch): Promise<void>;

  // ------------------------------------------------ the quality gate (global admin)
  /** Approve, reject or return to pending — one speaker or a batch — with an optional note. */
  vet(speakerIds: number[], state: Vetting, note?: string | null): Promise<void>;

  // ------------------------------------------------ the sheet
  /** null when the caller may not see them: only a global admin, or whoever handles the speaker in the current real edition. */
  contacts(speakerId: number): Promise<SpeakerContacts | null>;
  /** The same people only. All four fields are replaced (null clears). */
  setContacts(speakerId: number, c: SpeakerContacts): Promise<void>;
  /** Closed lessons in real and archived editions, newest edition first — a live edition's only for those who can see it. */
  history(speakerId: number): Promise<HistoryLesson[]>;
  /** Newest first. */
  activity(speakerId: number): Promise<ActivityEntry[]>;

  // ------------------------------------------------ approaches (one handler per speaker per edition)
  // The edition is the one the approach belongs to (the database knows it from the
  // approach; the demo keeps one engine per edition, with its own approach ids).
  /** «אני מטפל/ת» without a cell; returns the approach id. approach_owned when someone else holds it. */
  claim(editionId: number, speakerId: number): Promise<number>;
  /** The handler or an admin; `version` from the Week; each change is logged with the optional note. */
  setStatus(editionId: number, approachId: number, version: number, status: ApproachStatus, note?: string | null): Promise<void>;
  /** The handler offers to `to` (null withdraws the offer); an admin reassigns at once (null: back to the pool). */
  handOver(editionId: number, approachId: number, to: number | null, note?: string | null): Promise<void>;
  /** The member an offer waits for takes the speaker (accept) or gives it back. */
  answerHandOver(editionId: number, approachId: number, accept: boolean, note?: string | null): Promise<void>;
  /**
   * v14: one slot — a lesson row on a day — is can / cannot / unknown (null). Any content member or admin of the edition
   * (no approach needed); refuses outside_grid for a row not in play that day (src/domain/availability.ts).
   */
  setSlotAvailability(editionId: number, speakerId: number, day: Day, rowId: number, kind: "can" | "cannot" | null, note?: string | null): Promise<void>;
  /**
   * v18: availability typed as time ranges — an input method, the slots stay the one store. For each of `days` (1–5,
   * distinct) the speaker's slots of that day are replaced (their notes go with them) by what `rangesToSlots`
   * (src/domain/availability.ts) makes of the ranges (at most 40) and `rest` (what a row no range decides becomes;
   * null = no mark). The same people as setSlotAvailability. Returns how many slots were marked; logged once.
   */
  setAvailabilityRanges(editionId: number, speakerId: number, days: Day[], ranges: AvailabilityRange[], rest?: SlotKind | null): Promise<number>;

  // ------------------------------------------------ v19: the guests' schedule
  /** The speaker's photo (public.get_speaker_photo, under the table's policy: any member); null when none. */
  photo(speakerId: number): Promise<SpeakerPhoto | null>;
  /**
   * public.set_speaker_photo: whoever may edit the speaker (mayEditSpeaker) in this edition. `photo` is base64 of a
   * JPEG that already passes photoOk (anything else → bad_file); null removes it. Logged without the bytes.
   */
  setPhoto(editionId: number, speakerId: number, photo: string | null): Promise<void>;
  /**
   * public.set_public_ok: the approach's handler or an edition admin shows (or stops showing) the speaker on THIS
   * edition's guests' schedule; `version` from the Week (stale otherwise). Taking it back hides them at once.
   */
  setPublicOk(editionId: number, approachId: number, version: number, ok: boolean): Promise<void>;
}
