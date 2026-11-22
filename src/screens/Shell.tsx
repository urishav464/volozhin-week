import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import seal from "../assets/brand/ein-prat-white.png";
import { MORE_LABEL, moreLabel, splitNav } from "./nav";

/** One of the site's sections in the header (src/screens/nav.ts): «השבוע», «ימים», «אישורים» (with a badge), «הגדרות»… */
export interface NavItem {
  to: string;
  label: string;
  /** A count beside the label (speakers waiting for approval); hidden at 0. */
  badge?: number;
  /** What the count means, for a screen reader: the link reads «אישורים, 5 ממתינים». */
  badgeLabel?: string;
  /** The paths this section covers (the outputs: /tracking, /print/…, /export/…); default: `to` and below. */
  match?: string[];
  /**
   * Below 1024px the section sits behind «עוד» (the reset, phase 5 — nav.ts navFor sets it, splitNav splits by it); from
   * 1024px every section is in the row. Never set on a section with a badge.
   */
  more?: true;
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

/**
 * A section's pill in the header — the row's, «עוד»'s and the panel's alike. From 1024px to 1280px a little slimmer
 * (px-2, the row's gap 2px): the staff's twelve (phase 5 added «מצגות») beside the name and «התנתקות» at 1024px.
 */
const NAV_PILL = "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2.5 lg:px-2 xl:px-2.5 text-sm font-bold transition-colors duration-150";
const PILL_ON = "bg-paper text-navy shadow-sm";
const PILL_OFF = "text-white hover:bg-white/10";

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
            Below 1024px the sections move to a row of their own, under the name and «התנתקות» — one row:
            since the reset's phase 5 the sections a role uses less sit behind «עוד» (HeaderNav, below).
            From 1024px every section is in the row (shrink-0) and the member's name gives way
            (truncated, the whole name on hover). */}
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
          {nav && nav.length > 0 && <HeaderNav items={nav} path={path} />}
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

/**
 * The sections (nav.ts navFor). From 1024px all of them in one row, as before the reset's phase 5. Below it, the row
 * holds a role's first few (splitNav's `inline`) and «עוד», a disclosure button (never a menu: links in a list, Tab
 * walks them) that opens the rest under the row, in the header's order — `more` is always the header's tail (nav.test),
 * so the panel's list is drawn ONCE: from 1024px it is simply the row's end, «עוד» hidden. It closes on Escape (the
 * focus back on «עוד»), on a tap outside it, and when the page changes (a link in it gives «עוד» the focus, so it never
 * falls to the page). While the page is under a section behind it, «עוד» wears the active pill: «עוד, כאן: …».
 * A trainee's four or five need no «עוד» (no `more`: no button).
 */
function HeaderNav({ items, path }: { items: NavItem[]; path: string }) {
  const { inline, more } = splitNav(items);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLUListElement>(null);
  const here = more.find((i) => sectionActive(i, path)) ?? null;

  // a new page closes it; the focus, if it was in the panel, goes to «עוד» (the link it was on is hidden now)
  const shownAt = useRef(path);
  useEffect(() => {
    if (shownAt.current === path) return;
    shownAt.current = path;
    if (panel.current?.contains(document.activeElement)) button.current?.focus();
    setOpen(false);
  }, [path]);

  // open: Escape closes (the focus back on «עוד» when it was in the header or nowhere), a tap outside closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const at = document.activeElement;
      setOpen(false);
      if (at == null || at === document.body || panel.current?.contains(at) || at === button.current) button.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (panel.current?.contains(t) || button.current?.contains(t))) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    // lg:p-1: the sideways-scroll box clips what overflows it, so a link's focus ring (4px out) needs the room
    <nav aria-label="אזורי המערכת" className="order-last flex w-full flex-wrap gap-1 pb-2 lg:order-none lg:w-auto lg:shrink-0 lg:flex-nowrap lg:gap-0.5 lg:overflow-x-auto lg:p-1 xl:gap-1">
      {inline.map((item) => (
        <NavLink key={item.to} item={item} path={path} />
      ))}
      {more.length > 0 && (
        <>
          <button
            ref={button}
            type="button"
            aria-expanded={open}
            aria-controls="nav-more"
            aria-label={here ? moreLabel(here) : undefined}
            data-nav-more
            data-active={here ? "" : undefined}
            onClick={() => setOpen((v) => !v)}
            className={`${NAV_PILL} lg:hidden ${here ? PILL_ON : open ? "bg-white/15 text-white" : PILL_OFF}`}
          >
            {MORE_LABEL}
            <span aria-hidden className={`text-xs motion-safe:transition-transform ${open ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>
          {/* below 1024px: only while open, a line of its own under the row; from 1024px: the row's end */}
          <ul
            ref={panel}
            id="nav-more"
            data-nav-more-panel
            className={`${open ? "flex" : "hidden"} basis-full flex-wrap gap-1 border-t border-white/20 pt-1 lg:flex lg:basis-auto lg:flex-nowrap lg:gap-0.5 lg:border-0 lg:pt-0 xl:gap-1`}
          >
            {more.map((item) => (
              <li key={item.to} className="flex">
                <NavLink
                  item={item}
                  path={path}
                  onPick={() => {
                    // the same page again (no route change): close all the same, the focus on «עוד»
                    if (!open) return;
                    setOpen(false);
                    button.current?.focus();
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  );
}

function NavLink({ item, path, onPick }: { item: NavItem; path: string; onPick?: () => void }) {
  const isActive = sectionActive(item, path);
  return (
    <Link
      to={item.to}
      data-nav-item={item.to}
      aria-current={isActive ? "page" : undefined}
      aria-label={item.badge ? `${item.label}, ${item.badge} ${item.badgeLabel ?? ""}`.trim() : undefined}
      onClick={onPick}
      className={`${NAV_PILL} ${isActive ? PILL_ON : PILL_OFF}`}
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
