// What the speakers' wide pages share (the reset, phase 2): a section drawn as a card with an address of its own
// (`#call`, `#availability` …), the week's loading states, a toast handed over from the page before, and the words
// that ask before proposing on another pair's day.
import { type ReactNode, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { byGender } from "../../domain/names";
import type { Week } from "../../domain/types";
import type { Notify } from "../speakers/parts";
import type { WeekStore } from "../weekStore";

/** A wide page's way back, above its first card («→ מרצים», «→ היום שלי»). */
export const BACK_LINK = "inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-semibold text-navy hover:bg-accent-soft";

/** A wide page's part: a card, its heading, a muted count, an aside at its far end. */
export function PageSection({ id, title, count, aside, children }: { id?: string; title: string; count?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  const head = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={head} aria-label={head ? undefined : title} tabIndex={id ? -1 : undefined} className="scroll-mt-4 rounded-xl border border-line bg-card p-4 shadow-sm outline-none sm:p-5">
      <div className="mb-3 flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id={head} className="font-display text-lg font-bold text-navy">
          {title}
        </h3>
        {count != null && count !== false && <span className="text-sm tabular-nums text-ink-faint">{count}</span>}
        {aside && <div className="ms-auto flex flex-wrap items-center gap-1 text-sm text-ink-soft">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** The week is not on screen yet: why, in one line; null once it is. */
export function weekProblem(store: Pick<WeekStore, "problem" | "week">): ReactNode | null {
  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!store.week) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;
  return null;
}

/** A toast another page handed over with the address (`state.notice`), said once — then the address forgets it. */
export interface PageNotice {
  notice?: { kind: "ok" | "error"; text: string };
}

export function useHandedNotice(notify: Notify) {
  const location = useLocation();
  const navigate = useNavigate();
  const said = useRef(false);
  const notice = (location.state as PageNotice | null)?.notice;
  useEffect(() => {
    if (!notice || said.current) return;
    said.current = true;
    notify(notice.kind, notice.text);
    navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: null });
  }, [notice, notify, navigate, location.pathname, location.search, location.hash]);
}

/** «א׳ ו-ב׳», «א׳», or null for nobody. */
export function namesOf(week: Week, ids: readonly number[]): string | null {
  const names = ids.map((id) => week.team.find((t) => t.id === id)?.display_name ?? "חבר/ת צוות");
  if (names.length === 0) return null;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} ו-${names[names.length - 1]}`;
}

/**
 * Before proposing on a day that is another pair's (they are notified — in the site, «היום שלי»): «היום הזה של X ו-Y.
 * הם יראו שהשיבוץ אצלך. להמשיך?»; one owner in their gender. null: the day is mine, or nobody's.
 */
export function otherDayText(week: Week, owners: readonly number[], me: number): string | null {
  if (owners.length === 0 || owners.includes(me)) return null;
  const names = namesOf(week, owners)!;
  if (owners.length === 1) {
    const g = week.team.find((t) => t.id === owners[0])?.gender ?? null;
    return `היום הזה של ${names}. ${names} ${byGender(g, "יראה", "תראה", "יראה/תראה")} שהשיבוץ אצלך. להמשיך?`;
  }
  return `היום הזה של ${names}. הם יראו שהשיבוץ אצלך. להמשיך?`;
}
