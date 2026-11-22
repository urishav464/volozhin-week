// The lesson page's «מצגות» (inside «מקורות ומצגת», the reset, phase 5): this lesson's presentations — open or download,
// upload, remove — and «מצגת צפויה — עוד לא הועלתה» when one is expected. Its root is `<section id="presentations"
// data-lesson-presentations>` with its own top border (it draws nothing when there is nothing to say: a memorial time,
// or a lesson that is not closed and kept no presentation). A previous speaker's are «מהמרצה הקודם», for removal; the
// link (`presentation_url`) is edited below («קישור למצגת», SourcesStage) and only opened here. Uploading changes nothing on the lesson:
// sources still «טרם התקבלו» say how to mark «מצגת».
import { useId, useRef } from "react";
import { Link } from "react-router";
import type { DataPort } from "../../data/port";
import { lessonPresentations, PRESENTATION_STATE_LABEL } from "../../domain/presentations";
import { presentationsPath } from "../../domain/routes";
import type { Lesson, Week } from "../../domain/types";
import { PRESENTATION_TONE, PresentationFile, PresentationLink } from "../presentations/PresentationFile";
import { PresentationUpload } from "../presentations/PresentationUpload";
import { Badge, useFocusRescue } from "../settings/kit";
import type { Notify } from "../speakers/parts";
import { PreviousFiles } from "../stages/SourceFiles";
import type { Actor } from "../weekStore";

export interface LessonPresentationsProps {
  port: DataPort;
  week: Week;
  lesson: Lesson;
  actor: Actor;
  notify: Notify;
  clear: () => void;
  reload: () => Promise<void>;
}


export function LessonPresentations({ port, week, lesson: l, actor, notify, clear, reload }: LessonPresentationsProps) {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const rescue = useFocusRescue();
  if (l.kind !== "lesson") return null;
  const p = lessonPresentations(week, l);
  const closed = l.state === "closed";
  if (!closed && p.previous.length === 0) return null;
  const mayUpload = actor.canEdit && closed;
  return (
    <section ref={root} id="presentations" tabIndex={-1} data-lesson-presentations aria-labelledby={`${id}-title`} className="scroll-mt-4 space-y-2 border-t border-line pt-3 outline-none">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h4 id={`${id}-title`} className="text-sm font-bold">
          מצגות
        </h4>
        {closed && <Badge tone={PRESENTATION_TONE[p.state]}>{PRESENTATION_STATE_LABEL[p.state]}</Badge>}
        {closed && (
          <Link to={presentationsPath({ day: l.day, room: l.room_id })} className="ms-auto inline-flex min-h-11 items-center text-sm font-bold text-navy underline-offset-4 hover:underline">
            לדף המצגות ‹
          </Link>
        )}
      </div>
      {closed && p.files.length === 0 && !p.link && (
        <p className="text-sm text-ink-soft">{p.state === "missing" ? "סומן שיש מצגת, ועוד לא הועלתה. מעלים אותה כאן, או ממלאים «קישור למצגת» למטה." : "לא הועלתה מצגת לשיעור הזה."}</p>
      )}
      {p.files.length > 0 && (
        <ul aria-label="המצגות של השיעור" className="divide-y divide-line">
          {p.files.map((f) => (
            <PresentationFile key={f.id} port={port} week={week} file={f} actor={actor} notify={notify} clear={clear} reload={reload} onRemoved={() => rescue(() => root.current)} />
          ))}
        </ul>
      )}
      {p.link && <PresentationLink href={p.link} />}
      {mayUpload && <PresentationUpload port={port} week={week} lessonId={l.id} notify={notify} clear={clear} reload={reload} onLessonPage />}
      {p.previous.length > 0 && <PreviousFiles port={port} week={week} files={p.previous} actor={actor} notify={notify} reload={reload} />}
    </section>
  );
}
