// The week's «תורנויות» lens (8.11): the duties alone — no lesson. A wide screen has the five days across and the three
// shifts down (the grid's own columns); a phone one day at a time, with the week's day chips. Every shift is a link to
// the rota's board (logistics and admins) or its printout (everyone else). The cells come from rotaLens (rotaLens.ts).
import { Link } from "react-router";
import type { RotaData } from "../data/rota";
import { rotaShiftsOf, shiftBounds } from "../domain/rota";
import { DAYS, DAY_NAMES, type Day, dateOf, fmtRange, hebrewDate, shortDate } from "../domain/time";
import type { Edition } from "../domain/types";
import { ShiftLabel } from "../screens/rota/shared";
import { type LensShift, lensShiftText, rotaLens } from "./rotaLens";

type LensEdition = Pick<Edition, "first_day_from" | "last_day_until" | "settings" | "start_date">;

interface Props {
  edition: LensEdition;
  data: RotaData;
  wide: boolean;
  day: Day;
  onDay: (d: Day) => void;
  /** Where a shift leads: «לוגיסטיקה ← תורנויות» or «תוצרים ← תורנויות». */
  boardHref: string;
}

const COLS = "6.5rem repeat(5, minmax(0, 1fr))";
const HATCH = "bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(35_67_119/0.07)_6px_8px)]";

function dateText(edition: LensEdition, day: Day): string {
  const date = dateOf(edition.start_date, day);
  return date ? `${shortDate(date)} · ${hebrewDate(date)}` : "תאריך TBD";
}

/** A group's code; a dashed edge when «הצעה הוגנת» put it there and no hand has touched it since. */
function Chip({ code, suggested }: { code: string; suggested: boolean }) {
  return (
    <span
      data-lens-chip={code}
      data-suggested={suggested || undefined}
      className={`inline-flex rounded-full border px-1.5 text-sm leading-5 font-bold whitespace-nowrap text-navy ${suggested ? "border-dashed border-navy/60 bg-card" : "border-navy/30 bg-accent-soft"}`}
    >
      <bdi>{code}</bdi>
    </span>
  );
}

/** One shift's duties and leads; the range when the week cuts it (Sunday's opening, Thursday's close). */
function ShiftBody({ cell, edition, showRange }: { cell: LensShift; edition: LensEdition; showRange: boolean }) {
  const base = shiftBounds(rotaShiftsOf(edition), cell.shift);
  const cut = cell.range && (cell.range.start !== base.from || cell.range.end !== base.to);
  return (
    <>
      {showRange && cut && cell.range && (
        <bdi dir="ltr" className="mb-1 block text-end text-[11px] text-ink-faint tabular-nums">
          {fmtRange(cell.range.start, cell.range.end)}
        </bdi>
      )}
      {cell.duties.length ? (
        <ul className="space-y-1">
          {cell.duties.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-1 text-sm" data-lens-duty={d.name}>
              <span className="font-semibold text-ink">{d.name}:</span>
              {d.groups.map((g) => (
                <Chip key={g.id} code={g.code} suggested={g.suggested} />
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-faint">אין שיבוצים</p>
      )}
      {cell.leads.length > 0 && <p className="mt-1.5 text-xs text-ink-soft">אחראי/ת: {cell.leads.join(", ")}</p>}
    </>
  );
}

function ShiftCell({ cell, edition, href, label, tall }: { cell: LensShift; edition: LensEdition; href: string; label: string; tall: boolean }) {
  const min = tall ? "min-h-28" : "min-h-16";
  // not part of the week (Thursday's night): hatched like the grid's closed bands — unless a stale row is still on it
  if (!cell.range && cell.duties.length === 0) {
    return (
      <div className={`h-full ${min} rounded-lg border border-line/70 ${HATCH}`} title="מחוץ לשעות השבוע" data-lens-shift={`${cell.day}:${cell.shift}`}>
        <span className="sr-only">
          {DAY_NAMES[cell.day]}, {label}: מחוץ לשבוע
        </span>
      </div>
    );
  }
  return (
    <Link
      to={href}
      aria-label={`${DAY_NAMES[cell.day]}, ${label}: ${cell.range ? "" : "מחוץ לשבוע — "}${lensShiftText(cell)}`}
      className={`block h-full ${min} rounded-lg border bg-card p-2 shadow-sm transition-shadow hover:border-navy/40 hover:shadow-md ${cell.range ? "border-line" : "border-amber-400"}`}
      data-lens-shift={`${cell.day}:${cell.shift}`}
    >
      <ShiftBody cell={cell} edition={edition} showRange={tall} />
    </Link>
  );
}

export function RotaWeek({ edition, data, wide, day, onDay, boardHref }: Props) {
  const cells = rotaLens(edition, data);
  const labels = rotaShiftsOf(edition).labels;

  if (wide) {
    return (
      <div role="table" aria-label="התורנויות בשבוע" className="min-w-[46rem]" data-rota-week>
        <div role="rowgroup" className="sticky top-0 z-20 bg-paper pb-1">
          <div role="row" className="grid gap-1" style={{ gridTemplateColumns: COLS }}>
            {/* the corner holds its column (an sr-only cell alone is taken out of the grid) */}
            <div role="columnheader">
              <span className="sr-only">משמרת</span>
            </div>
            {DAYS.map((d) => (
              <div key={d} role="columnheader" className="rounded-xl border border-line bg-card px-2.5 py-1.5 shadow-sm">
                <span className="flex items-baseline gap-1.5">
                  <span className="font-display text-[15px] font-extrabold text-navy">{DAY_NAMES[d]}</span>
                  <span className="min-w-0 truncate text-[11px] text-ink-faint">{dateText(edition, d)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div role="rowgroup" className="space-y-1">
          {([0, 1, 2] as const).map((shift) => (
            <div key={shift} role="row" className="grid gap-1" style={{ gridTemplateColumns: COLS }}>
              <div role="rowheader" className="pe-1 pt-1 text-end text-xs font-bold text-navy">
                <ShiftLabel edition={edition} shift={shift} />
              </div>
              {DAYS.map((d) => (
                <div key={d} role="cell">
                  <ShiftCell cell={cells[d][shift]} edition={edition} href={boardHref} label={labels[shift]} tall />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-rota-week>
      <div role="tablist" aria-label="ימים" className="sticky top-0 z-20 -mx-3 flex gap-1 overflow-x-auto bg-paper px-3 py-2">
        {DAYS.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={d === day}
            onClick={() => onDay(d)}
            className={`flex min-h-11 shrink-0 items-center rounded-full border px-3.5 text-sm font-semibold transition-colors ${d === day ? "border-navy bg-navy text-white shadow-sm" : "border-line bg-card text-ink hover:border-navy/40 hover:bg-accent-soft"}`}
          >
            {DAY_NAMES[d]}
          </button>
        ))}
      </div>
      <p className="text-sm">
        <span className="font-display font-extrabold text-navy">{DAY_NAMES[day]}</span> <span className="text-ink-faint">{dateText(edition, day)}</span>
      </p>
      <ul className="space-y-2" aria-label={`התורנויות ביום ${DAY_NAMES[day]}`}>
        {([0, 1, 2] as const).map((shift) => (
          <li key={shift}>
            <h3 className="mb-1 text-sm font-bold text-navy">
              <ShiftLabel edition={edition} shift={shift} day={day} />
            </h3>
            <ShiftCell cell={cells[day][shift]} edition={edition} href={boardHref} label={labels[shift]} tall={false} />
          </li>
        ))}
      </ul>
    </div>
  );
}
