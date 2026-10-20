// «טבלת מעקב» (/tracking, every member): one row per lesson in grid order, last
// year's columns and stage colours (src/exports/tracking.ts). Filters: the day,
// what is still missing, «שלי». Out: print (A4 landscape, the header row on
// every page, a page per day if asked), xlsx and CSV of the rows shown — made
// in this browser, nothing uploaded. Phones only behind «כולל טלפונים».
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { csvBytes } from "../../exports/csv";
import { CSV_MIME, download, fileName, israelDay } from "../../exports/download";
import { PROGRESS_TONE } from "../../domain/progress";
import { DAY_NAMES, DAYS, type Day } from "../../domain/time";
import {
  filterTracking, israelDate, STAGE_FILTER_LABEL, TRACKING_HEADERS, type TrackingRow, type TrackingStage, trackingRows, trackingTable, trackingWidths,
} from "../../exports/tracking";
import { toXlsx, XLSX_MIME } from "../../exports/xlsx";
import { useMedia } from "../../lib/useMedia";
import { Button } from "../settings/kit";
import { EditionSelect, useToast } from "../speakers/parts";
import { actorIn, useWeekStore } from "../weekStore";
import { OutputsTabs, PhonesToggle, PrintSetup, SELECT, ToneLegend, usePhones } from "./parts";

const STAGES: TrackingStage[] = ["draft", "payment", "reconfirm", "send", "escort", "sources", "ready", "memorial"];

export function TrackingScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const wide = useMedia("(min-width: 1024px)");
  const navigate = useNavigate();
  const { notify, node } = useToast();
  const [day, setDay] = useState<Day | null>(null);
  const [stage, setStage] = useState<TrackingStage | null>(null);
  const [mine, setMine] = useState(false);
  const [pagePerDay, setPagePerDay] = useState(false);
  const actor = actorIn(me, week?.edition);
  const all = useMemo(() => (week ? trackingRows(week) : []), [week]);
  const rows = useMemo(() => filterTracking(all, { day, stage, mine: mine ? actor.memberId : null }), [all, day, stage, mine, actor.memberId]);
  const { on: withPhones, setOn: setWithPhones, phones, failed } = usePhones(port, week, actor);

  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!week) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  const label = week.edition.label;
  const showPhones = phones != null; // only while «כולל טלפונים» is on and offered here (usePhones)
  const name = (ext: string) => fileName(showPhones ? "tracking-with-phones" : "tracking", week.edition, israelDay(), ext);
  const table = () => trackingTable(rows, label, showPhones ? phones : undefined);
  const save = (kind: "xlsx" | "csv") => {
    if (kind === "xlsx") download(name("xlsx"), toXlsx([table()]), XLSX_MIME);
    else download(name("csv"), csvBytes(table()), CSV_MIME);
    notify("ok", showPhones ? "הקובץ ירד. יש בו טלפונים: לא לשתף, ולמחוק כשמסיימים." : "הקובץ ירד.");
  };
  const open = (id: number) => navigate("/", { state: { lesson: id } });
  const days = DAYS.filter((d) => rows.some((r) => r.day === d));
  const filtered = day != null || stage != null || mine;
  const printed = `הודפס ב-${israelDate(new Date().toISOString())}`;

  return (
    <div className="mx-auto max-w-[110rem] space-y-4 pb-20">
      <PrintSetup landscape title={`טבלת מעקב · שבוע וולוז'ין ${label}`}>
        <p className="text-sm">
          {printed} · {rows.length} שיעורים{filtered ? " (מסונן)" : ""}
          {showPhones ? " · כולל טלפונים: מידע אישי" : ""}
        </p>
      </PrintSetup>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
        <h2 className="font-display text-2xl font-extrabold">טבלת מעקב</h2>
        <EditionSelect />
        <OutputsTabs admin={actor.isAdmin} />
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-xl border border-line bg-card p-3 print:hidden">
        <div className="flex flex-col">
          <label htmlFor="tracking-day" className="text-sm font-semibold">
            יום
          </label>
          <select id="tracking-day" value={day ?? ""} onChange={(e) => setDay(e.target.value === "" ? null : (Number(e.target.value) as Day))} className={SELECT}>
            <option value="">כל הימים</option>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {DAY_NAMES[d]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label htmlFor="tracking-stage" className="text-sm font-semibold">
            מה חסר
          </label>
          <select id="tracking-stage" value={stage ?? ""} onChange={(e) => setStage(e.target.value === "" ? null : (e.target.value as TrackingStage))} className={SELECT}>
            <option value="">הכול</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_FILTER_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        {actor.role !== "logistics" && (
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="size-4 accent-ink" />
            שלי
          </label>
        )}
        <PhonesToggle actor={actor} week={week} on={withPhones} setOn={setWithPhones} failed={failed} />
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
          <input type="checkbox" checked={pagePerDay} onChange={(e) => setPagePerDay(e.target.checked)} className="size-4 accent-ink" />
          בהדפסה: עמוד לכל יום
        </label>
        <div className="flex flex-wrap gap-2 sm:ms-auto">
          <Button onClick={() => window.print()}>הדפסה</Button>
          <Button onClick={() => save("xlsx")} disabled={rows.length === 0}>
            הורדת xlsx
          </Button>
          <Button onClick={() => save("csv")} disabled={rows.length === 0}>
            הורדת CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2 print:hidden">
        <p role="status" className="text-sm text-ink-soft">
          {rows.length === 1 ? "שיעור אחד" : `${rows.length} שיעורים`}
          {filtered ? ` (מתוך ${all.length})` : ""} · הקבצים וההדפסה כוללים את השורות שמוצגות
        </p>
        <ToneLegend tones={["received", "presentation", "pending", "none", "draft", "memorial"]} />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-card p-4 text-ink-soft">{all.length === 0 ? "עוד אין שיעורים במחזור הזה." : "אין שיעורים שמתאימים לסינון."}</p>
      ) : (
        days.map((d, i) => {
          const ofDay = rows.filter((r) => r.day === d);
          return (
            <section key={d} aria-label={`יום ${DAY_NAMES[d]}`} className={i > 0 && pagePerDay ? "print:break-before-page" : ""}>
              {/* a page of its own says which sheet it is */}
              {i > 0 && pagePerDay && (
                <p className="hidden text-xs text-ink-soft print:block">
                  טבלת מעקב · שבוע וולוז'ין {label} · {printed}
                </p>
              )}
              <h3 className="mb-1 font-display text-lg font-semibold print:break-after-avoid">
                יום {DAY_NAMES[d]} <span className="text-sm font-normal text-ink-soft">{ofDay.length}</span>
              </h3>
              {wide ? (
                <DayTable rows={ofDay} phones={showPhones ? phones : null} onOpen={open} day={d} />
              ) : (
                <>
                  <div className="hidden print:block">
                    <DayTable rows={ofDay} phones={showPhones ? phones : null} onOpen={open} day={d} />
                  </div>
                  <ul aria-label={`השיעורים של יום ${DAY_NAMES[d]}`} className="grid items-start gap-2 md:grid-cols-2 print:hidden">
                    {ofDay.map((r) => (
                      <RowCard key={r.lesson.id} row={r} phone={showPhones ? (phones?.get(r.lesson.id) ?? "") : null} onOpen={() => open(r.lesson.id)} />
                    ))}
                  </ul>
                </>
              )}
            </section>
          );
        })
      )}
      {node}
    </div>
  );
}

