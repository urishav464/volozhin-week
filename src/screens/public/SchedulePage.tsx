// The schedule to view (/s#token) — since the reset's phase 5 also the guests' site (DECISIONS «הריסט, שלב 5», א).
// One read, public.schedule_view: the designer's public schedule (src/exports/designer.ts scheduleEntries, written by
// designerRow) and, since v19, each lesson's short description for guests (`note`), the speakers approved to appear
// (`people`: public_ok — their description and photo) and the grid's fixed rows (meals, prayers, «מכריכה לכריכה»).
// Never a contact, an amount or a note of the team's: schedule_view returns none. An answer written before v19 (a
// database not yet re-run) is drawn as the plain schedule (guestView fills the missing keys in empty).
//
// By day, the fixed rows among the lessons by time (guestDays.ts). On a phone and a tablet one column under a sticky
// bar of the days — BUTTONS that scroll, never a «#day» link: the address's hash is the link's token (src/Root.tsx reads
// every hashchange as a new one). From 1280px the days side by side. A lesson with more than its row says (a description,
// or an approved speaker with a description or a photo) is a button «עוד פרטים» that opens its card (GuestCard.tsx); no
// photo is drawn anywhere else. On paper: the lessons and the fixed rows, never a card, a description or a photo.
import { useMemo, useRef, useState } from "react";
import type { PublicPort, ScheduleView } from "../../data/publicPort";
import { designerRow } from "../../exports/designer";
import { DAY_NAMES, type Day, fmtRange } from "../../domain/time";
import { Button } from "../settings/kit";
import { PrintSetup } from "../outputs/parts";
import { GuestCardDialog } from "./GuestCard";
import { type GuestDayItem, guestDays, guestPeople, guestView, type ScheduleAnswer } from "./guestDays";
import { dayLabel, LinkInvalid, LoadFailed, Loading, useLinkLoad } from "./parts";

export function SchedulePage({ port, token }: { port: PublicPort; token: string }) {
  const { load, reload } = useLinkLoad(() => port.scheduleView(token));
  if (load.state === "loading") return <Loading />;
  if (load.state === "invalid") return <LinkInvalid scope="schedule" />;
  if (load.state === "error") return <LoadFailed onRetry={() => void reload().catch(() => {})} />;
  return <Schedule view={load.data} />;
}

/** The days side by side from 1280px: a static class per count (Tailwind sees whole class names only). */
const COLS: Record<number, string> = { 1: "xl:grid-cols-1", 2: "xl:grid-cols-2", 3: "xl:grid-cols-3", 4: "xl:grid-cols-4", 5: "xl:grid-cols-5" };

/** A row's three parts: the time, the names and title, the category · room · «במקביל»; stacked in a day's column (xl). */
const ROW_GRID = "grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,12rem)] xl:block print:grid";

/** The first item from midnight on opens the night: a line above it. */
const NIGHT_LINE = "border-t-2 border-t-navy/25";

/**
 * The schedule by day. `preview` (the reset, phase 5): drawn inside a team page («תוצרים ← אתר האורחים») — no print setup
 * and no «הדפסה»; the page prints itself. `now` (tests): the instant «היום» is read at, else the clock's.
 */
