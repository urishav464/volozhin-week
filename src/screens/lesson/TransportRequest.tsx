// «תשלום והסעה» on the lesson page, as the handler works it (the reset, phase 2): «צריך הסעה?» and the payment, and —
// when a transport is asked — where and when to collect the speaker, sent together for approval: set_payment for the
// amount and the transport (only when they changed, or a rejected request is asked again), then
// set_transport_request for the pickup with its pickup_min (CONTRACT «Transport in two parts»). Once sent, only where
// the request stands: «ממתין לאישור / אושר / לא אושר», and once the staff arranged it, the driver — read-only: the
// driver is the staff's business (set_transport_driver). The pickup is personal data, read one lesson at a time
// (cmds.transport → app.may_see_transport); where it may not be kept (a practice or demo week), one line says so.
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { TRANSPORTS, STAGE_LIMITS } from "../../data/stageRules";
import { telHref } from "../../domain/contactLinks";
import { pickupInput } from "../../domain/pickup";
import { shekels, TRANSPORT_LABEL } from "../../domain/stages";
import type { Approval, Lesson, Transport, TransportDetails } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Chip } from "../../grid/bits";
import { Button, Field, INPUT, useFocusRescue } from "../settings/kit";
import { Choice, LINK_BUTTON, Problem, type StageCtx, whenText } from "../stages/parts";
import { requestPlan } from "./request";

/** Where a request stands, in the trainee's three words (nothing asked has none). */
export const REQUEST_STATE: Record<Exclude<Approval, "none">, { text: string; tone: "warn" | "ok" | "bad" }> = {
  pending: { text: "ממתין לאישור", tone: "warn" },
  approved: { text: "אושר", tone: "ok" },
  rejected: { text: "לא אושר", tone: "bad" },
};

export const HIDDEN_PICKUP = "כתובת ושעת איסוף נשמרות רק במחזור האמיתי של השנה.";
export const PICKUP_NOT_SENT = "הבקשה נשלחה לאישור, אבל כתובת ושעת האיסוף לא נשמרו. אפשר לשלוח שוב.";
export const DRIVER_LATER = "הנהג/ת נקבע/ת על ידי הצוות אחרי האישור.";

/** The pickup and driver as the caller may read them: undefined while loading, null when not theirs to see. */
export function useTransportDetails(cmds: StageCtx["cmds"], l: Pick<Lesson, "id" | "transport" | "approval">) {
  const [d, setD] = useState<TransportDetails | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      setD(await cmds.transport(l.id));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [cmds, l.id]);
  // again when what decides who sees them changes (the request, the decision)
  useEffect(() => void load(), [load, l.transport, l.approval]);
  return { d, failed, load };
}

/**
 * The handler's (or an admin's) request. `details`: also show the pickup and the driver read-only once sent — the
 * staff see them in «פרטי ההסעה» (TransportBlock) instead, where they edit them.
 */
