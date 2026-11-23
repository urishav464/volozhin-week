// «אתר האורחים» from the team's side (the reset, phase 5) — pure: what each closed lesson still lacks before the guests'
// schedule (`/s`, public.schedule_view) shows all it can, and who may write it. The guests see a lesson's short
// description (`lessons.public_note`) and, per speaker approved to appear (`approaches.public_ok` of THIS edition), the
// speaker's description for guests (`speakers.public_bio`) and photo (`has_photo`). «Approved» is exactly the rule of
// publicSchedule (src/exports/publicSchedule.ts ≡ schedule_view, held by tests/parity), so the overview never says a
// speaker shows when the link would not show them. Not a stage: the card's five dots and the lesson page's six steps stay
// as they are (src/domain/stages.ts, src/screens/lesson/steps.ts) — the state is a line, the lesson page's and the speaker
// page's «לאתר האורחים» and «תוצרים ← אתר האורחים».
import type { PublicPerson, PublicScheduleRow } from "../data/publicPort";
import { scheduleEntries } from "../exports/designer";
import { publicSchedule } from "../exports/publicSchedule";
import { lessonHandler } from "./handler";
import type { Day } from "./time";
import type { Approach, Edition, Week } from "./types";

/** What a lesson may still lack for the guests: its description, and per speaker with an approach the approval, a description and a photo. */
export type GuestItem = "note" | "ok" | "bio" | "photo";
export const GUEST_ITEMS: readonly GuestItem[] = ["note", "ok", "bio", "photo"];

/** Each item in a line («חסר לאתר האורחים: …»), in the team's words. */
export const GUEST_ITEM_LABEL: Record<GuestItem, string> = { note: "תיאור לשיעור", ok: "אישור להופיע", bio: "תיאור למרצה", photo: "תמונה" };

/** What the rules read of who is looking (an `Actor` of src/screens/weekStore.tsx fits). */
export interface GuestActor {
  memberId: number;
  isAdmin: boolean;
  global: boolean;
  canEdit: boolean;
}

/** One speaker of a closed lesson, as the guests' site sees them. */
export interface GuestPerson {
  speakerId: number;
  role: "lead" | "co";
  /** This edition's approach (null: a co-speaker the import brought, with none — shown only by name, in the row). */
  approachId: number | null;
  /** Approved to appear on this edition's guests' schedule (public_ok). */
  ok: boolean;
  /** A description for guests (public_bio, not blank). */
  bio: boolean;
  /** A photo is stored (has_photo — never read here). */
  photo: boolean;
}

/** A closed lesson and what it lacks for the guests. */
export interface GuestRow {
  lessonId: number;
  day: Day;
  /** The teaching time, as the guests' schedule prints it (scheduleEntries). */
  start_min: number;
  end_min: number;
  title: string | null;
  /** lessonHandler: the lead's approach's owner. */
  handler: number | null;
  /** A description for guests (public_note, not blank). */
  note: boolean;
  /** The lead first, then by speaker id — publicSchedule's order. */
  people: GuestPerson[];
  /** In GUEST_ITEMS order, each once: «note» without a description; per speaker with an approach «ok», «bio», «photo» when absent. */
  missing: GuestItem[];
}

const filled = (v: string | null | undefined) => v != null && v.trim() !== "";

/** Every closed lesson (no memorial time, never a cancelled one), in the guests' schedule's order. */
export function guestRows(week: Week): GuestRow[] {
  const speakers = new Map(week.speakers.map((s) => [s.id, s]));
  const lessons = new Map(week.lessons.map((l) => [l.id, l]));
  const approaches = new Map(week.approaches.map((a) => [a.speaker_id, a]));
  return scheduleEntries(week)
    .filter((e) => e.kind === "lesson")
    .map((e) => {
      const l = lessons.get(e.lesson_id)!;
      const people: GuestPerson[] = week.lessonSpeakers
        .filter((x) => x.lesson_id === l.id && speakers.has(x.speaker_id))
        .sort((a, b) => Number(a.role !== "lead") - Number(b.role !== "lead") || a.speaker_id - b.speaker_id)
        .map((x) => {
          const s = speakers.get(x.speaker_id)!;
          const a = approaches.get(x.speaker_id);
          return { speakerId: s.id, role: x.role, approachId: a?.id ?? null, ok: a?.public_ok === true, bio: filled(s.public_bio), photo: s.has_photo === true };
        });
      const note = filled(l.public_note);
      const lacks = new Set<GuestItem>(note ? [] : ["note"]);
      for (const p of people) {
        if (p.approachId == null) continue;
        if (!p.ok) lacks.add("ok");
        if (!p.bio) lacks.add("bio");
        if (!p.photo) lacks.add("photo");
      }
      return {
        lessonId: l.id, day: l.day, start_min: e.start_min, end_min: e.end_min, title: l.title, handler: lessonHandler(week, l.id), note, people,
        missing: GUEST_ITEMS.filter((i) => lacks.has(i)),
      };
    });
}

/** The overview's counts: lessons (with a description), speakers with an approach, those approved, and of them with a description and a photo — each speaker once. */
export interface GuestSummary {
  lessons: number;
  withNote: number;
  people: number;
  ok: number;
  okWithBio: number;
  okWithPhoto: number;
}

export function guestSummary(rows: readonly GuestRow[]): GuestSummary {
  const people = new Map<number, GuestPerson>();
  for (const r of rows) for (const p of r.people) if (p.approachId != null && !people.has(p.speakerId)) people.set(p.speakerId, p);
  const ok = [...people.values()].filter((p) => p.ok);
  return {
    lessons: rows.length,
    withNote: rows.filter((r) => r.note).length,
    people: people.size,
    ok: ok.length,
    okWithBio: ok.filter((p) => p.bio).length,
    okWithPhoto: ok.filter((p) => p.photo).length,
  };
}

