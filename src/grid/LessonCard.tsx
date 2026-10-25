// One lesson on the grid, drawn by its stage: a draft with candidates, a closed
// lesson (its topic's stripe and name + five stage dots, and a red dot «לעדכן את המרצה"
// when it changed after the message went out), or a memorial slot. The
// progress lens paints a closed card by its sources, last year's colours.
import { memorialCard } from "../domain/memorial";
import { displayName } from "../domain/names";
import { PROGRESS_LABEL, PROGRESS_TONE, type ProgressTone, progressOf } from "../domain/progress";
import { readerFilesOf, stagesOf } from "../domain/stages";
import { LRM, fmtRange } from "../domain/time";
import type { Lesson } from "../domain/types";
import { Chip, GenderDot, Initials, ReconfirmDot, StageDots } from "./bits";
import { type GridModel, pitchSpeaker } from "./model";
import { lessonOwner } from "./owners";

export type Lens = "diversity" | "progress" | "owner";
/** The «אחריות» lens's colour per handler, and «רק של X» (v13): the others' cards fade. */
export type CardOwners = { colorOf: Map<number, string>; only: number | "none" | null };
export { PROGRESS_TONE };

interface Props {
  model: GridModel;
  lesson: Lesson;
  lens: Lens;
  height: number;
  /** Highlighted as the drop target under the pointer, or the cell being placed into. */
  active?: boolean;
  /** In placement mode: this draft accepts the speaker. */
  placeable?: boolean;
  /** A memorial slot's own time and room, as a line of its own (the day view, when the slot is not its row's alone). */
  where?: { range: string; room: string | null };
  owners?: CardOwners;
  onOpen: () => void;
}

const PITCH_ICON: Record<string, string> = { approached: "✉", candidate: "?", declined: "✗" };

