// «היום שלי» (the reset, phase 2): a trainee's home, derived from a loaded Week — the day (or days) an edition admin
// gave them with a partner (v18 day owners), its slots in time order each with ONE next step, the lessons of the day
// someone else handles («חדש» since the owner last looked: the notification the owner asked for), and the speakers
// who said they can come to a free slot of it. Pure, so every device says the same.
import { fitFor, type GridModel, openSlots, poolSection } from "../grid/model";
import { groupOf, type MineGroup, nextStep } from "./mine";
import { lessonPath, type PageStep, pageStepOf, type SlotRef, speakerPath, speakersPath } from "./routes";
import { nextLessonStep, readerFilesOf } from "./stages";
import { DAYS, type Day } from "./time";
import type { ApproachStatus, Lesson, Week } from "./types";
import { LIVE_PITCH } from "./types";

/** The days I own (one or more — a tab each), in the week's order. */
export function ownedDays(week: Pick<Week, "dayOwners">, me: number): Day[] {
  const mine = new Set((week.dayOwners ?? []).filter((o) => o.member_id === me).map((o) => o.day));
  return DAYS.filter((d) => mine.has(d));
}

/** A slot card's one next step. */
export type SlotStep =
  /** Nobody pitched here yet: the speakers who fit the slot. */
  | { kind: "choose"; to: string }
  /** My candidate: their page, where the call stands (or the approval). */
  | { kind: "speaker"; speakerId: number; group: MineGroup; to: string }
  /** The lesson page, at its step (`step` null: everything is in place — «הכול מוכן»). */
  | { kind: "lesson"; lessonId: number; step: PageStep | null; to: string }
  /** Someone else's (or a partner's) — to read; `handlers` empty: a candidate nobody handles. */
  | { kind: "theirs"; handlers: number[]; to: string | null };

export interface SlotCandidate {
  pitchId: number;
  speakerId: number;
  status: ApproachStatus;
  handler: number | null;
  group: MineGroup;
}

export interface SlotCard {
  /** `free:<day>:<start>` or `lesson:<id>`. */
  key: string;
  start: number;
  end: number;
  label: string | null;
  state: "free" | "draft" | "closed";
  lessonId: number | null;
  /** A draft's live candidates, most advanced first (the model's order). */
  candidates: SlotCandidate[];
  /** A closed lesson's lead speaker. */
  leadId: number | null;
  /** Who handles it: a closed lesson's lead's handler, a draft's candidates' (distinct, in the candidates' order). */
  handlers: number[];
  step: SlotStep;
}

/** A lesson of my day someone outside the day's owners handles. */
export interface OtherLesson {
  lessonId: number;
  start: number;
  end: number;
  /** The handlers who are not the day's owners. */
  handlers: number[];
  /** «חדש»: I never looked at the day, or someone was proposed here since I did. */
  fresh: boolean;
}

export interface DaySpeaker {
  speakerId: number;
  /** I handle them (else nobody does). */
  mine: boolean;
  /** The free slots of the day they said «יכול/ה» for, by start. */
  fits: SlotRef[];
}

export interface MyDay {
  day: Day;
  /** The day's owners (members.id), ascending. */
  owners: number[];
  /** The owners but me. */
  partners: number[];
  /** When I last marked the day's notices seen (null: never, or I do not own the day). */
  seenAt: string | null;
  slots: SlotCard[];
  others: OtherLesson[];
  speakers: DaySpeaker[];
}

const distinct = (xs: (number | null | undefined)[]): number[] => [...new Set(xs.filter((x): x is number => x != null))];

