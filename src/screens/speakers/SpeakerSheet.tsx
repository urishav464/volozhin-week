// The speaker sheet («פרופיל מרצה»), in the order a speaker's year goes (v14):
// who they are; «השיחה» — who handles them and where that stands, the
// instructor's points for the call and its result, a hand-over; the
// instructor's approval (closing a lesson waits for it); «השיעור» — the slots
// they are proposed for, «שבץ בשבוע», each closed lesson with its five stage
// dots and the summary message (the same composer as the lesson panel, with the
// contacts this sheet already holds); their availability slot by slot (any
// content member marks it); their contacts (only for the people the contacts
// policy names — a global admin, or the handler in the current real edition);
// what they taught in past editions and how it went (SpeakerReviews.tsx); and
// the timeline, folded. Opened from the pool, from a lesson, from «המרצים שלי»
// (at the call, `focus`) and from the approvals queue; the same grid sheet
// (Panels.tsx) at the side on a wide screen, from the bottom on a phone.
//
// Every change is a port command (docs/CONTRACT.md «The speaker pool"), so the
// demo refuses exactly what the database refuses; a refusal reads in Hebrew.
import { useEffect, useMemo, useRef, useState } from "react";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { timeline } from "../../domain/activityText";
import { telHref, waHref } from "../../domain/contactLinks";
import { byGender, displayName } from "../../domain/names";
import { DAY_NAMES, fmt, fmtRange } from "../../domain/time";
import { LIVE_PITCH, type Lesson, type Speaker, type SpeakerContacts, type Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { GenderDot, ReconfirmDot, StageDots, TopicChip, topicsOf } from "../../grid/bits";
import { Meta, Section, Sheet } from "../../grid/Panels";
import { statusLabel, vettingLabel } from "../../lib/labels";
import { Button, Fold, useRunner } from "../settings/kit";
import { type Actor, actorIn } from "../weekStore";
import { MessageComposer } from "../stages/MessageComposer";
import { LINK_BUTTON } from "../stages/parts";
import { CallPoints, CallResults } from "./call";
import { type Notify, SlotGrid } from "./parts";
import {
  type Act,
  ApproachView,
  CALLING,
  CallResultFrame,
  Contacts,
  DAY_ONLY,
  HandOver,
  HandOverOffer,
  handOverText,
  LINK_PREFERRED,
  mayEditSpeaker,
  ProfileEdit,
  Timeline,
  useSpeakerSide,
  VetForm,
  vetText,
  when,
} from "./sheetParts";
import { TaughtHere } from "./SpeakerReviews";

export { mayEditSpeaker } from "./sheetParts";

export interface SpeakerSheetProps {
  port: DataPort;
  me: Me;
  week: Week;
  speakerId: number;
  wide: boolean;
  onClose: () => void;
  /** Opened from another panel: «חזרה» (and Escape) return to it. */
  onBack?: () => void;
  backLabel?: string;
  notify: Notify;
  clear: () => void;
  /** Re-reads the week after a command. */
  reload: () => Promise<void>;
  /** «שבץ»: place this speaker on the week (the grid's own flow). */
  onPlace?: (speakerId: number) => void;
  /** Open one of their lessons on the week. */
  onLesson?: (lessonId: number) => void;
  /** «לשיחה» in «המרצים שלי»: the sheet opens at the call — scrolled to it, its points open, the focus on it. */
  focus?: "call";
}

export function SpeakerSheet(props: SpeakerSheetProps) {
  const s = props.week.speakers.find((x) => x.id === props.speakerId);
  if (!s) {
    return (
      <Sheet wide={props.wide} title="מרצה" onClose={props.onClose} onBack={props.onBack} backLabel={props.backLabel}>
        <p className="text-ink-soft">המרצה לא נמצא/ה במאגר.</p>
      </Sheet>
    );
  }
  return <Body {...props} s={s} />;
}

function Body({ port, me, week, s, wide, onClose, onBack, backLabel, notify, clear, reload, onPlace, onLesson, focus }: SpeakerSheetProps & { s: Speaker }) {
  const edition = week.edition;
  // Opened for the call: there at once, and the focus on it — before the sheet would take it (a child's effect runs first).
  const callRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus !== "call") return;
    callRef.current?.scrollIntoView({ block: "start" });
    callRef.current?.focus({ preventScroll: true });
  }, [focus]);
  const actor = actorIn(me, edition);
  const a = week.approaches.find((x) => x.speaker_id === s.id) ?? null;
  // a call's result takes the pressed button away (the current status is not offered again): the focus stays in «השיחה»
  const seenStatus = useRef(a?.status);
  useEffect(() => {
    if (seenStatus.current === a?.status) return;
    seenStatus.current = a?.status;
    if (document.activeElement === document.body) callRef.current?.focus({ preventScroll: true });
  }, [a?.status]);
  const names = useMemo(() => new Map(week.team.map((t) => [t.id, t.display_name])), [week.team]);
  const nameOf = (id: number | null | undefined) => (id == null ? "—" : (names.get(id) ?? "חבר/ת צוות"));
  const { busy, run } = useRunner(notify, clear);

  // What a Week never carries: contacts (through their policy), past editions, the timeline — again whenever the
  // speaker or the approach changes (here or on another device): who sees the contacts may have changed with it.
  const { contacts, history, log, failed: sideFailed, reload: loadSide } = useSpeakerSide(port, s.id, [s.version, a?.version, a?.owner_member_id]);

  /** A command, then the week and the sheet's own reads again. */
  const act = async (key: string, fn: () => Promise<unknown>, ok: string | null, onRefused?: (code: string | null) => boolean) => {
    const done = await run(key, fn, ok, onRefused);
    await reload();
    void loadSide();
    return done;
  };

  const handler = !!a && a.owner_member_id != null && a.owner_member_id === actor.memberId;
  const mayManage = actor.canEdit && !!a && (actor.isAdmin || handler);
  const mayClaim = actor.canEdit && !s.retired && (!a || a.owner_member_id == null);
  const closedHere = week.lessons.filter((l) => l.state === "closed" && week.lessonSpeakers.some((x) => x.lesson_id === l.id && x.speaker_id === s.id));
  // the slots they are proposed for, still open
  const pitched = (a ? week.pitches.filter((p) => p.approach_id === a.id && LIVE_PITCH.has(p.state)) : [])
    .map((p) => week.lessons.find((l) => l.id === p.lesson_id))
    .filter((l): l is Lesson => !!l)
    .sort((x, y) => x.day - y.day || x.start_min - y.start_min);
  // «שבץ»: the grid's own flow (it offers a teammate's speaker to their handler); not once they declined, or taught here
  const mayPlace = !!onPlace && actor.canEdit && !s.retired && closedHere.length === 0 && a?.status !== "declined" && (mayManage || mayClaim);
  const calling = !!a && CALLING.has(a.status);
  const mySlots = useMemo(() => week.slotAvailability.filter((v) => v.speaker_id === s.id), [week.slotAvailability, s.id]);
  const mayMark = actor.canEdit && !s.retired;
  // what was last said with the approach (a call's result, a hand-over): the timeline holds the rest
  const lastNote = a && log?.find((e) => e.entity === "approaches" && e.entity_id === a.id && e.kind !== "availability" && typeof e.detail?.note === "string" && e.detail.note !== "");
  const tel = mayManage && calling ? telHref(contacts?.phone) : null;
  const wa = mayManage && calling ? waHref(contacts?.phone) : null;

  const lines = useMemo(
    () =>
      log
        ? timeline(log, {
            name: (id) => names.get(id) ?? null,
            gender: s.gender,
            lesson: (id) => {
              const l = week.lessons.find((x) => x.id === id);
              return l ? `${DAY_NAMES[l.day]} ${fmt(l.start_min)}` : null;
            },
          })
        : null,
    [log, names, s.gender, week.lessons],
  );

  // Who they are, in the header: approved is the normal case, so only the exceptions are said.
  const where = [s.disambiguator, s.affiliation].filter(Boolean).join(" · ");
  const facts = [
    where && <Meta key="where">{where}</Meta>,
    s.vetted === "pending" && (
      <Meta key="vet" tone="warn">
        {vettingLabel(s.vetted, s.gender)}
      </Meta>
    ),
    s.vetted === "rejected" && (
      <Meta key="vet" tone="bad">
        {vettingLabel(s.vetted, s.gender)}
      </Meta>
    ),
    s.retired && <Meta key="retired">{byGender(s.gender, "לא פעיל", "לא פעילה")}</Meta>,
  ].filter(Boolean);

  return (
    <Sheet
      wide={wide}
      // the dot and the name, as the lesson panel's heading that opens this sheet
      title={
        <span className="flex items-center gap-2">
          <GenderDot gender={s.gender} />
          {displayName(s)}
        </span>
      }
      label={displayName(s)}
      onClose={onClose}
      onBack={onBack}
      backLabel={backLabel}
      subtitle={facts.length > 0 ? facts : undefined}
    >
      <Details port={port} s={s} week={week} actor={actor} handler={handler} busy={busy} act={act} />

      <div ref={callRef} tabIndex={-1} className="scroll-mt-2 outline-none">
        <Section title="השיחה">
          <div className="space-y-2">
            <ApproachView s={s} a={a} actor={actor} handler={handler} nameOf={nameOf} />
            {lastNote && (
              <p className="break-words text-sm">
                <span className="text-ink-soft">
                  הערה אחרונה{lastNote.actor != null && ` (${nameOf(lastNote.actor)}, ${when(lastNote.at, DAY_ONLY)})`}:
                </span>{" "}
                «{String(lastNote.detail.note)}»
              </p>
            )}
            {a && (
              <HandOverOffer
                a={a}
                actor={actor}
                handler={handler}
                busy={busy}
                nameOf={nameOf}
                onAnswer={(accept) => void act(accept ? "accept" : "decline", () => port.speakers.answerHandOver(edition.id, a.id, accept), accept ? "הטיפול עבר אליך" : "ההצעה נדחתה")}
                onWithdraw={() => void act("withdraw", () => port.speakers.handOver(edition.id, a.id, actor.isAdmin ? a.owner_member_id : null), "ההצעה בוטלה")}
              />
            )}
            {mayClaim && (
              <Button kind="primary" busy={busy === "claim"} onClick={() => void act("claim", () => port.speakers.claim(edition.id, s.id), "המרצה בטיפולך")}>
                אני מטפל/ת
              </Button>
            )}
            {(tel || wa) && (
              <div className="flex flex-wrap gap-1.5">
                {tel && (
                  <a href={tel} className={s.contact_pref === "phone" ? LINK_PREFERRED : LINK_BUTTON}>
                    חיוג
                  </a>
                )}
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className={s.contact_pref === "whatsapp" ? LINK_PREFERRED : LINK_BUTTON}>
                    WhatsApp
                  </a>
                )}
              </div>
            )}
            {mayManage && a && calling && (
              <Fold title="נקודות לשיחה"defaultOpen={focus === "call"} className="rounded-xl border border-line bg-card px-3 py-0.5 shadow-sm">
                <CallPoints week={week} speakerGender={s.gender} memberId={actor.memberId} />
              </Fold>
            )}
            {mayManage && a && closedHere.length === 0 && (
              <CallResultFrame calling={calling}>
                <CallResults
                  status={a.status}
                  gender={s.gender}
                  busy={busy === "call"}
                  onResult={(st, note) => act("call", () => port.speakers.setStatus(edition.id, a.id, a.version, st, note), `עודכן: ${statusLabel(st, s.gender)}`)}
                />
              </CallResultFrame>
            )}
            {mayManage && closedHere.length > 0 && <p className="text-xs text-ink-soft">יש שיעור סגור במחזור. כדי לשנות את המצב, קודם פותחים אותו מחדש.</p>}
            {mayManage && a && <HandOver key={`${a.id}:${a.owner_member_id}`} team={week.team} a={a} actor={actor} busy={busy} onGo={(to, note) => act("handover", () => port.speakers.handOver(edition.id, a.id, to, note), handOverText(s, to, actor, nameOf))} />}
          </div>
        </Section>
      </div>

      <Vetting s={s} actor={actor} nameOf={nameOf} busy={busy} onVet={(state, note) => act(`vet:${state}`, () => port.speakers.vet([s.id], state, note), vetText(state, s))} />

      {(pitched.length > 0 || mayPlace || closedHere.length > 0) && (
        <Section title="השיעור">
          <div className="space-y-2">
            {pitched.length > 0 && (
              <ul aria-label={`${byGender(s.gender, "מוצע", "מוצעת")} במשבצות`} className="space-y-1.5">
                {pitched.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card px-3 py-1.5 text-sm shadow-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-bold text-navy">
                        {DAY_NAMES[l.day]} <bdi>{fmtRange(l.start_min, l.end_min)}</bdi>
                      </span>
                      {l.title && ` · ${l.title}`}
                    </span>
                    {onLesson && <Button onClick={() => onLesson(l.id)}>לשיעור</Button>}
                  </li>
                ))}
              </ul>
            )}
            {mayPlace && onPlace && (
              <Button kind={a?.status === "positive" && pitched.length === 0 ? "primary" : "secondary"} onClick={() => onPlace(s.id)}>
                שבץ בשבוע
              </Button>
            )}
            {closedHere.length > 0 && (
              <ClosedLessons
                week={week}
                s={s}
                lessons={closedHere}
                actor={actor}
                contacts={contacts}
                busy={busy}
                notify={notify}
                onSent={(l) => void act(`sent:${l.id}`, () => port.commands(edition.id).markConfirmSent(l.id, l.version), "סומן שההודעה נשלחה")}
                onLesson={onLesson}
              />
            )}
          </div>
        </Section>
      )}

      <Section title="זמינות">
        <SlotGrid
          rows={week.rows}
          edition={edition}
          slots={mySlots}
          gender={s.gender}
          onSet={mayMark ? (day, rowId, kind, note) => act("slot", () => port.speakers.setSlotAvailability(edition.id, s.id, day, rowId, kind, note), null) : undefined}
        />
        {!actor.canEdit && <p className="mt-2 text-xs text-ink-soft">צפייה בלבד: את הזמינות מסמנים צוות התוכן והמדריך/ה.</p>}
      </Section>

      <Section title="פרטי קשר">
        {sideFailed && contacts === undefined ? (
          <p role="alert" className="text-sm text-bad">
            לא הצלחנו לטעון. <button type="button" className="inline-flex min-h-11 items-center font-bold text-navy underline underline-offset-4" onClick={() => void loadSide()}>לנסות שוב</button>
          </p>
        ) : contacts === undefined ? (
          <p className="text-sm text-ink-soft">טוען…</p>
        ) : contacts === null ? (
          <p className="text-sm text-ink-soft">
            {handler && !(edition.kind === "real" && edition.status !== "archived")
              ? "פרטי הקשר נפתחים רק במחזור האמיתי של השנה."
              : errorMessage("contacts_hidden")}
          </p>
        ) : (
          <Contacts key={`${s.id}`} s={s} c={contacts} busy={busy} onSave={(c, onRefused) => act("contacts", () => port.speakers.setContacts(s.id, c), "פרטי הקשר נשמרו", onRefused)} />
        )}
      </Section>

      <TaughtHere port={port} s={s} actor={actor} edition={edition} categories={week.categories} history={history} failed={sideFailed} />

      <Timeline lines={lines} failed={sideFailed} />
    </Sheet>
  );
}

