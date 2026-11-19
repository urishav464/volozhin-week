// What «שליחה לאישור» of the lesson page's transport request does (TransportRequest.tsx), as a plan: pure, so the rule
// is tested apart from the form. Two calls at most, in order (CONTRACT «setPayment», «Transport in two parts»):
// (1) set_payment — only when the amount or the transport changed, or a rejected request is asked again (as it was,
// it re-opens it); (2) set_transport_request — the pickup, with its minute on the lesson's day, whenever a transport is
// asked and the caller may read the pickup back (the read answered a row, not null). Both pickup fields are asked for.
import type { TransportRequestPatch } from "../../data/commands";
import { pickupInput, pickupMin } from "../../domain/pickup";
import type { Lesson, Transport, TransportDetails } from "../../domain/types";
import { errorMessage } from "../../errors";
import { type AmountValue, amountValue } from "../stages/PaymentStage";

/** The form as typed: «תשלום» or not and the amount, the transport, the pickup (null: not touched — what is saved stands). */
export interface RequestInput {
  kind: "none" | "paid";
  amount: string;
  transport: Transport;
  address: string | null;
  time: string | null;
}

export interface RequestPlan {
  value: AmountValue;
  /** Anything asked: an amount, or a transport. */
  asks: boolean;
  /** (1) is sent. */
  payChanged: boolean;
  /** The pickup fields are on the form (a transport is chosen, and the pickup was read and may be kept). */
  pickupShown: boolean;
  /** The pickup as the form shows it: what was typed, else what is saved. */
  address: string;
  time: string;
  /** Nothing to send: the button waits. */
  nothing: boolean;
  /** The button's name. */
  label: string;
  /** What stops the send, in the form's words; null when it may go. */
  problem: string | null;
  /** (1), when it is sent. */
  payment: { amount: number | null; transport: Transport } | null;
  /** (2), when it is sent. */
  pickup: TransportRequestPatch | null;
  /** The toast once both went. */
  ok: string;
}

export const NEED_PICKUP = "צריך כתובת ושעת איסוף.";
export const NEED_AMOUNT = "צריך לכתוב את הסכום שסוכם, או לבחור «בלי תשלום (התנדבות)».";

/**
 * The plan for the form as it stands. `d`: the pickup as the caller may read it — undefined while it loads (no pickup
 * on the form yet), null when it is not theirs to keep (a practice or demo week: (2) is never sent).
 */
export function requestPlan(l: Pick<Lesson, "pay_amount" | "transport" | "approval" | "start_min">, f: RequestInput, d: TransportDetails | null | undefined): RequestPlan {
  const value = amountValue(f.kind, f.amount);
  const asks = value !== null || f.transport !== "none";
  const edited = value !== l.pay_amount || f.transport !== l.transport;
  const payChanged = edited || l.approval === "rejected";
  const pickupShown = f.transport !== "none" && d != null;
  const savedAddress = d?.pickup_address ?? "";
  const savedTime = pickupInput(d?.pickup_time);
  const address = f.address ?? savedAddress;
  const time = f.time ?? savedTime;
  const pickupChanged = pickupShown && (address.trim() !== savedAddress || time !== savedTime);
  // nothing asked and nothing chosen yet: the button waits under its usual name («בלי» chosen over a request is a save of its own)
  const label = !asks
    ? payChanged
      ? "שמירה: בלי תשלום ובלי הסעה"
      : "שליחה לאישור"
    : l.approval === "rejected" && !edited
      ? "בקשה מחדש"
      : !payChanged
        ? "שמירת פרטי האיסוף"
        : "שליחה לאישור";
  const min = pickupShown ? pickupMin(time, l.start_min) : null;
  const problem =
    value === "empty" ? NEED_AMOUNT : value === "bad" ? errorMessage("bad_amount") : pickupShown && (!address.trim() || min == null) ? NEED_PICKUP : null;
  const sendable = problem == null && value !== "empty" && value !== "bad";
  return {
    value,
    asks,
    payChanged,
    pickupShown,
    address,
    time,
    nothing: !payChanged && !pickupChanged,
    label,
    problem,
    payment: sendable && payChanged ? { amount: value as number | null, transport: f.transport } : null,
    pickup: sendable && pickupShown ? { pickup_address: address.trim(), pickup_time: time, pickup_min: min } : null,
    ok: payChanged ? (asks ? "הבקשה נשלחה לאישור" : "נשמר: בלי תשלום ובלי הסעה") : "פרטי האיסוף נשמרו",
  };
}
