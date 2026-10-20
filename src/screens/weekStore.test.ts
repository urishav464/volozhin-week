import { describe, expect, it } from "vitest";
import type { Me } from "../data/types";
import type { Edition } from "../domain/types";
import { actorIn } from "./weekStore";

const edition = (patch: Partial<Edition> = {}): Edition => ({
  id: 3, label: "בדיקה", kind: "real", start_date: null, first_day_from: null, last_day_until: 1140, status: "planning", settings: {}, ...patch,
});
const me = (patch: Partial<Me>): Me => ({ status: "ok", schema_version: 6, email: "a@example.org", display_name: "א", global_admin: false, memberships: [], ...patch });

describe("actorIn: what a member may do in an edition", () => {
  it("my membership of that edition, else my all-editions row", () => {
    const m = me({ memberships: [{ edition_id: 3, role: "content", member_id: 7 }, { edition_id: null, role: "admin", member_id: 1 }] });
    expect(actorIn(m, edition())).toMatchObject({ memberId: 7, role: "content", isAdmin: false, canEdit: true });
    expect(actorIn(m, edition({ id: 9 }))).toMatchObject({ memberId: 1, role: "admin", isAdmin: true });
  });

  it("a global admin is admin everywhere; logistics never edits", () => {
    expect(actorIn(me({ global_admin: true, memberships: [{ edition_id: null, role: "admin", member_id: 1 }] }), edition())).toMatchObject({ role: "admin", global: true, canEdit: true });
    expect(actorIn(me({ memberships: [{ edition_id: 3, role: "logistics", member_id: 5 }] }), edition())).toMatchObject({ role: "logistics", canEdit: false });
    expect(actorIn(me({}), edition())).toMatchObject({ memberId: -1, role: "logistics", canEdit: false });
  });

  it("an archive is read-only except for admins (the database refuses `archived`)", () => {
    const content = me({ memberships: [{ edition_id: 3, role: "content", member_id: 7 }] });
    expect(actorIn(content, edition({ status: "archived" })).canEdit).toBe(false);
    expect(actorIn(content, edition({ kind: "archive" })).canEdit).toBe(false);
    expect(actorIn(me({ memberships: [{ edition_id: 3, role: "admin", member_id: 2 }] }), edition({ status: "archived" })).canEdit).toBe(true);
  });
});