// ------------------------------------------------------------------ details

function Details({ port, s, week, actor, handler, busy, act }: { port: DataPort; s: Speaker; week: Week; actor: Actor; handler: boolean; busy: string | null; act: Act }) {
  const [editing, setEditing] = useState(false);
  const mayEdit = mayEditSpeaker(actor, week.edition, handler);
  if (editing) {
    return (
      <ProfileEdit
        s={s}
        week={week}
        actor={actor}
        busy={busy}
        onDone={() => setEditing(false)}
        onSave={(patch, onRefused) => act("profile", () => port.speakers.update(week.edition.id, s.id, s.version, patch), "הפרטים נשמרו", onRefused)}
      />
    );
  }
  const topics = topicsOf(s.topics, week.categories);
  // No heading: the bio and the topics open the sheet; «עריכה» on its far end, as «פרטי השיעור» in the lesson panel.
  return (
    <section aria-label="פרטים" className="space-y-2">
      <div className="flex items-start gap-2">
        {s.bio_short ? <p className="min-w-0 flex-1 whitespace-pre-line">{s.bio_short}</p> : <p className="min-w-0 flex-1 text-sm text-ink-soft">אין תיאור.</p>}
        {mayEdit && (
          <Button kind="quiet" className="-me-2 -mt-2.5 shrink-0" onClick={() => setEditing(true)}>
            עריכה
          </Button>
        )}
      </div>
      {!s.gender && <p className="text-sm font-bold text-warn">מגדר לא ידוע: צריך להשלים לפני סגירת שיעור</p>}
      {topics.length > 0 && (
        <ul aria-label="נושאים" className="flex flex-wrap gap-1">
          {topics.map((t) => (
            <li key={t.name}>
              <TopicChip name={t.name} category={t.category} />
            </li>
          ))}
        </ul>
      )}
      {!mayEdit && (handler || actor.isAdmin) && actor.canEdit && <p className="text-xs text-ink-soft">את הפרטים עורכים רק במחזור האמיתי של השנה.</p>}
    </section>
  );
}

