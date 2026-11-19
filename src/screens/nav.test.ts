import { describe, expect, it } from "vitest";
import { personaOf } from "../data/gate";
import type { Me } from "../data/types";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek } from "../testing/week";
import { afterRedirect, dayRedirect, homeRedirect, LOGISTICS_HOME, mineRedirect, myDayRedirect, navFor } from "./nav";
import { backLink } from "./ReadOnlyWeek";
import { sectionActive } from "./Shell";

const base: Me = { status: "ok", schema_version: 18, email: "a@example.org", display_name: "א", global_admin: false, memberships: [] };
const me = (patch: Partial<Me>): Me => ({ ...base, ...patch });
const paths = (m: Me, editionId: number | null = 1, week = null as ReturnType<typeof emptyWeek> | null, now?: string) =>
  navFor(m, personaOf(m, editionId), week, now).map((i) => i.to);

const globalAdmin = me({ global_admin: true, memberships: [{ edition_id: null, role: "admin", member_id: 1 }] });
const editionAdmin = me({ memberships: [{ edition_id: 1, role: "admin", member_id: 3 }] });
const logistics = me({ memberships: [{ edition_id: 1, role: "logistics", member_id: 5 }] });
const trainee = me({ memberships: [{ edition_id: 1, role: "content", member_id: 2 }] });

/** A week (edition 1, starting 14.2.2027) with one request waiting and one speaker who agreed and waits for the vetting. */
function waiting(kind: "real" | "demo" = "real") {
  const w = emptyWeek();
  w.edition.kind = kind;
  const s = addSpeaker(w, "f");
  addApproach(w, s, "positive");
  closeWith(w, addLesson(w, 0, 870, 960, { pay_amount: 300, approval: "pending" }), s);
  const agreed = addSpeaker(w, "m");
  agreed.vetted = "pending";
  addApproach(w, agreed, "positive");
  return w;
}

const badgeOf = (m: Me, w: ReturnType<typeof emptyWeek>) => navFor(m, personaOf(m, w.edition.id), w).find((i) => i.to === "/approvals");

describe("navFor (the reset, phases 2–3)", () => {
  it("a trainee: «היום שלי», «מרצים», «השבוע», «עזרה» — nothing else before the reviews open", () => {
    expect(navFor(trainee, "trainee", null)).toEqual([
      { to: "/", label: "היום שלי" },
      { to: "/speakers", label: "מרצים" },
      { to: "/week", label: "השבוע" },
      { to: "/help", label: "עזרה" },
    ]);
    expect(paths(trainee)).toEqual(["/", "/speakers", "/week", "/help"]);
  });

  it("a trainee gets «אחרי השבוע» from the day after the week's first day (Israel time) — never while the date is TBD", () => {
    const w = emptyWeek(); // starts 2027-02-14
    expect(paths(trainee, 1, w, "2027-02-14T21:59:00Z")).toEqual(["/", "/speakers", "/week", "/help"]);
    expect(paths(trainee, 1, w, "2027-02-14T22:00:00Z")).toEqual(["/", "/speakers", "/week", "/after", "/help"]);
    expect(navFor(trainee, "trainee", w, "2027-02-20T10:00:00Z")[3]).toEqual({ to: "/after", label: "אחרי השבוע" });
    w.edition.start_date = null;
    expect(paths(trainee, 1, w, "2030-01-01T10:00:00Z")).not.toContain("/after");
  });

  it("a global admin: the grid, «ימים», «מרצים», «אישורים», then the sections they had — no «המרצים שלי»", () => {
    expect(paths(globalAdmin)).toEqual(["/", "/day", "/speakers", "/approvals", "/logistics", "/tracking", "/memorial", "/kk", "/knowledge", "/settings", "/help"]);
    const items = navFor(globalAdmin, "staff", null);
    expect(items[0]).toEqual({ to: "/", label: "השבוע" });
    expect(items.map((i) => i.label)).toEqual(["השבוע", "ימים", "מרצים", "אישורים", "לוגיסטיקה", "תוצרים", "זמני זיכרון", "מכריכה לכריכה", "ידע", "הגדרות", "עזרה"]);
    expect(items.map((i) => i.to)).not.toContain("/mine");
  });

  it("an edition's admin: the same staff sections; logistics: no «ימים», «מרצים» or «הגדרות», but «אישורים»", () => {
    expect(paths(editionAdmin)).toEqual(["/", "/day", "/speakers", "/approvals", "/logistics", "/tracking", "/memorial", "/kk", "/knowledge", "/settings", "/help"]);
    expect(paths(logistics)).toEqual(["/logistics", "/approvals", "/week", "/tracking", "/memorial", "/kk", "/knowledge", "/help"]);
    // «אחרי השבוע» is never logistics'
    expect(paths(logistics, 1, waiting(), "2030-01-01T10:00:00Z")).not.toContain("/after");
  });

  it("logistics (phase 4): «בית» their home, «אישורים», «השבוע» to read, then the sections every member reads — no grid, no «לוגיסטיקה»", () => {
    const items = navFor(logistics, "logistics", null);
    expect(items.map((i) => [i.to, i.label])).toEqual([
      ["/logistics", "בית"],
      ["/approvals", "אישורים"],
      ["/week", "השבוע"],
      ["/tracking", "תוצרים"],
      ["/memorial", "זמני זיכרון"],
      ["/kk", "מכריכה לכריכה"],
      ["/knowledge", "ידע"],
      ["/help", "עזרה"],
    ]);
    expect(items.map((i) => i.to)).not.toContain("/");
    expect(items.map((i) => i.label)).not.toContain("לוגיסטיקה");
    expect(items.map((i) => i.to)).not.toContain("/settings");
    // «בית» stays lit on every tab of the home, and on nothing else
    const home = items[0];
    for (const p of ["/logistics", "/logistics/transports", "/logistics/rota/prep", "/logistics/books"]) expect(sectionActive(home, p)).toBe(true);
    for (const p of ["/", "/week", "/approvals", "/logisticsx", "/reader"]) expect(sectionActive(home, p)).toBe(false);
    // the badge counts what logistics may decide here
    expect(navFor(logistics, "logistics", waiting())[1]).toMatchObject({ to: "/approvals", badge: 1, badgeLabel: "ממתין" });
  });

  it("staff keep phase 3's header, «לוגיסטיקה» leading to the same home", () => {
    const items = navFor(editionAdmin, "staff", null);
    expect(items.find((i) => i.label === "לוגיסטיקה")).toMatchObject({ to: LOGISTICS_HOME });
    expect(items.map((i) => i.label)).not.toContain("בית");
    expect(LOGISTICS_HOME).toBe("/logistics");
  });

  it("the badge per viewer: a global admin the vetting and the requests; an edition's admin and logistics the requests of a live real edition", () => {
    expect(badgeOf(globalAdmin, waiting())).toMatchObject({ badge: 2, badgeLabel: "ממתינים" });
    expect(badgeOf(editionAdmin, waiting())).toMatchObject({ badge: 1, badgeLabel: "ממתין" });
    expect(badgeOf(logistics, waiting())).toMatchObject({ badge: 1, badgeLabel: "ממתין" });
    // a demo or practice week: nobody but a global admin decides there
    expect(badgeOf(editionAdmin, waiting("demo"))).toMatchObject({ badge: 0 });
    expect(badgeOf(logistics, waiting("demo"))).toMatchObject({ badge: 0 });
    expect(badgeOf(globalAdmin, waiting("demo"))).toMatchObject({ badge: 2 });
    expect(navFor(globalAdmin, "staff", null).find((i) => i.to === "/approvals")).toMatchObject({ badge: 0 });
  });

  it("the persona follows the edition on screen: an admin elsewhere is a trainee here", () => {
    const two = me({ memberships: [{ edition_id: 1, role: "content", member_id: 2 }, { edition_id: 2, role: "admin", member_id: 6 }] });
    expect(paths(two, 1)).toEqual(["/", "/speakers", "/week", "/help"]);
    expect(paths(two, 2).slice(0, 4)).toEqual(["/", "/day", "/speakers", "/approvals"]);
  });
});

