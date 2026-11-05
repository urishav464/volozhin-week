// What every «תורנויות» screen shares (milestone 7, schema v16): the edition's rota, loaded once (port.rota.load —
// never a phone); the heads' phones behind «כולל טלפונים של ראשי הקבוצות» (port.rota.contacts, one call while it
// is on — off by default, off again in another edition, offered only where app.may_see_rota_contacts would give
// any); and the small parts the logistics screens and «תוצרים ← תורנויות» draw with: a group's chip, a shift's label.
// A head's phone is personal data — the drivers' rule (LogisticsScreen's «כולל כתובות וטלפונים», outputs' usePhones).
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { CommandError } from "../../data/commands";
import type { DataPort } from "../../data/port";
import type { RotaContact, RotaData, ShiftIndex } from "../../data/rota";
import { rotaShiftRange, rotaShiftsOf, shiftBounds } from "../../domain/rota";
import { type Day, fmtRange } from "../../domain/time";
import type { Edition } from "../../domain/types";
import { errorMessage } from "../../errors";
import { SeverityMark } from "../../grid/bits";
import { Button } from "../settings/kit";
import type { Actor } from "../weekStore";

/**
 * May this member see the heads' phones here — app.may_see_rota_contacts in the browser: a global admin, or an admin
 * or logistics member of a REAL edition that is not archived (a practice or demo week gives none). Only then is the
 * toggle offered and the call made; the database decides again, row by row.
 */
export function maySeeRotaContacts(actor: Pick<Actor, "global" | "role">, edition: Pick<Edition, "kind" | "status">): boolean {
  if (actor.global) return true;
  return (actor.role === "admin" || actor.role === "logistics") && edition.kind === "real" && edition.status !== "archived";
}

export interface RotaState {
  /** The edition's rota; null while it loads (and after a failed first load). */
  data: RotaData | null;
  /** The last load failed (the code, for the message). */
  failed: string | null;
  /** Re-reads it (after a write; the rota is never in Realtime). */
  reload: () => Promise<void>;
}

/**
 * One edition's rota (public.load_rota). Another edition: nothing is shown until its own answer comes (a late answer
 * for the one before is dropped). A failed re-read keeps what is on screen.
 */
export function useRota(port: DataPort, editionId: number | null): RotaState {
  const [state, setState] = useState<{ edition: number | null; data: RotaData | null; failed: string | null }>({ edition: editionId, data: null, failed: null });
  // another edition: empty at once (React's «state from the previous render» pattern — nothing of the old one shows)
  if (state.edition !== editionId) setState({ edition: editionId, data: null, failed: null });
  const reload = useCallback(async () => {
    if (editionId == null) return;
    try {
      const data = await port.rota.load(editionId);
      setState((s) => (s.edition === editionId ? { edition: editionId, data, failed: null } : s));
    } catch (e) {
      const code = e instanceof CommandError ? e.code : "read_failed";
      setState((s) => (s.edition === editionId ? { ...s, failed: code } : s));
    }
  }, [port, editionId]);
  useEffect(() => void reload(), [reload]);
  return { data: state.edition === editionId ? state.data : null, failed: state.edition === editionId ? state.failed : null, reload };
}

export interface HeadPhonesState {
  on: boolean;
  setOn: (v: boolean) => void;
  /** group id → phone, only while on and allowed (and once the answer came); null otherwise. */
  phones: Map<number, string> | null;
  failed: boolean;
  /** Asks again (after a phone was saved), while on. */
  reload: () => void;
}

/**
 * «כולל טלפונים של ראשי הקבוצות» and the phones it shows. Off by default; choosing another edition turns it off (and
 * it stays off coming back); it is on only while `allowed` (maySeeRotaContacts), so it never stays on where its switch
 * is hidden. While on: ONE port.rota.contacts call per edition (and per `reload`); a new answer replaces the old one
 * only once it arrives. Off: no call at all.
 */
