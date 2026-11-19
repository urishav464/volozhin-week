import { topRole } from "../lib/labels";
import { PortError, type Me, type Role, type WhoAmI } from "./types";

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

/** May this person open «הגדרות»? A global admin, or the admin of any edition. */
export function isSettingsAdmin(me: Me): boolean {
  return me.global_admin || me.memberships.some((m) => m.role === "admin");
}

/** The editions whose settings this person manages: all of them for a global admin, else those they administer. */
export function managedEditionIds(me: Me, all: readonly { id: number }[]): number[] {
  if (me.global_admin) return all.map((e) => e.id);
  const mine = new Set(me.memberships.filter((m) => m.role === "admin" && m.edition_id != null).map((m) => m.edition_id));
  return all.map((e) => e.id).filter((id) => mine.has(id));
}

/** May this person open «לוגיסטיקה» somewhere? A global admin, or an admin or a logistics member of some edition. */
export function handlesLogistics(me: Me): boolean {
  return me.global_admin || me.memberships.some((m) => m.role === "admin" || m.role === "logistics");
}

/**
 * Whose screens a member gets (the reset, phase 2): a trainee (content, not an admin) sees only their own work —
 * «היום שלי», «מרצים», «השבוע», «עזרה»; staff (an admin, of the edition or of all) and logistics keep theirs.
 */
export type Persona = "trainee" | "staff" | "logistics";

const PERSONA: Record<Role, Persona> = { admin: "staff", content: "trainee", logistics: "logistics" };

/**
 * The persona in the edition on screen: a global admin is staff; else the role of the membership actorIn picks (the
 * edition's own, else the all-editions one) — or, with none there or no edition yet, the highest role anywhere (topRole).
 */
export function personaOf(me: Me, editionId: number | null): Persona {
  if (me.global_admin) return "staff";
  const membership =
    editionId == null ? undefined : (me.memberships.find((m) => m.edition_id === editionId) ?? me.memberships.find((m) => m.edition_id == null));
  return PERSONA[membership?.role ?? topRole(me)];
}
