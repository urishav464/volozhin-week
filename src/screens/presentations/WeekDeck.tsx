// «המצגת של השבוע» (the reset, phase 5): the week's own presentations — on the cover path, any number of them, shown
// between the lessons in every room. An admin of the edition uploads them (never Word: app.source_refusal refuses a
// docx on the cover path); everyone reads and downloads them, and they go first into every day's zip.
import { useId, useRef } from "react";
import type { DataPort } from "../../data/port";
import { weekPresentations } from "../../domain/presentations";
import type { Week } from "../../domain/types";
import { useFocusRescue } from "../settings/kit";
import type { Notify } from "../speakers/parts";
import type { Actor } from "../weekStore";
import { PresentationFile } from "./PresentationFile";
import { PresentationUpload } from "./PresentationUpload";

export function WeekDeck({ port, week, actor, notify, clear, reload, newSince }: { port: DataPort; week: Week; actor: Actor; notify: Notify; clear: () => void; reload: () => Promise<void>; newSince: ReadonlySet<number> }) {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const rescue = useFocusRescue();
  const decks = weekPresentations(week);
  const mayUpload = actor.isAdmin && actor.canEdit;
  if (decks.length === 0 && !mayUpload) return null;
  return (
    <section ref={root} tabIndex={-1} data-week-presentation aria-labelledby={`${id}-title`} className="rounded-xl border border-line bg-card p-4 shadow-sm outline-none sm:p-5">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={`${id}-title`} className="font-display text-lg font-bold text-navy">
          המצגת של השבוע
        </h3>
        <span className="text-sm text-ink-soft">בכל החדרים, בין השיעורים — נכנסת לכל יום בהורדה</span>
      </div>
      {decks.length === 0 ? (
        <p className="text-sm text-ink-soft">עוד לא הועלתה מצגת לשבוע.</p>
      ) : (
        <ul aria-label="המצגת של השבוע" className="divide-y divide-line">
          {decks.map((f) => (
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
      {mayUpload && (
        <div className="mt-2">
          <PresentationUpload port={port} week={week} lessonId={null} notify={notify} clear={clear} reload={reload} />
        </div>
      )}
    </section>
  );
}
