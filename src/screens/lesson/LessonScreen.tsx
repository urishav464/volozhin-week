// The lesson page (/lesson/:id, the reset, phase 2) — a lesson's whole way on one wide page instead of the grid's
// narrow side sheet: its header (the day, the date, the time, the room, the title, the topic, the speakers), then a
// vertical stepper — שיבוץ → סגירה → תשלום והסעה → הודעת סיכום → מקורות ומצגת → מלווה (steps.ts) — each step with where
// it stands and only its own action. The steps are the lesson panel's own parts (src/grid/Panels.tsx: the candidates'
// cards, «פרטי השיעור», «פתיחה מחדש»; src/screens/stages/: the message, the sources and the reader, the escort, and for
// the staff the decision, «שולם» and «פרטי ההסעה»), with the transport request the trainee's way (TransportRequest.tsx).
// No «איך עבר» here (after the week). Every change is a port command; a lesson someone else handles is read-only
// where the rules refuse — the commands decide, the page only hides what cannot be done. Opens at `?step=`, else
// at the first step with something left to do.
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { personaOf } from "../../data/gate";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { byGender, displayName } from "../../domain/names";
import { type PageStep, parsePageStep, speakerPath, speakersPath } from "../../domain/routes";
import { type StageState } from "../../domain/stages";
import { DAY_NAMES, dateOf, fmtRange, hebrewDate, shortDate } from "../../domain/time";
import { type Lesson, LIVE_PITCH, type Speaker, type Week } from "../../domain/types";
import { GenderDot, NO_TOPIC_COLOR, STAGE_DOT, STAGE_STATE_LABEL } from "../../grid/bits";
import { buildModel, type GridModel } from "../../grid/model";
import { AddSpeaker, type CardProps, Candidates, Declined, LessonDetails, Meta, type PanelActions, Reopen, rowOf, SpeakerChooser, TopicPill } from "../../grid/Panels";
import { Button, Confirm, Fold, focusLost, useRunner } from "../settings/kit";
import { EditionSelect, type Notify, useToast } from "../speakers/parts";
import { BACK_LINK, namesOf, otherDayText, weekProblem } from "../speakerPages/page";
import { EscortStage, ImportNote, MessageStage, ReaderStage, SourcesStage } from "../stages/LessonStages";
import { type Act, LINK_BUTTON, type StageCtx } from "../stages/parts";
import { Decide, PaidButton, PaymentStage, TransportBlock } from "../stages/PaymentStage";
import { DraftFiles, SourceFiles } from "../stages/SourceFiles";
import { actorIn, useWeekStore } from "../weekStore";
import { useLessonActions } from "./actions";
import { AFTER_CLOSING, firstOpenStep, pageSteps, type PageStepView } from "./steps";
import { RequestSummary, TransportRequest } from "./TransportRequest";

export function LessonScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { id } = useParams();
  const { notify, clear, node } = useToast();
  const { week } = store;
  const lesson = week?.lessons.find((l) => String(l.id) === id);
  const trainee = personaOf(me, store.editionId) === "trainee";
  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-20">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/" className={`-ms-3 ${BACK_LINK}`}>
          <span aria-hidden>→</span> {trainee ? "היום שלי" : "השבוע"}
        </Link>
        {week && !lesson && <EditionSelect />}
      </div>
      {weekProblem(store) ?? (!week ? null : lesson ? (
        <Body key={lesson.id} port={port} me={me} week={week} lesson={lesson} reload={store.reload} notify={notify} clear={clear} />
      ) : (
        <div className="rounded-xl border border-line bg-card p-5 shadow-sm" data-lesson-missing>
          <p className="text-ink">השיעור לא נמצא במחזור הזה — אולי המשבצת התפנתה, או שהשיעור שייך למחזור אחר.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/" className={LINK_BUTTON}>
              {trainee ? "להיום שלי" : "לשבוע"}
            </Link>
            <Link to="/week" className={LINK_BUTTON}>
              לשבוע לצפייה
            </Link>
          </div>
        </div>
      ))}
      {node}
    </div>
  );
}

