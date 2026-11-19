// One day at a time, for a phone or a tablet: a strip of day chips, then the
// day as a vertical timeline. Tap a cell to propose; tap a card to open it.
// `readOnly` (the offline snapshot, src/screens/OfflineWeek.tsx, and a trainee's «השבוע»,
// src/screens/ReadOnlyWeek.tsx): a free cell is only a label, never a button; a card still opens, to read.
// The reset, phase 2: a free cell says «פנוי» — what the day is short of (its CLOSED lessons) is said once, by its
// chip's dot and its header, never on a cell. Phase 3: no placing mode — a free cell opens its panel (its chooser).
import { DAYS, DAY_NAMES, type Day, dayRange, fmt, fmtRange, overlaps } from "../domain/time";
import type { GridRow, Lesson } from "../domain/types";
import { DayHeader, needText } from "./DayHeader";
import { type CardOwners, type Lens, LessonCard } from "./LessonCard";
import { rowActive } from "./layout";
import { type GridModel, lessonsOfDay, memorialRowFree } from "./model";

interface Props {
  model: GridModel;
  lens: Lens;
  day: Day;
  onDay: (d: Day) => void;
  onCell: (day: Day, row: GridRow) => void;
  onLesson: (id: number) => void;
  /** An edition admin's: a memorial row with no slot yet makes one (v13 — both rows alike). */
  onMemorial?: (day: Day, row: GridRow) => void;
  /** The «אחריות» lens's colours and filter (LessonCard). */
  owners?: CardOwners;
  /** v13: the day header opens the day's panel. */
  onDayPanel?: (day: Day) => void;
  readOnly?: boolean;
  /** The days the viewer owns (v18 day owners): their chip and header say «היום שלי». */
  mine?: ReadonlySet<Day>;
}

const ROW_PX = 92;

