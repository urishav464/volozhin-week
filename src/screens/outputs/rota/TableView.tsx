// A rota page's table as the screen and the paper show it (moved out of RotaScreen.tsx in v20, so the food and staff
// sheets — src/screens/outputs/rota/FoodSheet.tsx, StaffSheet.tsx — draw their tables the same way).
import type { Table } from "../../../exports/table";
import { TABLE_HEAD, TABLE_KEY, TABLE_ROW, TABLE_TH } from "../../settings/kit";

/**
 * A table as the screen and the paper show it — the file's own cells. Wide screens and paper: a table (the kit's
 * sage header, the key column bold navy; a band row in sage); a phone: a card per row, its first cell the heading and
 * the others as labelled lines, so nothing scrolls sideways.
 */
export function TableView({
  table: t,
  keys = 1,
  fixed = false,
}: {
  table: Table;
  /** The leading cells a phone's card is headed by. */
  keys?: number;
  /** v20: a fixed layout, the columns as wide as the sheet's own widths say (the staff's schedule: five equal days). */
  fixed?: boolean;
}) {
  if (t.rows.length === 0) return <p className="rounded-xl border border-line bg-card p-4 text-ink-soft shadow-sm">אין עדיין מה להראות כאן.</p>;
  return (
    <div data-rota-table={t.name}>
      <div className="hidden overflow-x-auto rounded-xl border border-line bg-card shadow-sm md:block print:block print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
        <table aria-label={t.name} className={`w-full border-collapse text-start text-sm print:text-[8pt] ${fixed ? "table-fixed" : ""}`}>
          {fixed && t.widths && (
            <colgroup>
              {t.widths.map((w, i) => (
                <col key={i} style={{ width: `${(w / t.widths!.reduce((a, b) => a + b, 0)) * 100}%` }} />
              ))}
            </colgroup>
          )}
          <thead>
            <tr className={TABLE_HEAD}>
              {t.headers.map((h, i) => (
                <th key={i} scope="col" className={`${TABLE_TH} px-2 py-1.5 print:px-1 print:py-0.5`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={i} className={`${TABLE_ROW} align-top ${t.fills?.[i] ? "bg-sage-soft" : ""}`}>
                {t.headers.map((_, j) => (
                  <td key={j} className={`px-2 py-1.5 break-words print:px-1 print:py-0.5 ${j === 0 ? TABLE_KEY : ""}`}>
                    {r[j] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={t.name} className="grid items-start gap-2 md:hidden print:hidden">
        {t.rows.map((r, i) => (
          <li key={i} className={`min-w-0 rounded-xl border border-line p-3 shadow-sm ${t.fills?.[i] ? "bg-sage-soft" : "bg-card"}`}>
            <p className="font-bold text-navy break-words">{r.slice(0, keys).filter(Boolean).join(" · ") || "—"}</p>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm">
              {t.headers.slice(keys).map((h, j) =>
                r[j + keys] ? (
                  <div key={j} className="contents">
                    <dt className="text-ink-soft">{h}</dt>
                    <dd className="min-w-0 break-words">{r[j + keys]}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
