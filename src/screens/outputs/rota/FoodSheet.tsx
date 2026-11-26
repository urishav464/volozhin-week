// «כמויות אוכל» on /print/rota (v20, the owner's «כמויות של אוכל לכל יום בקמפוס»): a row per day × meal — the grid's
// fixed rows whose label is a meal's — with the cohorts marked on campus in the shift the meal starts in, their trainees
// and the four diet columns (mealsTable, src/exports/rota.ts), then each cohort's own numbers (foodTable). The cohorts
// page («קבוצות ומכינות») draws the same meals table under the cohorts; the xlsx has both as sheets.
// Trainees only: the staff and guests are not counted; a cohort whose trainees are TBD makes every sum it is part of TBD,
// and one not marked on campus at all makes every meal TBD.
import type { RotaData } from "../../../data/rota";
import type { Week } from "../../../domain/types";
import { foodTable, mealsTable } from "../../../exports/rota";
import type { Table } from "../../../exports/table";
import { TableView } from "./TableView";

/** The food page's tables (what its CSV writes, too): the meals, then the cohorts. */
export function foodTables(week: Pick<Week, "edition" | "rows">, data: RotaData): Table[] {
  return [mealsTable(data, week.edition, week.rows), foodTable(data)];
}

/** How the meals are counted — said on the screen beside the table (the cohorts page and the print view). */
export const MEALS_HINT =
  "הארוחות הן השורות הקבועות בלו״ז ששמן «ארוחת…». בכל ארוחה נספרות המכינות שסומנו בקמפוס במשמרת שבה היא מתחילה. «בלבד» — בלי מי שגם וגם: הם נספרים פעם אחת, בעמודה «גם וגם».";

export function FoodSheet({ week, data }: { week: Week; data: RotaData }) {
  const [meals, cohorts] = foodTables(week, data);
  return (
    <div data-food-sheet className="space-y-4">
      <p className="text-sm text-ink-soft print:hidden">{MEALS_HINT}</p>
      <section aria-label={meals.name} data-food-meals>
        {meals.rows.length === 0 ? (
          <p className="rounded-xl border border-line bg-card p-4 text-ink-soft shadow-sm">בלו״ז אין שורות ארוחה (שורות קבועות ששמן «ארוחת…»).</p>
        ) : (
          <TableView table={meals} keys={2} />
        )}
      </section>
      <section aria-label={cohorts.name} data-food-cohorts>
        <h3 className="mb-1 font-display text-lg font-bold text-navy print:break-after-avoid">{cohorts.name}</h3>
        <TableView table={cohorts} keys={1} />
      </section>
    </div>
  );
}
