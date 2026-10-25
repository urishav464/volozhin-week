// The side panel (a bottom sheet on a phone): what a lesson or an empty cell
// offers — candidates and closing, the lesson's details, its stages after it
// closed (payment, the message, the escort, sources: src/screens/stages/,
// handed in by the week as `stages`), and reshaping the cell.
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { byGender, displayName } from "../domain/names";
import { DAY_NAMES, type Day, fmtRange } from "../domain/time";
import type { Gender, GridRow, Lesson, Pitch, Speaker } from "../domain/types";
import type { CellTarget, LessonPatch, ReshapeOp } from "../data/commands";
import { type Span, cellSpan, sticksOut, timeSplitOk } from "../domain/shape";
import { readerFilesOf, reopenLoses, stagesOf } from "../domain/stages";
import { Button, Confirm, INPUT, useFocusBack } from "../screens/settings/kit";
import { Chip, GenderDot, STAGE_DOT } from "./bits";
import { rowActive } from "./layout";
import { type Fit, type GridModel, fitFor, pitchSpeaker, poolSection, speakerMatches } from "./model";

export interface PanelActions {
  propose: (speakerId: number, target: CellTarget, mode?: "self" | "offer") => void;
  unpropose: (pitchId: number) => void;
  setPitch: (pitchId: number, state: "candidate" | "approached" | "declined") => void;
  close: (pitchId: number) => void;
  reopen: (lessonId: number) => void;
  update: (lessonId: number, version: number, patch: LessonPatch) => void;
  reshape: (day: Day, rowStart: number, op: ReshapeOp) => void;
  /** The speaker sheet (src/screens/speakers/SpeakerSheet.tsx). */
  openSpeaker: (speakerId: number) => void;
}