/** One line: «מוכן לאתר האורחים», or «חסר לאתר האורחים: תיאור לשיעור, אישור להופיע, תמונה». */
export function guestLine(row: Pick<GuestRow, "missing">): string {
  return row.missing.length === 0 ? "מוכן לאתר האורחים" : `חסר לאתר האורחים: ${row.missing.map((i) => GUEST_ITEM_LABEL[i]).join(", ")}`;
}

/** The overview's filters: a day, a handler (members.id), «רק מה שחסר». Absent: everything. */
export interface GuestFilter {
  day?: Day | null;
  handler?: number | null;
  missing?: boolean;
}

export function filterGuests(rows: readonly GuestRow[], f: GuestFilter): GuestRow[] {
  return rows.filter((r) => (f.day == null || r.day === f.day) && (f.handler == null || r.handler === f.handler) && (!f.missing || r.missing.length > 0));
}

/**
 * The speaker's own record is one row across the years (CONTRACT «update», app.may_edit_speaker): a global admin, or —
 * in a real edition that is not archived — its admin or the speaker's handler there. A practice or demo week (anyone
 * there may claim any pool speaker) and an archived edition give no such right. The bio for guests and the photo
 * follow it (set_speaker_photo, update_speaker).
 */
export function mayEditSpeaker(actor: GuestActor, edition: Pick<Edition, "kind" | "status">, handler: boolean): boolean {
  if (actor.global) return true;
  const live = edition.kind === "real" && edition.status !== "archived";
  return actor.canEdit && live && (actor.isAdmin || handler);
}

/**
 * May this viewer MARK the speaker «מאושר/ת להופיע» — set_public_ok's rule for `true`: an editor; the edition's admin or
 * the approach's owner; and app.may_edit_speaker (a real live edition, or a global admin), so a practice week's claim
 * publishes nothing.
 */
export function mayMarkPublic(actor: GuestActor, edition: Pick<Edition, "kind" | "status">, a: Pick<Approach, "owner_member_id">): boolean {
  const owner = a.owner_member_id != null && a.owner_member_id === actor.memberId;
  return actor.canEdit && (actor.isAdmin || owner) && mayEditSpeaker(actor, edition, owner);
}

/** May this viewer take a mark back — set_public_ok's rule for `false`: an editor, and the edition's admin or the approach's owner. */
export function mayUnmarkPublic(actor: GuestActor, a: Pick<Approach, "owner_member_id">): boolean {
  return actor.canEdit && (actor.isAdmin || (a.owner_member_id != null && a.owner_member_id === actor.memberId));
}

/**
 * Is the box «מאושר/ת להופיע» offered at all (the owner's decision, 22.11): once the speaker agreed (the approach is
 * `positive` — closing a lesson sets it), or when already marked, so a mark can always be taken back. The database does
 * not ask for `positive`; the screen does.
 */
export function publicOkOffered(a: Pick<Approach, "status" | "public_ok">): boolean {
  return a.status === "positive" || a.public_ok === true;
}

/**
 * May this viewer change the box as it stands — offered, and theirs to mark (not yet marked: mayMarkPublic, which already
 * refuses a practice week's non-global member) or to take back (marked: mayUnmarkPublic, in any edition, as set_public_ok
 * allows `false`). The switch is enabled exactly then; the lesson page says its hint only to such a viewer.
 */
export function mayChangePublicOk(actor: GuestActor, edition: Pick<Edition, "kind" | "status">, a: Pick<Approach, "status" | "public_ok" | "owner_member_id">): boolean {
  return publicOkOffered(a) && (a.public_ok === true ? mayUnmarkPublic(actor, a) : mayMarkPublic(actor, edition, a));
}

/**
 * One lesson as the guests' card would show it — publicSchedule's own row and its people (the photos from `photoOf`, as
 * base64), so a preview on the team's pages is the link's answer, not a copy of it. null: not a lesson the guests see.
 */
export function guestPreview(week: Week, lessonId: number, photoOf: (speakerId: number) => string | null): { row: PublicScheduleRow; people: PublicPerson[]; startDate: string | null } | null {
  const at = scheduleEntries(week).findIndex((e) => e.lesson_id === lessonId);
  if (at < 0) return null;
  const view = publicSchedule(week, photoOf);
  const row = view.rows[at];
  return row.kind === "lesson" ? { row, people: view.people, startDate: view.edition.start_date } : null;
}

/**
 * The speakers a preview shows a photo of: approved to appear (publicSchedule's rule) with a photo stored — each once,
 * in the rows' order. Only these are read (get_speaker_photo), and only when the preview opens.
 */
export function guestPhotoIds(rows: readonly GuestRow[]): number[] {
  const out: number[] = [];
  for (const r of rows) for (const p of r.people) if (p.ok && p.photo && !out.includes(p.speakerId)) out.push(p.speakerId);
  return out;
}

/**
 * The stored photos of `ids` (base64, by speaker id), read one speaker a call (get_speaker_photo) and at most `limit`
 * calls at a time — about 20KB each. A read that fails, or finds none, is no photo: the preview draws the speaker
 * without one, and `failed` counts the reads that failed.
 */
export async function readPhotos(
  ids: readonly number[],
  read: (speakerId: number) => Promise<{ photo: string } | null>,
  limit = 4,
): Promise<{ photos: Map<number, string>; failed: number }> {
  const photos = new Map<number, string>();
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const p = await read(id);
        if (p) photos.set(id, p.photo);
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, ids.length)) }, worker));
  return { photos, failed };
}
