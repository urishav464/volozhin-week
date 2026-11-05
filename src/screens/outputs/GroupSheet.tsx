// A group's own week on one page (milestone 7, «לו"ז לכל קבוצה»): the five days side by side, each shift a sage band
// naming the group's duty (or «בלי תורנות»), the lessons, «זמן זיכרון», the meals and מכריכה לכריכה under it — what
// src/exports/rota.ts groupWeek makes from the public schedule, the rows, the group, the duties and its assignments:
// no Week and no phone, so a trainees' page could draw the same. Printed: A4 landscape, a group a page
// (print:break-before-page, the escorts' list's way). On a phone: one day at a time.
import { useId, useState } from "react";
import { groupDetails, type GroupWeek } from "../../exports/rota";
import { type Day, fmtRange } from "../../domain/time";

export function GroupSheet({ week, first, printed }: { week: GroupWeek; /** The first page printed: no page break before it. */ first: boolean; printed: string }) {
  const id = useId();
  const [day, setDay] = useState<Day>(week.days[0]?.day ?? 0);
  const g = week.group;
  return (
    <section
      data-group-sheet={g.code}
      aria-labelledby={`${id}-title`}
      className={`break-inside-avoid rounded-xl border border-line bg-card p-3 shadow-sm sm:p-4 print:rounded-none print:border-0 print:p-0 print:shadow-none ${first ? "" : "print:break-before-page"}`}
    >
      <header className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b-2 border-navy pb-1.5">
        <h3 id={`${id}-title`} className="font-display text-2xl font-extrabold text-navy print:text-xl">
          לו״ז <bdi>{g.code}</bdi>
        </h3>
        <p className="min-w-0 text-sm text-ink break-words">{groupDetails(g).join(" · ")}</p>
        <p className="ms-auto text-xs text-ink-soft">
          שבוע וולוז'ין {week.editionLabel} · {printed}
        </p>
      </header>

      {/* a phone: one day at a time */}
      <div role="group" aria-label="יום" className="mb-2 flex gap-1 overflow-x-hidden md:hidden print:hidden">
        {week.days.map((d) => (
          <button
            key={d.day}
            type="button"
            aria-pressed={d.day === day}
            onClick={() => setDay(d.day)}
            className={`inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-full border px-1 text-sm font-bold ${d.day === day ? "border-navy bg-navy text-white" : "border-line bg-card text-navy hover:bg-accent-soft"}`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-5 print:grid-cols-5 print:gap-1.5">
        {week.days.map((d) => (
          <div key={d.day} data-group-day={d.day} className={`min-w-0 ${d.day === day ? "" : "hidden"} md:block print:block`}>
            <h4 className="mb-1 rounded-md bg-navy px-2 py-1 text-center font-bold text-white print:py-0.5 print:text-[9pt]">
              {d.label}
              {d.date && <span className="font-normal"> · {d.date}</span>}
            </h4>
            {d.shifts.map((s) => (
              <div key={s.shift} data-shift={s.shift} className="mb-1.5 break-inside-avoid">
                <p
                  data-duty-band={s.duty ?? ""}
                  className="flex flex-wrap items-baseline justify-between gap-x-1 rounded-md border border-sage bg-sage-soft px-1.5 py-1 text-sm print:py-0.5 print:text-[8pt]"
                >
                  <span className="font-bold text-ink">
                    {s.label}{" "}
                    <bdi dir="ltr" className="font-normal whitespace-nowrap text-ink-soft">
                      {fmtRange(s.start, s.end)}
                    </bdi>
                  </span>
                  <span className={s.duty ? "font-extrabold text-navy" : "text-ink-soft"}>{s.duty ? `תורנות: ${s.duty}` : "בלי תורנות"}</span>
                </p>
                <ul className="mt-0.5 space-y-0.5 px-0.5">
                  {s.items.map((it, i) => (
                    <li key={i} data-item={it.kind} className={`flex gap-1.5 text-sm leading-snug print:text-[7.5pt] print:leading-tight ${it.kind === "lesson" ? "" : "text-ink-soft"}`}>
                      <bdi dir="ltr" className="shrink-0 tabular-nums">
                        {fmtRange(it.start, it.end)}
                      </bdi>
                      <span className={`min-w-0 break-words ${it.kind === "memorial" ? "font-semibold text-ink" : ""}`}>{it.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
