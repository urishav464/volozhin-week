// A speaker's availability day by day, as five small squares (v14: per slot — src/domain/availability.ts): green when
// the day's marked rows say «יכול/ה», red when they say «לא», half and half when it is both — «יכול/ה רק בשעות…», never
// read as a day they cannot. The squares say it to the eye; the strip's name, to a screen reader. The pool's cards and
// the speakers' list both draw it.
import { activeLessonRows, type DayKind, dayKind, slotKey } from "../domain/availability";
import { byGender } from "../domain/names";
import { DAYS, DAY_NAMES, fmt } from "../domain/time";
import type { Speaker } from "../domain/types";
import type { GridModel } from "./model";

/** A day's square: «some» is green over red (part of the day «יכול/ה», the rest «לא»). */
const SQUARE: Record<DayKind | "none", string> = {
  can: "bg-emerald-400",
  cannot: "bg-red-300",
  some: "bg-linear-to-b from-emerald-400 from-50% to-red-300 to-50%",
  none: "bg-line",
};

/** Nothing said — or only of rows the week no longer holds: null (the caller decides what to show instead). */
export function AvailabilityStrip({ model, speaker: s, size = "sm", className = "" }: { model: GridModel; speaker: Speaker; size?: "sm" | "md"; className?: string }) {
  const mine = model.slots.get(s.id);
  if (!mine) return null;
  const { rows, edition } = model.week;
  const days = DAYS.map((d) => {
    const active = activeLessonRows(rows, edition, d);
    const at = (kind: "can" | "cannot") => active.filter((r) => mine.get(slotKey(d, r.id))?.kind === kind).map((r) => fmt(r.start_min));
    const can = at("can");
    const cannot = at("cannot");
    const said = [cannot.length > 0 && `${byGender(s.gender, "לא יכול", "לא יכולה")} ${cannot.join(", ")}`, can.length > 0 && `${byGender(s.gender, "יכול", "יכולה")} ${can.join(", ")}`].filter(Boolean);
    return { d, kind: dayKind(mine, d, active), text: `${DAY_NAMES[d]}: ${said.join("; ") || "לא נמסר"}` };
  });
  if (!days.some((x) => x.kind)) return null;
  const square = size === "md" ? "h-3 w-4" : "h-2 w-2.5";
  return (
    <span role="img" className={`inline-flex gap-0.5 ${className}`} aria-label={`זמינות — ${days.filter((x) => x.kind).map((x) => x.text).join(" · ")}`}>
      {days.map(({ d, kind, text }) => (
        <span key={d} title={text} data-day-kind={kind ?? "none"} className={`${square} rounded-sm ${SQUARE[kind ?? "none"]}`} />
      ))}
    </span>
  );
}
