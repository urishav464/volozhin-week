import type { Me, Role } from "../data/types";

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
