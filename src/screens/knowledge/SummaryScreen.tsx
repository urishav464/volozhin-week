// «סיכום המחזור» (/knowledge/summary, the edition's admins and content members —
// it lists «איך עבר», opinions about people): the year in numbers from the
// loaded Week, the edition's reviews and the returning speakers
// (src/exports/summary.ts) — lessons held, each day's speakers by gender
// (memorial times never count), the categories, new and returning speakers,
// reviews written and missing, «להזמין שוב» / «לא להזמין» / «אולי». Counts only:
// no threshold says «too few» (none was decided). Print (A4) and xlsx, made in
// this browser through the one writer (guardCell on every cell).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { DataPort } from "../../data/port";
import type { LessonReview, ReturningSpeaker } from "../../data/reviews";
import type { Me } from "../../data/types";
import { download, fileName, israelDay } from "../../exports/download";
import { editionSummary, INVITE_TITLE, type SummaryLesson, summaryTables, tally } from "../../exports/summary";
import { israelDate } from "../../exports/tracking";
import { toXlsx, XLSX_MIME } from "../../exports/xlsx";
import type { InviteAgain } from "../../domain/reviews";
import { DAY_NAMES } from "../../domain/time";
import { PrintSetup } from "../outputs/parts";
import { Button, Panel } from "../settings/kit";
import { EditionSelect, useToast } from "../speakers/parts";
import { actorIn, useWeekStore } from "../weekStore";
import { KnowledgeTabs } from "./tabs";

