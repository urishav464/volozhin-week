// «לוגיסטיקה ← תורנויות» (/logistics/rota/:view?, milestone 7, schema v16): the campus duty roster beside the lessons,
// for the edition's logistics team (the administrator, «לוגיסטיקה») and its admins — four views behind inner pills:
// «לוח» (the board, the fair suggestion, the warnings, the loads), «קבוצות ומכינות» (the cohorts and when each is on
// campus, the groups and their heads, the duties, the shifts' hours), «משמרות צוות» and «מוצ״ש» (the Saturday-night
// preparations). Everything is read once on entry (port.rota.load — never a phone) and again after every write: the rota
// is not in Realtime. The edition's admins write, its logistics team while it is not archived (app.may_write_rota);
// anyone else here reads. The pages to print are «תוצרים ← תורנויות» (/print/rota), every member's.
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import type { DataPort } from "../../../data/port";
import type { Week } from "../../../domain/types";
import { RotaLoadFailed, maySeeRotaContacts, useRota } from "../../rota/shared";
import { useRunner } from "../../settings/kit";
import type { Notify } from "../../speakers/parts";
import { archivedEdition } from "../../stages/parts";
import type { Actor } from "../../weekStore";
import { Board } from "./Board";
import type { Act, RotaCtx } from "./parts";
import { PrepTasks } from "./PrepTasks";
import { Setup } from "./Setup";
import { StaffShifts } from "./StaffShifts";

export type RotaView = "board" | "setup" | "staff" | "prep";
export const ROTA_TABS: readonly [RotaView, string][] = [
  ["board", "לוח"],
  ["setup", "קבוצות ומכינות"],
  ["staff", "משמרות צוות"],
  ["prep", "מוצ״ש"],
];

/** app.may_write_rota in the browser: an admin of the edition, or its logistics team while it is neither an archive nor archived. */
export function mayWriteRota(actor: Pick<Actor, "isAdmin" | "role">, week: Week): boolean {
  return actor.isAdmin || (actor.role === "logistics" && !archivedEdition(week));
}

export function RotaTab({ port, week, actor, notify, clear, reloadWeek }: { port: DataPort; week: Week; actor: Actor; notify: Notify; clear: () => void; reloadWeek: () => Promise<void> }) {
  const params = useParams();
  const view: RotaView = ROTA_TABS.some(([k]) => k === params.view) ? (params.view as RotaView) : "board";
  const rota = useRota(port, week.edition.id);
  const { busy, run } = useRunner(notify, clear);
  const { reload } = rota;
  const act: Act = useMemo(
    () => async (key, fn, ok, onRefused) => {
      const done = await run(key, fn, ok, onRefused);
      await reload();
      return done;
    },
    [run, reload],
  );
  const mayWrite = mayWriteRota(actor, week);

  const pills = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
      <nav aria-label="תורנויות" className="flex flex-wrap gap-1.5">
        {/* Link, not NavLink: at /logistics/rota (no view) «לוח» is the page, and NavLink would drop its aria-current */}
        {ROTA_TABS.map(([k, text]) => (
          <Link
            key={k}
            to={`/logistics/rota/${k}`}
            aria-current={k === view ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm font-bold transition-colors duration-150 ${k === view ? "border-navy bg-accent-soft text-navy" : "border-line bg-card text-ink-soft hover:border-navy/50 hover:text-navy"}`}
          >
            {text}
          </Link>
        ))}
      </nav>
      <Link to="/print/rota" className="inline-flex min-h-11 items-center text-sm font-bold text-navy underline underline-offset-2 sm:ms-auto">
        דפים להדפסה
      </Link>
    </div>
  );

  if (!rota.data) {
    return (
      <div className="space-y-3">
        {pills}
        {rota.failed ? <RotaLoadFailed code={rota.failed} onRetry={() => void rota.reload()} /> : <p className="text-ink-soft">טוען…</p>}
      </div>
    );
  }
  const ctx: RotaCtx = {
    port,
    week,
    data: rota.data,
    mayWrite,
    isAdmin: actor.isAdmin,
    phonesAllowed: maySeeRotaContacts(actor, week.edition),
    busy,
    act,
    notify,
    reloadWeek,
  };
  return (
    <div className="min-w-0 space-y-4">
      {pills}
      {!mayWrite && (
        <p data-rota-readonly className="rounded-xl border border-line bg-sand-soft p-3 text-sm text-ink">
          המחזור הזה בארכיון: אפשר לצפות בתורנויות, אבל לא לשנות אותן.
        </p>
      )}
      {view === "board" && <Board ctx={ctx} />}
      {view === "setup" && <Setup ctx={ctx} />}
      {view === "staff" && <StaffShifts ctx={ctx} />}
      {view === "prep" && <PrepTasks ctx={ctx} />}
    </div>
  );
}