export function TransportRequest({ details, ...ctx }: StageCtx & { details: boolean }) {
  const { lesson: l, cmds } = ctx;
  const t = useTransportDetails(cmds, l);
  // the form, open: nothing asked yet, a rejected request, or «שינוי הבקשה» — until both parts were sent. `changing`
  // also holds it open while it is sent: the first part may put the request to «ממתין» before the second fails, and
  // the pickup typed must not go with the form
  const [changing, setChanging] = useState(false);
  const formOpen = l.approval === "none" || l.approval === "rejected" || changing;
  // the form opens and closes under the hand that pressed: the focus to its first choice, back to «שינוי הבקשה», or —
  // once sent — to where the request now stands
  const root = useRef<HTMLDivElement>(null);
  const rescue = useFocusRescue();
  const find = (sel: string) => () => root.current?.querySelector<HTMLElement>(sel);
  return (
    <div ref={root} className="space-y-3" data-transport-request>
      {l.approval !== "none" && <RequestSummary lesson={l} pickup={details && !formOpen ? t.d : null} />}
      {formOpen ? (
        <RequestForm
          {...ctx}
          details={t}
          // «ביטול» only where the form is not the request's own state (nothing asked, or asked again after a «לא»)
          onCancel={
            l.approval === "pending" || l.approval === "approved"
              ? () => {
                  setChanging(false);
                  rescue(find("[data-change-request]"));
                }
              : undefined
          }
          onSend={() => setChanging(true)}
          onDone={async (sent) => {
            if (!sent) return; // the form stays as typed, open whatever the request now says
            setChanging(false);
            await t.load();
            rescue(find("[data-approval]"));
          }}
        />
      ) : (
        <>
          {details && l.transport !== "none" && <DriverLine lesson={l} d={t.d} />}
          <Button
            kind="quiet"
            className="-ms-3"
            data-change-request
            onClick={() => {
              setChanging(true);
              rescue(find("form input:not([disabled])"));
            }}
          >
            שינוי הבקשה
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * What was asked and where it stands: the amount, the transport, the pickup (when given and the caller may see it),
 * the decision's chip (`data-approval`) and note, and once approved whether it was paid.
 */
export function RequestSummary({ lesson: l, pickup }: { lesson: Lesson; pickup?: TransportDetails | null }) {
  const state = l.approval === "none" ? null : REQUEST_STATE[l.approval];
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-soft">תשלום</dt>
        <dd>{l.pay_amount != null ? <bdi className="font-semibold">{shekels(l.pay_amount)}</bdi> : "בלי תשלום"}</dd>
        <dt className="text-ink-soft">הסעה</dt>
        <dd>{TRANSPORT_LABEL[l.transport]}</dd>
        {pickup?.pickup_address && (
          <>
            <dt className="text-ink-soft">כתובת איסוף</dt>
            <dd className="min-w-0 break-words">{pickup.pickup_address}</dd>
          </>
        )}
        {pickup?.pickup_time && (
          <>
            <dt className="text-ink-soft">שעת איסוף</dt>
            <dd className="min-w-0 break-words">
              <bdi>{pickup.pickup_time}</bdi>
            </dd>
          </>
        )}
        {l.approval === "approved" && l.pay_amount != null && (
          <>
            <dt className="text-ink-soft">בפועל</dt>
            <dd>
              {l.paid_at ? (
                <>
                  שולם · <bdi>{whenText(l.paid_at)}</bdi>
                </>
              ) : (
                "טרם שולם"
              )}
            </dd>
          </>
        )}
      </dl>
      {state && (
        // focusable from a script only: where the focus lands once the request is sent
        <p data-approval={l.approval} tabIndex={-1} className="flex flex-wrap items-center gap-2 text-sm outline-none">
          <Chip tone={state.tone}>{state.text}</Chip>
          {l.approval_note && <span className="min-w-0 break-words text-ink-soft">«{l.approval_note}»</span>}
        </p>
      )}
    </div>
  );
}

/** The driver, read-only, once the staff arranged the transport; before that, who decides it. */
function DriverLine({ lesson: l, d }: { lesson: Lesson; d: TransportDetails | null | undefined }) {
  if (d === undefined) return null;
  if (d === null) return <p className="text-sm text-ink-soft">{HIDDEN_PICKUP}</p>;
  if (l.approval !== "approved" || !d.arranged) return <p className="text-sm text-ink-soft">{DRIVER_LATER}</p>;
  const tel = telHref(d.driver_phone);
  return (
    <div className="space-y-1 text-sm" data-driver>
      <p>
        <b>ההסעה סודרה</b>
        {d.driver_name && <> · נהג/ת: {d.driver_name}</>}
      </p>
      {d.driver_phone && (
        <p className="flex flex-wrap items-center gap-2">
          <bdi className="break-all">{d.driver_phone}</bdi>
          {tel && (
            <a href={tel} className={LINK_BUTTON}>
              חיוג לנהג/ת
            </a>
          )}
        </p>
      )}
    </div>
  );
}

function RequestForm({
  lesson: l,
  cmds,
  busy,
  act,
  details: t,
  onCancel,
  onSend,
  onDone,
}: StageCtx & {
  details: ReturnType<typeof useTransportDetails>;
  onCancel?: () => void;
  /** Before the first call: the form is held open while it is sent. */
  onSend: () => void;
  /** After the calls: `sent` — both went; else the form stays as typed. */
  onDone: (sent: boolean) => Promise<void>;
}) {
  const id = useId();
  const d = t.d;
  const [kind, setKind] = useState<"none" | "paid">(l.pay_amount != null ? "paid" : "none");
  const [amount, setAmount] = useState(l.pay_amount != null ? String(l.pay_amount) : "");
  const [transport, setTransport] = useState<Transport>(l.transport);
  // the pickup starts from what is saved, once it is read (a field typed meanwhile is kept)
  const [address, setAddress] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const plan = requestPlan(l, { kind, amount, transport, address, time }, d);
  // a pickup an older screen wrote as words («אחרי השיעור»): shown beside the time input, which cannot hold it
  const oldWords = d?.pickup_time && pickupInput(d.pickup_time) === "" ? d.pickup_time : null;
  const paid = l.paid_at != null;
  // a transport asked while the pickup is still being read: wait for it (else the request would go without it)
  const reading = transport !== "none" && d === undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(plan.problem);
    if (plan.problem) return;
    onSend();
    // (1) went and (2) did not: the request now waits for approval without its pickup — said beside the form, which
    // stays as typed (send again: only the pickup goes, (1) is already what the form says)
    let paymentSent = false;
    const done = await act(
      "request",
      async () => {
        // (1) the amount and the transport — only when they changed, or a rejected request is asked again
        if (plan.payment) {
          await cmds.setPayment(l.id, l.version, plan.payment.amount, plan.payment.transport);
          paymentSent = true;
        }
        // (2) the pickup, with its minute on the lesson's day — a refusal here is toasted, and the form stays
        if (plan.pickup) await cmds.setTransportRequest(l.id, plan.pickup);
      },
      plan.ok,
      (code) => {
        if (code !== "bad_amount" && code !== "paid_locked") return false;
        setProblem(errorMessage(code));
        return true;
      },
    );
    if (!done && paymentSent && plan.pickup) setProblem(PICKUP_NOT_SENT);
    await onDone(done);
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="בקשת תשלום והסעה" className="space-y-4" noValidate>
      {l.approval === "none" && <p className="text-sm text-ink-soft">עוד לא התבקשו תשלום או הסעה. מה שמבקשים כאן נשלח לאישור הצוות.</p>}
      <Choice
        name={`${id}-transport`}
        legend="צריך הסעה?"
        value={transport}
        options={TRANSPORTS.map((x) => [x, TRANSPORT_LABEL[x]] as const)}
        onChange={setTransport}
      />
      {transport !== "none" &&
        (d === undefined ? (
          t.failed ? (
            <div role="alert" className="space-y-1">
              <p className="text-sm text-bad">לא הצלחנו לטעון את פרטי האיסוף.</p>
              <button type="button" className={LINK_BUTTON} onClick={() => void t.load()}>
                לנסות שוב
              </button>
            </div>
          ) : (
            <p className="text-sm text-ink-soft">טוען…</p>
          )
        ) : d === null ? (
          <p className="text-sm text-ink-soft">{HIDDEN_PICKUP}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Field id={`${id}-addr`} label="כתובת איסוף">
              <input
                id={`${id}-addr`}
                value={plan.address}
                maxLength={STAGE_LIMITS.pickup_address}
                onChange={(e) => setAddress(e.target.value)}
                aria-invalid={problem != null && !plan.address.trim() ? true : undefined}
                className={INPUT}
                autoComplete="off"
              />
            </Field>
            <Field id={`${id}-time`} label="שעת איסוף" hint={oldWords ? <>נרשם קודם: «{oldWords}»</> : undefined}>
              <input
                id={`${id}-time`}
                type="time"
                step={300}
                dir="ltr"
                value={plan.time}
                onChange={(e) => setTime(e.target.value)}
                aria-invalid={problem != null && !plan.time ? true : undefined}
                aria-describedby={oldWords ? `${id}-time-hint` : undefined}
                className={`${INPUT} tabular-nums`}
              />
            </Field>
          </div>
        ))}
      <Choice
        name={`${id}-paid`}
        legend="תשלום"
        disabled={paid}
        value={kind}
        options={[
          ["none", "בלי תשלום (התנדבות)"],
          ["paid", "תשלום"],
        ]}
        onChange={setKind}
      />
      {kind === "paid" && (
        <Field id={`${id}-amount`} label="סכום בשקלים" hint="מה שסוכם עם המרצה, במספר שלם.">
          <div className="flex max-w-xs items-center gap-2">
            <input
              id={`${id}-amount`}
              inputMode="numeric"
              dir="ltr"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={paid}
              aria-invalid={problem != null && (plan.value === "bad" || plan.value === "empty") ? true : undefined}
              aria-describedby={`${id}-amount-hint`}
              className={INPUT}
            />
            <span aria-hidden className="font-semibold">
              ₪
            </span>
          </div>
        </Field>
      )}
      {paid && <p className="text-xs text-ink-soft">שולם — כדי לשנות את הסכום, קודם מבטלים «שולם».</p>}
      {problem && <Problem>{problem}</Problem>}
      {l.approval === "approved" && plan.payChanged && <p className="text-xs text-ink-soft">שינוי בתשלום או בהסעה של בקשה שאושרה מחזיר אותה לאישור.</p>}
      {transport === "none" && l.transport !== "none" && <p className="text-xs text-ink-soft">בלי הסעה: פרטי האיסוף של השיעור יימחקו.</p>}
      {transport !== "none" && <p className="text-xs text-ink-soft">{DRIVER_LATER}</p>}
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" type="submit" disabled={plan.nothing || reading} keepFocus busy={busy === "request"} busyLabel="שולח…">
          {plan.label}
        </Button>
        {onCancel && <Button onClick={onCancel}>ביטול</Button>}
      </div>
    </form>
  );
}
