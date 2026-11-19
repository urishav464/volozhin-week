// The header's sections: what this member may open (moved here from App.tsx, the reset, phase 2).
import { handlesLogistics, handlesSpeakers, isSettingsAdmin, type Persona } from "../data/gate";
import type { Me } from "../data/types";
import { waitingForApproval } from "../domain/mine";
import type { Week } from "../domain/types";
import type { NavItem } from "./Shell";

/**
 * A trainee sees only their own work: «היום שלי» (home), «מרצים», «השבוע» (to read) and «עזרה» — the old sections stay
 * reachable by their addresses. Staff and logistics keep theirs: the approvals queue is a global admin's (only they
 * vet speakers and decide payment and transport); its badge counts what holds the team up — speakers who agreed and
 * wait for the approval before their time is closed, and the requests (src/domain/mine.ts waitingForApproval).
 * «המרצים שלי» holds the team's board too (/mine/team), so the header keeps its ten sections.
 */
export function navFor(me: Me, persona: Persona, week: Week | null): NavItem[] {
  if (persona === "trainee") {
    return [
      { to: "/", label: "היום שלי" },
      { to: "/speakers", label: "מרצים" },
      { to: "/week", label: "השבוע" },
      { to: "/help", label: "עזרה" },
    ];
  }
  const items: NavItem[] = [{ to: "/", label: "השבוע" }];
  if (handlesSpeakers(me)) items.push({ to: "/mine", label: "המרצים שלי" });
  // the outputs (milestone 4): the tracking table, the escorts' list, the designer's export — one section
  items.push({ to: "/tracking", label: "תוצרים", match: ["/tracking", "/print/", "/export/", "/reader"] });
  // the logistics team's lists (5ב-2): transports, payments, books, prints — logistics and admins
  if (handlesLogistics(me)) items.push({ to: "/logistics", label: "לוגיסטיקה" });
  // memorial times (5ב-2): every member reads them; admins plan and place
  items.push({ to: "/memorial", label: "זמני זיכרון" });
  // מכריכה לכריכה (milestone 5a): every member reads it; admins write, logistics the book orders
  items.push({ to: "/kk", label: "מכריכה לכריכה" });
  items.push({ to: "/knowledge", label: "ידע" });
  if (me.global_admin) {
    const waiting = week ? waitingForApproval(week) : 0;
    items.push({ to: "/approvals", label: "אישורים", badge: waiting, badgeLabel: waiting === 1 ? "ממתין" : "ממתינים" });
  }
  if (isSettingsAdmin(me)) items.push({ to: "/settings", label: "הגדרות" });
  items.push({ to: "/help", label: "עזרה" });
  return items;
}
