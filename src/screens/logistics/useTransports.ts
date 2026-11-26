// The logistics side's one transports read — the transport board's and the staff schedule's (v20): cmds.transports()
// (get_transports_for: only what app.may_see_transport lets this viewer read; the requests that wait and the approved
// ones). Read again whenever a lesson the board shows changes its version or decision (a request sent, decided), and —
// the review — on what that key never sees: set_transport_request (a pickup corrected) and set_transport_driver (a driver,
// «סודר») write transport_details alone, which is not in Realtime, so another device's change came only with the next
// visit. Now also when the tab comes back into view, and every TRANSPORTS_POLL_MS while it is in view, as /presentations
// reads source_files (PRESENTATIONS_POLL_MS). A failure is said once, with «לנסות שוב» (`failed`, `load`) — but a read
// nobody asked for (the tab's return, the two minutes) that fails while rows are already shown is quiet (the last review):
// the board on screen is still the last read that came, and a phone's radio coming back from the lock screen is no news.
// Such a read leaves `failed` as it was; the next one that comes clears it (`sayFailure`).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LessonTransport } from "../../data/commands";
import type { DataPort } from "../../data/port";
import type { Week } from "../../domain/types";
import { onBoard } from "./lanes";

/** The transports read again this often while the tab is in view («הצעה»: two minutes, as the presentations). */
export const TRANSPORTS_POLL_MS = 120_000;

/** What whileVisible needs of `document`. */
export interface VisibleDoc {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", fn: () => void): void;
  removeEventListener(type: "visibilitychange", fn: () => void): void;
}

/** `fn` again when `doc` comes back into view, and every `ms` while it is in view (never while hidden); the cleanup stops both. */
export function whileVisible(doc: VisibleDoc, ms: number, fn: () => void): () => void {
  const visible = () => {
    if (doc.visibilityState === "visible") fn();
  };
  doc.addEventListener("visibilitychange", visible);
  const t = setInterval(visible, ms);
  return () => {
    doc.removeEventListener("visibilitychange", visible);
    clearInterval(t);
  };
}

/**
 * Is a failed read said (the alert with «לנסות שוב»)? Always for a read someone asked for — the first, «לנסות שוב», after a
 * write, a lesson changed — and for a background one (`quiet`) only while nothing was ever shown.
 */
export function sayFailure(quiet: boolean, shown: boolean): boolean {
  return !quiet || !shown;
}

/** The board's key: each lesson it shows, its version and decision — a request sent, changed or decided reads again. */
export function boardKey(week: Pick<Week, "lessons">): string {
  return week.lessons
    .filter(onBoard)
    .map((l) => `${l.id}:${l.version}:${l.approval}`)
    .join(",");
}

/** A read of the transports; `quiet`: nobody asked for it (whileVisible) — a failure with rows on screen is not said. */
export type LoadTransports = (opts?: { quiet?: boolean }) => Promise<void>;

export function useTransports(port: DataPort, week: Week): { rows: LessonTransport[] | null; failed: boolean; load: LoadTransports } {
  const cmds = useMemo(() => port.commands(week.edition.id), [port, week.edition.id]);
  const [rows, setRows] = useState<LessonTransport[] | null>(null);
  const [failed, setFailed] = useState(false);
  const shown = useRef(false); // a read has come: there are rows on screen
  const key = boardKey(week);
  const load = useCallback<LoadTransports>(
    async (opts) => {
      try {
        const got = await cmds.transports();
        shown.current = true;
        setRows(got);
        setFailed(false);
      } catch {
        if (sayFailure(opts?.quiet === true, shown.current)) setFailed(true);
      }
    },
    [cmds],
  );
  useEffect(() => void load(), [load, key]);
  useEffect(() => whileVisible(document, TRANSPORTS_POLL_MS, () => void load({ quiet: true })), [load]);
  return { rows, failed, load };
}
