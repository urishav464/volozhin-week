// «עומס לפי קבוצה» on the board: each group's shifts, nights and times on each duty, against the shifts its cohort is on
// campus, and its shifts one right after the other — with the suggestion's rows counted while it is shown. The very
// table «תוצרים ← תורנויות ← עומס» prints (src/exports/rota.ts loadsTable): a table on a wide screen, a card per group
// on a phone.
import type { RotaAssignment, RotaData } from "../../../data/rota";
import type { Edition } from "../../../domain/types";
import { loadsTable } from "../../../exports/rota";
import { TABLE_HEAD, TABLE_KEY, TABLE_ROW, TABLE_TH } from "../../settings/kit";

export function Loads({ data, assignments, edition }: { data: RotaData; assignments: readonly RotaAssignment[]; edition: Pick<Edition, "first_day_from" | "last_day_until" | "settings"> }) {
  const t = loadsTable({ ...data, assignments: [...assignments] }, edition);
  if (t.rows.length === 0) return <p className="text-sm text-ink-soft">עוד אין קבוצות.</p>;
  return (
    <div data-rota-loads>
      <div className="hidden overflow-x-auto md:block">
        <table aria-label="עומס לפי קבוצה" className="w-full border-collapse text-start text-sm">
          <thead>
            <tr className={TABLE_HEAD}>
              {t.headers.map((h, i) => (
                <th key={i} scope="col" className={`${TABLE_TH} px-2 py-1.5`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r[0]} className={TABLE_ROW}>
                {r.map((c, j) =>
                  j === 0 ? (
                    <th key={j} scope="row" className={`${TABLE_TH} ${TABLE_KEY} px-2 py-1.5`}>
                      <bdi>{c}</bdi>
                    </th>
                  ) : (
                    <td key={j} className="px-2 py-1.5 tabular-nums">
                      {c}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label="עומס לפי קבוצה" className="grid gap-2 sm:grid-cols-2 md:hidden">
        {t.rows.map((r) => (
          <li key={r[0]} className="min-w-0 rounded-lg border border-line bg-card p-2.5">
            <p className="font-bold text-navy">
              <bdi>{r[0]}</bdi> <span className="text-sm font-normal text-ink-soft">· {r[1]}</span>
            </p>
            <dl className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
              {t.headers.slice(2).map((h, j) => (
                <div key={h} className="flex gap-1">
                  <dt className="text-ink-soft">{h}</dt>
                  <dd className="font-bold tabular-nums">{r[j + 2]}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