export function LessonCard({ model, lesson, lens, height, active, placeable, where, owners, onOpen }: Props) {
  const compact = height < 64;
  const tiny = height < 40;
  const time = <bdi className="text-[10px] text-ink-faint tabular-nums">{fmtRange(lesson.start_min, lesson.end_min)}</bdi>;
  const ring = active ? "ring-2 ring-accent" : placeable ? "ring-2 ring-ok/70" : "";
  const warnings = model.warningCount.get(lesson.id) ?? 0;
  const parallel = lesson.parallel_reason ? <span title={lesson.parallel_reason}>∥</span> : null;
  const room = model.week.rooms.find((r) => r.id === lesson.room_id);
  // the «אחריות» lens: the handler's colour as the stripe, on drafts too; «רק של X» fades the rest
  const ownerId = lens === "owner" ? lessonOwner(model, lesson) : null;
  const ownerColor = ownerId != null ? owners?.colorOf.get(ownerId) : undefined;
  const faded = lens === "owner" && owners?.only != null && lesson.kind === "lesson" && (owners.only === "none" ? ownerId != null : ownerId !== owners.only);
  const common = {
    "data-lesson-id": lesson.id,
    "data-owner": lens === "owner" && lesson.kind === "lesson" ? (ownerId ?? "none") : undefined,
    onClick: onOpen,
    className: `group absolute inset-0 m-0.5 overflow-hidden rounded-md text-start transition-shadow hover:shadow-md focus-visible:z-10 ${ring} ${faded ? "opacity-30" : ""}`,
  } as const;

  if (lesson.kind === "memorial") {
    // the yellow card (DESIGN «זיכרון»): the fallen's name, the family's status, the planned minutes — never a contact
    // The fallen's name first, alone: on the desktop grid a lane is ~180px (79px with two slots in a row), and
    // «זמן זיכרון – » took a third of it, cutting the surname. The yellow says «זמן זיכרון»; the accessible name and the
    // tooltip keep the whole title (the tooltip is plain text: an LRM keeps its range left to right).
    const card = memorialCard(model.week, lesson);
    const range = fmtRange(lesson.start_min, lesson.end_min);
    return (
      <button
        type="button"
        {...common}
        data-memorial-card={card.plan?.id ?? ""}
        aria-label={`${card.title}, ${range}${where?.room ? `, ${where.room}` : ""}: ${card.line}`}
        title={`${card.title} · ${LRM}${range} · ${card.line}`}
        className={`${common.className} bg-amber-100 border border-amber-300 px-2 py-0.5 leading-tight`}
      >
        <span data-memorial-name className="block truncate text-xs font-semibold text-amber-950">
          {card.name}
        </span>
        {where && (
          <span data-memorial-where className="block truncate text-[10px] text-amber-900">
            <bdi dir="ltr">{where.range}</bdi>
            {where.room && ` · ${where.room}`}
          </span>
        )}
        {!tiny && <span className="block truncate text-[10px] text-amber-900">{card.line}</span>}
      </button>
    );
  }

  if (lesson.state === "draft") {
    const pitches = model.pitchesByLesson.get(lesson.id) ?? [];
    const shown = pitches.slice(0, tiny ? 1 : 2);
    return (
      <button
        type="button"
        {...common}
        data-drop={`lesson:${lesson.id}`}
        className={`${common.className} border-2 border-dashed border-ink-faint/60 ${lens === "progress" ? PROGRESS_TONE.draft : "bg-card/70"} px-1.5 py-1`}
        style={ownerColor ? { borderInlineStartStyle: "solid", borderInlineStartWidth: 8, borderInlineStartColor: ownerColor } : undefined}
        aria-label={`טיוטה ${fmtRange(lesson.start_min, lesson.end_min)}${pitches.length ? `, ${pitches.length} מועמדים` : ", ללא מרצה"}`}
      >
        <span className="flex items-center gap-1">
          {parallel}
          {!compact && room && lesson.parallel_reason && <span className="truncate text-[10px] text-ink-faint">{room.name}</span>}
          {!tiny && <span className="ms-auto">{time}</span>}
        </span>
        <span className={`mt-0.5 flex ${compact ? "flex-row gap-1" : "flex-col gap-0.5"}`}>
          {shown.map((p) => {
            const s = pitchSpeaker(model, p);
            const owner = model.memberName.get(model.approachById.get(p.approach_id)?.owner_member_id ?? -1);
            return (
              <span
                key={p.id}
                data-drag={`pitch:${p.id}`}
                data-drag-label={s ? displayName(s) : ""}
                className={`flex items-center gap-1 rounded bg-paper px-1 text-[11px] leading-5 ${p.state === "declined" ? "line-through opacity-60" : ""}`}
              >
                <span aria-hidden>{PITCH_ICON[p.state] ?? "·"}</span>
                <GenderDot gender={s?.gender ?? null} />
                <span className="truncate">{s ? displayName(s) : "?"}</span>
                {!compact && owner && <span className="truncate text-ink-faint">· {owner}</span>}
              </span>
            );
          })}
          {pitches.length > shown.length && <span className="text-[11px] text-ink-faint">+{pitches.length - shown.length}</span>}
          {pitches.length === 0 && <span className="text-[11px] text-ink-faint">{lesson.parallel_reason ? "מקביל — ללא מרצה" : "מעוצב — ללא מרצה"}</span>}
        </span>
      </button>
    );
  }

  // closed
  const lead = model.leadOf.get(lesson.id);
  const cat = lesson.category_id != null ? model.categoryById.get(lesson.category_id) : undefined;
  const stages = stagesOf(lesson, readerFilesOf(model.week, lesson.id));
  const progressBg = lens === "progress" ? PROGRESS_TONE[progressOf(lesson.sources_kind)] : "bg-card";
  const owner = ownerId != null ? model.memberName.get(ownerId) : undefined;
  // the stripe: the topic's colour (v13: in every lens), the handler's in «אחריות»
  const stripe = lens === "owner" ? (ownerColor ?? "#c9c2b3") : (cat?.color ?? "#c9c2b3");
  const reconfirm = lesson.needs_reconfirm;
  return (
    <button
      type="button"
      {...common}
      data-drag={`lesson:${lesson.id}`}
      data-drag-label={lead ? displayName(lead) : ""}
      className={`${common.className} border ${reconfirm ? "border-bad" : "border-line"} ${progressBg} px-1.5 py-1 shadow-sm`}
      style={{ borderInlineStartWidth: 8, borderInlineStartColor: stripe }}
      aria-label={`${lead ? displayName(lead) : "שיעור"} — ${lesson.title ?? "ללא כותרת"}, ${fmtRange(lesson.start_min, lesson.end_min)}${reconfirm ? ", לעדכן את המרצה" : ""}`}
    >
      <span className="flex items-center gap-1">
        <GenderDot gender={lead?.gender ?? null} />
        <span className="truncate text-xs font-semibold">{lead ? displayName(lead) : "—"}</span>
        {parallel}
        {reconfirm && <ReconfirmDot />}
        {warnings > 0 && <span className="ms-auto shrink-0 rounded-full bg-amber-400 px-1 text-[10px] font-bold text-ink">{warnings}</span>}
      </span>
      {!tiny && <span className="block truncate text-[11px] text-ink-soft">{lesson.title ?? "כותרת: TBD"}</span>}
      {!compact && lens !== "owner" && (
        <span data-category className="block truncate text-[10px] font-semibold" style={{ color: cat?.color ?? "#6b6457" }}>
          {cat ? cat.name : "נושא: TBD"}
        </span>
      )}
      {!compact && (
        <span className="mt-0.5 flex items-center gap-1">
          {lens === "owner" && owner ? (
            <>
              <Initials name={owner} />
              <span className="truncate text-[10px] text-ink-soft">{owner}</span>
            </>
          ) : (
            <StageDots lesson={lesson} week={model.week} />
          )}
          {lesson.audience && <Chip>{lesson.audience}</Chip>}
          <span className="ms-auto">{time}</span>
        </span>
      )}
      {compact && !tiny && stages.some((s) => s.state === "problem") && <span className="sr-only">יש בעיה באחד השלבים</span>}
    </button>
  );
}

/** The legend under the toolbar while the progress lens is on (memorial slots keep their own yellow card). */
export const PROGRESS_LEGEND: [ProgressTone, string][] = (["received", "presentation", "pending", "none", "draft"] as const).map((t) => [t, PROGRESS_LABEL[t]]);
