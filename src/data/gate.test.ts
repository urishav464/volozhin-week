import { describe, expect, it } from "vitest";
import { gateFor, gateForError, handlesLogistics, isSettingsAdmin, managedEditionIds, personaOf } from "./gate";
import { type Me, PortError, type WhoAmI } from "./types";

const ok: WhoAmI = {
  status: "ok",
  schema_version: 1,
  email: "a@example.org",
  display_name: "א",
  global_admin: false,
  memberships: [{ edition_id: 3, role: "content", member_id: 7 }],
};

describe("gateFor", () => {
  it("sends a member with the right schema home", () => {
    expect(gateFor(ok, 1)).toEqual({ screen: "home", me: ok });
  });
  it("stops a member on a stale or newer schema", () => {
    expect(gateFor(ok, 2)).toEqual({ screen: "schema_stale", have: 1, want: 2 });
    expect(gateFor({ ...ok, schema_version: 3 }, 2)).toEqual({ screen: "schema_stale", have: 3, want: 2 });
  });
  it("does not tell a non-member about the schema", () => {
    expect(gateFor({ status: "not_member", schema_version: 0 }, 1)).toEqual({ screen: "not_member" });
    expect(gateFor({ status: "wrong_provider", schema_version: 0 }, 1)).toEqual({ screen: "wrong_provider" });
  });
  it("maps signed_out", () => {
    expect(gateFor({ status: "signed_out" }, 1)).toEqual({ screen: "signed_out" });
  });
  it("treats an unknown status as a database ahead of this build", () => {
    expect(gateFor({ status: "brand_new", schema_version: 5 } as unknown as WhoAmI, 1)).toEqual({
      screen: "schema_stale",
      have: 5,
      want: 1,
    });
  });
});

describe("gateForError", () => {
  it("reads a missing whoami() as a never-installed schema", () => {
    expect(gateForError(new PortError("PGRST202", "x"), 1)).toEqual({ screen: "schema_stale", have: 0, want: 1 });
  });
  it("leaves other failures to the error screen", () => {
    expect(gateForError(new PortError("42501", "x"), 1)).toBeNull();
    expect(gateForError(new Error("network"), 1)).toBeNull();
  });
});

describe("who reaches «הגדרות»", () => {
  const me = (patch: Partial<Me>): Me => ({ ...(ok as Me), ...patch });
  const editions = [{ id: 3 }, { id: 4 }, { id: 5 }];

  it("a global admin, for every edition", () => {
    const g = me({ global_admin: true, memberships: [{ edition_id: null, role: "admin", member_id: 1 }] });
    expect(isSettingsAdmin(g)).toBe(true);
    expect(managedEditionIds(g, editions)).toEqual([3, 4, 5]);
  });
  it("an edition's admin, for that edition only", () => {
    const e = me({ memberships: [{ edition_id: 4, role: "admin", member_id: 2 }, { edition_id: 3, role: "content", member_id: 3 }] });
    expect(isSettingsAdmin(e)).toBe(true);
    expect(managedEditionIds(e, editions)).toEqual([4]);
  });
  it("never content or logistics", () => {
    expect(isSettingsAdmin(me({}))).toBe(false);
    expect(isSettingsAdmin(me({ memberships: [{ edition_id: 3, role: "logistics", member_id: 7 }] }))).toBe(false);
    expect(managedEditionIds(me({}), editions)).toEqual([]);
  });
});

describe("who has «לוגיסטיקה»", () => {
  const me = (patch: Partial<Me>): Me => ({ ...(ok as Me), ...patch });
  it("logistics and admins, anywhere; a global admin", () => {
    expect(handlesLogistics(me({ memberships: [{ edition_id: 3, role: "logistics", member_id: 7 }] }))).toBe(true);
    expect(handlesLogistics(me({ memberships: [{ edition_id: 3, role: "content", member_id: 7 }, { edition_id: 4, role: "admin", member_id: 8 }] }))).toBe(true);
    expect(handlesLogistics(me({ global_admin: true, memberships: [] }))).toBe(true);
  });
  it("not someone who is content only", () => {
    expect(handlesLogistics(me({ global_admin: false, memberships: [{ edition_id: 3, role: "content", member_id: 7 }] }))).toBe(false);
  });
});

describe("personaOf (the reset, phase 2)", () => {
  const me = (patch: Partial<Me>): Me => ({ ...(ok as Me), ...patch });
  it("a global admin is staff, whatever the edition", () => {
    const g = me({ global_admin: true, memberships: [{ edition_id: null, role: "admin", member_id: 1 }] });
    expect(personaOf(g, 3)).toBe("staff");
    expect(personaOf(g, null)).toBe("staff");
    expect(personaOf(me({ global_admin: true, memberships: [] }), 3)).toBe("staff");
  });
  it("a content member is a trainee; an edition's admin is staff; logistics is logistics", () => {
    expect(personaOf(me({}), 3)).toBe("trainee");
    expect(personaOf(me({ memberships: [{ edition_id: 3, role: "admin", member_id: 2 }] }), 3)).toBe("staff");
    expect(personaOf(me({ memberships: [{ edition_id: 3, role: "logistics", member_id: 2 }] }), 3)).toBe("logistics");
  });
  it("the edition on screen decides: its own membership first, then the all-editions one", () => {
    const two = me({ memberships: [{ edition_id: 3, role: "content", member_id: 2 }, { edition_id: 4, role: "admin", member_id: 5 }] });
    expect(personaOf(two, 3)).toBe("trainee");
    expect(personaOf(two, 4)).toBe("staff");
    const both = me({ memberships: [{ edition_id: null, role: "logistics", member_id: 2 }, { edition_id: 4, role: "content", member_id: 5 }] });
    expect(personaOf(both, 4)).toBe("trainee");
    expect(personaOf(both, 3)).toBe("logistics"); // not a member of 3 itself: the all-editions row
  });
  it("no edition yet, or no membership in it: the highest role anywhere", () => {
    const two = me({ memberships: [{ edition_id: 3, role: "logistics", member_id: 2 }, { edition_id: 4, role: "content", member_id: 5 }] });
    expect(personaOf(two, null)).toBe("trainee");
    expect(personaOf(two, 9)).toBe("trainee");
    expect(personaOf(me({ memberships: [{ edition_id: 3, role: "logistics", member_id: 2 }, { edition_id: 4, role: "admin", member_id: 5 }] }), null)).toBe("staff");
    expect(personaOf(me({ memberships: [{ edition_id: 3, role: "logistics", member_id: 2 }] }), null)).toBe("logistics");
  });
});
