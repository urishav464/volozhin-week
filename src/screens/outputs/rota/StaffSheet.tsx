// «משמרות צוות» on /print/rota (v20) — the staff's schedule: a column a day, a row a time row of the grid, the staff on
// then in each cell (src/exports/staffSchedule.ts — the hours beside a name in the first row it is on). This page is
// open to every member of the edition, so it NEVER shows a transport (the logistics side prints «הסעות וצוות» with
// them) — nor a note or a phone: the cells are names. From 1024px and on paper the whole table (the sheet the CSV and
// the xlsx write); below it one day at a time, the day chosen with the day tabs — never a sideways scroll.
import { useState } from "react";
import type { RotaData } from "../../../data/rota";
import { ROTA_DAYS } from "../../../domain/rota";
import { DAY_NAMES, type Day, fmtRange } from "../../../domain/time";
import type { Week } from "../../../domain/types";
import { dayRowIndexes, OUTSIDE_ROWS, rowNight, staffSchedule, staffScheduleTable } from "../../../exports/staffSchedule";
import { staffWho } from "../../../exports/rota";
import type { Table } from "../../../exports/table";
import { TableView } from "./TableView";

/** The staff page's tables (what its CSV writes, too). */
export function staffTables(week: Pick<Week, "edition" | "rows">, data: RotaData): Table[] {
  return [staffScheduleTable(week, data)];
}

/** On screen and paper only (never the files): a range «08:30–14:30» kept on one line — WORD JOINERs round its dash. */
const keepRange = (cell: string) => cell.replace(/(\d)–(\d)/g, "$1\u2060–\u2060$2");

export function StaffSheet({ week, data }: { week: Week; data: RotaData }) {
  const [day, setDay] = useState<Day>(0);
  const [sheet] = staffTables(week, data);
  const table = { ...sheet, rows: sheet.rows.map((r) => r.map(keepRange)) };
  return (
    <div data-staff-sheet className="space-y-3">
      <section aria-label={table.name} className="hidden lg:block print:block">
        <TableView table={table} keys={2} fixed />
      </section>
      <div className="space-y-2 lg:hidden print:hidden">
        <div role="tablist" aria-label="ימים" className="flex flex-wrap gap-1.5">
          {ROTA_DAYS.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === day}
              data-staff-day-tab={d}
              onClick={() => setDay(d)}
              className={`inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm font-semibold transition-colors ${d === day ? "border-navy bg-navy text-white shadow-sm" : "border-line bg-card text-ink hover:border-navy/40 hover:bg-accent-soft"}`}
            >
              {DAY_NAMES[d]}
            </button>
          ))}
        </div>
        <StaffDay week={week} data={data} day={day} />
      </div>
    </div>
  );
}

/**
 * One day of the schedule, row under row: the time, the grid's label, the staff on then (the hours beside a name in its
 * first row). A range never breaks at its dash (the review: «08:30–» / «14:30» read as two times) — nowrap, as the
 * table's WORD JOINERs do.
 */
function StaffDay({ week, data, day }: { week: Week; data: RotaData; day: Day }) {
  const s = staffSchedule(week, data);
  const outside = s.outside[day];
  return (
    <ul role="tabpanel" aria-label={`משמרות הצוות ביום ${DAY_NAMES[day]}`} data-staff-day={day} className="divide-y divide-sage/60 rounded-xl border border-line bg-card px-3 shadow-sm">
      {dayRowIndexes(s.rows, day).map((i) => {
        const r = s.rows[i];
        const night = rowNight(day, r);
        const on = r.cells[day]!;
        return (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
            <span className="min-w-0 basis-40">
              <bdi dir="ltr" className="font-bold whitespace-nowrap text-navy tabular-nums">
                {fmtRange(r.start, r.end)}
              </bdi>
              {(r.label || night) && <span className="block text-xs text-ink-soft">{[night, r.label].filter(Boolean).join(" · ")}</span>}
            </span>
            <span className="min-w-0 flex-1 break-words">
              {on.length === 0
                ? "—"
                : on.map((x, k) => (
                    <span key={x.id}>
                      {k > 0 && ", "}
                      {staffWho(data, x)}
                      {s.first.get(x.id) === i && (
                        <>
                          {" "}
                          <bdi dir="ltr" className="whitespace-nowrap text-ink-soft tabular-nums">
                            {fmtRange(x.start_min, x.end_min)}
                          </bdi>
                        </>
                      )}
                    </span>
                  ))}
            </span>
          </li>
        );
      })}
      {outside.length > 0 && (
        <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
          <span className="min-w-0 basis-40 font-bold text-navy">{OUTSIDE_ROWS}</span>
          <span className="min-w-0 flex-1 break-words">
            {outside.map((x, k) => (
              <span key={x.id}>
                {k > 0 && ", "}
                {staffWho(data, x)}{" "}
                <bdi dir="ltr" className="whitespace-nowrap text-ink-soft tabular-nums">
                  {fmtRange(x.start_min, x.end_min)}
                </bdi>
              </span>
            ))}
          </span>
        </li>
      )}
    </ul>
  );
}
