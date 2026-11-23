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

/** «מצגות» (the reset, phase 5): the day's presentations — uploaded, checked and downloaded for the hall each morning. */
export const PRESENTATIONS = "/presentations";

/**
 * A trainee sees only their own work: «היום שלי» (home), «מרצים», «השבוע» (to read), «אחרי השבוע» once a review can
 * open (the day after the week's first day, Israel time) and «עזרה» — the old sections stay reachable by their
 * addresses. Staff: the writing grid at `/` (their overview), «ימים» and «מרצים», «אישורים» (its badge counts what THIS
 * viewer may act on: src/domain/approvals.ts approvalsBadge), «לוגיסטיקה», then the sections they had. Logistics
 * (phase 4): «בית» — their home, `/logistics` and every tab under it — «אישורים», «השבוע» to read (`/week`), then the
 * sections every member reads. Phase 5: «מצגות» after «תוצרים» for staff and logistics (a trainee uploads from the lesson
 * page, and opens /presentations by its address); and below 1024px the header keeps one row — staff «השבוע · ימים ·
 * מרצים · אישורים», logistics «בית · אישורים · השבוע · תוצרים», the rest behind «עוד» (`more`, splitNav); a trainee's
 * four or five need no «עוד».
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
      items.push({ to: LOGISTICS_HOME, label: "לוגיסטיקה", more: true });
    }
  }
  // the outputs (milestone 4): the tracking table, the escorts' list, the designer's export, «אתר האורחים» — one section;
  // logistics' fourth in the row, behind «עוד» for staff (below 1024px)
  const outputs: NavItem = { to: "/tracking", label: "תוצרים", match: ["/tracking", "/print/", "/export/", "/reader"] };
  items.push(persona === "logistics" ? outputs : { ...outputs, more: true });
  // the day's presentations (phase 5): staff and logistics; every member may open the page
  items.push({ to: PRESENTATIONS, label: "מצגות", more: true });
  // memorial times (5ב-2): every member reads them; admins plan and place
  items.push({ to: "/memorial", label: "זמני זיכרון", more: true });
  // מכריכה לכריכה (milestone 5a): every member reads it; admins write, logistics the book orders
  items.push({ to: "/kk", label: "מכריכה לכריכה", more: true });
  items.push({ to: "/knowledge", label: "ידע", more: true });
  if (isSettingsAdmin(me)) items.push({ to: "/settings", label: "הגדרות", more: true });
  items.push({ to: "/help", label: "עזרה", more: true });
  return items;
}

/**
 * The header's two parts below 1024px (Shell.tsx): the row, and what «עוד» opens — in the header's order. From 1024px
 * Shell draws them all in one row. No `more` anywhere (a trainee): nothing behind «עוד», and no «עוד».
 */
export function splitNav(items: readonly NavItem[]): { inline: NavItem[]; more: NavItem[] } {
  return { inline: items.filter((i) => !i.more), more: items.filter((i) => i.more) };
}

export const MORE_LABEL = "עוד";

/**
 * «עוד»'s name for a screen reader (Shell.tsx): «עוד», and while the page is under one of the sections behind it
 * (`here`, Shell's sectionActive), that section's — «עוד, כאן: ידע»; the button then wears the active pill.
 */
export function moreLabel(here: Pick<NavItem, "label"> | null): string {
  return here ? `${MORE_LABEL}, כאן: ${here.label}` : MORE_LABEL;
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

/**
 * `/grid` (the reset, phase 5): the writing grid has one address, `/` — staff's home. Anyone else lands on «השבוע» to
 * read (`/week`): changing the grid's shape is the staff's, on screen (the database still lets any editor reshape).
 */
export function gridRedirect(persona: Persona | null): string {
  return persona === "staff" ? "/" : "/week";
}

export function mineRedirect(tab: string | undefined): string {
  return tab === "team" ? speakersPath({ view: "team" }) : speakersPath({ s: "mine" });
}
