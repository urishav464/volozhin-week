// The day's topics as a colour strip, in time order (axis.ts): a closed lesson in its
// topic's colour, a draft dashed, a free stretch white, lessons side by side as stacked
// bands; a meal or «מכריכה לכריכה» is a gap. Thin in every day header, large in the day
// panel's «נושאים». Spans only (it sits inside the header's button), and aria-hidden:
// its text twins are the panel's topics and hours, the cards' names and «לפי ימים».
import { type Day, fmt } from "../domain/time";
import { DEFAULT_MAX_CATEGORY_PER_DAY } from "../rules/warnings";
import type { AxisLesson, AxisPiece } from "./axis";
import { NO_TOPIC_COLOR } from "./bits";
import type { GridModel } from "./model";

/** A block shorter than a lesson row is too narrow for its start time on a phone. */
const LABEL_MIN = 90;
/** The neutral a closed card without a topic has («נושא: TBD»). */

export function TopicAxis({ model, day, size }: { model: GridModel; day: Day; size: "thin" | "large" }) {
  const dm = model.days[day];
  const max = model.week.edition.settings.max_category_per_day ?? DEFAULT_MAX_CATEGORY_PER_DAY;
  const thin = size === "thin";
  const nameOf = (l: AxisLesson) => (l.state === "draft" ? "טיוטה" : l.categoryId != null ? (model.categoryById.get(l.categoryId)?.name ?? "נושא: TBD") : "נושא: TBD");

  const piece = (p: AxisPiece) => {
    const style = { flex: `${p.end - p.start} 1 0` };
    const title = `${fmt(p.start)} · ${p.lessons.length ? p.lessons.map(nameOf).join(" ∥ ") : "פנוי"}`;
    if (p.lessons.length === 0) {
      return <span key={p.start} title={title} style={style} className={thin ? "min-w-0 rounded-[1px] bg-line" : "min-w-0 rounded-[3px] border border-line bg-card"} />;
    }
    if (p.lessons.length === 1 && p.lessons[0].state === "draft") {
      return <span key={p.start} title={title} style={style} className={thin ? "min-w-0 rounded-[1px] bg-ink-faint/40" : "min-w-0 rounded-[3px] border-[1.5px] border-dashed border-ink-faint bg-card"} />;
    }
    return (
      <span key={p.start} title={title} style={style} className={`flex min-w-0 flex-col overflow-hidden ${thin ? "rounded-[1px]" : "gap-px rounded-[3px]"}`}>
        {p.lessons.map((l) => {
          if (l.state === "draft") return <span key={l.id} className={`flex-1 ${thin ? "bg-ink-faint/40" : "border border-dashed border-ink-faint bg-card"}`} />;
          const over = l.categoryId != null && (dm.load.get(l.categoryId) ?? 0) > max;
          const color = l.categoryId != null ? (model.categoryById.get(l.categoryId)?.color ?? NO_TOPIC_COLOR) : NO_TOPIC_COLOR;
          return <span key={l.id} className={`flex-1 ${over ? (thin ? "ring-1 ring-inset ring-bad" : "ring-2 ring-inset ring-bad") : ""}`} style={{ backgroundColor: color }} />;
        })}
      </span>
    );
  };

  return (
    <span aria-hidden="true" data-topic-axis={size} className={`flex ${thin ? "gap-1" : "gap-1.5"}`}>
      {dm.axis.map((b) => (
        <span key={b.start} className="flex min-w-0 flex-col" style={{ flex: `${b.end - b.start} 1 0` }}>
          <span className={`flex ${thin ? "h-1.5 gap-px" : "h-[22px] gap-0.5"}`}>{b.pieces.map(piece)}</span>
          {!thin && <span className="mt-1 h-3 whitespace-nowrap text-[10px] leading-none tabular-nums text-ink-faint">{b.end - b.start >= LABEL_MIN ? fmt(b.start) : ""}</span>}
        </span>
      ))}
    </span>
  );
}
