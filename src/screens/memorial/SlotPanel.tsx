// A memorial slot in the week's lesson panel (milestone 5ב-2): the plan placed
// on it — the fallen, the family's status, who speaks, the minutes, «בלי
// חריגה», the reader's materials note — its liaison (the slot's escort: the
// team's contact person with the family), its materials (src/screens/stages/
// SourceFiles.tsx: the plan's files, wherever they were uploaded) with the
// reader's verdict on them — a lesson's words: «צריך PDF», «צריך קובץ אחר» —
// and the way to «זמני זיכרון», where admins plan and place. Never a family's
// contact. Its parts are Sections, ruled apart by the Sheet like every panel's.
import { useMemo } from "react";
import { Link } from "react-router";
import { FAMILY_STATUS_LABEL } from "../../data/memorial";
import type { DataPort } from "../../data/port";
import { fallenName, minutesText, planOf } from "../../domain/memorial";
import type { FamilyStatus, Lesson, Week } from "../../domain/types";
import { Meta, Section } from "../../grid/Panels";
import { MEMORIAL_SAID, type ManifestRow, memorialLeftovers, readerManifest, STATUS_LABEL } from "../../reader/model";
import type { Notify } from "../speakers/parts";
import { SourceFiles } from "../stages/SourceFiles";
import type { Actor } from "../weekStore";

type PlanStatus = "memorial_received" | "memorial_needs_pdf" | "memorial_unreadable" | "memorial_missing";

/** A slot with a plan in the reader, in a lesson's words: the panel's title already says «זמן זיכרון». */
const SHORT: Record<PlanStatus, string> = {
  memorial_received: STATUS_LABEL.included,
  memorial_needs_pdf: STATUS_LABEL.needs_pdf,
  memorial_unreadable: STATUS_LABEL.unreadable,
  memorial_missing: STATUS_LABEL.missing,
};

/** The manifest's row for a slot with a plan (its verdict and files), or null. */
export function useMemorialReader(week: Week, lessonId: number): (ManifestRow & { status: PlanStatus }) | null {
  return useMemo(() => {
    const row = readerManifest(week).rows.find((r) => r.lesson.id === lessonId);
    return row && row.status in SHORT ? (row as ManifestRow & { status: PlanStatus }) : null;
  }, [week, lessonId]);
}

/** The reader's verdict as a pill: «חסר», «צריך PDF», «צריך קובץ אחר», «התקבל» — and, where the files are folded away, how many. */
export function MemorialReaderPill({ status, files }: { status: PlanStatus; files?: number }) {
  return (
    <span data-memorial-reader={status}>
      <Meta tone={status === "memorial_received" ? "plain" : "warn"}>
        {SHORT[status]}
        {files ? ` · ${files === 1 ? "קובץ אחד" : `${files} קבצים`}` : ""}
      </Meta>
    </span>
  );
}

/** What to do about it, only when something must be done beyond uploading (MEMORIAL_SAID): a Word file, a file not read. */
export function MemorialReaderSaid({ status }: { status: PlanStatus }) {
  if (status !== "memorial_needs_pdf" && status !== "memorial_unreadable") return null;
  return <p className="mb-2 text-sm text-ink-soft">{MEMORIAL_SAID[status]}</p>;
}

/** The family's word: amber while it is still awaited. */
function FamilyPill({ status }: { status: FamilyStatus }) {
  return <Meta tone={status === "not_contacted" || status === "invited" ? "warn" : "plain"}>{FAMILY_STATUS_LABEL[status]}</Meta>;
}

export function MemorialSlotPanel({ port, week, lesson: l, actor, notify, clear, reload }: { port: DataPort; week: Week; lesson: Lesson; actor: Actor; notify: Notify; clear: () => void; reload: () => Promise<void> }) {
  const plan = planOf(week, l.id);
  const reader = useMemorialReader(week, l.id);
  const liaison = l.escort_roster_id != null ? (week.roster.find((r) => r.id === l.escort_roster_id)?.full_name ?? "חניך/ה שנמחק/ה") : null;
  const files = <SourceFiles port={port} week={week} lesson={l} actor={actor} notify={notify} clear={clear} reload={reload} />;
  const link = (
    <Link to="/memorial" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
      {actor.isAdmin ? "לשיבוץ ולעריכה ב«זמני זיכרון»" : "למסך «זמני זיכרון»"}
    </Link>
  );
  if (!plan) {
    return (
      <section aria-label="זמן הזיכרון" className="space-y-3">
        <p className="text-sm text-ink-soft">עוד לא שובץ/ה כאן חלל/ה.</p>
        {/* a plan's files waiting in the tray are that plan's (its card in «זמני זיכרון»), never this slot's to remove */}
        {memorialLeftovers(week, l).length > 0 && files}
        {link}
      </section>
    );
  }
  return (
    <>
      <Section title={fallenName(week, plan.fallen_id)} label="זמן הזיכרון" aside={<FamilyPill status={plan.family_status} />}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-s-4 border-amber-300 ps-3 text-sm">
          <dt className="text-ink-soft">מדבר/ת</dt>
          <dd className="min-w-0 break-words">{plan.speaker_text ?? "TBD"}</dd>
          <dt className="text-ink-soft">דקות</dt>
          <dd>
            {minutesText(plan.planned_minutes)}
            {plan.hard_stop && " · בלי חריגה"}
          </dd>
          <dt className="text-ink-soft">קשר עם המשפחה</dt>
          <dd>{liaison ?? "עוד לא נקבע/ה"}</dd>
          {plan.materials_note && (
            <>
              <dt className="text-ink-soft">למקראה</dt>
              <dd className="min-w-0 break-words">{plan.materials_note}</dd>
            </>
          )}
        </dl>
      </Section>
      <Section title="חומרים למקראה" aside={reader && <MemorialReaderPill status={reader.status} />}>
        {reader && <MemorialReaderSaid status={reader.status} />}
        {files}
      </Section>
      <div>{link}</div>
    </>
  );
}
