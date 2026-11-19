// «היום שלי» — a trainee's home (the reset, phase 2; `/` for a trainee — staff have «ימים», `/day/:d`, phase 3). The day
// (or days, a tab each) an edition admin gave me with a partner: its header (date, partner, the closed lessons'
// balance), its slots in time order each with ONE next step, the lessons of the day someone else handles («חדש» since
// I last looked, and «ראיתי» — the notification the owner asked for), and the speakers who said they can come to a free
// slot. Above them, the hand-overs offered to me («הוצעו לך»). Nothing else: no lens, no warnings, no topic axis. The
// logic is src/domain/myDay.ts (pure, tested); the pieces are parts.tsx, shared with «ימים».
import { type KeyboardEvent, useMemo, useRef } from "react";
import { useSearchParams } from "react-router";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { hasFresh, myDay, offeredTo, ownedDays } from "../../domain/myDay";
import { DAY_NAMES, type Day } from "../../domain/time";
import { buildModel } from "../../grid/model";
import { todayColumn } from "../../offline/view";
import { Button, useRunner } from "../settings/kit";
import { EditionSelect, useToast } from "../speakers/parts";
import { actorIn, useWeekStore } from "../weekStore";
import { DayHead, DaySpeakers, OffersLine, OthersSection, PillLink, SlotRow } from "./parts";

export function MyDayScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const { notify, clear, node } = useToast();
  const { busy, run } = useRunner(notify, clear);
  const [params, setParams] = useSearchParams();
  const tabRefs = useRef(new Map<Day, HTMLButtonElement>());
  const actor = actorIn(me, week?.edition);
  const model = useMemo(() => (week ? buildModel(week) : null), [week]);

  // a home: the week screen's own notice (a trainee is never the one who opens an edition)
  if (store.problem === "none") {
    return (
      <div className="mx-auto mt-8 max-w-lg rounded-xl border border-line bg-card p-5 shadow-sm">
        <h2 className="mb-2 font-display text-xl font-extrabold text-navy">עוד לא נפתח מחזור</h2>
        <p className="text-ink-soft">המדריך/ה עוד לא פתח/ה את המחזור של השנה.</p>
      </div>
    );
  }
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון את השבוע. כדאי לרענן את הדף.</p>;
  if (!week || !model) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  const days: Day[] = ownedDays(week, actor.memberId);
  const offers = <OffersLine model={model} offers={offeredTo(week, actor.memberId)} />;

  if (days.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Title />
        {offers}
        <section data-myday-empty className="rounded-2xl border border-line bg-card p-6 shadow-sm sm:p-8">
          <p className="text-lg text-ink">עוד לא נקבע לך יום. אנשי הצוות קובעים זאת בהגדרות.</p>
          <p className="mt-2 text-ink-soft">בינתיים אפשר לעבור על המרצים במאגר.</p>
          <div className="mt-4">
            <PillLink to="/speakers" kind="primary">
              מרצים
            </PillLink>
          </div>
        </section>
      </div>
    );
  }

  const asked = Number(params.get("day"));
  const today = todayColumn(week.edition.start_date, new Date().toISOString());
  const day: Day = days.find((d) => d === asked && params.has("day")) ?? days.find((d) => d === today) ?? days[0];
  const viewer = actor.memberId;
  const d = myDay(model, day, viewer);
  const nameOf = (id: number) => model.memberName.get(id) ?? "חבר/ת צוות";
  const isOwner = d.owners.includes(actor.memberId);

  const choose = (to: Day) => {
    clear();
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set("day", String(to));
      return next;
    }, { replace: true });
    tabRefs.current.get(to)?.focus();
  };
  // arrow keys move between the tabs (right to left: ← is the next one), Home/End to the ends
  const onKey = (e: KeyboardEvent) => {
    const i = days.indexOf(day);
    const next = { ArrowLeft: i + 1, ArrowRight: i - 1, Home: 0, End: days.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    choose(days[(next + days.length) % days.length]);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Title />
        <EditionSelect />
      </div>
      {offers}

      {days.length > 1 && (
        <div role="tablist" aria-label="הימים שלי" onKeyDown={onKey} className="flex gap-1 overflow-x-auto border-b border-line">
          {days.map((x) => {
            const selected = x === day;
            return (
              <button
                key={x}
                ref={(el) => {
                  if (el) tabRefs.current.set(x, el);
                }}
                type="button"
                role="tab"
                id={`myday-tab-${x}`}
                aria-selected={selected}
                aria-controls="myday-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => choose(x)}
                className={`-mb-px min-h-11 shrink-0 rounded-t-lg border-b-[3px] px-4 font-bold transition-colors ${selected ? "border-navy text-navy" : "border-transparent text-ink-soft hover:bg-accent-soft hover:text-navy"}`}
              >
                יום {DAY_NAMES[x]}
              </button>
            );
          })}
        </div>
      )}

      <div role={days.length > 1 ? "tabpanel" : undefined} id="myday-panel" aria-labelledby={days.length > 1 ? `myday-tab-${day}` : undefined} className="space-y-6" data-myday={day}>
        <DayHead
          model={model}
          d={d}
          weekTo="/week"
          who={
            <span data-partner className="text-ink">
              {d.partners.length > 0 ? `בזוג עם ${d.partners.map(nameOf).join(" ו")}` : "בלי בן/בת זוג"}
            </span>
          }
        />

        <section aria-labelledby="myday-slots" className="space-y-2">
          <h3 id="myday-slots" className="font-display text-lg font-bold text-navy">
            המשבצות של היום
          </h3>
          <ol className="space-y-2">
            {d.slots.map((c) => (
              <SlotRow key={c.key} model={model} card={c} viewer={viewer} nameOf={nameOf} />
            ))}
          </ol>
        </section>

        {d.others.length > 0 && (
          <OthersSection
            model={model}
            d={d}
            nameOf={nameOf}
            id="myday-others"
            title="משבצות ביום שלכם שמטופלות על ידי אחרים"
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
                    document.getElementById("myday-others")?.focus();
                  }}
                >
                  ראיתי
                </Button>
              )
            }
          />
        )}

        <DaySpeakers model={model} d={d} title="מרצים שיכולים ביום שלכם" />
      </div>
      {node}
    </div>
  );
}

function Title() {
  return <h2 className="font-display text-2xl font-extrabold text-navy">היום שלי</h2>;
}

