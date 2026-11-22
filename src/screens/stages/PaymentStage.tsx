// «תשלום/הסעה»'s shared parts — the lesson page's pay step (src/screens/lesson/LessonScreen.tsx), the transport board
// and «אישורים»: the decision for whoever decide_payments lets decide (src/domain/approvals.ts mayDecide), «שולם» for
// logistics or an admin, the amount as typed, and the transport's pickup and driver to read — personal data, fetched
// one lesson at a time and only for whom app.may_see_transport names (CONTRACT «Transport details»). Nothing here ever
// fills in an amount: no amount means no payment was asked. The reset, phase 5: the grid's panel no longer has the
// stage (`PaymentStage`, its request form and the old whole-details transport form are gone); no screen calls
// set_transport_details — the driver is set_transport_driver's (StaffTransport, the board's DriverForm).
import { useId, useState } from "react";
import { STAGE_LIMITS } from "../../data/stageRules";
import { telHref } from "../../domain/contactLinks";
import type { Lesson, TransportDetails } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Button, Confirm, Field, INPUT, useFocusBack } from "../settings/kit";
import { type Act, archivedEdition, LINK_BUTTON, type StageCtx } from "./parts";

/**
 * «שולם» for logistics or an admin, once an amount was approved (an undo is quiet beside the stage's one main action);
 * nothing for anyone else. The lesson page's pay step (an archive's lesson too).
 */
export function PaidButton({ week, lesson: l, actor, cmds, busy, act }: StageCtx) {
  const mayMarkPaid = (actor.role === "logistics" || actor.isAdmin) && (actor.isAdmin || !archivedEdition(week));
  if (!mayMarkPaid || l.pay_amount == null || l.approval !== "approved") return null;
  return (
    <Button kind={l.paid_at ? "quiet" : "secondary"} busy={busy === "paid"} onClick={() => void act("paid", () => cmds.setPaid(l.id, !l.paid_at), l.paid_at ? "הסימון «שולם» בוטל" : "סומן ששולם")}>
      {l.paid_at ? "ביטול הסימון «שולם»" : "סימון ששולם"}
    </Button>
  );
}

/** «דחייה» asks once: a decision is final for whoever made it (decide_payments takes a pending request only). */
export const REJECT_CONFIRM = "לא לאשר את הבקשה? אחר כך אפשר רק לבקש שוב.";

/**
 * Whoever may decide (mayDecide) approves or rejects this one request, with an optional note, at the version on screen
 * — the lesson page's pay step and the transport board's pending rows.
 */
export function Decide({ lesson: l, busy, act, decide }: { lesson: Lesson; busy: string | null; act: Act; decide: StageCtx["cmds"]["decidePayments"] }) {
  const id = useId();
  const [note, setNote] = useState("");
  // «דחייה» → one question, as «אישורים» asks it («לא לאשר» / «ביטול», the focus back to «דחייה»)
  const [rejecting, setRejecting] = useState(false);
  const focus = useFocusBack();
  const go = (decision: "approved" | "rejected") =>
    void act(`decide:${decision}`, () => decide([{ lesson_id: l.id, version: l.version }], decision, note.trim() || null), decision === "approved" ? "הבקשה אושרה" : "הבקשה לא אושרה");
  return (
    <div role="group" aria-label="החלטה על הבקשה" className="space-y-2 rounded-xl border border-navy/30 bg-accent-soft p-3">
      <p className="text-sm font-bold text-navy">הבקשה מחכה להחלטה שלך.</p>
      <Field id={`${id}-note`} label="הערה (לא חובה, גלויה לצוות)">
        <input id={`${id}-note`} value={note} maxLength={STAGE_LIMITS.decision_note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
      </Field>
      {rejecting ? (
        <Confirm
          text={REJECT_CONFIRM}
          confirm="לא לאשר"
          busy={busy === "decide:rejected"}
          onConfirm={() => go("rejected")}
          onCancel={() => {
            setRejecting(false);
            focus.back("reject");
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button kind="primary" busy={busy === "decide:approved"} onClick={() => go("approved")}>
            אישור הבקשה
          </Button>
          <Button ref={focus.ref("reject")} onClick={() => setRejecting(true)}>
            דחייה
          </Button>
        </div>
      )}
    </div>
  );
}

export type AmountValue = number | null | "empty" | "bad";

/**
 * What the amount field says: null for «בלי תשלום», a whole number of shekels (spaces, commas and «₪» dropped), «empty»
 * when «תשלום» was chosen with nothing typed, «bad» for anything else.
 */
export function amountValue(kind: "none" | "paid", raw: string): AmountValue {
  if (kind === "none") return null;
  const digits = raw.replace(/[\s,₪]/g, "");
  return digits === "" ? "empty" : /^\d+$/.test(digits) ? Number(digits) : "bad";
}

/** Why the pickup and the driver are not shown (cmds.transport answered null: app.may_see_transport). */
export function transportHiddenText(actor: Pick<StageCtx["actor"], "role">, l: Pick<Lesson, "approval">): string {
  return actor.role === "logistics" && l.approval !== "approved"
    ? "פרטי ההסעה גלויים לצוות הלוגיסטי של מחזור אמיתי שלא הועבר לארכיון, כל עוד בקשת ההסעה ממתינה לאישור או אושרה; בקשה שנדחתה נסגרת עד שמבקשים אותה שוב."
    : errorMessage("transport_hidden");
}

/** Pickup and driver as saved (whether it is arranged: a chip in the block's heading). */
export function TransportView({ d }: { d: TransportDetails }) {
  const empty = !d.pickup_address && !d.pickup_time && !d.driver_name && !d.driver_phone;
  const tel = telHref(d.driver_phone);
  return empty ? (
    <p className="text-sm text-ink-soft">עוד לא נרשמו פרטים.</p>
  ) : (
    <dl className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 text-sm">
      {d.pickup_address && (
        <>
          <dt className="text-ink-soft">כתובת איסוף</dt>
          <dd className="min-w-0 break-words">{d.pickup_address}</dd>
        </>
      )}
      {d.pickup_time && (
        <>
          <dt className="text-ink-soft">שעת איסוף</dt>
          <dd className="min-w-0 break-words">{d.pickup_time}</dd>
        </>
      )}
      {d.driver_name && (
        <>
          <dt className="text-ink-soft">נהג/ת</dt>
          <dd className="min-w-0 break-words">{d.driver_name}</dd>
        </>
      )}
      {d.driver_phone && (
        <>
          <dt className="pt-0.5 text-ink-soft">טלפון</dt>
          <dd className="min-w-0 space-y-1">
            <div className="break-all">
              <bdi>{d.driver_phone}</bdi>
            </div>
            {tel && (
              <a href={tel} className={LINK_BUTTON}>
                חיוג לנהג/ת
              </a>
            )}
          </dd>
        </>
      )}
    </dl>
  );
}
