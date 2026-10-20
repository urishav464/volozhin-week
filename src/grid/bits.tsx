// Small shared pieces of the grid's look.
import type { ReactNode } from "react";
import { readerFilesOf, type StageState, stagesOf } from "../domain/stages";
import type { Gender, Lesson, Week } from "../domain/types";

export function GenderDot({ gender, className = "" }: { gender: Gender | null; className?: string }) {
  const color = gender === "f" ? "bg-pink-400" : gender === "m" ? "bg-sky-500" : "bg-ink-faint";
  const label = gender === "f" ? "אישה" : gender === "m" ? "גבר" : "מגדר לא ידוע";
  return <span role="img" aria-label={label} title={label} className={`inline-block size-2 rounded-full shrink-0 ${color} ${className}`} />;
}

export function Chip({ children, tone = "plain", title }: { children: ReactNode; tone?: "plain" | "warn" | "bad" | "ok" | "info"; title?: string }) {
  const tones = {
    plain: "bg-paper border-line text-ink-soft",
    warn: "bg-amber-50 border-amber-300 text-amber-900",
    bad: "bg-red-50 border-red-300 text-red-800",
    ok: "bg-emerald-50 border-emerald-300 text-emerald-900",
    info: "bg-sky-50 border-sky-200 text-sky-900",
  };
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** A stage's dot, by its state: filled green when done, amber while it waits, red for a problem, hollow while open, dashed when not needed. */
export const STAGE_DOT: Record<StageState, string> = {
  done: "bg-ok border-ok",
  open: "bg-transparent border-ink-faint",
  waiting: "bg-warn border-warn",
  problem: "bg-bad border-bad",
  na: "bg-transparent border-ink-faint border-dashed", // quiet, but visible: dashed, not a hollow «open»
};

/** The card's five dots: תשלום/הסעה · הודעה · מלווה · מקורות · מקראה (src/domain/stages.ts). */
/** What each dot state means — the progress lens's legend, and its words for a screen reader. */
export const STAGE_STATE_LABEL: Record<StageState, string> = { done: "מוכן", waiting: "מחכה", problem: "לטפל", open: "פתוח", na: "לא נדרש" };

export function StageDots({ lesson, week }: { lesson: Lesson; week: Pick<Week, "sourceFiles" | "lessonSpeakers"> }) {
  const stages = stagesOf(lesson, readerFilesOf(week, lesson.id));
  return (
    <span role="img" className="inline-flex shrink-0 gap-1" aria-label={stages.map((s) => `${s.label}: ${s.note}`).join(", ")}>
      {stages.map((s) => (
        <span key={s.key} data-stage={s.key} data-state={s.state} title={`${s.label}: ${s.note}`} className={`size-2 rounded-full border ${STAGE_DOT[s.state]}`} />
      ))}
    </span>
  );
}

/** «לעדכן את המרצה»: the lesson changed after its summary message went out (lessons.needs_reconfirm). */
export function ReconfirmDot({ className = "" }: { className?: string }) {
  return <span role="img" data-reconfirm aria-label="לעדכן את המרצה" title="לעדכן את המרצה: השיעור השתנה אחרי שההודעה נשלחה" className={`inline-block size-2.5 shrink-0 rounded-full bg-bad ring-2 ring-bad/25 ${className}`} />;
}

export function Initials({ name }: { name: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return <span className="inline-grid place-items-center size-5 rounded-full bg-ink text-paper text-[10px] font-semibold">{letters || "?"}</span>;
}
