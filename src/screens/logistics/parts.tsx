// What the «לוגיסטיקה» tabs share (LogisticsScreen.tsx, TransportBoard.tsx): a tab's props, its bar (what it holds;
// print / xlsx / CSV of the very table the page prints) and that table on paper.
import type { ReactNode } from "react";
import type { DataPort } from "../../data/port";
import type { Week } from "../../domain/types";
import { csvBytes } from "../../exports/csv";
import { CSV_MIME, download, fileName, israelDay } from "../../exports/download";
import type { Table } from "../../exports/table";
import { israelDate } from "../../exports/tracking";
import { toXlsx, XLSX_MIME } from "../../exports/xlsx";
import { PrintSetup } from "../outputs/parts";
import { Button, TABLE_HEAD, TABLE_KEY, TABLE_ROW, TABLE_TH } from "../settings/kit";
import type { Notify } from "../speakers/parts";
import type { Actor } from "../weekStore";

export type LogisticsTab = "transports" | "payments" | "books" | "prints" | "rota";
const TAB_FILE: Record<LogisticsTab, string> = { transports: "transports", payments: "payments", books: "books", prints: "prints", rota: "rota" };

export interface TabProps {
  port: DataPort;
  week: Week;
  actor: Actor;
  notify: Notify;
  clear: () => void;
  label: string;
}

/** The tab's bar: what it holds, and print / xlsx / CSV of the very table the page prints. */
export function Bar({
  week,
  tab,
  table,
  sheets,
  personal,
  notify,
  children,
  summary,
}: {
  week: Week;
  tab: LogisticsTab;
  table: () => Table;
  /** The xlsx's sheets, when it holds more than the page's table (v20: «הסעות וצוות», then «הסעות» alone); the page's table by default. */
  sheets?: () => Table[];
  personal?: boolean;
  notify: Notify;
  children?: ReactNode;
  summary: ReactNode;
}) {
  const save = (kind: "xlsx" | "csv") => {
    const name = fileName(`${TAB_FILE[tab]}${personal ? "-with-addresses-phones" : ""}`, week.edition, israelDay(), kind);
    if (kind === "xlsx") download(name, toXlsx(sheets ? sheets() : [table()]), XLSX_MIME);
    else download(name, csvBytes(table()), CSV_MIME);
    notify("ok", personal ? "הקובץ ירד. יש בו כתובות וטלפונים: לא לשתף, ולמחוק כשמסיימים." : "הקובץ ירד.");
  };
  const empty = table().rows.length === 0;
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-xl border border-line bg-card p-3 shadow-sm print:hidden">
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
export function PaperTable({ table, title, landscape = false }: { table: Table; title: string; landscape?: boolean }) {
  return (
    <>
      <PrintSetup landscape={landscape} title={title}>
        <p className="text-sm">הודפס ב-{israelDate(new Date().toISOString())}</p>
      </PrintSetup>
      <table className="hidden w-full border-collapse text-start text-xs print:table">
        <thead>
          <tr className={TABLE_HEAD}>
            {table.headers.map((h) => (
              <th key={h} scope="col" className={`${TABLE_TH} px-1.5 py-1`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className={`${TABLE_ROW} align-top`}>
              {r.map((c, j) => (
                <td key={j} className={`px-1.5 py-1 break-words ${j === 0 ? TABLE_KEY : ""}`}>
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

/** «כולל כתובות וטלפונים»: off by default; the personal data's warning beside it while on. */
export function PersonalToggle({ on, setOn }: { on: boolean; setOn: (v: boolean) => void }) {
  return (
    <div className="min-w-0">
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="size-4 accent-navy" />
        כולל כתובות וטלפונים
      </label>
      {on && <p className="text-xs text-ink-soft">כתובות האיסוף והטלפונים של הנהגים הם מידע אישי: לא משתפים דף או קובץ שיש בו אותם, ומוחקים אותו כשמסיימים.</p>}
    </div>
  );
}
