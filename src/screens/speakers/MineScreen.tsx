// «המרצים שלי» (/mine) — phone first: the speakers I handle in the chosen
// edition, grouped by the next step (src/domain/mine.ts), with one primary
// button per row for that step. A hand-over offered to me comes first. The
// name opens the speaker sheet; «שבץ» and «לשיעור» go to the week.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { MINE_GROUPS, type MineRow, mySpeakers, nextStep } from "../../domain/mine";
import { byGender, displayName } from "../../domain/names";
import { DAY_NAMES, fmtRange } from "../../domain/time";
import type { Week } from "../../domain/types";
import { statusLabel } from "../../lib/labels";
import { useMedia } from "../../lib/useMedia";
import { Button, Panel, useRunner } from "../settings/kit";
import { actorIn, useWeekStore } from "../weekStore";
import { CreateSpeaker } from "./CreateSpeaker";
import { EditionSelect, useToast } from "./parts";
import { SpeakerSheet } from "./SpeakerSheet";

type Open = { kind: "speaker"; id: number } | { kind: "create" } | null;

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
  /** A command, then the week again. */
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    await run(key, fn, ok);
    await store.reload();
  };
  const toWeek = (state: { place?: number; lesson?: number }) => navigate("/", { state });

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-display text-2xl font-extrabold">המרצים שלי</h2>
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
                    key={r.approach.id}
                    row={r}
                    week={week}
                    names={names}
                    canEdit={actor.canEdit}
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
          wide={wide}
          onClose={() => setOpen(null)}
          onOpen={(id) => setOpen({ kind: "speaker", id })}
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
  busy: string | null;
  onOpen: () => void;
  act: (key: string, fn: () => Promise<unknown>, ok: string) => Promise<void>;
  port: DataPort;
  toWeek: (state: { place?: number; lesson?: number }) => void;
}) {
  const { speaker: s, approach: a, group, closed, live } = row;
  const ed = week.edition.id;
  const vetted = s.vetted === "approved";
  const step = nextStep(group);
  const cells = (n: number) => (n === 1 ? "במשבצת אחת" : `ב-${n} משבצות`);
  const waiting = vetted ? "" : ` · ${byGender(s.gender, "ממתין", "ממתינה")} לאישור המדריך/ה`;
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
      case "closed":
        return closed.map((l, i) => (
          <span key={l.id}>
            {i > 0 && " | "}
            {DAY_NAMES[l.day]} <bdi>{fmtRange(l.start_min, l.end_min)}</bdi>
            {l.title && ` · ${l.title}`}
          </span>
        ));
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
            <Button kind="primary" busy={busy === k("accept")} onClick={() => void act(k("accept"), () => port.speakers.answerHandOver(ed, a.id, true), "הטיפול עבר אליך")}>
              קבלת הטיפול
            </Button>
            <Button busy={busy === k("decline")} onClick={() => void act(k("decline"), () => port.speakers.answerHandOver(ed, a.id, false), "ההצעה הוחזרה")}>
              לא עכשיו
            </Button>
          </>
        );
      case "approached":
        return (
          <Button kind="primary" disabled={!vetted} busy={busy === k("approached")} onClick={() => void act(k("approached"), () => port.speakers.setStatus(ed, a.id, a.version, "approached"), `עודכן: ${displayName(s)} · פנו`)}>
            פניתי
          </Button>
        );
      case "positive":
        return (
          <Button
            kind="primary"
            disabled={!vetted}
            busy={busy === k("positive")}
            onClick={() => void act(k("positive"), () => port.speakers.setStatus(ed, a.id, a.version, "positive"), `עודכן: ${displayName(s)} ${statusLabel("positive", s.gender)}`)}
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
      case "lesson":
        return <Button onClick={() => toWeek({ lesson: closed[0].id })}>לשיעור</Button>;
      default:
        return null;
    }
  })();
  return (
    <li data-speaker-id={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-card px-3 py-2 shadow-sm">
      <div className="min-w-0 flex-1 basis-44">
        <button type="button" onClick={onOpen} className="inline-flex min-h-11 items-center text-start font-semibold underline-offset-4 hover:underline">
          {displayName(s)}
        </button>
        <p className="text-sm text-ink-soft break-words">{sub}</p>
      </div>
      {primary && <div className="flex shrink-0 flex-wrap gap-1.5">{primary}</div>}
    </li>
  );
}
