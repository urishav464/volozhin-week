// «לוגיסטיקה» (/logistics/<tab>, milestone 5ב-2) — the logistics team's and the
// admins' four lists, each from the loaded week (src/exports/logistics.ts):
// הסעות (the approved transports, in one get_transports_for call; edited
// through set_transport_details), תשלומים (the approved amounts, «שולם» by the
// existing command, the totals), ספרים (מכריכה לכריכה's book orders), הדפסות
// (what is printed ahead or on the day, the files opened through a signed URL).
// Each prints on A4 and downloads as xlsx or CSV — made in this browser, every
// cell through the formula guard. The pickup addresses and the drivers' phones
// are personal data: on screen, on paper and in a file only behind «כולל כתובות
// וטלפונים», off by default and off again in another edition.
import { type ReactNode, useCallback, useEffect, useId, useMemo, useState } from "react";
import { NavLink, useParams } from "react-router";
import { CommandError, type LessonTransport } from "../../data/commands";
import type { KkData } from "../../data/kk";
import type { DataPort } from "../../data/port";
import { mergeTransport, EMPTY_TRANSPORT } from "../../data/stageRules";
import type { Me } from "../../data/types";
import { israelMoment } from "../../domain/israelTime";
import { shekels } from "../../domain/stages";
import { DAY_NAMES, DAYS, type Day } from "../../domain/time";
import type { SourceFile, TransportDetails, Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { csvBytes } from "../../exports/csv";
import { CSV_MIME, download, fileName, israelDay } from "../../exports/download";
import {
  approvedTransport, bookRows, bookTable, pagesText, paymentRows, paymentTable, paymentTotals, printGroups, printRows, printTable, transportCounts,
  type TransportRow, transportRows, transportTable,
} from "../../exports/logistics";
import type { Table } from "../../exports/table";
import { israelDate } from "../../exports/tracking";
import { toXlsx, XLSX_MIME } from "../../exports/xlsx";
import { PRINT_WHEN_LABEL } from "../../domain/stages";
import { Chip } from "../../grid/bits";
import { BookOrder } from "../kk/KkScreen";
import { Button, useRunner } from "../settings/kit";
import { EditionSelect, type Notify, useToast } from "../speakers/parts";
import { TransportForm } from "../stages/PaymentStage";
import { fileKind } from "../stages/SourceFiles";
import { archivedEdition } from "../stages/parts";
import { PrintSetup } from "../outputs/parts";
import { type Actor, actorIn, useWeekStore } from "../weekStore";

export type LogisticsTab = "transports" | "payments" | "books" | "prints";
const TABS: [LogisticsTab, string][] = [
  ["transports", "הסעות"],
  ["payments", "תשלומים"],
  ["books", "ספרים"],
  ["prints", "הדפסות"],
];
const TAB_FILE: Record<LogisticsTab, string> = { transports: "transports", payments: "payments", books: "books", prints: "prints" };

/** May this member open «לוגיסטיקה» in this edition: its logistics team and its admins. */
export function mayLogistics(actor: Actor): boolean {
  return actor.isAdmin || actor.role === "logistics";
}

export function LogisticsScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const params = useParams();
  const tab: LogisticsTab = TABS.some(([k]) => k === params.tab) ? (params.tab as LogisticsTab) : "transports";
  const { notify, clear, node } = useToast();

  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!week) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;
  const actor = actorIn(me, week.edition);
  const label = TABS.find(([k]) => k === tab)![1];

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
        <h2 className="font-display text-2xl font-extrabold">לוגיסטיקה</h2>
        <EditionSelect />
      </div>
      {!mayLogistics(actor) ? (
        <p className="rounded-xl border border-line bg-card p-4 text-ink-soft">המסך הזה לצוות הלוגיסטי ולמדריך/ה של המחזור. אפשר לבחור מחזור אחר למעלה.</p>
      ) : (
        <>
          <nav aria-label="לוגיסטיקה" className="flex flex-wrap gap-1 print:hidden">
            {TABS.map(([k, text]) => (
              <NavLink
                key={k}
                to={`/logistics/${k}`}
                aria-current={k === tab ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold ${k === tab ? "bg-ink text-paper" : "border border-line bg-card text-ink hover:bg-line/50"}`}
              >
                {text}
              </NavLink>
            ))}
          </nav>
          {tab === "transports" && <Transports key={week.edition.id} port={port} week={week} actor={actor} notify={notify} clear={clear} label={label} />}
          {tab === "payments" && <Payments port={port} week={week} actor={actor} notify={notify} clear={clear} reload={store.reload} label={label} />}
          {tab === "books" && <Books port={port} week={week} actor={actor} notify={notify} clear={clear} label={label} />}
          {tab === "prints" && <Prints port={port} week={week} notify={notify} label={label} />}
        </>
      )}
      {node}
    </div>
  );
}

interface TabProps {
  port: DataPort;
  week: Week;
  actor: Actor;
  notify: Notify;
  clear: () => void;
  label: string;
}

/** The tab's bar: what it holds, and print / xlsx / CSV of the very table the page prints. */
function Bar({ week, tab, table, personal, notify, children, summary }: { week: Week; tab: LogisticsTab; table: () => Table; personal?: boolean; notify: Notify; children?: ReactNode; summary: ReactNode }) {
  const save = (kind: "xlsx" | "csv") => {
    const name = fileName(`${TAB_FILE[tab]}${personal ? "-with-addresses-phones" : ""}`, week.edition, israelDay(), kind);
    if (kind === "xlsx") download(name, toXlsx([table()]), XLSX_MIME);
    else download(name, csvBytes(table()), CSV_MIME);
    notify("ok", personal ? "הקובץ ירד. יש בו כתובות וטלפונים: לא לשתף, ולמחוק כשמסיימים." : "הקובץ ירד.");
  };
  const empty = table().rows.length === 0;
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-xl border border-line bg-card p-3 print:hidden">
      <p role="status" className="min-w-0 basis-full text-sm text-ink-soft sm:basis-auto">
        {summary}
      </p>
      {children}
      <div className="flex flex-wrap gap-2 sm:ms-auto">
        <Button onClick={() => window.print()} disabled={empty}>
          הדפסה
        </Button>
        <Button onClick={() => save("xlsx")} disabled={empty}>
          הורדת xlsx
        </Button>
        <Button onClick={() => save("csv")} disabled={empty}>
          הורדת CSV
        </Button>
      </div>
    </div>
  );
}

/** On paper: the file's own table, with its title line — exactly what the xlsx and the CSV hold. */
function PaperTable({ table, title, landscape = false }: { table: Table; title: string; landscape?: boolean }) {
  return (
    <>
      <PrintSetup landscape={landscape} title={title}>
        <p className="text-sm">הודפס ב-{israelDate(new Date().toISOString())}</p>
      </PrintSetup>
      <table className="hidden w-full border-collapse text-start text-xs print:table">
        <thead>
          <tr className="border-b-2 border-ink/30">
            {table.headers.map((h) => (
              <th key={h} scope="col" className="px-1.5 py-1 text-start font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className="border-b border-line align-top">
              {r.map((c, j) => (
                <td key={j} className="px-1.5 py-1 break-words">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** A day's heading over its cards. */
function DayList({ day, count, children }: { day: Day; count: number; children: ReactNode }) {
  return (
    <section aria-label={`יום ${DAY_NAMES[day]}`} className="print:hidden">
      <h3 className="mb-1 font-display text-lg font-semibold">
        יום {DAY_NAMES[day]} <span className="text-sm font-normal text-ink-soft">{count}</span>
      </h3>
      <ul className="grid items-start gap-2 md:grid-cols-2">{children}</ul>
    </section>
  );
}

function Lines({ lines }: { lines: [string, ReactNode][] }) {
  return (
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm">
      {lines.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-soft">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------------ הסעות

function Transports({ port, week, actor, notify, clear, label }: TabProps) {
  const cmds = useMemo(() => port.commands(week.edition.id), [port, week.edition.id]);
  const [details, setDetails] = useState<LessonTransport[] | null>(null);
  const [failed, setFailed] = useState(false);
  // «כולל כתובות וטלפונים»: off by default; this tab is keyed by the edition, so another edition starts it off again
  const [personal, setPersonal] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const { busy, run } = useRunner(notify, clear);
  const key = week.lessons.filter(approvedTransport).map((l) => `${l.id}:${l.version}`).join(",");
  const load = useCallback(async () => {
    try {
      setDetails(await cmds.transports());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [cmds]);
  useEffect(() => void load(), [load, key]);

  const rows = useMemo(() => transportRows(week, details), [week, details]);
  const counts = transportCounts(rows);
  const table = () => transportTable(rows, week.edition.label, personal);
  const mayWrite = actor.isAdmin || !archivedEdition(week);

  const save = async (r: TransportRow, loaded: TransportDetails, next: TransportDetails, ok: string, onRefused?: (code: string | null) => boolean) => {
    const done = await run(`transport-${r.lesson.id}`, async () => cmds.setTransport(r.lesson.id, mergeTransport(loaded, next, await cmds.transport(r.lesson.id))), ok, onRefused);
    await load();
    return done;
  };

  return (
    <>
      <PaperTable table={table()} title={`${label} · שבוע וולוז'ין ${week.edition.label}${personal ? " · כולל כתובות וטלפונים: מידע אישי" : ""}`} landscape />
      <Bar
        week={week}
        tab="transports"
        table={table}
        personal={personal}
        notify={notify}
        summary={details == null ? "טוען…" : rows.length === 0 ? "אין הסעות מאושרות." : `${rows.length === 1 ? "הסעה אחת מאושרת" : `${rows.length} הסעות מאושרות`} · סודרו ${counts.arranged}`}
      >
        <div className="min-w-0">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
            <input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} className="size-4 accent-ink" />
            כולל כתובות וטלפונים
          </label>
          {personal && <p className="text-xs text-ink-soft">כתובות האיסוף והטלפונים של הנהגים הם מידע אישי: לא משתפים דף או קובץ שיש בו אותם, ומוחקים אותו כשמסיימים.</p>}
        </div>
      </Bar>
      {failed && (
        <div role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm print:hidden">
          <p className="mb-2">לא הצלחנו לטעון את פרטי ההסעות.</p>
          <Button onClick={() => void load()}>לנסות שוב</Button>
        </div>
      )}
      <p className="text-sm text-ink-soft print:hidden">רק הסעות שהמדריך/ה אישר/ה. את ההסעה מבקשים בשלב «תשלום/הסעה» של השיעור.</p>
      {details != null &&
        DAYS.filter((d) => rows.some((r) => r.day === d)).map((d) => {
          const ofDay = rows.filter((r) => r.day === d);
          return (
            <DayList key={d} day={d} count={ofDay.length}>
              {ofDay.map((r) => {
                const dd = r.details;
                const lines: [string, ReactNode][] = [
                  ["הסעה", r.legs],
                  ["שעת איסוף", dd?.pickup_time || "—"],
                  ...(personal ? ([["כתובת איסוף", dd?.pickup_address || "—"]] as [string, ReactNode][]) : []),
                  ["נהג/ת", dd?.driver_name || "—"],
                  ...(personal ? ([["טלפון הנהג/ת", dd?.driver_phone ? <bdi>{dd.driver_phone}</bdi> : "—"]] as [string, ReactNode][]) : []),
                ];
                return (
                  <li key={r.lesson.id} data-transport-row={r.lesson.id} className="rounded-xl border border-line bg-card p-3">
                    <p className="font-semibold">{r.speaker || "TBD"}</p>
                    <p className="text-sm text-ink-soft">
                      {r.dayLabel} <bdi dir="ltr">{r.time}</bdi> · {r.title}
                    </p>
                    {dd == null ? (
                      <p className="mt-1 text-sm text-ink-soft">{errorMessage("transport_hidden")}</p>
                    ) : editing === r.lesson.id ? (
                      <div className="mt-2">
                        <TransportForm
                          id={`t${r.lesson.id}`}
                          d={dd}
                          busy={busy === `transport-${r.lesson.id}` ? "transport" : null}
                          onCancel={() => setEditing(null)}
                          onSave={(next, onRefused) => save(r, { ...EMPTY_TRANSPORT, ...dd }, next, "פרטי ההסעה נשמרו", onRefused)}
                          onSaved={async () => setEditing(null)}
                        />
                      </div>
                    ) : (
                      <>
                        <Lines lines={lines} />
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Chip tone={dd.arranged ? "ok" : "warn"}>{dd.arranged ? "ההסעה סודרה" : "ההסעה עוד לא סודרה"}</Chip>
                          {mayWrite && (
                            <>
                              {/* set, the chip is the state: a quiet «ביטול» undoes it (its name still says what) */}
                              <Button
                                kind={dd.arranged ? "quiet" : "secondary"}
                                busy={busy === `transport-${r.lesson.id}`}
                                onClick={() => void save(r, { ...EMPTY_TRANSPORT, ...dd }, { ...EMPTY_TRANSPORT, ...dd, arranged: !dd.arranged }, dd.arranged ? "הסימון «סודר» בוטל" : "סומן שההסעה סודרה")}
                                aria-label={dd.arranged ? "ביטול «סודר»" : undefined}
                              >
                                {dd.arranged ? "ביטול" : "סימון «סודר»"}
                              </Button>
                              <Button onClick={() => setEditing(r.lesson.id)} aria-label={`עריכת פרטי ההסעה: ${r.speaker || r.title}`}>
                                עריכה
                              </Button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </DayList>
          );
        })}
    </>
  );
}

// ------------------------------------------------------------------ תשלומים

function Payments({ port, week, actor, notify, clear, reload, label }: TabProps & { reload: () => Promise<void> }) {
  const cmds = useMemo(() => port.commands(week.edition.id), [port, week.edition.id]);
  const { busy, run } = useRunner(notify, clear);
  const rows = useMemo(() => paymentRows(week), [week]);
  const t = paymentTotals(rows);
  const table = () => paymentTable(rows, week.edition.label, israelDate);
  const mayMarkPaid = actor.isAdmin || (actor.role === "logistics" && !archivedEdition(week));
  return (
    <>
      <PaperTable table={table()} title={`${label} · שבוע וולוז'ין ${week.edition.label}`} />
      <Bar week={week} tab="payments" table={table} notify={notify} summary={rows.length === 0 ? "אין תשלומים מאושרים." : `${t.count === 1 ? "תשלום אחד מאושר" : `${t.count} תשלומים מאושרים`}`} />
      {rows.length > 0 && (
        <dl aria-label="סיכום התשלומים" className="grid grid-cols-3 gap-2 text-center print:hidden">
          {(
            [
              ["סה״כ מאושר", t.total],
              ["שולם", t.paid],
              ["טרם שולם", t.unpaid],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-line bg-card p-2">
              <dt className="text-xs text-ink-soft">{k}</dt>
              <dd className="font-display text-lg font-bold">
                <bdi>{shekels(v)}</bdi>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-sm text-ink-soft print:hidden">רק סכומים שהמדריך/ה אישר/ה.</p>
      {DAYS.filter((d) => rows.some((r) => r.day === d)).map((d) => {
        const ofDay = rows.filter((r) => r.day === d);
        return (
          <DayList key={d} day={d} count={ofDay.length}>
            {ofDay.map((r) => (
              <li key={r.lesson.id} data-payment-row={r.lesson.id} className="rounded-xl border border-line bg-card p-3">
                <p className="font-semibold">{r.speaker || "TBD"}</p>
                <p className="text-sm text-ink-soft">
                  {r.dayLabel} <bdi dir="ltr">{r.time}</bdi> · {r.title}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <bdi className="font-semibold">{shekels(r.amount)}</bdi>
                  <Chip tone={r.paidAt ? "ok" : "warn"}>{r.paidAt ? `שולם · ${israelDate(r.paidAt)}` : "טרם שולם"}</Chip>
                  {mayMarkPaid && (
                    <Button
                      kind={r.paidAt ? "quiet" : "secondary"}
                      busy={busy === `paid-${r.lesson.id}`}
                      onClick={() =>
                        void run(`paid-${r.lesson.id}`, async () => {
                          await cmds.setPaid(r.lesson.id, !r.paidAt);
                          await reload();
                        }, r.paidAt ? "הסימון «שולם» בוטל" : "סומן ששולם")
                      }
                      aria-label={`${r.paidAt ? "ביטול הסימון «שולם»" : "סימון ששולם"}: ${r.speaker || r.title}`}
                    >
                      {r.paidAt ? "ביטול" : "סימון ששולם"}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </DayList>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------ ספרים

function Books({ port, week, actor, notify, clear, label }: TabProps) {
  const editionId = week.edition.id;
  const [kk, setKk] = useState<KkData | null>(null);
  const [failed, setFailed] = useState(false);
  const { busy, run } = useRunner(notify, clear);
  const load = useCallback(async () => {
    try {
      setKk(await port.kk.load(editionId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [port, editionId]);
  useEffect(() => void load(), [load]);
  const rows = useMemo(() => (kk ? bookRows(week, kk) : []), [week, kk]);
  const table = () => bookTable(rows, week.edition.label, israelMoment);
  const act = async (key: string, fn: () => Promise<unknown>, ok: string | null, onRefused?: (code: string | null) => boolean) => {
    const done = await run(key, fn, ok, onRefused);
    await load();
    return done;
  };
  const ordered = rows.filter((r) => r.orderedAt).length;
  return (
    <>
      <PaperTable table={table()} title={`${label} · מכריכה לכריכה · שבוע וולוז'ין ${week.edition.label}`} landscape />
      <Bar week={week} tab="books" table={table} notify={notify} summary={kk == null ? "טוען…" : rows.length === 0 ? "עוד אין קבוצות במכריכה לכריכה." : `${rows.length === 1 ? "קבוצה אחת" : `${rows.length} קבוצות`} · הוזמנו ${ordered}`} />
      {failed && (
        <div role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm print:hidden">
          <p className="mb-2">לא הצלחנו לטעון את הקבוצות.</p>
          <Button onClick={() => void load()}>לנסות שוב</Button>
        </div>
      )}
      <p className="text-sm text-ink-soft print:hidden">כמה עותקים להזמין כותבים כאן.</p>
      {kk &&
        DAYS.filter((d) => rows.some((r) => r.day === d)).map((d) => {
          const ofDay = rows.filter((r) => r.day === d);
          return (
            <DayList key={d} day={d} count={ofDay.length}>
              {ofDay.map((r) => (
                <li key={r.group.id} data-book-row={r.group.id} className="space-y-1 rounded-xl border border-line bg-card p-3">
                  <p className="font-semibold">
                    {r.title}
                    {r.author && <span className="font-normal text-ink-soft"> · {r.author}</span>}
                  </p>
                  <p className="text-sm text-ink-soft">
                    <bdi dir="ltr">{r.time}</bdi> · {r.leaders ? `מובילים: ${r.leaders}` : "בלי מובילים"}
                  </p>
                  <BookOrder g={r.group} kk={kk} signed={r.signups} leaders={r.leaderCount} editable={mayLogistics(actor) && (actor.isAdmin || !archivedEdition(week))} busy={busy} act={act} port={port} />
                </li>
              ))}
            </DayList>
          );
        })}
    </>
  );
}

// ------------------------------------------------------------------ הדפסות

function Prints({ port, week, notify, label }: Pick<TabProps, "port" | "week" | "notify" | "label">) {
  const rows = useMemo(() => printRows(week), [week]);
  const groups = printGroups(rows);
  const table = () => printTable(rows, week.edition.label);
  const none = rows.filter((r) => r.files.length === 0).length;
  return (
    <>
      <PaperTable table={table()} title={`${label} · שבוע וולוז'ין ${week.edition.label}`} landscape />
      <Bar
        week={week}
        tab="prints"
        table={table}
        notify={notify}
        summary={rows.length === 0 ? "אין שיעורים שצריך להדפיס להם." : `${rows.length === 1 ? "שיעור אחד" : `${rows.length} שיעורים`} להדפסה${none ? ` · ${none} עוד בלי קבצים` : ""}`}
      />
      <p className="text-sm text-ink-soft print:hidden">השיעורים שהמקורות שלהם מודפסים מראש או באותו יום. כמה עותקים — לפי מה שסוכם בצוות.</p>
      {groups.map((g) => (
        <section key={g.when} aria-label={PRINT_WHEN_LABEL[g.when]} className="space-y-3 print:hidden">
          <h3 className="font-display text-xl font-bold">{PRINT_WHEN_LABEL[g.when]}</h3>
          {g.days.map(({ day, rows: ofDay }) => (
            <DayList key={day} day={day} count={ofDay.length}>
              {ofDay.map((r) => (
                <li key={r.lesson.id} data-print-row={r.lesson.id} className="rounded-xl border border-line bg-card p-3">
                  <p className="font-semibold break-words">{r.heading}</p>
                  <p className="text-sm text-ink-soft">
                    <bdi dir="ltr">{r.time}</bdi>
                    {r.files.length > 0 && <> · {pagesText(r)}</>}
                  </p>
                  {r.files.length === 0 ? (
                    <p className="mt-1 text-sm text-warn">אין קבצים</p>
                  ) : (
                    <ul aria-label={`הקבצים: ${r.heading}`} className="mt-1 divide-y divide-line">
                      {r.files.map((f) => (
                        <PrintFile key={f.id} port={port} week={week} file={f} notify={notify} />
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </DayList>
          ))}
        </section>
      ))}
    </>
  );
}

/** A file to print: its name, what it is, «פתיחה» through a signed URL (minutes long). */
function PrintFile({ port, week, file: f, notify }: { port: DataPort; week: Week; file: SourceFile; notify: Notify }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const url = (await port.sources.urls(week.edition.id, [f.storage_path])).get(f.storage_path);
      if (!url) throw new CommandError("read_failed");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      notify("error", errorMessage(e instanceof CommandError ? e.code : "read_failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li data-source-file={f.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
      <span id={id} className="min-w-0 flex-1 basis-40 break-words text-sm">
        <bdi className="font-semibold">{f.display_name}</bdi> <span className="text-xs text-ink-soft">· {fileKind(f)}</span>
      </span>
      <Button busy={busy} busyLabel="פותח…" onClick={() => void open()} aria-describedby={id}>
        פתיחה
      </Button>
    </li>
  );
}
