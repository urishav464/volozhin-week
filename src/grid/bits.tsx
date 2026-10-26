// Small shared pieces of the grid's look.
import type { ReactNode } from "react";
import { readerFilesOf, type StageState, stagesOf } from "../domain/stages";
import type { Category, Gender, Lesson, Week } from "../domain/types";

/** A lesson with no topic (or no handler, in «אחריות»): the neutral the cards, the strip and the summary share. */
export const NO_TOPIC_COLOR = "#c9c2b3";

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

/**
 * A speaker's topic. One that is the name of an active category of the week (the pool filter's exact match)
 * wears that category's colour — the dot and the wash of the lesson panel's topic pill, the grid's stripe — so
 * a speaker reads in the colour of the lessons they could fill; a free tag stays a plain grey chip.
 */
export function TopicChip({ name, category }: { name: string; category?: Pick<Category, "color"> | null }) {
  if (!category) return <Chip>{name}</Chip>;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap text-ink"
      style={{ backgroundColor: `color-mix(in srgb, ${category.color} 10%, transparent)`, borderColor: `color-mix(in srgb, ${category.color} 35%, transparent)` }}
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
      {name}
    </span>
  );
}

/** A speaker's topics, each with its category when it is one: the week's own topics first, then the free tags, each in the order given. */
export function topicsOf(topics: readonly string[], categories: readonly Category[]): { name: string; category: Category | undefined }[] {
  const byName = new Map(categories.filter((c) => c.active).map((c) => [c.name, c]));
  const all = topics.map((name) => ({ name, category: byName.get(name) }));
  return [...all.filter((t) => t.category), ...all.filter((t) => !t.category)];
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
