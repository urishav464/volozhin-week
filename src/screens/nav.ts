// The header's sections: what this member may open (moved here from App.tsx, the reset, phase 2; phase 3 cut the staff over).
import { handlesLogistics, isSettingsAdmin, type Persona } from "../data/gate";
import type { Me } from "../data/types";
import { approvalsBadge } from "../domain/approvals";
import { reviewsOpen } from "../domain/reviews";
import { dayPath, speakersPath } from "../domain/routes";
import type { Week } from "../domain/types";
import type { NavItem } from "./Shell";
import { actorIn } from "./weekStore";

/** The logistics team's home (the reset, phase 4): «לוגיסטיקה ← בית», what is left to do. */
export const LOGISTICS_HOME = "/logistics";

/**
 * A trainee sees only their own work: «היום שלי» (home), «מרצים», «השבוע» (to read), «אחרי השבוע» once a review can
 * open (the day after the week's first day, Israel time) and «עזרה» — the old sections stay reachable by their
 * addresses. Staff: the writing grid at `/` (their overview), «ימים» and «מרצים», «אישורים» (its badge counts what THIS
 * viewer may act on: src/domain/approvals.ts approvalsBadge), «לוגיסטיקה», then the sections they had. Logistics
 * (phase 4): «בית» — their home, `/logistics` and every tab under it — «אישורים», «השבוע» to read (`/week`), then the
 * sections every member reads.
 */
export function navFor(me: Me, persona: Persona, week: Week | null, nowIso: string = new Date().toISOString()): NavItem[] {
  if (persona === "trainee") {
    return [
      { to: "/", label: "היום שלי" },
      { to: "/speakers", label: "מרצים" },
      { to: "/week", label: "השבוע" },
      ...(reviewsOpen(week?.edition, nowIso) ? [{ to: "/after", label: "אחרי השבוע" }] : []),
      { to: "/help", label: "עזרה" },
    ];
  }
  const waiting = approvalsBadge(week, actorIn(me, week?.edition));
  const approvals: NavItem = { to: "/approvals", label: "אישורים", badge: waiting, badgeLabel: waiting === 1 ? "ממתין" : "ממתינים" };
  const items: NavItem[] = [];
  if (persona === "logistics") {
    items.push({ to: LOGISTICS_HOME, label: "בית", match: [LOGISTICS_HOME] });
    if (handlesLogistics(me)) items.push(approvals);
    items.push({ to: "/week", label: "השבוע" });
  } else {
    items.push({ to: "/", label: "השבוע" });
    items.push({ to: "/day", label: "ימים" });
    items.push({ to: "/speakers", label: "מרצים" });
    if (handlesLogistics(me)) {
      items.push(approvals);
      // the logistics lists (5ב-2) — since phase 4 behind the logistics home, «בית» its first tab
      items.push({ to: LOGISTICS_HOME, label: "לוגיסטיקה" });
    }
  }
  // the outputs (milestone 4): the tracking table, the escorts' list, the designer's export — one section
  items.push({ to: "/tracking", label: "תוצרים", match: ["/tracking", "/print/", "/export/", "/reader"] });
  // memorial times (5ב-2): every member reads them; admins plan and place
  items.push({ to: "/memorial", label: "זמני זיכרון" });
  // מכריכה לכריכה (milestone 5a): every member reads it; admins write, logistics the book orders
  items.push({ to: "/kk", label: "מכריכה לכריכה" });
  items.push({ to: "/knowledge", label: "ידע" });
  if (isSettingsAdmin(me)) items.push({ to: "/settings", label: "הגדרות" });
  items.push({ to: "/help", label: "עזרה" });
  return items;
}

/**
 * The addresses that belong to another persona, and where they send this one (the reset, phases 3–4; App.tsx's routes):
 * logistics' `/` is their home (`/logistics`); `/myday` is a trainee's — staff go to «ימים» (/day), logistics home; the
 * day pages (`/day/:d`, DayScreen) are staff's — logistics home; «אחרי השבוע» (/after) is never logistics' — home; and
 * «המרצים שלי» (/mine, /mine/team) is gone — to «מרצים» at «שלי», or at «כל הצוות». null: the address's own page.
 * Offline nothing redirects: the app shows the device's copy of the week (App.tsx renders OfflineWeek, not the routes).
 */
export function homeRedirect(persona: Persona | null): string | null {
  return persona === "logistics" ? LOGISTICS_HOME : null;
}

export function myDayRedirect(persona: Persona | null): string | null {
  return persona === "staff" ? dayPath() : persona === "logistics" ? LOGISTICS_HOME : null;
}

/** `/day/:d`: logistics home (a trainee is sent by DayScreen itself — to `/?day=d` on a day of theirs). */
export function dayRedirect(persona: Persona | null): string | null {
  return persona === "logistics" ? LOGISTICS_HOME : null;
}

export function afterRedirect(persona: Persona | null): string | null {
  return persona === "logistics" ? LOGISTICS_HOME : null;
}

export function mineRedirect(tab: string | undefined): string {
  return tab === "team" ? speakersPath({ view: "team" }) : speakersPath({ s: "mine" });
}
