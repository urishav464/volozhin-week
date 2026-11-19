// «מרצים» (/speakers, the reset, phase 2): the whole pool on a wide page — a table on a desktop or a tablet, cards
// on a phone. Search, a topic, the gender, where they stand (שלי / פנויים / בטיפול אחרים / נסגרו / סירבו), «מתאים/ה
// ליום», and the sort — all in the address, so «לבחור מרצה» on «היום שלי» opens the list for one slot
// (`?slot=0:960-1050`, `&lesson=34` for a draft): who fits it, «יכול/ה» first, each with «להציע כאן». A row (a card on a
// phone) opens the speaker's page; its name is the link. The reset, phase 3: «כל הצוות» (`?view=team`, TeamView.tsx) —
// a block per handler under the same search — and, on top, the hand-overs offered to me («הוצעו לך», each to its page).
import { type FormEvent, type MouseEvent, useEffect, useId, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { activeLessonRows } from "../../domain/availability";
import { teamBoard } from "../../domain/mine";
import { offeredTo } from "../../domain/myDay";
import { byGender, displayName } from "../../domain/names";
import { proposeMode, targetOf } from "../../domain/placement";
import { newSpeakerPath, parseSpeakersQuery, speakerPath, speakersPath, type SpeakersQuery } from "../../domain/routes";
import { DAYS, DAY_NAMES, type Day, fmtRange } from "../../domain/time";
import { type Gender, LIVE_PITCH, type Week } from "../../domain/types";
import { AvailabilityStrip } from "../../grid/AvailabilityStrip";
import { Chip, GenderDot, TopicChip, topicsOf } from "../../grid/bits";
import { buildModel, type GridModel, type OpenSlot, POOL_SECTION_LABEL, type PoolSection } from "../../grid/model";
import { statusLabel, vettingLabel } from "../../lib/labels";
import { useMedia } from "../../lib/useMedia";
import { Button, Confirm, Field, Fold, INPUT, TABLE_HEAD, TABLE_ROW, TABLE_TH, useFocusBack, useFocusRescue, useRunner } from "../settings/kit";
import { EditionSelect, type Notify, useToast } from "../speakers/parts";
import { type Actor, actorIn, useWeekStore } from "../weekStore";
import { OffersLine } from "../myday/parts";
import { filterSpeakers, filterTeam, SECTION_ORDER, slotFor, type SpeakerRow } from "./filters";
import { otherDayText, type PageNotice, weekProblem } from "./page";
import { TeamView } from "./TeamView";

export function SpeakersScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { notify, clear, node } = useToast();
  const problem = weekProblem(store);
  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-20">
      {problem ?? (store.week && <Body port={port} me={me} week={store.week} reload={store.reload} notify={notify} clear={clear} />)}
      {node}
    </div>
  );
}

