// The «אחריות» lens drawn (no browser): a card handled outside its day's pair is marked «חריג» (a hook, a chip, the
// word in its accessible name); a day with no pair marks nothing; the day header names the pair only in that lens.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek } from "../testing/week";
import type { Week } from "../domain/types";
import { DayHeader } from "./DayHeader";
import { type Lens, LessonCard } from "./LessonCard";
import { buildModel } from "./model";
import { ownerColors } from "./owners";

function fixture() {
  const w: Week = emptyWeek();
  w.team = [
    { id: 2, display_name: "חניך/ה א׳", gender: null, role: "content" },
    { id: 3, display_name: "חניך/ה ב׳", gender: null, role: "content" },
    { id: 4, display_name: "חניך/ה ג׳", gender: null, role: "content" },
  ];
  w.dayOwners = [
    { day: 1, member_id: 2, seen_at: null },
    { day: 1, member_id: 3, seen_at: null },
  ];
  const s = addSpeaker(w, "f", "מרצה לדוגמה");
  Object.assign(addApproach(w, s, "positive"), { owner_member_id: 4 });
  const monday = closeWith(w, addLesson(w, 1, 510, 600), s);
  const t = addSpeaker(w, "m");
  Object.assign(addApproach(w, t, "positive"), { owner_member_id: 4 });
  const tuesday = closeWith(w, addLesson(w, 2, 510, 600), t);
  return { w, monday, tuesday };
}

const card = (w: Week, lessonId: number, lens: Lens) => {
  const model = buildModel(w);
  const owners = { colorOf: new Map(ownerColors(w.team).map((o) => [o.id, o.color])), only: null };
  return renderToStaticMarkup(createElement(LessonCard, { model, lesson: w.lessons.find((l) => l.id === lessonId)!, lens, owners, height: 80, onOpen: () => undefined }));
};

describe("the «אחריות» lens", () => {
  it("marks a card handled outside its day's pair — and only in that lens", () => {
    const { w, monday } = fixture();
    const out = card(w, monday.id, "owner");
    expect(out).toContain('data-exception="true"');
    expect(out).toContain("חריג: בטיפול מי שאינו מהזוג של היום");
    expect(out).toContain(">חריג<");
    expect(card(w, monday.id, "diversity")).not.toContain("data-exception");
  });

  it("a day with no pair marks nothing", () => {
    const { w, tuesday } = fixture();
    expect(card(w, tuesday.id, "owner")).not.toContain("data-exception");
  });

  it("the day header names the pair, or says there is none", () => {
    const { w } = fixture();
    const model = buildModel(w);
    const head = (day: 1 | 2, pairLine: boolean) => renderToStaticMarkup(createElement(DayHeader, { model, dm: model.days[day], pairLine }));
    expect(head(1, true)).toContain('data-day-pair="2,3"');
    expect(head(1, true)).toContain("הזוג: חניך/ה א׳ ו-חניך/ה ב׳");
    expect(head(2, true)).toContain("אין זוג ליום");
    expect(head(1, false)).not.toContain("data-day-pair");
  });
});
