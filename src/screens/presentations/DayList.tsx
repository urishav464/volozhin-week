// The day's list on «מצגות» (the reset, phase 5): one row per closed lesson and memorial time, in the schedule's order —
// the time, the room, speaker · title (a link to the lesson page's «מצגות»), what the row has for the room («מצגת» /
// «קישור למצגת» / «מצגת צפויה — עוד לא הועלתה» / «בלי מצגת» / «זמן זיכרון», never a name), each file with «פתיחה» or
// «הורדה» and «הסרה», the link, and «העלאת מצגת» for whoever may upload (a content member or an admin: every row is a
// closed lesson; logistics never — no input is drawn).
import { useRef } from "react";
import { Link } from "react-router";
import type { DataPort } from "../../data/port";
import { PRESENTATION_STATE_LABEL, type PresentationRow } from "../../domain/presentations";
import { lessonPath } from "../../domain/routes";
import { fmtRange, nightLabel } from "../../domain/time";
import type { Week } from "../../domain/types";
import { Badge, useFocusRescue } from "../settings/kit";
import type { Notify } from "../speakers/parts";
import type { Actor } from "../weekStore";
import { PRESENTATION_TONE, PresentationFile, PresentationLink } from "./PresentationFile";
import { PresentationUpload } from "./PresentationUpload";


export interface DayListProps {
  port: DataPort;
  week: Week;
  rows: PresentationRow[];
  actor: Actor;
  notify: Notify;
  clear: () => void;
  reload: () => Promise<void>;
  newSince: ReadonlySet<number>;
  /** The hint above the list, which every row's «העלאת מצגת» is described by. */
  hintId: string;
}

export function DayList({ port, week, rows, actor, notify, clear, reload, newSince, hintId }: DayListProps) {
  const root = useRef<HTMLUListElement>(null);
  const rescue = useFocusRescue();
  return (
    <ul ref={root} tabIndex={-1} aria-label="השיעורים של היום" className="divide-y divide-line rounded-xl border border-line bg-card px-4 shadow-sm outline-none sm:px-5">
      {rows.map((r) => (
        <li key={r.lessonId} data-presentation-row={r.lessonId} data-state={r.state} className={`flex flex-col gap-2 py-3 md:flex-row md:gap-4 ${r.kind === "memorial" ? "text-ink-soft" : ""}`}>
          <div className="flex shrink-0 flex-wrap items-baseline gap-x-2 md:w-40 md:flex-col md:gap-0">
            <bdi dir="ltr" className="font-bold tabular-nums text-ink">
              {fmtRange(r.start_min, r.end_min)}
            </bdi>
            {/* 00:30 under «יום ראשון» is the night after it, as the guests' schedule and the tables say */}
            {nightLabel(r.day, r.start_min) && <span data-night className="text-xs text-ink-soft">{nightLabel(r.day, r.start_min)}</span>}
            <span className="text-sm text-ink-soft">
              <bdi>{r.room}</bdi>
            </span>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {r.kind === "lesson" ? (
                <Link to={lessonPath(r.lessonId, "sources", "presentations")} className="inline-flex min-h-11 min-w-0 items-center break-words text-start font-bold text-navy underline-offset-4 hover:underline">
                  <bdi>{[r.speaker, r.title].filter(Boolean).join(" · ")}</bdi>
                </Link>
              ) : (
                <span className="inline-flex min-h-11 items-center font-semibold">{PRESENTATION_STATE_LABEL.memorial}</span>
              )}
              {r.kind === "lesson" && <Badge tone={PRESENTATION_TONE[r.state]}>{PRESENTATION_STATE_LABEL[r.state]}</Badge>}
            </div>
            {r.files.length > 0 && (
              <ul aria-label="מצגות" className="divide-y divide-line/60">
                {r.files.map((f) => (
                  <PresentationFile
                    key={f.id}
                    port={port}
                    week={week}
                    file={f}
                    actor={actor}
                    notify={notify}
                    clear={clear}
                    reload={reload}
                    isNew={newSince.has(f.id)}
                    onRemoved={() => rescue(() => root.current)}
                  />
                ))}
              </ul>
            )}
            {r.link && <PresentationLink href={r.link} />}
            {r.kind === "lesson" && actor.canEdit && <PresentationUpload port={port} week={week} lessonId={r.lessonId} notify={notify} clear={clear} reload={reload} compact hintId={hintId} />}
          </div>
        </li>
      ))}
    </ul>
  );
}