function Body({ port, me, week, lesson: l, reload, notify, clear }: { port: DataPort; me: Me; week: Week; lesson: Lesson; reload: () => Promise<void>; notify: Notify; clear: () => void }) {
  const model = useMemo(() => buildModel(week), [week]);
  const actor = actorIn(me, week.edition);
  const actions = useLessonActions(port, week.edition.id, model, notify, clear, reload);
  const cmds = useMemo(() => port.commands(week.edition.id), [port, week.edition.id]);
  const { busy, run } = useRunner(notify, clear);
  const act: Act = async (key, fn, ok, onRefused) => {
    const done = await run(key, fn, ok, onRefused);
    await reload();
    return done;
  };
  const lead = model.leadOf.get(l.id) ?? null;
  const handler = lead ? (model.approachBySpeaker.get(lead.id)?.owner_member_id ?? null) : null;
  const mine = actor.canEdit && (actor.isAdmin || (handler != null && handler === actor.memberId));
  const ctx: StageCtx = { week, lesson: l, actor, cmds, busy, act, handler, mine };
  const steps = pageSteps(model, l);

  // `?step=` opens that step — until the lesson closes or reopens under the page: then the first step left to do
  const location = useLocation();
  const asked = parsePageStep(location.search);
  const [askedAt] = useState(l.state);
  // closed here, on this page: the next thing to ask is the payment and the transport (with nothing asked yet the step
  // reads «לא נדרש», and the first step left would skip it)
  const initial = asked && askedAt === l.state ? asked : askedAt === "draft" && l.state === "closed" ? "pay" : firstOpenStep(steps);
  // closed or reopened under the page: the steps are drawn again, and the button pressed with them
  const changedHere = askedAt !== l.state;

  return (
    <>
      <LessonHeader model={model} lesson={l} handler={handler} />
      {l.kind === "memorial" ? (
        <section className="rounded-xl border border-line bg-card p-5 shadow-sm">
          <p className="text-ink">את זמן הזיכרון מתכננים בעמוד «זמני זיכרון».</p>
          <Link to="/memorial" className={`mt-3 ${LINK_BUTTON}`}>
            לזמני הזיכרון ‹
          </Link>
        </section>
      ) : l.state === "cancelled" ? (
        <p className="rounded-xl border border-line bg-card p-5 text-ink-soft shadow-sm">השיעור בוטל.</p>
      ) : (
        <Stepper
          key={`${l.state}:${asked ?? ""}`}
          steps={steps}
          initial={initial}
          scroll={initial != null && initial === asked}
          refocus={changedHere}
          body={(k, show) => <StepBody step={k} show={show} port={port} model={model} ctx={ctx} actions={actions} notify={notify} clear={clear} reload={reload} />}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ the header

function LessonHeader({ model, lesson: l, handler }: { model: GridModel; lesson: Lesson; handler: number | null }) {
  const { week } = model;
  const room = week.rooms.find((r) => r.id === l.room_id);
  const date = dateOf(week.edition.start_date, l.day);
  const topic = l.kind === "lesson" && l.category_id != null ? model.categoryById.get(l.category_id) : undefined;
  const speakers = week.lessonSpeakers
    .filter((x) => x.lesson_id === l.id)
    .sort((a, b) => Number(a.role === "co") - Number(b.role === "co") || a.speaker_id - b.speaker_id)
    .flatMap((x) => {
      const s = model.speakerById.get(x.speaker_id);
      return s ? [s] : [];
    });
  const lead = model.leadOf.get(l.id);
  const live = (model.pitchesByLesson.get(l.id) ?? []).some((p) => LIVE_PITCH.has(p.state));
  const kindName = l.kind === "memorial" ? "זמן זיכרון" : l.state === "closed" ? "שיעור סגור" : l.state === "cancelled" ? "שיעור שבוטל" : live ? "משבצת בתהליך" : "משבצת פנויה";
  const owners = week.dayOwners.filter((o) => o.day === l.day).map((o) => o.member_id);
  const ownerNames = namesOf(week, owners);
  const row = l.kind === "lesson" && l.state === "draft" ? rowOf(model, l) : undefined;
  const accent = l.kind === "memorial" ? "#fcd34d" : (topic?.color ?? NO_TOPIC_COLOR);
  return (
    <header className="overflow-hidden rounded-xl border border-line bg-card shadow-sm" data-lesson-header>
      <span aria-hidden className="block h-1.5" style={{ backgroundColor: accent }} />
      <div className="space-y-3 p-4 sm:p-6">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
          <span className="font-semibold text-ink">יום {DAY_NAMES[l.day]}</span>
          <span aria-hidden>·</span>
          <span>{date ? `${shortDate(date)} · ${hebrewDate(date)}` : "תאריך: TBD"}</span>
          <span aria-hidden>·</span>
          <bdi dir="ltr" className="font-semibold text-ink tabular-nums">
            {fmtRange(l.start_min, l.end_min)}
          </bdi>
          {room && (
            <>
              <span aria-hidden>·</span>
              <span>{room.name}</span>
            </>
          )}
        </p>
        <div>
          {/* the heading: the lesson's title — or, until it has one, its speaker (a draft's: what the slot is) */}
          {(l.title ? l.title !== kindName : !!lead) && <p className="text-sm font-semibold text-ink-soft">{kindName}</p>}
          <h2 className="font-display text-2xl font-extrabold leading-tight text-navy sm:text-3xl">
            {l.title ?? (lead ? <SpeakerLink speaker={lead} big /> : l.kind === "memorial" ? "זמן זיכרון" : kindName)}
          </h2>
        </div>
        {(l.title ? speakers : speakers.slice(1)).length > 0 && (
          <ul aria-label={l.title ? "מרצים" : "מרצים נוספים"} className="flex flex-wrap gap-x-4 gap-y-1">
            {(l.title ? speakers : speakers.slice(1)).map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <SpeakerLink speaker={s} />
                {s.id !== lead?.id && <span className="text-sm text-ink-soft">{byGender(s.gender, "מרצה נוסף", "מרצה נוספת")}</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-soft">
          {l.kind === "lesson" && <TopicPill category={topic} />}
          {row?.label && <Meta>{row.label}</Meta>}
          {handler != null && <Meta>בטיפול: {model.memberName.get(handler) ?? "חבר/ת צוות"}</Meta>}
          {l.audience && <Meta>{l.audience}</Meta>}
          {l.parallel_reason && <Meta>∥ {l.parallel_reason}</Meta>}
          <Meta>{ownerNames ? `היום של ${ownerNames}` : "אין עדיין זוג ליום"}</Meta>
        </div>
      </div>
    </header>
  );
}

/** A speaker of the lesson, to their page: the gender's dot, the name with the title. */
function SpeakerLink({ speaker: s, big = false }: { speaker: Speaker; big?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <GenderDot gender={s.gender} />
      <Link to={speakerPath(s.id)} className={`inline-flex min-h-11 items-center font-bold text-navy hover:underline hover:underline-offset-4 ${big ? "" : "text-lg"}`}>
        {displayName(s)}
      </Link>
    </span>
  );
}

// ------------------------------------------------------------------ the stepper

/** Opens a step (if it is not open), then runs `then` once it is drawn — to bring a part of it into view. */
type ShowStep = (k: PageStep, then?: () => void) => void;

/**
 * The steps down the page, a line between them: each its number in its state's colour, its name, where it stands — and
 * a step with something in it opens below its row (more than one may be open). A draft's steps after closing are
 * rows only: nothing there yet. `scroll`: the address asked for the step it opens at — it comes into view, the focus on
 * its row. `refocus`: drawn again because the lesson closed or reopened here — the button that did it went with the
 * old steps, so the focus goes to the row of the step it opens at.
 */
function Stepper({ steps, initial, scroll, refocus, body }: { steps: PageStepView[]; initial: PageStep | null; scroll: boolean; refocus: boolean; body: (k: PageStep, show: ShowStep) => ReactNode }) {
  const [open, setOpen] = useState<Set<PageStep>>(() => new Set(initial ? [initial] : []));
  const asked = useRef(scroll ? initial : null);
  const again = useRef(refocus ? initial : null);
  useEffect(() => {
    const k = asked.current;
    if (k) {
      const el = document.getElementById(`page-step-${k}`);
      el?.scrollIntoView({ block: "start" });
      el?.querySelector<HTMLElement>("h3 button")?.focus({ preventScroll: true });
      return;
    }
    const at = again.current;
    if (at && focusLost()) document.getElementById(`page-step-${at}`)?.querySelector<HTMLElement>("h3 button")?.focus();
  }, []);
  const toggle = (k: PageStep) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(k)) next.add(k);
      return next;
    });
  const show: ShowStep = (k, then) => {
    setOpen((cur) => (cur.has(k) ? cur : new Set(cur).add(k)));
    if (then) requestAnimationFrame(() => requestAnimationFrame(then));
  };
  return (
    <ol aria-label="שלבי השיעור">
      {steps.map((s, i) => (
        <StepRow key={s.key} n={i + 1} last={i === steps.length - 1} step={s} open={open.has(s.key)} onToggle={() => toggle(s.key)}>
          {body(s.key, show)}
        </StepRow>
      ))}
    </ol>
  );
}

/** A step's number: white on its state's fill, navy on a hollow «open», muted on a dashed «not needed». */
const NUMBER_TEXT: Record<StageState, string> = { done: "text-white", waiting: "text-white", problem: "text-white", open: "text-navy", na: "text-ink-faint" };

function StepRow({ n, last, step: s, open, onToggle, children }: { n: number; last: boolean; step: PageStepView; open: boolean; onToggle: () => void; children: ReactNode }) {
  const id = `page-step-${s.key}`;
  // a draft's steps after closing hold nothing yet: a row, not a disclosure
  const inert = s.state === "na" && s.note === AFTER_CLOSING;
  const head = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold text-navy sm:text-lg">{s.label}</span>
        <span className="block text-sm text-ink-soft">{s.note}</span>
      </span>
      {/* «לא נדרש» would say the wrong thing of a step that is only not yet */}
      {!inert && <span className="shrink-0 text-xs font-semibold text-ink-soft">{STAGE_STATE_LABEL[s.state]}</span>}
      {!inert && (
        <span aria-hidden className={`shrink-0 text-navy motion-safe:transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      )}
    </>
  );
  return (
    <li id={id} data-page-step={s.key} data-state={s.state} className="relative flex scroll-mt-4 gap-3 sm:gap-4">
      {/* the number and the line down to the next step */}
      <div aria-hidden className="flex w-9 shrink-0 flex-col items-center">
        <span className={`mt-3 grid size-9 shrink-0 place-items-center rounded-full border-2 text-sm font-extrabold ${STAGE_DOT[s.state]} ${NUMBER_TEXT[s.state]}`}>{n}</span>
        {!last && <span className="w-0.5 flex-1 bg-line" />}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-3"}`}>
        <div className={`rounded-xl border ${inert ? "border-line/70 bg-paper-light" : `bg-card shadow-sm ${open ? "border-navy/30" : "border-line"}`}`}>
          {inert ? (
            <div className="flex min-h-14 items-center gap-3 px-4 py-2">{head}</div>
          ) : (
            <h3>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`${id}-body`}
                onClick={onToggle}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-2 text-start transition-colors hover:bg-accent-soft/50"
              >
                {head}
              </button>
            </h3>
          )}
          {open && !inert && (
            <div id={`${id}-body`} className="space-y-4 border-t border-line px-4 pb-5 pt-4 sm:px-5">
              {children}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ the steps

interface StepBodyProps {
  step: PageStep;
  show: ShowStep;
  port: DataPort;
  model: GridModel;
  ctx: StageCtx;
  actions: PanelActions;
  notify: Notify;
  clear: () => void;
  reload: () => Promise<void>;
}

function StepBody(props: StepBodyProps) {
  const { step, ctx } = props;
  const { lesson: l } = ctx;
  switch (step) {
    case "place":
      return l.state === "draft" ? <PlaceDraft {...props} /> : <PlaceClosed {...props} />;
    case "close":
      return l.state === "draft" ? <CloseDraft {...props} /> : <CloseClosed {...props} />;
    case "pay":
      return <PayStep {...props} />;
    case "msg":
      return <MessageStage {...ctx} port={props.port} speakerId={props.model.leadOf.get(l.id)?.id ?? null} notify={props.notify} />;
    case "sources":
      return <SourcesStep {...props} />;
    case "escort":
      return <EscortStage key={l.version} {...ctx} speakerGender={props.model.leadOf.get(l.id)?.gender ?? null} />;
  }
}

/** «שיבוץ» of a draft: the candidates' cards (the call, its result, closing), else the chooser; who declined, folded. */
function PlaceDraft({ port, model, ctx, actions, notify, reload }: StepBodyProps) {
  const { week, lesson: l, actor } = ctx;
  const pitches = model.pitchesByLesson.get(l.id) ?? [];
  const live = pitches.filter((p) => LIVE_PITCH.has(p.state));
  const declined = pitches.filter((p) => p.state === "declined");
  const card: CardProps = { model, me: actor.memberId, isAdmin: actor.isAdmin, global: actor.global, canEdit: actor.canEdit, actions };
  // another pair's day: they see in «היום שלי» that the proposal is mine — asked once before it is made (staff are not asked)
  const owners = week.dayOwners.filter((o) => o.day === l.day).map((o) => o.member_id);
  const otherDay = actor.isAdmin ? null : otherDayText(week, owners, actor.memberId);
  const [asking, setAsking] = useState<{ id: number; mode: "self" | "offer" } | null>(null);
  const propose = (id: number, mode: "self" | "offer") => actions.propose(id, { lesson_id: l.id }, mode);
  const pick = (id: number, mode: "self" | "offer") => (otherDay ? setAsking({ id, mode }) : propose(id, mode));
  const root = useRef<HTMLDivElement>(null);
  // the chooser's row that asked (still drawn under the Confirm): «ביטול» gives it the focus back
  const rowButton = (id: number) => root.current?.querySelector<HTMLElement>(`[data-chooser-speaker="${id}"] button`);
  const ask = asking && otherDay && (
    <Confirm
      text={otherDay}
      confirm="להמשיך"
      danger={false}
      onConfirm={() => {
        setAsking(null);
        propose(asking.id, asking.mode);
      }}
      onCancel={() => {
        rowButton(asking.id)?.focus();
        setAsking(null);
      }}
    />
  );
  // A first proposal swaps the chooser for the candidates, a «סירב/ה» swaps them back: the focus that fell with the part
  // it was in goes to the new candidate, or to the chooser's search (the grid's lesson panel does the same).
  const chooser = live.length === 0;
  const shaped = useRef(chooser);
  useEffect(() => {
    if (shaped.current === chooser) return;
    shaped.current = chooser;
    if (focusLost()) root.current?.querySelector<HTMLElement>(chooser ? 'input[type="search"]' : "[data-pitch-id] button")?.focus();
  }, [chooser]);
  // the draft itself (a parallel pair shares the day and the time): the list proposes into this one
  const slot = speakersPath({ slot: { day: l.day, start: l.start_min, end: l.end_min, lesson: l.id } });
  return (
    <div ref={root} className="space-y-4">
      {live.length === 0 ? (
        actor.canEdit ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">בוחרים מרצה למשבצת — מי שאמר/ה שיכול/ה בשעה הזו מסומן/ת «זמין/ה».</p>
            {ask}
            <div className="max-w-2xl">
              <SpeakerChooser model={model} me={actor.memberId} day={l.day} start={l.start_min} end={l.end_min} need={model.days[l.day].balance.need} onPick={pick} />
            </div>
            <Link to={slot} className={LINK_BUTTON}>
              לכל המרצים שמתאימים למשבצת ‹
            </Link>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">עוד אין מועמד/ת למשבצת.</p>
        )
      ) : (
        <div className="space-y-3">
          <Candidates {...card} pitches={live} />
          {ask}
          {actor.canEdit && (
            <div className="max-w-2xl">
              <AddSpeaker key={l.id} model={model} me={actor.memberId} lesson={l} onPick={pick} />
            </div>
          )}
        </div>
      )}
      {declined.length > 0 && <Declined {...card} pitches={declined} small={live.length > 0} />}
      <DraftFiles port={port} week={week} lesson={l} actor={actor} notify={notify} reload={reload} />
    </div>
  );
}

/** «שיבוץ» of a closed lesson: who teaches it, each to their page. */
function PlaceClosed({ model, ctx }: StepBodyProps) {
  const { week, lesson: l } = ctx;
  const rows = week.lessonSpeakers.filter((x) => x.lesson_id === l.id).sort((a, b) => Number(a.role === "co") - Number(b.role === "co") || a.speaker_id - b.speaker_id);
  return (
    <ul className="space-y-2">
      {rows.map((x) => {
        const s = model.speakerById.get(x.speaker_id);
        if (!s) return null;
        const owner = model.approachBySpeaker.get(s.id)?.owner_member_id;
        return (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-paper-light px-3 py-2">
            <GenderDot gender={s.gender} />
            <span className="font-bold text-navy">{displayName(s)}</span>
            <span className="text-sm text-ink-soft">
              {x.role === "lead" ? "מרצה" : byGender(s.gender, "מרצה נוסף", "מרצה נוספת")}
              {owner != null && ` · בטיפול: ${model.memberName.get(owner) ?? "חבר/ת צוות"}`}
            </span>
            <Link to={speakerPath(s.id)} className={`ms-auto ${LINK_BUTTON}`}>
              לעמוד המרצה ‹
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** «סגירה» of a draft: where closing is done (what it waits for is the step's own line) — on the agreed candidate's card. */
function CloseDraft({ model, ctx, show }: StepBodyProps) {
  const { lesson: l } = ctx;
  const agreed = (model.pitchesByLesson.get(l.id) ?? []).find((p) => LIVE_PITCH.has(p.state) && model.approachById.get(p.approach_id)?.status === "positive");
  // «שיבוץ» opened if it was closed, then the agreed card in view, the focus on its first action («סגירה», «אישור»)
  const toCard = () =>
    show("place", () => {
      const el = document.querySelector<HTMLElement>(`[data-pitch-id="${agreed?.id}"]`);
      el?.scrollIntoView({ block: "center" });
      (el?.querySelector<HTMLElement>("[data-card-actions] button") ?? el?.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
    });
  return (
    <div className="space-y-2 text-sm">
      <p>סוגרים בכרטיס של המרצה בשלב «שיבוץ», אחרי שהמרצה הסכים/ה לשעה ואושר/ה על ידי המדריך/ה.</p>
      {/* not «לכרטיס המרצה»: that is the speaker's page elsewhere — this is the candidate's card in «שיבוץ», right here */}
      {agreed && <Button onClick={toCard}>לסגירה בכרטיס</Button>}
    </div>
  );
}

/** «סגירה» of a closed lesson: its details, and — folded, the occasional and destructive act — «פתיחה מחדש». */
function CloseClosed({ model, ctx, actions }: StepBodyProps) {
  const { week, lesson: l, actor, mine } = ctx;
  return (
    <>
      <LessonDetails model={model} lesson={l} canEdit={actor.canEdit} onSave={(patch) => actions.update(l.id, l.version, patch)} />
      {mine && (
        <Fold title="פעולות נוספות" hint="פתיחה מחדש">
          <Reopen lesson={l} isAdmin={actor.isAdmin} files={(week.sourceFiles ?? []).filter((f) => f.lesson_id === l.id).length} onReopen={() => actions.reopen(l.id)} />
        </Fold>
      )}
    </>
  );
}

/**
 * «תשלום והסעה»: the handler's (or an admin's) request the trainee's way — sent for approval, then only where it
 * stands; anyone else reads what was asked. The staff add their own parts: the decision (who may decide —
 * decide_payments), «שולם», and «פרטי ההסעה» (the pickup and the driver). An archive's lesson: the panel's stage as it was.
 */
function PayStep({ ctx }: StepBodyProps) {
  const { week, lesson: l, actor, cmds, busy, act, mine } = ctx;
  if (week.edition.kind === "archive") {
    return (
      <>
        <ImportNote cmds={cmds} lessonId={l.id} />
        <PaymentStage {...ctx} />
      </>
    );
  }
  const staff = actor.isAdmin || actor.role === "logistics";
  const live = week.edition.kind === "real" && week.edition.status !== "archived";
  const mayDecide = actor.global || ((actor.isAdmin || actor.role === "logistics") && live);
  return (
    <>
      {mine ? (
        <TransportRequest {...ctx} details={!staff} />
      ) : (
        <div className="space-y-2">
          {l.approval === "none" ? <p className="text-sm">לא התבקשו תשלום או הסעה.</p> : <RequestSummary lesson={l} />}
          {actor.canEdit && <p className="text-xs text-ink-soft">את הבקשה מגישים מי שמטפל/ת במרצה, או המדריך/ה.</p>}
        </div>
      )}
      {mayDecide && l.approval === "pending" && <Decide key={l.version} lesson={l} busy={busy} act={act} decide={cmds.decidePayments} />}
      <PaidButton {...ctx} />
      {staff && l.transport !== "none" && (
        <div className="border-t border-line pt-3">
          <TransportBlock {...ctx} />
        </div>
      )}
    </>
  );
}

/** «מקורות ומצגת»: the files, what arrived and when it is printed, and the reader's word on the lesson. */
function SourcesStep({ port, ctx, notify, clear, reload }: StepBodyProps) {
  const { week, lesson: l, actor } = ctx;
  return (
    <>
      <SourceFiles port={port} week={week} lesson={l} actor={actor} notify={notify} clear={clear} reload={reload} />
      <div className="border-t border-line pt-3">
        <SourcesStage key={l.version} {...ctx} />
      </div>
      <div className="border-t border-line pt-3">
        {/* no «למקורות ולקבצים»: they are right above */}
        <ReaderStage {...ctx} />
      </div>
    </>
  );
}