describe("the addresses that are another persona's (App.tsx's routes)", () => {
  it("logistics' `/` is their home; a trainee's and staff's `/` their own page", () => {
    expect(homeRedirect("logistics")).toBe("/logistics");
    expect(homeRedirect("trainee")).toBeNull();
    expect(homeRedirect("staff")).toBeNull();
    expect(homeRedirect(null)).toBeNull();
  });

  it("/myday is a trainee's: staff go to «ימים», logistics home", () => {
    expect(myDayRedirect("trainee")).toBeNull();
    expect(myDayRedirect("staff")).toBe("/day");
    expect(myDayRedirect("logistics")).toBe("/logistics");
    expect(myDayRedirect(null)).toBeNull();
  });

  it("the day pages (/day/:d) are staff's: logistics home (a trainee is sent by the page itself)", () => {
    expect(dayRedirect("logistics")).toBe("/logistics");
    expect(dayRedirect("staff")).toBeNull();
    expect(dayRedirect("trainee")).toBeNull();
  });

  it("«אחרי השבוע» is content's and admins', never logistics' — home", () => {
    expect(afterRedirect("trainee")).toBeNull();
    expect(afterRedirect("staff")).toBeNull();
    expect(afterRedirect("logistics")).toBe("/logistics");
  });

  it("«השבוע» (/week) links back: a trainee «להיום שלי», logistics «לבית» (their home), staff «לרשת השבוע»", () => {
    expect(backLink("trainee")).toEqual({ to: "/", label: "להיום שלי" });
    expect(backLink("logistics")).toEqual({ to: "/logistics", label: "לבית" });
    expect(backLink("staff")).toEqual({ to: "/", label: "לרשת השבוע" });
  });

  it("every redirect lands logistics on an address of their own header: `/logistics` itself, never `/`", () => {
    const ours = navFor(logistics, "logistics", null);
    for (const to of [homeRedirect("logistics"), myDayRedirect("logistics"), dayRedirect("logistics"), afterRedirect("logistics")]) {
      expect(to).toBe("/logistics");
      expect(ours.some((i) => sectionActive(i, to!))).toBe(true);
    }
  });

  it("«המרצים שלי» is gone: /mine to «מרצים» at «שלי», /mine/team at «כל הצוות»", () => {
    expect(mineRedirect(undefined)).toBe("/speakers?s=mine");
    expect(mineRedirect("speakers")).toBe("/speakers?s=mine");
    expect(mineRedirect("team")).toBe("/speakers?view=team");
  });

  it("«אישורים» is listed exactly for whom its route opens (handlesLogistics): never a trainee", () => {
    for (const m of [globalAdmin, editionAdmin, logistics]) expect(paths(m)).toContain("/approvals");
    expect(paths(trainee)).not.toContain("/approvals");
  });
});
