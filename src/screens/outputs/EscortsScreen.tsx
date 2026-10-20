// «רשימת מלווים» (/print/escorts, every member): for each escort — their name
// and how many lessons — each lesson's day, time, room, speaker, title, who
// introduces the speaker, and «משהו שחשוב לדעת» (the instructor's duty phrases
// that apply, then the lesson's note). Printed A4, an escort per page if asked.
// No phones unless «כולל טלפונים», and then only the ones the caller may see.
// On screen only, each lesson's four ticks from the escort's link (not printed:
// the printed list is handed to the escort).
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { escortGroups } from "../../exports/escorts";
import { israelDate } from "../../exports/tracking";
import { Button } from "../settings/kit";
import { EditionSelect } from "../speakers/parts";
import { EscortTicksLine } from "../stages/parts";
import { actorIn, useWeekStore } from "../weekStore";
import { OutputsTabs, PhonesToggle, PrintSetup, usePhones } from "./parts";

export function EscortsScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const [pagePerEscort, setPagePerEscort] = useState(false);
  const actor = actorIn(me, week?.edition);
  const groups = useMemo(() => (week ? escortGroups(week) : []), [week]);
  const { on: withPhones, setOn: setWithPhones, phones, failed } = usePhones(port, week, actor);

  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!week) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  const noPhrases = !(week.edition.settings?.duty_phrases?.length);
  const escorts = groups.filter((g) => g.escort != null);
  const title = `רשימת מלווים · שבוע וולוז'ין ${week.edition.label}`;
  const printed = `הודפס ב-${israelDate(new Date().toISOString())}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-20">
      <PrintSetup landscape={false} title={title}>
        <p className="text-sm">
          {printed}
          {phones ? " · כולל טלפונים: מידע אישי" : ""}
        </p>
      </PrintSetup>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
        <h2 className="font-display text-2xl font-extrabold">רשימת מלווים</h2>
        <EditionSelect />
        <OutputsTabs admin={actor.isAdmin} />
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-xl border border-line bg-card p-3 print:hidden">
        <PhonesToggle actor={actor} week={week} on={withPhones} setOn={setWithPhones} failed={failed} />
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
          <input type="checkbox" checked={pagePerEscort} onChange={(e) => setPagePerEscort(e.target.checked)} className="size-4 accent-ink" />
          בהדפסה: כל מלווה בעמוד משלו
        </label>
        <Button className="sm:ms-auto" onClick={() => window.print()}>
          הדפסה
        </Button>
      </div>

      {noPhrases && (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm print:hidden">
          הניסוחים של «משהו שחשוב לדעת» עוד לא הודבקו, ולכן מופיעות כאן רק ההערות של כל שיעור.{" "}
          {actor.isAdmin ? (
            <Link to="/settings/templates" className="font-semibold underline">
              מדביקים אותם בהגדרות ← «תבניות»
            </Link>
          ) : (
            "המדריך/ה מדביק/ה אותם בהגדרות ← «תבניות»."
          )}
        </p>
      )}

      {escorts.length === 0 && <p className="rounded-xl border border-line bg-card p-4 text-ink-soft">עוד לא שובצו מלווים לשיעורים במחזור הזה. משבצים מלווה בלוח של שיעור סגור, בשלב «מלווה».</p>}

      {groups.map((g, i) => (
        <section
          key={g.escort?.id ?? "none"}
          aria-label={g.heading}
          className={`rounded-xl border border-line bg-card p-4 print:rounded-none print:border-0 print:border-b print:p-0 print:pb-3 ${pagePerEscort && i > 0 ? "print:break-before-page" : ""} ${g.escort == null ? "print:hidden" : ""}`}
        >
          {/* a page of its own, handed to the escort, says which week and which print it is */}
          {pagePerEscort && i > 0 && (
            <p className="hidden text-xs text-ink-soft print:block">
              {title} · {printed}
            </p>
          )}
          <h3 className="font-display text-lg font-semibold">{g.heading}</h3>
          <p className="mb-2 text-sm text-ink-soft">{g.load}</p>
          <ol className="space-y-3">
            {g.lessons.map((x) => {
              const phone = phones?.get(x.lesson.id);
              return (
                <li key={x.lesson.id} data-lesson-row={x.lesson.id} className="break-inside-avoid border-t border-line pt-2 first:border-t-0 first:pt-0">
                  <p className="font-semibold">
                    {x.dayLabel} <bdi dir="ltr">{x.time}</bdi> · {x.room}
                  </p>
                  <p>
                    {x.speaker || "—"} · {x.title}
                    {phone && (
                      <>
                        {" "}
                        · טלפון: <bdi>{phone}</bdi>
                      </>
                    )}
                  </p>
                  <p className="text-sm">
                    <b>{x.intro}</b> — {x.introDetail}
                  </p>
                  {g.escort != null && (
                    <div className="mt-1">
                      <EscortTicksLine week={week} lessonId={x.lesson.id} />
                    </div>
                  )}
                  {x.notes.length > 0 && (
                    <div className="mt-1 text-sm">
                      <p className="font-semibold">משהו שחשוב לדעת</p>
                      <ul className="list-disc ps-5">
                        {x.notes.map((n, k) => (
                          <li key={k} className="whitespace-pre-line">
                            {n}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
