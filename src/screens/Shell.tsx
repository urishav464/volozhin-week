import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import seal from "../assets/brand/ein-prat-white.png";

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

const HEADER_BUTTON = "inline-flex min-h-11 shrink-0 items-center rounded-full border border-white/50 px-3 text-sm font-bold hover:bg-white/10";

export function Shell({ demo, user, onSignOut, nav, full = false, notice, children }: Props) {
  const path = useLocation().pathname;
  return (
    <div className="app-shell min-h-dvh flex flex-col">
      {demo && (
        <div role="status" className="border-b border-sand bg-sand-soft px-4 py-2 text-center text-sm text-ink print:hidden">
          מצב הדגמה — נתונים לדוגמה בלבד, שום דבר לא נשמר
        </div>
      )}
      {/* Prat Navy, the seal in white beside the name; on it the focus ring is gold (index.css, .on-navy) */}
      <header className="on-navy bg-navy text-white shadow-md print:hidden">
        {/* Signed in, the header keeps one width on every screen, so a section link stays under the pointer.
            Below 1024px the sections move to a row of their own, under the name and «התנתקות», and wrap
            onto a second line when they do not fit (an admin's ten on a phone): every entry stays
            visible and one tap away, nothing hides behind a menu or off the edge of a sideways scroll.
            From 1024px the sections keep their whole width (shrink-0) and the member's name gives way
            (truncated, the whole name on hover): an admin's ten links fit from 1024px on. */}
        <div className={`mx-auto ${full || user ? "max-w-none" : "max-w-6xl"} px-4 flex flex-wrap items-center gap-x-2 sm:gap-x-3 lg:flex-nowrap`}>
          <h1 className="flex h-14 shrink-0 items-center font-display text-xl font-extrabold tracking-tight">
            {nav ? (
              <Link to="/" className="inline-flex items-center gap-2 rounded-md">
                <Seal />
                שבוע וולוז'ין
              </Link>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Seal />
                שבוע וולוז'ין
              </span>
            )}
          </h1>
          {nav && nav.length > 0 && (
            // lg:p-1: the sideways-scroll box clips what overflows it, so a link's focus ring (4px out) needs the room
            <nav aria-label="אזורי המערכת" className="order-last flex w-full flex-wrap gap-1 pb-2 lg:order-none lg:w-auto lg:shrink-0 lg:flex-nowrap lg:overflow-x-auto lg:p-1">
              {nav.map((item) => {
                const isActive = sectionActive(item, path);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-current={isActive ? "page" : undefined}
                    aria-label={item.badge ? `${item.label}, ${item.badge} ${item.badgeLabel ?? ""}`.trim() : undefined}
                    className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-sm font-bold transition-colors duration-150 ${isActive ? "bg-paper text-navy shadow-sm" : "text-white hover:bg-white/10"}`}
                  >
                    {item.label}
                    {!!item.badge && (
                      // gold, the brand's rare honour, on either pill: navy-900 on gold is 7.6:1 behind 12px digits
                      <span aria-hidden className="rounded-full bg-gold px-1.5 text-xs font-bold leading-5 text-navy-900 tabular-nums">
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
              <span className="truncate text-sm" title={`${user.name} · ${user.roleLabel}`}>
                {user.name} · <span className="text-white/80">{user.roleLabel}</span>
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
    <div role="status" data-update-banner className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line bg-paper-light px-4 py-1.5 text-sm print:hidden">
      <span>גרסה חדשה של האתר זמינה</span>
      <button type="button" onClick={onApply} className="inline-flex min-h-11 items-center rounded-full border border-navy bg-card px-4 font-bold text-navy hover:bg-accent-soft">
        רענון
      </button>
    </div>
  );
}

/** The seal, white, beside the visible name — decorative (alt=""), the name says it. */
function Seal() {
  return <img src={seal} alt="" width={36} height={36} className="size-9 shrink-0" />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-card p-5 shadow-sm ${className}`}>{children}</section>;
}
