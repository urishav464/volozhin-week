// The full week on a wide screen: the hours down the right edge, the five days
// flowing right-to-left, every row a band, every lesson a box (layout.ts).
import { DAYS, type Day, dayRange, fmt, overlaps } from "../domain/time";
import type { GridRow, Speaker } from "../domain/types";
import { DayHeader } from "./DayHeader";
import { type CardOwners, FIT_CELL, type Lens, LessonCard } from "./LessonCard";
import { freeCells, placeDay, rowActive } from "./layout";
import { type Fit, GENDER_NEED_LABEL, type GridModel, fitFor, fitText, lessonsOfDay, memorialRowFree } from "./model";

interface Props {
  model: GridModel;
  lens: Lens;
  placing: Speaker | null;
  /** v14: a speaker the grid is coloured for without placing them — dragged by the mouse, or their sheet open beside it. */
  lookAt?: Speaker | null;
  overKey: string | null;
  onCell: (day: Day, row: GridRow) => void;
  onLesson: (lessonId: number) => void;
  /** An edition admin's: a memorial row with no slot yet makes one (v13 — both rows alike). */
  onMemorial?: (day: Day, row: GridRow) => void;
  /** The «אחריות» lens's colours and filter (LessonCard). */
  owners?: CardOwners;
  /** v13: the day header opens the day's panel. */
  onDayPanel?: (day: Day) => void;
}

const COLS = "3.25rem repeat(5, minmax(0, 1fr))";

