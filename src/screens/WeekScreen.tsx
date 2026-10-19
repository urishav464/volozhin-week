// The week: the grid (desktop) or the day view (phone/tablet), the pool, the
// panels, and every command — through the DataPort, so the demo and the real
// database behave the same (docs/CONTRACT.md).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { type CellTarget, CommandError, type LessonPatch, type ReshapeOp } from "../data/commands";
import type { DataPort } from "../data/port";
import type { Me } from "../data/types";
import { displayName } from "../domain/names";
import type { Day } from "../domain/time";
import type { Edition, GridRow, Week } from "../domain/types";
import { errorMessage } from "../errors";
import { DayView } from "../grid/DayView";
import { GridDesktop } from "../grid/GridDesktop";
import type { Lens } from "../grid/LessonCard";
import { type DragItem, type DropTarget, useMouseDrag } from "../grid/dnd";
import { buildModel } from "../grid/model";
import { CellPanel, LessonPanel, type PanelActions } from "../grid/Panels";
import { Pool } from "../grid/Pool";
import { WarningsPanel } from "../grid/WarningsPanel";
import { useMedia } from "../lib/useMedia";

type Panel = { kind: "lesson"; id: number } | { kind: "cell"; day: Day; row: GridRow } | { kind: "warnings" } | null;
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
  const [editions, setEditions] = useState<Edition[]>([]);
  const [editionId, setEditionId] = useState<number | null>(null);
  const [week, setWeek] = useState<Week | null>(null);
  const [problem, setProblem] = useState<"none" | "error" | null>(null);
  const [lens, setLens] = useState<Lens>("diversity");
  const [showNight, setShowNight] = useState(true);
  const [day, setDay] = useState<Day>(0);
  const [placingId, setPlacingId] = useState<number | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [offer, setOffer] = useState<Offer>(null);
  const [phoneTab, setPhoneTab] = useState<"day" | "pool">("day");

  useEffect(() => {
    port
      .editions()
      .then((list) => {
        setEditions(list);
        const pick = list.find((e) => e.status !== "archived") ?? list[0];
        if (pick) setEditionId(pick.id);
        else setProblem("none");
      })
      .catch(() => setProblem("error"));
  }, [port]);

  const reload = useCallback(async () => {
    if (editionId == null) return;
    try {
      setWeek(await port.loadWeek(editionId));
    } catch {
      setProblem("error");
    }
  }, [port, editionId]);

  useEffect(() => {
    if (editionId == null) return;
    void reload();
    return port.subscribe(editionId, () => void reload());
  }, [port, editionId, reload]);

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
  const membership = me.memberships.find((m) => m.edition_id === editionId) ?? me.memberships.find((m) => m.edition_id == null);
  const memberId = membership?.member_id ?? -1;
  const role = me.global_admin ? "admin" : (membership?.role ?? "logistics");
  const isAdmin = role === "admin";
  const canEdit = role !== "logistics";
  const cmds = useMemo(() => (editionId != null ? port.commands(editionId) : null), [port, editionId]);

  /** Run a command, reload, and say what happened (or why not). */
  const run = useCallback(
    async (fn: () => Promise<unknown>, ok?: string, undo?: () => Promise<void>) => {
      try {
        await fn();
        await reload();
        if (ok) setToast({ kind: "ok", text: ok, undo });
      } catch (e) {
        const code = e instanceof CommandError ? e.code : null;
        setToast({ kind: "error", text: errorMessage(code) });
        if (code === "stale") await reload();
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
      void run(
        async () => {
          pitchId = (await cmds.propose(speakerId, target, mode)).pitch_id;
        },
        `${s ? displayName(s) : "המרצה"} ${mode === "offer" ? "הוצע/ה לאחראי/ת" : "סומן/ה למשבצת"}`,
        async () => {
          if (pitchId != null) await run(() => cmds.unpropose(pitchId!), "בוטל");
        },
      );
    },
    [model, cmds, memberId, run],
  );

  const actions: PanelActions | null = useMemo(() => {
    if (!cmds) return null;
    return {
      propose,
      unpropose: (id) => void run(() => cmds.unpropose(id), "הוסר/ה מהמשבצת"),
      setPitch: (id, state) => void run(() => cmds.setPitch(id, state), state === "declined" ? "סומן/ה כמסרב/ת" : "עודכן"),
      close: (id) => void run(() => cmds.closeLesson(id), "השיעור נסגר"),
      reopen: (id) => void run(() => cmds.reopenLesson(id), "השיעור חזר לטיוטה"),
      update: (id, version, patch: LessonPatch) => void run(() => cmds.updateLesson(id, version, patch), "נשמר"),
      reshape: (d, rowStart, op: ReshapeOp) => {
        setPanel(null);
        void run(() => cmds.reshape(d, rowStart, op), "המשבצת עוצבה מחדש");
      },
    };
  }, [cmds, propose, run]);

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
      if (target.kind === "pool") return void run(() => cmds.reopenLesson(l.id), "השיעור חזר לטיוטה");
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
    }
  };
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
  const openLesson = panel?.kind === "lesson" ? model.week.lessons.find((l) => l.id === panel.id) : undefined;
  const warnCount = model.warnings.filter((w) => w.severity === "warn").length;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {editions.length > 1 ? (
        <select
          aria-label="מחזור"
          value={editionId ?? ""}
          onChange={(e) => {
            setPanel(null);
            setPlacingId(null);
            setWeek(null);
            setEditionId(Number(e.target.value));
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
          <button key={key} type="button" role="radio" aria-checked={lens === key} onClick={() => setLens(key)} className={`px-3 py-1 text-sm ${lens === key ? "bg-ink text-paper" : "bg-card text-ink-soft"}`}>
            {label}
          </button>
        ))}
      </div>
      {wide && !roomy && (
        <button type="button" onClick={() => setPoolOpen((v) => !v)} aria-pressed={poolOpen} className={`rounded-lg border px-3 py-1 text-sm ${poolOpen ? "border-ink bg-ink text-paper" : "border-line bg-card"}`}>
          מאגר המרצים
        </button>
      )}
      {wide && (
        <button type="button" onClick={() => setShowNight((v) => !v)} aria-pressed={showNight} className="rounded-lg border border-line bg-card px-3 py-1 text-sm">
          {showNight ? "הסתרת הלילה" : "הצגת הלילה"}
        </button>
      )}
      <button type="button" onClick={() => setPanel({ kind: "warnings" })} className="rounded-lg border border-line bg-card px-3 py-1 text-sm">
        אזהרות <span className={`tabular-nums ${warnCount ? "font-bold text-warn" : ""}`}>{warnCount}</span>
      </button>
    </div>
  );

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
      {placingBanner}

      {wide ? (
        <div className="flex gap-3" style={{ height: "calc(100dvh - 9.5rem)" }}>
          <div className="min-w-0 flex-1 overflow-auto rounded-lg" data-autoscroll>
            <GridDesktop model={model} lens={lens} showNight={showNight} placing={placing} overKey={drag?.overKey ?? null} onCell={onCell} onLesson={onLesson} />
          </div>
          {(roomy || poolOpen) && (
            <aside className={roomy ? "w-80 shrink-0" : "fixed inset-y-0 end-0 z-30 w-80 border-s border-line bg-paper p-3 pt-16 shadow-2xl"} aria-label="מאגר">
              <Pool model={model} me={memberId} canEdit={canEdit} placingId={placingId} onPlace={startPlacing} dropTarget={!!drag && drag.item.kind !== "speaker"} />
            </aside>
          )}
        </div>
      ) : (
        <>
          <div className="pb-16">
            {phoneTab === "day" ? (
              <DayView model={model} lens={lens} day={day} onDay={setDay} placing={placing} onCell={onCell} onLesson={onLesson} />
            ) : (
              <div style={{ height: "calc(100dvh - 12rem)" }}>
                <Pool model={model} me={memberId} canEdit={canEdit} placingId={placingId} onPlace={startPlacing} />
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

      {openLesson && <LessonPanel model={model} lesson={openLesson} me={memberId} isAdmin={isAdmin} canEdit={canEdit} actions={actions} onClose={() => setPanel(null)} wide={wide} />}
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
