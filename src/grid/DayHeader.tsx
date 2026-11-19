// The head of a day column: date, the gender meter, the day's topics axis, its warnings.
// v13: a button — it opens the day's panel (DayPanel) — and «לא מאוזן» when the
// day's closed women and men are further apart than the tolerance.
// The reset, phase 2: its one line («חסרה מרצה») is the only place the day says what its CLOSED lessons are short
// of — no free cell is tinted for it; `mine`: the viewer owns the day («היום שלי», a navy ring).
// The reset, phase 3: `pairLine` (the «אחריות» lens) names the day's pair — «אין זוג ליום» when an admin has not set it.
import { DAY_NAMES, type Day, dateOf, hebrewDate, shortDate } from "../domain/time";
import type { Gender } from "../domain/types";
import { DEFAULT_GENDER_TOLERANCE, unbalanced } from "../rules/balance";
import type { DayModel, GridModel } from "./model";
import { SeverityMark } from "./bits";
import { dayPair, NO_PAIR_LABEL, pairText } from "./owners";
import { TopicAxis } from "./TopicAxis";

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

export function needText(need: Gender | null, deficit: number): string {
  if (!need) return "מאוזן";
  const k = Math.ceil(deficit - 0.01);
  return need === "f" ? (k === 1 ? "חסרה מרצה" : `חסרות ${k} מרצות`) : k === 1 ? "חסר מרצה" : `חסרים ${k} מרצים`;
}

export function DayHeader({
  model,
  dm,
  compact = false,
  mine = false,
  pairLine = false,
  onOpen,
}: {
  model: GridModel;
  dm: DayModel;
  compact?: boolean;
  mine?: boolean;
  /** The «אחריות» lens: a line naming the day's pair. */
  pairLine?: boolean;
  onOpen?: () => void;
}) {
  const date = dateOf(model.week.edition.start_date, dm.day as Day);
  const b = dm.balance;
  // «לא מאוזן» has a line of its own: the warnings' count is the rest
  const warnCount = dm.warnings.filter((w) => w.severity === "warn" && w.kind !== "gender_day").length;
  const needTone = b.unreachable ? "text-bad" : b.need === "f" ? "text-pink-700" : b.need === "m" ? "text-sky-700" : "text-ok";
  const off = unbalanced(b.closed, model.week.edition.settings.gender_tolerance ?? DEFAULT_GENDER_TOLERANCE);
  const Tag = onOpen ? "button" : "div";
  const pair = pairLine ? pairText(model, dm.day as Day) : null;

  return (
    <Tag
      {...(onOpen ? { type: "button" as const, onClick: onOpen, "aria-label": `יום ${DAY_NAMES[dm.day as Day]}${mine ? " (היום שלי)" : ""}: ${off ? "לא מאוזן, " : ""}${needText(b.need, b.deficit)}${pair ? `, ${pair}` : ""} — פרטי היום` } : {})}
      className={`block w-full rounded-xl border bg-card px-2.5 py-1.5 text-start shadow-sm ${onOpen ? "cursor-pointer transition-shadow hover:shadow-md" : ""} ${mine ? "border-navy ring-2 ring-navy/40" : off ? "border-bad/60" : `border-line ${onOpen ? "hover:border-navy/30" : ""}`}`}
      data-day-header={dm.day}
      data-mine-day={mine ? dm.day : undefined}
    >
      <span className="flex items-baseline gap-1.5">
        <span className="font-display text-[15px] font-extrabold text-navy">{DAY_NAMES[dm.day as Day]}</span>
        {mine && <span className="shrink-0 rounded-full bg-navy px-1.5 text-[10px] font-semibold leading-4 text-white">היום שלי</span>}
        <span className="min-w-0 truncate text-[11px] text-ink-faint">{date ? `${shortDate(date)} · ${hebrewDate(date)}` : "תאריך TBD"}</span>
        {onOpen && (
          <span aria-hidden className="ms-auto shrink-0 text-[13px] leading-none text-navy/60">
            ‹
          </span>
        )}
      </span>
      {/* the closed women and men in the cells' own pink and sky */}
      <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-ink-soft tabular-nums" aria-label="איזון מגדרי">
        <span className="shrink-0 rounded-full bg-need-f px-1.5 text-pink-900">נ {n(b.closed.f)}</span>
        <span className="shrink-0 rounded-full bg-need-m px-1.5 text-sky-900">ג {n(b.closed.m)}</span>
        <span className="truncate">· {b.open} פנויות</span>
      </span>
      <span className={`block text-[11px] font-semibold ${needTone}`} data-need={b.need ?? "even"}>
        {off && <span className="text-bad" data-unbalanced>לא מאוזן · </span>}
        {needText(b.need, b.deficit)}
        {b.unreachable && " — לא ייסגר מאוזן"}
      </span>
      {pair && (
        <span data-day-pair={dayPair(model, dm.day as Day).join(",")} className={`block truncate text-[11px] ${pair === NO_PAIR_LABEL ? "text-ink-faint" : "font-semibold text-navy"}`}>
          {pair}
        </span>
      )}
      <span className="mt-1 flex items-center gap-1.5">
        <span className="min-w-0 flex-1">
          <TopicAxis model={model} day={dm.day as Day} size="thin" />
        </span>
        {!compact && warnCount > 0 && (
          <span data-warning-count={warnCount} className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 ps-0.5 pe-1.5 text-[10px] leading-4 text-amber-900">
            <SeverityMark severity="warn" size="sm" />
            {warnCount}
          </span>
        )}
      </span>
    </Tag>
  );
}
