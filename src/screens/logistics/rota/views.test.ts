// The rota views as markup (no browser): v19's cohort flags on the cohorts' list, and «מוצ״ש» as two lists — each its
// own count, the shopping list's quantities, and (writing) a paste of its own.
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
      { id: 1, edition_id: 1, letter: "א", name: "מכינה לדוגמה א", diets: [], sort: 1 },
      { id: 2, edition_id: 1, letter: "ב", name: "מכינה לדוגמה ב", diets: [], sort: 2, helps_rota: true, can_drive: true },
      { id: 3, edition_id: 1, letter: "נ", name: "מכינה לדוגמה נ", diets: [], sort: 3, helps_rota: false, can_drive: false },
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
