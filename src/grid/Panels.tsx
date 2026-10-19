// The side panel (a bottom sheet on a phone): what a lesson or an empty cell
// offers — candidates and closing, the lesson's details, its stages after it
// closed (payment, the message, the escort, sources: src/screens/stages/,
// handed in by the week as `stages`), and reshaping the cell.
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { byGender, displayName } from "../domain/names";
import { DAY_NAMES, type Day, fmtRange } from "../domain/time";
import type { Gender, GridRow, Lesson, Pitch, Speaker } from "../domain/types";
import type { CellTarget, LessonPatch, ReshapeOp } from "../data/commands";
import { reopenLoses, stagesOf } from "../domain/stages";
import { Button, Confirm, INPUT } from "../screens/settings/kit";
import { Chip, GenderDot, STAGE_DOT } from "./bits";
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
          ? "fixed inset-y-0 end-0 z-40 flex w-[24rem] max-w-full flex-col border-s border-line bg-paper shadow-lg outline-none"
          : "fixed inset-x-0 bottom-0 z-40 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-line bg-paper shadow-2xl outline-none"
      }
    >
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
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
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          {subtitle && <div className="text-sm text-ink-soft">{subtitle}</div>}
        </div>
        <button type="button" onClick={onClose} aria-label="סגירה" className="-me-2 -mt-1 ms-auto inline-flex size-11 shrink-0 items-center justify-center rounded-md text-xl leading-none hover:bg-line/50">
          ×
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">{title}</h3>
      {children}
    </section>
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
          {DAY_NAMES[l.day]} · <bdi>{fmtRange(l.start_min, l.end_min)}</bdi> · {room?.name}
          {l.parallel_reason && <> · ∥ {l.parallel_reason}</>}
        </>
      }
    >
      {warnings.length > 0 && (
        <ul className="space-y-1">
          {warnings.map((w) => (
            <li key={w.key} className={`rounded-md px-2 py-1 text-sm ${w.severity === "warn" ? "bg-amber-50 text-amber-900" : "bg-sky-50 text-sky-900"}`}>
              {w.severity === "warn" ? "⚠ " : "ℹ "}
              {w.message}
            </li>
          ))}
        </ul>
      )}

      {l.state === "draft" && l.kind === "lesson" && (
        <Section title="מועמדים">
          <Candidates {...props} />
          {canEdit &&
            (adding ? (
              <div className="mt-2 rounded-lg border border-line bg-card p-2">
                <SpeakerChooser model={model} me={props.me} day={l.day} start={l.start_min} end={l.end_min} onPick={(id, mode) => actions.propose(id, { lesson_id: l.id }, mode)} />
                <Button className="mt-2" onClick={() => setAdding(false)}>
                  סגירת הרשימה
                </Button>
              </div>
            ) : (
              <Button className="mt-2" onClick={() => setAdding(true)}>
                + הצעת מרצה
              </Button>
            ))}
        </Section>
      )}

      {l.state === "closed" && <ClosedDetails {...props} />}

      {canEdit && row && l.kind === "lesson" && (
        <Section title="מבנה המשבצת">
          <ShapeMenu day={l.day} row={row} closed={l.state === "closed"} onReshape={(op) => actions.reshape(l.day, row.start_min, op)} />
        </Section>
      )}
    </Sheet>
  );
}

