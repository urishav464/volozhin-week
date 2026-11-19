// The writing grid — the staff's overview (`/`, and `/grid` for everyone): the grid (desktop) or the day view
// (phone/tablet), the panels, and every command — through the DataPort, so the demo and the real database behave the
// same (docs/CONTRACT.md). The edition and its loaded week are shared with the pages (weekStore.tsx). The reset, phase 3:
// no pool and no placing mode — a speaker is proposed from a cell's or a lesson's chooser, or from their page
// (/speakers/:id); opening a speaker goes to that page, «+ מרצה חדש/ה» to /speakers/new; a lesson's panel stays (its
// shaping, moving and the grid's rules live here) with «לדף השיעור»; the «התקדמות» lens is a lesson × step table.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { type CellTarget, CommandError, type GridRules, type LessonPatch, type ReshapeOp } from "../data/commands";
import { handlesLogistics } from "../data/gate";
import type { DataPort } from "../data/port";
import type { Me } from "../data/types";
import { byGender, displayName } from "../domain/names";
import { newSpeakerPath, speakerPath } from "../domain/routes";
import type { Day } from "../domain/time";
import type { GridRow, Speaker } from "../domain/types";
import { errorMessage } from "../errors";
import { statusLabel } from "../lib/labels";
import { DayView } from "../grid/DayView";
import { GridDesktop } from "../grid/GridDesktop";
import type { Lens } from "../grid/LessonCard";
import { OWNER_EXCEPTION_NOTE, ownerColors } from "../grid/owners";
import { DayPanel } from "../grid/DayPanel";
import { weekBalance } from "../rules/balance";
import { type DragItem, type DropTarget, useMouseDrag } from "../grid/dnd";
import { buildModel, pitchSpeaker, weekTopics } from "../grid/model";
import { CellPanel, LessonPanel, type PanelActions } from "../grid/Panels";
import { RotaWeek } from "../grid/RotaWeek";
import { TopicMatrix } from "../grid/TopicMatrix";
import { WarningsPanel } from "../grid/WarningsPanel";
import { useMedia } from "../lib/useMedia";
import { NO_TOPIC_COLOR } from "../grid/bits";
import { LessonStages } from "./stages/LessonStages";
import { MemorialSlotPanel } from "./memorial/SlotPanel";
import { ProgressTable } from "./progress/ProgressTable";
import { RotaLoadFailed, useRota } from "./rota/shared";
import { DraftFiles } from "./stages/SourceFiles";
import { Button, Fold } from "./settings/kit";
import { actorIn, useWeekStore } from "./weekStore";

type Panel =
  | { kind: "lesson"; id: number }
  | { kind: "cell"; day: Day; row: GridRow }
  | { kind: "warnings" }
  /** v13: a day at a glance — the day header opens it. */
  | { kind: "day"; day: Day }
  | null;

type Toast = { kind: "ok" | "error"; text: string; undo?: () => Promise<void> } | null;
type Offer = { speakerId: number; target: CellTarget; owner: string } | null;

/** The toolbar's quiet pills («אזהרות», «+ מרצה חדש/ה»): 44px on a phone, slimmer beside the wide grid. */
const QUIET_PILL = "inline-flex items-center rounded-full border border-line bg-card px-3.5 text-sm font-semibold text-navy transition-colors hover:border-navy/40 hover:bg-accent-soft";

const LENSES: [Lens, string][] = [
  ["diversity", "גיוון"],
  ["progress", "התקדמות"],
  ["owner", "אחריות"],
  // 8.11: the duties alone, no lesson — read (load_rota) only while it is on
  ["rota", "תורנויות"],
];

