import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

interface Props {
  demo: boolean;
  user?: { name: string; roleLabel: string } | null;
  onSignOut?: () => void;
  /** An admin's way to «הגדרות» (and back to the week from there). */
  settingsLink?: boolean;
  /** The grid needs the whole width; notices and forms stay in a reading column. */
  full?: boolean;
  children: ReactNode;
}

const HEADER_BUTTON = "inline-flex min-h-11 shrink-0 items-center rounded-md border border-paper/40 px-3 text-sm hover:bg-paper/10";

export function Shell({ demo, user, onSignOut, settingsLink = false, full = false, children }: Props) {
  const inSettings = useLocation().pathname.startsWith("/settings");
  return (
    <div className="min-h-dvh flex flex-col">
      {demo && (
        <div role="status" className="bg-accent-soft text-ink text-sm text-center px-4 py-2">
          מצב הדגמה — נתונים לדוגמה בלבד, שום דבר לא נשמר
        </div>
      )}
      <header className="bg-ink text-paper">
        <div className={`mx-auto ${full ? "max-w-none" : "max-w-6xl"} px-4 h-14 flex items-center gap-2 sm:gap-3`}>
          <h1 className="shrink-0 font-display font-extrabold text-xl tracking-tight">
            {settingsLink ? (
              <Link to="/" className="rounded-sm">
                שבוע וולוז'ין
              </Link>
            ) : (
              "שבוע וולוז'ין"
            )}
          </h1>
          <div className="ms-auto flex items-center gap-2 sm:gap-3 min-w-0">
            {user && (
              <span className="text-sm truncate">
                {user.name} · <span className="opacity-80">{user.roleLabel}</span>
              </span>
            )}
            {settingsLink &&
              (inSettings ? (
                <Link to="/" className={HEADER_BUTTON}>
                  לשבוע
                </Link>
              ) : (
                <Link to="/settings" className={HEADER_BUTTON}>
                  הגדרות
                </Link>
              ))}
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
