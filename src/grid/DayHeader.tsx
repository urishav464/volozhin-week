// The head of a day column: date, the gender meter, the day's topics axis, its warnings.
// v13: a button — it opens the day's panel (DayPanel) — and «לא מאוזן» when the
// day's closed women and men are further apart than the tolerance.
import { DAY_NAMES, type Day, dateOf, hebrewDate, shortDate } from "../domain/time";
import type { Gender } from "../domain/types";
import { DEFAULT_GENDER_TOLERANCE, unbalanced } from "../rules/balance";
import type { DayModel, GridModel } from "./model";
import { TopicAxis } from "./TopicAxis";

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

export function needText(need: Gender | null, deficit: number): string {
  if (!need) return "מאוזן";
  const k = Math.ceil(deficit - 0.01);
  return need === "f" ? (k === 1 ? "חסרה מרצה" : `חסרות ${k} מרצות`) : k === 1 ? "חסר מרצה" : `חסרים ${k} מרצים`;
}

export function DayHeader({ model, dm, glow, compact = false, onOpen }: { model: GridModel; dm: DayModel; glow?: boolean; compact?: boolean; onOpen?: () => void }) {
  const date = dateOf(model.week.edition.start_date, dm.day as Day);
  const b = dm.balance;
  // «לא מאוזן» has a line of its own: the ⚠ counts the rest
  const warnCount = dm.warnings.filter((w) => w.severity === "warn" && w.kind !== "gender_day").length;
  const needTone = b.unreachable ? "text-bad" : b.need === "f" ? "text-pink-700" : b.need === "m" ? "text-sky-700" : "text-ok";
  const off = unbalanced(b.closed, model.week.edition.settings.gender_tolerance ?? DEFAULT_GENDER_TOLERANCE);
  const Tag = onOpen ? "button" : "div";

  return (
    <Tag
      {...(onOpen ? { type: "button" as const, onClick: onOpen, "aria-label": `יום ${DAY_NAMES[dm.day as Day]}: ${off ? "לא מאוזן, " : ""}${needText(b.need, b.deficit)} — פרטי היום` } : {})}
      className={`block w-full rounded-lg border bg-card px-2 py-1.5 text-start ${onOpen ? "cursor-pointer transition-shadow hover:border-ink-faint hover:shadow-sm" : ""} ${glow ? "border-ok ring-2 ring-ok/40" : off ? "border-bad/60" : "border-line"}`}
      data-day-header={dm.day}
    >
      <span className="flex items-baseline gap-1.5">
        <span className="font-display text-[15px] font-semibold">{DAY_NAMES[dm.day as Day]}</span>
        <span className="min-w-0 truncate text-[11px] text-ink-faint">{date ? `${shortDate(date)} · ${hebrewDate(date)}` : "תאריך TBD"}</span>
        {onOpen && (
          <span aria-hidden className="ms-auto shrink-0 text-[13px] leading-none text-ink-faint">
            ‹
          </span>
        )}
      </span>
      {/* the closed women and men in the cells' own pink and sky */}
      <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-ink-soft tabular-nums" aria-label="איזון מגדרי">
        <span className="shrink-0 rounded bg-need-f px-1 text-pink-900">נ {n(b.closed.f)}</span>
        <span className="shrink-0 rounded bg-need-m px-1 text-sky-900">ג {n(b.closed.m)}</span>
        <span className="truncate">· {b.open} פנויות</span>
      </span>
      <span className={`block text-[11px] font-semibold ${needTone}`} data-need={b.need ?? "even"}>
        {off && <span className="text-bad" data-unbalanced>⚠ לא מאוזן · </span>}
        {needText(b.need, b.deficit)}
        {b.unreachable && " — לא ייסגר מאוזן"}
      </span>
      <span className="mt-1 flex items-center gap-1.5">
        <span className="min-w-0 flex-1">
          <TopicAxis model={model} day={dm.day as Day} size="thin" />
        </span>
        {!compact && warnCount > 0 && <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] leading-4 text-amber-900">⚠ {warnCount}</span>}
      </span>
    </Tag>
  );
}
