// «ימים» — the staff's day page (the reset, phase 3; `/day/:d`). Any of the five days as a wide page: a tab each, the
// day's pair named (or «אין עדיין זוג ליום», with the way to «הגדרות ← צוות ← ימים» for an admin), the closed lessons'
// balance, the slots in time order each with its next step — staff may act on every lesson (myDay's staff mode; the
// RPCs decide) — the lessons handled by someone outside the pair highlighted («חריגים»; none on a day with no pair),
// and the speakers who can come. «ראיתי» only for an owner of the day; for an admin, the way to that day in «אתר האורחים»
// (the reset, phase 5). A trainee is sent to their own home (`/?day=d`
// on a day of theirs), logistics to theirs (`/logistics`, nav.ts dayRedirect).
import { type KeyboardEvent, useMemo, useRef } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { personaOf } from "../../data/gate";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { hasFresh, myDay, ownedDays, staffDay } from "../../domain/myDay";
import { dayPath, guestsPath, parseDay } from "../../domain/routes";
import { DAYS, DAY_NAMES, type Day } from "../../domain/time";
import { buildModel } from "../../grid/model";
import { pairText } from "../../grid/owners";
import { dayRedirect } from "../nav";
import { Button, useRunner } from "../settings/kit";
import { EditionSelect, useToast } from "../speakers/parts";
import { actorIn, useWeekStore } from "../weekStore";
import { DayHead, DaySpeakers, OthersSection, SlotRow } from "./parts";

