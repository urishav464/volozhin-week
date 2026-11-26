// «קבוצות ומכינות» — what the board is made of: the cohorts on campus (a letter that starts its groups' codes, a name,
// v20's trainees and three diet numbers — «מהם גם וגם» how many are both, checked here in the guard's words —, the staff
// contact's name and, for those who may see it, its phone — read when the form opens and kept in the form alone —, the
// duties it helps in — a new cohort every duty; none left while it has groups deletes them behind a Confirm —, and v19's
// «הצוות שלה יכול להסיע»), the meals they make («כמויות אוכל»: a day × meal, the cohorts on campus then — mealsTable),
// when each is on campus (cohort × day × shift; no mark = not marked, never assumed — «כל השבוע», «כל היום»), the groups
// (a helping cohort split in one call — «חלוקה לקבוצות», the sizes a «הצעה», «חלוקה מחדש» behind a Confirm naming what
// goes —, or one by one: the next number suggested, a size — TBD until known — and the head's name; the head's phone
// only behind «כולל טלפונים של ראשי הקבוצות», for those who may see it, saved through set_rota_contact alone), the
// duties in their order («למעלה» / «למטה»: the board's and the pages' order, and which fills first when groups are
// short) with how many groups each shift needs — empty is «not set», and the suggestion leaves it — and a minimum of
// people, last year's four when the list is empty («הצעה»), and the shifts' hours — the edition's admins'. A phone is
// personal data: no column, no line and no field for it but those.
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { CommandError } from "../../../data/commands";
import {
  cleanCohortFields, cleanCohortName, cleanHeadPhone, cleanLetter, isCohortContact, LAST_YEAR_DUTIES, type NewDuty, type PresenceScope, type RotaCohort, type RotaDuty, type RotaGroup,
} from "../../../data/rota";
import { nameKey } from "../../../domain/nameKey";
import { canDrive, cohortDutyIds, cohortHelps, DEFAULT_ROTA_SHIFTS, groupCode, ROTA_DAYS, rotaShiftActive, rotaShiftsOf, SHIFTS, splitSizes } from "../../../domain/rota";
import { DAY_NAMES, fmt, parseClock } from "../../../domain/time";
import { errorMessage } from "../../../errors";
import { cohortsInOrder, dutiesInOrder, groupsInOrder, mealsTable, shiftText } from "../../../exports/rota";
import { MEALS_HINT } from "../../outputs/rota/FoodSheet";
import { TableView } from "../../outputs/rota/TableView";
import { GroupChip, HeadPhonesToggle, useHeadPhones } from "../../rota/shared";
import { Badge, Button, Confirm, Field, Fold, INPUT, TABLE_HEAD, TABLE_ROW, TABLE_TH, useFocusBack } from "../../settings/kit";
import {
  cohortDutyNames, cohortNumbersText, dietSplitText, DUTY_ORDER_HINT, dutyHelpers, groupsLossText, newDutyTargets, sameIds, sizesAgainstTrainees, splitPreviewText, splitProblem,
} from "./cohorts";
import { CARD, formRefusal, intOrNull, Problem, type RotaCtx } from "./parts";
import { prepMoves } from "./prep";

export function Setup({ ctx }: { ctx: RotaCtx }) {
  return (
    <div className="space-y-4">
      <Cohorts ctx={ctx} />
      <Food ctx={ctx} />
      <Presence ctx={ctx} />
      <Groups ctx={ctx} />
      <Duties ctx={ctx} />
      <Shifts ctx={ctx} />
    </div>
  );
}

/** A part of the setup: its heading and a muted aside, a region by its name. */
function Part({ title, aside, children, ...rest }: { title: string; aside?: ReactNode; children: ReactNode } & Record<`data-${string}`, string>) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`${CARD} space-y-3 sm:p-4`} {...rest}>
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

/**
 * «עריכה» / «מחיקה» of a line (and, before them, `extra` — the duties' «למעלה» / «למטה»), the delete behind a Confirm
 * whose «ביטול» gives the button the focus back; the edit form stands in for the line, so its save and its «ביטול» give
 * «עריכה» the focus back (`editKey`).
 */
function LineActions({ name, deleting, onEdit, onDelete, confirm, focusKey, editKey, focus, extra }: {
  name: string;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  confirm: ReactNode;
  focusKey: string;
  editKey: string;
  focus: ReturnType<typeof useFocusBack>;
  extra?: ReactNode;
}) {
  if (deleting) return <div className="basis-full">{confirm}</div>;
  return (
    <div className="flex shrink-0 flex-wrap gap-1 sm:ms-auto">
      {extra}
      <Button kind="quiet" ref={focus.ref(editKey)} onClick={onEdit} aria-label={`עריכה: ${name}`}>
        עריכה
      </Button>
      <Button kind="danger" ref={focus.ref(focusKey)} onClick={onDelete} aria-label={`מחיקה: ${name}`}>
        מחיקה
      </Button>
    </div>
  );
}

type Refused = (code: string | null) => boolean;

/** A refusal a form says before anything is sent — the port's own cleaners, so the words are the guard's (null: none). */
function refusalOf(check: () => unknown): string | null {
  try {
    check();
    return null;
  } catch (e) {
    if (e instanceof CommandError) return e.code;
    throw e;
  }
}

// ------------------------------------------------------------------ המכינות

