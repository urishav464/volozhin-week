// The transport board's time axis (the reset, phase 3): one day, 06:30 → 06:30 the next morning, time running with the
// page (insetInlineStart: right to left). A lane per transport — the lesson a faint block, the outbound leg a bar from
// the pickup to the start (or a hollow marker at the start when the pickup time is unknown), the return of «הלוך ושוב»
// a marker at the teaching's end with no length — then a lane per staff shift (v20: no lead). Drawn for the eye only
// (aria-hidden) from a tablet up: its text twin is the list below it, the accessible version and the phone's whole
// board. A click on a lane focuses its row in the list.
import { fmt } from "../../domain/time";
import { AXIS_TICKS, axisPercent, type BoardState, type ShiftLane, type TransportLane } from "./lanes";

/** A leg's colour by where the transport stands (the list's chips say it in words). */
const LEG: Record<BoardState, string> = {
  pending: "bg-wait",
  approved: "bg-sky",
  arranged: "bg-ok",
};

const pos = (from: number, to?: number) => ({
  insetInlineStart: `${axisPercent(from)}%`,
  ...(to != null ? { width: `${Math.max(axisPercent(to) - axisPercent(from), 0)}%` } : {}),
});

/** A label at a minute: it runs on past the mark (into the time after it), or — near the axis' end — back from it. */
const labelAt = (min: number) => {
  const p = axisPercent(min);
  return p > 82 ? { style: { insetInlineEnd: `${100 - p}%` }, pad: "pe-2" } : { style: { insetInlineStart: `${p}%` }, pad: "ps-2" };
};

function Ticks() {
  return (
    <>
      {AXIS_TICKS.map((m) => (
        <span key={m} className="absolute inset-y-0 w-px bg-line/70" style={pos(m)} />
      ))}
    </>
  );
}

export function BoardAxis({ transports, shifts, onPick }: { transports: TransportLane[]; shifts: ShiftLane[]; onPick: (lessonId: number) => void }) {
  if (transports.length === 0 && shifts.length === 0) return null;
  return (
    <div aria-hidden="true" data-board-axis className="hidden rounded-xl border border-line bg-card p-3 shadow-sm md:block print:hidden">
      <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 lg:grid-cols-[11rem_minmax(0,1fr)]">
        {/* the hours */}
        <span />
        <div className="relative h-5 text-[11px] text-ink-soft">
          {AXIS_TICKS.map((m) => (
            <span key={m} className="absolute top-0 -translate-x-1/2 rtl:translate-x-1/2" style={pos(m)}>
              <bdi dir="ltr">{fmt(m)}</bdi>
            </span>
          ))}
        </div>

        {transports.map((t) => (
          <TransportTrack key={t.lesson.id} lane={t} onPick={onPick} />
        ))}

        {shifts.length > 0 && (
          <>
            <span className="col-span-2 mt-1 border-t border-line pt-1.5 text-xs font-bold text-ink-soft">משמרות צוות</span>
            {shifts.map((s) => (
              <ShiftTrack key={s.shift.id} lane={s} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function TransportTrack({ lane: t, onPick }: { lane: TransportLane; onPick: (lessonId: number) => void }) {
  const l = t.lesson;
  const o = t.outbound;
  const pick = () => onPick(l.id);
  return (
    <>
      <span className="truncate text-sm font-semibold text-navy" title={t.speaker || t.title}>
        {t.speaker || "TBD"}
      </span>
      <div data-lane={l.id} data-state={t.state} onClick={pick} className="relative h-9 cursor-pointer rounded-md bg-paper-light/60">
        <Ticks />
        {/* the lesson itself: its teaching, as the list, the message and the escort's page say it (app.teach_end) */}
        <span data-teach={`${l.start_min}-${t.teachEnd}`} className="absolute inset-y-1.5 rounded border border-sage bg-sage-soft" style={pos(l.start_min, t.teachEnd)} />
        {o.kind === "bar" ? (
          // a pickup before 06:30 starts at the axis' edge, square there, with a stroke: it began earlier (the list says when)
          <span data-outbound="bar" data-clamped={o.clamped} className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full ${o.clamped ? "rounded-s-none" : ""} ${LEG[t.state]}`} style={pos(o.from, o.to)}>
            {o.clamped && <span className="absolute -inset-y-1.5 start-0 w-0.5 bg-ink" />}
          </span>
        ) : (
          <span
            data-outbound={o.known ? "marker" : "unknown"}
            data-clamped={false}
            className={`absolute top-1/2 size-3 -translate-y-1/2 rounded-full ${o.known ? LEG[t.state] : `border-2 border-dashed border-ink-faint bg-card`}`}
            style={pos(o.at)}
          />
        )}
        {t.returnAt != null && (
          <>
            <span data-return={t.returnAt} className={`absolute inset-y-1 w-1 rounded-full ${LEG[t.state]}`} style={pos(t.returnAt)} />
            <span className={`absolute top-1/2 -translate-y-1/2 text-[11px] leading-none whitespace-nowrap text-ink-soft ${labelAt(t.returnAt).pad}`} style={labelAt(t.returnAt).style}>
              חזרה מ-<bdi dir="ltr">{fmt(t.returnAt)}</bdi>
            </span>
          </>
        )}
      </div>
    </>
  );
}

function ShiftTrack({ lane: s }: { lane: ShiftLane }) {
  return (
    <>
      <span className="truncate text-sm text-ink" title={s.who}>
        {s.who}
      </span>
      <div className="relative h-7 rounded-md bg-paper-light/60">
        <Ticks />
        <span
          data-shift-lane={s.shift.id}
          className="absolute inset-y-1.5 overflow-hidden rounded border border-navy/40 bg-accent-soft"
          style={pos(s.shift.start_min, s.shift.end_min)}
        />
      </div>
    </>
  );
}
