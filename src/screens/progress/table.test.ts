// The progress table as markup (no browser): a row per lesson with the six steps, each cell its word and a link to
// that step of the lesson page; a draft's steps after closing say nothing; the phone's cards carry the same hooks.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { buildModel } from "../../grid/model";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek, pitch } from "../../testing/week";
import { ProgressTable } from "./ProgressTable";

function fixture() {
  const w = emptyWeek();
  w.team = [{ id: 2, display_name: "חניך/ה א׳", gender: null, role: "content" }];
  const s = addSpeaker(w, "f", "מרצה לדוגמה");
  Object.assign(addApproach(w, s, "positive"), { owner_member_id: 2 });
  const closed = closeWith(w, addLesson(w, 0, 510, 600, { pay_amount: 300, approval: "pending" }), s);
  const draft = addLesson(w, 1, 600, 690);
  pitch(w, draft, addApproach(w, addSpeaker(w, "m"), "claimed"), "candidate");
  return { w, closed, draft };
}
const html = (wide: boolean) => {
  const { w, closed, draft } = fixture();
  return { closed, draft, out: renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ProgressTable, { model: buildModel(w), wide }))) };
};

describe("ProgressTable", () => {
  it("wide: the day headings, a row per lesson, six step cells each linking to its step", () => {
    const { out, closed, draft } = html(true);
    expect(out).toContain("<table");
    expect(out).toContain("יום ראשון");
    expect(out).toContain(`data-progress-row="${closed.id}"`);
    expect(out).toContain(`data-progress-row="${draft.id}" data-draft="true"`);
    expect(out.match(/data-step-cell=/g)).toHaveLength(12);
    expect(out).toContain(`href="/lesson/${closed.id}?step=pay"`);
    expect(out).toContain(`data-step-cell="pay" data-state="waiting"`);
    // a draft's steps after closing: no link
    expect(out).not.toContain(`href="/lesson/${draft.id}?step=pay"`);
    expect(out).toContain(`href="/lesson/${draft.id}?step=place"`);
    expect(out).toContain("חניך/ה א׳");
  });

  it("phone: a card per lesson, no table, the next step in words", () => {
    const { out, closed } = html(false);
    expect(out).not.toContain("<table");
    expect(out).toContain(`data-progress-row="${closed.id}"`);
    expect(out.match(/data-step-cell=/g)).toHaveLength(12);
    expect(out).toContain("הבא: תשלום והסעה");
  });
});
