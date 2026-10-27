import type { Me, Role } from "../data/types";
import { byGender } from "../domain/names";
import type { ApproachStatus, ContactPref, Gender, Vetting } from "../domain/types";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "מדריך/ה",
  content: "צוות תוכן",
  logistics: "לוגיסטיקה",
};

// The highest role a person holds anywhere (for the header only).
export function topRole(me: Me): Role {
  const roles = me.memberships.map((m) => m.role);
  if (me.global_admin || roles.includes("admin")) return "admin";
  if (roles.includes("content")) return "content";
  return "logistics";
}

// ------------------------------------------------------------------ the speaker pool
// Words about a speaker take the speaker's gender (byGender: the slashed form
// while it is unknown); words to the team stay gender-neutral.

/**
 * Where the approach stands (v14: the call is the first step) — the one source of these words: the lesson panel's card,
 * the speaker sheet, «המרצים שלי», the team's board, the pool.
 */
export function statusLabel(s: ApproachStatus, g: Gender | null): string {
  switch (s) {
    case "claimed":
      return "לפני שיחה";
    case "no_answer":
      return byGender(g, "לא ענה", "לא ענתה", "לא ענה/תה");
    case "approached":
      return "שוחחנו, מחכים לתשובה";
    case "positive":
      return byGender(g, "הסכים", "הסכימה");
    case "declined":
      return byGender(g, "סירב", "סירבה");
  }
}

export function vettingLabel(v: Vetting, g: Gender | null): string {
  if (v === "approved") return byGender(g, "מאושר", "מאושרת");
  if (v === "rejected") return byGender(g, "לא אושר", "לא אושרה");
  return `${byGender(g, "ממתין", "ממתינה")} לאישור`;
}

export const CONTACT_PREF_LABEL: Record<ContactPref, string> = {
  phone: "טלפון",
  whatsapp: "WhatsApp",
  email: "מייל",
  secretary: "דרך המזכירות",
};