export function GridDesktop({ model, lens, placing, lookAt = null, overKey, onCell, onLesson, onMemorial, owners, onDayPanel }: Props) {
  const { layout } = model;
  const { edition } = model.week;
  // green where they said «יכול/ה», red where «לא» — while placing, dragging, or with their sheet open; only placing
  // shuts a cell they are already closed at (in look mode a click still opens the cell)
  const who = placing ?? lookAt;

  return (
    <div role="grid" aria-label="רשת השבוע" className="min-w-[46rem]">
      <div className="sticky top-0 z-20 grid gap-1 bg-paper pb-1" style={{ gridTemplateColumns: COLS }}>
        <div />
        {model.days.map((dm) => (
          <DayHeader key={dm.day} model={model} dm={dm} glow={!!placing?.gender && dm.balance.need === placing.gender} onOpen={onDayPanel ? () => onDayPanel(dm.day) : undefined} />
        ))}
      </div>

      <div className="grid gap-1" style={{ gridTemplateColumns: COLS }}>
        {/* the hours */}
        <div className="relative" style={{ height: layout.height }} aria-hidden>
          {layout.bands.map((b) => (
            <div key={b.row.id} className="absolute inset-x-0 border-t border-line/70 pe-1 text-end" style={{ top: b.top, height: b.height }}>
              <bdi className={`tabular-nums ${b.row.kind === "lesson" ? "text-xs font-semibold text-ink-soft" : "text-[10px] text-ink-faint"}`}>{fmt(b.row.start_min)}</bdi>
            </div>
          ))}
        </div>

        {DAYS.map((day) => {
          const lessons = lessonsOfDay(model, day);
          const placed = placeDay(layout, lessons);
          const free = freeCells(layout, day, model.week.lessons, edition);
          const need = model.days[day].balance.need;
          return (
            <div key={day} className="relative rounded-md bg-card/40" style={{ height: layout.height }} data-day={day}>
              {/* bands */}
              {layout.bands.map((b) => {
                const active = rowActive(b.row, day, edition);
                const base = "absolute inset-x-0 border-t border-line/70";
                if (!active) {
                  return <div key={b.row.id} className={`${base} bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(29,42,68,0.06)_6px_8px)]`} style={{ top: b.top, height: b.height }} title="מחוץ לשעות השבוע" />;
                }
                if (b.row.kind === "lesson") return <div key={b.row.id} className={base} style={{ top: b.top, height: b.height }} />;
                const tone = b.row.kind === "kk" ? "bg-accent-soft text-accent" : b.row.kind === "memorial" ? "bg-amber-50 text-amber-800" : "bg-line/50 text-ink-soft";
                if (b.row.kind === "memorial" && onMemorial && !lessons.some((l) => l.kind === "memorial" && overlaps(l.start_min, l.end_min, b.row.start_min, b.row.end_min)) && memorialRowFree(model, day, b.row)) {
                  // dashed, like an empty cell: one click makes a slot (not a label like the rows around it)
                  return (
                    <button
                      key={b.row.id}
                      type="button"
                      onClick={() => onMemorial(day, b.row)}
                      className={`absolute inset-x-0 m-0.5 grid place-items-center rounded-md border border-dashed border-amber-300 ${tone} px-1 text-center text-[11px] font-semibold leading-tight hover:bg-amber-100`}
                      style={{ top: b.top, height: b.height }}
                      aria-label={`הוספת זמן זיכרון: ${dayRange(day, b.row.start_min, b.row.end_min)}`}
                    >
                      <span className="truncate max-w-full">+ {b.row.label || "זמן זיכרון"}</span>
                    </button>
                  );
                }
                return (
                  <div key={b.row.id} className={`${base} ${tone} grid place-items-center px-1 text-center text-[10px] leading-tight`} style={{ top: b.top, height: b.height }}>
                    <span className="truncate max-w-full">{b.row.label}</span>
                  </div>
                );
              })}

              {/* empty lesson cells — drop targets, tinted by what the day needs, or by a speaker's fit */}
              {free.map((c) => {
                const key = `cell:${day}:${c.row.start_min}:${c.row.end_min}`;
                const fit: Fit | null = who ? fitFor(model, who.id, day, c.row.start_min, c.row.end_min) : null;
                const said = fit && who ? fitText(fit, who.gender) : null;
                const tint = fit && fit !== "neutral" ? FIT_CELL[fit] : lens === "diversity" && need ? (need === "f" ? "bg-need-f border-pink-200" : "bg-need-m border-sky-200") : "bg-card/70 border-line";
                return (
                  <button
                    key={key}
                    type="button"
                    data-drop={key}
                    data-need={need ?? "even"}
                    data-fit={fit ?? undefined}
                    disabled={!!placing && fit === "busy"}
                    onClick={() => onCell(day, c.row)}
                    style={{ top: c.top, height: c.height }}
                    className={`absolute inset-x-0 m-0.5 rounded-md border text-center text-[11px] transition-colors hover:border-ink-faint disabled:cursor-not-allowed disabled:opacity-40 ${tint} ${overKey === key ? "ring-2 ring-accent" : ""}`}
                    aria-label={`${fmt(c.row.start_min)} — ${need ? GENDER_NEED_LABEL[need] : "פנוי"}${said ? `, ${said}` : ""}`}
                  >
                    {said ? (
                      <span>{said}</span>
                    ) : lens === "diversity" && need ? (
                      <span className={need === "f" ? "text-pink-800" : "text-sky-800"}>{GENDER_NEED_LABEL[need]}</span>
                    ) : (
                      <span className="text-ink-faint">פנוי</span>
                    )}
                    {c.row.label && <span className="block text-[10px] text-ink-faint">{c.row.label}</span>}
                  </button>
                );
              })}

              {/* lessons */}
              {placed.map((p) => {
                const key = `lesson:${p.lesson.id}`;
                const draft = p.lesson.state === "draft" && p.lesson.kind === "lesson";
                const fit = draft && who ? fitFor(model, who.id, day, p.lesson.start_min, p.lesson.end_min) : null;
                return (
                  <div
                    key={p.lesson.id}
                    className="absolute"
                    style={{ top: p.top, height: p.height, insetInlineStart: `${(p.lane / p.lanes) * 100}%`, width: `${100 / p.lanes}%` }}
                  >
                    <LessonCard model={model} lesson={p.lesson} lens={lens} owners={owners} height={p.height} active={overKey === key} placeable={!!placing && draft} fit={fit} fitGender={who?.gender ?? null} onOpen={() => onLesson(p.lesson.id)} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
