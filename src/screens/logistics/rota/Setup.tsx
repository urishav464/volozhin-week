// «קבוצות ומכינות» — what the board is made of: the cohorts on campus (a letter that starts its groups' codes, a name,
// the diets the food orders count), when each is on campus (cohort × day × shift; no mark = not marked, never assumed —
// «כל השבוע», «כל היום»), the groups (the next number suggested, a size — TBD until known — and the head's name; the
// head's phone only behind «כולל טלפונים של ראשי הקבוצות», for those who may see it, saved through set_rota_contact
// alone), the duties (how many groups each shift needs — empty is «not set», and the suggestion leaves it — and a
// minimum of people), with last year's four when the list is empty («הצעה»), and the shifts' hours — the edition's
// admins'. A head's phone is personal data: no column, no line and no field for it while the switch is off.
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { cleanHeadPhone, type Diet, LAST_YEAR_DUTIES, type NewDuty, type PresenceScope, type RotaCohort, type RotaDuty, type RotaGroup } from "../../../data/rota";
import { DEFAULT_ROTA_SHIFTS, groupCode, ROTA_DAYS, rotaShiftActive, rotaShiftsOf, SHIFTS } from "../../../domain/rota";
import { DAY_NAMES, fmt, parseClock } from "../../../domain/time";
import { cohortsInOrder, dutiesInOrder, groupsInOrder, shiftText } from "../../../exports/rota";
import { GroupChip, HeadPhonesToggle, useHeadPhones } from "../../rota/shared";
import { Badge, Button, Confirm, Field, Fold, INPUT, TABLE_HEAD, TABLE_ROW, TABLE_TH, useFocusBack } from "../../settings/kit";
import { CARD, formRefusal, intOrNull, Problem, type RotaCtx } from "./parts";

export function Setup({ ctx }: { ctx: RotaCtx }) {
  return (
    <div className="space-y-4">
      <Cohorts ctx={ctx} />
      <Presence ctx={ctx} />
      <Groups ctx={ctx} />
      <Duties ctx={ctx} />
      <Shifts ctx={ctx} />
    </div>
  );
}

