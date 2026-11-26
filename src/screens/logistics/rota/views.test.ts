// The rota views as markup (no browser): the cohorts' flags on their list (v20: «עוזרת» = helps in some duty), v20's cohorts
// page (the numbers, the meals, groups only for a helping cohort, the split, the duties' order), and «מוצ״ש» as two lists —
// each its own count, the shopping list's quantities, and (writing) a paste of its own.
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { DataPort } from "../../../data/port";
import { EMPTY_ROTA, type RotaData } from "../../../data/rota";
import { emptyWeek } from "../../../testing/week";
import type { RotaCtx } from "./parts";
import { PrepTasks } from "./PrepTasks";
import { Setup } from "./Setup";

function rota(): RotaData {
  return {
    ...EMPTY_ROTA,
    cohorts: [
      { id: 1, edition_id: 1, letter: "א", name: "מכינה לדוגמה א", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 1 },
      { id: 2, edition_id: 1, letter: "ב", name: "מכינה לדוגמה ב", trainees: null, diet_veg: null, diet_gf: null, diet_both: null, contact_name: null, sort: 2, can_drive: true },
      { id: 3, edition_id: 1, letter: "נ", name: "מכינה לדוגמה נ", trainees: 30, diet_veg: 4, diet_gf: 2, diet_both: 1, contact_name: "איש/אשת קשר לדוגמה", sort: 3, can_drive: false },
    ],
    // v20: «א» and «ב» help in the one duty; «נ» in none
    duties: [{ id: 7, edition_id: 1, name: "מטבח", description: null, need_morning: 1, need_afternoon: 1, need_night: 1, min_people: null, sort: 1 }],
    cohortDuties: [
      { cohort_id: 1, duty_id: 7 },
      { cohort_id: 2, duty_id: 7 },
    ],
    prep: [
      { id: 1, edition_id: 1, text: "משימה לדוגמה א", group_id: null, done: true, sort: 1 },
      { id: 2, edition_id: 1, text: "פריט לדוגמה 1", group_id: null, done: false, sort: 2, kind: "item", qty: "2 (לדוגמה)" },
      { id: 3, edition_id: 1, text: "משימה לדוגמה ב", group_id: null, done: false, sort: 3, kind: "task", qty: null },
      { id: 4, edition_id: 1, text: "פריט לדוגמה 2", group_id: null, done: true, sort: 4, kind: "item", qty: null },
    ],
  };
}

function ctx(data: RotaData, mayWrite = true): RotaCtx {
  return {
    port: {} as DataPort,
    week: emptyWeek(),
    data,
    mayWrite,
    isAdmin: false,
    phonesAllowed: false,
    busy: null,
    act: async () => true,
    notify: () => {},
    reloadWeek: async () => {},
  };
}

const html = <P extends object>(el: FunctionComponent<P>, props: P) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(el, props)));

describe("the cohorts' flags", () => {
  it("each row says both, as attributes and (when not the default) as a chip", () => {
    const out = html(Setup, { ctx: ctx(rota()) });
    expect(out).toMatch(/data-rota-cohort="א" data-helps-rota="y" data-can-drive="-"/);
    expect(out).toMatch(/data-rota-cohort="ב" data-helps-rota="y" data-can-drive="y"/);
    expect(out).toMatch(/data-rota-cohort="נ" data-helps-rota="-" data-can-drive="-"/);
    expect(out.match(/לא עוזרת בתורנויות/g)).toHaveLength(1);
    expect(out.match(/הצוות יכול להסיע/g)).toHaveLength(1);
    // v20: a cohort's trainees, diets and contact on its line (TBD where not typed)
    expect(out).toContain("30 חניכים");
    expect(out).toContain("איש/אשת קשר: איש/אשת קשר לדוגמה");
    expect(out).toContain("חניכים: TBD");
  });
});

