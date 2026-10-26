// The week: the grid (desktop) or the day view (phone/tablet), the pool, the
// panels, and every command — through the DataPort, so the demo and the real
// database behave the same (docs/CONTRACT.md). The edition and its loaded week
// are shared with «המרצים שלי» and the approvals queue (weekStore.tsx); those
// screens send a speaker here to be placed, or a lesson to be opened.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { type CellTarget, CommandError, type GridRules, type LessonPatch, type ReshapeOp } from "../data/commands";
import type { DataPort } from "../data/port";
import type { Me } from "../data/types";
import { byGender, displayName } from "../domain/names";
import type { Day } from "../domain/time";
import type { GridRow, Speaker } from "../domain/types";
import { errorMessage } from "../errors";
import { statusLabel } from "../lib/labels";
import { DayView } from "../grid/DayView";
import { GridDesktop } from "../grid/GridDesktop";
import { type Lens, PROGRESS_LEGEND, PROGRESS_TONE } from "../grid/LessonCard";
import { ownerColors } from "../grid/owners";
import { DayPanel } from "../grid/DayPanel";
import { weekBalance } from "../rules/balance";
import { type DragItem, type DropTarget, useMouseDrag } from "../grid/dnd";
import { buildModel, pitchSpeaker, weekTopics } from "../grid/model";
import { CellPanel, LessonPanel, type PanelActions } from "../grid/Panels";
import { Pool } from "../grid/Pool";
import { TopicMatrix } from "../grid/TopicMatrix";
import { WarningsPanel } from "../grid/WarningsPanel";
import { useMedia } from "../lib/useMedia";
import { reopenLoses, type StageKey } from "../domain/stages";
import { NO_TOPIC_COLOR, STAGE_DOT, STAGE_STATE_LABEL } from "../grid/bits";
import { CreateSpeaker } from "./speakers/CreateSpeaker";
import { LessonStages } from "./stages/LessonStages";
import { MemorialSlotPanel } from "./memorial/SlotPanel";
import { DraftFiles } from "./stages/SourceFiles";
import { Fold } from "./settings/kit";
import { SpeakerSheet } from "./speakers/SpeakerSheet";
import { actorIn, useWeekStore } from "./weekStore";

type Panel =
  /** `stage`: the section to open (from «המרצים שלי» or the approvals queue). */
  | { kind: "lesson"; id: number; stage?: StageKey }
  | { kind: "cell"; day: Day; row: GridRow }
  | { kind: "warnings" }
  /** v13: a day at a glance — the day header opens it. */
  | { kind: "day"; day: Day }
  /** `back`: the panel it was opened from (a lesson, a cell, «מרצה חדש/ה»), which «חזרה» returns to. */
  | { kind: "speaker"; id: number; back?: Panel }
  | { kind: "create"; name: string }
  | null;

const BACK_LABEL: Record<string, string> = { lesson: "שיעור", cell: "משבצת", create: "מרצה חדש/ה", warnings: "אזהרות", day: "היום" };

/** What «המרצים שלי» (and the approvals queue) hand the week: a speaker to place, or a lesson to open — at one of its stages. */
export type WeekVisit = { place?: number; lesson?: number; stage?: StageKey } | null;
type Toast = { kind: "ok" | "error"; text: string; undo?: () => Promise<void> } | null;
type Offer = { speakerId: number; target: CellTarget; owner: string } | null;

const LENSES: [Lens, string][] = [
  ["diversity", "גיוון"],
  ["progress", "התקדמות"],
  ["owner", "אחריות"],
];

