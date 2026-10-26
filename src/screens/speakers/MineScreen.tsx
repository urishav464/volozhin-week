// «המרצים שלי» (/mine) — phone first, in two tabs. «שלי»: the speakers I handle in the chosen edition, grouped by
// the next step (src/domain/mine.ts), with one primary button per row for that step. A hand-over offered to me comes
// first; then the call («לשיחה» opens the speaker sheet at the call: its points and its result), the instructor's
// approval once they agreed (a chip; the global admin approves right there), and «לסגור שעה». Once a speaker teaches,
// each closed lesson is a row of its own, in its next stage's group (תשלום/הסעה · לעדכן את המרצה · לשלוח סיכום ·
// חסר מלווה · חסרים מקורות), with the lesson's five dots. The whole row opens the speaker sheet (its buttons aside);
// «שבץ», «לסגירת השעה» and the lesson's step go to the week, the lesson panel open at that stage. After a step — a
// tap in the row or the call's result in the sheet — the row moves to another group, and the focus follows it there.
// «כל הצוות» (/mine/team): every handler's speakers (TeamBoard.tsx).
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { MINE_GROUPS, type MineRow, mySpeakers, nextStep } from "../../domain/mine";
import { byGender, displayName } from "../../domain/names";
import { readerFilesOf, requestText, type StageKey } from "../../domain/stages";
import { DAY_NAMES, fmt, fmtRange } from "../../domain/time";
import type { Week } from "../../domain/types";
import { statusLabel, vettingLabel } from "../../lib/labels";
import { useMedia } from "../../lib/useMedia";
import { Chip, ReconfirmDot, StageDots } from "../../grid/bits";
import { Button, Panel, useRunner } from "../settings/kit";
import { actorIn, useWeekStore } from "../weekStore";
import { CreateSpeaker } from "./CreateSpeaker";
import { EditionSelect, useToast } from "./parts";
import { SpeakerSheet } from "./SpeakerSheet";
import { TeamBoard } from "./TeamBoard";

