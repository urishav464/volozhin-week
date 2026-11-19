// The lesson page's stepper (the reset, phase 2): a lesson's whole way in six steps, in order — שיבוץ → סגירה → תשלום
// והסעה → הודעת סיכום → מקורות ומצגת → מלווה — each with where it stands. A draft is the first two (the candidates and
// the call, then what closing waits for); a closed lesson is its five stages (src/domain/stages.ts — the card's dots,
// «ימים», «התקדמות» and the tracking table say the same), the sources and the reader read as one step. Pure.
import { displayName } from "../../domain/names";
import type { PageStep } from "../../domain/routes";
import { readerFilesOf, type Stage, type StageState, stagesOf } from "../../domain/stages";
import { type ApproachStatus, type Lesson, LIVE_PITCH, type Pitch, type Speaker } from "../../domain/types";
import { errorMessage } from "../../errors";
import { type GridModel, pitchSpeaker } from "../../grid/model";
import { statusLabel, vettingLabel } from "../../lib/labels";

export const PAGE_STEP_LABEL: Record<PageStep, string> = {
  place: "שיבוץ",
  close: "סגירה",
  pay: "תשלום והסעה",
  msg: "הודעת סיכום",
  sources: "מקורות ומצגת",
  escort: "מלווה",
};

export interface PageStepView {
  key: PageStep;
  label: string;
  state: StageState;
  note: string;
}

/** A draft's steps after closing: nothing to do there yet. */
export const AFTER_CLOSING = "אחרי הסגירה";

/** Which of two states says more is left to do: a problem, then a step to take, then a wait, then done, then not needed. */
const WEIGHT: Record<StageState, number> = { na: 0, done: 1, waiting: 2, open: 3, problem: 4 };

/** «מקורות ומצגת»: the sources and the reader as one step — the worse of the two; the reader's word added when it is the worse. */
export function sourcesStep(sources: Stage, reader: Stage): Pick<PageStepView, "state" | "note"> {
  if (WEIGHT[reader.state] > WEIGHT[sources.state]) return { state: reader.state, note: `${sources.note} · ${reader.note}` };
  return { state: sources.state, note: sources.note };
}

/** A candidate as the steps read them: the pitch, its speaker and where the call stands (a pitch declined on its own reads as declined). */
interface Candidate {
  pitch: Pitch;
  speaker: Speaker | undefined;
  status: ApproachStatus;
}

function candidatesOf(model: GridModel, l: Lesson): Candidate[] {
  return (model.pitchesByLesson.get(l.id) ?? [])
    .filter((p) => LIVE_PITCH.has(p.state))
    .map((p) => ({ pitch: p, speaker: pitchSpeaker(model, p), status: p.state === "declined" ? "declined" : (model.approachById.get(p.approach_id)?.status ?? "claimed") }));
}

const nameOf = (c: Candidate) => (c.speaker ? displayName(c.speaker) : "מרצה");

/** «שיבוץ» of a draft: no candidate yet, one who agreed, or where the furthest call stands (the model sorts them so). */
function placeStep(cands: Candidate[]): Pick<PageStepView, "state" | "note"> {
  const live = cands.filter((c) => c.status !== "declined");
  if (live.length === 0) return { state: "open", note: cands.length > 0 ? "המועמדים סירבו: לבחור מרצה אחר/ת" : "עוד אין מועמד/ת" };
  const best = live[0];
  const more = live.length > 1 ? ` (ועוד ${live.length - 1})` : "";
  const note = `${nameOf(best)} · ${statusLabel(best.status, best.speaker?.gender ?? null)}${more}`;
  if (best.status === "positive") return { state: "done", note };
  // talked and waiting for their answer: on the speaker; before the call or no answer: a call to make
  return { state: best.status === "approached" ? "waiting" : "open", note };
}

/** «סגירה» of a draft: what closing waits for — a yes, the instructor's approval, the speaker's gender — or that it can close. */
function closeStep(cands: Candidate[]): Pick<PageStepView, "state" | "note"> {
  const agreed = cands.filter((c) => c.status === "positive" && c.speaker);
  if (agreed.length === 0) return { state: "waiting", note: "אחרי שמרצה מסכים/ה" };
  const ready = agreed.find((c) => c.speaker!.vetted === "approved" && c.speaker!.gender != null);
  if (ready) return { state: "open", note: `אפשר לסגור עם ${nameOf(ready)}` };
  const s = agreed[0].speaker!;
  if (s.vetted === "pending") return { state: "waiting", note: errorMessage("not_vetted") };
  if (s.vetted === "rejected") return { state: "problem", note: `${nameOf(agreed[0])} ${vettingLabel("rejected", s.gender)} על ידי המדריך/ה` };
  return { state: "problem", note: errorMessage("gender_unknown") };
}

/**
 * The six steps of a lesson's page, in order. A memorial slot has none (it is worked in «זמני זיכרון»), nor has a
 * cancelled lesson.
 */
export function pageSteps(model: GridModel, l: Lesson): PageStepView[] {
  if (l.kind !== "lesson" || l.state === "cancelled") return [];
  // the page's own names (a stage's «תשלום/הסעה» is «תשלום והסעה» here): only the state and the note are the stage's
  const step = (key: PageStep, s: Pick<PageStepView, "state" | "note">): PageStepView => ({ key, label: PAGE_STEP_LABEL[key], state: s.state, note: s.note });
  if (l.state === "draft") {
    const cands = candidatesOf(model, l);
    const after = { state: "na", note: AFTER_CLOSING } as const;
    return [step("place", placeStep(cands)), step("close", closeStep(cands)), step("pay", after), step("msg", after), step("sources", after), step("escort", after)];
  }
  const lead = model.leadOf.get(l.id);
  const co = model.week.lessonSpeakers.filter((x) => x.lesson_id === l.id && x.role === "co").length;
  const [pay, msg, escort, sources, reader] = stagesOf(l, readerFilesOf(model.week, l.id));
  return [
    step("place", { state: "done", note: `${lead ? displayName(lead) : "המרצה"}${co > 0 ? ` ועוד ${co === 1 ? "מרצה אחד/ת" : `${co} מרצים`}` : ""}` }),
    step("close", { state: "done", note: "נסגר" }),
    step("pay", pay),
    step("msg", msg),
    step("sources", sourcesStep(sources, reader)),
    step("escort", escort),
  ];
}

/** The step the page opens at when its address names none: the first with something left to do (none: the first). */
export function firstOpenStep(steps: readonly PageStepView[]): PageStep | null {
  return (steps.find((s) => s.state !== "done" && s.state !== "na") ?? steps[0])?.key ?? null;
}
