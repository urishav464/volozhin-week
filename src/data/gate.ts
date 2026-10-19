import { PortError, type Me, type WhoAmI } from "./types";

// Which screen a browser shows, decided from public.whoami() alone.
export type Gate =
  | { screen: "signed_out" }
  | { screen: "wrong_provider" }
  | { screen: "not_member" }
  | { screen: "schema_stale"; have: number; want: number }
  | { screen: "home"; me: Me };

export function gateFor(w: WhoAmI, expectedVersion: number): Gate {
  switch (w.status) {
    case "signed_out":
      return { screen: "signed_out" };
    case "wrong_provider":
      return { screen: "wrong_provider" };
    case "not_member":
      return { screen: "not_member" };
    case "ok":
      // Only a member is told about the database version: the fix is an
      // admin's job, and the message means nothing to anyone else.
      if (w.schema_version !== expectedVersion) {
        return { screen: "schema_stale", have: w.schema_version, want: expectedVersion };
      }
      return { screen: "home", me: w };
    default:
      // A status this build does not know means the database is ahead of it.
      return { screen: "schema_stale", have: (w as { schema_version?: number }).schema_version ?? 0, want: expectedVersion };
  }
}

// whoami() itself failed: a missing function means schema.sql never ran.
export function gateForError(e: unknown, expectedVersion: number): Gate | null {
  if (e instanceof PortError && e.code === "PGRST202") {
    return { screen: "schema_stale", have: 0, want: expectedVersion };
  }
  return null;
}
