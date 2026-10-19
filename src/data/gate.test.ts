import { describe, expect, it } from "vitest";
import { gateFor, gateForError } from "./gate";
import { PortError, type WhoAmI } from "./types";

const ok: WhoAmI = {
  status: "ok",
  schema_version: 1,
  email: "a@example.org",
  display_name: "א",
  global_admin: false,
  memberships: [{ edition_id: 3, role: "content" }],
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
