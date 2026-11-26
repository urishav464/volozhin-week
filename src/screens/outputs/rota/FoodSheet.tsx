// «כמויות אוכל» on /print/rota (v20) — the food page. Owned by stream A (the cohorts stream): it becomes the per-day,
// per-meal builder's page (a row a day × meal — the grid's fixed rows whose label is a meal's —, the cohorts on campus
// in the shift the meal starts in, their trainees and the four diet columns). The foundation wired this first version:
// today's per-cohort table (foodTable), its numbers already v20's (a cohort's own trainees, dietSplit's columns).
// Trainees only: the staff and guests are not counted; a cohort whose trainees are TBD makes every sum it is part of TBD.
import type { RotaData } from "../../../data/rota";
import type { Week } from "../../../domain/types";
import { foodTable } from "../../../exports/rota";
import type { Table } from "../../../exports/table";
import { TableView } from "./TableView";

/** The food page's tables (what its CSV writes, too). */
export function foodTables(week: Pick<Week, "edition" | "rows">, data: RotaData): Table[] {
  return [foodTable(data, week.edition)];
}

export function FoodSheet({ week, data }: { week: Week; data: RotaData }) {
  return (
    <div data-food-sheet className="space-y-4">
      {foodTables(week, data).map((t) => (
        <section key={t.name} aria-label={t.name}>
          <TableView table={t} keys={1} />
        </section>
      ))}
    </div>
  );
}
