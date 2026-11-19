// «פרטי ההסעה» on the lesson page, for the staff and logistics (the reset, phase 3): the pickup and the driver as the
// caller may read them (cmds.transport, one lesson — app.may_see_transport). The pickup is the handler's, read-only here
// (sent with the request — set_transport_request; an admin changes it in the request above). The driver, its phone and
// «סודר» go through set_transport_driver only, and only once the request is approved: the database refuses them before,
// so they are never offered then — the same form as the transport board's (DriverForm). Never the old screens'
// whole-details write (set_transport_details): it sets a driver on a request that still waits, and rewrites the pickup
// while leaving its minute behind. The grid's panel keeps that one (PaymentStage TransportBlock).
import { useRef, useState } from "react";
import type { TransportDriverPatch } from "../../data/commands";
import { Chip } from "../../grid/bits";
import { DriverForm } from "../logistics/DriverForm";
import { Button, useFocusBack, useFocusRescue } from "../settings/kit";
import { transportHiddenText, TransportView } from "../stages/PaymentStage";
import { archivedEdition, LINK_BUTTON, type StageCtx } from "../stages/parts";
import { useTransportDetails } from "./TransportRequest";

/** Before the decision: the driver waits for it. */
export const DRIVER_AFTER_APPROVAL = "את הנהג/ת קובעים אחרי האישור.";

/** set_transport_driver's people (app.require_logistics): logistics or an admin; an archive the admins' only. */
export function mayArrangeDriver(actor: Pick<StageCtx["actor"], "role" | "isAdmin">, week: StageCtx["week"]): boolean {
  return (actor.role === "logistics" || actor.isAdmin) && (actor.isAdmin || !archivedEdition(week));
}

export function StaffTransport({ week, lesson: l, actor, cmds, busy, act }: StageCtx) {
  const t = useTransportDetails(cmds, l);
  const [editing, setEditing] = useState(false);
  const focus = useFocusBack();
  const rescue = useFocusRescue();
  const root = useRef<HTMLDivElement>(null);
  const d = t.d;
  const approved = l.approval === "approved";
  const driver = approved && mayArrangeDriver(actor, week);

  const save = async (patch: TransportDriverPatch, onRefused: (code: string | null) => boolean) => {
    const ok = await act("driver", () => cmds.setTransportDriver(l.id, patch), "פרטי הנהג/ת נשמרו", onRefused);
    await t.load();
    // refused because the request changed meanwhile (back to «ממתין»): the form is gone — the block keeps the focus
    if (!ok) rescue(() => root.current);
    return ok;
  };

  return (
    <div ref={root} tabIndex={-1} role="group" aria-label="פרטי ההסעה" data-staff-transport className="space-y-2 outline-none">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-sm font-bold">פרטי ההסעה</p>
        <span className="text-xs text-ink-soft">· מידע אישי</span>
        {d && approved && !editing && (
          <span className="ms-auto">
            <Chip tone={d.arranged ? "ok" : "warn"}>{d.arranged ? "ההסעה סודרה" : "ההסעה עוד לא סודרה"}</Chip>
          </span>
        )}
      </div>
      {t.failed && t.d === undefined ? (
        <div role="alert" className="space-y-1">
          <p className="text-sm text-bad">לא הצלחנו לטעון.</p>
          <button type="button" className={LINK_BUTTON} onClick={() => void t.load()}>
            לנסות שוב
          </button>
        </div>
      ) : d === undefined ? (
        <p className="text-sm text-ink-soft">טוען…</p>
      ) : d === null ? (
        <p className="text-sm text-ink-soft">{transportHiddenText(actor, l)}</p>
      ) : editing && driver ? (
        <div className="rounded-lg border border-line bg-paper-light p-3">
          <DriverForm
            label={l.title ?? "השיעור"}
            d={d}
            busy={busy === "driver"}
            onSave={save}
            onClose={() => {
              setEditing(false);
              focus.back("driver");
            }}
          />
        </div>
      ) : (
        <>
          <TransportView d={d} />
          {!approved ? (
            <p className="text-xs text-ink-soft" data-driver-later>
              {DRIVER_AFTER_APPROVAL}
            </p>
          ) : (
            driver && (
              <Button ref={focus.ref("driver")} onClick={() => setEditing(true)}>
                עריכת הנהג/ת
              </Button>
            )
          )}
        </>
      )}
    </div>
  );
}