export function WeekScreen({ port, me }: { port: DataPort; me: Me }) {
  const wide = useMedia("(min-width: 1024px)");
  // Below 1280px the grid needs the pool's width: the pool becomes a drawer.
  const roomy = useMedia("(min-width: 1280px)");
  const [poolOpen, setPoolOpen] = useState(false);
  const store = useWeekStore();
  const { editions, editionId, week, problem, reload } = store;
  const [lens, setLens] = useState<Lens>("diversity");
  // the «אחריות» lens's «רק של X» (v13): a member's id, «בלי אחראי/ת», or everyone
  const [onlyOwner, setOnlyOwner] = useState<number | "none" | null>(null);
  const [day, setDay] = useState<Day>(0);
  const [placingId, setPlacingId] = useState<number | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [offer, setOffer] = useState<Offer>(null);
  const [phoneTab, setPhoneTab] = useState<"day" | "pool">("day");
  // the legends' second layer on a wide screen: the topics «לפי ימים», the progress dots (a phone folds the whole legend)
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [dotsOpen, setDotsOpen] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "error" ? 7000 : 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPlacingId(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  const model = useMemo(() => (week ? buildModel(week) : null), [week]);
  // a draft gone from under its panel (its last candidate removed, a proposal undone): the panel goes with it, and the pool is back
  useEffect(() => {
    if (panel?.kind === "lesson" && model && !model.week.lessons.some((l) => l.id === panel.id)) setPanel(null);
  }, [panel, model]);
  const actor = actorIn(me, week?.edition ?? editions.find((e) => e.id === editionId));
  const { memberId, isAdmin, canEdit } = actor;
  const cmds = useMemo(() => (editionId != null ? port.commands(editionId) : null), [port, editionId]);

  // Sent here from «המרצים שלי» or a speaker sheet elsewhere: place a speaker, or open a lesson — once.
  const location = useLocation();
  const navigate = useNavigate();
  const visit = location.state as WeekVisit;
  useEffect(() => {
    if (!visit || !model) return;
    if (visit.place != null && model.speakerById.has(visit.place)) {
      setPanel(null);
      setPlacingId(visit.place);
      setPhoneTab("day");
    } else if (visit.lesson != null) {
      const l = model.week.lessons.find((x) => x.id === visit.lesson);
      if (l) {
        setDay(l.day);
        setPanel({ kind: "lesson", id: l.id, stage: visit.stage });
        requestAnimationFrame(() => document.querySelector(`[data-lesson-id="${l.id}"]`)?.scrollIntoView({ block: "center", inline: "center" }));
      }
    }
    navigate(".", { replace: true, state: null });
  }, [visit, model, navigate]);

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
      setPlacingId(null);
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
        if (lessonId != null) setPanel((p) => (p?.kind === "cell" ? { kind: "lesson", id: lessonId! } : p));
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
      openSpeaker: (id) => setPanel((p) => ({ kind: "speaker", id, back: p ?? undefined })),
    };
  }, [cmds, editionId, model, port, propose, run]);

  const onDrop = useCallback(
    (item: DragItem, target: DropTarget) => {
      if (!model || !cmds || !canEdit) return;
      const cell = (t: DropTarget): CellTarget | null =>
        t.kind === "cell" ? { day: t.day as Day, start_min: t.start, end_min: t.end, room_id: null } : t.kind === "lesson" ? { lesson_id: t.id } : null;
      if (item.kind === "speaker") {
        const t = cell(target);
        if (t) propose(item.id, t);
        return;
      }
      if (item.kind === "pitch") {
        const p = model.week.pitches.find((x) => x.id === item.id);
        const a = p && model.approachById.get(p.approach_id);
        if (!p || !a) return;
        if (target.kind === "pool") return void run(() => cmds.unpropose(p.id), "הוסר/ה מהמשבצת");
        const t = cell(target);
        if (!t || ("lesson_id" in t && t.lesson_id === p.lesson_id)) return;
        void run(async () => {
          await cmds.propose(a.speaker_id, t, a.owner_member_id === memberId || isAdmin ? "self" : "offer");
          await cmds.unpropose(p.id);
        }, "הועבר/ה למשבצת אחרת");
        return;
      }
      const l = model.week.lessons.find((x) => x.id === item.id);
      if (!l) return;
      if (target.kind === "pool") {
        // a reopen erases the speaker's stages: when any holds something, it is done from the panel, after it says what goes
        if (l.state === "closed" && (l.paid_at != null || reopenLoses(l).length > 0)) {
          setPanel({ kind: "lesson", id: l.id });
          setToast({ kind: "error", text: "לשיעור כבר יש שלבים, ופתיחה מחדש מוחקת אותם. פותחים מחדש מלוח השיעור, אחרי אישור." });
          return;
        }
        return void run(() => cmds.reopenLesson(l.id), "השיעור חזר לטיוטה");
      }
      if (target.kind === "cell") {
        const len = l.end_min - l.start_min;
        void run(() => cmds.moveLesson(l.id, { day: target.day as Day, start_min: target.start, end_min: target.start + len, room_id: l.room_id }), "השיעור הוזז");
      }
    },
    [model, cmds, canEdit, propose, run, memberId, isAdmin],
  );
  const drag = useMouseDrag(onDrop);

  const onCell = (d: Day, row: GridRow) => {
    if (placingId != null) propose(placingId, { day: d, start_min: row.start_min, end_min: row.end_min, room_id: null });
    else setPanel({ kind: "cell", day: d, row });
  };
  const onLesson = (id: number) => {
    const l = model?.week.lessons.find((x) => x.id === id);
    if (placingId != null && l?.state === "draft" && l.kind === "lesson") propose(placingId, { lesson_id: id });
    else {
      if (l && !wide) setDay(l.day);
      setPanel({ kind: "lesson", id });
      // the docked panel narrows the grid: keep the card that was opened in view
      if (wide) requestAnimationFrame(() => document.querySelector(`[data-lesson-id="${id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
    }
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
  const onDayPanel = (d: Day) => {
    setPlacingId(null);
    setPanel({ kind: "day", day: d });
  };
  const onRules = cmds ? (rules: GridRules) => run(() => cmds.setGridRules(rules), "כללי הרשת נשמרו").then(() => true) : undefined;
  const startPlacing = (speakerId: number) => {
    setPlacingId((cur) => (cur === speakerId ? null : speakerId));
    setPanel(null);
    if (!wide) setPhoneTab("day");
  };

  if (problem === "none") {
    return (
      <div className="mx-auto mt-8 max-w-lg rounded-xl border border-line bg-card p-5">
        <h2 className="mb-2 font-display text-lg font-semibold">עוד לא נפתח מחזור</h2>
        {me.global_admin ? (
          <>
            <p className="mb-4 text-ink-soft">פותחים את המחזור של השנה בהגדרות, ואז מוסיפים את הצוות.</p>
            <Link to="/settings/edition" className="inline-flex min-h-11 items-center rounded-lg bg-ink px-4 font-semibold text-paper hover:bg-ink/90">
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

  const placing = placingId != null ? (model.speakerById.get(placingId) ?? null) : null;
  // v14: the grid is coloured for a speaker without placing them too — while a speaker (or a pitch) is dragged, and while
  // a speaker's sheet stands beside the grid on a wide screen
  const draggedPitch = drag?.item.kind === "pitch" ? model.week.pitches.find((p) => p.id === drag.item.id) : undefined;
  const dragged = drag?.item.kind === "speaker" ? model.speakerById.get(drag.item.id) : draggedPitch && pitchSpeaker(model, draggedPitch);
  const lookAt = dragged ?? (wide && panel?.kind === "speaker" ? model.speakerById.get(panel.id) : undefined) ?? null;
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
            setPlacingId(null);
            store.select(Number(e.target.value));
          }}
          className="rounded-lg border border-line bg-card px-2 py-1 font-display text-lg font-semibold"
        >
          {editions.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
              {e.status === "archived" ? " (ארכיון)" : e.kind === "demo" ? " (הדגמה)" : ""}
            </option>
          ))}
        </select>
      ) : (
        <h2 className="font-display text-lg font-semibold">{model.week.edition.label}</h2>
      )}
      <div role="radiogroup" aria-label="עדשה" className="flex overflow-hidden rounded-lg border border-line">
        {LENSES.map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={lens === key} onClick={() => setLens(key)} className={`px-3 text-sm ${wide ? "py-1" : "min-h-11"} ${lens === key ? "bg-ink text-paper" : "bg-card text-ink-soft"}`}>
            {label}
          </button>
        ))}
      </div>
      {wide && !roomy && (
        <button type="button" onClick={() => setPoolOpen((v) => !v)} aria-pressed={poolOpen} className={`rounded-lg border px-3 py-1 text-sm ${poolOpen ? "border-ink bg-ink text-paper" : "border-line bg-card"}`}>
          מאגר המרצים
        </button>
      )}
      {/* on a phone the bottom bar has «אזהרות» */}
      {wide && (
        <button type="button" onClick={() => setPanel({ kind: "warnings" })} className="rounded-lg border border-line bg-card px-3 py-1 text-sm">
          אזהרות <span className={`tabular-nums ${warnCount ? "font-bold text-warn" : ""}`}>{warnCount}</span>
        </button>
      )}
      {/* v13: the week's closed lessons, women and men, in the cells' pink and sky — each day's own is in its header and panel */}
      <span className="inline-flex flex-wrap items-center gap-1 text-xs text-ink-soft tabular-nums" aria-label="השבוע כולו" data-week-balance>
        השבוע:{" "}
        <span className="rounded bg-need-f px-1.5 text-pink-900">{fmtCount(weekTotal.closed.f)} מרצות</span>{" "}
        <span className="rounded bg-need-m px-1.5 text-sky-900">{fmtCount(weekTotal.closed.m)} מרצים</span>
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
          <span className={`font-semibold tabular-nums ${count ? "text-ink" : "text-ink-faint"}`}>{count}</span>
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
          <div id="topic-matrix" className="mt-2 w-fit max-w-full overflow-x-auto rounded-xl border border-line bg-card p-3">
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
          className={`inline-flex items-center gap-1 rounded-full border ${wide ? "min-h-7 px-2" : "min-h-11 px-3"} ${onlyOwner === m.key ? "border-ink bg-ink text-paper" : "border-line bg-card text-ink-soft"}`}
        >
          <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: m.color }} />
          {onlyOwner === m.key ? `רק של ${m.name}` : m.name}
        </button>
      ))}
      {onlyOwner != null && (
        <button type="button" onClick={() => setOnlyOwner(null)} className={`px-1 text-ink-soft underline ${wide ? "" : "min-h-11"}`}>
          כולם
        </button>
      )}
    </div>
  );

  // The progress lens: last year's colours on the cards (always shown), and what the five dots are (folded: read once).
  const tones = (
    <ul aria-label="מקרא עדשת ההתקדמות" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
      {PROGRESS_LEGEND.map(([tone, label]) => (
        <li key={tone} className="inline-flex items-center gap-1">
          <span aria-hidden className={`size-3 rounded border border-line ${PROGRESS_TONE[tone]}`} />
          {label}
        </li>
      ))}
    </ul>
  );
  const dots = (
    <ul aria-label="הנקודות שעל הכרטיס" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
      <li>לפי הסדר: תשלום/הסעה · הודעה · מלווה · מקורות · מקראה</li>
      {(["done", "waiting", "problem", "open", "na"] as const).map((st) => (
        <li key={st} className="inline-flex items-center gap-1">
          <span aria-hidden className={`size-2.5 rounded-full border-2 ${STAGE_DOT[st]}`} />
          {STAGE_STATE_LABEL[st]}
        </li>
      ))}
      <li className="inline-flex items-center gap-1">
        <span aria-hidden className="size-2.5 rounded-full bg-bad" />
        לעדכן את המרצה
      </li>
    </ul>
  );
  const progressLegend =
    lens === "progress" &&
    (wide ? (
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {tones}
          <LegendToggle open={dotsOpen} onToggle={() => setDotsOpen((v) => !v)} controls="progress-dots">
            מה הנקודות?
          </LegendToggle>
        </div>
        {dotsOpen && (
          <div id="progress-dots" className="mt-1">
            {dots}
          </div>
        )}
      </div>
    ) : (
      <Fold size="sm" title="מקרא ההתקדמות">
        <div className="space-y-2">
          {tones}
          {dots}
        </div>
      </Fold>
    ));

  const legend = diversityLegend || ownerLegend || progressLegend;

  const placingBanner = placing && (
    <div role="status" className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm text-paper">
      <span>
        משבצים את <b>{displayName(placing)}</b> — בחרו משבצת {wide ? "ברשת" : "ביום"}
      </span>
      <button type="button" onClick={() => setPlacingId(null)} className="ms-auto rounded-md border border-paper/50 px-2 py-0.5">
        ביטול
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {toolbar}
      {legend}
      {placingBanner}

      {wide ? (
        <div className="flex gap-3" style={{ height: legend ? "calc(100dvh - 12rem)" : "calc(100dvh - 9.5rem)" }}>
          <div className="min-w-0 flex-1 overflow-auto rounded-lg" data-autoscroll>
            <GridDesktop model={model} lens={lens} owners={owners} placing={placing} lookAt={lookAt} overKey={drag?.overKey ?? null} onCell={onCell} onLesson={onLesson} onMemorial={onMemorial} onDayPanel={onDayPanel} />
          </div>
          {/* an open panel takes the pool's column, so the grid keeps its width */}
          {(roomy || poolOpen) && !panel && (
            <aside className={roomy ? "w-80 shrink-0" : "fixed inset-y-0 end-0 z-30 w-80 border-s border-line bg-paper p-3 pt-16 shadow-2xl"} aria-label="מאגר">
              <Pool model={model} me={memberId} canEdit={canEdit} placingId={placingId} onPlace={startPlacing} onOpen={(id) => setPanel({ kind: "speaker", id })} onCreate={(name) => setPanel({ kind: "create", name })} dropTarget={!!drag && drag.item.kind !== "speaker"} />
            </aside>
          )}
        </div>
      ) : (
        <>
          <div className="pb-16">
            {phoneTab === "day" ? (
              <DayView model={model} lens={lens} owners={owners} day={day} onDay={setDay} placing={placing} lookAt={lookAt} onCell={onCell} onLesson={onLesson} onMemorial={onMemorial} onDayPanel={onDayPanel} />
            ) : (
              <div style={{ height: "calc(100dvh - 12rem)" }}>
                <Pool model={model} me={memberId} canEdit={canEdit} placingId={placingId} onPlace={startPlacing} onOpen={(id) => setPanel({ kind: "speaker", id })} onCreate={(name) => setPanel({ kind: "create", name })} />
              </div>
            )}
          </div>
          <nav aria-label="ניווט" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-card">
            {(
              [
                ["day", "יום"],
                ["pool", "מאגר"],
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" aria-current={phoneTab === key ? "page" : undefined} onClick={() => setPhoneTab(key)} className={`py-3 text-sm font-semibold ${phoneTab === key ? "text-accent" : "text-ink-soft"}`}>
                {label}
              </button>
            ))}
            <button type="button" onClick={() => setPanel({ kind: "warnings" })} className="py-3 text-sm font-semibold text-ink-soft">
              אזהרות {warnCount > 0 && <span className="text-warn">{warnCount}</span>}
            </button>
          </nav>
        </>
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
              key={`${l.id}:${panel?.kind === "lesson" ? (panel.stage ?? "") : ""}`}
              port={port}
              week={model.week}
              lessonId={l.id}
              actor={actor}
              focus={panel?.kind === "lesson" ? panel.stage : null}
              notify={(kind, text) => setToast({ kind, text })}
              clear={() => setToast(null)}
              reload={reload}
            />
          )}
        />
      )}
      {panel?.kind === "cell" && <CellPanel model={model} me={memberId} day={panel.day} row={panel.row} canEdit={canEdit} actions={actions} onClose={() => setPanel(null)} wide={wide} />}
      {panel?.kind === "speaker" && (
        <SpeakerSheet
          key={panel.id}
          port={port}
          me={me}
          week={model.week}
          speakerId={panel.id}
          wide={wide}
          onClose={() => setPanel(null)}
          onBack={panel.back ? () => setPanel(panel.back ?? null) : undefined}
          backLabel={panel.back ? BACK_LABEL[panel.back.kind] : undefined}
          notify={(kind, text) => setToast({ kind, text })}
          clear={() => setToast(null)}
          reload={reload}
          onPlace={startPlacing}
          onLesson={onLesson}
        />
      )}
      {panel?.kind === "create" && (
        <CreateSpeaker
          port={port}
          me={me}
          week={model.week}
          initialName={panel.name}
          wide={wide}
          onClose={() => setPanel(null)}
          onOpen={(id, name) => setPanel({ kind: "speaker", id, back: { kind: "create", name } })}
          onCreated={(id) => setPanel({ kind: "speaker", id })}
          notify={(kind, text) => setToast({ kind, text })}
          clear={() => setToast(null)}
          reload={reload}
        />
      )}
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
        <div role="alertdialog" aria-label="המרצה בטיפול חבר/ת צוות" className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-card p-5 shadow-xl">
            <p className="mb-1 font-semibold">{displayName(model.speakerById.get(offer.speakerId)!)} בטיפול {offer.owner}</p>
            <p className="mb-4 text-sm text-ink-soft">אפשר להציע ל{offer.owner} את המשבצת הזו. הבעלות על הפנייה לא משתנה.</p>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-paper"
                onClick={() => {
                  const o = offer;
                  setOffer(null);
                  propose(o.speakerId, o.target, "offer");
                }}
              >
                הצעה ל{offer.owner}
              </button>
              <button type="button" className="rounded-lg border border-line px-3 py-1.5 text-sm" onClick={() => setOffer(null)}>
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {drag && (
        <div aria-hidden className="pointer-events-none fixed z-50 rounded-md bg-ink px-2 py-1 text-xs text-paper shadow-lg" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          {drag.label || "…"}
        </div>
      )}

      {toast && (
        <div role={toast.kind === "error" ? "alert" : "status"} className={`fixed inset-x-0 z-50 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-xl px-4 py-2.5 text-sm shadow-xl ${wide ? "bottom-6" : "bottom-16"} ${toast.kind === "error" ? "bg-bad text-paper" : "bg-ink text-paper"}`}>
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              className="rounded-md border border-paper/50 px-2 py-0.5 font-semibold"
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

/** A legend's «more» on a wide screen (the topics «לפי ימים», the progress dots): a small disclosure at the row's end. */
function LegendToggle({ open, onToggle, controls, children }: { open: boolean; onToggle: () => void; controls: string; children: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="inline-flex min-h-7 items-center gap-1 rounded-md px-1.5 text-xs font-semibold text-ink-soft hover:bg-line/50 hover:text-ink"
    >
      {children}
      <span aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`}>
        ▾
      </span>
    </button>
  );
}
