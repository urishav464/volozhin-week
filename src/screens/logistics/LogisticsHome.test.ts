// The logistics home and its strip as markup (no browser): the groups and the tasks with their hooks (each task's title a
// link to its page, its state, its line), «קרוב לשבוע»'s line; the strip's addresses (no tab = the home, an unknown one
// = back home); the transport board's cohorts that can drive (names only, those on campus first).
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { EMPTY_ROTA } from "../../data/rota";
import { emptyWeek } from "../../testing/week";
import { driveCohorts } from "./lanes";
import { TaskGroups } from "./LogisticsHome";
import { LOGISTICS_TABS, logisticsPageOf, logisticsPath } from "./LogisticsScreen";
import { logisticsTasks } from "./tasks";
import { DriveCohorts } from "./TransportBoard";

function html<P extends object>(el: FunctionComponent<P>, props: P): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(el, props)));
}

describe("the home's markup", () => {
  it("three groups, nine tasks, each title a link to its page with its state and line", () => {
    const { groups } = logisticsTasks({ week: emptyWeek(), rota: null, kk: { groups: [], leaders: [], signups: [], orders: [] }, transports: null, mayDecide: false }, "2027-01-24T10:00:00Z");
    const out = html(TaskGroups, { groups });
    expect([...out.matchAll(/data-task-group="(\w+)"/g)].map((m) => m[1])).toEqual(["start", "content", "near"]);
    expect([...out.matchAll(/data-task="(\w+)" data-state="(\w+)"/g)].map((m) => [m[1], m[2]])).toEqual([
      ["presence", "unknown"],
      ["assign", "unknown"],
      ["requests", "unknown"],
      ["books", "empty"],
      ["prints", "empty"],
      ["drivers", "unknown"],
      ["payments", "empty"],
      ["reader", "empty"],
      ["prep", "unknown"],
    ]);
    expect(out).toContain('href="/logistics/rota/setup"');
    expect(out).toContain('href="/approvals"');
    expect(out).toContain('href="/reader"');
    expect(out).toMatch(/<a[^>]*class="[^"]*min-h-11[^"]*"[^>]*href="\/logistics\/books"[^>]*>ספרים<\/a>/);
    expect(out).toMatch(/data-week-line="true"[^>]*>בעוד 21 ימים</);
    expect(out).toContain("לא נטען");
    expect(out).toContain("לא זמין במחזור הזה");
    expect(out).toContain("לא ידוע");
    // the link reads its state and its line after its name
    const link = /<a[^>]*aria-describedby="([^"]+)"[^>]*>נוכחות המכינות<\/a>/.exec(out);
    expect(link).not.toBeNull();
    for (const id of link![1].split(" ")) expect(out).toContain(`id="${id}"`);
  });
});

describe("the strip's addresses", () => {
  it("«בית» first and at /logistics itself; «הסעות וצוות» at /logistics/transports", () => {
    expect(LOGISTICS_TABS.map(([k, t]) => [logisticsPath(k), t])).toEqual([
      ["/logistics", "בית"],
      ["/logistics/transports", "הסעות וצוות"],
      ["/logistics/payments", "תשלומים"],
      ["/logistics/books", "ספרים"],
      ["/logistics/prints", "הדפסות"],
      ["/logistics/rota", "תורנויות"],
    ]);
  });

  it("no tab = the home; a tab of the strip = itself; anything else (even «home») = null, sent back home", () => {
    expect(logisticsPageOf(undefined)).toBe("home");
    expect(["transports", "payments", "books", "prints", "rota"].map(logisticsPageOf)).toEqual(["transports", "payments", "books", "prints", "rota"]);
    expect(["home", "nowhere", "", "Transports"].map(logisticsPageOf)).toEqual([null, null, null, null]);
  });
});

describe("the board's cohorts that can drive", () => {
  const rota = {
    ...EMPTY_ROTA,
    cohorts: [
      { id: 1, edition_id: 1, letter: "א", name: "מכינה לדוגמה א", diets: [], sort: 1, can_drive: true },
      { id: 2, edition_id: 1, letter: "ב", name: "מכינה לדוגמה ב", diets: [], sort: 2, can_drive: true },
      { id: 3, edition_id: 1, letter: "ג", name: "מכינה לדוגמה ג", diets: [], sort: 3 },
    ],
    presence: [{ cohort_id: 2, day: 0 as const, shift: 1 as const }],
  };

  it("names only, on campus that day first, each with its chip", () => {
    const out = html(DriveCohorts, { drivers: driveCohorts(rota, 0), loading: false, failed: false });
    expect(out).toContain("data-drive-cohorts");
    expect([...out.matchAll(/data-drive-cohort="(\d+)" data-present="([y-])"/g)].map((m) => [m[1], m[2]])).toEqual([
      ["2", "y"],
      ["1", "-"],
    ]);
    expect(out).toContain("בקמפוס ביום הזה");
    expect(out).toContain("לא בקמפוס ביום הזה");
    expect(out).not.toContain("מכינה לדוגמה ג");
  });

  it("none marked: says so; loading: «טוען…»; a failed rota read: nothing (the shifts beside it say it)", () => {
    expect(html(DriveCohorts, { drivers: [], loading: false, failed: false })).toContain("אין מכינות שהצוות שלהן מסומן כיכול להסיע.");
    expect(html(DriveCohorts, { drivers: [], loading: true, failed: false })).toContain("טוען…");
    expect(html(DriveCohorts, { drivers: [], loading: false, failed: true })).toBe("");
  });
});
