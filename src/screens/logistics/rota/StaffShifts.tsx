// «משמרות צוות» — who of the staff is on when, a list per day: a person (a team member of the site, or a name as
// typed) or a whole cohort's staff («צוות מכינה לדוגמה נ» — the cohorts that came for part of the week wrote their
// cohort, not names); a shift or the shift's lead («אחראי/ת משמרת»: the board warns about a shift without one); a note
// («הקפצת מרצה»). The times are typed («08:30»; before 06:30 is the night after the day, «06:30» as an end is the next
// morning). No phone: only the group heads' phones are kept, apart.
import { type FormEvent, useId, useMemo, useState } from "react";
import type { NewStaffShift, RotaStaffShift, StaffKind } from "../../../data/rota";
import { ROTA_DAYS, rotaShiftsOf } from "../../../domain/rota";
import { rotaWarnings } from "../../../domain/rotaWarnings";
import { DAY_END, DAY_NAMES, DAY_START, type Day, fmt, fmtRange, parseClock } from "../../../domain/time";
import { cohortsInOrder, STAFF_KIND_LABEL, staffWho } from "../../../exports/rota";
import { Badge, Button, CHOICE, CHOICE_OFF, CHOICE_ON, Confirm, Field, INPUT, useFocusBack } from "../../settings/kit";
import { CARD, formRefusal, Problem, type RotaCtx } from "./parts";

type Who = "member" | "name" | "cohort";
const WHO_LABEL: Record<Who, string> = { member: "איש/אשת צוות מהאתר", name: "שם אחר", cohort: "צוות של מכינה" };

/** A typed time as the day's minutes: «06:30» as an end is the next morning's (1830). */
function minutes(s: string, end: boolean): number | null {
  const v = parseClock(s);
  return v != null && end && v === DAY_START ? DAY_END : v;
}

export function StaffShifts({ ctx }: { ctx: RotaCtx }) {
  const { port, week, data, busy, act, mayWrite } = ctx;
  const e = week.edition;
  const focus = useFocusBack();
  const [editing, setEditing] = useState<number | { day: Day } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const noLead = useMemo(() => rotaWarnings(data, e).filter((w) => w.kind === "no_lead"), [data, e]);
  const staff = [...data.staff].sort((a, b) => a.day - b.day || a.start_min - b.start_min || a.id - b.id);
  const labels = (d: Day) =>
    noLead
      .filter((w) => w.day === d)
      .map((w) => w.shift)
      .filter((s) => s != null);
  const shiftNames = rotaShiftsOf(e).labels;
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">מי מהצוות בתורנות בכל יום. «אחראי/ת משמרת» — מי שאחראי/ת על המשמרת כולה; משמרת בלי אחראי/ת מקבלת אזהרה בלוח. בלי טלפונים.</p>
      {ROTA_DAYS.map((d) => {
        const mine = staff.filter((s) => s.day === d);
        const missing = labels(d);
        return (
          <section key={d} aria-label={`יום ${DAY_NAMES[d]}`} className={`${CARD} space-y-2 sm:p-4`}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-display text-lg font-bold text-navy">יום {DAY_NAMES[d]}</h3>
              <span className="text-sm text-ink-soft">{mine.length || ""}</span>
            </div>
            {missing.length > 0 && (
              <p data-no-lead className="text-sm text-amber-900">
                בלי אחראי/ת משמרת: {missing.map((s) => shiftNames[s!]).join(", ")}
              </p>
            )}
            {mine.length > 0 && (
              <ul aria-label={`משמרות הצוות ביום ${DAY_NAMES[d]}`} className="divide-y divide-sage/60">
                {mine.map((s) =>
                  editing === s.id ? (
                    <li key={s.id} className="py-2">
                      <StaffForm
                        ctx={ctx}
                        title={`עריכת משמרת צוות: ${staffWho(data, s)}`}
                        initial={s}
                        day={d}
                        busy={busy === `staff-${s.id}`}
                        onCancel={() => setEditing(null)}
                        onSave={async (v, refused) => {
                          if (await act(`staff-${s.id}`, () => port.rota.updateStaffShift(s.id, v), "משמרת הצוות נשמרה", refused)) setEditing(null);
                        }}
                      />
                    </li>
                  ) : (
                    <li key={s.id} data-staff-shift={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                      <div className="min-w-0 flex-1 basis-56">
                        <p className="flex flex-wrap items-center gap-x-2">
                          <bdi dir="ltr" className="font-bold text-navy tabular-nums">
                            {fmtRange(s.start_min, s.end_min)}
                          </bdi>
                          <span className="min-w-0 font-bold break-words">{staffWho(data, s)}</span>
                          {s.kind === "lead" && <Badge tone="accent">{STAFF_KIND_LABEL.lead}</Badge>}
                        </p>
                        {s.note && <p className="text-sm break-words text-ink-soft">{s.note}</p>}
                      </div>
                      {mayWrite &&
                        (deleting === s.id ? (
                          <div className="basis-full">
                            <Confirm
                              text={
                                <>
                                  למחוק את המשמרת של <b>{staffWho(data, s)}</b> (<bdi dir="ltr">{fmtRange(s.start_min, s.end_min)}</bdi>)?
                                </>
                              }
                              confirm="מחיקה"
                              busy={busy === `delete-staff-${s.id}`}
                              onConfirm={() =>
                                void act(`delete-staff-${s.id}`, () => port.rota.deleteStaffShift(s.id), "משמרת הצוות נמחקה").then((ok) => {
                                  setDeleting(null);
                                  if (!ok) focus.back(`delete-${s.id}`);
                                })
                              }
                              onCancel={() => {
                                setDeleting(null);
                                focus.back(`delete-${s.id}`);
                              }}
                            />
                          </div>
                        ) : (
                          <div className="flex shrink-0 flex-wrap gap-1 sm:ms-auto">
                            <Button kind="quiet" onClick={() => setEditing(s.id)} aria-label={`עריכה: ${staffWho(data, s)} ${fmtRange(s.start_min, s.end_min)}`}>
                              עריכה
                            </Button>
                            <Button kind="danger" ref={focus.ref(`delete-${s.id}`)} onClick={() => setDeleting(s.id)} aria-label={`מחיקה: ${staffWho(data, s)} ${fmtRange(s.start_min, s.end_min)}`}>
                              מחיקה
                            </Button>
                          </div>
                        ))}
                    </li>
                  ),
                )}
              </ul>
            )}
            {mine.length === 0 && <p className="text-sm text-ink-soft">עוד אין משמרות צוות ביום הזה.</p>}
            {mayWrite &&
              (typeof editing === "object" && editing?.day === d ? (
                <StaffForm
                  ctx={ctx}
                  title={`משמרת צוות חדשה: יום ${DAY_NAMES[d]}`}
                  day={d}
                  busy={busy === `staff-new-${d}`}
                  onCancel={() => setEditing(null)}
                  onSave={async (v, refused) => {
                    if (await act(`staff-new-${d}`, () => port.rota.addStaffShift(e.id, v), "משמרת הצוות נוספה", refused)) setEditing(null);
                  }}
                />
              ) : (
                <Button onClick={() => setEditing({ day: d })} aria-label={`+ משמרת צוות: יום ${DAY_NAMES[d]}`}>
                  + משמרת צוות
                </Button>
              ))}
          </section>
        );
      })}
    </div>
  );
}