export function Schedule({ view, preview = false, now }: { view: ScheduleView | ScheduleAnswer; preview?: boolean; now?: string }) {
  const v = useMemo(() => guestView(view), [view]);
  const people = useMemo(() => guestPeople(v), [v]);
  const [nowIso] = useState(() => now ?? new Date().toISOString());
  const days = useMemo(() => guestDays(v, nowIso, people), [v, nowIso, people]);
  const anyMore = days.some((d) => d.items.some((i) => i.type === "lesson" && i.more));
  const [open, setOpen] = useState<number | null>(null);
  const openers = useRef(new Map<number, HTMLButtonElement>());
  const sections = useRef(new Map<Day, HTMLElement>());
  const headings = useRef(new Map<Day, HTMLHeadingElement>());
  const title = `לו"ז שבוע וולוז'ין ${v.edition.label}`;

  // the day bar: the day's section to the top (under the bar: scroll-margin), the focus on its heading — no address change
  const jump = (day: Day) => {
    sections.current.get(day)?.scrollIntoView({ block: "start" });
    headings.current.get(day)?.focus({ preventScroll: true });
  };
  // the card closed (Escape, the backdrop, «סגירה»): the focus back on the row that opened it
  const close = (index: number) => {
    setOpen(null);
    openers.current.get(index)?.focus();
  };

  const item = (day: Day, it: GuestDayItem, k: number, firstNight: boolean) => {
    const night = it.night && day < 4 && (
      <span className="block text-xs font-normal text-ink-soft">{dayLabel(day, it.type === "fixed" ? it.fixed.start_min : it.row.start_min)}</span>
    );
    if (it.type === "fixed") {
      const f = it.fixed;
      return (
        <li
          key={`f${k}`}
          data-fixed-row
          className={`grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 bg-paper-light px-1 py-1.5 text-sm text-ink-soft sm:grid-cols-[7rem_minmax(0,1fr)] xl:block print:grid ${firstNight ? NIGHT_LINE : ""}`}
        >
          <span className="block whitespace-nowrap tabular-nums">
            <bdi dir="ltr">{fmtRange(f.start_min, f.end_min)}</bdi>
            {night}
          </span>
          <span className="block min-w-0 break-words">{f.label}</span>
        </li>
      );
    }
    const r = designerRow(it.row, it.index);
    const more = it.type === "lesson" && it.more;
    const inner = (
      <>
        <span className="block whitespace-nowrap font-bold text-navy tabular-nums">
          <bdi dir="ltr">{r.time}</bdi>
          {night}
        </span>
        <span className="block min-w-0">
          {r.speaker && <span className="block font-bold break-words">{r.speaker}</span>}
          <span className="block break-words">{r.title}</span>
          {more && <span className="mt-0.5 block text-sm font-bold text-navy underline underline-offset-4 print:hidden">עוד פרטים</span>}
        </span>
        <span className="col-start-2 block text-sm text-ink-soft break-words sm:col-start-auto">
          {[r.category, r.room, r.parallel ? "במקביל" : ""].filter(Boolean).join(" · ")}
        </span>
      </>
    );
    const index = it.index;
    return (
      <li
        key={`r${index}`}
        data-schedule-row
        data-kind={it.type}
        className={`${more ? "py-1" : "py-2"} ${it.type === "memorial" ? "bg-amber-50 px-1" : ""} ${firstNight ? NIGHT_LINE : ""}`}
      >
        {more ? (
          <button
            type="button"
            data-guest-lesson={index}
            aria-haspopup="dialog"
            ref={(el) => {
              if (el) openers.current.set(index, el);
              else openers.current.delete(index);
            }}
            onClick={() => setOpen(index)}
            className={`${ROW_GRID} min-h-11 w-full cursor-pointer rounded-lg px-1 py-1 text-start transition-colors duration-150 hover:bg-accent-soft`}
          >
            {inner}
          </button>
        ) : (
          <div className={ROW_GRID}>{inner}</div>
        )}
      </li>
    );
  };

  return (
    <>
      {!preview && <PrintSetup landscape={false} title={title} />}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
        <h2 className="min-w-0 flex-1 font-display text-2xl font-extrabold text-navy">{title}</h2>
        {!preview && v.rows.length > 0 && <Button onClick={() => window.print()}>הדפסה</Button>}
      </div>
      {!v.edition.start_date && <p className="text-sm text-ink-soft">תאריך השבוע עוד לא נקבע (TBD).</p>}
      {v.rows.length === 0 && <p className="rounded-xl border border-line bg-card p-4 text-ink-soft shadow-sm">עוד אין שיעורים סגורים בלו"ז.</p>}
      {anyMore && <p className="text-sm text-ink-soft print:hidden">שיעור שמסומן «עוד פרטים» נפתח בלחיצה: תיאור השיעור והמרצים.</p>}
      {days.length > 1 && (
        <nav aria-label="ימי השבוע" className="sticky top-0 z-10 flex flex-wrap gap-1 bg-paper py-1 xl:hidden print:hidden">
          {days.map((d) => (
            <button
              key={d.day}
              type="button"
              data-day-jump={d.day}
              onClick={() => jump(d.day)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full border border-line bg-card px-3 text-sm font-bold text-navy transition-colors duration-150 hover:bg-accent-soft"
            >
              {DAY_NAMES[d.day]}
              {d.today && <span className="rounded-full bg-gold-soft px-1.5 text-xs text-navy-900">היום</span>}
            </button>
          ))}
        </nav>
      )}
      {days.length > 0 && (
        <div className={`space-y-4 xl:grid xl:items-start xl:gap-3 xl:space-y-0 ${COLS[days.length] ?? ""} print:block print:space-y-4`}>
          {days.map((d) => {
            const firstNight = d.items.findIndex((i) => i.night);
            return (
              <section
                key={d.day}
                data-guest-day={d.day}
                aria-label={`יום ${DAY_NAMES[d.day]}`}
                ref={(el) => {
                  if (el) sections.current.set(d.day, el);
                  else sections.current.delete(d.day);
                }}
                className="scroll-mt-16 rounded-xl border border-line bg-card p-4 shadow-sm xl:p-3 print:break-inside-auto print:rounded-none print:border-0 print:p-0 print:shadow-none"
              >
                <h3
                  tabIndex={-1}
                  ref={(el) => {
                    if (el) headings.current.set(d.day, el);
                    else headings.current.delete(d.day);
                  }}
                  className="mb-2 font-display text-lg font-bold text-navy xl:sticky xl:top-0 xl:z-[1] xl:-mx-3 xl:-mt-3 xl:rounded-t-xl xl:bg-card xl:px-3 xl:pt-3 xl:pb-1 print:static print:m-0 print:mb-2 print:p-0 print:break-after-avoid"
                >
                  יום {DAY_NAMES[d.day]}
                  {d.date && <span className="font-sans text-base font-normal text-ink-soft"> · {d.date}</span>}
                  {d.today && <span className="ms-2 inline-block rounded-full bg-gold-soft px-2 font-sans text-sm text-navy-900 print:hidden">היום</span>}
                </h3>
                {/* the brand's schedule table: sage hairlines between the rows, the key column (the time) bold navy */}
                <ol className="divide-y divide-sage/60 border-t-2 border-sage">{d.items.map((it, k) => item(d.day, it, k, k === firstNight && k > 0))}</ol>
              </section>
            );
          })}
        </div>
      )}
      {open != null && v.rows[open] && <GuestCardDialog key={open} row={v.rows[open]} people={v.people} startDate={v.edition.start_date} onClose={() => close(open)} />}
    </>
  );
}