/** The tabs, by the address: /mine and /mine/team. */
const TABS = [
  { key: "mine", to: "/mine", label: "שלי" },
  { key: "team", to: "/mine/team", label: "כל הצוות" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** `back`: «מרצה חדש/ה» with the name typed, when a «ייתכן שזה…» match was opened from it. */
/** `back`: «מרצה חדש/ה» with the name typed, when a «ייתכן שזה…» match was opened from it. `focus`: open at the call. */
type Open = { kind: "speaker"; id: number; back?: Open; focus?: "call" } | { kind: "create"; name?: string } | null;

/** The speaker's row (its name button) — in whatever group it is now — or the heading, when it left the list (or sits in a closed fold). */
function focusRow(speakerId: number) {
  requestAnimationFrame(() => {
    const rows = document.querySelectorAll<HTMLElement>(`[data-speaker-id="${speakerId}"] button`);
    const row = [...rows].find((el) => el.getClientRects().length > 0);
    (row ?? document.getElementById("mine-title"))?.focus();
  });
}

export function MineScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const wide = useMedia("(min-width: 1024px)");
  const navigate = useNavigate();
  const { tab } = useParams();
  const { notify, clear, node } = useToast();
  const { busy, run } = useRunner(notify, clear);
  const [open, setOpen] = useState<Open>(null);
  const tabRefs = useRef(new Map<TabKey, HTMLButtonElement>());
  const actor = actorIn(me, week?.edition);
  const groups = useMemo(() => (week ? mySpeakers(week, actor.memberId) : null), [week, actor.memberId]);

  const current: TabKey | null = tab === undefined ? "mine" : tab === "team" ? "team" : null;
  if (!current) return <Navigate to="/mine" replace />;
  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!week || !groups) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  const total = [...groups.values()].reduce((n, rows) => n + rows.length, 0);
  const names = new Map(week.team.map((t) => [t.id, t.display_name]));
  /** A command, then the week again — and the focus to the speaker's row in its new group. */
  const act = async (key: string, fn: () => Promise<unknown>, ok: string, speakerId?: number) => {
    await run(key, fn, ok);
    await store.reload();
    if (speakerId != null) focusRow(speakerId);
  };
  const toWeek = (state: { place?: number; lesson?: number; stage?: StageKey }) => navigate("/", { state });
  const go = (to: TabKey) => {
    clear(); // the last tab's news is not this tab's
    navigate(TABS.find((t) => t.key === to)!.to);
    tabRefs.current.get(to)?.focus();
  };
  // Arrow keys move between the tabs (right-to-left: ← is the next one), Home/End to the ends.
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.key === current);
    const next = { ArrowLeft: i + 1, ArrowRight: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    go(TABS[(next + TABS.length) % TABS.length].key);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="mine-title" tabIndex={-1} className="font-display text-2xl font-extrabold outline-none">
          המרצים שלי
        </h2>
        <EditionSelect />
        {actor.canEdit && (
          <Button kind="primary" className="ms-auto" onClick={() => setOpen({ kind: "create" })}>
            + מרצה חדש/ה
          </Button>
        )}
      </div>

      <div role="tablist" aria-label="תצוגת המרצים" onKeyDown={onKey} className="flex gap-1 border-b border-line">
        {TABS.map((t) => {
          const selected = t.key === current;
          return (
            <button
              key={t.key}
              ref={(el) => {
                if (el) tabRefs.current.set(t.key, el);
              }}
              type="button"
              role="tab"
              id={`mine-tab-${t.key}`}
              aria-selected={selected}
              aria-controls="mine-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => go(t.key)}
              className={`-mb-px min-h-11 rounded-t-lg border-b-2 px-4 font-semibold transition-colors ${
                selected ? "border-ink text-ink" : "border-transparent text-ink-soft hover:bg-line/50 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="mine-panel" aria-labelledby={`mine-tab-${current}`} className="space-y-4">
        {current === "team" ? (
          <TeamBoard week={week} global={actor.global} onOpen={(id) => setOpen({ kind: "speaker", id })} />
        ) : total === 0 ? (
          <Panel title="עוד אין מרצים בטיפולך במחזור הזה">
            <p className="text-ink-soft">
              {actor.canEdit
                ? "לוקחים מרצה מהמאגר («אני מטפל/ת» בכרטיס, או «שבץ» למשבצת), או מוסיפים מרצה חדש/ה."
                : "במחזור הזה אין לך תפקיד שמטפל במרצים."}
            </p>
          </Panel>
        ) : (
          MINE_GROUPS.map(({ group, label }) => {
            const rows = groups.get(group) ?? [];
            if (rows.length === 0) return null;
            return (
              <section key={group} aria-label={label} className="space-y-2">
                <h3 className="flex items-baseline gap-2 font-display text-lg font-semibold">
                  {label} <span className="text-sm font-normal text-ink-soft tabular-nums">{rows.length}</span>
                </h3>
                <ul className="space-y-2">
                  {rows.map((r) => (
                    <MineItem
                      key={`${r.approach.id}:${r.lesson?.id ?? ""}`}
                      row={r}
                      week={week}
                      names={names}
                      canEdit={actor.canEdit}
                      global={actor.global}
                      busy={busy}
                      onOpen={() => setOpen({ kind: "speaker", id: r.speaker.id })}
                      onCall={() => setOpen({ kind: "speaker", id: r.speaker.id, focus: "call" })}
                      act={act}
                      port={port}
                      toWeek={toWeek}
                    />
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>

      {open?.kind === "speaker" && (
        <SpeakerSheet
          key={open.id}
          port={port}
          me={me}
          week={week}
          speakerId={open.id}
          focus={open.focus}
          wide={wide}
          onClose={() => {
            setOpen(null);
            focusRow(open.id); // back to the row — in the group the sheet's step moved it to
          }}
          onBack={open.back ? () => setOpen(open.back ?? null) : undefined}
          backLabel={open.back ? "מרצה חדש/ה" : undefined}
          notify={notify}
          clear={clear}
          reload={store.reload}
          onPlace={(id) => toWeek({ place: id })}
          onLesson={(id) => toWeek({ lesson: id })}
        />
      )}
      {open?.kind === "create" && (
        <CreateSpeaker
          port={port}
          me={me}
          week={week}
          initialName={open.name}
          wide={wide}
          onClose={() => setOpen(null)}
          onOpen={(id, name) => setOpen({ kind: "speaker", id, back: { kind: "create", name } })}
          onCreated={(id) => setOpen({ kind: "speaker", id })}
          notify={notify}
          clear={clear}
          reload={store.reload}
        />
      )}
      {node}
    </div>
  );
}

function MineItem({
  row,
  week,
  names,
  canEdit,
  global,
  busy,
  onOpen,
  onCall,
  act,
  port,
  toWeek,
}: {
  row: MineRow;
  week: Week;
  names: Map<number, string>;
  canEdit: boolean;
  /** A global admin: approves a speaker who agreed, and decides a waiting request, from the row. */
  global: boolean;
  busy: string | null;
  onOpen: () => void;
  /** The sheet, open at the call. */
  onCall: () => void;
  act: (key: string, fn: () => Promise<unknown>, ok: string, speakerId?: number) => Promise<void>;
  port: DataPort;
  toWeek: (state: { place?: number; lesson?: number; stage?: StageKey }) => void;
}) {
  const { speaker: s, approach: a, group, closed, live, lesson } = row;
  const ed = week.edition.id;
  const g = s.gender;
  const step = nextStep(group);
  // Where they are pitched: one cell by its time, more by their number.
  const first = live.length ? week.lessons.find((l) => l.id === live[0].lesson_id) : undefined;
  const pitched =
    live.length === 0 ? "" : ` · ${byGender(g, "מוצע", "מוצעת")} ${live.length === 1 && first ? `ב${DAY_NAMES[first.day]} ${fmt(first.start_min)}` : `ב-${live.length} משבצות`}`;
  // Before they agree the approval is a fact to know (closing waits for it); once they agreed it is the row's chip.
  const vetting = s.vetted === "approved" ? "" : ` · ${s.vetted === "pending" ? `${byGender(g, "ממתין", "ממתינה")} לאישור המדריך/ה` : vettingLabel("rejected", g)}`;
  const sub = (() => {
    switch (group) {
      case "offered":
        return `${names.get(a.owner_member_id ?? -1) ?? "חבר/ת צוות"} מציע/ה להעביר אליך את הטיפול`;
      case "to_call":
      case "retry":
      case "awaiting":
        return `${statusLabel(a.status, g)}${pitched}${vetting}`;
      case "agreed":
        return `${statusLabel("positive", g)}${pitched}${s.vetted === "rejected" && s.vetted_note ? ` · «${s.vetted_note}»` : ""}`;
      case "to_schedule":
        return `${statusLabel("positive", g)}${pitched || " · עוד לא נבחרה שעה"}`;
      case "payment":
      case "reconfirm":
      case "send":
      case "escort":
      case "sources":
      case "closed": {
        const l = lesson ?? closed[0];
        if (!l) return null;
        const detail =
          group === "payment"
            ? l.approval === "rejected"
              ? `המדריך/ה לא אישר/ה: ${requestText(l) ?? ""}${l.approval_note ? ` («${l.approval_note}»)` : ""}`
              : (requestText(l) ?? "") // the chip beside it says «ממתין לאישור»
            : group === "reconfirm"
              ? "השיעור השתנה אחרי שההודעה נשלחה"
              : group === "send"
                ? "ההודעה עוד לא נשלחה"
                : group === "escort"
                  ? "אין מלווה"
                  : group === "sources"
                    ? l.sources_kind === "pending"
                      ? "המקורות עוד לא התקבלו"
                      : readerFilesOf(week, l.id).word > 0
                        ? "מסומן למקראה, והגיע רק Word: צריך PDF"
                        : readerFilesOf(week, l.id).unread > 0
                          ? "מסומן למקראה, והקבצים שהועלו לא נקראו: צריך קובץ אחר"
                          : "מסומן למקראה, ועוד לא הועלה קובץ"
                    : null;
        return (
          <>
            <span className="flex flex-wrap items-center gap-x-1.5">
              <span>
                {DAY_NAMES[l.day]} <bdi>{fmtRange(l.start_min, l.end_min)}</bdi>
                {l.title ? ` · ${l.title}` : " · כותרת: TBD"}
              </span>
              <StageDots lesson={l} week={week} />
              {l.needs_reconfirm && <ReconfirmDot />}
            </span>
            {detail && <span className="block">{detail}</span>}
          </>
        );
      }
      case "declined":
        return statusLabel("declined", g);
    }
  })();
  const k = (what: string) => `${what}:${a.id}`;
  const primary = (() => {
    if (!canEdit) return null;
    switch (step) {
      case "accept":
        return (
          <>
            <Button kind="primary" busy={busy === k("accept")} onClick={() => void act(k("accept"), () => port.speakers.answerHandOver(ed, a.id, true), "הטיפול עבר אליך", s.id)}>
              קבלת הטיפול
            </Button>
            <Button busy={busy === k("decline")} onClick={() => void act(k("decline"), () => port.speakers.answerHandOver(ed, a.id, false), "ההצעה נדחתה", s.id)}>
              דחיית ההצעה
            </Button>
          </>
        );
      case "call":
        return (
          <Button kind="primary" onClick={onCall}>
            לשיחה
          </Button>
        );
      case "vet":
        // waiting for the instructor: a chip, not a dead button — and the global admin approves right here
        if (s.vetted === "rejected") return <Chip tone="bad">{vettingLabel("rejected", g)}</Chip>;
        return (
          <>
            <Chip tone="warn">{byGender(g, "ממתין", "ממתינה")} לאישור</Chip>
            {global && (
              <Button
                kind="primary"
                aria-label={`אישור ${displayName(s)}`}
                busy={busy === k("vet")}
                onClick={() => void act(k("vet"), () => port.speakers.vet([s.id], "approved", null), `${displayName(s)} ${byGender(g, "אושר", "אושרה")}`, s.id)}
              >
                אישור
              </Button>
            )}
          </>
        );
      case "close":
        // pitched already: to that cell's panel, where the time is closed; else placing them on the week
        return first ? (
          <Button kind="primary" onClick={() => toWeek({ lesson: first.id })}>
            לסגירת השעה
          </Button>
        ) : (
          <Button kind="primary" onClick={() => toWeek({ place: s.id })}>
            שבץ
          </Button>
        );
      case "payment": {
        const l = lesson!;
        if (l.approval === "rejected") {
          return (
            <Button kind="primary" onClick={() => toWeek({ lesson: l.id, stage: "pay" })}>
              לעדכון הבקשה
            </Button>
          );
        }
        // waiting for the instructor: a chip, not a dead button — and the global admin decides right here
        return (
          <>
            <Chip tone="warn">ממתין לאישור</Chip>
            {global && (
              <Button
                kind="primary"
                aria-label={`אישור הבקשה של ${displayName(s)}`}
                busy={busy === k(`decide:${l.id}`)}
                onClick={() =>
                  void act(k(`decide:${l.id}`), () => port.commands(ed).decidePayments([{ lesson_id: l.id, version: l.version }], "approved", null), "הבקשה אושרה", s.id)
                }
              >
                אישור
              </Button>
            )}
          </>
        );
      }
      case "reconfirm":
        return (
          <Button kind="primary" onClick={() => toWeek({ lesson: lesson!.id, stage: "msg" })}>
            לעדכון המרצה
          </Button>
        );
      case "send":
        return (
          <Button kind="primary" onClick={() => toWeek({ lesson: lesson!.id, stage: "msg" })}>
            לשליחת הסיכום
          </Button>
        );
      case "escort":
        return (
          <Button kind="primary" onClick={() => toWeek({ lesson: lesson!.id, stage: "escort" })}>
            לשיבוץ מלווה
          </Button>
        );
      case "sources":
        return (
          <Button kind="primary" onClick={() => toWeek({ lesson: lesson!.id, stage: "sources" })}>
            לעדכון המקורות
          </Button>
        );
      case "lesson":
        return <Button onClick={() => toWeek({ lesson: (lesson ?? closed[0]).id })}>לשיעור</Button>;
      default:
        return null;
    }
  })();
  return (
    // The whole card opens the sheet (the name button's ::after covers it); the row's own buttons sit above it.
    <li data-speaker-id={s.id} className="relative flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-card px-3 py-2 shadow-sm hover:border-ink-soft">
      <div className="min-w-0 flex-1 basis-44">
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex min-h-11 items-center gap-1.5 text-start font-semibold underline decoration-ink-faint underline-offset-4 after:absolute after:inset-0 after:rounded-xl after:content-[''] hover:decoration-ink"
        >
          {displayName(s)}
          <span aria-hidden className="inline-block text-ink-soft">
            ‹
          </span>
        </button>
        <p className="text-sm text-ink-soft break-words">{sub}</p>
      </div>
      {primary && <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-1.5">{primary}</div>}
    </li>
  );
}