function Candidates({ model, lesson: l, me, isAdmin, canEdit, actions }: { model: GridModel; lesson: Lesson; me: number; isAdmin: boolean; canEdit: boolean; actions: PanelActions }) {
  const pitches = model.pitchesByLesson.get(l.id) ?? [];
  if (pitches.length === 0) return <p className="text-sm text-ink-faint">עוד אין מרצה מוצע/ת למשבצת הזו.</p>;
  return (
    <ul className="space-y-1.5">
      {pitches.map((p: Pitch) => {
        const s = pitchSpeaker(model, p);
        const a = model.approachById.get(p.approach_id);
        const mine = isAdmin || a?.owner_member_id === me;
        const owner = a?.owner_member_id != null ? model.memberName.get(a.owner_member_id) : undefined;
        const proposer = p.proposed_by != null && p.proposed_by !== a?.owner_member_id ? model.memberName.get(p.proposed_by) : undefined;
        const live = p.state === "approached" || p.state === "candidate";
        return (
          <li key={p.id} className="rounded-lg border border-line bg-card p-2" data-pitch-id={p.id}>
            <div className="flex items-center gap-1.5">
              <GenderDot gender={s?.gender ?? null} />
              {s ? (
                <button
                  type="button"
                  onClick={() => actions.openSpeaker(s.id)}
                  className={`inline-flex min-h-11 items-center text-start font-semibold underline underline-offset-4 ${p.state === "declined" ? "line-through opacity-60" : ""}`}
                >
                  {displayName(s)}
                </button>
              ) : (
                <span className="font-semibold">?</span>
              )}
              <Chip tone={p.state === "approached" ? "info" : p.state === "declined" ? "bad" : "plain"}>
                {p.state === "approached" ? "פנו" : p.state === "candidate" ? "מועמד/ת" : byGender(s?.gender, "סירב", "סירבה")}
              </Chip>
            </div>
            <p className="text-xs text-ink-soft">
              {owner ? `בטיפול: ${owner}` : "ללא אחראי/ת"}
              {proposer && ` · הוצע ע״י ${proposer}`}
              {s?.vetted !== "approved" && " · ממתין/ה לאישור מדריך/ה"}
            </p>
            {canEdit && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
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
                  <Button onClick={() => actions.setPitch(p.id, "declined")}>
                    {byGender(s?.gender, "סירב", "סירבה")}
                  </Button>
                )}
                {mine && p.state === "declined" && (
                  <Button onClick={() => actions.setPitch(p.id, "approached")}>
                    החזרה לתהליך
                  </Button>
                )}
                {live && (mine || p.proposed_by === me) && (
                  <Button onClick={() => actions.unpropose(p.id)}>
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
  useEffect(() => {
    setTitle(l.title ?? "");
    setCategory(l.category_id ?? 0);
    setAudience(l.audience ?? "");
    setTeach(l.teach_min ?? 0);
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
        <p className="flex items-center gap-1.5 font-semibold">
          <GenderDot gender={lead?.gender ?? null} />
          {lead ? (
            <button type="button" onClick={() => actions.openSpeaker(lead.id)} className="inline-flex min-h-11 items-center text-start underline underline-offset-4">
              {displayName(lead)}
            </button>
          ) : (
            "—"
          )}
        </p>
        {owner != null && <p className="text-xs text-ink-soft">בטיפול: {model.memberName.get(owner)}</p>}
      </Section>

      <Section title="פרטי השיעור">
        <div className="space-y-2">
          <label className="block text-sm">
            כותרת
            <input value={title} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} placeholder="TBD" className={`${INPUT} mt-0.5`} />
          </label>
          <label className="block text-sm">
            קטגוריה
            <select value={category} disabled={!canEdit} onChange={(e) => setCategory(Number(e.target.value))} className={`${INPUT} mt-0.5`}>
              <option value={0}>— לא נבחרה —</option>
              {model.week.categories.filter((c) => c.active || c.id === l.category_id).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <label className="block min-w-0 flex-1 text-sm">
              קהל מיוחד
              <input value={audience} disabled={!canEdit} onChange={(e) => setAudience(e.target.value)} placeholder="למשל: שיעור להורים" className={`${INPUT} mt-0.5`} />
            </label>
            <label className="block w-28 text-sm">
              דקות הוראה
              <input
                type="number"
                min={15}
                step={5}
                max={l.end_min - l.start_min}
                value={teach || ""}
                placeholder={String(Math.min(lessonMinutes, l.end_min - l.start_min))}
                disabled={!canEdit}
                onChange={(e) => setTeach(Number(e.target.value))}
                className={`${INPUT} mt-0.5 tabular-nums`}
              />
            </label>
          </div>
          {canEdit && (
            <Button kind="primary" disabled={!dirty} onClick={save}>
              שמירה
            </Button>
          )}
        </div>
      </Section>

      {stages ? (
        stages(l)
      ) : (
        <Section title="שלבים">
          <ul className="space-y-1 text-sm">
            {stagesOf(l).map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <span className={`size-2.5 rounded-full border ${STAGE_DOT[s.state]}`} />
                <span className="font-semibold">{s.label}</span>
                <span className="text-ink-soft">{s.note}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {canEdit && mine && <Reopen lesson={l} speakerGender={lead?.gender ?? null} isAdmin={isAdmin} onReopen={() => actions.reopen(l.id)} />}
    </>
  );
}

/**
 * «פתיחה מחדש»: the lesson goes back to a draft, and its stages — the speaker's — start over
 * (CONTRACT reopen_lesson). When any stage holds something, it says what goes before doing it.
 * Paid money is never erased (paid_locked); an approved request is the instructor's to reopen.
 */
function Reopen({ lesson: l, speakerGender, isAdmin, onReopen }: { lesson: Lesson; speakerGender: Gender | null; isAdmin: boolean; onReopen: () => void }) {
  const [asking, setAsking] = useState(false);
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
          </>
        }
        confirm="פתיחה מחדש ומחיקה"
        onConfirm={() => {
          setAsking(false);
          onReopen();
        }}
        onCancel={() => setAsking(false)}
      />
    );
  }
  return (
    <Button onClick={() => (loses.length > 0 ? setAsking(true) : onReopen())}>
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
          {DAY_NAMES[day]} · <bdi>{fmtRange(row.start_min, row.end_min)}</bdi>
          {need && <> · {need === "f" ? "היום חסרות מרצות" : "היום חסרים מרצים"}</>}
        </>
      }
    >
      {canEdit ? (
        <>
          <Section title="הצעת מרצה">
            <SpeakerChooser model={model} me={me} day={day} start={row.start_min} end={row.end_min} need={need} onPick={(id, mode) => actions.propose(id, { day, start_min: row.start_min, end_min: row.end_min, room_id: null }, mode)} />
          </Section>
          <Section title="מבנה המשבצת">
            <ShapeMenu day={day} row={row} closed={false} onReshape={(op) => actions.reshape(day, row.start_min, op)} />
          </Section>
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

export function ShapeMenu({ day: _day, row, closed, onReshape }: { day: Day; row: GridRow; closed: boolean; onReshape: (op: ReshapeOp) => void }) {
  const [reason, setReason] = useState("");
  const len = row.end_min - row.start_min;
  const splits = len === 90 ? [[60, 30], [30, 60], [45, 45]] : [[len / 2, len / 2]];
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="mb-1 font-semibold">פיצול למקבילים</p>
        <p className="mb-1 text-xs text-ink-soft">שיעורים מקבילים מפצלים את הקבוצה — כדאי רק כשיש סיבה.</p>
        <div className="flex flex-wrap gap-1.5">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="הסיבה" aria-label="סיבה לפיצול" className={`${INPUT} min-w-0 flex-1 basis-32`} />
          <Button disabled={!reason.trim()} onClick={() => onReshape({ op: "split_parallel", count: 2, reason })}>
            ל-2
          </Button>
          <Button disabled={!reason.trim()} onClick={() => onReshape({ op: "split_parallel", count: 3, reason })}>
            ל-3
          </Button>
        </div>
      </div>
      {!closed && (
        <div>
          <p className="mb-1 font-semibold">פיצול בזמן</p>
          <div className="flex flex-wrap gap-1.5">
            {splits.map((parts) => (
              <Button key={parts.join("+")} onClick={() => onReshape({ op: "split_time", parts })}>
                <bdi>{parts.join("+")}</bdi> דק׳
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button onClick={() => onReshape({ op: "merge_next" })}>
          איחוד עם המשבצת הבאה
        </Button>
        {!closed && (
          <Button onClick={() => onReshape({ op: "reset" })}>
            החזרה למבנה הבסיס
          </Button>
        )}
      </div>
    </div>
  );
}
