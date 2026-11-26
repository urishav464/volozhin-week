// «משמרות צוות» (v20, the owner's «לו"ז הצוות: יום × שעות הלו"ז, כמו ברשת») — a schedule, not a list: a column a day, a
// row a time row of the week's grid (src/exports/staffSchedule.ts — walked as groupSchedule walks them), and in each cell
// whoever of the staff is on then, by overlap — a person (a team member of the site, or a name as typed) or a whole
// cohort's staff. The first row a shift is on carries its hours, its note and «עריכה» / «מחיקה»; the rows after it the
// name and «עד HH:MM». «+» in a cell opens the staff form with that day and the row's hours filled in — the end
// extendable to a later row's end, the times still typed as before («06:30» as an end is the next morning). There is no
// «אחראי/ת משמרת»: every staff shift is a shift. A shift no row of its day holds is listed under the schedule, never lost.
// From 1024px the five days side by side; below it one day at a time (day tabs) — never a sideways scroll.
//
// The transports (the logistics side only — this screen is the edition's logistics team's and admins'): ONE
// cmds.transports() read (get_transports_for, so only what app.may_see_transport lets this viewer read); each one the
// board shows (approved, or waiting for the decision — said so) a chip «הסעה HH:MM · <מרצה>» in the row holding its
// pickup on the staff's clock (a pickup before 06:30 is the night of the day before), and for «הלוך ושוב» «הסעה חזרה»
// at the teaching's end; a click opens that day on the transport board. Nothing of a transport is written to the rota, and /print/rota (every member's) never shows one. No phones.
import { type FormEvent, Fragment, type ReactNode, useId, useMemo, useState } from "react";
import { Link } from "react-router";
import type { NewStaffShift, RotaStaffShift } from "../../../data/rota";
import { ROTA_DAYS } from "../../../domain/rota";
import { DAY_END, DAY_NAMES, DAY_START, type Day, fmt, fmtRange, LRM, nightLabel, parseClock } from "../../../domain/time";
import { transportLegs } from "../../../exports/logistics";
import { cohortsInOrder, staffWho } from "../../../exports/rota";
import { dayRowIndexes, legText, OUTSIDE_ROWS, type PlacedLeg, placeLegs, rowEndsFrom, rowNight, staffSchedule, type StaffSchedule } from "../../../exports/staffSchedule";
import { useMedia } from "../../../lib/useMedia";
import { todayColumn } from "../../../offline/view";
import { Button, CHOICE, CHOICE_OFF, CHOICE_ON, Confirm, Field, INPUT, useFocusBack, useFocusRescue } from "../../settings/kit";
import { useTransports } from "../useTransports";
import { formRefusal, Problem, type RotaCtx } from "./parts";

type Who = "member" | "name" | "cohort";
const WHO_LABEL: Record<Who, string> = { member: "איש/אשת צוות מהאתר", name: "שם אחר", cohort: "צוות של מכינה" };

/** The block under the schedule: the staff shifts no row of their day holds. */
const OUTSIDE = -1;

/** What opens under a row: a new shift from a cell's «+», a shift's form, or «למחוק?». `row` is the row it opened from (OUTSIDE: the block under the schedule). */
type Panel = { kind: "new"; day: Day; row: number } | { kind: "edit" | "delete"; id: number; day: Day; row: number };

const COLS = "8rem repeat(5, minmax(0, 1fr))";
const HATCH = "bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(35_67_119/0.07)_6px_8px)]";

/** A typed time as the day's minutes: «06:30» as an end is the next morning's (1830). */
function minutes(s: string, end: boolean): number | null {
  const v = parseClock(s);
  return v != null && end && v === DAY_START ? DAY_END : v;
}

/** «‎02:00 (ליל ראשון–שני)», «‎06:30 (הבוקר שאחרי)» — an end in the extension's list. */
function endText(day: Day, end: number): string {
  if (end === DAY_END) return `${LRM}${fmt(end)} (הבוקר שאחרי)`;
  const night = end > 1440 ? nightLabel(day, end) : null;
  return `${LRM}${fmt(end)}${night ? ` (${night})` : ""}`;
}

