// «אישורים» (/approvals, the reset, phase 3) — a wide page for global admins, edition admins and logistics (the route:
// handlesLogistics), sections by what the viewer may do: the payment and transport requests for everyone, with the
// controls for whoever decide_payments lets decide (src/domain/approvals.ts mayDecide) — one approval is enough, the
// staff's or logistics'; the vetting of speakers for a global admin alone (vet_speakers), and for an edition's admin one
// line of how many wait for it. The header's badge counts the same per viewer (approvalsBadge). A request opens its
// lesson's pay step (/lesson/:id?step=pay), a speaker their page (/speakers/:id).
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { mayDecide } from "../../domain/approvals";
import type { Week } from "../../domain/types";
import { weekProblem } from "../speakerPages/page";
import { useRunner } from "../settings/kit";
import { EditionSelect, type Notify, useToast } from "../speakers/parts";
import { actorIn, useWeekStore, type WeekStore } from "../weekStore";
import { Requests } from "./Requests";
import { Vetting, VettingCount } from "./Vetting";

export function ApprovalsScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { notify, clear, node } = useToast();
  const problem = weekProblem(store);
  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-20">
      {problem ?? (store.week && <Body port={port} me={me} week={store.week} store={store} notify={notify} clear={clear} />)}
      {node}
    </div>
  );
}

function Body({ port, me, week, store, notify, clear }: { port: DataPort; me: Me; week: Week; store: WeekStore; notify: Notify; clear: () => void }) {
  const actor = actorIn(me, week.edition);
  const { busy, run } = useRunner(notify, clear);
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-display text-2xl font-extrabold text-navy">אישורים</h2>
        <EditionSelect />
      </div>
      <Requests port={port} week={week} decides={mayDecide(actor, week.edition)} busy={busy} run={run} reload={store.reload} />
      {actor.global ? (
        <Vetting port={port} week={week} editions={store.editions} busy={busy} run={run} reload={store.reload} />
      ) : (
        actor.isAdmin && <VettingCount week={week} />
      )}
    </>
  );
}