function StaffForm({ ctx, title, initial, day: day0, busy, onSave, onCancel }: {
  ctx: RotaCtx;
  title: string;
  initial?: RotaStaffShift;
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
  const [from, setFrom] = useState(initial ? fmt(initial.start_min) : "");
  const [to, setTo] = useState(initial ? fmt(initial.end_min) : "");
  const [who, setWho] = useState<Who>(initial ? (initial.cohort_id != null ? "cohort" : initial.member_id != null ? "member" : "name") : "member");
  const [member, setMember] = useState(initial?.member_id != null ? String(initial.member_id) : "");
  const [name, setName] = useState(initial?.member_id == null ? (initial?.name ?? "") : "");
  const [cohort, setCohort] = useState(initial?.cohort_id != null ? String(initial.cohort_id) : String(cohorts[0]?.id ?? ""));
  const [kind, setKind] = useState<StaffKind>(initial?.kind ?? "shift");
  const [note, setNote] = useState(initial?.note ?? "");
  const [problem, setProblem] = useState<string | null>(null);
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
      kind,
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
    <form aria-label={title} onSubmit={submit} className="space-y-3 rounded-lg bg-sand-soft p-3">
      <p className="font-bold text-navy">{title}</p>
      <div className="grid gap-3 sm:grid-cols-3">
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
          <input id={`${id}-from`} dir="ltr" inputMode="numeric" placeholder="08:30" value={from} onChange={(ev) => setFrom(ev.target.value)} className={INPUT} />
        </Field>
        <Field id={`${id}-to`} label="עד">
          <input id={`${id}-to`} dir="ltr" inputMode="numeric" placeholder="14:30" value={to} onChange={(ev) => setTo(ev.target.value)} className={INPUT} />
        </Field>
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
      <fieldset className="min-w-0">
        <legend className="mb-1 text-sm font-bold text-ink">סוג</legend>
        <div className="flex flex-wrap gap-1.5">
          {(["shift", "lead"] as StaffKind[]).map((k) => (
            <label key={k} className={`${CHOICE} ${kind === k ? CHOICE_ON : CHOICE_OFF}`}>
              <input type="radio" name={`${id}-kind`} checked={kind === k} onChange={() => setKind(k)} className="accent-navy" />
              {STAFF_KIND_LABEL[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field id={`${id}-note`} label="הערה (לא חובה)" hint="למשל «הקפצת מרצה». בלי טלפונים.">
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
