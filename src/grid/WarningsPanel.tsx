// The week's warnings, by day — each opens its lesson (or its day). What is only to
// know (lessons side by side, a lesson missing a detail) waits in one fold at the end,
// so what needs a look is not buried under it.
import { DAYS, DAY_NAMES, type Day } from "../domain/time";
import type { Warning } from "../rules/warnings";
import { Fold } from "../screens/settings/kit";
import type { GridModel } from "./model";
import { Section, Sheet } from "./Panels";

export function WarningsPanel({ model, onLesson, onDay, onClose, wide }: { model: GridModel; onLesson: (id: number) => void; onDay?: (day: Day) => void; onClose: () => void; wide: boolean }) {
  const warn = model.warnings.filter((w) => w.severity === "warn");
  const info = model.warnings.filter((w) => w.severity === "info");
  const subtitle = [warn.length > 0 && `${warn.length} לבדיקה`, info.length > 0 && `${info.length} לידיעה`].filter(Boolean).join(" · ") || "אין אזהרות";
  // a day's own warning (v13: «לא מאוזן») opens the day; the others, their first lesson
  const open = (w: Warning) => (w.lessonIds.length ? onLesson(w.lessonIds[0]) : onDay?.(w.day));
  return (
    <Sheet title="אזהרות" subtitle={subtitle} onClose={onClose} wide={wide}>
      {DAYS.map((d) => {
        const list = warn.filter((w) => w.day === d);
        if (!list.length) return null;
        return (
          <Section key={d} title={DAY_NAMES[d]} count={list.length}>
            <Items list={list} open={open} />
          </Section>
        );
      })}
      {info.length > 0 && (
        <Fold title="לידיעה" hint={<span className="tabular-nums text-ink-faint">{info.length}</span>} defaultOpen={warn.length === 0}>
          <div className="space-y-3">
            {DAYS.map((d) => {
              const list = info.filter((w) => w.day === d);
              if (!list.length) return null;
              return (
                <div key={d}>
                  <h4 className="mb-1 text-[13px] font-semibold text-ink-soft">{DAY_NAMES[d]}</h4>
                  <Items list={list} open={open} />
                </div>
              );
            })}
          </div>
        </Fold>
      )}
    </Sheet>
  );
}

/** A day's warnings, each a button: amber to look at, blue to know; the ‹ says it opens. */
function Items({ list, open }: { list: Warning[]; open: (w: Warning) => void }) {
  return (
    <ul className="space-y-1">
      {list.map((w) => (
        <li key={w.key}>
          <button
            type="button"
            onClick={() => open(w)}
            className={`flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-start text-sm ${w.severity === "warn" ? "bg-amber-50 text-amber-900 hover:bg-amber-100" : "bg-sky-50 text-sky-900 hover:bg-sky-100"}`}
          >
            {/* the glyph a box of its own: before a number («ℹ 2 שיעורים…») it would swap sides */}
            <span aria-hidden className="shrink-0">
              {w.severity === "warn" ? "⚠" : "ℹ"}
            </span>
            <span>{w.message}</span>
            <span aria-hidden className="ms-auto shrink-0 opacity-60">
              ‹
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