export function DayScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const params = useParams();
  const navigate = useNavigate();
  const { notify, clear, node } = useToast();
  const { busy, run } = useRunner(notify, clear);
  const tabRefs = useRef(new Map<Day, HTMLButtonElement>());
  const actor = actorIn(me, week?.edition);
  const model = useMemo(() => (week ? buildModel(week) : null), [week]);

  if (store.problem === "none") {
    return (
      <div className="mx-auto mt-8 max-w-lg rounded-xl border border-line bg-card p-5 shadow-sm">
        <h2 className="mb-2 font-display text-xl font-extrabold text-navy">עוד לא נפתח מחזור</h2>
        <p className="text-ink-soft">אפשר לפתוח מחזור ב«הגדרות ← מחזור».</p>
      </div>
    );
  }
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון את השבוע. כדאי לרענן את הדף.</p>;
  if (!week || !model) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  const asked = params.d === undefined ? null : parseDay(params.d);
  // the day pages are the staff's: a trainee goes home (to that day, when it is one of theirs), logistics too
  const persona = personaOf(me, week.edition.id);
  const elsewhere = dayRedirect(persona);
  if (elsewhere) return <Navigate replace to={elsewhere} />;
  if (persona === "trainee") return <Navigate replace to={asked != null && ownedDays(week, actor.memberId).includes(asked) ? `/?day=${asked}` : "/"} />;
  // a day that is not one of the five: the page's own default
  if (params.d !== undefined && asked == null) return <Navigate replace to={dayPath()} />;

  const day: Day = asked ?? staffDay(week, actor.memberId, new Date().toISOString());
  const viewer = actor.memberId;
  const d = myDay(model, day, viewer, { staff: true });
  const nameOf = (id: number) => model.memberName.get(id) ?? "חבר/ת צוות";
  const isOwner = d.owners.includes(viewer);
  const exceptions = new Set(d.others.map((o) => o.lessonId));

  const choose = (to: Day) => {
    clear();
    navigate(dayPath(to), { replace: true });
    tabRefs.current.get(to)?.focus();
  };
  // arrow keys move between the tabs (right to left: ← is the next one), Home/End to the ends
  const onKey = (e: KeyboardEvent) => {
    const i = DAYS.indexOf(day);
    const next = { ArrowLeft: i + 1, ArrowRight: i - 1, Home: 0, End: DAYS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    choose(DAYS[(next + DAYS.length) % DAYS.length]);
  };

  const who =
    d.owners.length > 0 ? (
      <span data-day-pair={d.owners.join(",")} className="font-semibold text-ink">
        {pairText(model, day)}
      </span>
    ) : (
      <span data-day-pair="" className="text-ink-soft">
        אין עדיין זוג ליום
        {actor.isAdmin ? (
          <>
            {" — "}
            <Link to="/settings/team" className="inline-flex min-h-11 items-center font-bold text-navy underline underline-offset-4 hover:text-navy-800">
              קובעים ב«הגדרות ← צוות ← ימים»
            </Link>
          </>
        ) : (
          " — קובעים ב«הגדרות ← צוות ← ימים»"
        )}
      </span>
    );

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-display text-2xl font-extrabold text-navy">ימים</h2>
        <EditionSelect />
      </div>

      <div role="tablist" aria-label="ימי השבוע" onKeyDown={onKey} className="flex gap-1 overflow-x-auto border-b border-line">
        {DAYS.map((x) => {
          const selected = x === day;
          const mine = ownedDays(week, viewer).includes(x);
          return (
            <button
              key={x}
              ref={(el) => {
                if (el) tabRefs.current.set(x, el);
              }}
              type="button"
              role="tab"
              id={`day-tab-${x}`}
              aria-selected={selected}
              aria-controls="day-panel"
              tabIndex={selected ? 0 : -1}
              // the chip is a word of its own: «שני (שלי)», never «שנישלי» (the gap between them is only drawn)
              aria-label={mine ? `${DAY_NAMES[x]} (שלי)` : undefined}
              onClick={() => choose(x)}
              data-day-tab={x}
              data-mine={mine || undefined}
              className={`-mb-px min-h-11 shrink-0 rounded-t-lg border-b-[3px] px-4 font-bold transition-colors ${selected ? "border-navy text-navy" : "border-transparent text-ink-soft hover:bg-accent-soft hover:text-navy"}`}
            >
              {DAY_NAMES[x]}
              {mine && <span className="ms-1 rounded-full bg-navy px-1.5 text-[10px] font-semibold leading-4 text-white">שלי</span>}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="day-panel" aria-labelledby={`day-tab-${day}`} className="space-y-6" data-day-page={day}>
        <DayHead model={model} d={d} who={who} weekTo="/" />

        <section aria-labelledby="day-slots" className="space-y-2">
          <h3 id="day-slots" className="font-display text-lg font-bold text-navy">
            המשבצות של היום
          </h3>
          <ol className="space-y-2">
            {d.slots.map((c) => (
              <SlotRow key={c.key} model={model} card={c} viewer={viewer} nameOf={nameOf} showHandler exception={c.lessonId != null && exceptions.has(c.lessonId)} />
            ))}
          </ol>
          {actor.isAdmin && (
            <Link to={guestsPath({ day })} className="inline-flex min-h-11 items-center font-bold text-navy underline underline-offset-4 hover:text-navy-800" data-day-guests>
              אתר האורחים ליום הזה ‹
            </Link>
          )}
        </section>

        {d.others.length > 0 && (
          <OthersSection
            model={model}
            d={d}
            nameOf={nameOf}
            id="day-others"
            title="חריגים — בטיפול מי שאינו מהזוג"
            fresh={isOwner}
            action={
              isOwner &&
              hasFresh(d) && (
                <Button
                  className="ms-auto"
                  busy={busy === "seen"}
                  onClick={async () => {
                    if (!(await run("seen", () => port.commands(week.edition.id).markDaySeen(day), null))) return;
                    await store.reload();
                    // the button goes with the «חדש» marks: the focus stays with the list
                    document.getElementById("day-others")?.focus();
                  }}
                >
                  ראיתי
                </Button>
              )
            }
          />
        )}

        <DaySpeakers model={model} d={d} title="מרצים שיכולים ביום" />
      </div>
      {node}
    </div>
  );
}