// ------------------------------------------------------------------ the approach

/** The speaker's closed lessons this edition: the stage dots, «לשיעור», and — where they lead it — the summary message. */
function ClosedLessons({
  week,
  s,
  lessons,
  actor,
  contacts,
  busy,
  notify,
  onSent,
  onLesson,
}: {
  week: Week;
  s: Speaker;
  lessons: Lesson[];
  actor: Actor;
  contacts: SpeakerContacts | null | undefined;
  busy: string | null;
  notify: Notify;
  onSent: (l: Lesson) => void;
  onLesson?: (id: number) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ul aria-label="שיעורים סגורים במחזור" className="space-y-1.5">
      {lessons.map((l) => {
        const lead = week.lessonSpeakers.find((x) => x.lesson_id === l.id && x.role === "lead")?.speaker_id === s.id;
        const handler = week.approaches.find((x) => x.speaker_id === s.id)?.owner_member_id ?? null;
        const mine = lead && actor.canEdit && (actor.isAdmin || (handler != null && handler === actor.memberId));
        return (
          <li key={l.id} className="space-y-1 rounded-xl border border-line bg-card px-3 pb-1 pt-2 text-sm shadow-sm">
            <p className="min-w-0">
              <span className="font-bold text-navy">
                {DAY_NAMES[l.day]} <bdi>{fmtRange(l.start_min, l.end_min)}</bdi>
              </span>{" "}
              · {l.title ?? "כותרת: TBD"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <StageDots lesson={l} week={week} />
              {l.needs_reconfirm && <ReconfirmDot />}
              {lead && (
                <Button kind="quiet" aria-expanded={open === l.id} onClick={() => setOpen((cur) => (cur === l.id ? null : l.id))}>
                  הודעת סיכום <span aria-hidden>{open === l.id ? "▴" : "▾"}</span>
                </Button>
              )}
              {onLesson && (
                <Button className="ms-auto" onClick={() => onLesson(l.id)}>
                  לשיעור
                </Button>
              )}
            </div>
            {lead && open === l.id && (
              <div className="border-t border-line pb-1 pt-2">
                <MessageComposer
                  week={week}
                  lesson={l}
                  speaker={s}
                  actor={actor}
                  handler={handler}
                  mine={mine}
                  contacts={mine ? contacts : null}
                  busy={busy === `sent:${l.id}`}
                  notify={notify}
                  onSent={() => onSent(l)}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------ contacts

// ------------------------------------------------------------------ vetting (a global admin's)

function Vetting(props: Parameters<typeof VetForm>[0]) {
  return (
    <Section title="אישור המדריך/ה">
      <VetForm {...props} />
    </Section>
  );
}
