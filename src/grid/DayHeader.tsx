// The head of a day column: date, the gender meter, the category bar, counts.
import { DAY_NAMES, type Day, dateOf, hebrewDate, shortDate } from "../domain/time";
import type { Gender } from "../domain/types";
import { DEFAULT_MAX_CATEGORY_PER_DAY } from "../rules/warnings";
import type { DayModel, GridModel } from "./model";

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

export function needText(need: Gender | null, deficit: number): string {
  if (!need) return "מאוזן";
  const k = Math.ceil(deficit - 0.01);
  return need === "f" ? (k === 1 ? "חסרה מרצה" : `חסרות ${k} מרצות`) : k === 1 ? "חסר מרצה" : `חסרים ${k} מרצים`;
}

export function DayHeader({ model, dm, glow, compact = false }: { model: GridModel; dm: DayModel; glow?: boolean; compact?: boolean }) {
  const date = dateOf(model.week.edition.start_date, dm.day as Day);
  const b = dm.balance;
  const max = model.week.edition.settings.max_category_per_day ?? DEFAULT_MAX_CATEGORY_PER_DAY;
  const loads = [...dm.load.entries()].sort((a, c) => (model.categoryById.get(a[0])?.sort ?? 0) - (model.categoryById.get(c[0])?.sort ?? 0));
  const total = loads.reduce((s, [, k]) => s + k, 0);
  const warnCount = dm.warnings.filter((w) => w.severity === "warn").length;
  const parallels = dm.warnings.filter((w) => w.kind === "parallel").length;
  const needTone = b.unreachable ? "text-bad" : b.need === "f" ? "text-pink-700" : b.need === "m" ? "text-sky-700" : "text-ok";

  return (
    <div className={`rounded-lg border bg-card px-2 py-1.5 ${glow ? "border-ok ring-2 ring-ok/40" : "border-line"}`} data-day-header={dm.day}>
      <div className="flex items-baseline gap-1.5">
        <span className="font-display font-semibold">{DAY_NAMES[dm.day as Day]}</span>
        <span className="text-[11px] text-ink-faint truncate">{date ? `${shortDate(date)} · ${hebrewDate(date)}` : "תאריך TBD"}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-ink-soft tabular-nums" aria-label="איזון מגדרי">
        נ {n(b.closed.f)} · ג {n(b.closed.m)} · {b.open} פנויות
        {(b.pending.f > 0 || b.pending.m > 0) && <span className="text-ink-faint"> · בתהליך נ {n(b.pending.f)} ג {n(b.pending.m)}</span>}
      </div>
      <div className={`text-[11px] font-semibold ${needTone}`} data-need={b.need ?? "even"}>
        {needText(b.need, b.deficit)}
        {b.unreachable && " — לא ייסגר מאוזן"}
      </div>
      {!compact && (
        <>
          <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-paper" aria-label="פיזור קטגוריות">
            {loads.map(([catId, k]) => {
              const c = model.categoryById.get(catId);
              return (
                <span
                  key={catId}
                  title={`${c?.name ?? "?"}: ${k}`}
                  style={{ width: `${(k / Math.max(total, 1)) * 100}%`, background: c?.color }}
                  className={k > max ? "outline outline-2 outline-bad" : ""}
                />
              );
            })}
          </div>
          {(warnCount > 0 || parallels > 0) && (
            <div className="mt-1 flex gap-1 text-[10px]">
              {parallels > 0 && <span className="rounded bg-sky-50 px-1 text-sky-900">∥ {parallels}</span>}
              {warnCount > 0 && <span className="rounded bg-amber-100 px-1 text-amber-900">⚠ {warnCount}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
