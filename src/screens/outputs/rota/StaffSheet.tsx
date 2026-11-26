// «משמרות צוות» on /print/rota (v20) — the staff's schedule: a column a day, a row a time row of the grid, the staff on
// then in each cell (src/exports/staffSchedule.ts). Owned by stream B (the staff and transport stream): this page is open
// to every member of the edition, so it NEVER shows a transport (the logistics side prints «הסעות וצוות» with them).
// The foundation wired this first version on staffScheduleTable; on a phone, one day at a time is stream B's.
import type { RotaData } from "../../../data/rota";
import type { Week } from "../../../domain/types";
import { staffScheduleTable } from "../../../exports/staffSchedule";
import type { Table } from "../../../exports/table";
import { TableView } from "./TableView";

/** The staff page's tables (what its CSV writes, too). */
export function staffTables(week: Pick<Week, "edition" | "rows">, data: RotaData): Table[] {
  return [staffScheduleTable(week, data)];
}

export function StaffSheet({ week, data }: { week: Week; data: RotaData }) {
  return (
    <div data-staff-sheet className="space-y-4">
      {staffTables(week, data).map((t) => (
        <section key={t.name} aria-label={t.name}>
          <TableView table={t} keys={2} />
        </section>
      ))}
    </div>
  );
}
