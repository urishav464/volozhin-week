// The schedule to view (/s#token): the designer's public schedule — the same
// facts (src/exports/designer.ts scheduleEntries, written by designerRow) — by
// day, read-only, and printable on A4. Never a contact, an amount or a note:
// public.schedule_view returns none.
import type { PublicPort, ScheduleView } from "../../data/publicPort";
import { designerRow } from "../../exports/designer";
import { DAY_NAMES, type Day } from "../../domain/time";
import { Button } from "../settings/kit";
import { PrintSetup } from "../outputs/parts";
import { dayLabel, LinkInvalid, LoadFailed, Loading, useLinkLoad } from "./parts";

export function SchedulePage({ port, token }: { port: PublicPort; token: string }) {
  const { load, reload } = useLinkLoad(() => port.scheduleView(token));
  if (load.state === "loading") return <Loading />;
  if (load.state === "invalid") return <LinkInvalid />;
  if (load.state === "error") return <LoadFailed onRetry={() => void reload().catch(() => {})} />;
  return <Schedule view={load.data} />;
}

function Schedule({ view: v }: { view: ScheduleView }) {
  const title = `לו"ז שבוע וולוז'ין ${v.edition.label}`;
  const days = [...new Set(v.rows.map((r) => r.day))].sort((a, b) => a - b) as Day[];
  return (
    <>
      <PrintSetup landscape={false} title={title} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
        <h2 className="min-w-0 flex-1 font-display text-2xl font-extrabold">{title}</h2>
        {v.rows.length > 0 && <Button onClick={() => window.print()}>הדפסה</Button>}
      </div>
      {!v.edition.start_date && <p className="text-sm text-ink-soft">תאריך השבוע עוד לא נקבע (TBD).</p>}
      {v.rows.length === 0 && <p className="rounded-xl border border-line bg-card p-4 text-ink-soft">עוד אין שיעורים סגורים בלו"ז.</p>}
      {days.map((day) => {
        const rows = v.rows.map((e, i) => ({ e, r: designerRow(e, i) })).filter((x) => x.e.day === day);
        const date = rows[0].r.date;
        return (
          <section key={day} aria-label={`יום ${DAY_NAMES[day]}`} className="rounded-xl border border-line bg-card p-4 print:break-inside-auto print:rounded-none print:border-0 print:p-0">
            <h3 className="mb-2 font-display text-lg font-semibold">
              יום {DAY_NAMES[day]}
              {date !== "TBD" && <span className="font-sans text-base font-normal text-ink-soft"> · {date}</span>}
            </h3>
            <ol className="divide-y divide-line">
              {rows.map(({ e, r }, i) => (
                <li
                  key={i}
                  data-schedule-row
                  className={`grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 py-2 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,12rem)] ${r.kind === "memorial" ? "bg-amber-50 px-1" : ""}`}
                >
                  <div className="whitespace-nowrap tabular-nums">
                    <bdi dir="ltr">{r.time}</bdi>
                    {e.start_min >= 1440 && day < 4 && <span className="block text-xs text-ink-soft">{dayLabel(day, e.start_min)}</span>}
                  </div>
                  <div className="min-w-0">
                    {r.speaker && <p className="font-semibold break-words">{r.speaker}</p>}
                    <p className="break-words">{r.title}</p>
                  </div>
                  <p className="col-start-2 text-sm text-ink-soft break-words sm:col-start-auto">
                    {[r.category, r.room, r.parallel ? "במקביל" : ""].filter(Boolean).join(" · ")}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </>
  );
}
