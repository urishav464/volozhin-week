// «תשלום/הסעה» on a closed lesson: what was asked and the instructor's word;
// the handler's (or an admin's) request; a global admin's decision right here
// (the approvals queue has the same, in a batch); «שולם» for logistics; and
// the transport's pickup and driver — personal data, fetched one lesson at a
// time and only for whom app.may_see_transport names (CONTRACT «Transport details»).
// Nothing here ever fills in an amount: no amount means no payment was asked.
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { STAGE_LIMITS, TRANSPORTS } from "../../data/stageRules";
import { telHref } from "../../domain/contactLinks";
import { APPROVAL_LABEL, requestText, shekels, TRANSPORT_LABEL } from "../../domain/stages";
import type { Lesson, Transport, TransportDetails } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Chip } from "../../grid/bits";
import { Button, Field, INPUT } from "../settings/kit";
import { type Act, archivedEdition, Choice, LINK_BUTTON, memberName, Problem, type StageCtx, whenText } from "./parts";

export function PaymentStage(ctx: StageCtx) {
  const { week, lesson: l, actor, cmds, busy, act, mine } = ctx;
  const mayMarkPaid = (actor.role === "logistics" || actor.isAdmin) && (actor.isAdmin || !archivedEdition(week));
  const asked = requestText(l);
  const decider = l.approval === "approved" || l.approval === "rejected" ? memberName(week, l.approved_by) : null;
  const tone = l.approval === "approved" ? "ok" : l.approval === "rejected" ? "bad" : l.approval === "pending" ? "warn" : "plain";
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-soft">תשלום</dt>
        <dd>{l.pay_amount != null ? <bdi className="font-semibold">{shekels(l.pay_amount)}</bdi> : "בלי תשלום (התנדבות, או שעוד לא הוחלט)"}</dd>
        <dt className="text-ink-soft">הסעה</dt>
        <dd>{TRANSPORT_LABEL[l.transport]}</dd>
        {asked && (
          <>
            <dt className="text-ink-soft">אישור</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              <Chip tone={tone}>{APPROVAL_LABEL[l.approval]}</Chip>
              {decider && (
                <span className="text-ink-soft">
                  {decider}
                  {l.approved_at && <> · <bdi>{whenText(l.approved_at)}</bdi></>}
                </span>
              )}
            </dd>
          </>
        )}
        {l.approval_note && (
          <>
            <dt className="text-ink-soft">הערה</dt>
            <dd className="break-words">«{l.approval_note}»</dd>
          </>
        )}
        {l.pay_amount != null && l.approval === "approved" && (
          <>
            <dt className="text-ink-soft">בפועל</dt>
            <dd>{l.paid_at ? <>שולם · <bdi>{whenText(l.paid_at)}</bdi></> : "טרם שולם"}</dd>
          </>
        )}
      </dl>

      {actor.global && l.approval === "pending" && <Decide key={l.version} lesson={l} busy={busy} act={act} decide={cmds.decidePayments} />}

      {mayMarkPaid && l.pay_amount != null && l.approval === "approved" && (
        <Button busy={busy === "paid"} onClick={() => void act("paid", () => cmds.setPaid(l.id, !l.paid_at), l.paid_at ? "הסימון «שולם» בוטל" : "סומן ששולם")}>
          {l.paid_at ? "ביטול הסימון «שולם»" : "סימון ששולם"}
        </Button>
      )}

      {mine ? (
        <RequestForm key={l.version} lesson={l} busy={busy} act={act} setPayment={cmds.setPayment} />
      ) : (
        actor.canEdit && <p className="text-xs text-ink-soft">את הבקשה מגישים מי שמטפל/ת במרצה, או המדריך/ה.</p>
      )}

      {l.transport !== "none" && <TransportBlock {...ctx} />}
    </>
  );
}

