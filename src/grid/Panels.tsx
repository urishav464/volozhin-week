// The side panel (a bottom sheet on a phone): what a lesson or an empty cell
// offers — candidates, the call and closing, the lesson's details, its stages after it
// closed (payment, the message, the escort, sources: src/screens/stages/,
// handed in by the week as `stages`), and reshaping the cell.
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { byGender, displayName } from "../domain/names";
import { DAY_NAMES, type Day, fmt, fmtRange, overlaps } from "../domain/time";
import { type Approach, type ApproachStatus, type Category, type Gender, type GridRow, LIVE_PITCH, type Lesson, type Pitch, type Speaker } from "../domain/types";
import type { CellTarget, LessonPatch, ReshapeOp } from "../data/commands";
import { type Span, cellSpan, sticksOut, timeSplitOk } from "../domain/shape";
import { readerFilesOf, reopenLoses, stagesOf } from "../domain/stages";
import { errorMessage } from "../errors";
import { statusLabel, vettingLabel } from "../lib/labels";
import { DEFAULT_MAX_CATEGORY_PER_DAY } from "../rules/warnings";
import { Button, Confirm, Fold, INPUT, useFocusBack } from "../screens/settings/kit";
import { CallPoints, CallResults } from "../screens/speakers/call";
import { Chip, GenderDot, STAGE_DOT } from "./bits";
import { needText } from "./DayHeader";
import { rowActive } from "./layout";
import { type Fit, type GridModel, POOL_SECTION_LABEL, type PoolSection, fitFor, guessedCategory, pitchSpeaker, poolSection, searchKey, speakerMatches } from "./model";

export interface PanelActions {
  propose: (speakerId: number, target: CellTarget, mode?: "self" | "offer") => void;
  unpropose: (pitchId: number) => void;
  /** «החזרה לתהליך» of a declined pitch — set_pitch(candidate): a declined approach comes back «לפני שיחה» with it (v14). */
  revive: (pitchId: number) => void;
  /** The call's result on the approach (set_approach_status), with what was said; the toast names the speaker and the result. */
  /** Resolves false when refused (the card keeps what was typed). */
  callResult: (approach: Approach, status: ApproachStatus, note: string | null) => Promise<boolean>;
  /** A global admin's «אישור» of a speaker who agreed (vet): closing waits for it. */
  approveSpeaker: (speakerId: number) => Promise<boolean>;
  close: (pitchId: number) => Promise<boolean>;
  reopen: (lessonId: number) => void;
  update: (lessonId: number, version: number, patch: LessonPatch) => void;
  reshape: (day: Day, rowStart: number, op: ReshapeOp) => void;
  /** The speaker sheet (src/screens/speakers/SpeakerSheet.tsx). */
  openSpeaker: (speakerId: number) => void;
}

