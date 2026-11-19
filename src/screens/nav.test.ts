import { describe, expect, it } from "vitest";
import { personaOf } from "../data/gate";
import type { Me } from "../data/types";
import { addApproach, addSpeaker, emptyWeek } from "../testing/week";
import { navFor } from "./nav";

const base: Me = { status: "ok", schema_version: 18, email: "a@example.org", display_name: "א", global_admin: false, memberships: [] };
const me = (patch: Partial<Me>): Me => ({ ...base, ...patch });
const paths = (m: Me, editionId: number | null = 1) => navFor(m, personaOf(m, editionId), null).map((i) => i.to);

describe("navFor (the reset, phase 2)", () => {
  it("a trainee: «היום שלי», «מרצים», «השבוע», «עזרה» — nothing else", () => {
    const t = me({ memberships: [{ edition_id: 1, role: "content", member_id: 2 }] });
    expect(navFor(t, "trainee", null)).toEqual([
      { to: "/", label: "היום שלי" },
      { to: "/speakers", label: "מרצים" },
      { to: "/week", label: "השבוע" },
      { to: "/help", label: "עזרה" },
    ]);
    expect(paths(t)).toEqual(["/", "/speakers", "/week", "/help"]);
  });

  it("a global admin keeps the staff's sections, the approvals' badge included", () => {
    const g = me({ global_admin: true, memberships: [{ edition_id: null, role: "admin", member_id: 1 }] });
    expect(paths(g)).toEqual(["/", "/mine", "/tracking", "/logistics", "/memorial", "/kk", "/knowledge", "/approvals", "/settings", "/help"]);
    const w = emptyWeek();
    const s = addSpeaker(w, "f");
    s.vetted = "pending";
    addApproach(w, s, "positive");
    const approvals = navFor(g, "staff", w).find((i) => i.to === "/approvals");
    expect(approvals).toMatchObject({ badge: 1, badgeLabel: "ממתין" });
    expect(navFor(g, "staff", w)[0]).toEqual({ to: "/", label: "השבוע" });
  });

  it("an edition's admin: no approvals; logistics: no «המרצים שלי», no «הגדרות»", () => {
    const a = me({ memberships: [{ edition_id: 1, role: "admin", member_id: 3 }] });
    expect(paths(a)).toEqual(["/", "/mine", "/tracking", "/logistics", "/memorial", "/kk", "/knowledge", "/settings", "/help"]);
    const l = me({ memberships: [{ edition_id: 1, role: "logistics", member_id: 5 }] });
    expect(paths(l)).toEqual(["/", "/tracking", "/logistics", "/memorial", "/kk", "/knowledge", "/help"]);
  });

  it("the persona follows the edition on screen: an admin elsewhere is a trainee here", () => {
    const two = me({ memberships: [{ edition_id: 1, role: "content", member_id: 2 }, { edition_id: 2, role: "admin", member_id: 6 }] });
    expect(paths(two, 1)).toEqual(["/", "/speakers", "/week", "/help"]);
    expect(paths(two, 2)[1]).toBe("/mine");
  });
});
