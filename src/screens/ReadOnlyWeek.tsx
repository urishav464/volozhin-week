// «השבוע» for a trainee (the reset, phase 2; `/week`): the week to read — the full grid on a wide screen, the day
// view on a phone or a tablet (as the week screen chooses) — with nothing to place, shape or drag; a lesson card opens
// its page (`/lesson/:id`), a memorial slot «זמני זיכרון». The days I own are marked («היום שלי»). The old grid, which
// writes, stays at `/grid` (and `/` for staff); OfflineWeek.tsx stays the copy without internet. No warnings' counts:
// they are the staff's to act on, and nothing a trainee can open here explains them (no day panel, no warnings list).
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { personaOf } from "../data/gate";
import type { DataPort } from "../data/port";
import type { Me } from "../data/types";
import { ownedDays } from "../domain/myDay";
import { lessonPath } from "../domain/routes";
import type { Day } from "../domain/time";
import { DayView } from "../grid/DayView";
import { GridDesktop } from "../grid/GridDesktop";
import { buildModel, type GridModel } from "../grid/model";
import { useMedia } from "../lib/useMedia";
import { todayColumn } from "../offline/view";
import { EditionSelect } from "./speakers/parts";
import { actorIn, useWeekStore } from "./weekStore";

/** The model without its warnings: the cards' and the day headers' amber counts are left out (the day's balance stays). */
export function withoutWarnings(m: GridModel): GridModel {
  return { ...m, warnings: [], warningCount: new Map(), days: m.days.map((d) => ({ ...d, warnings: [] })) };
}

export function ReadOnlyWeek({ me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const wide = useMedia("(min-width: 1024px)");
  const navigate = useNavigate();
  const model = useMemo(() => (week ? withoutWarnings(buildModel(week)) : null), [week]);
  const actor = actorIn(me, week?.edition);
  const mineDays = useMemo(() => (week ? ownedDays(week, actor.memberId) : []), [week, actor.memberId]);
  const mine = useMemo(() => new Set<Day>(mineDays), [mineDays]);
  const [picked, setPicked] = useState<Day | null>(null);

  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!week || !model) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  // the phone opens on today's column while the week runs, else on my first day
  const day: Day = picked ?? todayColumn(week.edition.start_date, new Date().toISOString()) ?? mineDays[0] ?? 0;
  const onLesson = (id: number) => {
    const l = week.lessons.find((x) => x.id === id);
    navigate(l?.kind === "memorial" ? "/memorial" : lessonPath(id));
  };
  const nothing = () => undefined;

  return (
    <div className="flex flex-col gap-2" data-readonly-week>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-display text-xl font-extrabold text-navy">השבוע — לצפייה בלבד</h2>
        <EditionSelect />
        {/* staff preview this page by its address: their «/» is the week that writes */}
        <Link to="/" className="ms-auto inline-flex min-h-11 items-center text-sm font-bold text-navy underline-offset-4 hover:underline">
          {personaOf(me, store.editionId) === "trainee" ? "להיום שלי" : "לרשת השבוע"}
        </Link>
      </div>
      {wide ? (
        <div className="min-w-0 overflow-auto rounded-lg" style={{ height: "calc(100dvh - 9.5rem)" }}>
          <GridDesktop model={model} lens="diversity" placing={null} overKey={null} onCell={nothing} onLesson={onLesson} readOnly mine={mine} />
        </div>
      ) : (
        <div className="mx-auto w-full max-w-3xl pb-6">
          <DayView model={model} lens="diversity" day={day} onDay={setPicked} placing={null} onCell={nothing} onLesson={onLesson} readOnly mine={mine} />
        </div>
      )}
    </div>
  );
}
