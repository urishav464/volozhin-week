// The edition everyone's screens are about, loaded once: the week (the grid),
// «המרצים שלי» and the approvals queue read the same Week, so moving between
// them keeps the chosen edition and costs no reload — and the header's badge
// (speakers waiting for approval) comes from it too. One live subscription per
// edition, for as long as someone is signed in.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { DataPort } from "../data/port";
import type { Me } from "../data/types";
import type { Edition, Week } from "../domain/types";

export interface WeekStore {
  /** The editions this member can see, newest first. */
  editions: Edition[];
  editionId: number | null;
  /** The chosen edition's week; null while it loads. */
  week: Week | null;
  /** «none»: no edition opened yet; «error»: the server could not be read. */
  problem: "none" | "error" | null;
  select(editionId: number): void;
  /** Re-reads the week (after a command, or when another device changed it). */
  reload(): Promise<void>;
  /** Re-reads the editions and the week, keeping the chosen edition while it exists; `prefer` picks a just-opened one. */
  refresh(prefer?: number): Promise<void>;
}

/** Keyed by who is signed in: a sign-out or another account starts over. */
export function useWeekStoreState(port: DataPort, who: string | null): WeekStore {
  const [editions, setEditions] = useState<Edition[]>([]);
  const [editionId, setEditionId] = useState<number | null>(null);
  const [week, setWeek] = useState<Week | null>(null);
  const [problem, setProblem] = useState<WeekStore["problem"]>(null);
  const chosen = useRef<number | null>(null);
  /** The edition whose week is on screen: a failed re-read (a blip on return to the tab) keeps it there. */
  const shown = useRef<number | null>(null);

  const loadFor = useCallback(
    async (id: number) => {
      try {
        const w = await port.loadWeek(id);
        if (chosen.current !== id) return; // a late answer for another edition is dropped
        shown.current = id;
        setWeek(w);
        setProblem(null);
      } catch {
        if (chosen.current === id && shown.current !== id) setProblem("error");
      }
    },
    [port],
  );

  const choose = useCallback((id: number | null) => {
    if (chosen.current === id) return false;
    chosen.current = id;
    shown.current = null;
    setWeek(null);
    setEditionId(id);
    return true;
  }, []);

  const refresh = useCallback(
    async (prefer?: number) => {
      try {
        const list = await port.editions();
        setEditions(list);
        const keep = [prefer, chosen.current].find((id) => id != null && list.some((e) => e.id === id));
        const pick = keep ?? (list.find((e) => e.status !== "archived") ?? list[0])?.id ?? null;
        setProblem(pick == null ? "none" : null);
        // A new choice loads through the effect below; the same one is read again here.
        if (!choose(pick) && pick != null) await loadFor(pick);
      } catch {
        if (shown.current == null) setProblem("error");
      }
    },
    [port, choose, loadFor],
  );

  useEffect(() => {
    chosen.current = null;
    shown.current = null;
    setEditions([]);
    setEditionId(null);
    setWeek(null);
    setProblem(null);
    if (who != null) void refresh();
  }, [who, refresh]);

  useEffect(() => {
    if (who == null || editionId == null) return;
    void loadFor(editionId);
    return port.subscribe(editionId, () => void loadFor(editionId));
  }, [port, who, editionId, loadFor]);

  const reload = useCallback(async () => {
    if (chosen.current != null) await loadFor(chosen.current);
  }, [loadFor]);

  const select = useCallback((id: number) => void choose(id), [choose]);

  return { editions, editionId, week, problem, select, reload, refresh };
}

export const WeekCtx = createContext<WeekStore | null>(null);

export function useWeekStore(): WeekStore {
  const s = useContext(WeekCtx);
  if (!s) throw new Error("useWeekStore outside WeekCtx");
  return s;
}

/** Who I am in an edition: my members.id there, and what I may do. */
export interface Actor {
  memberId: number;
  role: "admin" | "content" | "logistics";
  isAdmin: boolean;
  /** An admin of every edition: vets speakers, sees every speaker's contacts. */
  global: boolean;
  /** May issue the grid's and the pool's commands here (not logistics; an archive is admins' only). */
  canEdit: boolean;
}

export function actorIn(me: Me, edition: Edition | null | undefined): Actor {
  const membership = me.memberships.find((m) => m.edition_id === edition?.id) ?? me.memberships.find((m) => m.edition_id == null);
  const role = me.global_admin ? "admin" : (membership?.role ?? "logistics");
  const archived = !!edition && (edition.kind === "archive" || edition.status === "archived");
  return {
    memberId: membership?.member_id ?? -1,
    role,
    isAdmin: role === "admin",
    global: me.global_admin,
    canEdit: role !== "logistics" && (role === "admin" || !archived),
  };
}
