import type { ReactNode } from "react";
import { Card } from "./Shell";

interface Action {
  label: string;
  onClick: () => void;
}

export function Notice({ title, children, actions = [] }: { title: string; children: ReactNode; actions?: Action[] }) {
  return (
    <div className="mx-auto max-w-lg mt-8">
      <Card>
        <h2 className="mb-2 font-display text-xl font-extrabold text-navy">{title}</h2>
        <div className="space-y-2 leading-relaxed text-ink-soft">{children}</div>
        {actions.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={a.onClick}
                className="inline-flex min-h-11 items-center rounded-full border border-navy bg-card px-4 font-bold text-navy transition-colors duration-150 hover:bg-accent-soft"
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
