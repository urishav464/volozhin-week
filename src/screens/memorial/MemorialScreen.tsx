// «זמני זיכרון» (/memorial, milestone 5ב-2). The whole team reads it; an
// edition's admins plan and place:
//   - the policy (settings.memorial) — the staff meeting's, never seeded: until
//     it is set, no warning about length or meals (a plan longer than its slot
//     is always named);
//   - the slots, day by day inside the grid's memorial rows — «+ זמן זיכרון» makes
//     one anywhere in a row, any length; an empty one can be removed;
//   - the tray: a plan per fallen not placed yet — with the materials already
//     uploaded for it, «ממתין לשיבוץ» — and a picker (a list — tap or keyboard)
//     that chooses a free slot and «שיבוץ» that places it; the slot's own picker
//     the same way round. Every select here only picks: a button commits (an
//     ArrowDown on a closed select changes it). A placed plan carries its liaison
//     (the slot's escort, the team's contact with the family; picked, then
//     «שמירה») and its materials for the reader;
//   - each plan's details (the family's status, who speaks, minutes, «בלי
//     חריגה», the materials note) and — for admins only, fetched on opening, one
//     fallen at a time — the family's contact person;
//   - the cross-year list of the fallen (a global admin): names are entered here
//     only, never in git.
import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import type { WeekCommands } from "../../data/commands";
import { type Fallen, type FallenContacts, EMPTY_FALLEN_CONTACTS, FAMILY_STATUS_LABEL, FAMILY_STATUSES, MEMORIAL_LIMITS, type PlanPatch } from "../../data/memorial";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { telHref } from "../../domain/contactLinks";
import { fallenName, freeSlots, memorialRowsOf, memorialSlots, minutesText, planOf, slotLabel } from "../../domain/memorial";
import { DAY_NAMES, DAYS, type Day, LRM, fmt, fmtRange, overlaps, parseClock } from "../../domain/time";
import type { FamilyStatus, Gender, Lesson, MemorialPlan, MemorialPolicy, Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { memorialWaiting } from "../../reader/model";
import { warningsFor } from "../../rules/warnings";
import { Badge, Button, Confirm, Field, GenderField, INPUT, Panel, useRunner } from "../settings/kit";
import { EditionSelect, type Notify, useToast } from "../speakers/parts";
import { FileRow, SourceFiles } from "../stages/SourceFiles";
import { Problem } from "../stages/parts";
import { type Actor, actorIn, useWeekStore } from "../weekStore";
import { MemorialReaderLine } from "./SlotPanel";

type Act = (key: string, fn: () => Promise<unknown>, ok: string | null, onRefused?: (code: string | null) => boolean) => Promise<boolean>;

interface Ctx {
  port: DataPort;
  week: Week;
  actor: Actor;
  /** May plan here: an admin of the edition (an archive's too — the database decides). */
  admin: boolean;
  cmds: WeekCommands;
  busy: string | null;
  act: Act;
  notify: Notify;
  clear: () => void;
  reload: () => Promise<void>;
}

const SELECT = "min-h-11 w-full rounded-lg border border-line bg-card px-2 text-base";

export function MemorialScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const { notify, clear, node } = useToast();
  const { busy, run } = useRunner(notify, clear);
  const editionId = week?.edition.id ?? null;
  const cmds = useMemo(() => (editionId != null ? port.commands(editionId) : null), [port, editionId]);

  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!week || !cmds) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  const actor = actorIn(me, week.edition);
  const act: Act = async (key, fn, ok, onRefused) => {
    const done = await run(key, fn, ok, (code) => {
      if (code === "stale") void store.reload();
      return onRefused?.(code) ?? false;
    });
    await store.reload();
    return done;
  };
  const ctx: Ctx = { port, week, actor, admin: actor.isAdmin, cmds, busy, act, notify, clear, reload: store.reload };
  const plans = [...(week.memorialPlans ?? [])].sort((a, b) => a.fallen_id - b.fallen_id);
  const tray = plans.filter((p) => p.lesson_id == null || !memorialSlots(week).some((l) => l.id === p.lesson_id));
  const warnings = warningsFor(week).filter((w) => w.kind.startsWith("memorial_"));

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-display text-2xl font-extrabold">זמני זיכרון</h2>
        <EditionSelect />
      </div>
      <p className="text-sm text-ink-soft">
        לכל חלל/ה תוכנית אחת במחזור: מה המשפחה אמרה, מי מדבר/ת, כמה דקות, והחומרים למקראה. משבצים אותה בזמן זיכרון ברשת. המלווה של זמן הזיכרון הוא/היא איש/אשת הקשר של הצוות עם המשפחה.
        {!ctx.admin && " את התוכניות ואת השיבוץ עושה המדריך/ה של המחזור."}
      </p>

      <PolicyPanel {...ctx} />

      {warnings.length > 0 && (
        <ul aria-label="אזהרות זמני הזיכרון" className="space-y-1">
          {warnings.map((w) => (
            <li key={w.key} className="rounded-md bg-amber-50 px-2 py-1 text-sm text-amber-900">
              ⚠ {w.message}
            </li>
          ))}
        </ul>
      )}

      <Panel title="המגש" aside={tray.length === 0 ? "כל התוכניות משובצות" : `${tray.length} לא משובצות`}>
        {tray.length === 0 ? (
          <p className="text-sm text-ink-soft">{plans.length === 0 ? "עוד אין תוכניות במחזור הזה." : "אין תוכנית שמחכה לשיבוץ."}</p>
        ) : (
          <ul aria-label="תוכניות שלא שובצו" className="grid items-start gap-2 md:grid-cols-2">
            {tray.map((p) => (
              <li key={p.id}>
                <PlanCard {...ctx} plan={p} slot={null} />
              </li>
            ))}
          </ul>
        )}
        {ctx.admin && <AddPlan {...ctx} />}
      </Panel>

      <section aria-label="זמני הזיכרון ברשת" className="space-y-3">
        <h3 className="font-display text-xl font-bold">ברשת</h3>
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {DAYS.map((d) => (
            <DaySlots key={d} {...ctx} day={d} />
          ))}
        </div>
      </section>

      {actor.global && <FallenList {...ctx} />}
      {node}
    </div>
  );
}