export function DayView({ model, lens, day, onDay, onCell, onLesson, onMemorial, owners, onDayPanel, readOnly = false, mine }: Props) {
  const { edition } = model.week;
  const lessons = lessonsOfDay(model, day);
  const roomSort = (l: Lesson) => model.week.rooms.find((r) => r.id === l.room_id)?.sort ?? 0;

  return (
    <div className="space-y-2">
      <div role="tablist" aria-label="ימים" className="sticky top-0 z-20 -mx-3 flex gap-1 overflow-x-auto bg-paper px-3 py-2">
        {DAYS.map((d) => {
          const b = model.days[d].balance;
          const own = !!mine?.has(d);
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === day}
              data-mine-day={own ? d : undefined}
              onClick={() => onDay(d)}
              className={`flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-3.5 text-sm font-semibold transition-colors ${d === day ? "border-navy bg-navy text-white shadow-sm" : "border-line bg-card text-ink hover:border-navy/40 hover:bg-accent-soft"} ${own ? "ring-2 ring-navy/50 ring-offset-1 ring-offset-paper" : ""}`}
            >
              {DAY_NAMES[d]}
              {/* the ring marks it (and the header says «היום שלי»): a visible word would push Thursday off a phone's strip */}
              {own && <span className="sr-only"> (היום שלי)</span>}
              <span className={`size-2 rounded-full ${b.need === "f" ? "bg-pink-400" : b.need === "m" ? "bg-sky-500" : "bg-ok"}`} aria-label={needText(b.need, b.deficit)} />
            </button>
          );
        })}
      </div>

      <DayHeader model={model} dm={model.days[day]} compact mine={mine?.has(day)} pairLine={lens === "owner"} onOpen={onDayPanel && !readOnly ? () => onDayPanel(day) : undefined} />

      <ol className="space-y-1" aria-label={`יום ${DAY_NAMES[day]}`} data-day={day}>
        {model.layout.bands.map(({ row }) => {
          if (!rowActive(row, day, edition)) return null;
          if (row.kind !== "lesson") {
            // a memorial row may hold several slots (5ב-2: any part of the row, any room) — each its own yellow card
            const memorial =
              row.kind === "memorial"
                ? lessons.filter((l) => l.kind === "memorial" && overlaps(l.start_min, l.end_min, row.start_min, row.end_min)).sort((a, b) => a.start_min - b.start_min || roomSort(a) - roomSort(b) || a.id - b.id)
                : [];
            if (memorial.length) {
              // each slot with its own start in the time column, like a lesson row; its range and room as a line of
              // its own when the row holds more than one, or the slot is not the whole row — else two would look alike.
              // 48px (a 44px card): a touch target, as everywhere else.
              return (
                <li key={row.id} className="space-y-1">
                  {memorial.map((l) => {
                    const alone = memorial.length === 1 && l.start_min === row.start_min && l.end_min === row.end_min;
                    const where = alone ? undefined : { range: fmtRange(l.start_min, l.end_min), room: model.week.rooms.find((r) => r.id === l.room_id)?.name ?? null };
                    return (
                      <div key={l.id} className="flex gap-2">
                        <bdi className="w-11 shrink-0 pt-1 text-xs font-bold tabular-nums text-navy">{fmt(l.start_min)}</bdi>
                        <div className={`relative min-w-0 flex-1 ${where ? "h-14" : "h-12"}`}>
                          <LessonCard model={model} lesson={l} lens={lens} height={where ? 56 : 48} where={where} onOpen={() => onLesson(l.id)} />
                        </div>
                      </div>
                    );
                  })}
                </li>
              );
            }
            if (row.kind === "memorial" && onMemorial && !readOnly && memorialRowFree(model, day, row)) {
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onMemorial(day, row)}
                    aria-label={`הוספת זמן זיכרון: ${dayRange(day, row.start_min, row.end_min)}`}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100"
                  >
                    <bdi className="tabular-nums">{fmt(row.start_min)}</bdi>
                    <span className="truncate">+ {row.label || "זמן זיכרון"}</span>
                  </button>
                </li>
              );
            }
            return (
              <li key={row.id} className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs ${row.kind === "kk" ? "bg-accent-soft text-navy" : row.kind === "memorial" ? "bg-amber-50 text-amber-800" : "bg-sand-soft text-ink-soft"}`}>
                <bdi className="tabular-nums">{fmt(row.start_min)}</bdi>
                <span className="truncate">{row.label}</span>
              </li>
            );
          }
          return <LessonRow key={row.id} model={model} lens={lens} owners={owners} day={day} row={row} lessons={lessons} onCell={onCell} onLesson={onLesson} readOnly={readOnly} />;
        })}
      </ol>
    </div>
  );
}

function LessonRow({
  model,
  lens,
  owners,
  day,
  row,
  lessons,
  onCell,
  onLesson,
  readOnly,
}: {
  model: GridModel;
  lens: Lens;
  owners?: CardOwners;
  day: Day;
  row: GridRow;
  lessons: Lesson[];
  onCell: (d: Day, r: GridRow) => void;
  onLesson: (id: number) => void;
  readOnly: boolean;
}) {
  const here = lessons.filter((l) => l.kind === "lesson" && overlaps(l.start_min, l.end_min, row.start_min, row.end_min));
  const starting = here.filter((l) => l.start_min >= row.start_min).sort((a, b) => a.start_min - b.start_min || a.room_id - b.room_id);
  const continuing = here.filter((l) => l.start_min < row.start_min);

  const time = (
    <bdi className="w-11 shrink-0 pt-1 text-xs font-bold tabular-nums text-navy">{fmt(row.start_min)}</bdi>
  );

  if (here.length === 0) {
    const key = `cell:${day}:${row.start_min}:${row.end_min}`;
    const tint = "bg-card/70 border-line text-ink-faint";
    if (readOnly) {
      return (
        <li className="flex gap-2">
          {time}
          <div data-free-cell={key} className={`grid min-h-16 flex-1 place-items-center rounded-xl border text-center text-sm ${tint}`}>
            <span>
              פנוי
              {row.label && <span className="block text-[11px] text-ink-faint">{row.label}</span>}
            </span>
          </div>
        </li>
      );
    }
    return (
      <li className="flex gap-2">
        {time}
        <button
          type="button"
          data-drop={key}
          onClick={() => onCell(day, row)}
          className={`min-h-16 flex-1 rounded-xl border text-sm transition-colors hover:border-navy/40 ${tint}`}
        >
          פנוי
          {row.label && <span className="block text-[11px] text-ink-faint">{row.label}</span>}
        </button>
      </li>
    );
  }

  // Lanes: lessons that start together side by side; a time split stacks.
  const groups: Lesson[][] = [];
  for (const l of starting) {
    const g = groups.find((x) => x[0].start_min === l.start_min);
    if (g) g.push(l);
    else groups.push([l]);
  }
  const len = row.end_min - row.start_min;
  return (
    <li className="flex gap-2">
      {time}
      <div className="flex-1 space-y-1">
        {continuing.map((l) => (
          <button key={l.id} type="button" onClick={() => onLesson(l.id)} className="block w-full rounded-lg border border-dashed border-line px-2 py-1 text-start text-xs text-ink-soft hover:bg-accent-soft">
            ↥ המשך השיעור <bdi>{fmtRange(l.start_min, l.end_min)}</bdi>
          </button>
        ))}
        {groups.map((g) => {
          const minutes = Math.min(g[0].end_min, row.end_min) - g[0].start_min;
          const h = Math.max(52, Math.round((minutes / len) * ROW_PX));
          return (
            <div key={g[0].id} className="flex gap-1">
              {g.map((l) => (
                <div key={l.id} className="relative min-w-0 flex-1" style={{ height: l.end_min > row.end_min ? ROW_PX : h }}>
                  <LessonCard
                    model={model}
                    lesson={l}
                    lens={lens}
                    owners={owners}
                    height={l.end_min > row.end_min ? ROW_PX : h}
                    onOpen={() => onLesson(l.id)}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </li>
  );
}
