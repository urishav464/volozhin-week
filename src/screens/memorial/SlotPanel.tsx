// A memorial slot in the week's lesson panel (milestone 5ב-2): the plan placed
// on it — the fallen, the family's status, who speaks, the minutes, «בלי
// חריגה», the reader's materials note — its liaison (the slot's escort: the
// team's contact person with the family), its materials (src/screens/stages/
// SourceFiles.tsx: the plan's files, wherever they were uploaded), and the way
// to «זמני זיכרון», where admins plan and place. Never a family's contact.
import { Link } from "react-router";
import { FAMILY_STATUS_LABEL } from "../../data/memorial";
import type { DataPort } from "../../data/port";
import { fallenName, minutesText, planOf } from "../../domain/memorial";
import type { Lesson, Week } from "../../domain/types";
import type { Notify } from "../speakers/parts";
import { SourceFiles } from "../stages/SourceFiles";
import type { Actor } from "../weekStore";

export function MemorialSlotPanel({ port, week, lesson: l, actor, notify, clear, reload }: { port: DataPort; week: Week; lesson: Lesson; actor: Actor; notify: Notify; clear: () => void; reload: () => Promise<void> }) {
  const plan = planOf(week, l.id);
  const liaison = l.escort_roster_id != null ? (week.roster.find((r) => r.id === l.escort_roster_id)?.full_name ?? "חניך/ה שנמחק/ה") : null;
  return (
    <section aria-label="זמן הזיכרון" className="space-y-3">
      {plan ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">
          <p className="font-semibold">{fallenName(week, plan.fallen_id)}</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
            <dt>המשפחה</dt>
            <dd>{FAMILY_STATUS_LABEL[plan.family_status]}</dd>
            <dt>מדבר/ת</dt>
            <dd className="min-w-0 break-words">{plan.speaker_text ?? "TBD"}</dd>
            <dt>דקות</dt>
            <dd>
              {minutesText(plan.planned_minutes)}
              {plan.hard_stop && " · בלי חריגה"}
            </dd>
            <dt>קשר עם המשפחה</dt>
            <dd>{liaison ?? "עוד לא נקבע/ה"}</dd>
            {plan.materials_note && (
              <>
                <dt>למקראה</dt>
                <dd className="min-w-0 break-words">{plan.materials_note}</dd>
              </>
            )}
          </dl>
        </div>
      ) : (
        <p className="text-sm text-ink-soft">עוד לא שובץ/ה כאן חלל/ה.</p>
      )}
      {(plan || (week.sourceFiles ?? []).some((f) => f.lesson_id === l.id)) && <SourceFiles port={port} week={week} lesson={l} actor={actor} notify={notify} clear={clear} reload={reload} />}
      <Link to="/memorial" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
        {actor.isAdmin ? "לתכנון ולשיבוץ במסך «זמני זיכרון»" : "למסך «זמני זיכרון»"}
      </Link>
    </section>
  );
}
