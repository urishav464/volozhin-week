// Escorts (DESIGN «מלווים», «תוצרים» 2): each trainee's load, the night's
// self-introduction suggestion, and a lesson's «משהו שחשוב לדעת» composed from
// the instructor's duty phrases (editions.settings.duty_phrases — pasted from
// last year's escorts file, never ours). Pure, from a loaded Week.
import type { DutyPhrase, DutyWhen, EscortTick, Lesson, TickItem, Week } from "./types";

/**
 * «הצגה עצמית» is suggested for lessons from 22:30 to 06:30 — DESIGN's default,
 * still an open question of the decision gate, so «הצעה». The screen pre-fills
 * it; nothing stores it until someone saves the escort.
 */
export const SELF_INTRO_FROM = 1350;

export function suggestSelfIntro(l: Pick<Lesson, "start_min">): boolean {
  return l.start_min >= SELF_INTRO_FROM;
}

/**
 * A lesson an escort goes with: a closed lesson — or a memorial slot, whose escort is the family's liaison
 * («בזמני זיכרון, המלווה הוא איש הקשר של המשפחה»; set once a plan is placed, gone when it leaves). The escort's
 * link, the escorts' list and the links tab list these.
 */
export function escortable(l: Pick<Lesson, "state" | "kind">): boolean {
  return l.state !== "cancelled" && (l.state === "closed" || l.kind === "memorial");
}

/** How many lessons each trainee escorts (cancelled ones aside). */
export function escortLoad(week: Pick<Week, "lessons">): Map<number, number> {
  const out = new Map<number, number>();
  for (const l of week.lessons) {
    if (l.state === "cancelled" || l.escort_roster_id == null) continue;
    out.set(l.escort_roster_id, (out.get(l.escort_roster_id) ?? 0) + 1);
  }
  return out;
}

/** The lesson facts a duty phrase can apply to, as the settings tab names them. */
export const DUTY_WHEN_LABEL: Record<DutyWhen, string> = {
  always: "כל שיעור",
  self_intro: "הצגה עצמית",
  escort_intro: "המלווה מציג/ה את המרצה",
  transport: "הסעה שאושרה",
  memorial: "זמן זיכרון",
};

export function dutyApplies(when: DutyWhen, l: Pick<Lesson, "kind" | "self_intro" | "transport" | "approval">): boolean {
  switch (when) {
    case "always":
      return true;
    case "self_intro":
      return l.self_intro;
    case "escort_intro":
      return l.kind === "lesson" && !l.self_intro;
    case "transport":
      return l.transport !== "none" && l.approval === "approved";
    case "memorial":
      return l.kind === "memorial";
  }
}

/** A lesson's duty notes: the instructor's phrases that apply to it, in their order. Never the amount. */
export function dutyNotes(l: Pick<Lesson, "kind" | "self_intro" | "transport" | "approval">, phrases: readonly DutyPhrase[] | null | undefined): string[] {
  return (phrases ?? []).filter((p) => dutyApplies(p.when, l)).map((p) => p.text);
}

/** The four ticks in the escort's own words, on their link's page (DESIGN «קישור המלווה»). */
export const TICK_LABEL: Record<TickItem, string> = {
  reminded: "הזכרתי למרצה",
  met: "פגשתי בחניה",
  introduced: "הצגתי את המרצה",
  gift: "נתתי מתנה",
};

/** The same four as the team reads them, in the lesson panel and the escorts' list. */
export const TICK_TEAM_LABEL: Record<TickItem, string> = {
  reminded: "תזכורת למרצה",
  met: "פגישה בחניה",
  introduced: "הצגה",
  gift: "מתנה",
};

/** When each of a lesson's four ticks was made (the first time), or null — from the week's ticks. */
export function ticksOf(ticks: readonly EscortTick[], lessonId: number): Record<TickItem, string | null> {
  const at = (item: TickItem) => ticks.find((t) => t.lesson_id === lessonId && t.item === item)?.at ?? null;
  return { reminded: at("reminded"), met: at("met"), introduced: at("introduced"), gift: at("gift") };
}