export function StaffShifts({ ctx }: { ctx: RotaCtx }) {
  const { port, week, data, busy, act, mayWrite } = ctx;
  const e = week.edition;
  const wide = useMedia("(min-width: 1024px)");
  const sched = useMemo(() => staffSchedule(week, data), [week, data]);
  // the board's one read, the same key and the same re-reads (useTransports.ts — also on the tab's return and every two minutes)
  const transports = useTransports(port, week);
  const legs = useMemo(() => placeLegs(sched.rows, transportLegs(week, transports.rows, { pending: true })), [sched.rows, week, transports.rows]);
  const [day, setDayState] = useState<Day>(() => todayColumn(e.start_date, new Date().toISOString()) ?? 0);
  const [panel, setPanel] = useState<Panel | null>(null);
  const focus = useFocusBack();
  const rescue = useFocusRescue();
  const setDay = (d: Day) => {
    setDayState(d);
    setPanel(null);
  };
  const addKey = (d: Day, row: number) => `add-${d}-${row}`;
  const shiftById = (id: number) => data.staff.find((s) => s.id === id);

  const close = (back: string | null) => {
    setPanel(null);
    if (back) focus.back(back);
  };

  /** What opens under a row: the form or «למחוק?». */
  const panelBody = (p: Panel) => {
    const rowIdx = p.row;
    if (p.kind === "new") {
      const r = sched.rows[rowIdx];
      return (
        <StaffForm
          ctx={ctx}
          sched={sched}
          rowIdx={rowIdx}
          title={`משמרת צוות חדשה: יום ${DAY_NAMES[p.day]}`}
          day={p.day}
          preset={{ start: r.start, end: r.end }}
          busy={busy === `staff-new-${p.day}`}
          onCancel={() => close(addKey(p.day, rowIdx))}
          onSave={async (v, refused) => {
            if (!(await act(`staff-new-${p.day}`, () => port.rota.addStaffShift(e.id, v), "משמרת הצוות נוספה", refused))) return;
            // the review: saved for another day than the one tab drawn below 1024px — that day's tab, so the new shift is in
            // view, and the focus to its schedule (the «+» it came from is on the other tab)
            if (!wide && v.day !== day) {
              setDay(v.day);
              rescue(() => document.getElementById("staff-schedule"));
            } else close(addKey(p.day, rowIdx));
          }}
        />
      );
    }
    const s = shiftById(p.id);
    if (!s) return null;
    if (p.kind === "edit") {
      return (
        <StaffForm
          ctx={ctx}
          sched={sched}
          rowIdx={rowIdx}
          title={`עריכת משמרת צוות: ${staffWho(data, s)}`}
          initial={s}
          day={s.day}
          busy={busy === `staff-${s.id}`}
          onCancel={() => close(`edit-${s.id}`)}
          onSave={async (v, refused) => {
            if (!(await act(`staff-${s.id}`, () => port.rota.updateStaffShift(s.id, v), "משמרת הצוות נשמרה", refused))) return;
            // the review: moved to another day below 1024px — that day's tab, where the shift and its «עריכה» are drawn, takes
            // the focus back (the tab it was on no longer has it: the focus would fall to the page)
            if (!wide && v.day !== day) setDayState(v.day);
            close(`edit-${s.id}`);
          }}
        />
      );
    }
    return (
      <Confirm
        text={
          <>
            למחוק את המשמרת של <b>{staffWho(data, s)}</b> (יום {DAY_NAMES[s.day]}, <bdi dir="ltr">{fmtRange(s.start_min, s.end_min)}</bdi>)?
          </>
        }
        confirm="מחיקה"
        busy={busy === `delete-staff-${s.id}`}
        onConfirm={() =>
          void act(`delete-staff-${s.id}`, () => port.rota.deleteStaffShift(s.id), "משמרת הצוות נמחקה").then((ok) => {
            setPanel(null);
            if (!ok) focus.back(`delete-${s.id}`);
            // gone: the focus to the «+» of the row it was on, else the schedule
            else rescue(() => document.querySelector<HTMLElement>(`[data-add="${addKey(p.day, rowIdx)}"]`) ?? document.getElementById("staff-schedule"));
          })
        }
        onCancel={() => close(`delete-${s.id}`)}
      />
    );
  };

  /** One staff shift in a cell: in its first row the hours, the note and the buttons; after it the name and «עד». */
  const entry = (s: RotaStaffShift, first: boolean) => {
    const who = staffWho(data, s);
    const range = fmtRange(s.start_min, s.end_min);
    if (!first) {
      return (
        <li key={s.id} data-staff-cont={s.id} className="text-xs break-words text-ink-soft">
          {who} · עד <bdi dir="ltr">{fmt(s.end_min)}</bdi>
        </li>
      );
    }
    const open = panel && panel.kind !== "new" && panel.id === s.id ? panel.kind : null;
    return (
      <li key={s.id} data-staff-shift={s.id} className="space-y-0.5 rounded-lg border border-navy/20 bg-accent-soft/60 px-2 py-1 text-sm">
        <p className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="min-w-0 font-bold break-words text-navy">{who}</span>
          <bdi dir="ltr" className="text-xs text-ink-soft tabular-nums">
            {range}
          </bdi>
        </p>
        {s.note && <p className="text-xs break-words text-ink-soft">{s.note}</p>}
        {mayWrite && !open && (
          <div className="flex flex-wrap gap-x-1">
            <Button kind="quiet" ref={focus.ref(`edit-${s.id}`)} onClick={() => setPanel({ kind: "edit", id: s.id, day: s.day, row: sched.first.get(s.id) ?? OUTSIDE })} aria-label={`עריכה: ${who} ${range}`}>
              עריכה
            </Button>
            <Button kind="danger" ref={focus.ref(`delete-${s.id}`)} onClick={() => setPanel({ kind: "delete", id: s.id, day: s.day, row: sched.first.get(s.id) ?? OUTSIDE })} aria-label={`מחיקה: ${who} ${range}`}>
              מחיקה
            </Button>
          </div>
        )}
      </li>
    );
  };

  /** A cell: who is on, the transports at its time, «+» beside them (`head`: the row's time on a phone, above them). */
  const cell = (i: number, d: Day, head?: ReactNode) => {
    const r = sched.rows[i];
    const on = r.cells[d] ?? [];
    const mine = legs.filter((l) => l.col === d && l.row === i);
    return (
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1 space-y-1">
          {head}
          {on.length > 0 && <ul className="space-y-1">{on.map((s) => entry(s, sched.first.get(s.id) === i))}</ul>}
          {mine.length > 0 && (
            <ul aria-label="הסעות" className="space-y-1">
              {mine.map((l) => (
                <LegChip key={`${l.lessonId}:${l.leg}`} leg={l} />
              ))}
            </ul>
          )}
        </div>
        {mayWrite && (
          <Button
            kind="quiet"
            ref={focus.ref(addKey(d, i))}
            data-add={addKey(d, i)}
            onClick={() => setPanel({ kind: "new", day: d, row: i })}
            aria-label={`+ משמרת צוות: יום ${DAY_NAMES[d]} ${fmtRange(r.start, r.end)}`}
            aria-expanded={panel?.kind === "new" && panel.day === d && panel.row === i}
            className="shrink-0"
          >
            +
          </Button>
        )}
      </div>
    );
  };

  const outsideDays = (wide ? ROTA_DAYS : [day]).filter((d) => sched.outside[d].length > 0);
  const outside =
    outsideDays.length > 0 ? (
      <section aria-labelledby="staff-outside" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50/50 p-3">
        <h3 id="staff-outside" className="font-bold text-navy">
          {OUTSIDE_ROWS}
        </h3>
        <p className="text-sm text-ink-soft">משמרות שהשעות שלהן לא נוגעות באף שורה של הלו״ז ביום שלהן (למשל אחרי סיום השבוע ביום חמישי). אפשר לערוך או למחוק.</p>
        {outsideDays.map((d) => (
          <div key={d} className="space-y-1">
            <p className="text-sm font-bold">יום {DAY_NAMES[d]}</p>
            <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{sched.outside[d].map((s) => entry(s, true))}</ul>
          </div>
        ))}
        {panel && panel.row === OUTSIDE && outsideDays.includes(panel.day) && <div className="rounded-lg bg-sand-soft p-3">{panelBody(panel)}</div>}
      </section>
    ) : null;

  return (
    <div className="space-y-3">
      <div className="space-y-1 text-sm text-ink-soft">
        <p>הלו״ז של הצוות: עמודה לכל יום ושורה לכל שורה של הלו״ז, ובכל משבצת מי מהצוות בשעות האלה. «+» פותח משמרת בשעות של השורה, ואפשר להאריך אותה עד סוף שורה מאוחרת יותר. בלי טלפונים.</p>
        {transports.failed ? (
          <div role="alert" className="flex flex-wrap items-center gap-2">
            <span className="text-bad">לא הצלחנו לטעון את ההסעות.</span>
            <Button onClick={() => void transports.load()}>לנסות שוב</Button>
          </div>
        ) : (
          transports.rows != null && <p data-staff-transports={legs.length}>בלו״ז מופיעות גם ההסעות שמותר לך לראות (מקווקו: עוד ממתין לאישור; ירוק: סודר) — רק כאן, לא בדפים להדפסה. לחיצה על הסעה פותחת את לוח ההסעות.</p>
        )}
      </div>

      {wide ? (
        <div role="table" id="staff-schedule" tabIndex={-1} aria-label="לו״ז הצוות" data-staff-schedule className="outline-none">
          <div role="rowgroup" className="sticky top-0 z-20 bg-paper pb-1">
            <div role="row" className="grid gap-1" style={{ gridTemplateColumns: COLS }}>
              <div role="columnheader" className="self-end pe-1 text-end text-xs font-bold text-ink-soft">
                שעה
              </div>
              {ROTA_DAYS.map((d) => (
                <div key={d} role="columnheader" className="rounded-xl border border-line bg-card px-2.5 py-1.5 font-display text-[15px] font-extrabold text-navy shadow-sm">
                  {DAY_NAMES[d]}
                </div>
              ))}
            </div>
          </div>
          <div role="rowgroup" className="space-y-1">
            {sched.rows.map((r, i) => (
              <Fragment key={i}>
                <div role="row" data-staff-row={i} className="grid gap-1" style={{ gridTemplateColumns: COLS }}>
                  <div role="rowheader" className="pe-1 pt-1 text-end">
                    <bdi dir="ltr" className="block text-xs font-bold text-navy tabular-nums">
                      {fmtRange(r.start, r.end)}
                    </bdi>
                    {r.label && <span className="block text-[11px] leading-tight text-ink-soft">{r.label}</span>}
                  </div>
                  {ROTA_DAYS.map((d) =>
                    r.cells[d] == null ? (
                      <div key={d} role="cell" className={`min-h-11 rounded-lg border border-line/70 ${HATCH}`} title="מחוץ לשעות השבוע">
                        <span className="sr-only">
                          {DAY_NAMES[d]}: מחוץ לשבוע
                        </span>
                      </div>
                    ) : (
                      <div key={d} role="cell" data-staff-cell={`${d}:${i}`} className="min-w-0 rounded-lg border border-line bg-card p-1.5 shadow-sm">
                        {cell(i, d)}
                      </div>
                    ),
                  )}
                </div>
                {panel && panel.row === i && (
                  <div role="row" className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
                    <div role="cell" aria-colspan={6} className="rounded-xl border border-navy/30 bg-sand-soft p-3">
                      {panelBody(panel)}
                    </div>
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div role="tablist" aria-label="ימים" className="flex flex-wrap gap-1.5">
            {ROTA_DAYS.map((d) => {
              const n = data.staff.filter((s) => s.day === d).length;
              return (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  aria-selected={d === day}
                  data-staff-day-tab={d}
                  aria-label={`יום ${DAY_NAMES[d]}: ${n === 1 ? "משמרת צוות אחת" : `${n} משמרות צוות`}`}
                  onClick={() => setDay(d)}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-bold transition-colors ${d === day ? "border-navy bg-navy text-white shadow-sm" : "border-line bg-card text-navy hover:border-navy/50 hover:bg-accent-soft"}`}
                >
                  {DAY_NAMES[d]}
                  <span className={`rounded-full px-1.5 text-xs ${d === day ? "bg-white/20" : "bg-sand-soft text-ink-soft"}`}>{n}</span>
                </button>
              );
            })}
          </div>
          <ul role="tabpanel" id="staff-schedule" tabIndex={-1} aria-label={`לו״ז הצוות ביום ${DAY_NAMES[day]}`} data-staff-schedule data-staff-day={day} className="divide-y divide-sage/60 rounded-xl border border-line bg-card px-3 shadow-sm outline-none">
            {dayRowIndexes(sched.rows, day).map((i) => {
              const r = sched.rows[i];
              const night = rowNight(day, r);
              return (
                <li key={i} data-staff-row={i} className="space-y-1.5 py-1.5">
                  <div data-staff-cell={`${day}:${i}`}>
                    {cell(
                      i,
                      day,
                      <p className="flex min-h-11 flex-wrap items-center gap-x-2">
                        <bdi dir="ltr" className="font-bold text-navy tabular-nums">
                          {fmtRange(r.start, r.end)}
                        </bdi>
                        {(night || r.label) && <span className="text-xs text-ink-soft">{[night, r.label].filter(Boolean).join(" · ")}</span>}
                      </p>,
                    )}
                  </div>
                  {panel && panel.row === i && panel.day === day && <div className="rounded-lg bg-sand-soft p-3">{panelBody(panel)}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {outside}
    </div>
  );
}

/** Where a transport stands, in the chip's words and colour (the board's: BOARD_STATE). */
const LEG_STATE: Record<PlacedLeg["state"], { text: string; tone: string }> = {
  pending: { text: "ממתין לאישור", tone: "border-dashed border-amber-400 bg-amber-50 text-amber-900" },
  approved: { text: "אושר — עוד לא סודר", tone: "border-sky/40 bg-sky-soft text-navy" },
  arranged: { text: "סודר", tone: "border-emerald-300 bg-emerald-50 text-emerald-900" },
};

/** A transport in the schedule: «הסעה ‎06:10 · מרצה» — a link to that day on the transport board; dashed while it waits, green once «סודר». */
function LegChip({ leg: l }: { leg: PlacedLeg }) {
  const st = LEG_STATE[l.state];
  return (
    <li>
      <Link
        to={`/logistics/transports?day=${l.day}`}
        data-staff-leg={`${l.lessonId}:${l.leg}`}
        data-state={l.state}
        aria-label={`${legText(l)} · ${st.text} — ללוח ההסעות`}
        title={st.text}
        className={`flex min-h-11 items-center rounded-lg border px-2 py-1 text-xs break-words hover:underline ${st.tone}`}
      >
        <span className="min-w-0">
          {l.leg === "return" ? "הסעה חזרה" : "הסעה"} <bdi dir="ltr">{l.min == null ? "TBD" : fmt(l.min)}</bdi> · {l.speaker || "TBD"}
        </span>
      </Link>
    </li>
  );
}

function StaffForm({ ctx, sched, rowIdx, title, initial, preset, day: day0, busy, onSave, onCancel }: {
  ctx: RotaCtx;
  sched: StaffSchedule;
  /** The row the form opened from (OUTSIDE: under the schedule) — the ends it may be extended to. */
  rowIdx: number;
  title: string;
  initial?: RotaStaffShift;
  /** A new shift from a cell's «+»: the row's hours. */
  preset?: { start: number; end: number };
  day: Day;
  busy: boolean;
  onSave: (v: NewStaffShift, refused: (code: string | null) => boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const { week, data } = ctx;
  const id = useId();
  const team = [...week.team].sort((a, b) => a.display_name.localeCompare(b.display_name, "he") || a.id - b.id);
  // the shift's own member, deactivated since (week.team is the active team): kept as a choice — such a row stays and
  // may still be edited (CONTRACT «תורנויות»), and the guard takes the same member_id; another one is not offered
  const kept = initial?.member_id != null && !team.some((m) => m.id === initial.member_id) ? { id: initial.member_id, display_name: initial.name ?? "" } : null;
  const cohorts = cohortsInOrder(data);
  const [day, setDay] = useState<Day>(initial?.day ?? day0);
  const [from, setFrom] = useState(initial ? fmt(initial.start_min) : preset ? fmt(preset.start) : "");
  const [to, setTo] = useState(initial ? fmt(initial.end_min) : preset ? fmt(preset.end) : "");
  const [who, setWho] = useState<Who>(initial ? (initial.cohort_id != null ? "cohort" : initial.member_id != null ? "member" : "name") : "member");
  const [member, setMember] = useState(initial?.member_id != null ? String(initial.member_id) : "");
  const [name, setName] = useState(initial?.member_id == null ? (initial?.name ?? "") : "");
  const [cohort, setCohort] = useState(initial?.cohort_id != null ? String(initial.cohort_id) : String(cohorts[0]?.id ?? ""));
  const [note, setNote] = useState(initial?.note ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  // «להאריך עד סוף שורה»: this row's end and every later one of the day chosen
  const ends = rowIdx === OUTSIDE ? [] : rowEndsFrom(sched.rows, day, rowIdx);
  const endNow = minutes(to, true);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    const start = minutes(from, false);
    const end = minutes(to, true);
    if (start == null || end == null) return setProblem("שעה בפורמט HH:MM, למשל 08:30 (06:30 בסוף — עד הבוקר שאחרי).");
    const picked = team.find((m) => String(m.id) === member) ?? (kept && String(kept.id) === member ? kept : undefined);
    if (who === "member" && !picked) return setProblem("צריך לבחור איש/אשת צוות.");
    const v: NewStaffShift = {
      day,
      start_min: start,
      end_min: end,
      member_id: who === "member" ? picked!.id : null,
      name: who === "member" ? picked!.display_name : who === "name" ? name : null,
      cohort_id: who === "cohort" ? Number(cohort) || null : null,
      note,
    };
    void onSave(
      v,
      formRefusal(setProblem, {
        bad_value: "אחד הערכים לא תקין. השעות: «מ-» לפני «עד», בקפיצות של 5 דקות, מ-06:30 עד 06:30 למחרת.",
        name_required: who === "cohort" ? "צריך לבחור מכינה." : "צריך שם.",
      }),
    );
  };
  return (
    <form aria-label={title} onSubmit={submit} className="space-y-3">
      <p className="font-bold text-navy">{title}</p>
      <div className={`grid gap-3 sm:grid-cols-3 ${ends.length > 1 ? "lg:grid-cols-4" : ""}`}>
        <Field id={`${id}-day`} label="יום">
          <select id={`${id}-day`} value={day} onChange={(ev) => setDay(Number(ev.target.value) as Day)} className={INPUT}>
            {ROTA_DAYS.map((d) => (
              <option key={d} value={d}>
                {DAY_NAMES[d]}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-from`} label="מ-">
          <input id={`${id}-from`} dir="ltr" inputMode="numeric" placeholder="08:30" value={from} onChange={(ev) => setFrom(ev.target.value)} className={INPUT} autoFocus />
        </Field>
        <Field id={`${id}-to`} label="עד">
          <input id={`${id}-to`} dir="ltr" inputMode="numeric" placeholder="14:30" value={to} onChange={(ev) => setTo(ev.target.value)} className={INPUT} />
        </Field>
        {ends.length > 1 && (
          <Field id={`${id}-until`} label="להאריך עד סוף שורה">
            <select id={`${id}-until`} value={endNow != null && ends.includes(endNow) ? endNow : ""} onChange={(ev) => ev.target.value && setTo(fmt(Number(ev.target.value)))} className={INPUT}>
              <option value="">שעה אחרת</option>
              {ends.map((x) => (
                <option key={x} value={x}>
                  {endText(day, x)}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <fieldset className="min-w-0">
        <legend className="mb-1 text-sm font-bold text-ink">מי</legend>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(WHO_LABEL) as Who[]).map((w) => (
            <label key={w} className={`${CHOICE} ${who === w ? CHOICE_ON : CHOICE_OFF}`}>
              <input type="radio" name={`${id}-who`} checked={who === w} onChange={() => setWho(w)} disabled={w === "cohort" && cohorts.length === 0} className="accent-navy" />
              {WHO_LABEL[w]}
            </label>
          ))}
        </div>
        <div className="mt-2">
          {who === "member" && (
            <select aria-label="איש/אשת צוות" value={member} onChange={(ev) => setMember(ev.target.value)} className={INPUT}>
              <option value="">בחירה…</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
              {kept && <option value={kept.id}>{kept.display_name} (מושבת/ת)</option>}
            </select>
          )}
          {who === "name" && <input aria-label="השם" value={name} onChange={(ev) => setName(ev.target.value)} maxLength={80} className={INPUT} />}
          {who === "cohort" && (
            <select aria-label="המכינה" value={cohort} onChange={(ev) => setCohort(ev.target.value)} className={INPUT}>
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  צוות {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </fieldset>
      <Field id={`${id}-note`} label="הערה (לא חובה)" hint="כל הצוות של המחזור רואה אותה. בלי טלפונים ובלי כתובות.">
        <input id={`${id}-note`} value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={200} className={INPUT} />
      </Field>
      <Problem>{problem}</Problem>
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" type="submit" busy={busy}>
          שמירה
        </Button>
        <Button onClick={onCancel}>ביטול</Button>
      </div>
    </form>
  );
}