export function Sheet({
  title,
  label,
  accent,
  subtitle,
  onClose,
  onBack,
  backLabel,
  children,
  wide,
}: {
  /** The heading: a name, or a node (a speaker's name that opens their sheet). */
  title: ReactNode;
  /** The dialog's name for a screen reader, when the heading is not plain text («שיעור סגור»). */
  label?: string;
  /** A band across the top in this colour: the lesson's topic, the same as its card's stripe. */
  accent?: string | null;
  subtitle?: ReactNode;
  onClose: () => void;
  /** Opened from another panel (a lesson, «מרצה חדש/ה»): «חזרה» — and Escape — return to it; × closes both. */
  onBack?: () => void;
  /** Where «חזרה» returns to, for a screen reader («חזרה לשיעור»). */
  backLabel?: string;
  children: ReactNode;
  wide: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Focus lands on the sheet once, when it opens: a reload behind it (a command,
  // another device) re-renders the parent and must not pull focus out of a field.
  const close = useRef(onClose);
  close.current = onBack ?? onClose;
  // On a wide screen the panel takes a column of its own: the page reflows beside it (index.css,
  // html[data-sheet]) instead of running under it, so nothing behind looks cut off or half-clickable.
  // No backdrop: the week is worked in, and the next card switches the panel in one click.
  useEffect(() => {
    if (!wide) return;
    const root = document.documentElement;
    root.dataset.sheet = String(Number(root.dataset.sheet ?? 0) + 1);
    return () => {
      const n = Number(root.dataset.sheet ?? 1) - 1;
      if (n > 0) root.dataset.sheet = String(n);
      else delete root.dataset.sheet;
    };
  }, [wide]);
  useEffect(() => {
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus(); // a field with autoFocus keeps it
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label={label ?? (typeof title === "string" ? title : undefined)}
      className={
        wide
          ? "fixed inset-y-0 end-0 z-40 flex w-[26rem] max-w-full flex-col border-s border-line bg-paper shadow-lg outline-none"
          : "fixed inset-x-0 bottom-0 z-40 flex max-h-[88dvh] flex-col rounded-t-2xl border-t border-line bg-paper shadow-2xl outline-none"
      }
    >
      {accent && <span aria-hidden data-sheet-accent className={`h-1.5 shrink-0 ${wide ? "" : "rounded-t-2xl"}`} style={{ backgroundColor: accent }} />}
      {!wide && <span aria-hidden className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" />}
      <header className="flex items-start gap-2 border-b border-line px-5 pb-3 pt-4">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel ? `חזרה ל${backLabel}` : "חזרה"}
            className="-ms-2 -mt-1 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-semibold text-ink-soft hover:bg-line/50"
          >
            <span aria-hidden>→</span> חזרה
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-bold leading-tight">{title}</h2>
          {subtitle && <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-soft">{subtitle}</div>}
        </div>
        <button type="button" onClick={onClose} aria-label="סגירה" className="-me-2 -mt-1 ms-auto inline-flex size-11 shrink-0 items-center justify-center rounded-md text-xl leading-none hover:bg-line/50">
          ×
        </button>
      </header>
      <div className="min-h-0 flex-1 divide-y divide-line/70 overflow-y-auto px-5 [&>*]:py-4">{children}</div>
    </div>
  );
}

/**
 * A part of a panel: its heading, a muted count right after it, and on its other end a small
 * aside (an action: «עריכה»). Parts are ruled apart by the Sheet. `label` names the region when
 * the heading is not the right name for a screen reader.
 */
export function Section({ title, count, aside, label, children }: { title: string; count?: ReactNode; aside?: ReactNode; label?: string; children: ReactNode }) {
  return (
    <section aria-label={label ?? title}>
      <div className="mb-2.5 flex min-h-8 items-center gap-2">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {count != null && count !== false && <span className="text-sm tabular-nums text-ink-faint">{count}</span>}
        {aside && <div className="ms-auto flex items-center gap-1 text-sm text-ink-soft">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** A small fact beside a panel's title: the day and hour, the room, a parallel lesson's reason. */
const META_TONE = { plain: "bg-line/50 text-ink-soft", warn: "bg-amber-100 text-amber-900", bad: "bg-bad/10 text-bad" };

export function Meta({ children, tone = "plain" }: { children: ReactNode; tone?: keyof typeof META_TONE }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${META_TONE[tone]}`}>{children}</span>;
}

/** The warnings of a lesson or a day, as one quiet list (amber: worth a look; blue: to know). */
export function WarningList({ items }: { items: { key: string; severity: "info" | "warn"; message: string }[] }) {
  return (
    <ul className="space-y-1.5" aria-label="אזהרות">
      {items.map((w) => (
        <li key={w.key} className={`flex gap-2 rounded-lg border-s-4 px-3 py-2 text-sm leading-snug ${w.severity === "warn" ? "border-amber-400 bg-amber-50 text-amber-950" : "border-sky-400 bg-sky-50 text-sky-950"}`}>
          <span aria-hidden>{w.severity === "warn" ? "⚠" : "ℹ"}</span>
          <span>{w.message}</span>
        </li>
      ))}
    </ul>
  );
}


/** The lesson row a lesson starts in (its shape menu acts on that row). */
export function rowOf(model: GridModel, l: Pick<Lesson, "day" | "start_min">): GridRow | undefined {
  return model.week.rows.find((r) => r.kind === "lesson" && r.start_min <= l.start_min && l.start_min < r.end_min);
}

// ------------------------------------------------------------------ lesson

export interface LessonPanelProps {
  model: GridModel;
  lesson: Lesson;
  me: number;
  isAdmin: boolean;
  /** A global admin: approves a speaker who agreed, on the card. */
  global: boolean;
  canEdit: boolean;
  actions: PanelActions;
  onClose: () => void;
  wide: boolean;
  /** A closed lesson's stages (src/screens/stages/LessonStages.tsx); without it, a read-only summary. */
  stages?: (l: Lesson) => ReactNode;
  /** A draft's files from the speaker who left (src/screens/stages/SourceFiles.tsx), for removal. */
  files?: (l: Lesson) => ReactNode;
}

export function LessonPanel(props: LessonPanelProps) {
  const { model, lesson: l, actions, canEdit } = props;
  const room = model.week.rooms.find((r) => r.id === l.room_id);
  const row = rowOf(model, l);
  const pitches = model.pitchesByLesson.get(l.id) ?? [];
  const live = pitches.filter((p) => LIVE_PITCH.has(p.state));
  const declined = pitches.filter((p) => p.state === "declined");
  const recruiting = l.state === "draft" && l.kind === "lesson";
  // a draft with no live pitch — shaped and never proposed for, or every speaker in it declined — is still a free
  // cell: it reads, and works, as one (who declined here waits in «סירבו כאן»)
  const free = recruiting && live.length === 0;
  const name = l.kind === "memorial" ? "זמן זיכרון" : l.state === "closed" ? "שיעור סגור" : free ? "משבצת פנויה" : "משבצת בתהליך";
  const lead = l.state === "closed" ? model.leadOf.get(l.id) : undefined;
  const owner = lead ? model.approachBySpeaker.get(lead.id)?.owner_member_id : undefined;
  const topic = l.kind === "lesson" && l.category_id != null ? model.categoryById.get(l.category_id) : undefined;
  const merged = l.kind === "lesson" && row != null && cellOf(model, l.day, row).merged;
  const { need, deficit } = model.days[l.day].balance;
  const warnings = model.warnings.filter((w) => w.lessonIds.includes(l.id));
  const propose = (id: number, mode: "self" | "offer") => actions.propose(id, { lesson_id: l.id }, mode);
  // A first proposal swaps the chooser for the candidates, a «סירב/ה» swaps them back: the focus that fell with the
  // part it was in goes to the new candidate, or to the chooser's search.
  const shaped = useRef(free);
  useEffect(() => {
    if (shaped.current === free) return;
    shaped.current = free;
    if (document.activeElement !== document.body) return;
    document.querySelector<HTMLElement>(free ? '[role="dialog"] input[type="search"]' : '[role="dialog"] [data-pitch-id] button')?.focus();
  }, [free]);

  return (
    <Sheet
      wide={props.wide}
      title={lead ? <SpeakerTitle speaker={lead} onOpen={() => actions.openSpeaker(lead.id)} /> : name}
      label={name}
      accent={l.kind === "memorial" ? "#fcd34d" : topic?.color}
      onClose={props.onClose}
      subtitle={
        <>
          <Meta>
            {DAY_NAMES[l.day]} · <bdi dir="ltr">{fmtRange(l.start_min, l.end_min)}</bdi>
          </Meta>
          {recruiting && row?.label && <Meta>{row.label}</Meta>}
          {room && <Meta>{room.name}</Meta>}
          {l.kind === "lesson" && (l.state === "closed" || topic) && <TopicPill category={topic} />}
          {owner != null && <Meta>בטיפול: {model.memberName.get(owner)}</Meta>}
          {l.parallel_reason && <Meta>∥ {l.parallel_reason}</Meta>}
          {merged && <Meta>מאוחדת</Meta>}
          {recruiting && need && <Meta tone="warn">{needText(need, deficit)}</Meta>}
        </>
      }
    >
      {warnings.length > 0 && <WarningList items={warnings} />}

      {recruiting &&
        (free && canEdit ? (
          <>
            <ProposeSection model={model} me={props.me} day={l.day} start={l.start_min} end={l.end_min} onPick={propose} />
            {declined.length > 0 && <Declined {...props} pitches={declined} />}
          </>
        ) : (
          <Section title="מועמדים" count={live.length || undefined}>
            <DayTopics model={model} day={l.day} />
            <Candidates {...props} pitches={live} />
            {declined.length > 0 && <Declined {...props} pitches={declined} small />}
            {canEdit && <AddSpeaker key={l.id} model={model} me={props.me} lesson={l} onPick={propose} />}
          </Section>
        ))}

      {l.state === "closed" && <ClosedDetails {...props} />}

      {l.state === "draft" && props.files?.(l)}

      {canEdit && row && recruiting && <ShapeFold model={model} day={l.day} row={row} closed={false} onReshape={(op) => actions.reshape(l.day, row.start_min, op)} />}
    </Sheet>
  );
}

/** A closed lesson's heading: its speaker, who opens their sheet (the dialog keeps the name «שיעור סגור»). */
function SpeakerTitle({ speaker: s, onOpen }: { speaker: Speaker; onOpen: () => void }) {
  return (
    <span className="flex items-center gap-2">
      <GenderDot gender={s.gender} />
      <button type="button" onClick={onOpen} className="-my-2.5 inline-flex min-h-11 min-w-0 items-center text-start hover:underline hover:underline-offset-4">
        {displayName(s)}
      </button>
    </span>
  );
}

/** The lesson's topic beside its title: a dot and the name on a wash of the topic's colour — the card's stripe. */
function TopicPill({ category: c }: { category: Category | undefined }) {
  if (!c)
    return (
      <Meta>
        <span className="text-ink-faint">נושא: TBD</span>
      </Meta>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium text-ink" style={{ backgroundColor: `color-mix(in srgb, ${c.color} 12%, transparent)` }}>
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
      <span className="sr-only">נושא: </span>
      {c.name}
    </span>
  );
}

/** The day's limit per topic, and how to name it: «הצעה» until the instructor sets it (src/rules/warnings.ts). */
function topicLimit(model: GridModel): { max: number; rule: string } {
  const set = model.week.edition.settings.max_category_per_day;
  const max = set ?? DEFAULT_MAX_CATEGORY_PER_DAY;
  return { max, rule: set == null ? `הצעה: עד ${max}` : `עד ${max}` };
}

/** What the day already holds, topic by topic — the day header's colour bar in words, where a speaker is chosen. */
function DayTopics({ model, day }: { model: GridModel; day: Day }) {
  const { max, rule } = topicLimit(model);
  const topics = [...model.days[day].load]
    .flatMap(([id, k]) => {
      const c = model.categoryById.get(id);
      return c ? [{ c, k }] : [];
    })
    .sort((a, b) => a.c.sort - b.c.sort);
  if (topics.length === 0) return null;
  return (
    <p className="mb-2.5 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-soft">
      <span>כבר ביום:</span>
      {topics.map(({ c, k }) => (
        <Meta key={c.id} tone={k > max ? "warn" : "plain"}>
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
          {c.name} · {k}
          {k > max && ` (${rule})`}
        </Meta>
      ))}
    </p>
  );
}

/** «הצעת מרצה» of a free cell — or of a shaped draft nobody was proposed for: the day's topics, then the chooser. */
function ProposeSection({ model, me, day, start, end, onPick }: { model: GridModel; me: number; day: Day; start: number; end: number; onPick: (speakerId: number, mode: "self" | "offer") => void }) {
  return (
    <Section title="הצעת מרצה">
      <DayTopics model={model} day={day} />
      <SpeakerChooser model={model} me={me} day={day} start={start} end={end} need={model.days[day].balance.need} onPick={onPick} />
    </Section>
  );
}

/** A draft's «הצעת מרצה»: one button opens the chooser right under it, and closes it again. */
function AddSpeaker({ model, me, lesson: l, onPick }: { model: GridModel; me: number; lesson: Lesson; onPick: (speakerId: number, mode: "self" | "offer") => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 space-y-2">
      <Button aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        {open ? (
          <>
            הצעת מרצה <span aria-hidden>▴</span>
          </>
        ) : (
          "+ הצעת מרצה"
        )}
      </Button>
      {open && <SpeakerChooser model={model} me={me} day={l.day} start={l.start_min} end={l.end_min} need={model.days[l.day].balance.need} onPick={onPick} />}
    </div>
  );
}

type CardProps = Pick<LessonPanelProps, "model" | "me" | "isAdmin" | "global" | "canEdit" | "actions">;

function Candidates({ pitches, ...props }: CardProps & { pitches: Pitch[] }) {
  if (pitches.length === 0) return <p className="text-sm text-ink-soft">עוד אין מרצה מוצע/ת למשבצת הזו.</p>;
  return (
    <ul className="space-y-2">
      {pitches.map((p) => (
        <CandidateCard key={p.id} {...props} pitch={p} />
      ))}
    </ul>
  );
}

/** Who declined this cell (folded): a free draft's chooser comes first, and «החזרה לתהליך» is here. */
function Declined({ pitches, small, ...props }: CardProps & { pitches: Pitch[]; small?: boolean }) {
  return (
    <Fold size={small ? "sm" : "md"} title="סירבו כאן" hint={pitches.length} className={small ? "mt-3" : undefined}>
      <Candidates {...props} pitches={pitches} />
    </Fold>
  );
}

/** A status chip's tone: agreed, talked and waiting, no answer, before the call, declined. */
const STATUS_TONE: Record<ApproachStatus, "ok" | "info" | "warn" | "plain" | "bad"> = { positive: "ok", approached: "info", no_answer: "warn", claimed: "plain", declined: "bad" };

/**
 * One speaker pitched for the cell, by where the call stands (v14: the approach's status — a pitch is a candidate until
 * the lesson closes). Before the call, no answer, talked and waiting: the points to say, folded, and the call's results.
 * Agreed: closing once the instructor approved — before that, the instructor's «אישור» right here. Declined: back to the process.
 */
function CandidateCard({ model, pitch: p, me, isAdmin, global, canEdit, actions }: CardProps & { pitch: Pitch }) {
  const s = pitchSpeaker(model, p);
  const a = model.approachById.get(p.approach_id);
  const g = s?.gender ?? null;
  const live = LIVE_PITCH.has(p.state);
  // a pitch declined on its own (before v14, the per-pitch «סירב/ה») reads as declined whatever the approach says
  const status: ApproachStatus = p.state === "declined" ? "declined" : (a?.status ?? "claimed");
  const mine = isAdmin || a?.owner_member_id === me;
  const owner = a?.owner_member_id != null ? model.memberName.get(a.owner_member_id) : undefined;
  const proposer = p.proposed_by != null && p.proposed_by !== a?.owner_member_id ? model.memberName.get(p.proposed_by) : undefined;
  const calling = live && (status === "claimed" || status === "no_answer" || status === "approached");
  const agreed = live && status === "positive";
  const elsewhere = model.week.pitches
    .filter((q) => q.approach_id === p.approach_id && q.id !== p.id && LIVE_PITCH.has(q.state))
    .flatMap((q) => model.week.lessons.filter((x) => x.id === q.lesson_id && x.state === "draft"))
    .sort((x, y) => x.day - y.day || x.start_min - y.start_min);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async <T,>(key: string, fn: () => Promise<T>) => {
    setBusy(key);
    const done = await fn();
    setBusy(null);
    return done;
  };
  // a result swaps the card's buttons under the hand that pressed one: the focus goes to the card's next control
  const card = useRef<HTMLLIElement>(null);
  const shape = `${status}:${s?.vetted}`;
  const seen = useRef(shape);
  useEffect(() => {
    if (seen.current === shape) return;
    seen.current = shape;
    if (document.activeElement === document.body) card.current?.querySelector<HTMLElement>("[data-card-actions] button")?.focus();
  }, [shape]);

  return (
    <li ref={card} className="rounded-xl border border-line bg-card px-3 py-2.5" data-pitch-id={p.id} data-status={status}>
      <div className="flex items-center gap-2">
        <GenderDot gender={g} />
        {s ? (
          <button
            type="button"
            onClick={() => actions.openSpeaker(s.id)}
            className={`inline-flex min-h-11 min-w-0 items-center truncate text-start text-[15px] font-semibold hover:underline hover:underline-offset-4 lg:min-h-9 ${p.state === "declined" ? "line-through opacity-60" : ""}`}
          >
            {displayName(s)}
          </button>
        ) : (
          <span className="font-semibold">?</span>
        )}
        <span className="ms-auto shrink-0">
          <Chip tone={STATUS_TONE[status]}>{statusLabel(status, g)}</Chip>
        </span>
      </div>
      <p className="ms-4 flex flex-wrap items-center gap-x-1 text-[13px] text-ink-soft">
        {s && s.vetted !== "approved" && (
          <Chip tone={s.vetted === "rejected" ? "bad" : "warn"}>{s.vetted === "pending" ? `${byGender(g, "ממתין", "ממתינה")} לאישור המדריך/ה` : vettingLabel(s.vetted, g)}</Chip>
        )}
        <span>
          {owner ? `בטיפול: ${owner}` : "ללא אחראי/ת"}
          {proposer && ` · הוצע ע״י ${proposer}`}
        </span>
      </p>
      {elsewhere.length > 0 && (
        <p className="ms-4 text-[13px] text-ink-soft">
          {byGender(g, "מוצע", "מוצעת")} גם ב:{" "}
          {elsewhere.map((x, i) => (
            <Fragment key={x.id}>
              {i > 0 && ", "}
              {DAY_NAMES[x.day]} <bdi dir="ltr">{fmt(x.start_min)}</bdi>
            </Fragment>
          ))}
        </p>
      )}
      {canEdit && a && s && (mine || (live && p.proposed_by === me)) && (
        <div data-card-actions className="mt-2 space-y-2">
          {mine && calling && (
            <>
              <Fold size="sm" title="📞 נקודות לשיחה">
                <CallPoints week={model.week} speakerGender={g} memberId={me} />
              </Fold>
              <CallResults status={status} gender={g} busy={busy === "call"} onResult={(st, note) => act("call", () => actions.callResult(a, st, note))} />
            </>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {mine && agreed && s.vetted === "approved" && (
              <Button kind="primary" disabled={g == null} busy={busy === "close"} onClick={() => void act("close", () => actions.close(p.id))}>
                {byGender(g, "המרצה אישר", "המרצה אישרה", "המרצה אישר/ה")} את השעה — סגירה
              </Button>
            )}
            {mine && agreed && s.vetted === "pending" && global && (
              <Button kind="primary" busy={busy === "vet"} onClick={() => void act("vet", () => actions.approveSpeaker(s.id))}>
                אישור
              </Button>
            )}
            {mine && p.state === "declined" && (
              <Button kind="quiet" onClick={() => actions.revive(p.id)}>
                החזרה לתהליך
              </Button>
            )}
            {mine && live && a.status === "declined" && (
              <Button kind="quiet" busy={busy === "revive"} onClick={() => void act("revive", () => actions.callResult(a, "claimed", null))}>
                החזרה לתהליך
              </Button>
            )}
            {live && (
              <Button kind="quiet" className="ms-auto" onClick={() => actions.unpropose(p.id)}>
                הסרה מהמשבצת
              </Button>
            )}
          </div>
          {mine && agreed && s.vetted === "approved" && g == null && <p className="text-[13px] text-bad">{errorMessage("gender_unknown")}</p>}
          {mine && agreed && s.vetted !== "approved" && !(global && s.vetted === "pending") && <p className="text-[13px] text-ink-soft">{errorMessage("not_vetted")}</p>}
        </div>
      )}
    </li>
  );
}

function ClosedDetails({ model, lesson: l, me, isAdmin, canEdit, actions, stages }: LessonPanelProps) {
  const lead = model.leadOf.get(l.id);
  const [title, setTitle] = useState(l.title ?? "");
  const [category, setCategory] = useState(l.category_id ?? 0);
  const [audience, setAudience] = useState(l.audience ?? "");
  const [teach, setTeach] = useState(l.teach_min ?? 0);
  // read first; «עריכה» opens the form, a saved version closes it
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setTitle(l.title ?? "");
    setCategory(l.category_id ?? 0);
    setAudience(l.audience ?? "");
    setTeach(l.teach_min ?? 0);
    setEditing(false);
  }, [l.id, l.version, l.title, l.category_id, l.audience, l.teach_min]);
  const owner = lead ? model.approachBySpeaker.get(lead.id)?.owner_member_id : undefined;
  const mine = isAdmin || owner === me;
  const row = l.kind === "lesson" ? rowOf(model, l) : undefined;
  const lessonMinutes = model.week.edition.settings.lesson_minutes ?? 75;
  const dirty = title !== (l.title ?? "") || category !== (l.category_id ?? 0) || audience !== (l.audience ?? "") || teach !== (l.teach_min ?? 0);
  const save = () =>
    actions.update(l.id, l.version, {
      title: title.trim() || null,
      category_id: category || null,
      audience: audience.trim() || null,
      teach_min: teach || null,
    });

  return (
    <>
      <Section
        title="פרטי השיעור"
        aside={
          canEdit &&
          !editing && (
            <Button kind="quiet" onClick={() => setEditing(true)}>
              עריכה
            </Button>
          )
        }
      >
        {editing ? (
          <div className="space-y-3">
            <label className="block text-sm font-medium">
              כותרת
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="TBD" className={`${INPUT} mt-1`} autoFocus />
            </label>
            <label className="block text-sm font-medium">
              נושא
              <select value={category} onChange={(e) => setCategory(Number(e.target.value))} className={`${INPUT} mt-1`}>
                <option value={0}>— לא נבחר —</option>
                {model.week.categories.filter((c) => c.active || c.id === l.category_id).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <label className="block min-w-0 flex-1 text-sm font-medium">
                קהל מיוחד
                <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="למשל: שיעור להורים" className={`${INPUT} mt-1`} />
              </label>
              <label className="block w-28 text-sm font-medium">
                דקות הוראה
                <input
                  type="number"
                  min={15}
                  step={5}
                  max={l.end_min - l.start_min}
                  value={teach || ""}
                  placeholder={String(Math.min(lessonMinutes, l.end_min - l.start_min))}
                  onChange={(e) => setTeach(Number(e.target.value))}
                  className={`${INPUT} mt-1 tabular-nums`}
                />
              </label>
            </div>
            <div className="flex gap-1.5">
              <Button kind="primary" disabled={!dirty} onClick={save}>
                שמירה
              </Button>
              <Button kind="quiet" onClick={() => setEditing(false)}>
                ביטול
              </Button>
            </div>
          </div>
        ) : (
          // the topic is the header's pill (LessonPanel)
          <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-ink-soft">כותרת</dt>
            <dd className="font-medium">{l.title ?? <span className="text-ink-faint">TBD</span>}</dd>
            {l.audience && (
              <>
                <dt className="text-ink-soft">קהל מיוחד</dt>
                <dd>{l.audience}</dd>
              </>
            )}
            <dt className="text-ink-soft">דקות הוראה</dt>
            <dd className="tabular-nums">
              {l.teach_min ?? (
                <>
                  {Math.min(lessonMinutes, l.end_min - l.start_min)} <span className="text-ink-faint">(ברירת המחדל)</span>
                </>
              )}
            </dd>
          </dl>
        )}
      </Section>

      {stages ? (
        stages(l)
      ) : (
        <Section title="שלבים">
          <ul className="space-y-1 text-sm">
            {stagesOf(l, readerFilesOf(model.week, l.id)).map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <span className={`size-2.5 rounded-full border ${STAGE_DOT[s.state]}`} />
                <span className="font-semibold">{s.label}</span>
                <span className="text-ink-soft">{s.note}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* the occasional acts, one of them destructive: one quiet fold at the end, closed */}
      {canEdit && (row || mine) && (
        <Fold title="פעולות נוספות" hint={[mine && "פתיחה מחדש", row && "מבנה המשבצת"].filter(Boolean).join(" · ")}>
          {row && (
            <>
              <p className="mb-2 text-sm font-semibold text-ink-soft">מבנה המשבצת</p>
              <ShapeMenu model={model} day={l.day} row={row} closed onReshape={(op) => actions.reshape(l.day, row.start_min, op)} />
            </>
          )}
          {mine && (
            <div className={row ? "mt-4 border-t border-line/70 pt-3" : undefined}>
              <Reopen lesson={l} isAdmin={isAdmin} files={(model.week.sourceFiles ?? []).filter((f) => f.lesson_id === l.id).length} onReopen={() => actions.reopen(l.id)} />
            </div>
          )}
        </Fold>
      )}
    </>
  );
}

/**
 * «פתיחה מחדש»: the lesson goes back to a draft, and its stages — the speaker's — start over
 * (CONTRACT reopen_lesson). When any stage holds something, it says what goes before doing it.
 * Paid money is never erased (paid_locked); an approved request is the instructor's to reopen.
 */
function Reopen({ lesson: l, isAdmin, files, onReopen }: { lesson: Lesson; isAdmin: boolean; files: number; onReopen: () => void }) {
  const [asking, setAsking] = useState(false);
  // «ביטול» takes the confirm (and its focus) away: «פתיחה מחדש» takes it back
  const focusBack = useFocusBack();
  const loses = reopenLoses(l);
  if (l.paid_at) {
    return <p className="text-sm text-ink-soft">שולם — כדי לפתוח מחדש, קודם מבטלים «שולם» בשלב התשלום.</p>;
  }
  if (l.approval === "approved" && !isAdmin) {
    return <p className="text-sm text-ink-soft">הבקשה אושרה — רק המדריך/ה פותח/ת מחדש.</p>;
  }
  if (asking) {
    return (
      <Confirm
        text={
          <>
            השיעור יחזור לטיוטה, ויימחקו: {loses.join(" · ")}.
            {files > 0 && (
              <>
                {" "}
                {files === 1 ? "הקובץ שהועלה נשאר בלוח השיעור, מסומן" : `${files} הקבצים שהועלו נשארים בלוח השיעור, מסומנים`} «מהמרצה הקודם».
              </>
            )}
          </>
        }
        confirm="פתיחה מחדש ומחיקה"
        onConfirm={() => {
          setAsking(false);
          onReopen();
        }}
        onCancel={() => {
          setAsking(false);
          focusBack.back();
        }}
      />
    );
  }
  return (
    <Button kind="danger" ref={focusBack.ref()} onClick={() => (loses.length > 0 ? setAsking(true) : onReopen())}>
      פתיחה מחדש (חזרה לטיוטה)
    </Button>
  );
}

// ------------------------------------------------------------------ empty cell

export function CellPanel({ model, me, day, row, canEdit, actions, onClose, wide }: { model: GridModel; me: number; day: Day; row: GridRow; canEdit: boolean; actions: PanelActions; onClose: () => void; wide: boolean }) {
  const { need, deficit } = model.days[day].balance;
  return (
    <Sheet
      wide={wide}
      title="משבצת פנויה"
      onClose={onClose}
      subtitle={
        <>
          <Meta>
            {DAY_NAMES[day]} · <bdi dir="ltr">{fmtRange(row.start_min, row.end_min)}</bdi>
          </Meta>
          {row.label && <Meta>{row.label}</Meta>}
          {need && <Meta tone="warn">{needText(need, deficit)}</Meta>}
        </>
      }
    >
      {canEdit ? (
        <>
          <ProposeSection model={model} me={me} day={day} start={row.start_min} end={row.end_min} onPick={(id, mode) => actions.propose(id, { day, start_min: row.start_min, end_min: row.end_min, room_id: null }, mode)} />
          <ShapeFold model={model} day={day} row={row} closed={false} onReshape={(op) => actions.reshape(day, row.start_min, op)} />
        </>
      ) : (
        <p className="text-sm text-ink-soft">צפייה בלבד.</p>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ choosing a speaker

const FIT_RANK: Record<Fit, number> = { can: 0, neutral: 1, cannot: 2, busy: 3 };
const SECTION_RANK = { mine: 0, free: 1, others: 2, closed: 3, declined: 4 } as const;
/** The chooser's groups, in rank order: a speaker closed this year or who declined is not offered. */
const CHOOSER_GROUPS: readonly PoolSection[] = ["mine", "free", "others"];
/** A group shows this many rows until «עוד N». */
const GROUP_PEEK = 6;
/** A search shows at most this many matches; a narrower one finds the rest. */
const SEARCH_CAP = 30;

interface ChooserItem {
  s: Speaker;
  section: PoolSection;
  fit: Fit;
}

export function SpeakerChooser({ model, me, day, start, end, need, onPick }: { model: GridModel; me: number; day: Day; start: number; end: number; need?: Gender | null; onPick: (speakerId: number, mode: "self" | "offer") => void }) {
  const [query, setQuery] = useState("");
  const searching = searchKey(query) !== "";
  const ranked = useMemo(() => {
    return model.week.speakers
      .filter((s) => !s.retired && speakerMatches(s, query))
      .map((s): ChooserItem => ({ s, section: poolSection(model, s.id, me), fit: fitFor(model, s.id, day, start, end) }))
      .filter((x) => x.section !== "closed" && x.section !== "declined" && x.fit !== "busy")
      .sort(
        (a, b) =>
          SECTION_RANK[a.section] - SECTION_RANK[b.section] ||
          Number(!!need && b.s.gender === need) - Number(!!need && a.s.gender === need) ||
          FIT_RANK[a.fit] - FIT_RANK[b.fit] ||
          a.s.name.localeCompare(b.s.name, "he"),
      );
  }, [model, me, day, start, end, need, query]);
  const shown = searching ? ranked.slice(0, SEARCH_CAP) : ranked;
  // a proposal moves its speaker to another group (a new row): the focus follows them, or stays in the chooser
  const root = useRef<HTMLDivElement>(null);
  const picked = useRef<number | null>(null);
  const pick = (id: number, mode: "self" | "offer") => {
    picked.current = id;
    onPick(id, mode);
  };
  useEffect(() => {
    const id = picked.current;
    if (id == null) return;
    picked.current = null;
    (root.current?.querySelector<HTMLElement>(`[data-chooser-speaker="${id}"] button`) ?? root.current?.querySelector<HTMLElement>("input"))?.focus();
  }, [ranked]);

  return (
    <div ref={root} className="space-y-2">
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש מרצה, נושא או מוסד" aria-label="חיפוש מרצה למשבצת" className={INPUT} />
      {CHOOSER_GROUPS.map((g) => {
        const items = shown.filter((x) => x.section === g);
        return items.length > 0 && <ChooserGroup key={g} model={model} day={day} section={g} items={items} flat={searching} onPick={pick} />;
      })}
      {shown.length === 0 && <p className="p-2 text-center text-sm text-ink-faint">אין התאמות. מרצה שלא במאגר מוסיפים ב«+ מרצה חדש/ה».</p>}
      {shown.length < ranked.length && <p className="text-center text-xs text-ink-faint">מוצגים {SEARCH_CAP} — מדייקים את החיפוש כדי לצמצם.</p>}
    </div>
  );
}

/**
 * One group of the chooser under its label and count, said once instead of on every row: «שלי» and «פנויים» open, six
 * rows and «עוד N»; «בטיפול אחרים» — offering to a teammate, the occasional case — folded. A search shows them all.
 */
function ChooserGroup({ model, day, section, items, flat, onPick }: { model: GridModel; day: Day; section: PoolSection; items: ChooserItem[]; flat: boolean; onPick: (id: number, mode: "self" | "offer") => void }) {
  const [more, setMore] = useState(false);
  const label = POOL_SECTION_LABEL[section];
  const cut = !flat && items.length > GROUP_PEEK;
  const limit = topicLimit(model);
  const list = (
    <>
      <ul aria-label={label} className="divide-y divide-line/70">
        {(cut && !more ? items.slice(0, GROUP_PEEK) : items).map(({ s, fit }) => (
          <ChooserRow key={s.id} model={model} speaker={s} others={section === "others"} fit={fit} load={model.days[day].load} limit={limit} onPick={onPick} />
        ))}
      </ul>
      {cut && (
        <Button kind="quiet" className="text-sm" aria-expanded={more} onClick={() => setMore((x) => !x)}>
          {more ? "פחות" : `עוד ${items.length - GROUP_PEEK}`}
        </Button>
      )}
    </>
  );
  if (section === "others" && !flat) {
    return (
      <Fold size="sm" title={label} hint={items.length}>
        {list}
      </Fold>
    );
  }
  return (
    <div>
      <h4 className="flex items-baseline gap-1.5 text-xs font-semibold text-ink-soft">
        {label} <span className="font-normal tabular-nums text-ink-faint">{items.length}</span>
      </h4>
      {list}
    </div>
  );
}

/**
 * A speaker to propose, striped and marked with their first topic's colour (the grid's, when it names a topic) and how
 * many of it the day already closed — amber, with the limit, once one more would pass it.
 */
function ChooserRow({
  model,
  speaker: s,
  others,
  fit,
  load,
  limit,
  onPick,
}: {
  model: GridModel;
  speaker: Speaker;
  others: boolean;
  fit: Fit;
  load: Map<number, number>;
  limit: { max: number; rule: string };
  onPick: (id: number, mode: "self" | "offer") => void;
}) {
  const owner = model.memberName.get(model.approachBySpeaker.get(s.id)?.owner_member_id ?? -1);
  const guess = guessedCategory(model, s);
  const topic = guess != null ? model.categoryById.get(guess) : undefined;
  const shown = topic?.active ? topic : undefined;
  const already = shown ? (load.get(shown.id) ?? 0) : 0;
  const full = already >= limit.max;
  // what decides first (can they, are they approved), then the topic and how much of it the day holds
  const notes: ReactNode[] = [];
  if (fit === "cannot") notes.push(`${byGender(s.gender, "אמר", "אמרה")} שלא ${byGender(s.gender, "יכול", "יכולה")}`);
  if (fit === "can") notes.push("זמין/ה");
  if (s.vetted !== "approved") notes.push(<span className={s.vetted === "rejected" ? "text-bad" : "text-amber-800"}>{vettingLabel(s.vetted, s.gender)}</span>);
  if (others) notes.push(`בטיפול: ${owner ?? "?"}`);
  if (shown)
    notes.push(
      <span className="font-medium">
        <span aria-hidden style={{ color: shown.color }}>
          ●{" "}
        </span>
        {shown.name}
      </span>,
    );
  if (already > 0) notes.push(<span className={full ? "font-semibold text-amber-800" : undefined}>{full ? `⚠ כבר ${already} היום (${limit.rule})` : `כבר ${already} היום`}</span>);
  return (
    <li data-chooser-speaker={s.id} className="flex items-center gap-2 border-s-[3px] py-1.5 ps-2" style={{ borderInlineStartColor: shown?.color ?? "transparent" }}>
      <GenderDot gender={s.gender} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{displayName(s)}</span>
        {notes.length > 0 && (
          <span className="block text-[11px] leading-snug text-ink-soft">
            {notes.map((n, i) => (
              <Fragment key={i}>
                {i > 0 && " · "}
                {n}
              </Fragment>
            ))}
          </span>
        )}
      </span>
      <Button className="shrink-0 text-sm" onClick={() => onPick(s.id, others ? "offer" : "self")}>
        {others ? "הצע ל" + (owner ?? "אחראי/ת") : "הצע"}
      </Button>
    </li>
  );
}

// ------------------------------------------------------------------ reshaping

/** The shape menu, folded: an occasional act (merge, split) that should not crowd the panel's everyday one. */
function ShapeFold(props: Parameters<typeof ShapeMenu>[0]) {
  return (
    <Fold title="מבנה המשבצת" hint="איחוד · פיצול">
      <ShapeMenu {...props} />
    </Fold>
  );
}

/** The cell a reshape acts on, and the day's lesson rows (CONTRACT `reshape`, v13). */
function cellOf(model: GridModel, day: Day, row: GridRow) {
  const rows = model.week.rows.filter((r) => r.kind === "lesson" && rowActive(r, day, model.week.edition));
  const lessons = model.week.lessons.filter((l) => l.day === day && l.state !== "cancelled");
  const span = cellSpan(row, lessons);
  return {
    rows,
    span,
    merged: span.start !== row.start_min || span.end !== row.end_min,
    // anything on the row: «החזרה למבנה הבסיס» has something to undo (on a free row it is a no-op)
    held: lessons.some((l) => overlaps(l.start_min, l.end_min, row.start_min, row.end_min)),
    stuck: sticksOut(span, lessons),
  };
}

/**
 * The one-click acts on top; each split — one is chosen at a time, and seldom — folded under them.
 */
export function ShapeMenu({ model, day, row, closed, onReshape }: { model: GridModel; day: Day; row: GridRow; closed: boolean; onReshape: (op: ReshapeOp) => void }) {
  const [reason, setReason] = useState("");
  const { rows, span, merged, held, stuck } = cellOf(model, day, row);
  return (
    <div className="space-y-2 text-sm">
      {merged && <p className="text-xs text-ink-soft">משבצת מאוחדת — הפיצול חל על כולה.</p>}
      <div className="flex flex-wrap gap-1.5">
        <Button onClick={() => onReshape({ op: "merge_next" })}>איחוד עם המשבצת הבאה</Button>
        {!closed && held && <Button onClick={() => onReshape({ op: "reset" })}>החזרה למבנה הבסיס</Button>}
      </div>
      <Fold size="sm" title="פיצול למקבילים" hint="2 או 3, עם סיבה">
        <div className="flex flex-wrap gap-1.5">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למה במקביל? (חובה)" aria-label="סיבה לפיצול" className={`${INPUT} min-w-0 flex-1 basis-40`} />
          <Button disabled={!reason.trim()} onClick={() => onReshape({ op: "split_parallel", count: 2, reason })}>
            2 מקבילים
          </Button>
          <Button disabled={!reason.trim()} onClick={() => onReshape({ op: "split_parallel", count: 3, reason })}>
            3 מקבילים
          </Button>
        </div>
      </Fold>
      {!closed && (
        <Fold size="sm" title="פיצול בזמן" hint="בכל מספר דקות">
          {stuck ? (
            <p className="text-xs text-ink-soft">שיעור במקביל מתחיל או נגמר מחוץ למשבצת הזו — מזיזים אותו או מחזירים למבנה הבסיס קודם.</p>
          ) : (
            <TimeSplit key={`${span.start}:${span.end}`} rows={rows} span={span} onReshape={onReshape} />
          )}
        </Fold>
      )}
    </div>
  );
}

/** A part's minutes: a field of its own width (INPUT is a full-width block), so the parts line up like a small table. */
const MINUTES = `${INPUT.replace("block w-full ", "")} w-20 shrink-0 tabular-nums`;

/** split_time with any minutes: every part but the last is typed; the last is what is left of the cell. */
function TimeSplit({ rows, span, onReshape }: { rows: GridRow[]; span: Span; onReshape: (op: ReshapeOp) => void }) {
  const len = span.end - span.start;
  const [typed, setTyped] = useState<string[]>([String(Math.max(15, Math.round(len / 2 / 5) * 5))]);
  const head = typed.map((x) => Number(x));
  const parts = [...head, len - head.reduce((x, y) => x + y, 0)];
  const ok = timeSplitOk(rows, span, parts);
  let t = span.start;
  const ranges = parts.map((m) => [t, (t += m)] as const);
  return (
    <div>
      <ol className="space-y-1.5">
        {ranges.map(([a, b], i) => (
          <li key={i} className="flex flex-nowrap items-center gap-2">
            <span className="w-12 shrink-0 text-xs text-ink-soft">חלק {i + 1}</span>
            {i < typed.length ? (
              <input
                type="number"
                inputMode="numeric"
                min={15}
                step={5}
                value={typed[i]}
                onChange={(e) => setTyped((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                aria-label={`דקות בחלק ${i + 1}`}
                className={MINUTES}
              />
            ) : (
              <span className="w-20 shrink-0 px-3 tabular-nums" aria-label={`דקות בחלק ${i + 1}`}>
                {parts[i]}
              </span>
            )}
            <span className="min-w-0 truncate text-xs text-ink-soft">
              דק׳ · <bdi dir="ltr">{fmtRange(a, b)}</bdi>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button disabled={!ok} onClick={() => onReshape({ op: "split_time", parts })}>
          פיצול ל-{parts.length} חלקים
        </Button>
        {parts[parts.length - 1] >= 30 && (
          <Button kind="quiet" onClick={() => setTyped((xs) => [...xs, String(Math.max(15, Math.round(parts[parts.length - 1] / 2 / 5) * 5))])}>
            + חלק נוסף
          </Button>
        )}
        {typed.length > 1 && (
          <Button kind="quiet" onClick={() => setTyped((xs) => xs.slice(0, -1))}>
            הסרת חלק
          </Button>
        )}
      </div>
      {!ok && <p className="mt-1 text-xs text-bad">כל חלק: 15 דק׳ לפחות, בכפולות של 5, בתוך שעות השיעור.</p>}
    </div>
  );
}