/** One day of «היום שלי», for member `me` (staff may preview a day they do not own: no partners then, nothing seen). */
export function myDay(model: GridModel, day: Day, me: number): MyDay {
  const { week } = model;
  const rows = (week.dayOwners ?? []).filter((o) => o.day === day);
  const owners = distinct(rows.map((o) => o.member_id)).sort((a, b) => a - b);
  const partners = owners.filter((o) => o !== me);
  const seenAt = rows.find((o) => o.member_id === me)?.seen_at ?? null;
  // «ours»: the day's owners and me — a closed lesson of a partner's opens at its step too
  const ours = new Set([...owners, me]);

  const candidatesOf = (lessonId: number): SlotCandidate[] =>
    (model.pitchesByLesson.get(lessonId) ?? [])
      .filter((p) => LIVE_PITCH.has(p.state))
      .flatMap((p) => {
        const a = model.approachById.get(p.approach_id);
        const s = a ? model.speakerById.get(a.speaker_id) : undefined;
        return a && s ? [{ pitchId: p.id, speakerId: s.id, status: a.status, handler: a.owner_member_id, group: groupOf(week, a, s) }] : [];
      });

  const draftStep = (lessonId: number, candidates: SlotCandidate[], slot: SlotRef): SlotStep => {
    // the draft by its id: a parallel pair shares the day and the time, and the list must propose into this one
    if (candidates.length === 0) return { kind: "choose", to: speakersPath({ slot: { ...slot, lesson: lessonId } }) };
    const mine = candidates.find((c) => c.handler === me);
    if (!mine) return { kind: "theirs", handlers: distinct(candidates.map((c) => c.handler)), to: lessonPath(lessonId) };
    switch (nextStep(mine.group)) {
      case "close":
        return { kind: "lesson", lessonId, step: "close", to: lessonPath(lessonId, "close") };
      case "call":
        return { kind: "speaker", speakerId: mine.speakerId, group: mine.group, to: speakerPath(mine.speakerId, "call") };
      default:
        // «vet» (agreed, waiting for the approval) — and a declined approach pitched here again: their page
        return { kind: "speaker", speakerId: mine.speakerId, group: mine.group, to: speakerPath(mine.speakerId) };
    }
  };

  const closedHandler = (l: Lesson): number | null => {
    const lead = model.leadOf.get(l.id);
    return (lead && model.approachBySpeaker.get(lead.id)?.owner_member_id) ?? null;
  };

  const slots: SlotCard[] = openSlots(model, day).map((o) => {
    const slot: SlotRef = { day, start: o.start, end: o.end };
    if (o.lessonId == null) {
      return { key: `free:${day}:${o.start}`, start: o.start, end: o.end, label: o.label, state: "free", lessonId: null, candidates: [], leadId: null, handlers: [], step: { kind: "choose", to: speakersPath({ slot }) } };
    }
    const candidates = candidatesOf(o.lessonId);
    return {
      key: `lesson:${o.lessonId}`,
      start: o.start,
      end: o.end,
      label: o.label,
      state: "draft",
      lessonId: o.lessonId,
      candidates,
      leadId: null,
      handlers: distinct(candidates.map((c) => c.handler)),
      step: draftStep(o.lessonId, candidates, slot),
    };
  });
  for (const l of week.lessons) {
    if (l.day !== day || l.kind !== "lesson" || l.state !== "closed") continue;
    const handler = closedHandler(l);
    const step: SlotStep =
      handler != null && ours.has(handler)
        ? (() => {
            const next = nextLessonStep(l, readerFilesOf(week, l.id));
            const page = next ? pageStepOf(next) : null;
            return { kind: "lesson", lessonId: l.id, step: page, to: lessonPath(l.id, page) };
          })()
        : { kind: "theirs", handlers: distinct([handler]), to: lessonPath(l.id) };
    slots.push({
      key: `lesson:${l.id}`,
      start: l.start_min,
      end: l.end_min,
      label: l.title,
      state: "closed",
      lessonId: l.id,
      candidates: [],
      leadId: model.leadOf.get(l.id)?.id ?? null,
      handlers: distinct([handler]),
      step,
    });
  }
  slots.sort((a, b) => a.start - b.start || (a.lessonId ?? -1) - (b.lessonId ?? -1));

  // the notification: lessons of the day someone outside its owners handles (in the slots' order); «חדש» on a
  // proposal made since I looked — a lesson keeps no time of its own, a pitch does
  const seen = seenAt == null ? null : Date.parse(seenAt);
  const others: OtherLesson[] = [];
  for (const c of slots) {
    if (c.lessonId == null) continue;
    const outside = c.handlers.filter((h) => !owners.includes(h));
    if (outside.length === 0) continue;
    const fresh = seen == null || Number.isNaN(seen) || week.pitches.some((p) => p.lesson_id === c.lessonId && Date.parse(p.at) > seen);
    others.push({ lessonId: c.lessonId, start: c.start, end: c.end, handlers: outside, fresh });
  }

  // the speakers who said «יכול/ה» for a slot of the day nobody is pitched for yet: mine first, then nobody's
  const empty = slots.filter((c) => c.state !== "closed" && c.candidates.length === 0);
  const speakers: DaySpeaker[] = [];
  for (const s of week.speakers) {
    if (s.retired) continue;
    const section = poolSection(model, s.id, me);
    if (section !== "mine" && section !== "free") continue;
    const fits = empty.filter((c) => fitFor(model, s.id, day, c.start, c.end) === "can").map((c) => ({ day, start: c.start, end: c.end }));
    // one slot can be twice in `empty` (a parallel pair of bare drafts): once is enough
    const unique = fits.filter((f, i) => fits.findIndex((g) => g.start === f.start && g.end === f.end) === i);
    if (unique.length > 0) speakers.push({ speakerId: s.id, mine: section === "mine", fits: unique });
  }
  const nameOf = (id: number) => model.speakerById.get(id)?.name ?? "";
  speakers.sort((a, b) => Number(b.mine) - Number(a.mine) || nameOf(a.speakerId).localeCompare(nameOf(b.speakerId), "he") || a.speakerId - b.speakerId);

  return { day, owners, partners, seenAt, slots, others, speakers };
}

/** «חדש» on any of them: the «ראיתי» button has something to clear. */
export function hasFresh(d: Pick<MyDay, "others">): boolean {
  return d.others.some((o) => o.fresh);
}
