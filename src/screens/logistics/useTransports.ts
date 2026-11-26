// The logistics side's one transports read — the transport board's and the staff schedule's (v20): cmds.transports()
// (get_transports_for: only what app.may_see_transport lets this viewer read; the requests that wait and the approved
// ones). Read again whenever a lesson the board shows changes its version or decision (a request sent, decided), and —
// the review — on what that key never sees: set_transport_request (a pickup corrected) and set_transport_driver (a driver,
// «סודר») write transport_details alone, which is not in Realtime, so another device's change came only with the next
// visit. Now also when the tab comes back into view, and every TRANSPORTS_POLL_MS while it is in view, as /presentations
// reads source_files (PRESENTATIONS_POLL_MS). A failure is said once, with «לנסות שוב» (`failed`, `load`).
import { useCallback, useEffect, useMemo, useState } from "react";
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

/** The board's key: each lesson it shows, its version and decision — a request sent, changed or decided reads again. */
export function boardKey(week: Pick<Week, "lessons">): string {
  return week.lessons
    .filter(onBoard)
    .map((l) => `${l.id}:${l.version}:${l.approval}`)
    .join(",");
}

export function useTransports(port: DataPort, week: Week): { rows: LessonTransport[] | null; failed: boolean; load: () => Promise<void> } {
  const cmds = useMemo(() => port.commands(week.edition.id), [port, week.edition.id]);
  const [rows, setRows] = useState<LessonTransport[] | null>(null);
  const [failed, setFailed] = useState(false);
  const key = boardKey(week);
  const load = useCallback(async () => {
    try {
      setRows(await cmds.transports());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [cmds]);
  useEffect(() => void load(), [load, key]);
  useEffect(() => whileVisible(document, TRANSPORTS_POLL_MS, () => void load()), [load]);
  return { rows, failed, load };
}