export function WeekScreen({ port, me }: { port: DataPort; me: Me }) {
  const wide = useMedia("(min-width: 1024px)");
  const store = useWeekStore();
  const { editions, editionId, week, problem, reload } = store;
  const [lens, setLens] = useState<Lens>("diversity");
  // the «אחריות» lens's «רק של X» (v13): a member's id, «בלי אחראי/ת», or everyone
  const [onlyOwner, setOnlyOwner] = useState<number | "none" | null>(null);
  const [day, setDay] = useState<Day>(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [offer, setOffer] = useState<Offer>(null);
  // the topics' legend's second layer on a wide screen, «לפי ימים» (a phone folds the whole legend)
  const [matrixOpen, setMatrixOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "error" ? 7000 : 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const model = useMemo(() => (week ? buildModel(week) : null), [week]);
  // a draft gone from under its panel (its last candidate removed, a proposal undone): the panel goes with it
  useEffect(() => {
    if (panel?.kind === "lesson" && model && !model.week.lessons.some((l) => l.id === panel.id)) setPanel(null);
  }, [panel, model]);
  const actor = actorIn(me, week?.edition ?? editions.find((e) => e.id === editionId));
  const { memberId, isAdmin, canEdit } = actor;
  const cmds = useMemo(() => (editionId != null ? port.commands(editionId) : null), [port, editionId]);
  // «תורנויות»: the edition's rota, loaded when the lens turns on (and again each time it does) — never its heads' phones
  const rota = useRota(port, lens === "rota" ? editionId : null);
  // a lesson or a cell opened (a warning, the day's panel) needs the grid: the duties' lens and the progress table have
  // no card to stand beside — back to the grid's first lens
  useEffect(() => {
    if ((lens === "rota" || lens === "progress") && (panel?.kind === "lesson" || panel?.kind === "cell")) setLens("diversity");
  }, [lens, panel]);

  /** Run a command, reload, and say what happened (or why not). */
  const run = useCallback(
    async (fn: () => Promise<unknown>, ok?: string, undo?: () => Promise<void>) => {
      try {
        await fn();
        await reload();
        if (ok) setToast({ kind: "ok", text: ok, undo });
        return true;
      } catch (e) {
        const code = e instanceof CommandError ? e.code : null;
        setToast({ kind: "error", text: errorMessage(code) });
        if (code === "stale") await reload();
        return false;
      }
    },
    [reload],
  );

  const propose = useCallback(
    (speakerId: number, target: CellTarget, mode: "self" | "offer" = "self") => {
      if (!model || !cmds) return;
      const s = model.speakerById.get(speakerId);
      const a = model.approachBySpeaker.get(speakerId);
      if (mode === "self" && a?.owner_member_id != null && a.owner_member_id !== memberId) {
        setOffer({ speakerId, target, owner: model.memberName.get(a.owner_member_id) ?? "חבר/ת צוות" });
        return;
      }
      let pitchId: number | null = null;
      let lessonId: number | null = null;
      void run(
        async () => {
          ({ pitch_id: pitchId, lesson_id: lessonId } = await cmds.propose(speakerId, target, mode));
        },
        `${s ? displayName(s) : "המרצה"} ${mode === "offer" ? "הוצע/ה לאחראי/ת" : "סומן/ה למשבצת"}`,
        async () => {
          if (pitchId != null) await run(() => cmds.unpropose(pitchId!), "בוטל");
        },
      ).then(() => {
        // proposed from an empty cell's panel: the panel becomes the new draft's — the candidate, where the call begins
        // (as a shaped draft's chooser gives way to its candidates)
        if (lessonId != null)
          setPanel((p) => (p?.kind === "cell" && "day" in target && p.day === target.day && p.row.start_min === target.start_min ? { kind: "lesson", id: lessonId! } : p));
      });
    },
    [model, cmds, memberId, run],
  );

  const actions: PanelActions | null = useMemo(() => {
    if (!cmds || editionId == null || !model) return null;
    const name = (s: Speaker | undefined) => (s ? displayName(s) : "המרצה");
    return {
      propose,
      unpropose: (id) => void run(() => cmds.unpropose(id), "הוסר/ה מהמשבצת"),
      revive: (id) => {
        const p = model.week.pitches.find((x) => x.id === id);
        const s = p && pitchSpeaker(model, p);
        void run(() => cmds.setPitch(id, "candidate"), `${name(s)} ${byGender(s?.gender, "חזר", "חזרה")} לתהליך`);
      },
      // v14: the call's result is the approach's status, recorded with what was said
      callResult: (a, status, note) => {
        const s = model.speakerById.get(a.speaker_id);
        return run(() => port.speakers.setStatus(editionId, a.id, a.version, status, note), `עודכן: ${name(s)} · ${statusLabel(status, s?.gender ?? null)}`);
      },
      approveSpeaker: (id) => {
        const s = model.speakerById.get(id);
        return run(() => port.speakers.vet([id], "approved", null), `${name(s)} ${byGender(s?.gender, "אושר", "אושרה")}`);
      },
      close: (id) => run(() => cmds.closeLesson(id), "השיעור נסגר"),
      reopen: (id) => void run(() => cmds.reopenLesson(id), "השיעור חזר לטיוטה"),
      update: (id, version, patch: LessonPatch) => void run(() => cmds.updateLesson(id, version, patch), "נשמר"),
      reshape: (d, rowStart, op: ReshapeOp) => {
        setPanel(null);
        void run(() => cmds.reshape(d, rowStart, op), "המשבצת עוצבה מחדש");
      },
      // a speaker opens their page (the old side sheet is gone)
      openSpeaker: (id) => navigate(speakerPath(id)),
    };
  }, [cmds, editionId, model, port, propose, run, navigate]);

  // A lesson dragged to another cell moves there (move_lesson) — the one drag left; a speaker is proposed from the
  // choosers or their page, a candidate removed with «הסרה», a closed lesson reopened from its panel.
  const onDrop = useCallback(
    (item: DragItem, target: DropTarget) => {
      if (!model || !cmds || !canEdit) return;
      const l = model.week.lessons.find((x) => x.id === item.id);
      if (!l) return;
      const len = l.end_min - l.start_min;
      void run(() => cmds.moveLesson(l.id, { day: target.day as Day, start_min: target.start, end_min: target.start + len, room_id: l.room_id }), "השיעור הוזז");
    },
    [model, cmds, canEdit, run],
  );
  const drag = useMouseDrag(onDrop);

  const onCell = (d: Day, row: GridRow) => setPanel({ kind: "cell", day: d, row });
  const onLesson = (id: number) => {
    const l = model?.week.lessons.find((x) => x.id === id);
    if (l && !wide) setDay(l.day);
    setPanel({ kind: "lesson", id });
    // the docked panel narrows the grid: keep the card that was opened in view
    if (wide) requestAnimationFrame(() => document.querySelector(`[data-lesson-id="${id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  };
  // v13: either memorial row, before lunch or after it, takes a slot from the grid — an edition admin's (add_memorial_slot)
  const onMemorial = isAdmin && cmds
    ? (d: Day, row: GridRow) => {
        let id: number | null = null;
        void run(async () => {
          id = await cmds.addMemorialSlot(d, row.start_min, row.end_min, null);
        }, "זמן הזיכרון נוסף").then(() => {
          if (id != null) setPanel({ kind: "lesson", id });
        });
      }
    : undefined;
  const onDayPanel = (d: Day) => setPanel({ kind: "day", day: d });
  const onRules = cmds ? (rules: GridRules) => run(() => cmds.setGridRules(rules), "כללי הרשת נשמרו").then(() => true) : undefined;

  if (problem === "none") {
    return (
      <div className="mx-auto mt-8 max-w-lg rounded-xl border border-line bg-card p-5 shadow-sm">
        <h2 className="mb-2 font-display text-xl font-extrabold text-navy">עוד לא נפתח מחזור</h2>
        {me.global_admin ? (
          <>
            <p className="mb-4 text-ink-soft">פותחים את המחזור של השנה בהגדרות, ואז מוסיפים את הצוות.</p>
            <Link to="/settings/edition" className="inline-flex min-h-11 items-center rounded-full bg-navy px-5 font-semibold text-white hover:bg-navy-800">
              לפתיחת מחזור
            </Link>
          </>
        ) : (
          <p className="text-ink-soft">המדריך/ה עוד לא פתח/ה את המחזור של השנה.</p>
        )}
      </div>
    );
  }
  if (problem === "error") {
    return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון את השבוע. כדאי לרענן את הדף.</p>;
  }
  if (!model || !actions) return <p className="mt-10 text-center text-ink-soft">טוען את השבוע…</p>;

  const openLesson = panel?.kind === "lesson" ? model.week.lessons.find((l) => l.id === panel.id) : undefined;
  const warnCount = model.warnings.filter((w) => w.severity === "warn").length;
  const weekTotal = weekBalance(model.days.map((d) => d.balance));
  const unbalancedDays = model.warnings.filter((w) => w.kind === "gender_day").length;
  const fmtCount = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {editions.length > 1 ? (
        <select
          aria-label="מחזור"
          value={editionId ?? ""}
          onChange={(e) => {
            setPanel(null);
            store.select(Number(e.target.value));
          }}
          className="rounded-lg border border-line bg-card px-2 py-1 font-display text-lg font-extrabold text-navy focus:border-navy"
        >
          {editions.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
              {e.status === "archived" ? " (ארכיון)" : e.kind === "demo" ? " (הדגמה)" : ""}
            </option>
          ))}
        </select>
      ) : (
        <h2 className="font-display text-lg font-extrabold text-navy">{model.week.edition.label}</h2>
      )}
      <div role="radiogroup" aria-label="עדשה" className="flex gap-0.5 rounded-full border border-line bg-card p-0.5">
        {LENSES.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={lens === key}
            onClick={() => {
              setLens(key);
              // no card in the duties' lens or the progress table: no lesson's (or cell's) panel beside it
              if (key === "rota" || key === "progress") setPanel(null);
            }}
            className={`rounded-full px-3.5 text-sm font-semibold transition-colors ${wide ? "py-0.5" : "min-h-11"} ${lens === key ? "bg-navy text-white shadow-sm" : "text-ink-soft hover:bg-accent-soft hover:text-navy"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setPanel({ kind: "warnings" })} className={`${QUIET_PILL} ${wide ? "min-h-8" : "min-h-11"}`}>
        אזהרות&nbsp;<span className={`tabular-nums ${warnCount ? "font-bold text-warn" : ""}`}>{warnCount}</span>
      </button>
      {canEdit && (
        <Link to={newSpeakerPath()} className={`${QUIET_PILL} ${wide ? "min-h-8" : "min-h-11"}`}>
          + מרצה חדש/ה
        </Link>
      )}
      {/* v13: the week's closed lessons, women and men, in the cells' pink and sky — each day's own is in its header and panel */}
      <span className="inline-flex flex-wrap items-center gap-1 text-xs text-ink-soft tabular-nums" aria-label="השבוע כולו" data-week-balance>
        השבוע:{" "}
        <span className="rounded-full bg-need-f px-2 text-pink-900">{fmtCount(weekTotal.closed.f)} מרצות</span>{" "}
        <span className="rounded-full bg-need-m px-2 text-sky-900">{fmtCount(weekTotal.closed.m)} מרצים</span>
        {unbalancedDays > 0 && <span className="font-semibold text-bad"> · {unbalancedDays === 1 ? "יום אחד לא מאוזן" : `${unbalancedDays} ימים לא מאוזנים`}</span>}
      </span>
    </div>
  );

  // The diversity lens (v13): what each topic's colour is and how many of the week's closed lessons have it
  // (the empty cells say «דרושה מרצה» / «דרוש מרצה» themselves); «לפי ימים» opens the topic × day table.
  const team = ownerColors(model.week.team);
  const owners = { colorOf: new Map(team.map((m) => [m.id, m.color])), only: onlyOwner };
  const topics = (
    <ul aria-label="מקרא הנושאים" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
      {weekTopics(model).map(({ category: c, count }) => (
        <li key={c.id} className="inline-flex items-center gap-1">
          <span aria-hidden className="h-3 w-1.5 rounded-sm" style={{ backgroundColor: c.color }} />
          {c.name}
          <span className={`font-bold tabular-nums ${count ? "text-navy" : "text-ink-faint"}`}>{count}</span>
        </li>
      ))}
    </ul>
  );
  // on a phone the legend folds away (the day comes first), and the table is the legend: its rows are the topics
  const diversityLegend =
    lens === "diversity" &&
    (wide ? (
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {topics}
          <LegendToggle open={matrixOpen} onToggle={() => setMatrixOpen((v) => !v)} controls="topic-matrix">
            לפי ימים
          </LegendToggle>
        </div>
        {matrixOpen && (
          <div id="topic-matrix" className="mt-2 w-fit max-w-full overflow-x-auto rounded-xl border border-line bg-card p-3 shadow-sm">
            <TopicMatrix model={model} />
          </div>
        )}
      </div>
    ) : (
      <Fold size="sm" title="מקרא הנושאים" hint="לפי ימים">
        <div className="overflow-x-auto rounded-xl border border-line bg-card p-2">
          <TopicMatrix model={model} />
        </div>
      </Fold>
    ));

  // The owner lens (v13): a colour per handler, on drafts too; «רק של X» fades the others' cards.
  const ownerLegend = lens === "owner" && (
    <div role="group" aria-label="מקרא האחריות" className="flex flex-wrap items-center gap-1.5 text-xs">
      {[...team.map((m) => ({ key: m.id as number | "none", name: m.name, color: m.color })), { key: "none" as const, name: "בלי אחראי/ת", color: NO_TOPIC_COLOR }].map((m) => (
        <button
          key={m.key}
          type="button"
          aria-pressed={onlyOwner === m.key}
          onClick={() => setOnlyOwner((cur) => (cur === m.key ? null : m.key))}
          className={`inline-flex items-center gap-1 rounded-full border transition-colors ${wide ? "min-h-7 px-2" : "min-h-11 px-3"} ${onlyOwner === m.key ? "border-navy bg-navy font-semibold text-white" : "border-line bg-card text-ink-soft hover:border-navy/40 hover:text-navy"}`}
        >
          <span aria-hidden className={`size-2.5 rounded-full ${onlyOwner === m.key ? "ring-1 ring-white/80" : ""}`} style={{ backgroundColor: m.color }} />
          {onlyOwner === m.key ? `רק של ${m.name}` : m.name}
        </button>
      ))}
      {onlyOwner != null && (
        <button type="button" onClick={() => setOnlyOwner(null)} className={`rounded-full px-2 font-semibold text-navy underline underline-offset-2 hover:bg-accent-soft ${wide ? "min-h-7" : "min-h-11"}`}>
          כולם
        </button>
      )}
      {/* the day's pair (its owners, «הגדרות ← צוות ← ימים»): a card handled by someone else is marked «חריג» */}
      <span data-owner-note className="inline-flex items-center gap-1 text-ink-soft">
        <span aria-hidden className="inline-block h-3 w-5 rounded border-2 border-dashed border-gold" />
        {OWNER_EXCEPTION_NOTE}
      </span>
    </div>
  );

  // The progress lens (the reset, phase 3): a lesson × step table in the grid's place — its own filters and legend.
  const progressBody = lens === "progress" && <ProgressTable model={model} wide={wide} />;

  // The duties' lens (8.11): where its shifts lead — «לוגיסטיקה ← תורנויות» for the edition's logistics and admins, the
  // printout for everyone else — and what a dashed code is.
  const rotaHref = handlesLogistics(me) && (actor.isAdmin || actor.role === "logistics") ? "/logistics/rota" : "/print/rota";
  const rotaData = lens === "rota" ? rota.data : null;
  const rotaLegend = lens === "rota" && rotaData && rotaData.duties.length > 0 && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
      {rotaData.assignments.length === 0 ? (
        <span>עוד לא שובצו תורנויות במחזור הזה.</span>
      ) : (
        rotaData.assignments.some((a) => a.source === "suggested") && (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="inline-block h-3 w-5 rounded-full border border-dashed border-navy/60 bg-card" />
            שובצה מ«הצעה הוגנת» ועוד לא נגעו בה
          </span>
        )
      )}
      <Link to={rotaHref} className={`inline-flex items-center rounded-full px-2 font-semibold text-navy underline underline-offset-2 hover:bg-accent-soft ${wide ? "min-h-7" : "min-h-11"}`}>
        ללוח התורנויות
      </Link>
    </div>
  );
  const rotaBody =
    lens === "rota" &&
    (rotaData ? (
      rotaData.duties.length === 0 ? (
        <div className="rounded-xl border border-line bg-card p-4 text-sm shadow-sm">
          <p className="text-ink-soft">עוד אין תורנויות במחזור הזה.</p>
          <Link to={rotaHref} className="mt-1 inline-flex min-h-11 items-center font-semibold text-navy underline underline-offset-2">
            לתורנויות
          </Link>
        </div>
      ) : (
        <RotaWeek edition={model.week.edition} data={rotaData} wide={wide} day={day} onDay={setDay} boardHref={rotaHref} />
      )
    ) : rota.failed ? (
      <RotaLoadFailed code={rota.failed} onRetry={() => void rota.reload()} />
    ) : (
      <p className="mt-6 text-center text-ink-soft">טוען את התורנויות…</p>
    ));

  const legend = diversityLegend || ownerLegend || rotaLegend;

  return (
    <div className="flex flex-col gap-2">
      {toolbar}
      {legend}

      {progressBody ? (
        // the table reads at its own height: the page scrolls, as a list does
        <div className="min-w-0">{progressBody}</div>
      ) : wide ? (
        <div className="flex gap-3" style={{ height: legend ? "calc(100dvh - 12rem)" : "calc(100dvh - 9.5rem)" }}>
          <div className="min-w-0 flex-1 overflow-auto rounded-lg" data-autoscroll>
            {rotaBody || (
              <GridDesktop model={model} lens={lens} owners={owners} overKey={drag?.overKey ?? null} onCell={onCell} onLesson={onLesson} onMemorial={onMemorial} onDayPanel={onDayPanel} />
            )}
          </div>
        </div>
      ) : (
        <div>{rotaBody || <DayView model={model} lens={lens} owners={owners} day={day} onDay={setDay} onCell={onCell} onLesson={onLesson} onMemorial={onMemorial} onDayPanel={onDayPanel} />}</div>
      )}

      {openLesson && (
        <LessonPanel
          model={model}
          lesson={openLesson}
          me={memberId}
          isAdmin={isAdmin}
          global={actor.global}
          canEdit={canEdit}
          actions={actions}
          onClose={() => setPanel(null)}
          wide={wide}
          files={(l) =>
            l.kind === "memorial" ? (
              <MemorialSlotPanel port={port} week={model.week} lesson={l} actor={actor} notify={(kind, text) => setToast({ kind, text })} clear={() => setToast(null)} reload={reload} />
            ) : (
              <DraftFiles port={port} week={model.week} lesson={l} actor={actor} notify={(kind, text) => setToast({ kind, text })} reload={reload} />
            )
          }
          stages={(l) => (
            <LessonStages
              key={l.id}
              port={port}
              week={model.week}
              lessonId={l.id}
              actor={actor}
              notify={(kind, text) => setToast({ kind, text })}
              clear={() => setToast(null)}
              reload={reload}
            />
          )}
        />
      )}
      {panel?.kind === "cell" && <CellPanel model={model} me={memberId} day={panel.day} row={panel.row} canEdit={canEdit} actions={actions} onClose={() => setPanel(null)} wide={wide} />}
      {panel?.kind === "warnings" && (
        <WarningsPanel
          model={model}
          wide={wide}
          onClose={() => setPanel(null)}
          onLesson={(id) => {
            onLesson(id);
            requestAnimationFrame(() => document.querySelector(`[data-lesson-id="${id}"]`)?.scrollIntoView({ block: "center", inline: "center" }));
          }}
          onDay={onDayPanel}
        />
      )}
      {panel?.kind === "day" && (
        <DayPanel
          model={model}
          day={panel.day}
          isAdmin={isAdmin}
          wide={wide}
          onClose={() => setPanel(null)}
          onLesson={onLesson}
          onCell={(d, row) => setPanel({ kind: "cell", day: d, row })}
          onRules={onRules}
        />
      )}

      {offer && (
        <div role="alertdialog" aria-label="המרצה בטיפול חבר/ת צוות" className="fixed inset-0 z-50 grid place-items-center bg-navy-900/40 p-4">
          <div className="w-full max-w-sm rounded-xl border border-line bg-card p-5 shadow-xl">
            <p className="mb-1 font-bold text-navy">{displayName(model.speakerById.get(offer.speakerId)!)} בטיפול {offer.owner}</p>
            <p className="mb-4 text-sm text-ink-soft">אפשר להציע ל{offer.owner} את המשבצת הזו. הבעלות על הפנייה לא משתנה.</p>
            <div className="flex gap-2">
              <Button
                kind="primary"
                className="text-sm"
                onClick={() => {
                  const o = offer;
                  setOffer(null);
                  propose(o.speakerId, o.target, "offer");
                }}
              >
                הצעה ל{offer.owner}
              </Button>
              <Button className="text-sm" onClick={() => setOffer(null)}>
                ביטול
              </Button>
            </div>
          </div>
        </div>
      )}

      {drag && (
        <div aria-hidden className="pointer-events-none fixed z-50 rounded-full bg-navy px-2.5 py-1 text-xs font-semibold text-white shadow-lg" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          {drag.label || "…"}
        </div>
      )}

      {toast && (
        <div role={toast.kind === "error" ? "alert" : "status"} className={`fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-xl px-4 py-2.5 text-sm shadow-xl ${toast.kind === "error" ? "bg-bad text-white" : "bg-navy text-white"}`}>
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              className="rounded-full border border-white/60 px-3 py-0.5 font-semibold hover:bg-white/10 focus-visible:outline-white!"
              onClick={() => {
                const u = toast.undo!;
                setToast(null);
                void u();
              }}
            >
              ביטול
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A legend's «more» on a wide screen (the topics «לפי ימים»): a small disclosure at the row's end. */
function LegendToggle({ open, onToggle, controls, children }: { open: boolean; onToggle: () => void; controls: string; children: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-navy hover:bg-accent-soft"
    >
      {children}
      <span aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`}>
        ▾
      </span>
    </button>
  );
}
