// «התקדמות» (the reset, phase 3): the lens is a table in the grid's place — a row per lesson (closed, and drafts someone
// is pitched in), the lesson page's six steps as its columns, each cell the step's dot and its word, a link to that step
// of the page. Filters: the day, «רק מה שחסר», who handles it. A phone gets a card per lesson with its six dots. The
// rows are rows.ts (pure); the states and notes are the lesson page's own (pageSteps) — nothing is decided here.
import { useId, useMemo, useState } from "react";
import { Link } from "react-router";
import { displayName } from "../../domain/names";
import { PAGE_STEPS, lessonPath } from "../../domain/routes";
import type { StageState } from "../../domain/stages";
import { DAYS, DAY_NAMES, type Day, dateOf, fmtRange, shortDate } from "../../domain/time";
import { LIVE_PITCH } from "../../domain/types";
import { ReconfirmDot, STAGE_DOT, STAGE_STATE_LABEL } from "../../grid/bits";
import { type GridModel, pitchSpeaker } from "../../grid/model";
import { ownerColors } from "../../grid/owners";
import { AFTER_CLOSING, PAGE_STEP_LABEL, type PageStepView, firstOpenStep } from "../lesson/steps";
import { INPUT, TABLE_HEAD, TABLE_ROW, TABLE_TH } from "../settings/kit";
import { NO_FILTER, type ProgressFilter, type ProgressRow, byDay, filterProgress, progressRows } from "./rows";

const LEGEND: StageState[] = ["done", "waiting", "open", "problem", "na"];
const NO_HANDLER = "בלי אחראי/ת";

/** A draft's steps after closing say nothing yet: no link, a quiet dash. */
const silent = (r: ProgressRow, s: PageStepView) => r.draft && s.state === "na";

