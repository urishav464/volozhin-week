// «לוגיסטיקה» (/logistics/<tab>, milestone 5ב-2) — the logistics team's and the
// admins' four lists, each from the loaded week (src/exports/logistics.ts), and
// (milestone 7) «תורנויות», the campus duty roster (/logistics/rota/<view>,
// src/screens/logistics/rota/). The reset, phase 4: `/logistics` with no tab is
// the HOME (LogisticsHome.tsx — what is left to do, in three groups); an unknown
// tab goes there; the strip stays on every page, «בית» first:
// הסעות וצוות (/logistics/transports — the transport board, TransportBoard.tsx: the requests and the approved
// transports by day on a time axis beside the staff shifts, decided and given a
// driver there; it prints the approved ones), תשלומים (the approved amounts, «שולם» by the
// existing command, the totals), ספרים (מכריכה לכריכה's book orders), הדפסות
// (what is printed ahead or on the day, the files opened through a signed URL).
// Each prints on A4 and downloads as xlsx or CSV — made in this browser, every
// cell through the formula guard. The pickup addresses and the drivers' phones
// are personal data: on screen, on paper and in a file only behind «כולל כתובות
// וטלפונים», off by default and off again in another edition.
import { type ReactNode, useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { CommandError } from "../../data/commands";
import type { KkData } from "../../data/kk";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { israelMoment } from "../../domain/israelTime";
import { shekels } from "../../domain/stages";
import { DAY_NAMES, DAYS, type Day } from "../../domain/time";
import type { SourceFile, Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { bookRows, bookTable, pagesText, paymentRows, paymentTable, paymentTotals, printGroups, printRows, printTable } from "../../exports/logistics";
import { israelDate } from "../../exports/tracking";
import { PRINT_WHEN_LABEL } from "../../domain/stages";
import { Chip } from "../../grid/bits";
import { BookOrder } from "../kk/BookOrder";
import { Button, useRunner } from "../settings/kit";
import { EditionSelect, type Notify, useToast } from "../speakers/parts";
import { fileKind } from "../stages/SourceFiles";
import { archivedEdition } from "../stages/parts";
import { type Actor, actorIn, useWeekStore } from "../weekStore";
import { LogisticsHome } from "./LogisticsHome";
import { Bar, type LogisticsTab, PaperTable, type TabProps } from "./parts";
import { RotaTab } from "./rota/RotaTab";
import { TransportBoard } from "./TransportBoard";

export type { LogisticsTab } from "./parts";

/** The strip's pages: the home, then the lists. */
export type LogisticsPage = "home" | LogisticsTab;

/** «בית» is `/logistics` itself; every other tab its own segment. */
export const LOGISTICS_TABS: readonly [LogisticsPage, string][] = [
  ["home", "בית"],
  ["transports", "הסעות וצוות"],
  ["payments", "תשלומים"],
  ["books", "ספרים"],
  ["prints", "הדפסות"],
  ["rota", "תורנויות"],
];

export const logisticsPath = (page: LogisticsPage): string => (page === "home" ? "/logistics" : `/logistics/${page}`);

/** The page an address asks for: no tab = the home; a tab the strip does not have = null (sent to the home). */
export function logisticsPageOf(tab: string | undefined): LogisticsPage | null {
  if (tab === undefined) return "home";
  return LOGISTICS_TABS.some(([k]) => k === tab && k !== "home") ? (tab as LogisticsPage) : null;
}

/** The lists' own names on paper and in a file's title (the board keeps «הסעות»: it prints the transports alone). */
const PRINT_LABEL: Record<LogisticsTab, string> = { transports: "הסעות", payments: "תשלומים", books: "ספרים", prints: "הדפסות", rota: "תורנויות" };

/** May this member open «לוגיסטיקה» in this edition: its logistics team and its admins. */
export function mayLogistics(actor: Actor): boolean {
  return actor.isAdmin || actor.role === "logistics";
}

export function LogisticsScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const params = useParams();
  const page = logisticsPageOf(params.tab);
  const { notify, clear, node } = useToast();

  // a tab the strip does not have: the home (before anything loads — the address is wrong whatever the week)
  if (page == null) return <Navigate replace to="/logistics" />;
  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!week) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;
  const actor = actorIn(me, week.edition);
  const tab = page === "home" ? null : page;
  const label = tab ? PRINT_LABEL[tab] : "";

  return (
    // the rota's board (five days side by side) and the transport board (a day's time axis) take a computer's width
    <div className={`mx-auto ${tab === "rota" || tab === "transports" ? "max-w-7xl" : "max-w-5xl"} space-y-4 pb-20`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
        <h2 className="font-display text-2xl font-extrabold text-navy">לוגיסטיקה</h2>
        <EditionSelect />
      </div>
      {!mayLogistics(actor) ? (
        <p className="rounded-xl border border-line bg-card p-4 text-ink-soft shadow-sm">המסך הזה לצוות הלוגיסטי ולמדריך/ה של המחזור. אפשר לבחור מחזור אחר למעלה.</p>
      ) : (
        <>
          {/* Link with its own aria-current, not NavLink: «בית» (/logistics) would be «current» on every tab below it */}
          <nav aria-label="לוגיסטיקה" className="flex flex-wrap gap-1.5 print:hidden">
            {LOGISTICS_TABS.map(([k, text]) => (
              <Link
                key={k}
                to={logisticsPath(k)}
                data-logistics-tab={k}
                aria-current={k === page ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-bold transition-colors duration-150 ${k === page ? "border-navy bg-navy text-white shadow-sm" : "border-line bg-card text-navy hover:border-navy/50 hover:bg-accent-soft"}`}
              >
                {text}
              </Link>
            ))}
          </nav>
          {page === "home" && <LogisticsHome key={week.edition.id} port={port} week={week} actor={actor} />}
          {tab === "transports" && <TransportBoard key={week.edition.id} port={port} week={week} actor={actor} notify={notify} clear={clear} reload={store.reload} label={label} />}
          {tab === "payments" && <Payments port={port} week={week} actor={actor} notify={notify} clear={clear} reload={store.reload} label={label} />}
          {tab === "books" && <Books port={port} week={week} actor={actor} notify={notify} clear={clear} label={label} />}
          {tab === "prints" && <Prints port={port} week={week} notify={notify} label={label} />}
          {tab === "rota" && <RotaTab key={week.edition.id} port={port} week={week} actor={actor} notify={notify} clear={clear} reloadWeek={store.reload} />}
        </>
      )}
      {node}
    </div>
  );
}

/** A day's heading over its cards. */
function DayList({ day, count, children }: { day: Day; count: number; children: ReactNode }) {
  return (
    <section aria-label={`יום ${DAY_NAMES[day]}`} className="print:hidden">
      <h3 className="mb-1 font-display text-lg font-bold text-navy">
        יום {DAY_NAMES[day]} <span className="text-sm font-normal text-ink-soft">{count}</span>
      </h3>
      <ul className="grid items-start gap-2 md:grid-cols-2">{children}</ul>
    </section>
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
            <div key={k} className="rounded-xl bg-sage-soft p-2">
              <dt className="text-xs text-ink-soft">{k}</dt>
              <dd className="font-display text-lg font-extrabold text-navy">
                <bdi>{shekels(v)}</bdi>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-sm text-ink-soft print:hidden">רק סכומים שאושרו.</p>
      {DAYS.filter((d) => rows.some((r) => r.day === d)).map((d) => {
        const ofDay = rows.filter((r) => r.day === d);
        return (
          <DayList key={d} day={d} count={ofDay.length}>
            {ofDay.map((r) => (
              <li key={r.lesson.id} data-payment-row={r.lesson.id} className="rounded-xl border border-line bg-card p-3 shadow-sm">
                <p className="font-bold text-navy">{r.speaker || "TBD"}</p>
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
      <Bar week={week} tab="books" table={table} notify={notify} summary={kk == null ? "טוען…" : rows.length === 0 ? "עוד אין ספרים במכריכה לכריכה." : `${rows.length === 1 ? "קבוצה אחת" : `${rows.length} קבוצות`} · הוזמנו ${ordered}`} />
      {failed && (
        <div role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm print:hidden">
          <p className="mb-2">לא הצלחנו לטעון את הקבוצות.</p>
          <Button onClick={() => void load()}>לנסות שוב</Button>
        </div>
      )}
      <p className="text-sm text-ink-soft print:hidden">ספר אחד לכל קבוצה, לכל השבוע. כמה עותקים להזמין כותבים כאן.</p>
      {kk && rows.length > 0 && (
        <ul aria-label="הספרים" className="grid items-start gap-2 md:grid-cols-2 print:hidden">
          {rows.map((r) => (
            <li key={r.group.id} data-book-row={r.group.id} className="space-y-1 rounded-xl border border-line bg-card p-3 shadow-sm">
              <p className="font-bold text-navy">
                {r.title}
                {r.author && <span className="font-normal text-ink-soft"> · {r.author}</span>}
              </p>
              <p className="text-sm text-ink-soft">
                {r.place || "עוד אין מרחב"} · {r.leaders ? `מעבירים: ${r.leaders}` : "בלי מעבירים"}
              </p>
              <BookOrder g={r.group} kk={kk} signed={r.signups} leaders={r.leaderCount} editable={mayLogistics(actor) && (actor.isAdmin || !archivedEdition(week))} busy={busy} act={act} port={port} />
            </li>
          ))}
        </ul>
      )}
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
          <h3 className="font-display text-xl font-extrabold text-navy">{PRINT_WHEN_LABEL[g.when]}</h3>
          {g.days.map(({ day, rows: ofDay }) => (
            <DayList key={day} day={day} count={ofDay.length}>
              {ofDay.map((r) => (
                <li key={r.lesson.id} data-print-row={r.lesson.id} className="rounded-xl border border-line bg-card p-3 shadow-sm">
                  <p className="font-bold text-navy break-words">{r.heading}</p>
                  <p className="text-sm text-ink-soft">
                    <bdi dir="ltr">{r.time}</bdi>
                    {r.files.length > 0 && <> · {pagesText(r)}</>}
                  </p>
                  {r.files.length === 0 ? (
                    <p className="mt-1 text-sm text-warn">אין קבצים</p>
                  ) : (
                    <ul aria-label={`הקבצים: ${r.heading}`} className="mt-1 divide-y divide-sage/60">
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