/** A part of the setup: its heading and a muted aside, a region by its name. */
function Part({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`${CARD} space-y-3 sm:p-4`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={id} className="font-display text-lg font-bold text-navy">
          {title}
        </h3>
        {aside != null && <span className="text-sm text-ink-soft">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** «עריכה» / «מחיקה» of a line, the delete behind a Confirm whose «ביטול» gives the button the focus back. */
function LineActions({ name, deleting, onEdit, onDelete, confirm, focusKey, focus }: {
  name: string;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  confirm: ReactNode;
  focusKey: string;
  focus: ReturnType<typeof useFocusBack>;
}) {
  if (deleting) return <div className="basis-full">{confirm}</div>;
  return (
    <div className="flex shrink-0 flex-wrap gap-1 sm:ms-auto">
      <Button kind="quiet" onClick={onEdit} aria-label={`עריכה: ${name}`}>
        עריכה
      </Button>
      <Button kind="danger" ref={focus.ref(focusKey)} onClick={onDelete} aria-label={`מחיקה: ${name}`}>
        מחיקה
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ המכינות

function Cohorts({ ctx }: { ctx: RotaCtx }) {
  const { port, week, data, busy, act, mayWrite } = ctx;
  const focus = useFocusBack();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const cohorts = cohortsInOrder(data);
  const groupsOf = (c: RotaCohort) => data.groups.filter((g) => g.cohort_id === c.id).length;
  return (
    <Part title="המכינות" aside={cohorts.length || undefined}>
      {cohorts.length === 0 && <p className="text-sm text-ink-soft">עוד אין מכינות. לכל מכינה אות משלה (למשל א, ב, נ): ממנה מתחילים הקודים של הקבוצות שלה.</p>}
      <ul aria-label="המכינות" className="divide-y divide-sage/60">
        {cohorts.map((c) =>
          editing === c.id ? (
            <li key={c.id} className="py-2">
              <CohortForm
                title={`עריכת המכינה: ${c.name}`}
                initial={c}
                busy={busy === `cohort-${c.id}`}
                onCancel={() => setEditing(null)}
                onSave={async (v, refused) => {
                  if (await act(`cohort-${c.id}`, () => port.rota.updateCohort(c.id, v), "המכינה נשמרה", refused)) setEditing(null);
                }}
              />
            </li>
          ) : (
            <li key={c.id} data-rota-cohort={c.letter} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <div className="min-w-0 flex-1 basis-48">
                <p className="font-bold text-navy">
                  <bdi>{c.letter}</bdi> · {c.name}
                </p>
                <p className="text-sm text-ink-soft">
                  {groupsOf(c) === 1 ? "קבוצה אחת" : `${groupsOf(c)} קבוצות`} ·{" "}
                  {c.diets.length === 0 ? "בלי דיאטות" : `דיאטות: ${c.diets.map((d) => `${d.label} ${d.count}`).join(", ")}`}
                </p>
              </div>
              {mayWrite && (
                <LineActions
                  name={c.name}
                  focus={focus}
                  focusKey={`delete-${c.id}`}
                  deleting={deleting === c.id}
                  onEdit={() => setEditing(c.id)}
                  onDelete={() => {
                    setProblem(null);
                    setDeleting(c.id);
                  }}
                  confirm={
                    <Confirm
                      text={
                        <>
                          למחוק את המכינה <b>{c.name}</b>? {groupsOf(c) > 0 ? "יש לה קבוצות: קודם מוחקים אותן." : "גם מתי היא בקמפוס יימחק."}
                        </>
                      }
                      confirm="מחיקה"
                      busy={busy === `delete-cohort-${c.id}`}
                      onConfirm={() =>
                        void act(`delete-cohort-${c.id}`, () => port.rota.deleteCohort(c.id), "המכינה נמחקה", formRefusal(setProblem, { in_use: "יש למכינה הזו קבוצות, ולכן אי אפשר למחוק אותה. קודם מוחקים את הקבוצות שלה." })).then((ok) => {
                          setDeleting(null);
                          if (!ok) focus.back(`delete-${c.id}`);
                        })
                      }
                      onCancel={() => {
                        setDeleting(null);
                        focus.back(`delete-${c.id}`);
                      }}
                    />
                  }
                />
              )}
            </li>
          ),
        )}
      </ul>
      <Problem>{problem}</Problem>
      {mayWrite &&
        (editing === "new" ? (
          <CohortForm
            title="מכינה חדשה"
            busy={busy === "cohort-new"}
            onCancel={() => setEditing(null)}
            onSave={async (v, refused) => {
              const sort = cohorts.reduce((m, c) => Math.max(m, c.sort), 0) + 1;
              if (await act("cohort-new", () => port.rota.addCohort(week.edition.id, { ...v, sort }), "המכינה נוספה", refused)) setEditing(null);
            }}
          />
        ) : (
          <Button onClick={() => setEditing("new")}>+ מכינה</Button>
        ))}
    </Part>
  );
}

type Refused = (code: string | null) => boolean;

function CohortForm({ title, initial, busy, onSave, onCancel }: { title: string; initial?: RotaCohort; busy: boolean; onSave: (v: { letter: string; name: string; diets: Diet[] }, refused: Refused) => Promise<void>; onCancel: () => void }) {
  const id = useId();
  const [letter, setLetter] = useState(initial?.letter ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [diets, setDiets] = useState<{ label: string; count: string }[]>(initial?.diets.map((d) => ({ label: d.label, count: String(d.count) })) ?? []);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    if (!letter.trim()) return setProblem("צריך אות למכינה (למשל א, ב, נ).");
    const list = diets.filter((d) => d.label.trim() || d.count.trim()).map((d) => ({ label: d.label, count: intOrNull(d.count) ?? Number.NaN }));
    void onSave(
      { letter, name, diets: list },
      formRefusal(setProblem, { bad_value: "אחד הערכים לא תקין: אות בלי ספרות ורווחים, ולכל דיאטה שם ומספר שלם (עד 1000).", name_required: "צריך שם למכינה." }),
    );
  };
  return (
    <form aria-label={title} onSubmit={submit} className="space-y-3 rounded-lg bg-sand-soft p-3">
      <p className="font-bold text-navy">{title}</p>
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <Field id={`${id}-letter`} label="אות" hint="עד 3 אותיות, בלי ספרות">
          <input id={`${id}-letter`} value={letter} onChange={(e) => setLetter(e.target.value)} maxLength={3} className={INPUT} />
        </Field>
        <Field id={`${id}-name`} label="שם המכינה">
          <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={INPUT} />
        </Field>
      </div>
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-1 text-sm font-bold text-ink">דיאטות (לכמויות האוכל)</legend>
        {diets.length === 0 && <p className="text-xs text-ink-soft">בלי דיאטות. את השמות כותבים ביד, למשל «צמחוני».</p>}
        {diets.map((d, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input aria-label={`דיאטה ${i + 1}`} value={d.label} onChange={(e) => setDiets(diets.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} maxLength={40} className={`${INPUT} min-w-0 flex-1 basis-36`} />
            <input
              aria-label={`כמה אנשים: דיאטה ${i + 1}`}
              inputMode="numeric"
              value={d.count}
              onChange={(e) => setDiets(diets.map((x, j) => (j === i ? { ...x, count: e.target.value } : x)))}
              className={`${INPUT} w-20 shrink-0`}
            />
            <Button kind="quiet" onClick={() => setDiets(diets.filter((_, j) => j !== i))} aria-label={`הסרת דיאטה ${i + 1}`}>
              הסרה
            </Button>
          </div>
        ))}
        {diets.length < 6 && (
          <Button kind="quiet" onClick={() => setDiets([...diets, { label: "", count: "" }])}>
            + דיאטה
          </Button>
        )}
      </fieldset>
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

// ------------------------------------------------------------------ מתי בקמפוס

function Presence({ ctx }: { ctx: RotaCtx }) {
  const { port, week, data, busy, act, mayWrite } = ctx;
  const e = week.edition;
  const labels = rotaShiftsOf(e).labels;
  const cohorts = cohortsInOrder(data);
  const marked = (c: number, d: number, s: number) => data.presence.some((p) => p.cohort_id === c && p.day === d && p.shift === s);
  const set = (c: RotaCohort, scope: PresenceScope, present: boolean, key: string) =>
    void act(key, () => port.rota.setPresence(e.id, c.id, scope, present), null);
  return (
    <Part title="מתי בקמפוס">
      <p className="text-sm text-ink-soft">משמרת שלא סומנה — המכינה לא בקמפוס בה: ההצעה לא משבצת שם את הקבוצות שלה, ושיבוץ ביד מקבל אזהרה.</p>
      {cohorts.length === 0 && <p className="text-sm text-ink-soft">קודם מוסיפים מכינה.</p>}
      <div className="grid gap-x-6 gap-y-4 lg:grid-cols-2 xl:grid-cols-3">
      {cohorts.map((c) => {
        const slots = ROTA_DAYS.flatMap((d) => SHIFTS.filter((s) => rotaShiftActive(e, d, s)).map((s) => [d, s] as const));
        const all = slots.length > 0 && slots.every(([d, s]) => marked(c.id, d, s));
        const count = slots.filter(([d, s]) => marked(c.id, d, s)).length;
        return (
          <div key={c.id} data-presence={c.letter} className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h4 className="font-bold text-navy">{c.name}</h4>
              <span className="text-sm text-ink-soft">
                {count} מתוך {slots.length} משמרות
              </span>
              {mayWrite && (
                <Button kind="secondary" className="ms-auto text-sm aria-pressed:bg-accent-soft" aria-pressed={all} busy={busy === `week-${c.id}`} onClick={() => set(c, {}, !all, `week-${c.id}`)} aria-label={`כל השבוע: ${c.name}`}>
                  כל השבוע
                </Button>
              )}
            </div>
            <table aria-label={`מתי ${c.name} בקמפוס`} className="w-full table-fixed border-collapse text-sm">
              <thead>
                <tr className={TABLE_HEAD}>
                  <th scope="col" className={`${TABLE_TH} w-16 px-1.5 py-1`}>
                    יום
                  </th>
                  {SHIFTS.map((s) => (
                    <th key={s} scope="col" className={`${TABLE_TH} px-1 py-1 text-center text-xs break-words`}>
                      {labels[s]}
                    </th>
                  ))}
                  {mayWrite && (
                    <th scope="col" className="w-[4.75rem] px-1 py-1">
                      <span className="sr-only">כל היום</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {ROTA_DAYS.map((d) => {
                  const of = SHIFTS.filter((s) => rotaShiftActive(e, d, s));
                  const day = of.length > 0 && of.every((s) => marked(c.id, d, s));
                  return (
                    <tr key={d} className={TABLE_ROW}>
                      <th scope="row" className={`${TABLE_TH} px-1.5 py-0.5 text-navy`}>
                        {DAY_NAMES[d]}
                      </th>
                      {SHIFTS.map((s) => (
                        <td key={s} className="px-1 py-0.5 text-center">
                          {rotaShiftActive(e, d, s) ? (
                            <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                              <input
                                type="checkbox"
                                className="size-5 accent-navy"
                                checked={marked(c.id, d, s)}
                                disabled={!mayWrite}
                                onChange={(ev) => set(c, { day: d, shift: s }, ev.target.checked, `presence-${c.id}-${d}-${s}`)}
                                aria-label={`${c.name} · ${DAY_NAMES[d]} · ${labels[s]}`}
                              />
                            </label>
                          ) : (
                            <span className="text-xs text-ink-faint" title="לא חלק מהשבוע">
                              —
                            </span>
                          )}
                        </td>
                      ))}
                      {mayWrite && (
                        <td className="px-0.5 py-0.5">
                          {of.length > 0 && (
                            <Button kind="quiet" className="w-full px-1 text-xs sm:px-1 aria-pressed:bg-accent-soft" aria-pressed={day} busy={busy === `day-${c.id}-${d}`} onClick={() => set(c, { day: d }, !day, `day-${c.id}-${d}`)} aria-label={`כל היום: ${DAY_NAMES[d]} · ${c.name}`}>
                              כל היום
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      </div>
    </Part>
  );
}

// ------------------------------------------------------------------ הקבוצות

function Groups({ ctx }: { ctx: RotaCtx }) {
  const { port, week, data, busy, act, mayWrite, phonesAllowed } = ctx;
  const heads = useHeadPhones(port, week.edition.id, phonesAllowed);
  const focus = useFocusBack();
  const cohorts = cohortsInOrder(data);
  const groups = groupsInOrder(data);
  const [editing, setEditing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [cohort, setCohort] = useState<number | null>(null);
  const [added, setAdded] = useState(0);
  const chosen = cohorts.find((c) => c.id === cohort) ?? cohorts[0] ?? null;
  const phones = heads.phones; // only while «כולל טלפונים» is on, here, and answered
  return (
    <Part title="הקבוצות" aside={groups.length || undefined}>
      <HeadPhonesToggle allowed={phonesAllowed} on={heads.on} setOn={heads.setOn} failed={heads.failed} />
      {phonesAllowed && !heads.on && mayWrite && <p className="text-xs text-ink-soft">כדי להוסיף או לשנות טלפון של ראש/ת קבוצה, מסמנים «כולל טלפונים של ראשי הקבוצות».</p>}
      {cohorts.length === 0 && <p className="text-sm text-ink-soft">קודם מוסיפים מכינה: הקוד של קבוצה הוא האות של המכינה והמספר שלה (א1, א2…).</p>}
      {cohorts.map((c) => {
        const mine = groups.filter((g) => g.cohort_id === c.id);
        if (mine.length === 0) return null;
        return (
          <div key={c.id} className="min-w-0">
            <h4 className="font-bold text-navy">{c.name}</h4>
            <ul aria-label={`הקבוצות של ${c.name}`} className="divide-y divide-sage/60">
              {mine.map((g) => {
                const code = groupCode(c.letter, g.number);
                if (editing === g.id) {
                  return (
                    <li key={g.id} className="py-2">
                      <GroupForm
                        title={`עריכת הקבוצה ${code}`}
                        initial={g}
                        phone={phones ? (phones.get(g.id) ?? "") : null}
                        busy={busy === `group-${g.id}`}
                        onCancel={() => setEditing(null)}
                        onSave={async (v, phone, refused) => {
                          const before = phones?.get(g.id) ?? "";
                          const changed = phone != null && phone.trim() !== before;
                          const ok = await act(
                            `group-${g.id}`,
                            async () => {
                              const p = changed ? cleanHeadPhone(phone) : undefined; // a bad phone refused before anything is written
                              await port.rota.updateGroup(g.id, v);
                              if (changed) await port.rota.setContact(g.id, p ?? null);
                            },
                            "הקבוצה נשמרה",
                            refused,
                          );
                          if (changed) heads.reload();
                          if (ok) setEditing(null);
                        }}
                      />
                    </li>
                  );
                }
                return (
                  <li key={g.id} data-rota-group={code} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <div className="flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-x-2 gap-y-0.5">
                      <GroupChip code={code} />
                      <span className="text-sm">{g.size == null ? "גודל: TBD" : `${g.size} חניכים`}</span>
                      <span className="min-w-0 text-sm break-words text-ink-soft">{g.head_name ? `ראש/ת קבוצה: ${g.head_name}` : "אין עדיין ראש/ת קבוצה"}</span>
                      {phones && (
                        <span data-head-phone className="text-sm text-ink-soft">
                          טלפון: <bdi>{phones.get(g.id) ?? "—"}</bdi>
                        </span>
                      )}
                    </div>
                    {mayWrite && (
                      <LineActions
                        name={code}
                        focus={focus}
                        focusKey={`delete-${g.id}`}
                        deleting={deleting === g.id}
                        onEdit={() => setEditing(g.id)}
                        onDelete={() => setDeleting(g.id)}
                        confirm={
                          <Confirm
                            text={
                              <>
                                למחוק את הקבוצה <b>{code}</b>? גם השיבוצים שלה והטלפון של ראש/ת הקבוצה יימחקו; משימות מוצ״ש שלה נשארות בלי קבוצה.
                              </>
                            }
                            confirm="מחיקה"
                            busy={busy === `delete-group-${g.id}`}
                            onConfirm={() =>
                              void act(`delete-group-${g.id}`, () => port.rota.deleteGroup(g.id), `הקבוצה ${code} נמחקה`).then((ok) => {
                                setDeleting(null);
                                if (!ok) focus.back(`delete-${g.id}`);
                              })
                            }
                            onCancel={() => {
                              setDeleting(null);
                              focus.back(`delete-${g.id}`);
                            }}
                          />
                        }
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {mayWrite && chosen && (
        <NewGroup
          key={`${chosen.id}:${added}`}
          cohorts={cohorts}
          cohort={chosen}
          next={data.groups.filter((g) => g.cohort_id === chosen.id).reduce((m, g) => Math.max(m, g.number), 0) + 1}
          onCohort={setCohort}
          busy={busy === "group-new"}
          onSave={async (v, refused) => {
            if (await act("group-new", () => port.rota.addGroup(week.edition.id, { cohort_id: chosen.id, ...v }), `הקבוצה ${groupCode(chosen.letter, v.number)} נוספה`, refused)) setAdded((n) => n + 1);
          }}
        />
      )}
    </Part>
  );
}

type GroupValues = { number: number; size: number | null; head_name: string | null };

const GROUP_WORDS = {
  bad_value: "אחד הערכים לא תקין: מספר קבוצה בין 1 ל-99, וגודל מספר שלם עד 200 (או ריק, אם עוד לא ידוע).",
  name_required: "צריך מספר לקבוצה.",
};

function GroupFields({ id, number, setNumber, size, setSize, head, setHead }: { id: string; number: string; setNumber: (v: string) => void; size: string; setSize: (v: string) => void; head: string; setHead: (v: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[7rem_7rem_1fr]">
      <Field id={`${id}-number`} label="מספר">
        <input id={`${id}-number`} inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} className={INPUT} />
      </Field>
      <Field id={`${id}-size`} label="גודל" hint="ריק = עוד לא ידוע">
        <input id={`${id}-size`} inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value)} className={INPUT} />
      </Field>
      <Field id={`${id}-head`} label="ראש/ת הקבוצה (לא חובה)">
        <input id={`${id}-head`} value={head} onChange={(e) => setHead(e.target.value)} maxLength={80} className={INPUT} />
      </Field>
    </div>
  );
}

const groupValues = (number: string, size: string, head: string): GroupValues => ({ number: intOrNull(number) ?? Number.NaN, size: intOrNull(size), head_name: head });

function GroupForm({ title, initial, phone: phone0, busy, onSave, onCancel }: {
  title: string;
  initial: RotaGroup;
  /** The head's phone as loaded; null — not shown (the switch off, or not allowed): no field at all. */
  phone: string | null;
  busy: boolean;
  onSave: (v: GroupValues, phone: string | null, refused: Refused) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [number, setNumber] = useState(String(initial.number));
  const [size, setSize] = useState(initial.size == null ? "" : String(initial.size));
  const [head, setHead] = useState(initial.head_name ?? "");
  const [phone, setPhone] = useState(phone0 ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    void onSave(groupValues(number, size, head), phone0 == null ? null : phone, formRefusal(setProblem, GROUP_WORDS));
  };
  return (
    <form aria-label={title} onSubmit={submit} className="space-y-3 rounded-lg bg-sand-soft p-3">
      <p className="font-bold text-navy">{title}</p>
      <GroupFields id={id} number={number} setNumber={setNumber} size={size} setSize={setSize} head={head} setHead={setHead} />
      {phone0 != null && (
        <div className="sm:max-w-sm">
          <Field id={`${id}-phone`} label="הטלפון של ראש/ת הקבוצה" hint="מידע אישי: נשמר רק במסד, ורואים אותו רק הלוגיסטיקה והמדריך/ה. ריק — נמחק.">
            <input id={`${id}-phone`} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} className={INPUT} />
          </Field>
        </div>
      )}
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

function NewGroup({ cohorts, cohort, next, onCohort, busy, onSave }: { cohorts: RotaCohort[]; cohort: RotaCohort; next: number; onCohort: (id: number) => void; busy: boolean; onSave: (v: GroupValues, refused: Refused) => Promise<void> }) {
  const id = useId();
  const [number, setNumber] = useState(String(next));
  const [size, setSize] = useState("");
  const [head, setHead] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    void onSave(groupValues(number, size, head), formRefusal(setProblem, GROUP_WORDS));
  };
  return (
    <form aria-label="קבוצה חדשה" onSubmit={submit} className="space-y-3 rounded-lg border border-line p-3">
      <p className="font-bold text-navy">קבוצה חדשה</p>
      <Field id={`${id}-cohort`} label="מכינה">
        <select id={`${id}-cohort`} value={cohort.id} onChange={(e) => onCohort(Number(e.target.value))} className={INPUT}>
          {cohorts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.letter} · {c.name}
            </option>
          ))}
        </select>
      </Field>
      <GroupFields id={id} number={number} setNumber={setNumber} size={size} setSize={setSize} head={head} setHead={setHead} />
      <Problem>{problem}</Problem>
      <Button kind="primary" type="submit" busy={busy}>
        הוספת הקבוצה
      </Button>
    </form>
  );
}

// ------------------------------------------------------------------ התורנויות

const NEEDS = ["need_morning", "need_afternoon", "need_night"] as const;

function needsText(d: RotaDuty, labels: readonly string[]): string {
  return NEEDS.map((k, i) => `${labels[i]}: ${d[k] == null ? "לא נקבע" : d[k]}`).join(" · ");
}

function Duties({ ctx }: { ctx: RotaCtx }) {
  const { port, week, data, busy, act, mayWrite } = ctx;
  const focus = useFocusBack();
  const labels = rotaShiftsOf(week.edition).labels;
  const duties = dutiesInOrder(data);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const lastYear = () =>
    void act(
      "last-year",
      async () => {
        for (const d of LAST_YEAR_DUTIES) await port.rota.addDuty(week.edition.id, d);
      },
      "התורנויות של אשתקד נוספו. כמה קבוצות צריך בכל משמרת — הצעה, אפשר לשנות.",
    );
  return (
    <Part title="התורנויות" aside={duties.length || undefined}>
      {duties.length === 0 && (
        <div data-last-year className="space-y-2 rounded-lg bg-sand-soft p-3 text-sm">
          <p>
            עוד אין תורנויות. אפשר להתחיל מארבע התורנויות של אשתקד — {LAST_YEAR_DUTIES.map((d) => d.name).join(", ")} — עם התיאורים של המדריך/ה. כמה קבוצות בכל משמרת, כמו בגיליון של אשתקד: בית מדרש 4, וכל אחת מהשאר
            1, גם בלילה. <Badge tone="accent">הצעה</Badge>
          </p>
          {mayWrite && (
            <Button kind="primary" busy={busy === "last-year"} busyLabel="מוסיף…" onClick={lastYear}>
              התורנויות של אשתקד
            </Button>
          )}
        </div>
      )}
      <ul aria-label="התורנויות" className="divide-y divide-sage/60">
        {duties.map((d) =>
          editing === d.id ? (
            <li key={d.id} className="py-2">
              <DutyForm
                title={`עריכת התורנות: ${d.name}`}
                initial={d}
                labels={labels}
                busy={busy === `duty-${d.id}`}
                onCancel={() => setEditing(null)}
                onSave={async (v, refused) => {
                  if (await act(`duty-${d.id}`, () => port.rota.updateDuty(d.id, v), "התורנות נשמרה", refused)) setEditing(null);
                }}
              />
            </li>
          ) : (
            <li key={d.id} data-rota-duty={d.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <div className="min-w-0 flex-1 basis-56">
                <p className="font-bold text-navy">{d.name}</p>
                {d.description && <p className="text-sm break-words whitespace-pre-line">{d.description}</p>}
                <p className="text-sm text-ink-soft">
                  כמה קבוצות: {needsText(d, labels)}
                  {d.min_people != null ? ` · לפחות ${d.min_people} אנשים` : ""}
                </p>
              </div>
              {mayWrite && (
                <LineActions
                  name={d.name}
                  focus={focus}
                  focusKey={`delete-${d.id}`}
                  deleting={deleting === d.id}
                  onEdit={() => setEditing(d.id)}
                  onDelete={() => setDeleting(d.id)}
                  confirm={
                    <Confirm
                      text={
                        <>
                          למחוק את התורנות <b>{d.name}</b>? גם כל השיבוצים שלה יימחקו.
                        </>
                      }
                      confirm="מחיקה"
                      busy={busy === `delete-duty-${d.id}`}
                      onConfirm={() =>
                        void act(`delete-duty-${d.id}`, () => port.rota.deleteDuty(d.id), "התורנות נמחקה").then((ok) => {
                          setDeleting(null);
                          if (!ok) focus.back(`delete-${d.id}`);
                        })
                      }
                      onCancel={() => {
                        setDeleting(null);
                        focus.back(`delete-${d.id}`);
                      }}
                    />
                  }
                />
              )}
            </li>
          ),
        )}
      </ul>
      {mayWrite &&
        (editing === "new" ? (
          <DutyForm
            title="תורנות חדשה"
            labels={labels}
            sort={duties.reduce((m, d) => Math.max(m, d.sort), 0) + 1}
            busy={busy === "duty-new"}
            onCancel={() => setEditing(null)}
            onSave={async (v, refused) => {
              if (await act("duty-new", () => port.rota.addDuty(week.edition.id, v as NewDuty), "התורנות נוספה", refused)) setEditing(null);
            }}
          />
        ) : (
          <Button onClick={() => setEditing("new")}>+ תורנות</Button>
        ))}
    </Part>
  );
}

function DutyForm({ title, initial, sort: sort0, labels, busy, onSave, onCancel }: {
  title: string;
  initial?: RotaDuty;
  sort?: number;
  labels: readonly string[];
  busy: boolean;
  onSave: (v: Omit<RotaDuty, "id" | "edition_id">, refused: Refused) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [needs, setNeeds] = useState<[string, string, string]>(() => NEEDS.map((k) => (initial?.[k] == null ? "" : String(initial[k]))) as [string, string, string]);
  const [min, setMin] = useState(initial?.min_people == null ? "" : String(initial.min_people));
  const [sort, setSort] = useState(String(initial?.sort ?? sort0 ?? 0));
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    void onSave(
      {
        name,
        description,
        need_morning: intOrNull(needs[0]),
        need_afternoon: intOrNull(needs[1]),
        need_night: intOrNull(needs[2]),
        min_people: intOrNull(min),
        sort: intOrNull(sort) ?? 0,
      },
      formRefusal(setProblem, { bad_value: "אחד הערכים לא תקין: כמה קבוצות — מספר שלם עד 20 (או ריק), מינימום אנשים — 1 עד 500 (או ריק).", name_required: "צריך שם לתורנות." }),
    );
  };
  return (
    <form aria-label={title} onSubmit={submit} className="space-y-3 rounded-lg bg-sand-soft p-3">
      <p className="font-bold text-navy">{title}</p>
      <Field id={`${id}-name`} label="שם התורנות">
        <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={INPUT} />
      </Field>
      <Field id={`${id}-description`} label="מה עושים בה (לא חובה)">
        <textarea id={`${id}-description`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} className={`${INPUT} py-2`} />
      </Field>
      <fieldset className="min-w-0">
        <legend className="mb-1 text-sm font-bold text-ink">כמה קבוצות צריך בכל משמרת</legend>
        <div className="grid grid-cols-3 gap-2">
          {SHIFTS.map((s) => (
            <Field key={s} id={`${id}-need-${s}`} label={labels[s]}>
              <input
                id={`${id}-need-${s}`}
                inputMode="numeric"
                value={needs[s]}
                onChange={(e) => setNeeds(needs.map((x, j) => (j === s ? e.target.value : x)) as [string, string, string])}
                className={INPUT}
              />
            </Field>
          ))}
        </div>
        <p className="mt-1 text-xs text-ink-soft">ריק = עוד לא נקבע: ההצעה לא ממלאת את המשמרת הזו, ובלוח יש על זה אזהרה.</p>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-min`} label="מינימום אנשים (לא חובה)" hint="כשיש מינימום, ההצעה מוסיפה עוד קבוצות עד שמגיעים אליו (עד 2 נוספות).">
          <input id={`${id}-min`} inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} className={INPUT} />
        </Field>
        <Field id={`${id}-sort`} label="סדר">
          <input id={`${id}-sort`} inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} className={INPUT} />
        </Field>
      </div>
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

// ------------------------------------------------------------------ שעות המשמרות

function Shifts({ ctx }: { ctx: RotaCtx }) {
  const { port, week, busy, act, isAdmin, reloadWeek } = ctx;
  const e = week.edition;
  const current = rotaShiftsOf(e);
  const own = e.settings?.rota_shifts != null;
  const id = useId();
  const [labels, setLabels] = useState<[string, string, string]>([...current.labels]);
  const [cuts, setCuts] = useState<[string, string]>([fmt(current.cuts[0]), fmt(current.cuts[1])]);
  const [problem, setProblem] = useState<string | null>(null);
  const summary = SHIFTS.map((s) => shiftText(e, s)).join(" · ");
  const save = (ev: FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    const [a, b] = cuts.map(parseClock);
    if (a == null || b == null) return setProblem("שעה בפורמט HH:MM, למשל 14:30.");
    void act(
      "shifts",
      async () => {
        await port.rota.setShifts(e.id, { cuts: [a, b], labels });
        await reloadWeek();
      },
      "שעות המשמרות נשמרו",
      formRefusal(setProblem, { bad_value: "נקודות המעבר צריכות להיות בסדר: הבוקר מתחיל ב-06:30, אחר הצהריים אחריו, הלילה אחרי שניהם ועד 06:30 למחרת — בקפיצות של 5 דקות.", name_required: "לכל משמרת צריך שם." }),
    );
  };
  const reset = () =>
    void act(
      "shifts-reset",
      async () => {
        await port.rota.setShifts(e.id, null);
        await reloadWeek();
      },
      "חזרנו לשעות של אשתקד",
    ).then((ok) => {
      if (ok) {
        setLabels([...DEFAULT_ROTA_SHIFTS.labels]);
        setCuts([fmt(DEFAULT_ROTA_SHIFTS.cuts[0]), fmt(DEFAULT_ROTA_SHIFTS.cuts[1])]);
      }
    });
  return (
    <section aria-label="שעות המשמרות" className={`${CARD} sm:px-4`}>
      <Fold title="שעות המשמרות" hint={summary}>
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">
            {own ? "השעות שנקבעו למחזור הזה." : "השעות של אשתקד."} ביום ראשון המשמרת מתחילה בפתיחת השבוע, וביום חמישי נגמרת בסיום שלו. שיבוץ נשאר במשמרת שלו (בוקר, אחר צהריים או לילה) גם כששעות
            משתנות; שיבוץ על משמרת שהשבוע כבר לא כולל מקבל אזהרה בלוח, ולא נמחק.
          </p>
          {isAdmin ? (
            <form aria-label="עריכת שעות המשמרות" onSubmit={save} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                {SHIFTS.map((s) => (
                  <Field key={s} id={`${id}-label-${s}`} label={`שם משמרת ${s + 1}`}>
                    <input id={`${id}-label-${s}`} value={labels[s]} onChange={(ev) => setLabels(labels.map((x, j) => (j === s ? ev.target.value : x)) as [string, string, string])} maxLength={20} className={INPUT} />
                  </Field>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id={`${id}-cut-0`} label="מעבר ממשמרת 1 ל-2">
                  <input id={`${id}-cut-0`} dir="ltr" inputMode="numeric" placeholder="14:30" value={cuts[0]} onChange={(ev) => setCuts([ev.target.value, cuts[1]])} className={INPUT} />
                </Field>
                <Field id={`${id}-cut-1`} label="מעבר ממשמרת 2 ל-3">
                  <input id={`${id}-cut-1`} dir="ltr" inputMode="numeric" placeholder="22:30" value={cuts[1]} onChange={(ev) => setCuts([cuts[0], ev.target.value])} className={INPUT} />
                </Field>
              </div>
              <Problem>{problem}</Problem>
              <div className="flex flex-wrap gap-2">
                <Button kind="primary" type="submit" busy={busy === "shifts"}>
                  שמירת השעות
                </Button>
                {own && (
                  <Button busy={busy === "shifts-reset"} onClick={reset}>
                    חזרה לשעות של אשתקד
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <p className="text-sm">את השעות והשמות של המשמרות קובע/ת המדריך/ה של המחזור.</p>
          )}
        </div>
      </Fold>
    </section>
  );
}