export function ProgressTable({ model, wide }: { model: GridModel; wide: boolean }) {
  const [filter, setFilter] = useState<ProgressFilter>(NO_FILTER);
  const rows = useMemo(() => progressRows(model), [model]);
  const shown = filterProgress(rows, filter);
  const owners = useMemo(() => ownerColors(model.week.team), [model.week.team]);
  const colorOf = new Map(owners.map((o) => [o.id, o.color]));
  const nameOf = (id: number | null) => (id == null ? NO_HANDLER : (model.memberName.get(id) ?? "חבר/ת צוות"));
  const id = useId();

  /** The lead (closed), or the live candidates (a draft). */
  const who = (r: ProgressRow): string => {
    if (!r.draft) {
      const lead = model.leadOf.get(r.lesson.id);
      return lead ? displayName(lead) : "שיעור";
    }
    const names = (model.pitchesByLesson.get(r.lesson.id) ?? [])
      .filter((p) => LIVE_PITCH.has(p.state))
      .map((p) => pitchSpeaker(model, p))
      .map((s) => (s ? displayName(s) : "מרצה"));
    return names.length > 2 ? `${names.slice(0, 2).join(", ")} ועוד ${names.length - 2}` : names.join(", ");
  };
  const dayTitle = (d: Day) => {
    const date = dateOf(model.week.edition.start_date, d);
    return `יום ${DAY_NAMES[d]}${date ? ` · ${shortDate(date)}` : ""}`;
  };

  const filters = (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2" data-progress-filters>
      <div className="w-40">
        <label htmlFor={`${id}-day`} className="mb-1 block text-sm font-bold text-ink">
          יום
        </label>
        <select
          id={`${id}-day`}
          className={INPUT}
          value={filter.day ?? ""}
          onChange={(e) => setFilter((f) => ({ ...f, day: e.target.value === "" ? null : (Number(e.target.value) as Day) }))}
        >
          <option value="">כל הימים</option>
          {DAYS.map((d) => (
            <option key={d} value={d}>
              יום {DAY_NAMES[d]}
            </option>
          ))}
        </select>
      </div>
      <div className="w-48">
        <label htmlFor={`${id}-handler`} className="mb-1 block text-sm font-bold text-ink">
          בטיפול
        </label>
        <select
          id={`${id}-handler`}
          className={INPUT}
          value={filter.handler ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            setFilter((f) => ({ ...f, handler: v === "" ? null : v === "none" ? "none" : Number(v) }));
          }}
        >
          <option value="">כולם</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          <option value="none">{NO_HANDLER}</option>
        </select>
      </div>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-semibold text-ink">
        <input type="checkbox" className="size-5 accent-navy" checked={filter.missing} onChange={(e) => setFilter((f) => ({ ...f, missing: e.target.checked }))} />
        רק מה שחסר
      </label>
      <p className="ms-auto text-sm text-ink-soft" aria-live="polite">
        {shown.length === rows.length ? `${rows.length} שיעורים` : `${shown.length} מתוך ${rows.length} שיעורים`}
      </p>
    </div>
  );

  const legend = (
    <ul aria-label="מקרא הנקודות" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
      {LEGEND.map((st) => (
        <li key={st} className="inline-flex items-center gap-1">
          <span aria-hidden className={`size-2.5 rounded-full border ${STAGE_DOT[st]}`} />
          {STAGE_STATE_LABEL[st]}
        </li>
      ))}
    </ul>
  );

  const handlerCell = (r: ProgressRow) => (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {r.handler != null && colorOf.has(r.handler) && <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf.get(r.handler) }} />}
      <span className={`truncate ${r.handler == null ? "text-ink-faint" : ""}`}>{nameOf(r.handler)}</span>
    </span>
  );

  const lessonCell = (r: ProgressRow) => (
    <>
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
        <Link to={lessonPath(r.lesson.id, firstOpenStep(r.steps))} className="inline-flex min-h-11 items-center font-bold text-navy underline-offset-4 hover:underline">
          {who(r)}
        </Link>
        {r.draft && <span className="rounded-full bg-sand-soft px-2 text-xs font-bold leading-5 text-ink">טיוטה</span>}
        {r.lesson.needs_reconfirm && <ReconfirmDot />}
      </span>
      {!r.draft && <span className="block truncate text-xs text-ink-soft">{r.lesson.title ?? "כותרת: TBD"}</span>}
    </>
  );

  let body;
  if (shown.length === 0) {
    body = <p className="rounded-xl border border-line bg-card px-4 py-6 text-center text-ink-soft">אין שיעורים שמתאימים לסינון.</p>;
  } else if (wide) {
    body = (
      <div className="overflow-x-auto rounded-xl border border-line bg-card shadow-sm">
        <table className="w-full min-w-[56rem] border-collapse text-sm" aria-label="התקדמות לפי שיעור">
          <thead>
            <tr className={TABLE_HEAD}>
              <th scope="col" className={`${TABLE_TH} px-3 py-2`}>
                שעה
              </th>
              <th scope="col" className={`${TABLE_TH} px-3 py-2`}>
                שיעור
              </th>
              <th scope="col" className={`${TABLE_TH} px-3 py-2`}>
                בטיפול
              </th>
              {PAGE_STEPS.map((k) => (
                <th key={k} scope="col" className={`${TABLE_TH} px-2 py-2`}>
                  {PAGE_STEP_LABEL[k]}
                </th>
              ))}
            </tr>
          </thead>
          {byDay(shown).map((g) => (
            <tbody key={g.day}>
              <tr>
                <th scope="colgroup" colSpan={3 + PAGE_STEPS.length} className="bg-sand-soft px-3 py-1.5 text-start font-display font-bold text-navy">
                  {dayTitle(g.day)}
                </th>
              </tr>
              {g.rows.map((r) => (
                <tr key={r.lesson.id} className={`${TABLE_ROW} align-middle`} data-progress-row={r.lesson.id} data-draft={r.draft || undefined}>
                  <td className="whitespace-nowrap px-3 py-1">
                    <bdi dir="ltr" className="font-bold tabular-nums text-navy">
                      {fmtRange(r.lesson.start_min, r.lesson.end_min)}
                    </bdi>
                  </td>
                  <td className="max-w-64 px-3 py-1">{lessonCell(r)}</td>
                  <td className="max-w-40 px-3 py-1">{handlerCell(r)}</td>
                  {r.steps.map((s) => (
                    <td key={s.key} className="px-1 py-1" data-step-cell={s.key} data-state={s.state}>
                      {silent(r, s) ? (
                        <span className="px-2 text-ink-faint" title={AFTER_CLOSING}>
                          <span aria-hidden>—</span>
                          <span className="sr-only">{`${s.label}: ${AFTER_CLOSING}`}</span>
                        </span>
                      ) : (
                        <Link
                          to={lessonPath(r.lesson.id, s.key)}
                          title={s.note}
                          aria-label={`${s.label}: ${STAGE_STATE_LABEL[s.state]} — ${s.note}`}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-ink hover:bg-accent-soft"
                        >
                          <span aria-hidden className={`size-2.5 shrink-0 rounded-full border ${STAGE_DOT[s.state]}`} />
                          <span className={s.state === "problem" ? "font-semibold text-bad" : s.state === "na" ? "text-ink-faint" : ""}>{STAGE_STATE_LABEL[s.state]}</span>
                        </Link>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        {byDay(shown).map((g) => (
          <section key={g.day} aria-label={dayTitle(g.day)} className="space-y-2">
            <h3 className="font-display text-base font-bold text-navy">{dayTitle(g.day)}</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {g.rows.map((r) => {
                const next = r.steps.find((s) => s.state !== "done" && s.state !== "na");
                return (
                  <li key={r.lesson.id} data-progress-row={r.lesson.id} data-draft={r.draft || undefined} className="rounded-xl border border-line bg-card px-3 py-2 shadow-sm">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <bdi dir="ltr" className="font-bold tabular-nums text-navy">
                        {fmtRange(r.lesson.start_min, r.lesson.end_min)}
                      </bdi>
                      <span className="min-w-0 flex-1">{lessonCell(r)}</span>
                    </div>
                    <p className="text-sm text-ink-soft">בטיפול: {handlerCell(r)}</p>
                    <ol className="mt-1 flex flex-wrap gap-1" aria-label="השלבים">
                      {r.steps.map((s) => (
                        <li key={s.key} data-step-cell={s.key} data-state={s.state}>
                          {silent(r, s) ? (
                            <span className="inline-flex min-h-11 min-w-11 items-center justify-center" title={`${s.label}: ${AFTER_CLOSING}`}>
                              <span aria-hidden className={`size-3 rounded-full border ${STAGE_DOT.na}`} />
                              <span className="sr-only">{`${s.label}: ${AFTER_CLOSING}`}</span>
                            </span>
                          ) : (
                            <Link
                              to={lessonPath(r.lesson.id, s.key)}
                              aria-label={`${s.label}: ${STAGE_STATE_LABEL[s.state]} — ${s.note}`}
                              title={`${s.label}: ${s.note}`}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-accent-soft"
                            >
                              <span aria-hidden className={`size-3 rounded-full border ${STAGE_DOT[s.state]}`} />
                            </Link>
                          )}
                        </li>
                      ))}
                    </ol>
                    <p className="text-sm text-ink">{next ? `הבא: ${next.label} — ${next.note}` : <span className="font-semibold text-ok">הכול מוכן</span>}</p>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3" data-progress-table>
      <h2 id={`${id}-title`} className="font-display text-xl font-extrabold text-navy">
        התקדמות לפי שיעור
      </h2>
      {filters}
      {legend}
      {!wide && <p className="text-xs text-ink-soft">{PAGE_STEPS.map((k) => PAGE_STEP_LABEL[k]).join(" · ")}</p>}
      {body}
    </section>
  );
}
