// «לוגיסטיקה ← בית» (the reset, phase 4; `/logistics` with no tab): the logistics team's home — what is left to do,
// in three groups that are always all there («בהתחלה», «כשהתוכן מוכן», «קרוב לשבוע» with how far the week is), each
// task one line and a link to the page that does it (the pure model: tasks.ts). It reads ONCE each, on opening (and
// again only for a read that failed, when «לנסות שוב» is pressed): the Week it is handed (weekStore), the rota
// (useRota → public.load_rota), מכריכה לכריכה (port.kk.load → public.load_kk) and the transports (cmds.transports() →
// public.get_transports_for) — the last only when this viewer may decide here (mayDecide): elsewhere it answers
// nothing by rule. A failed read turns only its own tasks «לא נטען». Nothing is written here.
import { useCallback, useEffect, useId, useState } from "react";
import { Link } from "react-router";
import type { LessonTransport } from "../../data/commands";
import type { KkData } from "../../data/kk";
import type { DataPort } from "../../data/port";
import { mayDecide } from "../../domain/approvals";
import type { Week } from "../../domain/types";
import { Chip } from "../../grid/bits";
import { useRota } from "../rota/shared";
import { Button } from "../settings/kit";
import type { Actor } from "../weekStore";
import { logisticsTasks, type Task, type TaskGroup, TASK_STATE_LABEL, type TaskState } from "./tasks";

/** A read of the home: under way, its answer, or failed. */
type Read<T> = { kind: "loading" } | { kind: "ok"; data: T } | { kind: "failed" };

const TONE: Record<TaskState, "ok" | "warn" | "plain"> = { done: "ok", open: "warn", empty: "plain", unknown: "plain" };

/** One read on opening (and again when `again` is called), its answer kept only while the component is the same edition's. */
function useRead<T>(read: (() => Promise<T>) | null): { state: Read<T>; again: () => void } {
  const [state, setState] = useState<Read<T>>({ kind: "loading" });
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!read) return;
    let live = true;
    setState({ kind: "loading" });
    read().then(
      (data) => live && setState({ kind: "ok", data }),
      () => live && setState({ kind: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [read, asked]);
  const again = useCallback(() => setAsked((n) => n + 1), []);
  return { state, again };
}

export function LogisticsHome({ port, week, actor }: { port: DataPort; week: Week; actor: Actor }) {
  const editionId = week.edition.id;
  const deciding = mayDecide(actor, week.edition);
  const rota = useRota(port, editionId);
  const readKk = useCallback(() => port.kk.load(editionId), [port, editionId]);
  const readTransports = useCallback(() => port.commands(editionId).transports(), [port, editionId]);
  const kk = useRead<KkData>(readKk);
  const transports = useRead<LessonTransport[]>(deciding ? readTransports : null);

  const rotaSettled = rota.data != null || rota.failed != null;
  const settled = rotaSettled && kk.state.kind !== "loading" && (!deciding || transports.state.kind !== "loading");
  if (!settled) return <p className="mt-6 text-center text-ink-soft">טוען…</p>;

  const kkData = kk.state.kind === "ok" ? kk.state.data : null;
  const transportData = deciding && transports.state.kind === "ok" ? transports.state.data : null;
  const { groups } = logisticsTasks({ week, rota: rota.data, kk: kkData, transports: transportData, mayDecide: deciding }, new Date().toISOString());
  const failed = rota.data == null || kk.state.kind === "failed" || (deciding && transports.state.kind === "failed");
  const retry = () => {
    if (rota.data == null) void rota.reload();
    if (kk.state.kind === "failed") kk.again();
    if (deciding && transports.state.kind === "failed") transports.again();
  };

  return (
    <div data-logistics-home className="space-y-4">
      {failed && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm">
          <p className="min-w-0 flex-1">לא הצלחנו לטעון חלק מהנתונים.</p>
          <Button onClick={retry}>לנסות שוב</Button>
        </div>
      )}
      <TaskGroups groups={groups} />
    </div>
  );
}

/** The three groups side by side from a laptop up, one under the other on a phone and a tablet. */
export function TaskGroups({ groups }: { groups: readonly TaskGroup[] }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      {groups.map((g) => (
        <Group key={g.key} group={g} />
      ))}
    </div>
  );
}

function Group({ group: g }: { group: TaskGroup }) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-task-group={g.key} className="min-w-0 rounded-xl border border-line bg-card p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h3 id={id} className="font-display text-lg font-bold text-navy">
          {g.title}
        </h3>
        {g.line && (
          <p data-week-line className="text-sm font-semibold text-ink-soft">
            {g.line}
          </p>
        )}
      </div>
      <ul aria-labelledby={id} className="space-y-2">
        {g.tasks.map((t) => (
          <TaskRow key={t.key} task={t} />
        ))}
      </ul>
    </section>
  );
}

/** A task: its title the link (≥ 44px), its state's chip and its line — both read out after the link's name. */
function TaskRow({ task: t }: { task: Task }) {
  const id = useId();
  return (
    <li data-task={t.key} data-state={t.state} className="min-w-0 rounded-lg border border-line bg-paper-light px-3 pb-2">
      <div className="flex flex-wrap items-center gap-x-2">
        <Link to={t.to} aria-describedby={`${id}-state ${id}-line`} className="inline-flex min-h-11 min-w-0 items-center font-bold break-words text-navy underline-offset-4 hover:underline">
          {t.title}
        </Link>
        <span id={`${id}-state`}>
          <Chip tone={TONE[t.state]}>{TASK_STATE_LABEL[t.state]}</Chip>
        </span>
      </div>
      <p id={`${id}-line`} className="text-sm break-words text-ink-soft">
        {t.line}
      </p>
    </li>
  );
}
