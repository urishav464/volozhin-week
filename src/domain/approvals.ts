// «אישורים» (the reset, phase 3): who may decide a payment/transport request, what the header's badge counts for each
// viewer, and the requests' rows with their pickup — pure, one rule for the approvals page, the lesson page's pay
// step, the old panel's payment stage and the transport board. The database decides (public.decide_payments): a global
// admin anywhere; else an admin or a logistics member of the lesson's own real, live edition. Vetting a speaker stays
// the global admin's (public.vet_speakers).
import type { LessonTransport } from "../data/commands";
import type { Role } from "../data/types";
import { agreedPending, type PaymentRow, pendingPayments } from "./mine";
import type { Edition, Week } from "./types";

/** What the rule reads of who is looking (an `Actor` of src/screens/weekStore.tsx fits). */
export interface DecideActor {
  global: boolean;
  isAdmin: boolean;
  role: Role;
}

/** May this viewer approve or refuse a request in this edition — the rule of public.decide_payments. */
export function mayDecide(actor: DecideActor, edition: Pick<Edition, "kind" | "status"> | null | undefined): boolean {
  if (actor.global) return true;
  if (!edition || edition.kind !== "real" || edition.status === "archived") return false;
  return actor.isAdmin || actor.role === "logistics";
}

/**
 * app.require_logistics in the browser — who writes the driver (set_transport_driver) and marks «נשלח לדפוס»
 * (set_reader_sent): logistics or an admin of the edition; an archived edition (or an archive) its admins only.
 */
export function mayLogisticsWrite(actor: Pick<DecideActor, "isAdmin" | "role">, edition: Pick<Edition, "kind" | "status">): boolean {
  return actor.isAdmin || (actor.role === "logistics" && edition.kind !== "archive" && edition.status !== "archived");
}

/**
 * The header's badge, per viewer: a global admin counts the speakers who agreed and wait for the vetting and the
 * requests; an admin or a logistics member of a live real edition, the requests only; anyone else nothing.
 */
export function approvalsBadge(week: Week | null, actor: DecideActor): number {
  if (!week) return 0;
  return (actor.global ? agreedPending(week).length : 0) + (mayDecide(actor, week.edition) ? pendingPayments(week).length : 0);
}

/** A request on the approvals page: the lesson, its speaker and handler, and the pickup when the viewer may read it. */
export interface RequestRow extends PaymentRow {
  /** null: no transport row for the lesson in the read (not sent yet, not visible to this viewer, or the read failed). */
  pickup: Pick<LessonTransport, "pickup_address" | "pickup_time" | "pickup_min"> | null;
}

/** The requests waiting for a decision, by time, each with its lesson's pickup from ONE transports read (or none). */
export function requestRows(week: Week, transports: readonly LessonTransport[] | null): RequestRow[] {
  const byLesson = new Map((transports ?? []).map((t) => [t.lesson_id, t]));
  return pendingPayments(week).map((row) => {
    const t = row.lesson.transport === "none" ? undefined : byLesson.get(row.lesson.id);
    return { ...row, pickup: t ? { pickup_address: t.pickup_address, pickup_time: t.pickup_time, pickup_min: t.pickup_min } : null };
  });
}
