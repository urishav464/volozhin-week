// A closed lesson's five stages after it closes (DESIGN «מסך הרשת», «התא לפי
// שלב»): תשלום/הסעה · הודעה · מלווה · מקורות · מקראה — and the one next step
// «המרצים שלי» groups it by. Pure, from the lesson's own columns, so the card's
// dots, the lesson panel, «המרצים שלי» and the progress lens all say the same.
import { amountText } from "./message";
import type { Approval, Lesson, PrintWhen, SourcesKind, Transport } from "./types";

export type StageKey = "pay" | "msg" | "escort" | "sources" | "reader";
/** done · open (a step to take) · waiting (on someone else) · problem (something to fix) · na (not needed). */
export type StageState = "done" | "open" | "waiting" | "problem" | "na";

export interface Stage {
  key: StageKey;
  label: string;
  state: StageState;
  note: string;
}

export const STAGE_LABEL: Record<StageKey, string> = {
  pay: "תשלום/הסעה",
  msg: "הודעת סיכום",
  escort: "מלווה",
  sources: "מקורות",
  reader: "מקראה",
};

export const TRANSPORT_LABEL: Record<Transport, string> = { none: "בלי הסעה", one_way: "הלוך", round_trip: "הלוך ושוב" };

export const SOURCES_LABEL: Record<SourcesKind, string> = {
  pending: "טרם התקבלו",
  sheet: "דף מקורות",
  presentation: "מצגת",
  sheet_presentation: "דף מקורות ומצגת",
  sheet_video: "דף מקורות וסרטון",
  none: "בלי מקורות",
  other: "אחר",
};

export const PRINT_WHEN_LABEL: Record<PrintWhen, string> = { none: "לא צריך להדפיס", before: "להדפיס מראש", same_day: "להדפיס באותו יום" };

export const APPROVAL_LABEL: Record<Approval, string> = {
  none: "לא התבקשו",
  pending: "ממתין לאישור המדריך/ה",
  approved: "אושר",
  rejected: "לא אושר",
};

/** «1,500 ₪» — digits as the message writes them, and the sign. */
export function shekels(n: number): string {
  return `${amountText(n)} ₪`;
}

/** What was asked: «1,500 ₪ · הלוך ושוב», «בלי תשלום · הלוך»; null when nothing was (a volunteer, or not decided yet). */
export function requestText(l: Pick<Lesson, "pay_amount" | "transport">): string | null {
  if (l.pay_amount == null && l.transport === "none") return null;
  return `${l.pay_amount != null ? shekels(l.pay_amount) : "בלי תשלום"} · ${TRANSPORT_LABEL[l.transport]}`;
}

type StageFields = Pick<
  Lesson,
  "pay_amount" | "transport" | "approval" | "paid_at" | "confirm_sent_at" | "needs_reconfirm" | "escort_roster_id" | "self_intro" | "sources_kind" | "in_reader"
>;

/** The five stages of a closed lesson, in the card's order. */
export function stagesOf(l: StageFields): Stage[] {
  const stage = (key: StageKey, state: StageState, note: string): Stage => ({ key, label: STAGE_LABEL[key], state, note });
  const asked = l.pay_amount != null || l.transport !== "none";
  const pay = !asked
    ? stage("pay", "na", "לא התבקשו")
    : l.approval === "approved"
      ? stage("pay", "done", l.pay_amount == null ? "אושר" : l.paid_at ? "אושר ושולם" : "אושר, טרם שולם")
      : l.approval === "rejected"
        ? stage("pay", "problem", "לא אושר: לעדכן את הבקשה")
        : stage("pay", "waiting", "ממתין לאישור המדריך/ה");
  const msg = l.needs_reconfirm
    ? stage("msg", "problem", "השיעור השתנה: לעדכן את המרצה")
    : l.confirm_sent_at
      ? stage("msg", "done", "נשלחה")
      : l.approval === "pending"
        ? stage("msg", "waiting", "מחכה לאישור התשלום/ההסעה")
        : l.approval === "rejected"
          ? stage("msg", "waiting", "מחכה לעדכון הבקשה")
          : stage("msg", "open", "טרם נשלחה");
  const escort =
    l.escort_roster_id != null
      ? stage("escort", "done", l.self_intro ? "שובץ/ה · הצגה עצמית" : "שובץ/ה")
      : l.self_intro
        ? stage("escort", "done", "הצגה עצמית")
        : stage("escort", "open", "חסר/ה");
  const sources =
    l.sources_kind === "pending" ? stage("sources", "open", "טרם התקבלו") : stage("sources", "done", SOURCES_LABEL[l.sources_kind]);
  const reader =
    l.sources_kind === "none" || l.sources_kind === "presentation"
      ? stage("reader", "na", "אין מה להדפיס")
      : l.in_reader
        ? stage("reader", "done", "במקראה")
        : l.sources_kind === "pending"
          ? stage("reader", "open", "מחכה למקורות")
          : stage("reader", "open", "עוד לא סומן למקראה");
  return [pay, msg, escort, sources, reader];
}

/**
 * What reopen_lesson erases with the speaker (CONTRACT: the stages were theirs, and start over), as the
 * reopen confirmation lists it — empty when no stage holds anything yet. Transport details count whenever a
 * transport was asked: they live apart (transport_details) and go with it.
 */
export function reopenLoses(
  l: Pick<Lesson, "pay_amount" | "transport" | "confirm_sent_at" | "escort_roster_id" | "self_intro" | "escort_note" | "sources_kind" | "print_when" | "sources_note" | "presentation_url" | "in_reader">,
): string[] {
  const out: string[] = [];
  if (l.transport !== "none") out.push(l.pay_amount != null ? "בקשת התשלום וההסעה, ופרטי ההסעה" : "בקשת ההסעה ופרטיה");
  else if (l.pay_amount != null) out.push("בקשת התשלום");
  if (l.confirm_sent_at) out.push("הסימון שהודעת הסיכום נשלחה");
  if (l.escort_roster_id != null || l.self_intro || l.escort_note) out.push("המלווה");
  if (l.sources_kind !== "pending" || l.print_when !== "none" || l.sources_note || l.presentation_url || l.in_reader) out.push("המקורות");
  return out;
}

/** What the handler does next with a closed lesson — «המרצים שלי» groups by it (null: everything is in place). */
export type LessonStep = "payment" | "reconfirm" | "send" | "escort" | "sources";

/**
 * In this order: a payment/transport request waiting for the instructor or rejected (the message
 * cannot go before it is settled), the speaker to be told again, the message to send, an escort, the sources.
 */
export function nextLessonStep(l: StageFields): LessonStep | null {
  if (l.approval === "pending" || l.approval === "rejected") return "payment";
  if (l.needs_reconfirm) return "reconfirm";
  if (!l.confirm_sent_at) return "send";
  if (l.escort_roster_id == null && !l.self_intro) return "escort";
  if (l.sources_kind === "pending") return "sources";
  return null;
}

/** The lesson panel's section a step opens. */
export const STEP_STAGE: Record<LessonStep, StageKey> = { payment: "pay", reconfirm: "msg", send: "msg", escort: "escort", sources: "sources" };