// ------------------------------------------------------------------ the policy

/** Each part of the policy is the staff meeting's: until it decides one, that part says so. */
const PENDING = "ממתין להחלטת ישיבת הצוות";
/** The 1–180 guard on minutes is ours, against a typo — not the policy («הצעה»). */
const MINUTES_PROBLEM = `מספר דקות שלם, בין 1 ל-${MEMORIAL_LIMITS.minutes} (הצעה: רק נגד טעות הקלדה), או ריק.`;

function PolicyPanel({ week, admin, cmds, busy, act }: Ctx) {
  const id = useId();
  const policy = week.edition.settings?.memorial ?? null;
  const [editing, setEditing] = useState(false);
  const [placement, setPlacement] = useState("");
  const [max, setMax] = useState("");
  const [meal, setMeal] = useState<"" | "warn" | "no">("");
  const [problem, setProblem] = useState<string | null>(null);
  const open = () => {
    setPlacement(policy?.placement ?? "");
    setMax(policy?.max_minutes != null ? String(policy.max_minutes) : "");
    setMeal(policy?.warn_adjacent_meal == null ? "" : policy.warn_adjacent_meal ? "warn" : "no");
    setProblem(null);
    setEditing(true);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const t = max.trim();
    const n = t === "" ? null : Number(t);
    if (n != null && (!Number.isInteger(n) || n < 1 || n > MEMORIAL_LIMITS.minutes)) return setProblem(MINUTES_PROBLEM);
    const next: MemorialPolicy = {};
    if (placement.trim()) next.placement = placement.trim();
    if (n != null) next.max_minutes = n;
    if (meal !== "") next.warn_adjacent_meal = meal === "warn";
    if (await act("policy", () => cmds.setMemorialPolicy(next), Object.keys(next).length ? "המדיניות נשמרה" : "המדיניות נמחקה")) setEditing(false);
  };
  const parts = [policy?.placement != null, policy?.max_minutes != null, policy?.warn_adjacent_meal != null];
  const set = parts.some(Boolean);
  const badge = parts.every(Boolean) ? <Badge tone="ok">נקבעה בישיבת הצוות</Badge> : <Badge tone="accent">{set ? "חלק ממנה ממתין להחלטת ישיבת הצוות" : PENDING}</Badge>;
  const pending = <span className="text-ink-soft">{PENDING}</span>;
  return (
    <Panel title="המדיניות" aside={badge}>
      {!set ? (
        <p className="text-sm text-ink-soft">עוד לא נקבעה מדיניות. היא תיקבע בישיבת הצוות; עד אז אין אזהרות על אורך או על סמיכות לארוחה. תוכנית ארוכה מהמשבצת שלה מסומנת תמיד.</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-soft">איפה</dt>
          <dd className="min-w-0 break-words whitespace-pre-line">{policy?.placement ?? pending}</dd>
          <dt className="text-ink-soft">עד כמה דקות</dt>
          <dd>{policy?.max_minutes != null ? `${policy.max_minutes} דקות` : pending}</dd>
          <dt className="text-ink-soft">ליד ארוחה</dt>
          <dd>{policy?.warn_adjacent_meal == null ? pending : policy.warn_adjacent_meal ? "להזהיר על זמן זיכרון צמוד לארוחה" : "בלי אזהרה"}</dd>
        </dl>
      )}
      {admin &&
        (editing ? (
          <form onSubmit={(e) => void save(e)} aria-label="עריכת המדיניות" className="mt-3 space-y-3" noValidate>
            <Field id={`${id}-where`} label="איפה ממקמים זמני זיכרון" hint={`מה שהוחלט בישיבת הצוות. ריק: ${PENDING}.`}>
              <textarea id={`${id}-where`} value={placement} maxLength={MEMORIAL_LIMITS.placement} onChange={(e) => setPlacement(e.target.value)} rows={2} className={`${INPUT} py-2`} aria-describedby={`${id}-where-hint`} />
            </Field>
            <Field id={`${id}-max`} label="עד כמה דקות (לא חובה)" hint={`מה שהוחלט בישיבת הצוות. ריק: ${PENDING}, ובינתיים בלי אזהרה על אורך.`}>
              <input id={`${id}-max`} type="number" inputMode="numeric" min={1} max={MEMORIAL_LIMITS.minutes} value={max} onChange={(e) => setMax(e.target.value)} className={`${INPUT} w-28`} aria-describedby={`${id}-max-hint`} />
            </Field>
            <Field id={`${id}-meal`} label="זמן זיכרון צמוד לארוחה">
              <select id={`${id}-meal`} value={meal} onChange={(e) => setMeal(e.target.value as "" | "warn" | "no")} className={SELECT}>
                <option value="">{PENDING}</option>
                <option value="warn">להזהיר על זמן זיכרון צמוד לארוחה</option>
                <option value="no">בלי אזהרה</option>
              </select>
            </Field>
            {problem && <Problem>{problem}</Problem>}
            <div className="flex flex-wrap gap-2">
              <Button kind="primary" type="submit" busy={busy === "policy"} busyLabel="שומר…">
                שמירה
              </Button>
              <Button onClick={() => setEditing(false)}>ביטול</Button>
            </div>
          </form>
        ) : (
          <Button className="mt-3" onClick={open}>
            {set ? "עריכת המדיניות" : "קביעת המדיניות"}
          </Button>
        ))}
    </Panel>
  );
}