export function useHeadPhones(port: DataPort, editionId: number | null, allowed: boolean): HeadPhonesState {
  const [choice, setChoice] = useState<{ edition: number | null; on: boolean }>({ edition: editionId, on: false });
  if (choice.edition !== editionId) setChoice({ edition: editionId, on: false });
  const on = allowed && editionId != null && choice.on && choice.edition === editionId;
  const setOn = useCallback((v: boolean) => setChoice({ edition: editionId, on: v }), [editionId]);
  const [answer, setAnswer] = useState<{ edition: number; rows: RotaContact[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [asked, setAsked] = useState(0);
  const reload = useCallback(() => setAsked((n) => n + 1), []);
  useEffect(() => {
    setFailed(false);
    if (!on || editionId == null) {
      setAnswer(null);
      return;
    }
    let live = true;
    port.rota.contacts(editionId).then(
      (rows) => live && setAnswer({ edition: editionId, rows }),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [port, editionId, on, asked]);
  const phones = on && answer?.edition === editionId ? new Map(answer.rows.map((r) => [r.group_id, r.head_phone])) : null;
  return { on, setOn, phones, failed, reload };
}

/** The toggle — only where the phones may be seen at all — with what it means, and a failed load said. */
export function HeadPhonesToggle({ allowed, on, setOn, failed }: { allowed: boolean; on: boolean; setOn: (v: boolean) => void; failed?: boolean }) {
  if (!allowed) return null;
  return (
    <div className="min-w-0">
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-bold">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="size-4 accent-navy" data-head-phones />
        כולל טלפונים של ראשי הקבוצות
      </label>
      {on && <p className="text-xs text-ink-soft">הטלפונים של ראשי הקבוצות הם מידע אישי: לא משתפים דף או קובץ שיש בו אותם, ומוחקים אותו כשמסיימים.</p>}
      {failed && (
        <p role="alert" className="text-xs text-bad">
          לא הצלחנו לטעון את הטלפונים. אפשר לנסות שוב.
        </p>
      )}
    </div>
  );
}

/**
 * A group's chip, its code first («א1»): a pill in the brand's navy. `size` adds the number of trainees (a screen
 * reader hears «8 חניכים»); `suggested` is the suggestion's dashed outline with «מוצע»; `warn` an amber outline and
 * the warning's mark (its reason in `title`). `children` go after the code (an action's label, a note).
 */
export function GroupChip({
  code,
  size,
  suggested = false,
  warn = false,
  title,
  children,
}: {
  code: string;
  size?: number | null;
  suggested?: boolean;
  warn?: boolean;
  title?: string;
  children?: ReactNode;
}) {
  const edge = warn ? "border-amber-400 bg-amber-50" : suggested ? "border-navy/60 border-dashed bg-card" : "border-navy/30 bg-accent-soft";
  return (
    <span
      title={title}
      data-group-chip={code}
      data-suggested={suggested || undefined}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm leading-5 font-bold whitespace-nowrap text-navy ${edge}`}
    >
      {warn && <SeverityMark severity="warn" size="sm" />}
      <bdi>{code}</bdi>
      {size !== undefined && (
        <span className="text-xs font-normal text-ink-soft" aria-label={size == null ? "גודל לא ידוע" : `${size} חניכים`}>
          {size ?? "?"}
        </span>
      )}
      {suggested && <span className="text-[11px] font-normal text-ink-soft">מוצע</span>}
      {children}
    </span>
  );
}

/**
 * A shift by its name and range: «בוקר 06:30–14:30», the range in its own <bdi dir="ltr">. With a day, the range the
 * week has that day (Sunday from the opening, Thursday to the close) — «מחוץ לשבוע» when it has none; without, the
 * whole block.
 */
export function ShiftLabel({ edition, shift, day, className = "" }: { edition: Pick<Edition, "first_day_from" | "last_day_until" | "settings">; shift: ShiftIndex; day?: Day; className?: string }) {
  const label = rotaShiftsOf(edition).labels[shift];
  const range = day == null ? (({ from, to }) => ({ start: from, end: to }))(shiftBounds(rotaShiftsOf(edition), shift)) : rotaShiftRange(edition, day, shift);
  return (
    <span className={className}>
      {label}{" "}
      {range ? (
        <bdi dir="ltr" className="whitespace-nowrap">
          {fmtRange(range.start, range.end)}
        </bdi>
      ) : (
        <span className="text-ink-soft">(מחוץ לשבוע)</span>
      )}
    </span>
  );
}

/** A failed load, said, with «לנסות שוב». */
export function RotaLoadFailed({ code, onRetry }: { code: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm print:hidden">
      <p className="mb-2">לא הצלחנו לטעון את התורנויות. {code !== "read_failed" ? errorMessage(code) : ""}</p>
      <Button onClick={onRetry}>לנסות שוב</Button>
    </div>
  );
}

/** Nothing set up yet: an empty rota. */
export const isEmptyRota = (d: RotaData) => d.cohorts.length === 0 && d.groups.length === 0 && d.duties.length === 0 && d.staff.length === 0 && d.prep.length === 0;

