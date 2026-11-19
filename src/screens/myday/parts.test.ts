// «היום שלי» / «ימים» pieces as markup (no browser): the hand-overs offered to me, and a slot handled outside the pair.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { myDay, offeredTo } from "../../domain/myDay";
import { buildModel } from "../../grid/model";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek } from "../../testing/week";
import { OffersLine, SlotRow } from "./parts";

const inRouter = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(MemoryRouter, null, el));

describe("OffersLine", () => {
  it("one offer, several, none", () => {
    const w = emptyWeek();
    const a = addSpeaker(w, "f", "מרצה לדוגמה");
    const b = addSpeaker(w, "m", "מרצה לדוגמה ב");
    addApproach(w, a, "claimed").offered_to = 2;
    const model = buildModel(w);
    const one = inRouter(createElement(OffersLine, { model, offers: offeredTo(w, 2) }));
    expect(one).toContain("הוצע/ה לך מרצה אחד/ת:");
    expect(one).toContain(`data-offer="${a.id}"`);
    expect(one).toContain(`href="/speakers/${a.id}"`);
    addApproach(w, b, "claimed").offered_to = 2;
    expect(inRouter(createElement(OffersLine, { model: buildModel(w), offers: offeredTo(w, 2) }))).toContain("הוצעו לך 2 מרצים:");
    expect(inRouter(createElement(OffersLine, { model, offers: [] }))).toBe("");
  });
});

describe("SlotRow on «ימים»", () => {
  it("a closed lesson handled outside the pair: highlighted, its handler named, its step offered", () => {
    const w = emptyWeek();
    w.team = [
      { id: 1, display_name: "מדריך/ה", gender: null, role: "admin" },
      { id: 4, display_name: "חניך/ה ג׳", gender: null, role: "content" },
    ];
    w.dayOwners = [{ day: 1, member_id: 1, seen_at: null }];
    const s = addSpeaker(w, "f", "מרצה לדוגמה");
    Object.assign(addApproach(w, s, "positive"), { owner_member_id: 4 });
    const l = closeWith(w, addLesson(w, 1, 510, 600), s);
    const model = buildModel(w);
    const d = myDay(model, 1, 1, { staff: true });
    const card = d.slots.find((c) => c.lessonId === l.id)!;
    const out = inRouter(createElement(SlotRow, { model, card, viewer: 1, nameOf: (id: number) => model.memberName.get(id) ?? "", showHandler: true, exception: true }));
    expect(out).toContain('data-exception="true"');
    expect(out).toContain("בטיפול חניך/ה ג׳");
    expect(out).toContain(`href="/lesson/${l.id}?step=msg"`);
  });
});
