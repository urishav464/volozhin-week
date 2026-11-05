// «לוח» — the board, last year's basic sheet: on a tablet or a computer a row per shift × duty and a column per day
// (Sunday–Thursday), each cell its groups' code chips and «שיבוץ»; on a phone one day at a time, a part per shift, a
// line per duty. Above it: the fair suggestion (Suggest.tsx), the warnings (src/domain/rotaWarnings.ts — each with its
// SeverityMark; one about a shift jumps to it), and «עומס לפי קבוצה». A chip from the suggestion — previewed, or
// applied and not yet touched — is dashed and says «מוצע»; a chip with a warning about its group in that shift (its
// cohort not on campus, a shift the week no longer has, two in a row) is amber with the mark. «שיבוץ» opens the cell
// (CellPicker.tsx), for those who may write here.
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { RotaAssignment, RotaDuty, ShiftIndex } from "../../../data/rota";
import { loadsOf, needOf, ROTA_DAYS, rotaShiftActive, rotaShiftsOf, SHIFTS } from "../../../domain/rota";
import { suggestRota } from "../../../domain/rotaSuggest";
import { cellWarnings, groupWarnings, type RotaWarning, rotaWarnings } from "../../../domain/rotaWarnings";
import { DAY_NAMES, type Day } from "../../../domain/time";
import { dutiesInOrder, groupsInOrder } from "../../../exports/rota";
import { SeverityMark } from "../../../grid/bits";
import { GroupChip, ShiftLabel } from "../../rota/shared";
import { Button, Fold, TABLE_HEAD, TABLE_KEY, TABLE_ROW, TABLE_TH } from "../../settings/kit";
import { CellPicker, GROUP_MARKS, type RotaCell, cellTitle } from "./CellPicker";
import { Loads } from "./Loads";
import { CARD, codeById, type RotaCtx } from "./parts";
import { loadRange, SuggestBar } from "./Suggest";

/** A row on the board: stored, or the suggestion's (not stored yet: a negative id). */
type Shown = RotaAssignment & { preview?: boolean };

/** The kinds a warning list sends elsewhere: the setup, the staff's shifts. */
const SETUP_KINDS = new Set(["presence_unknown", "diets_exceed", "no_head", "no_target"]);

const cellId = (where: "d" | "p", day: number, shift: number, duty: number) => `rota-${where}-${day}-${shift}-${duty}`;
const buttonId = (where: "d" | "p", day: number, shift: number, duty: number) => `rota-btn-${where}-${day}-${shift}-${duty}`;
/** The first of the ids that is on screen (the table on a wide screen, the day view on a phone — one of them is hidden). */
const visible = (ids: string[]) => ids.map((id) => document.getElementById(id)).find((el): el is HTMLElement => !!el && el.getClientRects().length > 0) ?? null;

