// «ימים» (the reset, phase 2; in «צוות», after «צוות המחזור»): an edition admin gives each day of the week to at most
// two members — the pair of trainees whose «היום שלי» it is (v18 day owners, public.set_day_owners: the day's set
// replaced as a whole). The choice is the edition's team who handle speakers (content and admins — app.can_handle);
// an owner no longer on the team (deactivated: the database keeps the row) is not offered — set_day_owners would refuse
// them — and the day says that the next save takes them off.
import { useCallback, useEffect, useId, useState } from "react";
import type { DataPort } from "../../data/port";
import { DAYS, DAY_NAMES, type Day, dateOf, shortDate } from "../../domain/time";
import type { DayOwner, Edition, TeamMember } from "../../domain/types";
import { Button, INPUT, LoadError, Loading, Panel, useAction } from "./kit";

type Loaded = { owners: DayOwner[]; team: TeamMember[]; edition: Edition };

/** Who may own a day: the edition's team who handle speakers, by name. */
export function dayOwnerCandidates(team: readonly TeamMember[]): TeamMember[] {
  return team.filter((t) => t.role === "content" || t.role === "admin").sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? "", "he") || a.id - b.id);
}

/**
 * A day's two selects as they open: the saved owners who still may own it; `gone` counts those who may not (left the
 * team, or no longer handle speakers) — the save sends the day without them.
 */
export function initialPicks(saved: readonly number[], candidates: readonly Pick<TeamMember, "id">[]): { picks: [number | null, number | null]; gone: number } {
  const kept = saved.filter((m) => candidates.some((c) => c.id === m));
  return { picks: [kept[0] ?? null, kept[1] ?? null], gone: saved.length - kept.length };
}

/** `teamKey` changes when «צוות המחזור» does (a member added, deactivated): the choice is read again. */
export function DayOwnersPanel({ data, editionId, teamKey }: { data: DataPort; editionId: number; teamKey?: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const w = await data.loadWeek(editionId);
      setLoaded({ owners: w.dayOwners ?? [], team: w.team, edition: w.edition });
    } catch {
      setFailed(true);
    }
  }, [data, editionId]);
  useEffect(() => {
    setLoaded(null);
    void load();
  }, [load, teamKey]);

  return (
    <Panel title="ימים" aside="לכל יום עד שני אחראים — «היום שלי» שלהם">
      {failed ? (
        <LoadError onRetry={() => void load()} />
      ) : !loaded ? (
        <Loading />
      ) : (
        <ul className="divide-y divide-sage/60 border-y border-sage/60" aria-label="האחראים לכל יום">
          {DAYS.map((day) => (
            <DayRow
              key={`${day}:${loaded.owners.filter((o) => o.day === day).map((o) => o.member_id).join(",")}`}
              data={data}
              editionId={editionId}
              day={day}
              loaded={loaded}
              onSaved={load}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DayRow({ data, editionId, day, loaded, onSaved }: { data: DataPort; editionId: number; day: Day; loaded: Loaded; onSaved: () => Promise<void> }) {
  const id = useId();
  const { busy, run } = useAction();
  const saved = loaded.owners.filter((o) => o.day === day).map((o) => o.member_id).sort((a, b) => a - b);
  const candidates = dayOwnerCandidates(loaded.team);
  const start = initialPicks(saved, candidates);
  const [picks, setPicks] = useState<(number | null)[]>(start.picks);
  const chosen = [...new Set(picks.filter((p): p is number => p != null))].sort((a, b) => a - b);
  const changed = chosen.join(",") !== saved.join(",");
  const date = dateOf(loaded.edition.start_date, day);

  const select = (i: 0 | 1) => {
    const other = picks[1 - i];
    return (
      <div className="min-w-0 flex-1 basis-40">
        <label htmlFor={`${id}-${i}`} className="mb-1 block text-sm font-bold text-ink">
          אחראי/ת {i + 1}
        </label>
        <select
          id={`${id}-${i}`}
          value={picks[i] ?? ""}
          onChange={(e) => {
            const v = e.target.value === "" ? null : Number(e.target.value);
            setPicks((p) => (i === 0 ? [v, p[1]] : [p[0], v]));
          }}
          className={INPUT}
          data-day-owner-select={`${day}:${i}`}
        >
          <option value="">—</option>
          {candidates
            .filter((c) => c.id !== other)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name ?? "חבר/ת צוות"}
              </option>
            ))}
        </select>
      </div>
    );
  };

  return (
    <li className="flex flex-wrap items-end gap-x-3 gap-y-2 py-3" data-day-owners={day}>
      <div className="w-28 shrink-0 self-center">
        <p className="font-bold text-navy">יום {DAY_NAMES[day]}</p>
        <p className="text-xs text-ink-soft">{date ? shortDate(date) : "תאריך TBD"}</p>
      </div>
      {select(0)}
      {select(1)}
      <Button
        kind="primary"
        keepFocus
        disabled={!changed}
        busy={busy === "owners"}
        busyLabel="שומר…"
        onClick={async () => {
          if (await run("owners", () => data.commands(editionId).setDayOwners(day, chosen), `נשמר: יום ${DAY_NAMES[day]}`)) await onSaved();
        }}
      >
        {/* five of them in a list: each says its day to a screen reader */}
        שמירה<span className="sr-only"> של יום {DAY_NAMES[day]}</span>
      </Button>
      {start.gone > 0 && (
        <p className="basis-full text-sm text-ink-soft" data-owner-gone>
          {start.gone === 1 ? "אחראי/ת אחד/ת כבר לא פעיל/ה בצוות" : "שני האחראים כבר לא פעילים בצוות"} — בשמירה {start.gone === 1 ? "יוסר/תוסר" : "יוסרו"} מהיום.
        </p>
      )}
    </li>
  );
}