export function SummaryScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const navigate = useNavigate();
  const { notify, node } = useToast();
  const actor = actorIn(me, week?.edition);
  const editionId = week?.edition.id ?? null;
  const [data, setData] = useState<{ edition: number; reviews: LessonReview[]; returning: ReturningSpeaker[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    if (editionId == null || actor.role === "logistics") return;
    setFailed(false);
    try {
      const [reviews, returning] = await Promise.all([port.reviews.ofEdition(editionId), port.reviews.returning(editionId)]);
      setData({ edition: editionId, reviews, returning });
    } catch {
      setFailed(true);
    }
  }, [port, editionId, actor.role]);
  useEffect(() => void load(), [load]);
  const summary = useMemo(() => (week && data?.edition === week.edition.id ? editionSummary(week, data.reviews, data.returning) : null), [week, data]);

  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error" || failed) return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!week) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;
  if (actor.role === "logistics") {
    return (
      <div className="mx-auto max-w-3xl space-y-4 pb-20">
        <h2 className="font-display text-2xl font-extrabold">סיכום המחזור</h2>
        <p className="text-ink-soft">הסיכום כולל «איך עבר» — דעות על מרצים — ולכן הוא לצוות התוכן ולמדריך/ה.</p>
      </div>
    );
  }
  if (!summary) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  const s = summary;
  const save = () => {
    download(fileName("summary", week.edition, israelDay(), "xlsx"), toXlsx(summaryTables(s)), XLSX_MIME);
    notify("ok", "הקובץ ירד. יש בו «איך עבר» — דעות על מרצים: לא לשתף מחוץ לצוות.");
  };
  const open = (id: number) => navigate("/", { state: { lesson: id } });

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-20">
      <PrintSetup landscape={false} title={`סיכום המחזור · שבוע וולוז'ין ${week.edition.label}`}>
        <p className="text-sm">הודפס ב-{israelDate(new Date().toISOString())} · יש כאן «איך עבר»: לצוות בלבד</p>
      </PrintSetup>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
        <h2 className="font-display text-2xl font-extrabold">סיכום המחזור</h2>
        <EditionSelect />
        <KnowledgeTabs actor={actor} />
      </div>
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button onClick={() => window.print()}>הדפסה</Button>
        <Button onClick={save}>הורדה כ-xlsx</Button>
      </div>
      <p className="text-sm text-ink-soft print:hidden">
        המספרים מהשבוע כפי שהוא עכשיו. אין כאן ספים או ציונים של «טוב» ו«לא טוב»: רק מה שקרה. «איך עבר» הוא דעה על מרצים — לצוות התוכן ולמדריך/ה בלבד, ולא לשתף את הקובץ מחוץ לצוות.
      </p>

      <Panel title="במספרים">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
          <dt className="text-ink-soft">שיעורים שהתקיימו</dt>
          <dd data-summary="held" className="font-semibold">{s.held}</dd>
          <dt className="text-ink-soft">זמני זיכרון (עם תוכנית)</dt>
          <dd className="font-semibold">{s.memorial}</dd>
          <dt className="text-ink-soft">מרצים</dt>
          <dd className="font-semibold">{s.speakers.total}</dd>
          <dt className="text-ink-soft">«איך עבר» נכתב</dt>
          <dd data-summary="reviews" className="font-semibold">
            {s.reviews.done} מתוך {s.reviews.total}
          </dd>
        </dl>
      </Panel>

      <Panel title="מגדר לפי יום" aside="שיעורים סגורים, בלי זמני זיכרון">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="text-start text-ink-soft">
              <th className="text-start font-semibold">יום</th>
              <th className="text-start font-semibold">שיעורים</th>
              <th className="text-start font-semibold">נשים</th>
              <th className="text-start font-semibold">גברים</th>
              <th className="text-start font-semibold">לא ידוע</th>
            </tr>
          </thead>
          <tbody>
            {s.days.map((d) => (
              <tr key={d.day} data-day={d.day} className="border-t border-line">
                <td className="py-1">{DAY_NAMES[d.day]}</td>
                <td>{d.lessons}</td>
                <td>{tally(d.f)}</td>
                <td>{tally(d.m)}</td>
                <td>{tally(d.unknown)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-ink-soft">שיעור עם שני מרצים נספר חצי לכל אחד/ת.</p>
      </Panel>

      <Panel title="קטגוריות">
        {s.categories.length === 0 ? (
          <p className="text-sm text-ink-soft">אין שיעורים סגורים.</p>
        ) : (
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {s.categories.map((c) => (
              <li key={c.name} className="flex justify-between gap-2 rounded-md bg-paper px-2 py-1">
                <span className="min-w-0 break-words">{c.name}</span>
                <span className="font-semibold">{c.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="מרצים" aside={`${s.speakers.fresh.length} חדשים · ${s.speakers.returning.length} לימדו בשנים קודמות`}>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <h4 className="font-semibold">לימדו בשנים קודמות</h4>
            {s.speakers.returning.length === 0 ? (
              <p className="text-ink-soft">אין.</p>
            ) : (
              <ul aria-label="לימדו בשנים קודמות">
                {s.speakers.returning.map((x) => (
                  <li key={x.id}>
                    {x.name} <span className="text-ink-soft">({x.editions.join(", ")})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="font-semibold">חדשים</h4>
            {s.speakers.fresh.length === 0 ? (
              <p className="text-ink-soft">אין.</p>
            ) : (
              <ul aria-label="מרצים חדשים">
                {s.speakers.fresh.map((x) => (
                  <li key={x.id}>{x.name}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="איך עבר" aside={`${s.reviews.done} מתוך ${s.reviews.total} נכתבו`}>
        <div className="space-y-3 text-sm">
          {(["yes", "no", "maybe"] as InviteAgain[]).map((k) => (
            <div key={k}>
              <h4 className="font-semibold">
                {INVITE_TITLE[k]} ({s.invite[k].length})
              </h4>
              {s.invite[k].length === 0 ? (
                <p className="text-ink-soft">אין.</p>
              ) : (
                <ul aria-label={INVITE_TITLE[k]} className="space-y-1">
                  {s.invite[k].map((l) => (
                    <li key={l.lesson_id} className="rounded-md bg-paper px-2 py-1">
                      <LessonLink l={l} open={open} />
                      {l.rating != null && <span className="text-ink-soft"> · ציון {l.rating}/5</span>}
                      {(l.went_well || l.issues) && <span className="block whitespace-pre-line break-words text-ink-soft">{[l.went_well, l.issues].filter(Boolean).join(" · ")}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <div>
            <h4 className="font-semibold">עוד לא נכתב ({s.reviews.missing.length})</h4>
            {s.reviews.missing.length === 0 ? (
              <p className="text-ink-soft">נכתב «איך עבר» לכל השיעורים.</p>
            ) : (
              <ul aria-label="עוד לא נכתב" className="space-y-1">
                {s.reviews.missing.map((l) => (
                  <li key={l.lesson_id}>
                    <LessonLink l={l} open={open} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>
      {node}
    </div>
  );
}

function LessonLink({ l, open }: { l: SummaryLesson; open: (id: number) => void }) {
  return (
    <button type="button" onClick={() => open(l.lesson_id)} className="min-h-11 text-start underline-offset-2 hover:underline print:min-h-0">
      <b>{l.speaker}</b> · <bdi>{l.when}</bdi> · {l.title ?? "TBD"}
    </button>
  );
}