export function Board({ ctx }: { ctx: RotaCtx }) {
  const { week, data, mayWrite } = ctx;
  const e = week.edition;
  const [suggesting, setSuggesting] = useState(false);
  // the preview is this screen's only: made from the rota as it is now (again after any write), gone on a reload
  const suggestion = useMemo(() => (suggesting ? suggestRota({ data, edition: e }) : null), [suggesting, data, e]);
  const shown = useMemo<Shown[]>(
    () => [...data.assignments, ...(suggestion?.add ?? []).map((a, i): Shown => ({ ...a, id: -(i + 1), edition_id: e.id, source: "suggested", preview: true }))],
    [data.assignments, suggestion, e.id],
  );
  const view = useMemo(() => ({ ...data, assignments: shown }), [data, shown]);
  const warnings = useMemo(() => rotaWarnings(view, e), [view, e]);
  const loads = useMemo(() => loadsOf(view, shown, e), [view, shown, e]);
  const duties = dutiesInOrder(data);
  const rank = useMemo(() => new Map(groupsInOrder(data).map((g, i) => [g.id, i])), [data]);
  const [day, setDay] = useState<Day>(0);
  const [cell, setCell] = useState<RotaCell | null>(null);
  const [jump, setJump] = useState<{ day: Day; shift?: ShiftIndex; duty?: number; n: number } | null>(null);
  const labels = rotaShiftsOf(e).labels;

  // a warning's jump: the day on a phone first, then the cell (or the shift) scrolled to and focused
  useEffect(() => {
    if (!jump) return;
    const first = duties[0]?.id ?? 0;
    const ids =
      jump.shift == null
        ? [`rota-p-${jump.day}`]
        : [cellId("d", jump.day, jump.shift, jump.duty ?? first), cellId("p", jump.day, jump.shift, jump.duty ?? first), `rota-p-${jump.day}-${jump.shift}`];
    const el = visible(ids);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.focus({ preventScroll: true });
    }
    // only a new jump moves the page (the duties are read as they are then)
  }, [jump]);

  const close = () => {
    const c = cell;
    setCell(null);
    // back to the cell's own «שיבוץ», wherever it is on screen — or, once a shift the week no longer has was emptied
    // (no «שיבוץ» there; on a phone the shift is gone), to the cell, else to the day
    if (c)
      requestAnimationFrame(() =>
        visible([buttonId("d", c.day, c.shift, c.dutyId), buttonId("p", c.day, c.shift, c.dutyId), cellId("d", c.day, c.shift, c.dutyId), cellId("p", c.day, c.shift, c.dutyId), `rota-p-${c.day}`])?.focus(),
      );
  };

  if (data.groups.length === 0 || data.duties.length === 0) {
    return (
      <p className={`${CARD} text-ink-soft`}>
        {data.duties.length === 0 && data.groups.length === 0 ? "עוד אין תורנויות וקבוצות." : data.duties.length === 0 ? "עוד אין תורנויות." : "עוד אין קבוצות."}{" "}
        <Link to="/logistics/rota/setup" className="font-bold text-navy underline">
          מגדירים אותן ב«קבוצות ומכינות»
        </Link>
      </p>
    );
  }

  const inCell = (d: number, s: number, dutyId: number) =>
    shown.filter((a) => a.day === d && a.shift === s && a.duty_id === dutyId).sort((a, b) => (rank.get(a.group_id) ?? 0) - (rank.get(b.group_id) ?? 0) || Number(!!a.preview) - Number(!!b.preview));
  /** The shifts a day shows: those the week has, and another only while something is still assigned there. */
  const shiftsOf = (d: Day) => SHIFTS.filter((s) => rotaShiftActive(e, d, s) || shown.some((a) => a.day === d && a.shift === s));

  const cellBody = (where: "d" | "p", d: Day, s: ShiftIndex, duty: RotaDuty) => {
    const items = inCell(d, s, duty.id);
    const active = rotaShiftActive(e, d, s);
    const need = needOf(duty, s);
    const ws = cellWarnings(warnings, d, s, duty.id).filter((w) => !GROUP_MARKS.has(w.kind));
    const name = cellTitle(duty.name, d, labels[s]);
    if (!active && items.length === 0) return <span className="text-xs text-ink-faint">מחוץ לשבוע</span>;
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {items.map((a) => {
          const marks = groupWarnings(warnings, a).filter((w) => GROUP_MARKS.has(w.kind));
          const code = codeById(data, a.group_id);
          return (
            <GroupChip key={a.id} code={code} suggested={a.source === "suggested"} warn={marks.length > 0} title={marks.map((w) => w.message).join("\n") || undefined}>
              {a.preview && <span data-preview hidden />}
              {marks.length > 0 && <span className="sr-only">אזהרה: {marks.map((w) => w.message).join(" · ")}</span>}
            </GroupChip>
          );
        })}
        <span className={`inline-flex items-center gap-1 text-xs ${ws.some((w) => w.severity === "warn") ? "text-amber-900" : "text-ink-soft"}`} title={ws.map((w) => w.message).join("\n") || undefined}>
          {ws.length > 0 && <SeverityMark severity={ws.some((w) => w.severity === "warn") ? "warn" : "info"} size="sm" />}
          {need == null ? "לא נקבע" : <bdi dir="ltr">{`${items.length}/${need}`}</bdi>}
          {ws.length > 0 && <span className="sr-only">{ws.map((w) => w.message).join(" · ")}</span>}
        </span>
        {mayWrite && (
          <Button kind="quiet" id={buttonId(where, d, s, duty.id)} className="ms-auto text-sm" aria-label={`שיבוץ: ${name}`} onClick={() => setCell({ day: d, shift: s, dutyId: duty.id })}>
            שיבוץ
          </Button>
        )}
      </div>
    );
  };

  const jumpTo = (w: RotaWarning) => {
    if (w.day == null) return;
    setDay(w.day);
    setJump((j) => ({ day: w.day!, shift: w.shift, duty: w.dutyId, n: (j?.n ?? 0) + 1 }));
  };
  const range = loadRange(loads);

  return (
    <div className="space-y-3">
      <SuggestBar ctx={ctx} suggestion={suggestion} onStart={() => setSuggesting(true)} onStop={() => setSuggesting(false)} />

      <div className="space-y-1 rounded-xl border border-line bg-card px-3 py-1 shadow-sm">
        {warnings.length === 0 ? (
          <p className="flex min-h-11 items-center text-sm text-ink-soft">אין אזהרות.</p>
        ) : (
          <Fold title="אזהרות" hint={warnings.length}>
            <WarningItems warnings={warnings} onJump={jumpTo} />
          </Fold>
        )}
        <div className="border-t border-line/70">
          <Fold title="עומס לפי קבוצה" hint={range ? <bdi dir="ltr">{`${range[0]}–${range[1]}`}</bdi> : undefined}>
            <Loads data={data} assignments={shown} edition={e} />
          </Fold>
        </div>
      </div>

      {/* a tablet or a computer: the whole week */}
      <div className="hidden rounded-xl border border-line bg-card shadow-sm md:block">
        <table aria-label="לוח התורנויות" className="w-full table-fixed border-collapse text-start text-sm">
          <colgroup>
            <col className="w-24 lg:w-32" />
            <col className="w-24 lg:w-28" />
            {ROTA_DAYS.map((d) => (
              <col key={d} />
            ))}
          </colgroup>
          <thead>
            <tr className={TABLE_HEAD}>
              <th scope="col" className={`${TABLE_TH} px-2 py-1.5`}>
                משמרת
              </th>
              <th scope="col" className={`${TABLE_TH} px-2 py-1.5`}>
                תורנות
              </th>
              {ROTA_DAYS.map((d) => (
                <th key={d} scope="col" className={`${TABLE_TH} px-2 py-1.5`}>
                  {DAY_NAMES[d]}
                </th>
              ))}
            </tr>
          </thead>
          {SHIFTS.map((s) => (
            <tbody key={s} className="border-b-2 border-sage">
              {duties.map((duty, i) => (
                <tr key={duty.id} className={`${TABLE_ROW} align-top`}>
                  {i === 0 && (
                    <th scope="rowgroup" rowSpan={duties.length} className={`${TABLE_TH} ${TABLE_KEY} bg-sage-soft px-2 py-1.5 align-top`}>
                      <ShiftLabel edition={e} shift={s} className="block break-words" />
                    </th>
                  )}
                  <th scope="row" className={`${TABLE_TH} px-2 py-1.5 break-words text-navy`}>
                    {duty.name}
                  </th>
                  {ROTA_DAYS.map((d) => (
                    <td key={d} id={cellId("d", d, s, duty.id)} tabIndex={-1} className="px-1.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-navy">
                      {cellBody("d", d, s, duty)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {/* a phone: one day at a time */}
      <div className="space-y-3 md:hidden">
        <div role="tablist" aria-label="ימים" className="flex gap-1">
          {ROTA_DAYS.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === day}
              onClick={() => setDay(d)}
              className={`inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-full border px-1 text-sm font-bold ${d === day ? "border-navy bg-navy text-white shadow-sm" : "border-line bg-card text-navy hover:bg-accent-soft"}`}
            >
              {DAY_NAMES[d]}
            </button>
          ))}
        </div>
        <div id={`rota-p-${day}`} tabIndex={-1} className="space-y-3 outline-none">
          {shiftsOf(day).map((s) => (
            <section key={s} id={`rota-p-${day}-${s}`} tabIndex={-1} aria-label={`${DAY_NAMES[day]} · ${labels[s]}`} className={`${CARD} outline-none focus-visible:ring-2 focus-visible:ring-navy`}>
              <h3 className="font-bold text-navy">
                <ShiftLabel edition={e} shift={s} day={day} />
              </h3>
              <ul className="divide-y divide-sage/60">
                {duties.map((duty) => (
                  <li key={duty.id} id={cellId("p", day, s, duty.id)} tabIndex={-1} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-navy">
                    <span className="min-w-0 basis-full text-sm font-bold text-navy">{duty.name}</span>
                    <div className="min-w-0 flex-1">{cellBody("p", day, s, duty)}</div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      {cell && <CellPicker ctx={ctx} cell={cell} onClose={close} />}
    </div>
  );
}

/** The warnings, each with its mark: one about a shift is a button to it; one about the setup or the staff links there. */
function WarningItems({ warnings, onJump }: { warnings: RotaWarning[]; onJump: (w: RotaWarning) => void }) {
  const tone = (w: RotaWarning) => (w.severity === "warn" ? "bg-amber-50 text-amber-950 ring-amber-200" : "bg-sky-soft text-navy ring-sky/25");
  const line = (w: RotaWarning, more?: ReactNode) => (
    <>
      <SeverityMark severity={w.severity} className="mt-0.5" />
      <span className="min-w-0 break-words">
        {w.message}
        {more}
      </span>
    </>
  );
  return (
    <ul aria-label="אזהרות" className="max-h-96 space-y-1.5 overflow-y-auto pb-1">
      {warnings.map((w) => (
        <li key={w.key} data-warning={w.kind} className={`rounded-lg text-sm leading-snug ring-1 ring-inset ${tone(w)}`}>
          {w.kind === "no_lead" ? (
            <Link to="/logistics/rota/staff" className="flex min-h-11 items-start gap-2 px-3 py-2 hover:underline">
              {line(w, <span className="text-xs"> · למשמרות הצוות</span>)}
            </Link>
          ) : SETUP_KINDS.has(w.kind) ? (
            <Link to="/logistics/rota/setup" className="flex min-h-11 items-start gap-2 px-3 py-2 hover:underline">
              {line(w, <span className="text-xs"> · לקבוצות ומכינות</span>)}
            </Link>
          ) : w.day != null ? (
            <button type="button" onClick={() => onJump(w)} className="flex min-h-11 w-full items-start gap-2 px-3 py-2 text-start hover:underline">
              {line(w)}
            </button>
          ) : (
            <div className="flex min-h-11 items-start gap-2 px-3 py-2">{line(w)}</div>
          )}
        </li>
      ))}
    </ul>
  );
}
