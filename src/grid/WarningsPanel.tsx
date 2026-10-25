import { DAYS, DAY_NAMES, type Day } from "../domain/time";
import type { GridModel } from "./model";
import { Sheet } from "./Panels";

export function WarningsPanel({ model, onLesson, onDay, onClose, wide }: { model: GridModel; onLesson: (id: number) => void; onDay?: (day: Day) => void; onClose: () => void; wide: boolean }) {
  const total = model.warnings.length;
  return (
    <Sheet title="אזהרות" subtitle={total ? `${total} לבדיקה — אף אחת לא חוסמת` : "אין אזהרות"} onClose={onClose} wide={wide}>
      {DAYS.map((d) => {
        const list = model.warnings.filter((w) => w.day === d);
        if (!list.length) return null;
        return (
          <section key={d}>
            <h3 className="mb-1 font-semibold">{DAY_NAMES[d]}</h3>
            <ul className="space-y-1">
              {list.map((w) => (
                <li key={w.key}>
                  <button
                    type="button"
                    // a day's own warning (v13: «לא מאוזן») opens the day; the others, their first lesson
                    onClick={() => (w.lessonIds.length ? onLesson(w.lessonIds[0]) : onDay?.(w.day))}
                    className={`w-full rounded-md px-2 py-1.5 text-start text-sm ${w.severity === "warn" ? "bg-amber-50 text-amber-900 hover:bg-amber-100" : "bg-sky-50 text-sky-900 hover:bg-sky-100"}`}
                  >
                    {w.severity === "warn" ? "⚠ " : "ℹ "}
                    {w.message}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </Sheet>
  );
}