// ------------------------------------------------------------------ the slots

function DaySlots(props: Ctx & { day: Day }) {
  const { week, day, admin } = props;
  const rows = memorialRowsOf(week, day);
  const slots = memorialSlots(week).filter((l) => l.day === day);
  if (rows.length === 0 && slots.length === 0) return null;
  return (
    <section aria-label={`יום ${DAY_NAMES[day]}`} className="rounded-xl border border-line bg-card p-3">
      <h4 className="mb-2 font-display text-lg font-semibold">יום {DAY_NAMES[day]}</h4>
      <div className="space-y-3">
        {rows.map((r) => {
          const inRow = slots.filter((l) => overlaps(l.start_min, l.end_min, r.start_min, r.end_min));
          return (
            <div key={r.id} className="space-y-2">
              <p className="text-sm font-semibold text-amber-900">
                {r.label} · <bdi dir="ltr">{fmtRange(r.start_min, r.end_min)}</bdi>
              </p>
              {inRow.length === 0 && <p className="text-sm text-ink-soft">אין כאן זמן זיכרון.</p>}
              <ul className="grid items-start gap-2 md:grid-cols-2 lg:grid-cols-1">
                {inRow.map((l) => (
                  <li key={l.id}>
                    <SlotCard {...props} slot={l} />
                  </li>
                ))}
              </ul>
              {admin && <AddSlot {...props} row={r} />}
            </div>
          );
        })}
        {/* a slot outside today's rows (the grid changed since): still listed, to move its plan or remove it */}
        {slots
          .filter((l) => !rows.some((r) => overlaps(l.start_min, l.end_min, r.start_min, r.end_min)))
          .map((l) => (
            <SlotCard key={l.id} {...props} slot={l} />
          ))}
      </div>
    </section>
  );
}

function SlotCard(props: Ctx & { slot: Lesson }) {
  const { week, slot: l, admin, cmds, busy, act } = props;
  const plan = planOf(week, l.id);
  const [asking, setAsking] = useState(false);
  const tray = (week.memorialPlans ?? []).filter((p) => p.lesson_id == null);
  return (
    <div data-memorial-slot={l.id} className={`rounded-lg border p-3 ${plan ? "border-amber-300 bg-amber-50" : "border-dashed border-amber-300 bg-paper"}`}>
      <p className="text-sm font-semibold">
        <bdi>{slotLabel(week, l)}</bdi>
      </p>
      {plan ? (
        <div className="mt-2">
          <PlanCard {...props} plan={plan} slot={l} />
        </div>
      ) : (
        <>
          <p className="text-sm text-ink-soft">פנוי</p>
          {admin && tray.length > 0 && (
            <PickPlan slotLabelText={slotLabel(week, l)} plans={tray} week={week} busy={busy === `place-slot-${l.id}`} onPick={(p) => void act(`place-slot-${l.id}`, () => cmds.placeMemorialPlan(p.id, p.version, l.id), `«${fallenName(week, p.fallen_id)}» שובץ/ה`)} />
          )}
          {admin &&
            (asking ? (
              <Confirm text="להסיר את זמן הזיכרון הזה מהרשת?" confirm="כן, להסיר" busy={busy === `remove-${l.id}`} onConfirm={() => void act(`remove-${l.id}`, () => cmds.removeMemorialSlot(l.id), "זמן הזיכרון הוסר")} onCancel={() => setAsking(false)} />
            ) : (
              <Button kind="danger" className="mt-2" onClick={() => setAsking(true)}>
                הסרת המשבצת
              </Button>
            ))}
        </>
      )}
    </div>
  );
}

/** The slot's side of the picker: one of the tray's plans onto this slot. */
function PickPlan({ slotLabelText, plans, week, busy, onPick }: { slotLabelText: string; plans: MemorialPlan[]; week: Week; busy: boolean; onPick: (p: MemorialPlan) => void }) {
  const id = useId();
  const [chosen, setChosen] = useState<number | "">("");
  const plan = plans.find((p) => p.id === chosen) ?? null;
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1 basis-48">
        <label htmlFor={id} className="text-sm font-semibold">
          שיבוץ מהמגש
        </label>
        <select id={id} value={chosen} onChange={(e) => setChosen(e.target.value === "" ? "" : Number(e.target.value))} className={SELECT} aria-describedby={`${id}-for`}>
          <option value="">בחירת חלל/ה…</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {fallenName(week, p.fallen_id)}
            </option>
          ))}
        </select>
        <span id={`${id}-for`} className="sr-only">
          לזמן הזיכרון {slotLabelText}
        </span>
      </div>
      <Button kind="primary" disabled={!plan} busy={busy} busyLabel="משבץ…" onClick={() => plan && onPick(plan)}>
        שיבוץ
      </Button>
    </div>
  );
}