function DayTable({ rows, phones, onOpen, day }: { rows: TrackingRow[]; phones: Map<number, string> | null; onOpen: (id: number) => void; day: Day }) {
  const headers: string[] = [...TRACKING_HEADERS];
  if (phones) headers.splice(1, 0, "טלפון");
  // one fixed layout, the file's proportions: every day's columns line up, on screen and on paper
  const widths = trackingWidths(phones != null);
  const total = widths.reduce((a, b) => a + b, 0);
  return (
    <table aria-label={`טבלת מעקב, יום ${DAY_NAMES[day]}`} className="w-full table-fixed border-collapse break-words text-start text-sm">
      <colgroup>
        {widths.map((w, i) => (
          <col key={i} style={{ width: `${((w / total) * 100).toFixed(1)}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr className="border-b-2 border-ink/30 bg-paper">
          {headers.map((h) => (
            <th key={h} scope="col" className="px-2 py-1.5 text-start font-semibold text-balance">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.lesson.id} data-lesson-row={r.lesson.id} data-tone={r.tone} className={`border-b border-line align-top ${PROGRESS_TONE[r.tone]}`}>
            <td className="px-2 py-1.5 font-semibold">
              <button type="button" onClick={() => onOpen(r.lesson.id)} className="text-start underline decoration-ink/30 underline-offset-2 hover:decoration-ink print:no-underline" aria-label={`${r.speaker || r.title}: פתיחת השיעור בשבוע`}>
                {r.speaker || r.title}
              </button>
            </td>
            {phones && <td className="px-2 py-1.5"><bdi>{phones.get(r.lesson.id) ?? ""}</bdi></td>}
            <td className="px-2 py-1.5">
              {r.dayLabel}{" "}
              <bdi dir="ltr" className="whitespace-nowrap">
                {r.time}
              </bdi>
            </td>
            <td className="px-2 py-1.5">{r.title}</td>
            <td className="px-2 py-1.5">{r.category}</td>
            <td className="px-2 py-1.5">{r.sources}</td>
            <td className="px-2 py-1.5">{r.payment}</td>
            <td className="px-2 py-1.5">{r.escort}</td>
            <td className="px-2 py-1.5">{r.confirmed}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A row on a phone: the speaker and the time, then the columns as labelled lines. */
function RowCard({ row: r, phone, onOpen }: { row: TrackingRow; phone: string | null; onOpen: () => void }) {
  const lines: [string, string][] = [
    ["כותרת", r.title],
    ["נושא", r.category],
    ["מקורות", r.sources],
    ["הסעה/תשלום", r.payment],
    ["מלווה", r.escort],
    ["קיבל הודעת סיכום מ", r.confirmed],
  ];
  if (phone != null) lines.unshift(["טלפון", phone]);
  return (
    <li data-lesson-row={r.lesson.id} data-tone={r.tone} className={`rounded-xl border border-line p-3 ${PROGRESS_TONE[r.tone]}`}>
      <button type="button" onClick={onOpen} className="block w-full min-h-11 text-start" aria-label={`${r.speaker || r.title}: פתיחת השיעור בשבוע`}>
        <span className="block font-semibold">{r.speaker || r.title}</span>
        <span className="block text-sm text-ink-soft">
          {r.dayLabel} <bdi dir="ltr">{r.time}</bdi>
        </span>
      </button>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm">
        {lines
          .filter(([, v]) => v !== "")
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-soft">{k}</dt>
              <dd className="min-w-0 break-words">{k === "טלפון" ? <bdi>{v}</bdi> : v}</dd>
            </div>
          ))}
      </dl>
    </li>
  );
}