describe("v20: «קבוצות ומכינות»", () => {
  /** The fixture with groups for «א», a second duty only «א» helps in, and «א» on campus all week. */
  function more(): RotaData {
    const d = rota();
    d.cohorts[0] = { ...d.cohorts[0], trainees: 23, diet_veg: 3, diet_gf: 2, diet_both: 1 };
    d.duties.push({ id: 8, edition_id: 1, name: "נקיון", description: null, need_morning: 1, need_afternoon: 1, need_night: null, min_people: null, sort: 2 });
    d.cohortDuties.push({ cohort_id: 1, duty_id: 8 });
    d.groups = [
      { id: 11, edition_id: 1, cohort_id: 1, number: 1, size: 8, head_name: null },
      { id: 12, edition_id: 1, cohort_id: 1, number: 2, size: 8, head_name: null },
    ];
    d.presence = [0, 1, 2, 3, 4].flatMap((day) => [0, 1, 2].map((shift) => ({ cohort_id: d.cohorts[0].id, day, shift }) as RotaData["presence"][number]));
    return d;
  }

  it("a cohort's line: its numbers, the duties it helps in (none: the one chip), its contact", () => {
    const out = html(Setup, { ctx: ctx(more()) });
    expect(out).toContain("23 חניכים · צמחוני/טבעוני 3 · ללא גלוטן 2 · מהם גם וגם 1 · 2 קבוצות");
    expect(out).toContain("עוזרת ב: מטבח, נקיון");
    expect(out).toContain("עוזרת ב: מטבח");
    expect(out).toContain("חניכים: TBD · תזונה: TBD · בלי קבוצות");
    expect(out).toContain("איש/אשת קשר מהצוות: עוד לא נקבע/ה");
  });

  it("the meals under the cohorts — TBD while a cohort is not marked on campus, and which one", () => {
    const out = html(Setup, { ctx: ctx(more()) });
    expect(out).toContain("data-rota-food");
    expect(out).toContain("לא סומן מתי בקמפוס: מכינה לדוגמה ב, מכינה לדוגמה נ");
    expect(out).toContain('href="/print/rota?view=food"');
    const marked = more();
    marked.presence.push({ cohort_id: 2, day: 1, shift: 0 }, { cohort_id: 3, day: 1, shift: 0 });
    const ok = html(Setup, { ctx: ctx(marked) });
    expect(ok).not.toContain("לא סומן מתי בקמפוס");
    expect(ok).toContain("ארוחת צהריים / חבורות"); // the grid's meals, by their labels
  });

  it("groups only for a cohort that helps: the split per helping cohort, the new group's cohorts the helping ones", () => {
    const out = html(Setup, { ctx: ctx(more()) });
    expect(out).toContain("מכינה לדוגמה נ לא עוזרת באף תורנות, ולכן אין לה קבוצות.");
    // «א» has groups: «חלוקה מחדש», folded; «ב» has none and no trainees yet: asked for them first
    expect(out).toContain("חלוקה מחדש");
    expect(out).toContain('data-split="א"');
    expect(out).toContain("כדי לחלק, קודם כותבים כמה חניכים יש במכינה לדוגמה ב");
    expect(out).toContain("בקבוצות 16 מתוך 23 החניכים");
    const select = out.slice(out.indexOf('aria-label="קבוצה חדשה"'));
    expect(select).toContain("א · מכינה לדוגמה א");
    expect(select).toContain("ב · מכינה לדוגמה ב");
    expect(select).not.toContain("נ · מכינה לדוגמה נ");
    // a reader: no split, no new group
    const reader = html(Setup, { ctx: ctx(more(), false) });
    expect(reader).not.toContain("data-split");
    expect(reader).not.toContain('aria-label="קבוצה חדשה"');
  });

  it("the duties: in their order with «למעלה» / «למטה» and the hint, which cohorts help in each — no «סדר» field", () => {
    const out = html(Setup, { ctx: ctx(more()) });
    expect(out).toContain("הסדר כאן הוא הסדר בלוח ובדפים. כשאין מספיק קבוצות, התורנות שלמעלה מתמלאת קודם.");
    expect(out).toContain('aria-label="הזזה למעלה: נקיון"');
    expect(out).toContain('aria-label="הזזה למטה: מטבח"');
    expect(out).toContain("מכינות שעוזרות בה: א, ב");
    expect(out).toContain("מכינות שעוזרות בה: א");
    expect(out).not.toMatch(/>סדר</);
    // one duty: nothing to order
    const one = html(Setup, { ctx: ctx(rota()) });
    expect(one).not.toContain("הזזה למעלה");
    expect(one).not.toContain("data-duty-order");
    // a duty nobody helps in says what it means
    const lonely = rota();
    lonely.cohortDuties = [];
    expect(html(Setup, { ctx: ctx(lonely) })).toContain("אף מכינה לא עוזרת בה: ההצעה לא תמלא אותה.");
  });
});

describe("«מוצ״ש»: two lists", () => {
  it("the tasks and the shopping list apart, each numbered and counted by itself; an item's quantity", () => {
    const out = html(PrepTasks, { ctx: ctx(rota()) });
    expect(out).toContain('data-prep-list="task"');
    expect(out).toContain('data-prep-list="item"');
    expect(out).toContain("בוצעו 1 מתוך 2");
    expect(out).toContain("נקנו 1 מתוך 2");
    expect(out.match(/data-prep="\d"/g)).toEqual(['data-prep="1"', 'data-prep="2"']);
    expect(out.match(/data-prep-item="\d"/g)).toEqual(['data-prep-item="1"', 'data-prep-item="2"']);
    expect(out).toContain('data-qty="2 (לדוגמה)"');
    expect(out.match(/data-qty=/g)).toHaveLength(1); // an item without a quantity says none
    // writing: a form and a paste per list, the shopping list's own words
    expect(out).toContain('aria-label="פריט חדש"');
    expect(out).toContain("הדבקת רשימת קניות");
    expect(out).toContain("שורה לכל פריט. את הכמות כותבים אחרי טאב (כמו עמודה שנייה בגיליון).");
    expect(out).toContain('aria-label="נקנה: פריט 2"');
  });

  it("empty lists say so; a reader sees no form and no paste", () => {
    const out = html(PrepTasks, { ctx: ctx({ ...EMPTY_ROTA }, false) });
    expect(out).toContain("עוד אין משימות.");
    expect(out).toContain("עוד אין פריטים ברשימת הקניות.");
    expect(out).not.toContain("הדבקת רשימה");
    expect(out).not.toContain("<form");
  });
});