export function Sheet({
  title,
  subtitle,
  onClose,
  onBack,
  backLabel,
  children,
  wide,
}: {
  title: string;
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
      aria-label={title}
      className={
        wide
          ? "fixed inset-y-0 end-0 z-40 flex w-[26rem] max-w-full flex-col border-s border-line bg-paper shadow-lg outline-none"
          : "fixed inset-x-0 bottom-0 z-40 flex max-h-[88dvh] flex-col rounded-t-2xl border-t border-line bg-paper shadow-2xl outline-none"
      }
    >
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
        <div className="min-w-0">
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

/** A part of a panel: its heading, and on its other end a small aside (a count, «עריכה»). Parts are ruled apart by the Sheet. */
export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-2.5 flex min-h-8 items-center gap-2">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {aside && <div className="ms-auto flex items-center gap-1 text-sm text-ink-soft">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** A small fact beside a panel's title: the day and hour, the room, a parallel lesson's reason. */
export function Meta({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "warn" }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${tone === "warn" ? "bg-amber-100 text-amber-900" : "bg-line/50 text-ink-soft"}`}>{children}</span>;
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
  const [adding, setAdding] = useState(false);
  const room = model.week.rooms.find((r) => r.id === l.room_id);
  const row = rowOf(model, l);
  const title = l.kind === "memorial" ? "זמן זיכרון" : l.state === "closed" ? "שיעור סגור" : "משבצת בתהליך";
  const warnings = model.warnings.filter((w) => w.lessonIds.includes(l.id));

  return (
    <Sheet
      wide={props.wide}
      title={title}
      onClose={props.onClose}
      subtitle={
        <>
          <Meta>
            {DAY_NAMES[l.day]} · <bdi dir="ltr">{fmtRange(l.start_min, l.end_min)}</bdi>
          </Meta>
          {room && <Meta>{room.name}</Meta>}
          {l.parallel_reason && <Meta>∥ {l.parallel_reason}</Meta>}
        </>
      }
    >
      {warnings.length > 0 && <WarningList items={warnings} />}

      {l.state === "draft" && l.kind === "lesson" && (
        <Section title="מועמדים" aside={(model.pitchesByLesson.get(l.id) ?? []).length || undefined}>
          <Candidates {...props} />
          {canEdit &&
            (adding ? (
              <div className="mt-3 rounded-xl border border-line bg-card p-3">
                <SpeakerChooser model={model} me={props.me} day={l.day} start={l.start_min} end={l.end_min} onPick={(id, mode) => actions.propose(id, { lesson_id: l.id }, mode)} />
                <Button kind="quiet" className="mt-2" onClick={() => setAdding(false)}>
                  סגירת הרשימה
                </Button>
              </div>
            ) : (
              <Button className="mt-3" onClick={() => setAdding(true)}>
                + הצעת מרצה
              </Button>
            ))}
        </Section>
      )}

      {l.state === "closed" && <ClosedDetails {...props} />}

      {l.state === "draft" && props.files?.(l)}

      {canEdit && row && l.kind === "lesson" && <ShapeFold model={model} day={l.day} row={row} closed={l.state === "closed"} onReshape={(op) => actions.reshape(l.day, row.start_min, op)} />}
    </Sheet>
  );
}

function Candidates({ model, lesson: l, me, isAdmin, canEdit, actions }: { model: GridModel; lesson: Lesson; me: number; isAdmin: boolean; canEdit: boolean; actions: PanelActions }) {
  const pitches = model.pitchesByLesson.get(l.id) ?? [];
  if (pitches.length === 0) return <p className="text-sm text-ink-soft">עוד אין מרצה מוצע/ת למשבצת הזו.</p>;
  return (
    <ul className="space-y-2">
      {pitches.map((p: Pitch) => {
        const s = pitchSpeaker(model, p);
        const a = model.approachById.get(p.approach_id);
        const mine = isAdmin || a?.owner_member_id === me;
        const owner = a?.owner_member_id != null ? model.memberName.get(a.owner_member_id) : undefined;
        const proposer = p.proposed_by != null && p.proposed_by !== a?.owner_member_id ? model.memberName.get(p.proposed_by) : undefined;
        const live = p.state === "approached" || p.state === "candidate";
        return (
          <li key={p.id} className="rounded-xl border border-line bg-card px-3 py-2.5" data-pitch-id={p.id}>
            <div className="flex items-center gap-2">
              <GenderDot gender={s?.gender ?? null} />
              {s ? (
                <button
                  type="button"
                  onClick={() => actions.openSpeaker(s.id)}
                  className={`inline-flex min-h-9 min-w-0 items-center truncate text-start text-[15px] font-semibold hover:underline hover:underline-offset-4 ${p.state === "declined" ? "line-through opacity-60" : ""}`}
                >
                  {displayName(s)}
                </button>
              ) : (
                <span className="font-semibold">?</span>
              )}
              <span className="ms-auto shrink-0">
                <Chip tone={p.state === "approached" ? "info" : p.state === "declined" ? "bad" : "plain"}>
                  {p.state === "approached" ? "פנו" : p.state === "candidate" ? "מועמד/ת" : byGender(s?.gender, "סירב", "סירבה")}
                </Chip>
              </span>
            </div>
            <p className="ms-4 text-[13px] text-ink-soft">
              {owner ? `בטיפול: ${owner}` : "ללא אחראי/ת"}
              {proposer && ` · הוצע ע״י ${proposer}`}
              {s?.vetted !== "approved" && <span className="text-amber-800"> · ממתין/ה לאישור מדריך/ה</span>}
            </p>
            {canEdit && (mine || (live && p.proposed_by === me)) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {mine && live && (
                  <Button kind="primary" onClick={() => actions.close(p.id)}>
                    סגרנו
                  </Button>
                )}
                {mine && p.state === "candidate" && s?.vetted === "approved" && (
                  <Button onClick={() => actions.setPitch(p.id, "approached")}>
                    פנינו
                  </Button>
                )}
                {mine && live && (
                  <Button kind="quiet" onClick={() => actions.setPitch(p.id, "declined")}>
                    {byGender(s?.gender, "סירב", "סירבה")}
                  </Button>
                )}
                {mine && p.state === "declined" && (
                  <Button kind="quiet" onClick={() => actions.setPitch(p.id, "approached")}>
                    החזרה לתהליך
                  </Button>
                )}
                {live && (mine || p.proposed_by === me) && (
                  <Button kind="quiet" className="ms-auto" onClick={() => actions.unpropose(p.id)}>
                    הסרה מהמשבצת
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
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
      <Section title="מרצה">
        <p className="flex items-center gap-2">
          <GenderDot gender={lead?.gender ?? null} />
          {lead ? (
            <button type="button" onClick={() => actions.openSpeaker(lead.id)} className="inline-flex min-h-9 items-center text-start text-[17px] font-semibold hover:underline hover:underline-offset-4">
              {displayName(lead)}
            </button>
          ) : (
            <span className="font-semibold">—</span>
          )}
        </p>
        {owner != null && <p className="ms-4 text-[13px] text-ink-soft">בטיפול: {model.memberName.get(owner)}</p>}
      </Section>

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
              קטגוריה
              <select value={category} onChange={(e) => setCategory(Number(e.target.value))} className={`${INPUT} mt-1`}>
                <option value={0}>— לא נבחרה —</option>
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
          <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-ink-soft">כותרת</dt>
            <dd className="font-medium">{l.title ?? <span className="text-ink-faint">TBD</span>}</dd>
            <dt className="text-ink-soft">קטגוריה</dt>
            <dd>
              {(() => {
                const c = l.category_id != null ? model.categoryById.get(l.category_id) : undefined;
                return c ? (
                  <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: c.color }}>
                    <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                    {c.name}
                  </span>
                ) : (
                  <span className="text-ink-faint">TBD</span>
                );
              })()}
            </dd>
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

      {canEdit && mine && (
        <Reopen
          lesson={l}
          speakerGender={lead?.gender ?? null}
          isAdmin={isAdmin}
          files={(model.week.sourceFiles ?? []).filter((f) => f.lesson_id === l.id).length}
          onReopen={() => actions.reopen(l.id)}
        />
      )}
    </>
  );
}

/**
 * «פתיחה מחדש»: the lesson goes back to a draft, and its stages — the speaker's — start over
 * (CONTRACT reopen_lesson). When any stage holds something, it says what goes before doing it.
 * Paid money is never erased (paid_locked); an approved request is the instructor's to reopen.
 */
function Reopen({ lesson: l, speakerGender, isAdmin, files, onReopen }: { lesson: Lesson; speakerGender: Gender | null; isAdmin: boolean; files: number; onReopen: () => void }) {
  const [asking, setAsking] = useState(false);
  // «ביטול» takes the confirm (and its focus) away: «פתיחה מחדש» takes it back
  const focusBack = useFocusBack();
  const loses = reopenLoses(l);
  if (l.paid_at) {
    return <p className="text-sm text-ink-soft">התשלום סומן כשולם, ולכן אי אפשר לפתוח את השיעור מחדש. קודם מבטלים את הסימון «שולם», בשלב התשלום.</p>;
  }
  if (l.approval === "approved" && !isAdmin) {
    return <p className="text-sm text-ink-soft">הבקשה לתשלום או להסעה אושרה, ולכן רק המדריך/ה יכול/ה לפתוח את השיעור מחדש.</p>;
  }
  if (asking) {
    return (
      <Confirm
        text={
          <>
            פתיחה מחדש מחזירה את השיעור לטיוטה, ומוחקת את מה שנאסף {byGender(speakerGender, "למרצה הזה", "למרצה הזו", "למרצה הזה/הזו")}: {loses.join(" · ")}.
            אם סוגרים שוב, השלבים מתחילים מההתחלה.
            {files > 0 && <> {files === 1 ? "הקובץ שהועלה נשאר" : `${files} הקבצים שהועלו נשארים`} בלוח השיעור, מסומן/ים «מהמרצה הקודם», עד שמסירים {files === 1 ? "אותו" : "אותם"}.</>}
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
    <Button ref={focusBack.ref()} onClick={() => (loses.length > 0 ? setAsking(true) : onReopen())}>
      פתיחה מחדש (חזרה לטיוטה)
    </Button>
  );
}

// ------------------------------------------------------------------ empty cell

export function CellPanel({ model, me, day, row, canEdit, actions, onClose, wide }: { model: GridModel; me: number; day: Day; row: GridRow; canEdit: boolean; actions: PanelActions; onClose: () => void; wide: boolean }) {
  const need = model.days[day].balance.need;
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
          {need && <Meta tone="warn">{need === "f" ? "היום חסרות מרצות" : "היום חסרים מרצים"}</Meta>}
        </>
      }
    >
      {canEdit ? (
        <>
          <Section title="הצעת מרצה">
            <SpeakerChooser model={model} me={me} day={day} start={row.start_min} end={row.end_min} need={need} onPick={(id, mode) => actions.propose(id, { day, start_min: row.start_min, end_min: row.end_min, room_id: null }, mode)} />
          </Section>
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

export function SpeakerChooser({ model, me, day, start, end, need, onPick }: { model: GridModel; me: number; day: Day; start: number; end: number; need?: Gender | null; onPick: (speakerId: number, mode: "self" | "offer") => void }) {
  const [query, setQuery] = useState("");
  const ranked = useMemo(() => {
    return model.week.speakers
      .filter((s) => !s.retired && speakerMatches(s, query))
      .map((s) => ({ s, section: poolSection(model, s.id, me), fit: fitFor(model, s.id, day, start, end) }))
      .filter((x) => x.section !== "closed" && x.section !== "declined" && x.fit !== "busy")
      .sort(
        (a, b) =>
          SECTION_RANK[a.section] - SECTION_RANK[b.section] ||
          Number(!!need && b.s.gender === need) - Number(!!need && a.s.gender === need) ||
          FIT_RANK[a.fit] - FIT_RANK[b.fit] ||
          a.s.name.localeCompare(b.s.name, "he"),
      )
      .slice(0, 30);
  }, [model, me, day, start, end, need, query]);

  return (
    <div className="space-y-1.5">
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש מרצה" aria-label="חיפוש מרצה למשבצת" className={INPUT} />
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {ranked.map(({ s, section, fit }) => (
          <ChooserRow key={s.id} model={model} speaker={s} section={section} fit={fit} need={need ?? null} onPick={onPick} />
        ))}
        {ranked.length === 0 && <li className="p-2 text-center text-sm text-ink-faint">אין התאמות</li>}
      </ul>
    </div>
  );
}

function ChooserRow({ model, speaker: s, section, fit, need, onPick }: { model: GridModel; speaker: Speaker; section: string; fit: Fit; need: Gender | null; onPick: (id: number, mode: "self" | "offer") => void }) {
  const owner = model.memberName.get(model.approachBySpeaker.get(s.id)?.owner_member_id ?? -1);
  const others = section === "others";
  return (
    <li className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2 py-1.5">
      <GenderDot gender={s.gender} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{displayName(s)}</span>
        <span className="block truncate text-[11px] text-ink-soft">
          {others ? `בטיפול: ${owner}` : section === "mine" ? "שלי" : "פנוי/ה"}
          {fit === "cannot" && ` · ${byGender(s.gender, "אמר", "אמרה")} שלא ${byGender(s.gender, "יכול", "יכולה")}`}
          {fit === "can" && " · זמין/ה"}
          {need && s.gender === need && " · מתאים לאיזון"}
          {s.vetted !== "approved" && " · ממתין לאישור"}
        </span>
      </span>
      <Button onClick={() => onPick(s.id, others ? "offer" : "self")}>
        {others ? "הצע ל" + (owner ?? "אחראי/ת") : "הצע"}
      </Button>
    </li>
  );
}

// ------------------------------------------------------------------ reshaping

/** The shape menu, folded: an occasional act (merge, split) that should not crowd the panel's everyday one. */
function ShapeFold(props: Parameters<typeof ShapeMenu>[0]) {
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[15px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
        מבנה המשבצת
        <span className="text-sm font-normal text-ink-soft">איחוד · פיצול</span>
        <span aria-hidden className="ms-auto text-ink-soft transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="pt-2">
        <ShapeMenu {...props} />
      </div>
    </details>
  );
}

/** The cell a reshape acts on, and the day's lesson rows (CONTRACT `reshape`, v13). */
function cellOf(model: GridModel, day: Day, row: GridRow) {
  const rows = model.week.rows.filter((r) => r.kind === "lesson" && rowActive(r, day, model.week.edition));
  const lessons = model.week.lessons.filter((l) => l.day === day && l.state !== "cancelled");
  const span = cellSpan(row, lessons);
  return { rows, span, stuck: sticksOut(span, lessons) };
}

export function ShapeMenu({ model, day, row, closed, onReshape }: { model: GridModel; day: Day; row: GridRow; closed: boolean; onReshape: (op: ReshapeOp) => void }) {
  const [reason, setReason] = useState("");
  const { rows, span, stuck } = cellOf(model, day, row);
  const merged = span.start !== row.start_min || span.end !== row.end_min;
  return (
    <div className="space-y-3 text-sm">
      {merged && (
        <p className="text-xs text-ink-soft">
          משבצת מאוחדת: <bdi>{fmtRange(span.start, span.end)}</bdi>. הפיצול חל על כולה.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button onClick={() => onReshape({ op: "merge_next" })}>איחוד עם המשבצת הבאה</Button>
        {!closed && <Button onClick={() => onReshape({ op: "reset" })}>החזרה למבנה הבסיס</Button>}
      </div>
      <div>
        <p className="mb-1 font-semibold">פיצול למקבילים</p>
        <p className="mb-1 text-xs text-ink-soft">שיעורים מקבילים מפצלים את הקבוצה — כדאי רק כשיש סיבה.</p>
        <div className="flex flex-wrap gap-1.5">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="הסיבה" aria-label="סיבה לפיצול" className={`${INPUT} min-w-0 flex-1 basis-32`} />
          <Button disabled={!reason.trim()} onClick={() => onReshape({ op: "split_parallel", count: 2, reason })}>
            2 מקבילים
          </Button>
          <Button disabled={!reason.trim()} onClick={() => onReshape({ op: "split_parallel", count: 3, reason })}>
            3 מקבילים
          </Button>
        </div>
      </div>
      {!closed &&
        (stuck ? (
          <p className="text-xs text-ink-soft">
            <span className="font-semibold">פיצול בזמן:</span> שיעור במקביל מתחיל או נגמר מחוץ למשבצת הזו — מזיזים אותו או מחזירים למבנה הבסיס קודם.
          </p>
        ) : (
          <TimeSplit key={`${span.start}:${span.end}`} rows={rows} span={span} onReshape={onReshape} />
        ))}
    </div>
  );
}

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
    <fieldset>
      <legend className="mb-1 font-semibold">פיצול בזמן</legend>
      <ol className="space-y-1">
        {ranges.map(([a, b], i) => (
          <li key={i} className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 text-xs text-ink-soft">חלק {i + 1}</span>
            {i < typed.length ? (
              <input
                type="number"
                inputMode="numeric"
                min={15}
                step={5}
                value={typed[i]}
                onChange={(e) => setTyped((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                aria-label={`דקות בחלק ${i + 1}`}
                className={`${INPUT} w-20`}
              />
            ) : (
              <span className="w-20 px-2" aria-label={`דקות בחלק ${i + 1}`}>
                {parts[i]}
              </span>
            )}
            <span className="text-xs text-ink-soft">
              דק׳ · <bdi dir="ltr">{fmtRange(a, b)}</bdi>
            </span>
            {i === typed.length - 1 && typed.length > 1 && (
              <button type="button" className="text-xs text-ink-soft underline" onClick={() => setTyped((xs) => xs.slice(0, -1))}>
                הסרת חלק
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Button disabled={!ok} onClick={() => onReshape({ op: "split_time", parts })}>
          פיצול ל-{parts.length} חלקים
        </Button>
        {parts[parts.length - 1] >= 30 && (
          <button type="button" className="text-xs text-ink-soft underline" onClick={() => setTyped((xs) => [...xs, String(Math.max(15, Math.round(parts[parts.length - 1] / 2 / 5) * 5))])}>
            + חלק נוסף
          </button>
        )}
      </div>
      {!ok && <p className="mt-1 text-xs text-bad">כל חלק לפחות 15 דקות, בכפולות של 5, ומתחיל ונגמר בתוך שעת שיעור.</p>}
    </fieldset>
  );
}
