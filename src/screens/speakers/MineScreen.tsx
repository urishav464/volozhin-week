// «המרצים שלי» (/mine) — phone first: the speakers I handle in the chosen
// edition, grouped by the next step (src/domain/mine.ts), with one primary
// button per row for that step. A hand-over offered to me comes first. Once a
// speaker teaches, each closed lesson is a row of its own, in its next stage's
// group (תשלום/הסעה · לעדכן את המרצה · לשלוח סיכום · חסר מלווה · חסרים
// מקורות), with the lesson's five dots. The whole row opens the speaker sheet
// (its buttons aside); «שבץ» and the lesson's step go to the week, the lesson
// panel open at that stage. After a one-tap step the row moves to another
// group, and the focus follows it there.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { MINE_GROUPS, type MineRow, mySpeakers, nextStep } from "../../domain/mine";
import { byGender, displayName } from "../../domain/names";
import { readerFilesOf, requestText, type StageKey } from "../../domain/stages";
import { DAY_NAMES, fmtRange } from "../../domain/time";
import type { Week } from "../../domain/types";
import { statusLabel } from "../../lib/labels";
import { useMedia } from "../../lib/useMedia";
import { Chip, ReconfirmDot, StageDots } from "../../grid/bits";
import { Button, Panel, useRunner } from "../settings/kit";
import { actorIn, useWeekStore } from "../weekStore";
import { CreateSpeaker } from "./CreateSpeaker";
import { EditionSelect, useToast } from "./parts";
import { SpeakerSheet } from "./SpeakerSheet";

/** `back`: «מרצה חדש/ה» with the name typed, when a «ייתכן שזה…» match was opened from it. */
type Open = { kind: "speaker"; id: number; back?: Open } | { kind: "create"; name?: string } | null;

export function MineScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const wide = useMedia("(min-width: 1024px)");
  const navigate = useNavigate();
  const { notify, clear, node } = useToast();
  const { busy, run } = useRunner(notify, clear);
  const [open, setOpen] = useState<Open>(null);
  const actor = actorIn(me, week?.edition);
  const groups = useMemo(() => (week ? mySpeakers(week, actor.memberId) : null), [week, actor.memberId]);

  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!week || !groups) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  const total = [...groups.values()].reduce((n, rows) => n + rows.length, 0);
  const names = new Map(week.team.map((t) => [t.id, t.display_name]));
  /** A command, then the week again — and the focus to the speaker's row in its new group (or the heading, when it left the list). */
  const act = async (key: string, fn: () => Promise<unknown>, ok: string, speakerId?: number) => {
    await run(key, fn, ok);
    await store.reload();
    if (speakerId == null) return;
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-speaker-id="${speakerId}"] button`);
      (row ?? document.getElementById("mine-title"))?.focus();
    });
  };
  const toWeek = (state: { place?: number; lesson?: number; stage?: StageKey }) => navigate("/", { state });

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

      {total === 0 ? (
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

      {open?.kind === "speaker" && (
        <SpeakerSheet
          key={open.id}
          port={port}
          me={me}
          week={week}
          speakerId={open.id}
          wide={wide}
          onClose={() => setOpen(null)}
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
  act,
  port,
  toWeek,
}: {
  row: MineRow;
  week: Week;
  names: Map<number, string>;
  canEdit: boolean;
  /** A global admin: approves a waiting speaker from the row. */
  global: boolean;
  busy: string | null;
  onOpen: () => void;
  act: (key: string, fn: () => Promise<unknown>, ok: string, speakerId?: number) => Promise<void>;
  port: DataPort;
  toWeek: (state: { place?: number; lesson?: number; stage?: StageKey }) => void;
}) {
  const { speaker: s, approach: a, group, closed, live, lesson } = row;
  const ed = week.edition.id;
  const vetted = s.vetted === "approved";
  const step = nextStep(group);
  const cells = (n: number) => (n === 1 ? "במשבצת אחת" : `ב-${n} משבצות`);
  // A step that waits for the instructor's approval shows that instead of a dead button (below); elsewhere it is said here.
  const gated = !vetted && (step === "approached" || step === "positive");
  const waiting = vetted || gated ? "" : ` · ${byGender(s.gender, "ממתין", "ממתינה")} לאישור המדריך/ה`;
  const sub = (() => {
    switch (group) {
      case "offered":
        return `${names.get(a.owner_member_id ?? -1) ?? "חבר/ת צוות"} מציע/ה להעביר אליך את הטיפול`;
      case "to_approach":
        return `עוד לא פנו${waiting}`;
      case "awaiting":
        return `${statusLabel(a.status, s.gender)}${live.length ? ` · ${byGender(s.gender, "מוצע", "מוצעת")} ${cells(live.length)}` : ""}${waiting}`;
      case "to_schedule":
        return `${statusLabel("positive", s.gender)} · ${live.length ? `${byGender(s.gender, "מוצע", "מוצעת")} ${cells(live.length)}` : "עוד לא נבחרה שעה"}${waiting}`;
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
        return statusLabel("declined", s.gender);
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
      case "approached":
      case "positive":
        if (gated) {
          return (
            <>
              <Chip tone="warn">{byGender(s.gender, "ממתין", "ממתינה")} לאישור</Chip>
              {global && (
                <Button
                  kind="primary"
                  aria-label={`אישור ${displayName(s)}`}
                  busy={busy === k("vet")}
                  onClick={() => void act(k("vet"), () => port.speakers.vet([s.id], "approved", null), `${displayName(s)} ${byGender(s.gender, "אושר", "אושרה")}`, s.id)}
                >
                  אישור
                </Button>
              )}
            </>
          );
        }
        return step === "approached" ? (
          <Button kind="primary" busy={busy === k("approached")} onClick={() => void act(k("approached"), () => port.speakers.setStatus(ed, a.id, a.version, "approached"), `עודכן: ${displayName(s)} · פנו`, s.id)}>
            פניתי
          </Button>
        ) : (
          <Button
            kind="primary"
            busy={busy === k("positive")}
            onClick={() => void act(k("positive"), () => port.speakers.setStatus(ed, a.id, a.version, "positive"), `עודכן: ${displayName(s)} ${statusLabel("positive", s.gender)}`, s.id)}
          >
            {statusLabel("positive", s.gender)}
          </Button>
        );
      case "schedule":
        return (
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
