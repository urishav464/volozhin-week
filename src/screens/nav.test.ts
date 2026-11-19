import { describe, expect, it } from "vitest";
import { personaOf } from "../data/gate";
import type { Me } from "../data/types";
import { addApproach, addLesson, addSpeaker, closeWith, emptyWeek } from "../testing/week";
import { afterRedirect, mineRedirect, myDayRedirect, navFor } from "./nav";

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
    expect(paths(logistics)).toEqual(["/", "/approvals", "/logistics", "/tracking", "/memorial", "/kk", "/knowledge", "/help"]);
    // «אחרי השבוע» is never logistics'
    expect(paths(logistics, 1, waiting(), "2030-01-01T10:00:00Z")).not.toContain("/after");
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
  it("/myday is a trainee's: staff go to «ימים», logistics home", () => {
    expect(myDayRedirect("trainee")).toBeNull();
    expect(myDayRedirect("staff")).toBe("/day");
    expect(myDayRedirect("logistics")).toBe("/");
  });

  it("«אחרי השבוע» is content's and admins', never logistics'", () => {
    expect(afterRedirect("trainee")).toBeNull();
    expect(afterRedirect("staff")).toBeNull();
    expect(afterRedirect("logistics")).toBe("/");
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
