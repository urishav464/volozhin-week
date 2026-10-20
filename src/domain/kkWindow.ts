// מכריכה לכריכה's sign-up window (editions.settings.kk_window — the admin sets
// it; none = closed): where "now" stands, and the line both the public sign-up
// page and the team's screen say it in. Open means opens_at ≤ now < closes_at,
// as app.kk_open counts it. Instants are written as Israel reads them.
import { israelMoment } from "./israelTime";

export type KkWindowState = "none" | "before" | "open" | "after";

export interface KkWindowLike {
  opens_at: string | null;
  closes_at: string | null;
}

export function kkWindowState(w: KkWindowLike | null | undefined, now = Date.now()): KkWindowState {
  if (!w?.opens_at || !w.closes_at) return "none";
  if (now < Date.parse(w.opens_at)) return "before";
  return now < Date.parse(w.closes_at) ? "open" : "after";
}

/** «ההרשמה פתוחה עד 10.1.2027 20:00.», «ההרשמה תיפתח ב-…», «ההרשמה נסגרה ב-…», or not open yet. */
export function kkWindowText(w: KkWindowLike | null | undefined, now = Date.now()): string {
  switch (kkWindowState(w, now)) {
    case "none":
      return "ההרשמה עוד לא נפתחה.";
    case "before":
      return `ההרשמה תיפתח ב-${israelMoment(w!.opens_at!)}.`;
    case "open":
      return `ההרשמה פתוחה עד ${israelMoment(w!.closes_at!)}.`;
    case "after":
      return `ההרשמה נסגרה ב-${israelMoment(w!.closes_at!)}.`;
  }
}