/** A global admin approves or rejects this one request, with an optional note, at the version on screen. */
function Decide({ lesson: l, busy, act, decide }: { lesson: Lesson; busy: string | null; act: Act; decide: StageCtx["cmds"]["decidePayments"] }) {
  const id = useId();
  const [note, setNote] = useState("");
  const go = (decision: "approved" | "rejected") =>
    void act(`decide:${decision}`, () => decide([{ lesson_id: l.id, version: l.version }], decision, note.trim() || null), decision === "approved" ? "הבקשה אושרה" : "הבקשה לא אושרה");
  return (
    <div role="group" aria-label="החלטת המדריך/ה" className="space-y-2 rounded-lg border border-accent bg-accent-soft p-3">
      <p className="text-sm font-semibold">הבקשה מחכה להחלטה שלך.</p>
      <Field id={`${id}-note`} label="הערה (לא חובה, גלויה לצוות)">
        <input id={`${id}-note`} value={note} maxLength={STAGE_LIMITS.decision_note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" busy={busy === "decide:approved"} onClick={() => go("approved")}>
          אישור הבקשה
        </Button>
        <Button busy={busy === "decide:rejected"} onClick={() => go("rejected")}>
          דחייה
        </Button>
      </div>
    </div>
  );
}

type AmountValue = number | null | "empty" | "bad";

/** The handler's request: no payment (a volunteer) or an amount typed in whole shekels, and the transport. */
function RequestForm({ lesson: l, busy, act, setPayment }: { lesson: Lesson; busy: string | null; act: Act; setPayment: StageCtx["cmds"]["setPayment"] }) {
  const id = useId();
  const [paid, setPaid] = useState<"none" | "paid">(l.pay_amount != null ? "paid" : "none");
  const [amount, setAmount] = useState(l.pay_amount != null ? String(l.pay_amount) : "");
  const [transport, setTransport] = useState<Transport>(l.transport);
  const [problem, setProblem] = useState<string | null>(null);
  const raw = amount.replace(/[\s,₪]/g, "");
  const value: AmountValue = paid === "none" ? null : raw === "" ? "empty" : /^\d+$/.test(raw) ? Number(raw) : "bad";
  const same = value === l.pay_amount && transport === l.transport;
  const asks = value !== null || transport !== "none";
  const label = !asks ? "שמירה: בלי תשלום ובלי הסעה" : same && l.approval === "rejected" ? "בקשה מחדש" : "שליחה לאישור המדריך/ה";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (value === "empty") return setProblem("צריך לכתוב את הסכום שסוכם, או לבחור «בלי תשלום (התנדבות)».");
    if (value === "bad") return setProblem(errorMessage("bad_amount"));
    await act("pay", () => setPayment(l.id, l.version, value, transport), asks ? "הבקשה נשלחה לאישור המדריך/ה" : "נשמר: בלי תשלום ובלי הסעה", (code) => {
      if (code !== "bad_amount" && code !== "bad_value") return false;
      setProblem(errorMessage(code));
      return true;
    });
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="בקשת תשלום והסעה" className="space-y-3 rounded-lg border border-line bg-paper p-3" noValidate>
      <Choice
        name={`${id}-paid`}
        legend="תשלום"
        value={paid}
        options={[
          ["none", "בלי תשלום (התנדבות)"],
          ["paid", "תשלום"],
        ]}
        onChange={setPaid}
      />
      {paid === "paid" && (
        <Field id={`${id}-amount`} label="סכום בשקלים" hint="מספר שלם: מה שסוכם עם המרצה. המערכת לא ממלאת סכום.">
          <div className="flex max-w-xs items-center gap-2">
            <input
              id={`${id}-amount`}
              inputMode="numeric"
              dir="ltr"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={problem ? true : undefined}
              aria-describedby={`${id}-amount-hint`}
              className={INPUT}
            />
            <span aria-hidden className="font-semibold">
              ₪
            </span>
          </div>
        </Field>
      )}
      <Choice name={`${id}-transport`} legend="הסעה" value={transport} options={TRANSPORTS.map((t) => [t, TRANSPORT_LABEL[t]] as const)} onChange={setTransport} />
      {problem && <Problem>{problem}</Problem>}
      {l.approval === "approved" && !same && <p className="text-xs text-ink-soft">שינוי בבקשה שאושרה מחזיר אותה לאישור המדריך/ה.</p>}
      {transport === "none" && l.transport !== "none" && <p className="text-xs text-ink-soft">בלי הסעה: פרטי ההסעה של השיעור יימחקו.</p>}
      <Button kind="primary" type="submit" disabled={same && l.approval !== "rejected"} busy={busy === "pay"} busyLabel="שולח…">
        {label}
      </Button>
    </form>
  );
}

const EMPTY: TransportDetails = { pickup_address: null, pickup_time: null, driver_name: null, driver_phone: null, arranged: false };

