// «איפה אפשר לשבץ» on the speaker page (the reset, phase 2): the open slots of the week — free lesson cells and draft
// lessons (src/grid/model.ts openSlots) — where this speaker fits: they said «יכול/ה» or nothing at all, and they teach
// nothing else at that time (fitFor: «לא» and «כבר משובץ/ת» are dropped), and they are not already proposed there.
// Grouped by day, each day with its owners (v18 day_owners) — my days first. Pure, so every device lists the same.
import type { CellTarget } from "../data/commands";
import { fitFor, type GridModel, type OpenSlot, openSlots } from "../grid/model";
import { DAYS, type Day } from "./time";
import { LIVE_PITCH } from "./types";

/** An open slot this speaker fits: «יכול/ה» (they said so) or «neutral» (nothing said). */
export interface PlaceOption extends OpenSlot {
  fit: "can" | "neutral";
}

/** One day's options, with the day's owners (members.id, as stored) and whether I am one of them. */
export interface PlaceDay {
  day: Day;
  owners: number[];
  mine: boolean;
  options: PlaceOption[];
}

/** The owners of a day, by member id. */
export function ownersOf(model: GridModel, day: Day): number[] {
  return model.week.dayOwners
    .filter((o) => o.day === day)
    .map((o) => o.member_id)
    .sort((a, b) => a - b);
}

/**
 * Where a speaker may be proposed: nothing for a retired speaker, one not in the week, or one who declined this edition
 * (the approach says so). A day with no option is left out; my days first, then by day; a day's options by time.
 */
export function placementFor(model: GridModel, speakerId: number, me: number): PlaceDay[] {
  const s = model.speakerById.get(speakerId);
  if (!s || s.retired) return [];
  const a = model.approachBySpeaker.get(speakerId);
  if (a?.status === "declined") return [];
  // the drafts they are already proposed in (a live pitch of their approach)
  const pitched = new Set(a ? model.week.pitches.filter((p) => p.approach_id === a.id && LIVE_PITCH.has(p.state)).map((p) => p.lesson_id) : []);
  const out: PlaceDay[] = [];
  for (const day of DAYS) {
    const options: PlaceOption[] = [];
    for (const o of openSlots(model, day)) {
      if (o.lessonId != null && pitched.has(o.lessonId)) continue;
      const fit = fitFor(model, speakerId, day, o.start, o.end);
      if (fit === "cannot" || fit === "busy") continue;
      options.push({ ...o, fit });
    }
    if (options.length === 0) continue;
    const owners = ownersOf(model, day);
    out.push({ day, owners, mine: owners.includes(me), options });
  }
  return out.sort((x, y) => Number(y.mine) - Number(x.mine) || x.day - y.day);
}

/** What `propose` takes for an option: the draft itself, or the free cell in the default room. */
export function targetOf(o: Pick<OpenSlot, "day" | "start" | "end" | "lessonId">): CellTarget {
  return o.lessonId != null ? { lesson_id: o.lessonId } : { day: o.day, start_min: o.start, end_min: o.end, room_id: null };
}

/**
 * How I propose this speaker (CONTRACT «propose»): someone else handles them — the slot is offered to their handler
 * («offer»: the approach stays theirs); else I take them («self»: no approach, one back in the pool, or mine).
 */
export function proposeMode(model: GridModel, speakerId: number, me: number): "self" | "offer" {
  const owner = model.approachBySpeaker.get(speakerId)?.owner_member_id;
  return owner != null && owner !== me ? "offer" : "self";
}
