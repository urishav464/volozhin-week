// «כל הצוות» as markup (no browser): a block per handler in their colour, «בלי אחראי/ת» folded, each speaker a link.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { teamBoard } from "../../domain/mine";
import { addApproach, addSpeaker, emptyWeek } from "../../testing/week";
import { TeamView } from "./TeamView";

describe("TeamView", () => {
  it("a block per handler, an empty one says so, the unowned folded; every speaker links to their page", () => {
    const w = emptyWeek();
    w.team = [
      { id: 2, display_name: "חניך/ה א׳", gender: null, role: "content" },
      { id: 3, display_name: "חניך/ה ב׳", gender: null, role: "content" },
    ];
    const s = addSpeaker(w, "f", "מרצה לדוגמה");
    addApproach(w, s, "claimed").owner_member_id = 2;
    const t = addSpeaker(w, "m", "מרצה לדוגמה ב");
    addApproach(w, t, "approached").owner_member_id = null;
    const out = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(TeamView, { week: w, board: teamBoard(w) })));
    expect(out).toContain('data-team-block="2"');
    expect(out).toContain('data-team-block="3"');
    expect(out).toContain('data-team-block="none"');
    expect(out).toContain("אין מרצים בטיפול.");
    expect(out).toContain(`href="/speakers/${s.id}"`);
    expect(out).toContain(`href="/speakers/${t.id}"`);
    expect(out).toContain("להתקשר");
  });
});