/** Pickup and driver: read through app.may_see_transport (null = not the caller's to see), written by the same people. */
function TransportBlock({ lesson: l, actor, cmds, busy, act }: StageCtx) {
  const id = useId();
  const [d, setD] = useState<TransportDetails | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => {
    try {
      setD(await cmds.transport(l.id));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [cmds, l.id]);
  // Again when what decides who sees them changes (the request, the instructor's word).
  useEffect(() => void load(), [load, l.transport, l.approval]);

  const hidden =
    actor.role === "logistics" && l.approval !== "approved"
      ? "פרטי ההסעה נפתחים לצוות הלוגיסטי אחרי שהמדריך/ה מאשר/ת את ההסעה."
      : errorMessage("transport_hidden");

  return (
    <div role="group" aria-label="פרטי ההסעה" className="space-y-2 rounded-lg border border-line bg-paper p-3">
      <p className="text-sm font-semibold">פרטי ההסעה</p>
      {failed && d === undefined ? (
        <p role="alert" className="text-sm text-bad">
          לא הצלחנו לטעון.{" "}
          <button type="button" className="underline" onClick={() => void load()}>
            לנסות שוב
          </button>
        </p>
      ) : d === undefined ? (
        <p className="text-sm text-ink-soft">טוען…</p>
      ) : d === null ? (
        <p className="text-sm text-ink-soft">{hidden}</p>
      ) : editing ? (
        <TransportForm id={id} d={d} busy={busy} onCancel={() => setEditing(false)} onSave={(next, onRefused) => act("transport", () => cmds.setTransport(l.id, next), "פרטי ההסעה נשמרו", onRefused)} onSaved={async () => {
          setEditing(false);
          await load();
        }} />
      ) : (
        <>
          <TransportView d={d} />
          <p className="text-xs text-ink-soft">מידע אישי: נשמר רק במסד הנתונים, וגלוי רק למי שמטפל/ת במרצה, למדריך/ה ולצוות הלוגיסטי אחרי האישור.</p>
          <Button onClick={() => setEditing(true)}>עריכת פרטי ההסעה</Button>
        </>
      )}
    </div>
  );
}

function TransportView({ d }: { d: TransportDetails }) {
  const empty = !d.pickup_address && !d.pickup_time && !d.driver_name && !d.driver_phone;
  const tel = telHref(d.driver_phone);
  return (
    <>
      {empty ? (
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
      )}
      <p className="text-sm">
        <Chip tone={d.arranged ? "ok" : "warn"}>{d.arranged ? "ההסעה סודרה" : "ההסעה עוד לא סודרה"}</Chip>
      </p>
    </>
  );
}

function TransportForm({
  id,
  d,
  busy,
  onSave,
  onSaved,
  onCancel,
}: {
  id: string;
  d: TransportDetails;
  busy: string | null;
  onSave: (next: TransportDetails, onRefused: (code: string | null) => boolean) => Promise<boolean>;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<TransportDetails>({ ...EMPTY, ...d });
  const [problem, setProblem] = useState<string | null>(null);
  const set = (p: Partial<TransportDetails>) => setDraft((x) => ({ ...x, ...p }));
  const text = (v: string | null) => (v && v.trim() ? v : null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const next = { pickup_address: text(draft.pickup_address), pickup_time: text(draft.pickup_time), driver_name: text(draft.driver_name), driver_phone: text(draft.driver_phone), arranged: draft.arranged };
    const ok = await onSave(next, (code) => {
      if (!code || !["bad_phone", "bad_value", "no_transport"].includes(code)) return false;
      setProblem(errorMessage(code));
      return true;
    });
    if (ok) await onSaved();
  };
  return (
    <form onSubmit={(e) => void submit(e)} aria-label="עריכת פרטי ההסעה" className="space-y-3" noValidate>
      <Field id={`${id}-addr`} label="כתובת איסוף">
        <input id={`${id}-addr`} value={draft.pickup_address ?? ""} maxLength={STAGE_LIMITS.pickup_address} onChange={(e) => set({ pickup_address: e.target.value })} className={INPUT} autoComplete="off" />
      </Field>
      <Field id={`${id}-time`} label="שעת איסוף" hint="כמו שכותבים אותה, למשל «אחרי השיעור».">
        <input id={`${id}-time`} value={draft.pickup_time ?? ""} maxLength={STAGE_LIMITS.pickup_time} onChange={(e) => set({ pickup_time: e.target.value })} className={INPUT} autoComplete="off" />
      </Field>
      <Field id={`${id}-driver`} label="שם הנהג/ת">
        <input id={`${id}-driver`} value={draft.driver_name ?? ""} maxLength={STAGE_LIMITS.driver_name} onChange={(e) => set({ driver_name: e.target.value })} className={INPUT} autoComplete="off" />
      </Field>
      <Field id={`${id}-phone`} label="הטלפון של הנהג/ת">
        <input
          id={`${id}-phone`}
          type="tel"
          inputMode="tel"
          dir="ltr"
          value={draft.driver_phone ?? ""}
          maxLength={40}
          onChange={(e) => set({ driver_phone: e.target.value })}
          aria-invalid={problem ? true : undefined}
          className={INPUT}
          autoComplete="off"
        />
      </Field>
      <label className="flex min-h-11 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={draft.arranged} onChange={(e) => set({ arranged: e.target.checked })} className="size-5 accent-ink" />
        ההסעה סודרה
      </label>
      {problem && <Problem>{problem}</Problem>}
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" type="submit" busy={busy === "transport"} busyLabel="שומר…">
          שמירה
        </Button>
        <Button onClick={onCancel}>ביטול</Button>
      </div>
    </form>
  );
}
