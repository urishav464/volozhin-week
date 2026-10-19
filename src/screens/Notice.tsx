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
        <h2 className="font-display font-semibold text-lg mb-2">{title}</h2>
        <div className="text-ink-soft space-y-2">{children}</div>
        {actions.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={a.onClick}
                className="rounded-lg border border-line bg-paper px-4 py-2 font-semibold hover:bg-line/50"
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
