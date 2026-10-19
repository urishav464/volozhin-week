import type { ReactNode } from "react";

interface Props {
  demo: boolean;
  user?: { name: string; roleLabel: string } | null;
  onSignOut?: () => void;
  children: ReactNode;
}

export function Shell({ demo, user, onSignOut, children }: Props) {
  return (
    <div className="min-h-dvh flex flex-col">
      {demo && (
        <div role="status" className="bg-accent-soft text-ink text-sm text-center px-4 py-2">
          מצב הדגמה — נתונים לדוגמה בלבד, שום דבר לא נשמר
        </div>
      )}
      <header className="bg-ink text-paper">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-3">
          <h1 className="font-display font-extrabold text-xl tracking-tight">שבוע וולוז'ין</h1>
          <div className="ms-auto flex items-center gap-3 min-w-0">
            {user && (
              <span className="text-sm truncate">
                {user.name} · <span className="opacity-80">{user.roleLabel}</span>
              </span>
            )}
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="text-sm rounded-md border border-paper/40 px-3 py-1 hover:bg-paper/10"
              >
                התנתקות
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <section className="bg-card border border-line rounded-xl p-5 shadow-sm">{children}</section>;
}
