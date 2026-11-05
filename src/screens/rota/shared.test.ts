// The rota screens' parts that need no browser: who is offered «כולל טלפונים של ראשי הקבוצות»
// (maySeeRotaContacts ≡ app.may_see_rota_contacts: a global admin, or an edition's admin or logistics member in a
// real edition that is not archived), and a group's page as markup (GroupSheet): one page per group — a page break
// before every one but the first —, five days, a band per shift naming the duty, the ranges left to right, no phone.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RotaData } from "../../data/rota";
import type { Edition } from "../../domain/types";
import { groupScheduleInputs, groupWeek } from "../../exports/rota";
import { addLesson, addSpeaker, closeWith, emptyWeek } from "../../testing/week";
import { GroupSheet } from "../outputs/GroupSheet";
import { maySeeRotaContacts } from "./shared";

describe("who is offered the heads' phones", () => {
  it("a global admin always; an edition's admin or logistics member only in a real edition not archived; content never", () => {
    const kinds: Edition["kind"][] = ["real", "practice", "demo", "archive"];
    const statuses: Edition["status"][] = ["planning", "active", "archived"];
    for (const kind of kinds) {
      for (const status of statuses) {
        const e = { kind, status };
        const live = kind === "real" && status !== "archived";
        expect(maySeeRotaContacts({ global: true, role: "admin" }, e), `global ${kind} ${status}`).toBe(true);
        expect(maySeeRotaContacts({ global: false, role: "admin" }, e), `admin ${kind} ${status}`).toBe(live);
        expect(maySeeRotaContacts({ global: false, role: "logistics" }, e), `logistics ${kind} ${status}`).toBe(live);
        expect(maySeeRotaContacts({ global: false, role: "content" }, e), `content ${kind} ${status}`).toBe(false);
      }
    }
  });
});

describe("a group's page", () => {
  const w = emptyWeek();
  closeWith(w, addLesson(w, 0, 510, 600, { title: "שיעור לדוגמה" }), addSpeaker(w, "f", "מרצה לדוגמה"));
  const data: RotaData = {
    cohorts: [{ id: 1, edition_id: 1, letter: "א", name: "מכינה לדוגמה א", diets: [], sort: 1 }],
    presence: [],
    groups: [
      { id: 11, edition_id: 1, cohort_id: 1, number: 1, size: 8, head_name: "ראש/ת קבוצה לדוגמה 1" },
      { id: 12, edition_id: 1, cohort_id: 1, number: 2, size: null, head_name: null },
    ],
    duties: [{ id: 1, edition_id: 1, name: "מטבח", description: null, need_morning: 1, need_afternoon: 1, need_night: 1, min_people: null, sort: 1 }],
    assignments: [{ id: 1, edition_id: 1, day: 0, shift: 0, duty_id: 1, group_id: 11, source: "hand" }],
    staff: [],
    prep: [],
  };
  const [a, b] = groupScheduleInputs(w, data);
  const html = (g: typeof a, first: boolean) => renderToStaticMarkup(createElement(GroupSheet, { week: groupWeek(g.input), first, printed: "הודפס ב-5.11.2026" }));

  it("is one section per group, a page break before every one but the first, five days and a band per shift", () => {
    const one = html(a, true);
    const two = html(b, false);
    expect(one).toMatch(/^<section data-group-sheet="א1"/);
    expect(one).not.toContain("print:break-before-page");
    expect(two).toContain('data-group-sheet="א2"');
    expect(two).toContain("print:break-before-page");
    expect(one.match(/data-group-day="/g)).toHaveLength(5);
    expect(one.match(/data-shift="/g)).toHaveLength(14); // Thursday has no night
    expect(one).toContain('data-duty-band="מטבח"');
    expect(one).toContain("תורנות: מטבח");
    expect(one).toContain("בלי תורנות");
    expect(one).toContain('<bdi dir="ltr" class="font-normal whitespace-nowrap text-ink-soft">08:30–14:30</bdi>');
    expect(one).toContain("שיעור לדוגמה · מרצה לדוגמה");
    expect(two).toContain("גודל: TBD");
    expect(two).toContain("ראש/ת קבוצה: TBD");
    expect(one + two).not.toMatch(/טלפון/);
  });
});
