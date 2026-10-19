import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";

/** One of the site's sections in the header: the week, «המרצים שלי», the approvals queue, «הגדרות». */
export interface NavItem {
  to: string;
  label: string;
  /** A count beside the label (speakers waiting for approval); hidden at 0. */
  badge?: number;
  /** What the count means, for a screen reader: the link reads «אישורים, 5 ממתינים». */
  badgeLabel?: string;
}

interface Props {
  demo: boolean;
  user?: { name: string; roleLabel: string } | null;
  onSignOut?: () => void;
  /** The sections a signed-in member may open. */
  nav?: NavItem[];
  /** The grid needs the whole width; notices and forms stay in a reading column (the signed-in header is always full width). */
  full?: boolean;
  children: ReactNode;
}

const HEADER_BUTTON = "inline-flex min-h-11 shrink-0 items-center rounded-md border border-paper/40 px-3 text-sm hover:bg-paper/10";

export function Shell({ demo, user, onSignOut, nav, full = false, children }: Props) {
  return (
    <div className="min-h-dvh flex flex-col">
      {demo && (
        <div role="status" className="bg-accent-soft text-ink text-sm text-center px-4 py-2">
          מצב הדגמה — נתונים לדוגמה בלבד, שום דבר לא נשמר
        </div>
      )}
      <header className="bg-ink text-paper">
        {/* Signed in, the header keeps one width on every screen, so a section link stays under the pointer.
            Below 1024px the sections wrap to a row of their own, under the name and «התנתקות»: every
            entry stays one tap away on a phone, nothing hides behind a menu. */}
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
            <nav aria-label="אזורי המערכת" className="order-last flex w-full gap-1 overflow-x-auto pb-2 lg:order-none lg:w-auto lg:pb-0">
              {nav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  aria-label={item.badge ? `${item.label}, ${item.badge} ${item.badgeLabel ?? ""}`.trim() : undefined}
                  className={({ isActive }) =>
                    `inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm font-semibold ${isActive ? "bg-paper text-ink" : "text-paper hover:bg-paper/10"}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {item.label}
                      {!!item.badge && (
                        // ink on paper / paper on ink: the accent was too faint behind 12px digits
                        <span aria-hidden className={`rounded-full px-1.5 text-xs font-bold leading-5 tabular-nums ${isActive ? "bg-ink text-paper" : "bg-paper text-ink"}`}>
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
          )}
          <div className="ms-auto flex h-14 min-w-0 items-center gap-2 sm:gap-3">
            {user && (
              <span className="text-sm truncate">
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
      <main className={`flex-1 mx-auto w-full ${full ? "max-w-none px-3 py-3" : "max-w-6xl px-4 py-6"}`}>{children}</main>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`bg-card border border-line rounded-xl p-5 shadow-sm ${className}`}>{children}</section>;
}