function Cohorts({ ctx }: { ctx: RotaCtx }) {
  const { port, week, data, busy, act, mayWrite, phonesAllowed } = ctx;
  const e = week.edition;
  const focus = useFocusBack();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const cohorts = cohortsInOrder(data);
  const groupsOf = (c: RotaCohort) => data.groups.filter((g) => g.cohort_id === c.id);
  const duties = dutiesInOrder(data);
  /** The contact's phone, asked when a form opens (only for those who may see it) — kept in that form alone. */
  const phoneOf = (cohortId: number) => async () => (await port.rota.contacts(e.id)).filter(isCohortContact).find((r) => r.cohort_id === cohortId)?.phone ?? null;
  return (
    <Part title="המכינות" aside={cohorts.length || undefined}>
      {cohorts.length === 0 && <p className="text-sm text-ink-soft">עוד אין מכינות. לכל מכינה אות משלה (למשל א, ב, נ): ממנה מתחילים הקודים של הקבוצות שלה.</p>}
      <ul aria-label="המכינות" className="divide-y divide-sage/60">
        {cohorts.map((c) => {
          const mine = groupsOf(c);
          if (editing === c.id) {
            return (
              <li key={c.id} className="py-2">
                <CohortForm
                  title={`עריכת המכינה: ${c.name}`}
                  initial={c}
                  busy={busy === `cohort-${c.id}`}
                  onCancel={() => {
                    setEditing(null);
                    focus.back(`edit-${c.id}`);
                  }}
                  duties={duties}
                  dutyIds={cohortDutyIds(data, c.id)}
                  loss={mine.length > 0 ? groupsLossText(data, c.id) : null}
                  phone={phonesAllowed ? phoneOf(c.id) : null}
                  onSave={async ({ duties: helps, ...v }, phone, drop, refused) => {
                    const save = async () => {
                      const p = phone === undefined ? undefined : cleanHeadPhone(phone); // a bad phone refused before anything is written
                      await port.rota.updateCohort(c.id, v);
                      // none left while it has groups: its groups go first (the Confirm said so), then the duties
                      if (drop) for (const g of mine) await port.rota.deleteGroup(g.id);
                      if (!sameIds(helps, cohortDutyIds(data, c.id))) await port.rota.setCohortDuties(e.id, c.id, helps);
                      if (p !== undefined) await port.rota.setContact({ cohort: c.id }, p);
                    };
                    const ok = drop ? `המכינה נשמרה, ו${mine.length === 1 ? "הקבוצה שלה נמחקה" : `-${mine.length} הקבוצות שלה נמחקו`}.` : "המכינה נשמרה";
                    if (!(await act(`cohort-${c.id}`, save, ok, refused))) return;
                    setEditing(null);
                    focus.back(`edit-${c.id}`);
                  }}
                />
              </li>
            );
          }
          const helpsIn = cohortDutyNames(data, c.id);
          return (
            <li
              key={c.id}
              data-rota-cohort={c.letter}
              data-helps-rota={cohortHelps(data, c.id) ? "y" : "-"}
              data-can-drive={canDrive(c) ? "y" : "-"}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
            >
              <div className="min-w-0 flex-1 basis-48 space-y-0.5">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-bold text-navy">
                  <span>
                    <bdi>{c.letter}</bdi> · {c.name}
                  </span>
                  {helpsIn.length === 0 && <Badge tone="muted">לא עוזרת בתורנויות</Badge>}
                  {canDrive(c) && <Badge tone="accent">הצוות יכול להסיע</Badge>}
                </p>
                <p data-cohort-numbers className="text-sm">
                  {cohortNumbersText(c)} · {mine.length === 1 ? "קבוצה אחת" : mine.length === 0 ? "בלי קבוצות" : `${mine.length} קבוצות`}
                </p>
                {helpsIn.length > 0 && (
                  <p data-cohort-duties className="text-sm text-ink-soft">
                    עוזרת ב: {helpsIn.join(", ")}
                  </p>
                )}
                <p className="text-sm text-ink-soft">{c.contact_name ? `איש/אשת קשר: ${c.contact_name}` : "איש/אשת קשר מהצוות: עוד לא נקבע/ה"}</p>
              </div>
              {mayWrite && (
                <LineActions
                  name={c.name}
                  focus={focus}
                  focusKey={`delete-${c.id}`}
                  editKey={`edit-${c.id}`}
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
                          למחוק את המכינה <b>{c.name}</b>? {mine.length > 0 ? "יש לה קבוצות: קודם מוחקים אותן." : "גם מתי היא בקמפוס, באילו תורנויות היא עוזרת והטלפון של איש/אשת הקשר יימחקו."}
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
          );
        })}
      </ul>
      <Problem>{problem}</Problem>
      {mayWrite &&
        (editing === "new" ? (
          <CohortForm
            title="מכינה חדשה"
            busy={busy === "cohort-new"}
            duties={duties}
            dutyIds={duties.map((d) => d.id)}
            loss={null}
            phone={phonesAllowed ? async () => null : null}
            onCancel={() => {
              setEditing(null);
              focus.back("new");
            }}
            onSave={async ({ duties: helps, ...v }, phone, _drop, refused) => {
              const sort = cohorts.reduce((m, c) => Math.max(m, c.sort), 0) + 1;
              const save = async () => {
                const p = phone === undefined ? undefined : cleanHeadPhone(phone);
                const id = await port.rota.addCohort(e.id, { ...v, sort });
                if (helps.length > 0) await port.rota.setCohortDuties(e.id, id, helps);
                if (p != null) await port.rota.setContact({ cohort: id }, p);
              };
              if (!(await act("cohort-new", save, "המכינה נוספה", refused))) return;
              setEditing(null);
              focus.back("new");
            }}
          />
        ) : (
          <Button ref={focus.ref("new")} onClick={() => setEditing("new")}>
            + מכינה
          </Button>
        ))}
    </Part>
  );
}

/** What the cohort form saves (v20): its fields, the four numbers (null = TBD), the contact's name, and the duties it helps in. */
interface CohortValues {
  letter: string;
  name: string;
  trainees: number | null;
  diet_veg: number | null;
  diet_gf: number | null;
  diet_both: number | null;
  contact_name: string | null;
  can_drive: boolean;
  duties: number[];
}

const COHORT_WORDS = {
  bad_value: "אחד הערכים לא תקין: אות בלי ספרות ורווחים, ומספרים שלמים מ-0 עד 1000 (או ריק, אם עוד לא ידוע).",
  name_required: "צריך שם למכינה.",
  in_use: "יש למכינה קבוצות, ולכן היא צריכה לעזור בתורנות אחת לפחות. קודם מוחקים את הקבוצות שלה.",
};

function CohortForm({ title, initial, busy, duties, dutyIds, loss, phone: loadPhone, onSave, onCancel }: {
  title: string;
  initial?: RotaCohort;
  busy: boolean;
  duties: readonly RotaDuty[];
  /** The duties ticked to begin with: the cohort's own; a new cohort's every duty. */
  dutyIds: readonly number[];
  /** What deleting its groups takes with it (groupsLossText); null — it has none. */
  loss: string | null;
  /** Reads the contact's phone (null: none saved) — only for those who may see it; null: no phone field at all. */
  phone: (() => Promise<string | null>) | null;
  /**
   * `phone`: undefined — not changed (or no field); else what to save («» deletes). `drop`: its groups are deleted first
   * (the Confirm said so) — no duty left while it had groups.
   */
  onSave: (v: CohortValues, phone: string | undefined, drop: boolean, refused: Refused) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const focus = useFocusBack();
  const [letter, setLetter] = useState(initial?.letter ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [drives, setDrives] = useState(initial ? canDrive(initial) : false);
  const text = (n: number | null | undefined) => (n == null ? "" : String(n));
  const [counts, setCounts] = useState({
    trainees: text(initial?.trainees), diet_veg: text(initial?.diet_veg), diet_gf: text(initial?.diet_gf), diet_both: text(initial?.diet_both),
  });
  const [contact, setContact] = useState(initial?.contact_name ?? "");
  const [helpsIn, setHelpsIn] = useState<number[]>([...dutyIds]);
  const [problem, setProblem] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  // the contact's phone: read once, when the form opens; it lives in this form alone (never in the page's state)
  const [load] = useState(() => loadPhone);
  const [phone, setPhone] = useState("");
  /** The phone as read: undefined while it is read; null — none saved. */
  const [base, setBase] = useState<string | null | undefined>(undefined);
  const [phoneFailed, setPhoneFailed] = useState(false);
  useEffect(() => {
    if (!load) return;
    let live = true;
    load().then(
      (p) => {
        if (!live) return;
        setBase(p);
        setPhone(p ?? "");
      },
      () => live && setPhoneFailed(true),
    );
    return () => {
      live = false;
    };
  }, [load]);
  const phoneReady = load != null && base !== undefined && !phoneFailed;

  const values = (): CohortValues => ({
    letter, name, trainees: intOrNull(counts.trainees), diet_veg: intOrNull(counts.diet_veg), diet_gf: intOrNull(counts.diet_gf), diet_both: intOrNull(counts.diet_both),
    contact_name: contact.trim() || null, can_drive: drives, duties: duties.map((d) => d.id).filter((d) => helpsIn.includes(d)),
  });
  const changedPhone = (): string | undefined => (phoneReady && phone.trim() !== (base ?? "") ? phone : undefined);
  const refused = formRefusal(setProblem, COHORT_WORDS);
  const send = (drop: boolean) => void onSave(values(), changedPhone(), drop, refused);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    if (!letter.trim()) return setProblem("צריך אות למכינה (למשל א, ב, נ).");
    const v = values();
    const p = changedPhone();
    // the guard's rules, said before anything is written — the four numbers between them in its own words
    const code = refusalOf(() => {
      cleanLetter(v.letter);
      cleanCohortName(v.name);
      cleanCohortFields(v);
      if (p !== undefined) cleanHeadPhone(p);
    });
    if (code != null) return void (refused(code) || setProblem(errorMessage(code)));
    if (loss && v.duties.length === 0) return setDropping(true);
    send(false);
  };
  const live = dietSplitText({ trainees: intOrNull(counts.trainees), diet_veg: intOrNull(counts.diet_veg), diet_gf: intOrNull(counts.diet_gf), diet_both: intOrNull(counts.diet_both) });
  const numberField = (key: keyof typeof counts, label: string) => (
    <Field id={`${id}-${key}`} label={label}>
      <input id={`${id}-${key}`} inputMode="numeric" value={counts[key]} onChange={(e) => setCounts({ ...counts, [key]: e.target.value })} maxLength={4} className={INPUT} />
    </Field>
  );
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
      <fieldset className="min-w-0 space-y-1">
        <legend className="mb-1 text-sm font-bold text-ink">חניכים ותזונה (לכמויות האוכל)</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {numberField("trainees", "חניכים")}
          {numberField("diet_veg", "צמחוני/טבעוני")}
          {numberField("diet_gf", "ללא גלוטן")}
          {numberField("diet_both", "מהם גם וגם")}
        </div>
        <p className="text-xs text-ink-soft">ריק = עוד לא ידוע (TBD). «מהם גם וגם» — כמה מהם גם צמחוני/טבעוני וגם ללא גלוטן: הם נספרים פעם אחת.</p>
        {live && (
          <p data-diet-split className="text-sm">
            {live}
          </p>
        )}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-contact`} label="איש/אשת קשר מהצוות (משבץ/ת)" hint="שם בלבד — כל הצוות רואה אותו.">
          <input id={`${id}-contact`} value={contact} onChange={(e) => setContact(e.target.value)} maxLength={80} className={INPUT} />
        </Field>
        {load && (
          <Field
            id={`${id}-phone`}
            label="הטלפון של איש/אשת הקשר"
            hint={
              phoneFailed
                ? "לא הצלחנו לטעון את הטלפון, ולכן אי אפשר לשנות אותו עכשיו. שאר השדות יישמרו."
                : base === undefined
                  ? "טוען…"
                  : "מידע אישי: נשמר רק במסד, ורואים אותו רק הלוגיסטיקה והמדריך/ה. ריק — נמחק."
            }
          >
            <input id={`${id}-phone`} dir="ltr" inputMode="tel" value={phone} disabled={!phoneReady} onChange={(e) => setPhone(e.target.value)} maxLength={40} className={INPUT} data-cohort-phone />
          </Field>
        )}
      </div>
      <fieldset className="min-w-0 space-y-1">
        <legend className="mb-1 text-sm font-bold text-ink">באילו תורנויות היא עוזרת</legend>
        {duties.length === 0 ? (
          <p className="text-xs text-ink-soft">עוד אין תורנויות. כשמוסיפים תורנויות (ב«התורנויות» למטה), מסמנים כאן באילו המכינה עוזרת.</p>
        ) : (
          <p className="text-xs text-ink-soft">מכינה שלא עוזרת באף תורנות — אין לה קבוצות, והיא נספרת רק בכמויות האוכל.</p>
        )}
        {duties.map((d) => (
          <label key={d.id} className="flex min-h-11 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="size-5 shrink-0 accent-navy"
              checked={helpsIn.includes(d.id)}
              onChange={(e) => setHelpsIn(e.target.checked ? [...helpsIn, d.id] : helpsIn.filter((x) => x !== d.id))}
            />
            <span>{d.name}</span>
          </label>
        ))}
      </fieldset>
      <label className="flex min-h-11 cursor-pointer items-center gap-2">
        <input type="checkbox" className="size-5 shrink-0 accent-navy" checked={drives} onChange={(e) => setDrives(e.target.checked)} />
        <span>הצוות שלה יכול להסיע</span>
      </label>
      <Problem>{problem}</Problem>
      {dropping ? (
        <Confirm
          text={
            <>
              בלי אף תורנות אין ל<b>{name || initial?.name}</b> קבוצות: {loss}. לשמור כך?
            </>
          }
          confirm="שמירה ומחיקת הקבוצות"
          busy={busy}
          onConfirm={() => {
            setDropping(false);
            send(true);
            focus.back("save");
          }}
          onCancel={() => {
            setDropping(false);
            focus.back("save");
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button kind="primary" type="submit" busy={busy} ref={focus.ref("save")}>
            שמירה
          </Button>
          <Button onClick={onCancel}>ביטול</Button>
        </div>
      )}
    </form>
  );
}

// ------------------------------------------------------------------ כמויות אוכל

/** v20 «כמויות אוכל» under the cohorts: a day × meal, the cohorts on campus then, their trainees by diet (mealsTable). */
function Food({ ctx }: { ctx: RotaCtx }) {
  const { week, data } = ctx;
  if (data.cohorts.length === 0) return null;
  const t = mealsTable(data, week.edition, week.rows);
  return (
    <Part title="כמויות אוכל" aside="חניכים בלבד" data-rota-food="">
      <p className="text-sm text-ink-soft">
        {MEALS_HINT}{" "}
        <Link to="/print/rota?view=food" className="font-bold text-navy underline">
          להדפסה
        </Link>
      </p>
      {t.rows.length === 0 ? (
        <p className="text-sm text-ink-soft">בלו״ז אין שורות ארוחה (שורות קבועות ששמן «ארוחת…»).</p>
      ) : (
        <>
          {/* a phone: a card per meal makes a long page — folded, the count beside it; wider, the table itself */}
          <div className="md:hidden">
            <Fold title="לכל ארוחה" hint={`${t.rows.length} ארוחות`} size="sm">
              <TableView table={t} keys={2} />
            </Fold>
          </div>
          <div className="hidden md:block">
            <TableView table={t} keys={2} />
          </div>
        </>
      )}
    </Part>
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
  // v20: only a cohort that helps in some duty has groups (cohort_not_helping) — the new group's cohorts are those
  const helping = cohorts.filter((c) => cohortHelps(data, c.id));
  const groups = groupsInOrder(data);
  const [editing, setEditing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [cohort, setCohort] = useState<number | null>(null);
  const chosen = helping.find((c) => c.id === cohort) ?? helping[0] ?? null;
  const phones = heads.phones; // only while «כולל טלפונים» is on, here, and answered
  return (
    <Part title="הקבוצות" aside={groups.length || undefined}>
      <HeadPhonesToggle allowed={phonesAllowed} on={heads.on} setOn={heads.setOn} failed={heads.failed} />
      {phonesAllowed && !heads.on && mayWrite && groups.length > 0 && <p className="text-xs text-ink-soft">כדי להוסיף או לשנות טלפון של ראש/ת קבוצה, מסמנים «כולל טלפונים של ראשי הקבוצות».</p>}
      {cohorts.length === 0 && <p className="text-sm text-ink-soft">קודם מוסיפים מכינה: הקוד של קבוצה הוא האות של המכינה והמספר שלה (א1, א2…).</p>}
      {cohorts.length > 0 && helping.length === 0 && (
        <p className="text-sm text-ink-soft">אף מכינה עוד לא עוזרת בתורנות: קבוצות יש רק למכינה שעוזרת. מסמנים לה תורנויות ב«המכינות» («עריכה»).</p>
      )}
      {cohorts.map((c) => {
        const mine = groups.filter((g) => g.cohort_id === c.id);
        const helps = cohortHelps(data, c.id);
        if (!helps && mine.length === 0) {
          return (
            <p key={c.id} data-cohort-groups={c.letter} className="text-sm text-ink-soft">
              {c.name} לא עוזרת באף תורנות, ולכן אין לה קבוצות.
            </p>
          );
        }
        const against = sizesAgainstTrainees(c, mine.map((g) => g.size));
        return (
          <div key={c.id} data-cohort-groups={c.letter} className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h4 className="font-bold text-navy">{c.name}</h4>
              <span className="text-sm text-ink-soft">
                {mine.length === 0 ? "עוד אין קבוצות" : mine.length === 1 ? "קבוצה אחת" : `${mine.length} קבוצות`}
                {c.trainees != null ? ` · ${c.trainees} חניכים` : " · חניכים: TBD"}
              </span>
              {against && (
                <span data-sizes-against className="text-sm text-amber-900">
                  {against}
                </span>
              )}
            </div>
            {mine.length > 0 && (
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
                          onCancel={() => {
                            setEditing(null);
                            focus.back(`edit-${g.id}`);
                          }}
                          onSave={async (v, phone, refused) => {
                            // the form sends a phone only when it differs from the one its field was filled with — never
                            // compared with the phones as they are now (a later answer would read as a change: a deletion)
                            const changed = phone != null;
                            const ok = await act(
                              `group-${g.id}`,
                              async () => {
                                const p = changed ? cleanHeadPhone(phone) : undefined; // a bad phone refused before anything is written
                                await port.rota.updateGroup(g.id, v);
                                if (changed) await port.rota.setContact({ group: g.id }, p ?? null);
                              },
                              "הקבוצה נשמרה",
                              refused,
                            );
                            if (changed) heads.reload();
                            if (!ok) return;
                            setEditing(null);
                            focus.back(`edit-${g.id}`);
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
                          editKey={`edit-${g.id}`}
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
            )}
            {mayWrite && helps && <SplitCohort ctx={ctx} cohort={c} />}
          </div>
        );
      })}
      {mayWrite && chosen && (
        // never remounted (no key): the focus stays on the field or the button it was on after an add or a cohort chosen
        <NewGroup
          cohorts={helping}
          cohort={chosen}
          next={data.groups.filter((g) => g.cohort_id === chosen.id).reduce((m, g) => Math.max(m, g.number), 0) + 1}
          onCohort={setCohort}
          busy={busy === "group-new"}
          onSave={(v, refused) => act("group-new", () => port.rota.addGroup(week.edition.id, { cohort_id: chosen.id, ...v }), `הקבוצה ${groupCode(chosen.letter, v.number)} נוספה`, refused)}
        />
      )}
    </Part>
  );
}

/**
 * v20 «חלוקה לקבוצות» of one helping cohort: the size of a group typed, the split as equal as possible from the cohort's
 * own trainees (splitSizes — a «הצעה»: every size can be changed by hand afterwards), applied in ONE call
 * (rota_split_cohort: the cohort's groups replaced, in one transaction). A cohort that has groups splits again only
 * behind a Confirm that names what goes with them (groupsLossText); its «ביטול» gives the button the focus back.
 */
function SplitCohort({ ctx, cohort: c }: { ctx: RotaCtx; cohort: RotaCohort }) {
  const { port, week, data, busy, act } = ctx;
  const id = useId();
  const focus = useFocusBack();
  const [per, setPer] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const again = data.groups.some((g) => g.cohort_id === c.id);
  const perGroup = intOrNull(per);
  const sizes = c.trainees != null && perGroup != null && Number.isInteger(perGroup) ? splitSizes(c.trainees, perGroup) : [];
  const preview = splitPreviewText(c.letter, sizes);
  const key = `split-${c.id}`;
  const label = again ? "חלוקה מחדש" : "חלוקה לקבוצות";
  const run = () =>
    void act(
      key,
      () => port.rota.splitCohort(week.edition.id, c.id, sizes),
      `${c.name} חולקה ל${sizes.length === 1 ? "קבוצה אחת" : `-${sizes.length} קבוצות`}. הגדלים הם הצעה: אפשר לשנות כל אחד ביד.`,
      formRefusal(setProblem, { bad_value: splitProblem(sizes) ?? "אחד הגדלים לא תקין." }),
    ).then((ok) => {
      setConfirming(false);
      if (ok) setPer("");
      focus.back("split");
    });
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    const why = per.trim() === "" || perGroup == null || !Number.isInteger(perGroup) || perGroup < 1 ? "כמה חניכים בקבוצה — מספר שלם מ-1 ומעלה." : splitProblem(sizes);
    if (why) return setProblem(why);
    if (again) return setConfirming(true);
    run();
  };
  return (
    <Fold title={label} hint={again ? "מחליפה את הקבוצות שיש" : undefined} defaultOpen={!again} size="sm">
      {c.trainees == null ? (
        <p className="text-sm text-ink-soft">כדי לחלק, קודם כותבים כמה חניכים יש ב{c.name} («עריכה» ב«המכינות»).</p>
      ) : c.trainees === 0 ? (
        <p className="text-sm text-ink-soft">ב{c.name} 0 חניכים: אין מה לחלק.</p>
      ) : (
        <form aria-label={`${label}: ${c.name}`} data-split={c.letter} onSubmit={submit} className="space-y-2 rounded-lg border border-line p-3">
          <div className="sm:max-w-xs">
            <Field id={`${id}-per`} label="כמה חניכים בקבוצה" hint={`${c.trainees} חניכים ב${c.name}. החלוקה כמה שיותר שווה.`}>
              <input id={`${id}-per`} inputMode="numeric" value={per} onChange={(e) => setPer(e.target.value)} maxLength={3} className={INPUT} />
            </Field>
          </div>
          {preview && (
            <p data-split-preview className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span>{preview}</span> <Badge tone="accent">הצעה</Badge>
            </p>
          )}
          <Problem>{problem}</Problem>
          {confirming ? (
            <Confirm
              text={
                <>
                  לחלק מחדש את <b>{c.name}</b>? {groupsLossText(data, c.id)}. במקומן: {preview}.
                </>
              }
              confirm="חלוקה מחדש"
              busy={busy === key}
              onConfirm={run}
              onCancel={() => {
                setConfirming(false);
                focus.back("split");
              }}
            />
          ) : (
            <Button kind={again ? "secondary" : "primary"} type="submit" ref={focus.ref("split")} busy={busy === key} busyLabel="מחלק…">
              {label}
            </Button>
          )}
        </form>
      )}
    </Fold>
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
  /** `phone`: the phone to save — null when there is no field, or it holds what it was filled with («ריק» deletes). */
  onSave: (v: GroupValues, phone: string | null, refused: Refused) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [number, setNumber] = useState(String(initial.number));
  const [size, setSize] = useState(initial.size == null ? "" : String(initial.size));
  const [head, setHead] = useState(initial.head_name ?? "");
  const [phone, setPhone] = useState(phone0 ?? "");
  // The phone the field was filled with. The loaded phone may come while the form is open (the switch checked after
  // «עריכה», a late answer, a re-read after a save): the field takes it while it still holds what it was filled with —
  // React's «state from the previous render» pattern, so the other fields keep what was typed.
  const [base, setBase] = useState<string | null>(phone0);
  if (phone0 !== base && phone === (base ?? "")) {
    setBase(phone0);
    setPhone(phone0 ?? "");
  }
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    const changed = phone0 != null && phone.trim() !== (base ?? "");
    void onSave(groupValues(number, size, head), changed ? phone : null, formRefusal(setProblem, GROUP_WORDS));
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

/**
 * «קבוצה חדשה», one form for every group added: after an add it empties itself in place (and the number follows the
 * list again), so the focus stays where it was — never a remount (DECISIONS «המיקוד»). v20: its cohorts are those that
 * help in some duty (a group of one that helps in none is refused: cohort_not_helping).
 */
function NewGroup({ cohorts, cohort, next, onCohort, busy, onSave }: { cohorts: RotaCohort[]; cohort: RotaCohort; next: number; onCohort: (id: number) => void; busy: boolean; onSave: (v: GroupValues, refused: Refused) => Promise<boolean> }) {
  const id = useId();
  // null: the suggested number — the cohort's next, as the list is now (after an add, after another cohort is chosen)
  const [typed, setTyped] = useState<string | null>(null);
  const number = typed ?? String(next);
  const [size, setSize] = useState("");
  const [head, setHead] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    void onSave(groupValues(number, size, head), formRefusal(setProblem, GROUP_WORDS)).then((ok) => {
      if (!ok) return;
      setTyped(null);
      setSize("");
      setHead("");
    });
  };
  return (
    <form aria-label="קבוצה חדשה" onSubmit={submit} className="space-y-3 rounded-lg border border-line p-3">
      <p className="font-bold text-navy">קבוצה חדשה</p>
      <Field id={`${id}-cohort`} label="מכינה">
        <select
          id={`${id}-cohort`}
          value={cohort.id}
          onChange={(e) => {
            onCohort(Number(e.target.value));
            setTyped(null);
          }}
          className={INPUT}
        >
          {cohorts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.letter} · {c.name}
            </option>
          ))}
        </select>
      </Field>
      <GroupFields id={id} number={number} setNumber={setTyped} size={size} setSize={setSize} head={head} setHead={setHead} />
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
  const e = week.edition;
  const focus = useFocusBack();
  const labels = rotaShiftsOf(e).labels;
  const duties = dutiesInOrder(data);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const targets = newDutyTargets(data);
  // last year's four on an empty list: every cohort already entered helps in them (none could choose a duty before)
  const lastYear = () =>
    void act(
      "last-year",
      async () => {
        for (const d of LAST_YEAR_DUTIES) await port.rota.addDuty(e.id, d);
        if (targets.length === 0) return;
        const fresh = await port.rota.load(e.id);
        const ids = dutiesInOrder(fresh).map((d) => d.id);
        for (const c of fresh.cohorts) if (targets.some((t) => t.id === c.id) && cohortDutyIds(fresh, c.id).length === 0) await port.rota.setCohortDuties(e.id, c.id, ids);
      },
      `התורנויות של אשתקד נוספו${targets.length > 0 ? ", וכל המכינות עוזרות בהן" : ""}. כמה קבוצות צריך בכל משמרת — הצעה, אפשר לשנות.`,
    );
  /** «למעלה» / «למטה»: the moved duty and its neighbour change places — only the rows whose number changed are written (prepMoves). */
  const move = async (d: RotaDuty, by: -1 | 1, key: string) => {
    const changes = prepMoves(duties, d.id, by);
    if (changes.length === 0) return;
    await act(
      key,
      async () => {
        for (const c of changes) await port.rota.updateDuty(c.id, { sort: c.sort });
      },
      null,
    );
    focus.back(key);
  };
  return (
    <Part title="התורנויות" aside={duties.length || undefined}>
      {duties.length === 0 && (
        <div data-last-year className="space-y-2 rounded-lg bg-sand-soft p-3 text-sm">
          <p>
            עוד אין תורנויות. אפשר להתחיל מארבע התורנויות של אשתקד — {LAST_YEAR_DUTIES.map((d) => d.name).join(", ")} — עם התיאורים של המדריך/ה. כמה קבוצות בכל משמרת, כמו בגיליון של אשתקד: בית מדרש 4, וכל אחת מהשאר
            1, גם בלילה. <Badge tone="accent">הצעה</Badge>
          </p>
          {targets.length > 0 && <p>המכינות שכבר הוזנו יעזרו בכולן — אפשר לשנות בעריכת המכינה.</p>}
          {mayWrite && (
            <Button kind="primary" busy={busy === "last-year"} busyLabel="מוסיף…" onClick={lastYear}>
              התורנויות של אשתקד
            </Button>
          )}
        </div>
      )}
      {duties.length > 1 && (
        <p data-duty-order className="text-sm text-ink-soft">
          {DUTY_ORDER_HINT}
        </p>
      )}
      <ol aria-label="התורנויות" className="divide-y divide-sage/60">
        {duties.map((d, i) => {
          if (editing === d.id) {
            return (
              <li key={d.id} className="py-2">
                <DutyForm
                  title={`עריכת התורנות: ${d.name}`}
                  initial={d}
                  labels={labels}
                  busy={busy === `duty-${d.id}`}
                  onCancel={() => {
                    setEditing(null);
                    focus.back(`edit-${d.id}`);
                  }}
                  onSave={async (v, _all, refused) => {
                    if (!(await act(`duty-${d.id}`, () => port.rota.updateDuty(d.id, v), "התורנות נשמרה", refused))) return;
                    setEditing(null);
                    focus.back(`edit-${d.id}`);
                  }}
                />
              </li>
            );
          }
          const helpers = dutyHelpers(data, d.id);
          // a cohort with groups that helps in this duty alone keeps it (in_use): the Confirm says so before
          const only = helpers.filter((c) => data.groups.some((g) => g.cohort_id === c.id) && cohortDutyIds(data, c.id).length === 1);
          return (
            <li key={d.id} data-rota-duty={d.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <div className="min-w-0 flex-1 basis-56">
                <p className="font-bold text-navy">{d.name}</p>
                {d.description && <p className="text-sm break-words whitespace-pre-line">{d.description}</p>}
                <p className="text-sm text-ink-soft">
                  כמה קבוצות: {needsText(d, labels)}
                  {d.min_people != null ? ` · לפחות ${d.min_people} אנשים` : ""}
                </p>
                <p data-duty-helpers className={`text-sm ${helpers.length === 0 && data.cohorts.length > 0 ? "text-amber-900" : "text-ink-soft"}`}>
                  {helpers.length > 0 ? `מכינות שעוזרות בה: ${helpers.map((c) => c.letter).join(", ")}` : data.cohorts.length > 0 ? "אף מכינה לא עוזרת בה: ההצעה לא תמלא אותה." : "עוד אין מכינות."}
                </p>
              </div>
              {mayWrite && (
                <LineActions
                  name={d.name}
                  focus={focus}
                  focusKey={`delete-${d.id}`}
                  editKey={`edit-${d.id}`}
                  deleting={deleting === d.id}
                  onEdit={() => setEditing(d.id)}
                  onDelete={() => {
                    setProblem(null);
                    setDeleting(d.id);
                  }}
                  extra={
                    duties.length > 1 && (
                      <>
                        <Button kind="quiet" keepFocus disabled={i === 0} ref={focus.ref(`up-${d.id}`)} busy={busy === `up-${d.id}`} onClick={() => void move(d, -1, `up-${d.id}`)} aria-label={`הזזה למעלה: ${d.name}`}>
                          למעלה
                        </Button>
                        <Button kind="quiet" keepFocus disabled={i === duties.length - 1} ref={focus.ref(`down-${d.id}`)} busy={busy === `down-${d.id}`} onClick={() => void move(d, 1, `down-${d.id}`)} aria-label={`הזזה למטה: ${d.name}`}>
                          למטה
                        </Button>
                      </>
                    )
                  }
                  confirm={
                    <Confirm
                      text={
                        <>
                          למחוק את התורנות <b>{d.name}</b>? גם כל השיבוצים שלה יימחקו.
                          {only.length > 0 && ` ${only.map((c) => c.name).join(", ")} ${only.length === 1 ? "עוזרת" : "עוזרות"} רק בה ויש ${only.length === 1 ? "לה" : "להן"} קבוצות: קודם מסמנים ${only.length === 1 ? "לה" : "להן"} תורנות אחרת, או מוחקים את הקבוצות.`}
                        </>
                      }
                      confirm="מחיקה"
                      busy={busy === `delete-duty-${d.id}`}
                      onConfirm={() =>
                        void act(
                          `delete-duty-${d.id}`,
                          () => port.rota.deleteDuty(d.id),
                          "התורנות נמחקה",
                          formRefusal(setProblem, { in_use: "מכינה שיש לה קבוצות עוזרת רק בתורנות הזו, ולכן אי אפשר למחוק אותה. קודם מסמנים לה תורנות אחרת, או מוחקים את הקבוצות שלה." }),
                        ).then((ok) => {
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
          );
        })}
      </ol>
      <Problem>{problem}</Problem>
      {mayWrite &&
        (editing === "new" ? (
          <DutyForm
            title="תורנות חדשה"
            labels={labels}
            everyHelping={targets.length > 0 ? { label: data.duties.length === 0 ? "כל המכינות עוזרות בה" : "כל המכינות העוזרות עוזרות בה", cohorts: targets } : null}
            busy={busy === "duty-new"}
            onCancel={() => {
              setEditing(null);
              focus.back("new");
            }}
            onSave={async (v, all, refused) => {
              const sort = duties.reduce((m, d) => Math.max(m, d.sort), 0) + 1;
              const add = async () => {
                await port.rota.addDuty(e.id, { ...v, sort } as NewDuty);
                if (!all || targets.length === 0) return;
                // the new duty's id: its name is unique in the edition as names are compared (rota_duty_exists)
                const fresh = await port.rota.load(e.id);
                const duty = fresh.duties.find((x) => nameKey(x.name) === nameKey(v.name ?? ""));
                if (!duty) return;
                for (const c of fresh.cohorts) if (targets.some((t) => t.id === c.id)) await port.rota.setCohortDuties(e.id, c.id, [...cohortDutyIds(fresh, c.id), duty.id]);
              };
              const ok = all && targets.length > 0 ? `התורנות נוספה, ו${targets.length === 1 ? `${targets[0].name} עוזרת בה` : `-${targets.length} מכינות עוזרות בה`}` : "התורנות נוספה";
              if (!(await act("duty-new", add, ok, refused))) return;
              setEditing(null);
              focus.back("new");
            }}
          />
        ) : (
          <Button ref={focus.ref("new")} onClick={() => setEditing("new")}>
            + תורנות
          </Button>
        ))}
    </Part>
  );
}

type DutyValues = Omit<RotaDuty, "id" | "edition_id" | "sort">;

function DutyForm({ title, initial, labels, everyHelping, busy, onSave, onCancel }: {
  title: string;
  initial?: RotaDuty;
  labels: readonly string[];
  /** A new duty: «כל המכינות העוזרות עוזרות בה» (ticked to begin with) and the cohorts it adds the duty to; null — no such box. */
  everyHelping?: { label: string; cohorts: readonly RotaCohort[] } | null;
  busy: boolean;
  /** `all`: add it to everyHelping's cohorts. The order is not the form's: a new duty goes last, and «למעלה» / «למטה» move it. */
  onSave: (v: DutyValues, all: boolean, refused: Refused) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [needs, setNeeds] = useState<[string, string, string]>(() => NEEDS.map((k) => (initial?.[k] == null ? "" : String(initial[k]))) as [string, string, string]);
  const [min, setMin] = useState(initial?.min_people == null ? "" : String(initial.min_people));
  const [all, setAll] = useState(true);
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
      },
      everyHelping != null && all,
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
      <div className="sm:max-w-sm">
        <Field id={`${id}-min`} label="מינימום אנשים (לא חובה)" hint="כשיש מינימום, ההצעה מוסיפה עוד קבוצות עד שמגיעים אליו (עד 2 נוספות).">
          <input id={`${id}-min`} inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} className={INPUT} />
        </Field>
      </div>
      {everyHelping && (
        <div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2">
            <input type="checkbox" className="size-5 shrink-0 accent-navy" checked={all} onChange={(e) => setAll(e.target.checked)} data-every-helping />
            <span>{everyHelping.label}</span>
          </label>
          <p className="text-xs text-ink-soft">
            {everyHelping.cohorts.map((c) => c.name).join(", ")}. אפשר לשנות אחר כך בעריכת המכינה. התורנות החדשה נכנסת בסוף הרשימה.
          </p>
        </div>
      )}
      {!initial && !everyHelping && <p className="text-xs text-ink-soft">התורנות החדשה נכנסת בסוף הרשימה.</p>}
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
