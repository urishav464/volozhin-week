// The header's sections: what this member may open (moved here from App.tsx, the reset, phase 2; phase 3 cut the staff over).
import { handlesLogistics, isSettingsAdmin, type Persona } from "../data/gate";
import type { Me } from "../data/types";
import { approvalsBadge } from "../domain/approvals";
import { reviewsOpen } from "../domain/reviews";
import { dayPath, speakersPath } from "../domain/routes";
import type { Week } from "../domain/types";
import type { NavItem } from "./Shell";
import { actorIn } from "./weekStore";

/**
 * A trainee sees only their own work: «היום שלי» (home), «מרצים», «השבוע» (to read), «אחרי השבוע» once a review can
 * open (the day after the week's first day, Israel time) and «עזרה» — the old sections stay reachable by their
 * addresses. Staff and logistics share one order: the writing grid at `/` (staff's overview), the staff's «ימים» and
 * «מרצים», «אישורים» (global admins, edition admins and logistics — its badge counts what THIS viewer may act on:
 * src/domain/approvals.ts approvalsBadge), then the sections they had.
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
  const items: NavItem[] = [{ to: "/", label: "השבוע" }];
  if (persona === "staff") {
    items.push({ to: "/day", label: "ימים" });
    items.push({ to: "/speakers", label: "מרצים" });
  }
  if (handlesLogistics(me)) {
    const waiting = approvalsBadge(week, actorIn(me, week?.edition));
    items.push({ to: "/approvals", label: "אישורים", badge: waiting, badgeLabel: waiting === 1 ? "ממתין" : "ממתינים" });
    // the logistics team's lists (5ב-2): transports (the board, phase 3), payments, books, prints, the rota
    items.push({ to: "/logistics", label: "לוגיסטיקה" });
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
 * The addresses that belong to another persona, and where they send this one (the reset, phase 3; App.tsx's routes):
 * `/myday` is a trainee's — staff go to «ימים» (/day), logistics home; «אחרי השבוע» (/after) is never logistics'; and
 * «המרצים שלי» (/mine, /mine/team) is gone — to «מרצים» at «שלי», or at «כל הצוות». null: the address's own page.
 */
export function myDayRedirect(persona: Persona | null): string | null {
  return persona === "staff" ? dayPath() : persona === "logistics" ? "/" : null;
}

export function afterRedirect(persona: Persona | null): string | null {
  return persona === "logistics" ? "/" : null;
}

export function mineRedirect(tab: string | undefined): string {
  return tab === "team" ? speakersPath({ view: "team" }) : speakersPath({ s: "mine" });
}