function Body({ port, me, week, reload, notify, clear }: { port: DataPort; me: Me; week: Week; reload: () => Promise<void>; notify: Notify; clear: () => void }) {
  const id = useId();
  const location = useLocation();
  const navigate = useNavigate();
  const wide = useMedia("(min-width: 768px)");
  const q = useMemo(() => parseSpeakersQuery(location.search), [location.search]);
  const model = useMemo(() => buildModel(week), [week]);
  const actor = actorIn(me, week.edition);
  const rows = useMemo(() => filterSpeakers(model, actor.memberId, q), [model, actor.memberId, q]);
  // «כל הצוות»: the team's board under the search, the topic and the gender (the rest is the list's)
  const team = q.view === "team";
  const board = useMemo(() => (team ? filterTeam(model, teamBoard(week), q) : null), [team, model, week, q]);
  const teamCount = board ? new Set([...board.owners.flatMap((o) => o.rows), ...board.unowned].map((r) => r.speaker.id)).size : 0;
  // from the address as it is NOW (a filter chosen right after typing must not bring back the search before it, which
  // a render that has not happened yet would still hold)
  const set = (patch: Partial<SpeakersQuery>) => navigate(speakersPath({ ...parseSpeakersQuery(window.location.search), ...patch }), { replace: true });

  // The search box keeps what is typed (a space between words included); the address takes it trimmed.
  const [text, setText] = useState(q.q ?? "");
  useEffect(() => {
    setText((t) => (t.trim() === (q.q ?? "") ? t : (q.q ?? "")));
  }, [q.q]);

  // «לבחור מרצה»: the slot the list is for, if it is still open — the draft the address names, never a parallel one
  const slot = q.slot ? slotFor(model, q.slot) : null;
  const categories = week.categories.filter((c) => c.active);
  const playDays = DAYS.filter((d) => activeLessonRows(week.rows, week.edition, d).length > 0);

  // the five filters: in a row on a wide screen; on a phone folded under the search (open while one is on)
  const active = (team ? [q.cat, q.g] : [q.cat, q.g, q.s, q.day, q.sort]).filter((v) => v != null).length;
  // open at first when the address came with a filter; after that it is the reader's (never shut under their hand)
  const [filtersOpen] = useState(active > 0);
  const filters = (
    <div className={`grid grid-cols-2 gap-2 ${team ? "md:max-w-md" : "md:grid-cols-5"}`}>
      <Field id={`${id}-cat`} label="נושא">
        <select id={`${id}-cat`} value={q.cat ?? ""} onChange={(e) => set({ cat: e.target.value ? Number(e.target.value) : undefined })} className={INPUT}>
          <option value="">כל הנושאים</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${id}-g`} label="מגדר">
        <select id={`${id}-g`} value={q.g ?? ""} onChange={(e) => set({ g: (e.target.value || undefined) as Gender | undefined })} className={INPUT}>
          <option value="">כולם</option>
          <option value="f">נשים</option>
          <option value="m">גברים</option>
        </select>
      </Field>
      {!team && (
        <>
          <Field id={`${id}-s`} label="מצב">
            <select id={`${id}-s`} value={q.s ?? ""} onChange={(e) => set({ s: (e.target.value || undefined) as PoolSection | undefined })} className={INPUT}>
              <option value="">הכול</option>
              {SECTION_ORDER.map((s) => (
                <option key={s} value={s}>
                  {POOL_SECTION_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-day`} label="מתאים/ה ליום">
            <select id={`${id}-day`} value={q.day ?? ""} onChange={(e) => set({ day: e.target.value === "" ? undefined : (Number(e.target.value) as Day) })} className={INPUT}>
              <option value="">כל יום</option>
              {playDays.map((d) => (
                <option key={d} value={d}>
                  יום {DAY_NAMES[d]}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-sort`} label="מיון">
            <select id={`${id}-sort`} value={q.sort ?? "status"} onChange={(e) => set({ sort: e.target.value === "name" ? "name" : undefined })} className={INPUT}>
              <option value="status">לפי מצב</option>
              <option value="name">לפי שם</option>
            </select>
          </Field>
        </>
      )}
    </div>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-display text-2xl font-extrabold text-navy">מרצים</h2>
        <EditionSelect />
        <Link
          to={team ? speakersPath({ ...q, view: undefined }) : speakersPath({ q: q.q, cat: q.cat, g: q.g, view: "team" })}
          data-team-toggle
          className={`ms-auto inline-flex min-h-11 items-center rounded-full border border-navy bg-card px-4 font-bold text-navy transition-colors hover:bg-accent-soft`}
        >
          {team ? "לרשימה" : "כל הצוות"}
        </Link>
        {actor.canEdit && (
          <Link to={newSpeakerPath(text)} className="inline-flex min-h-11 items-center rounded-full bg-navy px-4 font-bold text-white transition-colors hover:bg-navy-800">
            מרצה חדש/ה
          </Link>
        )}
      </div>

      <OffersLine model={model} offers={offeredTo(week, actor.memberId)} />

      {q.slot && !team && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-navy/30 bg-accent-soft px-4 py-2.5">
          <span className="font-bold text-navy">
            מרצים למשבצת: יום {DAY_NAMES[q.slot.day]}{" "}
            <bdi dir="ltr" className="tabular-nums">
              {fmtRange(q.slot.start, q.slot.end)}
            </bdi>
          </span>
          {!slot && <span className="text-sm text-ink-soft">המשבצת כבר לא פנויה.</span>}
          <Button
            kind="quiet"
            className="ms-auto"
            onClick={() => {
              // the line goes with the slot: the focus to the search first, where the list is filtered again
              document.getElementById(`${id}-q`)?.focus();
              set({ slot: undefined });
            }}
          >
            ניקוי
          </Button>
        </div>
      )}

      <form role="search" aria-label="סינון המרצים" onSubmit={(e: FormEvent) => e.preventDefault()} className="space-y-3 rounded-xl border border-line bg-card p-3 shadow-sm sm:p-4">
        <Field id={`${id}-q`} label="חיפוש">
          <input
            id={`${id}-q`}
            type="search"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              set({ q: e.target.value.trim() || undefined });
            }}
            placeholder="חיפוש לפי שם, נושא או מוסד"
            className={INPUT}
            autoComplete="off"
          />
        </Field>
        {wide ? (
          filters
        ) : (
          <Fold title="סינון ומיון" hint={active > 0 ? (active === 1 ? "מסנן אחד פעיל" : `${active} מסננים פעילים`) : undefined} size="sm" defaultOpen={filtersOpen}>
            {filters}
          </Fold>
        )}
      </form>

      {board ? (
        <>
          <p role="status" className="text-sm text-ink-soft">
            {teamCount === 0 ? "אין מרצים בטיפול שמתאימים לסינון." : teamCount === 1 ? "מרצה אחד/ת בטיפול" : `${teamCount} מרצים בטיפול`}
          </p>
          <TeamView week={week} board={board} />
        </>
      ) : (
        <p role="status" className="text-sm text-ink-soft">
          {rows.length === 0 ? "אין מרצים שמתאימים לסינון." : rows.length === 1 ? "מרצה אחד/ת" : `${rows.length} מרצים`}
        </p>
      )}

      {!board && rows.length > 0 && (
        <SpeakerList port={port} week={week} model={model} actor={actor} rows={rows} slot={slot} wide={wide} notify={notify} clear={clear} reload={reload} />
      )}
    </>
  );
}

/** The rows, with «להציע כאן» for a slot: a table on a wide screen, cards on a phone. */
function SpeakerList({
  port,
  week,
  model,
  actor,
  rows,
  slot,
  wide,
  notify,
  clear,
  reload,
}: {
  port: DataPort;
  week: Week;
  model: GridModel;
  actor: Actor;
  rows: SpeakerRow[];
  slot: OpenSlot | null;
  wide: boolean;
  notify: Notify;
  clear: () => void;
  reload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const { busy, run } = useRunner(notify, clear);
  const [asking, setAsking] = useState<number | null>(null);
  const focus = useFocusBack();
  const rescue = useFocusRescue();
  // who is already proposed in the slot's draft: nothing to propose again
  const already = useMemo(() => {
    if (!slot?.lessonId) return new Set<number>();
    return new Set(week.pitches.filter((p) => p.lesson_id === slot.lessonId && LIVE_PITCH.has(p.state)).map((p) => model.approachById.get(p.approach_id)?.speaker_id));
  }, [slot, week.pitches, model]);
  const owners = slot ? week.dayOwners.filter((o) => o.day === slot.day).map((o) => o.member_id) : [];
  const ask = slot ? otherDayText(week, owners, actor.memberId) : null;
  const mayPropose = !!slot && actor.canEdit;

  const propose = async (r: SpeakerRow) => {
    if (!slot) return;
    setAsking(null);
    const mode = proposeMode(model, r.speaker.id, actor.memberId);
    const s = r.speaker;
    const handlerName = r.handler != null ? (model.memberName.get(r.handler) ?? "חבר/ת צוות") : "";
    const text = mode === "offer" ? `${displayName(s)} ${byGender(s.gender, "הוצע", "הוצעה")} ל${handlerName}` : `${displayName(s)} ${byGender(s.gender, "הוצע", "הוצעה")} למשבצת`;
    const ok = await run(`p:${s.id}`, () => port.commands(week.edition.id).propose(s.id, targetOf(slot), mode), mode === "offer" ? text : null);
    await reload();
    // mine now: the call is the next step — on the speaker's page, at the call
    if (ok && mode === "self") navigate(speakerPath(s.id, "call"), { state: { notice: { kind: "ok", text } } satisfies PageNotice });
    // offered: the button is now «כבר מוצע/ת כאן» — the focus to the row's name
    else rescue(() => document.querySelector<HTMLElement>(`[data-speaker-row="${s.id}"] a[href]`));
  };
  /** A table row opens the speaker's page on a click anywhere but its controls (the keyboard has the name's link). */
  const openRow = (e: MouseEvent, speakerId: number) => {
    if ((e.target as Element).closest("a, button, input, select, label, [data-row-actions]")) return;
    if (window.getSelection()?.toString()) return;
    navigate(speakerPath(speakerId));
  };

  const action = (r: SpeakerRow) => {
    if (!mayPropose || r.speaker.retired) return null;
    if (already.has(r.speaker.id)) return <span className="text-sm text-ink-soft">{byGender(r.speaker.gender, "כבר מוצע", "כבר מוצעת")} כאן</span>;
    const mode = proposeMode(model, r.speaker.id, actor.memberId);
    const label = mode === "offer" ? `להציע ל-${model.memberName.get(r.handler ?? -1) ?? "מטפל/ת"}` : "להציע כאן";
    if (asking === r.speaker.id && ask) {
      return (
        <Confirm
          text={ask}
          confirm={label}
          danger={false}
          busy={busy === `p:${r.speaker.id}`}
          onConfirm={() => void propose(r)}
          onCancel={() => {
            setAsking(null);
            focus.back(String(r.speaker.id));
          }}
        />
      );
    }
    return (
      <Button ref={focus.ref(String(r.speaker.id))} kind={r.fit === "can" ? "primary" : "secondary"} busy={busy === `p:${r.speaker.id}`} onClick={() => (ask ? setAsking(r.speaker.id) : void propose(r))}>
        {label}
      </Button>
    );
  };

  if (!wide) {
    return (
      <ul aria-label="המרצים" className="space-y-2">
        {rows.map((r) => (
          // the whole card opens the speaker (the name link's ::after covers it); its own controls sit above it
          <li key={r.speaker.id} data-speaker-row={r.speaker.id} className="relative space-y-1.5 rounded-xl border border-line bg-card p-3 shadow-sm transition duration-150 ease-out hover:border-navy/40 hover:shadow-md">
            <NameCell r={r} cover />
            <Topics week={week} r={r} />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
              <span className="min-w-0 break-words">
                {[
                  r.speaker.affiliation,
                  r.approach && statusOf(r),
                  r.handler != null && (r.handler === actor.memberId ? "בטיפולך" : `בטיפול ${handlerOf(model, r, actor.memberId)}`),
                  r.closed > 0 && (r.closed === 1 ? "שיעור אחד" : `${r.closed} שיעורים`),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <AvailabilityStrip model={model} speaker={r.speaker} size="md" className="ms-auto" />
            </div>
            {(() => {
              const a = action(r);
              return a && (
                // only the control itself above the card's link: a tap beside it still opens the speaker
                <div data-row-actions className="relative z-10 w-fit max-w-full">
                  {a}
                </div>
              );
            })()}
          </li>
        ))}
      </ul>
    );
  }
  return (
    // `relative`: the scroll box is the containing block of what is drawn out of the flow inside it (the header's
    // sr-only cell), so nothing of a wide table reaches the page's own width (in RTL, the overflow is to the left)
    <div className="relative overflow-x-auto rounded-xl border border-line bg-card shadow-sm">
      <table aria-label="המרצים" className="w-full border-collapse text-start text-sm">
        <thead>
          <tr className={TABLE_HEAD}>
            {["שם", "נושאים", "מוסד", "מצב", "בטיפול", "זמינות", "שיעורים"].map((h) => (
              <th key={h} scope="col" className={`${TABLE_TH} px-2 py-2 lg:px-3 ${h === "מוסד" ? "hidden lg:table-cell" : ""}`}>
                {h}
              </th>
            ))}
            {mayPropose && (
              <th scope="col" className="px-2 py-2 lg:px-3">
                <span className="sr-only">פעולות</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.speaker.id} data-speaker-row={r.speaker.id} onClick={(e) => openRow(e, r.speaker.id)} className={`${TABLE_ROW} cursor-pointer align-top`}>
              <td className="px-2 py-2 lg:px-3">
                <NameCell r={r} />
                {/* a tablet: the institution under the name (its column from 1024px) */}
                {r.speaker.affiliation && <span className="mt-0.5 block break-words text-xs text-ink-soft lg:hidden">{r.speaker.affiliation}</span>}
              </td>
              <td className="px-2 py-2 lg:px-3">
                <Topics week={week} r={r} />
              </td>
              <td className="hidden min-w-32 px-2 py-2 lg:px-3 break-words lg:table-cell">{r.speaker.affiliation ?? "—"}</td>
              <td className="min-w-28 px-2 py-2 lg:px-3">{statusOf(r)}</td>
              <td className="px-2 py-2 lg:px-3">{handlerOf(model, r, actor.memberId)}</td>
              <td className="px-2 py-2 lg:px-3">
                <AvailabilityStrip model={model} speaker={r.speaker} size="md" />
              </td>
              <td className="px-2 py-2 lg:px-3 tabular-nums">{r.closed || "—"}</td>
              {mayPropose && (
                <td data-row-actions className={`cursor-auto px-2 py-2 lg:px-3 ${asking === r.speaker.id ? "min-w-64" : "w-px whitespace-nowrap"}`}>
                  {action(r)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The name (with the title) to the speaker's page, marked as a link on every screen (a line and ‹ — a phone has no
 * hover), 44px tall to a finger; the approval said only when it is not given. `cover`: a card's — its ::after takes the
 * whole card (the card is `relative`).
 */
function NameCell({ r, cover = false }: { r: SpeakerRow; cover?: boolean }) {
  const s = r.speaker;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <GenderDot gender={s.gender} />
      <Link
        to={speakerPath(s.id)}
        className={`inline-flex min-h-11 items-center gap-1 font-bold text-navy underline decoration-navy/30 underline-offset-4 hover:decoration-navy pointer-fine:min-h-8 ${cover ? "after:absolute after:inset-0 after:rounded-xl after:content-['']" : ""}`}
      >
        {displayName(s)}
        <span aria-hidden className="inline-block">
          ‹
        </span>
      </Link>
      {s.disambiguator && <span className="text-xs text-ink-soft">({s.disambiguator})</span>}
      {s.vetted !== "approved" && <Chip tone={s.vetted === "rejected" ? "bad" : "warn"}>{vettingLabel(s.vetted, s.gender)}</Chip>}
      {r.fit === "can" && <Chip tone="ok">{byGender(s.gender, "יכול", "יכולה")}</Chip>}
    </span>
  );
}

function Topics({ week, r }: { week: Week; r: SpeakerRow }) {
  const topics = topicsOf(r.speaker.topics, week.categories);
  if (topics.length === 0) return <span className="text-ink-faint">—</span>;
  return (
    <ul aria-label="נושאים" className="flex flex-wrap gap-1">
      {topics.map((t) => (
        <li key={t.name}>
          <TopicChip name={t.name} category={t.category} />
        </li>
      ))}
    </ul>
  );
}

function statusOf(r: SpeakerRow): string {
  return r.approach ? statusLabel(r.approach.status, r.speaker.gender) : "—";
}

function handlerOf(model: GridModel, r: SpeakerRow, me: number): string {
  if (r.handler == null) return "—";
  return r.handler === me ? "אני" : (model.memberName.get(r.handler) ?? "חבר/ת צוות");
}
