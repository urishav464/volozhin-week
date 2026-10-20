import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

/** One of the site's sections in the header: the week, «המרצים שלי», the approvals queue, «הגדרות». */
export interface NavItem {
  to: string;
  label: string;
  /** A count beside the label (speakers waiting for approval); hidden at 0. */
  badge?: number;
  /** What the count means, for a screen reader: the link reads «אישורים, 5 ממתינים». */
  badgeLabel?: string;
  /** The paths this section covers (the outputs: /tracking, /print/…, /export/…); default: `to` and below. */
  match?: string[];
}

interface Props {
  demo: boolean;
  user?: { name: string; roleLabel: string } | null;
  onSignOut?: () => void;
  /** The sections a signed-in member may open. */
  nav?: NavItem[];
  /** The grid needs the whole width; notices and forms stay in a reading column (the signed-in header is always full width). */
  full?: boolean;
  /** A quiet line under the header (a new version of the site is waiting). */
  notice?: ReactNode;
  children: ReactNode;
}

/** Is the page under this section? `/` only itself; a section its path and below; the outputs all their paths. */
export function sectionActive(item: Pick<NavItem, "to" | "match">, path: string): boolean {
  if (item.match) return item.match.some((m) => path === m || path.startsWith(m.endsWith("/") ? m : `${m}/`));
  if (item.to === "/") return path === "/";
  return path === item.to || path.startsWith(`${item.to}/`);
}

const HEADER_BUTTON = "inline-flex min-h-11 shrink-0 items-center rounded-md border border-paper/40 px-3 text-sm hover:bg-paper/10";

export function Shell({ demo, user, onSignOut, nav, full = false, notice, children }: Props) {
  const path = useLocation().pathname;
  return (
    <div className="app-shell min-h-dvh flex flex-col">
      {demo && (
        <div role="status" className="bg-accent-soft text-ink text-sm text-center px-4 py-2 print:hidden">
          מצב הדגמה — נתונים לדוגמה בלבד, שום דבר לא נשמר
        </div>
      )}
      <header className="bg-ink text-paper print:hidden">
        {/* Signed in, the header keeps one width on every screen, so a section link stays under the pointer.
            Below 1024px the sections move to a row of their own, under the name and «התנתקות», and wrap
            onto a second line when they do not fit (an admin's ten on a phone): every entry stays
            visible and one tap away, nothing hides behind a menu or off the edge of a sideways scroll.
            From 1024px the sections keep their whole width (shrink-0) and the member's name gives way
            (truncated, the whole name on hover): an admin's ten links fit from 1024px on. */}
        <div className={`mx-auto ${full || user ? "max-w-none" : "max-w-6xl"} px-4 flex flex-wrap items-center gap-x-2 sm:gap-x-3 lg:flex-nowrap`}>
          <h1 className="flex h-14 shrink-0 items-center font-display font-extrabold text-xl tracking-tight">
            {nav ? (
              <Link to="/" className="rounded-sm">
                שבוע וולוז'ין
              </Link>
            ) : (
              "שבוע וולוז'ין"
            )}
          </h1>
          {nav && nav.length > 0 && (
            <nav aria-label="אזורי המערכת" className="order-last flex w-full flex-wrap gap-1 pb-2 lg:order-none lg:w-auto lg:shrink-0 lg:flex-nowrap lg:overflow-x-auto lg:pb-0">
              {nav.map((item) => {
                const isActive = sectionActive(item, path);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-current={isActive ? "page" : undefined}
                    aria-label={item.badge ? `${item.label}, ${item.badge} ${item.badgeLabel ?? ""}`.trim() : undefined}
                    className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm font-semibold ${isActive ? "bg-paper text-ink" : "text-paper hover:bg-paper/10"}`}
                  >
                    {item.label}
                    {!!item.badge && (
                      // ink on paper / paper on ink: the accent was too faint behind 12px digits
                      <span aria-hidden className={`rounded-full px-1.5 text-xs font-bold leading-5 tabular-nums ${isActive ? "bg-ink text-paper" : "bg-paper text-ink"}`}>
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          )}
          <div className="ms-auto flex h-14 min-w-0 items-center gap-2 sm:gap-3">
            {user && (
              <span className="text-sm truncate" title={`${user.name} · ${user.roleLabel}`}>
                {user.name} · <span className="opacity-80">{user.roleLabel}</span>
              </span>
            )}
            {onSignOut && (
              <button type="button" onClick={onSignOut} className={HEADER_BUTTON}>
                התנתקות
              </button>
            )}
          </div>
        </div>
      </header>
      {notice}
      <main className={`flex-1 mx-auto w-full print:max-w-none print:p-0 ${full ? "max-w-none px-3 py-3" : "max-w-6xl px-4 py-6"}`}>{children}</main>
    </div>
  );
}

/** «גרסה חדשה של האתר זמינה» — the offline shell's update (src/offline/register.ts). Never reloads by itself. */
export function UpdateBanner({ onApply }: { onApply: () => void }) {
  return (
    <div role="status" data-update-banner className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line bg-card px-4 py-1.5 text-sm print:hidden">
      <span>גרסה חדשה של האתר זמינה</span>
      <button type="button" onClick={onApply} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 font-semibold hover:bg-line/50">
        רענון
      </button>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`bg-card border border-line rounded-xl p-5 shadow-sm ${className}`}>{children}</section>;
}