/** «+ זמן זיכרון» in a memorial row: the whole row by default; any part of it, any room. */
function AddSlot({ week, day, row, cmds, busy, act }: Ctx & { day: Day; row: { id: number; start_min: number; end_min: number; label: string } }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(fmt(row.start_min));
  const [end, setEnd] = useState(fmt(row.end_min));
  const [room, setRoom] = useState<number | "">("");
  const [problem, setProblem] = useState<string | null>(null);
  const key = `slot-${day}-${row.id}`;
  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} aria-label={`הוספת זמן זיכרון: ${DAY_NAMES[day]}, ${row.label}`}>
        + זמן זיכרון
      </Button>
    );
  }
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const s = parseClock(start);
    const t = parseClock(end);
    if (s == null || t == null || t <= s) return setProblem("צריך שעת התחלה ושעת סיום, למשל 13:00 ו-13:15.");
    if (s % 5 !== 0 || t % 5 !== 0) return setProblem("השעות בקפיצות של 5 דקות, למשל 13:05.");
    if (s < row.start_min || t > row.end_min) return setProblem(`בתוך השורה: ${LRM}${fmtRange(row.start_min, row.end_min)}.`);
    const done = await act(key, () => cmds.addMemorialSlot(day, s, t, room === "" ? null : room), "זמן הזיכרון נוסף", (code) => {
      if (code !== "room_taken" && code !== "outside_grid" && code !== "bad_shape") return false;
      setProblem(errorMessage(code));
      return true;
    });
    if (done) setOpen(false);
  };
  return (
    <form onSubmit={(e) => void save(e)} aria-label={`זמן זיכרון חדש: ${DAY_NAMES[day]}, ${row.label}`} className="space-y-2 rounded-lg border border-line bg-paper p-3" noValidate>
      <div className="flex flex-wrap gap-2">
        <Field id={`${id}-s`} label="מ-">
          <input id={`${id}-s`} dir="ltr" value={start} onChange={(e) => setStart(e.target.value)} className={`${INPUT} w-24`} autoComplete="off" />
        </Field>
        <Field id={`${id}-e`} label="עד">
          <input id={`${id}-e`} dir="ltr" value={end} onChange={(e) => setEnd(e.target.value)} className={`${INPUT} w-24`} autoComplete="off" />
        </Field>
        <Field id={`${id}-r`} label="חדר">
          <select id={`${id}-r`} value={room} onChange={(e) => setRoom(e.target.value === "" ? "" : Number(e.target.value))} className={SELECT}>
            <option value="">החדר הראשון ברשימה</option>
            {week.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {problem && <Problem>{problem}</Problem>}
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" type="submit" busy={busy === key} busyLabel="מוסיף…">
          הוספה
        </Button>
        <Button onClick={() => setOpen(false)}>ביטול</Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ a plan

function PlanCard(props: Ctx & { plan: MemorialPlan; slot: Lesson | null }) {
  const { week, plan: p, slot, admin, cmds, busy, act } = props;
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const name = fallenName(week, p.fallen_id);
  const choices = freeSlots(week, p);
  const liaison = slot?.escort_roster_id != null ? (week.roster.find((r) => r.id === slot.escort_roster_id)?.full_name ?? "חניך/ה שנמחק/ה") : null;
  // the select only picks; «שיבוץ» (or «למגש») commits — back to the saved place whenever the plan changes
  const saved = p.lesson_id ?? "";
  const [chosen, setChosen] = useState<number | "">(saved);
  useEffect(() => setChosen(p.lesson_id ?? ""), [p.lesson_id, p.version]);
  const waiting = slot ? [] : memorialWaiting(week, p);
  return (
    <article aria-labelledby={`${id}-h`} data-memorial-plan={p.id} className={slot ? "space-y-2" : "space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3"}>
      <h5 id={`${id}-h`} className="font-semibold text-amber-950">
        {name}
      </h5>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        <dt className="text-ink-soft">המשפחה</dt>
        <dd>{FAMILY_STATUS_LABEL[p.family_status]}</dd>
        <dt className="text-ink-soft">מדבר/ת</dt>
        <dd className="min-w-0 break-words">{p.speaker_text ?? "TBD"}</dd>
        <dt className="text-ink-soft">דקות</dt>
        <dd>
          {minutesText(p.planned_minutes)}
          {p.hard_stop && " · בלי חריגה"}
        </dd>
        {p.materials_note && (
          <>
            <dt className="text-ink-soft">למקראה</dt>
            <dd className="min-w-0 break-words">{p.materials_note}</dd>
          </>
        )}
        {slot && (
          <>
            <dt className="text-ink-soft">קשר עם המשפחה</dt>
            <dd>{liaison ?? "עוד לא נקבע/ה"}</dd>
          </>
        )}
      </dl>

      {admin && (
        <div className="min-w-0">
          <label htmlFor={`${id}-place`} className="text-sm font-semibold">
            שיבוץ
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id={`${id}-place`}
              value={chosen}
              disabled={busy === `place-${p.id}`}
              onChange={(e) => setChosen(e.target.value === "" ? "" : Number(e.target.value))}
              className={`${SELECT} min-w-0 flex-1 basis-48`}
            >
              <option value="">במגש (לא משובץ/ת)</option>
              {choices.map((l) => (
                <option key={l.id} value={l.id}>
                  {slotLabel(week, l)}
                </option>
              ))}
            </select>
            {chosen !== saved && (
              <Button
                kind="primary"
                busy={busy === `place-${p.id}`}
                busyLabel="משבץ…"
                aria-label={`${chosen === "" ? "למגש" : "שיבוץ"}: ${name}`}
                onClick={() => {
                  const to = chosen === "" ? null : chosen;
                  void act(`place-${p.id}`, () => cmds.placeMemorialPlan(p.id, p.version, to), to == null ? `«${name}» חזר/ה למגש` : `«${name}» שובץ/ה`);
                }}
              >
                {chosen === "" ? "למגש" : "שיבוץ"}
              </Button>
            )}
          </div>
          {choices.length === 0 && <p className="text-xs text-ink-soft">אין זמן זיכרון פנוי. מוסיפים אחד ב«ברשת» למטה.</p>}
        </div>
      )}

      {slot && admin && <LiaisonPicker {...props} slot={slot} />}

      {admin &&
        (editing ? (
          <PlanForm plan={p} name={name} busy={busy} onCancel={() => setEditing(false)} onSave={(patch, onRefused) => act(`plan-${p.id}`, () => cmds.updateMemorialPlan(p.id, p.version, patch), "התוכנית נשמרה", onRefused)} onSaved={() => setEditing(false)} />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEditing(true)} aria-label={`עריכת התוכנית: ${name}`}>
              עריכה
            </Button>
            {p.lesson_id == null && !asking && (
              <Button kind="danger" onClick={() => setAsking(true)}>
                מחיקת התוכנית
              </Button>
            )}
          </div>
        ))}
      {asking && (
        <Confirm text={<>למחוק את התוכנית של «{name}» במחזור הזה? השם נשאר ברשימת החללים.{waiting.length > 0 && " החומרים שהועלו לה לא נמחקים איתה: הם נשארים, להסרה."}</>} confirm="כן, למחוק" busy={busy === `delete-${p.id}`} onConfirm={() => void act(`delete-${p.id}`, () => cmds.deleteMemorialPlan(p.id), "התוכנית נמחקה")} onCancel={() => setAsking(false)} />
      )}

      {admin && <FamilyContacts {...props} fallenId={p.fallen_id} name={name} />}

      {slot && (
        <div className="space-y-2 rounded-lg border border-line bg-card p-2">
          <MemorialReaderLine week={week} lesson={slot} />
          <SourceFiles port={props.port} week={week} lesson={slot} actor={props.actor} notify={props.notify} clear={props.clear} reload={props.reload} />
        </div>
      )}
      {/* in the tray: the materials already uploaded for it — its own, waiting to go with it to a slot; never leftovers */}
      {waiting.length > 0 && (
        <div className="space-y-1 rounded-lg border border-line bg-card p-2" role="group" aria-label={`החומרים של התוכנית: ${name}`}>
          <p className="text-sm font-semibold">החומרים · ממתין לשיבוץ</p>
          <p className="text-xs text-ink-soft">הועלו לתוכנית הזאת. הם עוברים איתה לזמן הזיכרון שבו היא תשובץ, ונכנסים למקראה משם.</p>
          <ul className="divide-y divide-line">
            {waiting.map((f) => (
              <FileRow key={f.id} port={props.port} week={week} file={f} actor={props.actor} notify={props.notify} reload={props.reload} />
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function PlanForm({
  plan: p,
  name,
  busy,
  onSave,
  onSaved,
  onCancel,
}: {
  plan: MemorialPlan;
  name: string;
  busy: string | null;
  onSave: (patch: PlanPatch, onRefused: (code: string | null) => boolean) => Promise<boolean>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [status, setStatus] = useState<FamilyStatus>(p.family_status);
  const [speaker, setSpeaker] = useState(p.speaker_text ?? "");
  const [minutes, setMinutes] = useState(p.planned_minutes != null ? String(p.planned_minutes) : "");
  const [hardStop, setHardStop] = useState(p.hard_stop);
  const [note, setNote] = useState(p.materials_note ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const t = minutes.trim();
    const n = t === "" ? null : Number(t);
    if (n != null && (!Number.isInteger(n) || n < 1 || n > MEMORIAL_LIMITS.minutes)) return setProblem(MINUTES_PROBLEM);
    const patch: PlanPatch = { family_status: status, speaker_text: speaker.trim() || null, planned_minutes: n, hard_stop: hardStop, materials_note: note.trim() || null };
    const ok = await onSave(patch, (code) => {
      if (code !== "bad_value") return false;
      setProblem(errorMessage(code));
      return true;
    });
    if (ok) onSaved();
  };
  return (
    <form onSubmit={(e) => void submit(e)} aria-label={`עריכת התוכנית: ${name}`} className="space-y-3 rounded-lg border border-line bg-paper p-3" noValidate>
      <Field id={`${id}-st`} label="מה המשפחה אמרה">
        <select id={`${id}-st`} value={status} onChange={(e) => setStatus(e.target.value as FamilyStatus)} className={SELECT}>
          {FAMILY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {FAMILY_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${id}-sp`} label="מי מדבר/ת" hint="שם או תיאור, בלי טלפון.">
        <input id={`${id}-sp`} value={speaker} maxLength={MEMORIAL_LIMITS.speaker_text} onChange={(e) => setSpeaker(e.target.value)} className={INPUT} autoComplete="off" aria-describedby={`${id}-sp-hint`} />
      </Field>
      <Field id={`${id}-min`} label="דקות מתוכננות (לא חובה)">
        <input id={`${id}-min`} type="number" inputMode="numeric" min={1} max={MEMORIAL_LIMITS.minutes} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={`${INPUT} w-28`} />
      </Field>
      <label className="flex min-h-11 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={hardStop} onChange={(e) => setHardStop(e.target.checked)} className="size-5 accent-ink" />
        לסיים בדיוק בזמן (בלי חריגה)
      </label>
      <Field id={`${id}-note`} label="מה נכנס למקראה (לא חובה)">
        <textarea id={`${id}-note`} value={note} maxLength={MEMORIAL_LIMITS.materials_note} onChange={(e) => setNote(e.target.value)} rows={2} className={`${INPUT} py-2`} />
      </Field>
      {problem && <Problem>{problem}</Problem>}
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" type="submit" busy={busy === `plan-${p.id}`} busyLabel="שומר…">
          שמירה
        </Button>
        <Button onClick={onCancel}>ביטול</Button>
      </div>
    </form>
  );
}

/** The liaison: a trainee of the roster as the slot's escort — the team's contact with the family (admins). */
function LiaisonPicker({ week, slot: l, cmds, busy, act }: Ctx & { slot: Lesson }) {
  const id = useId();
  const key = `liaison-${l.id}`;
  // the select only picks; «שמירה» commits — back to the saved liaison whenever the slot changes
  const saved = l.escort_roster_id ?? "";
  const [chosen, setChosen] = useState<number | "">(saved);
  useEffect(() => setChosen(l.escort_roster_id ?? ""), [l.escort_roster_id, l.version]);
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-sm font-semibold">
        קשר עם המשפחה (המלווה)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select id={id} value={chosen} disabled={busy === key} onChange={(e) => setChosen(e.target.value === "" ? "" : Number(e.target.value))} className={`${SELECT} min-w-0 flex-1 basis-48`}>
          <option value="">עוד לא נקבע/ה</option>
          {week.roster.map((r) => (
            <option key={r.id} value={r.id}>
              {r.full_name}
            </option>
          ))}
        </select>
        {chosen !== saved && (
          <Button
            kind="primary"
            busy={busy === key}
            busyLabel="שומר…"
            aria-label="שמירת המלווה"
            onClick={() => {
              const roster = chosen === "" ? null : chosen;
              void act(key, () => cmds.setEscort(l.id, l.version, { roster_id: roster, self_intro: false, escort_note: l.escort_note }), roster == null ? "המלווה הוסר/ה" : "המלווה נשמר/ה");
            }}
          >
            שמירה
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The family's contact person — personal data of a bereaved family: admins only, fetched when opened, one fallen
 * at a time (get_fallen_contacts). Never in the week, a link, or an export but the admin's archive.
 */
function FamilyContacts({ port, week, busy, act, fallenId, name }: Ctx & { fallenId: number; name: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [c, setC] = useState<FallenContacts | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => {
    try {
      setC(await port.memorial.contacts(fallenId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [port, fallenId]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  if (!open) {
    return (
      <Button kind="quiet" onClick={() => setOpen(true)} aria-expanded={false} aria-controls={`${id}-box`}>
        פרטי הקשר של המשפחה
      </Button>
    );
  }
  const tel = telHref(c?.phone);
  return (
    <div id={`${id}-box`} role="group" aria-label={`פרטי הקשר של המשפחה: ${name}`} className="space-y-2 rounded-lg border border-line bg-paper p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">פרטי הקשר של המשפחה</p>
        <Button kind="quiet" className="ms-auto" onClick={() => setOpen(false)} aria-expanded>
          סגירה
        </Button>
      </div>
      <p className="text-xs text-ink-soft">מידע אישי של משפחה שכולה: גלוי רק למדריך/ה (אדמין). לא נכנס לשבוע, לקישורים, לרשימות או לקבצים — רק לארכיון של האדמין.</p>
      {failed && c === undefined ? (
        <div role="alert">
          <p className="text-sm text-bad">לא הצלחנו לטעון.</p>
          <Button onClick={() => void load()}>לנסות שוב</Button>
        </div>
      ) : c === undefined ? (
        <p className="text-sm text-ink-soft">טוען…</p>
      ) : c === null ? (
        <p className="text-sm text-ink-soft">פרטי הקשר גלויים רק למדריך/ה של מחזור שיש בו תוכנית ל{name}.</p>
      ) : editing ? (
        <ContactsForm
          c={c}
          name={name}
          busy={busy === `contacts-${fallenId}`}
          onCancel={() => setEditing(false)}
          onSave={async (next, onRefused) => {
            const ok = await act(`contacts-${fallenId}`, () => port.memorial.setContacts(fallenId, next), "פרטי הקשר נשמרו", onRefused);
            if (ok) {
              setEditing(false);
              await load();
            }
          }}
        />
      ) : (
        <>
          {!c.contact_name && !c.relation && !c.phone && !c.email && !c.note ? (
            <p className="text-sm text-ink-soft">עוד לא נרשמו פרטים.</p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {c.contact_name && (
                <>
                  <dt className="text-ink-soft">שם</dt>
                  <dd className="min-w-0 break-words">
                    {c.contact_name}
                    {c.relation && <span className="text-ink-soft"> ({c.relation})</span>}
                  </dd>
                </>
              )}
              {!c.contact_name && c.relation && (
                <>
                  <dt className="text-ink-soft">קרבה</dt>
                  <dd>{c.relation}</dd>
                </>
              )}
              {c.phone && (
                <>
                  <dt className="text-ink-soft">טלפון</dt>
                  <dd className="min-w-0">
                    <bdi>{c.phone}</bdi>
                    {tel && (
                      <a href={tel} className="ms-2 font-semibold underline">
                        חיוג
                      </a>
                    )}
                  </dd>
                </>
              )}
              {c.email && (
                <>
                  <dt className="text-ink-soft">מייל</dt>
                  <dd className="min-w-0 break-all">
                    <bdi>{c.email}</bdi>
                  </dd>
                </>
              )}
              {c.note && (
                <>
                  <dt className="text-ink-soft">הערה</dt>
                  <dd className="min-w-0 break-words">{c.note}</dd>
                </>
              )}
            </dl>
          )}
          <Button onClick={() => setEditing(true)}>עריכת פרטי הקשר</Button>
        </>
      )}
      {week.edition.kind !== "real" && <p className="text-xs text-ink-soft">במחזור תרגול או הדגמה פרטי הקשר לא נפתחים, גם למדריך/ה — רק אדמין של כל המחזורים רואה אותם.</p>}
    </div>
  );
}

function ContactsForm({ c, name, busy, onSave, onCancel }: { c: FallenContacts; name: string; busy: boolean; onSave: (next: FallenContacts, onRefused: (code: string | null) => boolean) => Promise<void>; onCancel: () => void }) {
  const id = useId();
  const [d, setD] = useState<FallenContacts>({ ...EMPTY_FALLEN_CONTACTS, ...c });
  const [problem, setProblem] = useState<string | null>(null);
  const set = (p: Partial<FallenContacts>) => setD((x) => ({ ...x, ...p }));
  const text = (v: string | null) => (v && v.trim() ? v.trim() : null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    await onSave({ contact_name: text(d.contact_name), relation: text(d.relation), phone: text(d.phone), email: text(d.email), note: text(d.note) }, (code) => {
      if (!code || !["bad_phone", "bad_email", "bad_contact_email", "bad_value", "contacts_hidden"].includes(code)) return false;
      setProblem(code === "contacts_hidden" ? "פרטי הקשר של המשפחה גלויים רק למדריך/ה של מחזור אמיתי שיש בו תוכנית לחלל/ה." : errorMessage(code));
      return true;
    });
  };
  return (
    <form onSubmit={(e) => void submit(e)} aria-label={`עריכת פרטי הקשר של המשפחה: ${name}`} className="space-y-2" noValidate>
      <Field id={`${id}-n`} label="שם איש/אשת הקשר">
        <input id={`${id}-n`} value={d.contact_name ?? ""} maxLength={MEMORIAL_LIMITS.contact_name} onChange={(e) => set({ contact_name: e.target.value })} className={INPUT} autoComplete="off" />
      </Field>
      <Field id={`${id}-r`} label="קרבה" hint="למשל «אמא», «אח».">
        <input id={`${id}-r`} value={d.relation ?? ""} maxLength={MEMORIAL_LIMITS.relation} onChange={(e) => set({ relation: e.target.value })} className={INPUT} autoComplete="off" aria-describedby={`${id}-r-hint`} />
      </Field>
      <Field id={`${id}-p`} label="טלפון">
        <input id={`${id}-p`} type="tel" inputMode="tel" dir="ltr" value={d.phone ?? ""} maxLength={40} onChange={(e) => set({ phone: e.target.value })} className={INPUT} autoComplete="off" />
      </Field>
      <Field id={`${id}-e`} label="מייל">
        <input id={`${id}-e`} type="email" dir="ltr" value={d.email ?? ""} maxLength={254} onChange={(e) => set({ email: e.target.value })} className={INPUT} autoComplete="off" />
      </Field>
      <Field id={`${id}-o`} label="הערה">
        <textarea id={`${id}-o`} value={d.note ?? ""} maxLength={MEMORIAL_LIMITS.contact_note} onChange={(e) => set({ note: e.target.value })} rows={2} className={`${INPUT} py-2`} />
      </Field>
      {problem && <Problem>{problem}</Problem>}
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" type="submit" busy={busy} busyLabel="שומר…">
          שמירה
        </Button>
        <Button onClick={onCancel}>ביטול</Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ adding a plan; the fallen

/** The fallen an admin reads (all of them) — for «+ תוכנית» and the global list. */
function useFallen(port: DataPort, on: boolean): { list: Fallen[] | null; failed: boolean; load: () => Promise<void> } {
  const [list, setList] = useState<Fallen[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      setList(await port.memorial.fallen());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [port]);
  useEffect(() => {
    if (on) void load();
  }, [on, load]);
  return { list, failed, load };
}

function AddPlan({ port, week, cmds, busy, act }: Ctx) {
  const id = useId();
  const { list, failed, load } = useFallen(port, false);
  const [chosen, setChosen] = useState<number | "">("");
  const planned = new Set((week.memorialPlans ?? []).map((p) => p.fallen_id));
  const open = (list ?? []).filter((f) => f.active && !planned.has(f.id));
  // the list changes after a new plan (or a name added below): read it again with the week
  useEffect(() => void load(), [load, week]);
  return (
    <div className="mt-3 border-t border-line pt-3">
      {failed && !list ? (
        <p role="alert" className="text-sm text-bad">
          לא הצלחנו לטעון את רשימת החללים.
        </p>
      ) : open.length === 0 ? (
        <p className="text-sm text-ink-soft">{list == null ? "טוען…" : "לכל החללים ברשימה כבר יש תוכנית במחזור הזה."}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-48">
            <label htmlFor={id} className="text-sm font-semibold">
              תוכנית חדשה
            </label>
            <select id={id} value={chosen} onChange={(e) => setChosen(e.target.value === "" ? "" : Number(e.target.value))} className={SELECT}>
              <option value="">בחירת חלל/ה…</option>
              {open.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            kind="primary"
            disabled={chosen === ""}
            busy={busy === "add-plan"}
            busyLabel="מוסיף…"
            onClick={() => {
              if (chosen === "") return;
              void act("add-plan", () => cmds.addMemorialPlan(chosen), "התוכנית נוספה למגש").then((ok) => ok && setChosen(""));
            }}
          >
            + תוכנית
          </Button>
        </div>
      )}
    </div>
  );
}

/** The cross-year list (a global admin): add, rename, deactivate; delete one no edition planned for. */
function FallenList(props: Ctx) {
  const { port, busy, act } = props;
  const { list, failed, load } = useFallen(port, true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const run: Act = async (key, fn, ok, onRefused) => {
    const done = await act(key, fn, ok, onRefused);
    await load();
    return done;
  };
  return (
    <Panel title="רשימת החללים" aside="אחת לכל השנים · רק אדמין של כל המחזורים עורך/ת">
      <p className="mb-2 text-sm text-ink-soft">את השמות מכניסים רק כאן, באתר — לא בקובץ ולא בקוד.</p>
      {failed && !list && (
        <div role="alert" className="mb-2">
          <p className="text-sm text-bad">לא הצלחנו לטעון.</p>
          <Button onClick={() => void load()}>לנסות שוב</Button>
        </div>
      )}
      {list && list.length === 0 && <p className="text-sm text-ink-soft">עוד אין שמות ברשימה.</p>}
      {list && list.length > 0 && (
        <ul aria-label="החללים" className="divide-y divide-line">
          {list.map((f) => (
            <li key={f.id} data-fallen={f.id} className="py-2">
              {editing === f.id ? (
                <FallenForm initial={f} busy={busy === `fallen-${f.id}`} onCancel={() => setEditing(null)} onSave={async (fields, onRefused) => {
                  if (await run(`fallen-${f.id}`, () => port.memorial.saveFallen(f.id, fields), "נשמר", onRefused)) setEditing(null);
                }} />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 basis-40 break-words font-semibold">{f.name}</span>
                  {!f.active && <Badge tone="muted">לא פעיל/ה</Badge>}
                  <Button onClick={() => setEditing(f.id)} aria-label={`עריכה: ${f.name}`}>
                    עריכה
                  </Button>
                  {asking !== f.id && (
                    <Button kind="danger" onClick={() => setAsking(f.id)} aria-label={`מחיקה: ${f.name}`}>
                      מחיקה
                    </Button>
                  )}
                  {f.note && <p className="w-full text-xs text-ink-soft">{f.note}</p>}
                  {asking === f.id && (
                    <div className="w-full">
                      <Confirm
                        text={<>למחוק את «{f.name}» מהרשימה? אם יש לו/ה תוכנית באחד המחזורים, אי אפשר — מסמנים «לא פעיל/ה» במקום.</>}
                        confirm="כן, למחוק"
                        busy={busy === `fallen-del-${f.id}`}
                        onConfirm={() => void run(`fallen-del-${f.id}`, () => port.memorial.deleteFallen(f.id), "נמחק מהרשימה").then(() => setAsking(null))}
                        onCancel={() => setAsking(null)}
                      />
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="mt-3">
          <FallenForm initial={null} busy={busy === "fallen-new"} onCancel={() => setAdding(false)} onSave={async (fields, onRefused) => {
            if (await run("fallen-new", () => port.memorial.saveFallen(null, fields), "נוסף לרשימה", onRefused)) setAdding(false);
          }} />
        </div>
      ) : (
        <Button className="mt-3" onClick={() => setAdding(true)}>
          + שם לרשימה
        </Button>
      )}
    </Panel>
  );
}

function FallenForm({ initial, busy, onSave, onCancel }: { initial: Fallen | null; busy: boolean; onSave: (f: { name: string; gender: Gender | null; note: string | null; active: boolean }, onRefused: (code: string | null) => boolean) => Promise<void>; onCancel: () => void }) {
  const id = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [gender, setGender] = useState<Gender | null>(initial?.gender ?? null);
  const [note, setNote] = useState(initial?.note ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!name.trim()) return setProblem(errorMessage("name_required"));
    await onSave({ name: name.trim(), gender, note: note.trim() || null, active }, (code) => {
      if (code !== "name_required" && code !== "bad_value" && code !== "in_use") return false;
      setProblem(code === "in_use" ? "יש לו/ה תוכנית באחד המחזורים: אפשר לסמן «לא פעיל/ה» במקום." : errorMessage(code));
      return true;
    });
  };
  return (
    <form onSubmit={(e) => void submit(e)} aria-label={initial ? `עריכה: ${initial.name}` : "שם חדש לרשימת החללים"} className="space-y-2 rounded-lg border border-line bg-paper p-3" noValidate>
      <Field id={`${id}-n`} label="שם">
        <input id={`${id}-n`} value={name} maxLength={MEMORIAL_LIMITS.name} onChange={(e) => setName(e.target.value)} className={INPUT} autoComplete="off" />
      </Field>
      <GenderField name={`${id}-g`} value={gender} onChange={setGender} />
      <Field id={`${id}-o`} label="הערה (גלויה לכל מדריך/ה ולצוות של מחזור שיש בו תוכנית)">
        <textarea id={`${id}-o`} value={note} maxLength={MEMORIAL_LIMITS.note} onChange={(e) => setNote(e.target.value)} rows={2} className={`${INPUT} py-2`} />
      </Field>
      <label className="flex min-h-11 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-5 accent-ink" />
        פעיל/ה (אפשר לפתוח לו/ה תוכנית)
      </label>
      {problem && <Problem>{problem}</Problem>}
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" type="submit" busy={busy} busyLabel="שומר…">
          שמירה
        </Button>
        <Button onClick={onCancel}>ביטול</Button>
      </div>
    </form>
  );
}

