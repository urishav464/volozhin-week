// Pieces the lesson's stage sections share (src/screens/stages/): the
// disclosure each stage opens in, a row of radio choices, and what every
// section is handed — the lesson, who is looking, the commands and the runner.
// Built from «הגדרות»'s kit: one column on a phone, every control 44px tall.
import type { ReactNode } from "react";
import type { WeekCommands } from "../../data/commands";
import type { Stage } from "../../domain/stages";
import { TICK_TEAM_LABEL, ticksOf } from "../../domain/escorts";
import { type Lesson, TICK_ITEMS, type Week } from "../../domain/types";
import { STAGE_DOT } from "../../grid/bits";
import { Button, CHOICE, CHOICE_OFF, CHOICE_ON } from "../settings/kit";
import type { Actor } from "../weekStore";

/** A command, then the week again; `onRefused` may show a refusal beside the form instead of a toast. */
export type Act = (key: string, fn: () => Promise<unknown>, ok: string | null, onRefused?: (code: string | null) => boolean) => Promise<boolean>;

export interface StageCtx {
  week: Week;
  /** A closed lesson. */
  lesson: Lesson;
  actor: Actor;
  cmds: WeekCommands;
  busy: string | null;
  act: Act;
  /** The lesson's handler (members.id): who owns the lead speaker's approach. */
  handler: number | null;
  /** The handler or an admin of the edition, able to edit here: asks for payment, sends the message (app.require_handler). */
  mine: boolean;
}

/** The team member's name (week.team), or a neutral word for someone no longer on it. */
export function memberName(week: Week, id: number | null | undefined): string | null {
  if (id == null) return null;
  return week.team.find((t) => t.id === id)?.display_name ?? "חבר/ת צוות";
}

const WHEN = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });

/** «20.10, 14:05» — when something was sent, decided, paid. */
export function whenText(at: string | null | undefined): string {
  if (!at) return "";
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : WHEN.format(d);
}

/** An archive (or archived) edition: only admins act there (`archived`). */
export function archivedEdition(week: Week): boolean {
  return week.edition.kind === "archive" || week.edition.status === "archived";
}

/**
 * One stage of the lesson as a disclosure: its dot, name and where it stands — tapping it
 * opens the section. Collapsed, the five read as the card's five dots do. A row of `StageList`:
 * the list draws the frame and the hairlines, an open row's body is tinted, never boxed.
 */
export function StageSection({ stage, open, onToggle, children }: { stage: Pick<Stage, "label" | "state" | "note"> & { key: string }; open: boolean; onToggle: () => void; children: ReactNode }) {
  const id = `stage-${stage.key}`;
  return (
    <section id={id} aria-label={stage.label} data-stage-section={stage.key} data-state={stage.state} className="group/stage scroll-mt-2">
      <h4>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={onToggle}
          className="flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-start transition-colors hover:bg-accent-soft/60 group-first/stage:rounded-t-[13px] group-last/stage:aria-[expanded=false]:rounded-b-[13px]"
        >
          <span aria-hidden className={`size-3 shrink-0 rounded-full border-2 ${STAGE_DOT[stage.state]}`} />
          <span className="shrink-0 font-bold text-navy">{stage.label}</span>
          <span className="min-w-0 truncate text-sm text-ink-soft">{stage.note}</span>
          <span aria-hidden className={`ms-auto shrink-0 text-navy motion-safe:transition-transform ${open ? "rotate-180" : ""}`}>
            ▾
          </span>
        </button>
      </h4>
      {open && (
        <div id={`${id}-body`} className="space-y-3 bg-sand-soft px-3 pb-3.5 pt-2.5 group-last/stage:rounded-b-[13px]">
          {children}
        </div>
      )}
    </section>
  );
}

/** The frame of a list of `StageSection`s: one card, a hairline between rows (an open row's body tinted sand). */
export function StageList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line rounded-xl border border-line bg-card shadow-sm">{children}</div>;
}

/**
 * A stage's saved values, read first (as «פרטי השיעור» is): label and value in rows, and on the first row a quiet
 * «עריכה» that opens the form — only for whom may edit.
 */
export function SavedView({ onEdit, children }: { onEdit?: () => void; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">{children}</dl>
      {onEdit && (
        <Button kind="quiet" className="-me-2 -mt-2.5 shrink-0" onClick={onEdit}>
          עריכה
        </Button>
      )}
    </div>
  );
}

/** A row of radio choices that wrap on a phone (each 44px tall). */
export function Choice<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
  disabled = false,
}: {
  name: string;
  legend: ReactNode;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="mb-1 text-sm font-bold text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, label]) => (
          <label key={v} className={`${CHOICE} min-w-0 max-w-full ${value === v ? CHOICE_ON : CHOICE_OFF}`}>
            <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} className="accent-navy" />
            <span className="min-w-0 break-words">{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A refusal beside the form it is about. */
export function Problem({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
      {children}
    </p>
  );
}

/** A link drawn as the kit's secondary Button (a navy outline pill), and as its primary one (solid navy). */
export const LINK_BUTTON =
  "inline-flex min-h-11 items-center rounded-full border border-navy bg-card px-3 text-sm font-bold text-navy transition-colors duration-150 hover:bg-accent-soft sm:px-4";
export const LINK_PRIMARY =
  "inline-flex min-h-11 items-center rounded-full bg-navy px-3 text-sm font-bold text-white transition-colors duration-150 hover:bg-navy-800 sm:px-4";

/**
 * The escort's four ticks, as the team reads them (written only through the escort's link): each with when it was
 * first ticked, or not yet. In the lesson panel and the escorts' list; not printed (the printed list is the escort's).
 */
export function EscortTicksLine({ week, lessonId }: { week: Week; lessonId: number }) {
  const ticks = ticksOf(week.escortTicks ?? [], lessonId);
  return (
    <ul aria-label="הסימונים של המלווה" className="flex flex-wrap gap-1.5 text-xs print:hidden">
      {TICK_ITEMS.map((item) => {
        const at = ticks[item];
        return (
          // done: green on white with a green hairline (5:1 — on its own tint it is not); not yet: muted
          <li key={item} data-tick={item} data-done={at != null} className={`rounded-full px-2 py-0.5 ring-1 ring-inset ${at ? "bg-card font-bold text-ok ring-ok/40" : "bg-paper-light text-ink-soft ring-line"}`}>
            {at ? "✓" : "○"} {TICK_TEAM_LABEL[item]}
            {at && <span className="font-normal"> · {whenText(at)}</span>}
            <span className="sr-only">{at ? " (סומן)" : " (עוד לא)"}</span>
          </li>
        );
      })}
    </ul>
  );
}
