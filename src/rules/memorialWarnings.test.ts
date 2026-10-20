// The memorial warnings (milestone 5ב-2), in the warnings drawer with the others: a plan longer than its slot is
// a fact and always warned; past the policy's most minutes, and a slot next to a meal, only once the staff meeting
// set the policy (settings.memorial — never seeded). Memorial slots never count in the day's balance or loads.
import { describe, expect, it } from "vitest";
import { addLesson, addSpeaker, closeWith, emptyWeek } from "../testing/week";
import type { MemorialPlan, Week } from "../domain/types";
import { categoryLoad, dayBalance } from "./balance";
import { isMealRow, warningsFor } from "./warnings";

function withPlan(w: Week, lessonId: number | null, planned: number | null, fallen = 1): MemorialPlan {
  const p: MemorialPlan = { id: w.memorialPlans.length + 1, fallen_id: fallen, lesson_id: lessonId, family_status: "confirmed", speaker_text: null, planned_minutes: planned, hard_stop: false, materials_note: null, version: 1 };
  w.memorialPlans.push(p);
  if (!w.fallen.some((f) => f.id === fallen)) w.fallen.push({ id: fallen, name: `חלל/ה לבדיקה ${fallen}`, gender: null });
  return p;
}
const memorialKinds = (w: Week) => warningsFor(w).filter((x) => x.kind.startsWith("memorial")).map((x) => x.kind).sort();

describe("memorial warnings", () => {
  it("say a plan is longer than its slot — always, policy or not", () => {
    const w = emptyWeek();
    const slot = addLesson(w, 0, 780, 795, { kind: "memorial" });
    withPlan(w, slot.id, 15);
    expect(memorialKinds(w)).toEqual([]); // exactly the slot
    w.memorialPlans[0].planned_minutes = 20;
    const [x] = warningsFor(w).filter((y) => y.kind === "memorial_over_slot");
    expect(x).toMatchObject({ severity: "warn", day: 0, lessonIds: [slot.id] });
    expect(x.message).toBe("«חלל/ה לבדיקה 1»: 20 דקות מתוכננות, והמשבצת 15 דקות (ראשון 13:00–13:15)");
    // a plan in the tray, or with no minutes yet, says nothing
    withPlan(w, null, 99, 2);
    withPlan(w, addLesson(w, 1, 780, 795, { kind: "memorial" }).id, null, 3);
    expect(memorialKinds(w)).toEqual(["memorial_over_slot"]);
  });

  it("hold a plan to the policy's most minutes only once the staff meeting set it", () => {
    const w = emptyWeek();
    const slot = addLesson(w, 0, 780, 795, { kind: "memorial" });
    withPlan(w, slot.id, 12);
    expect(memorialKinds(w)).toEqual([]); // no policy: nothing but the slot's length
    w.edition.settings.memorial = { placement: "לבדיקה" };
    expect(memorialKinds(w)).toEqual([]); // a placement alone sets no number
    w.edition.settings.memorial = { max_minutes: 10 };
    expect(memorialKinds(w)).toEqual(["memorial_too_long"]);
    expect(warningsFor(w).find((x) => x.kind === "memorial_too_long")!.message).toBe("«חלל/ה לבדיקה 1»: 12 דקות מתוכננות, יותר מ-10 שנקבעו במדיניות (ראשון 13:00–13:15)");
    w.edition.settings.memorial = { max_minutes: 12 };
    expect(memorialKinds(w)).toEqual([]);
  });

  it("say a slot is next to a meal only when the policy asks — any slot, planned or not", () => {
    const w = emptyWeek();
    const before = addLesson(w, 0, 780, 795, { kind: "memorial" }); // lunch begins at 13:15
    const after = addLesson(w, 1, 855, 870, { kind: "memorial" }); // lunch ends at 14:15
    addLesson(w, 2, 780, 790, { kind: "memorial" }); // 13:00–13:10: five minutes before lunch, not next to it
    expect(memorialKinds(w)).toEqual([]);
    w.edition.settings.memorial = { warn_adjacent_meal: false };
    expect(memorialKinds(w)).toEqual([]);
    w.edition.settings.memorial = { warn_adjacent_meal: true };
    const near = warningsFor(w).filter((x) => x.kind === "memorial_near_meal");
    expect(near.map((x) => x.lessonIds[0])).toEqual([before.id, after.id]);
    expect(near[0].message).toBe("זמן זיכרון צמוד ל«ארוחת צהריים / חבורות» (ראשון 13:00–13:15)");
    // a cancelled slot is no slot
    before.state = "cancelled";
    expect(warningsFor(w).filter((x) => x.kind === "memorial_near_meal").map((x) => x.lessonIds[0])).toEqual([after.id]);
  });

  it("know a meal by its row: a fixed row whose label begins «ארוחת»", () => {
    expect(isMealRow({ kind: "fixed", label: "ארוחת ערב / חבורות" })).toBe(true);
    expect(isMealRow({ kind: "fixed", label: "דרך ארץ — חבורות לימוד בהובלת החניכים" })).toBe(false);
    expect(isMealRow({ kind: "kk", label: "ארוחת" })).toBe(false);
  });

  it("never count a memorial slot in the day's gender balance or category load", () => {
    const w = emptyWeek();
    closeWith(w, addLesson(w, 0, 510, 600, { title: "א", category_id: 1 }), addSpeaker(w, "m"));
    const before = { balance: dayBalance(0, w, 0), load: categoryLoad(0, w.lessons) };
    const slot = addLesson(w, 0, 780, 795, { kind: "memorial", state: "closed", category_id: 1 });
    withPlan(w, slot.id, 10);
    expect(dayBalance(0, w, 0)).toEqual(before.balance);
    expect(categoryLoad(0, w.lessons)).toEqual(before.load);
    expect(warningsFor(w).filter((x) => x.lessonIds.includes(slot.id)).map((x) => x.kind)).toEqual([]);
  });
});
