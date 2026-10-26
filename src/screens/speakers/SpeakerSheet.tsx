// The speaker sheet («פרופיל מרצה»): who they are, who handles them this
// edition and where that stands, their contacts (only for the people the
// contacts policy names — a global admin, or the handler in the current real
// edition), the availability chips, the admin's vetting, what they taught in
// past editions and how it went (SpeakerReviews.tsx), and the timeline, folded;
// each closed lesson with its five stage dots
// and the summary message (the same composer as the lesson panel, with the
// contacts this sheet already holds). Opened from the pool, from a lesson, from
// «המרצים שלי» and from the approvals queue; the same grid sheet (Panels.tsx)
// at the side on a wide screen, from the bottom on a phone.
//
// Every change is a port command (docs/CONTRACT.md «The speaker pool"), so the
// demo refuses exactly what the database refuses; a refusal reads in Hebrew.
import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import type { DataPort } from "../../data/port";
import { LIMITS, titlesOf } from "../../data/speakerRules";
import type { ActivityEntry, HistoryLesson, SpeakerPatch } from "../../data/speakers";
import type { Me } from "../../data/types";
import { timeline } from "../../domain/activityText";
import { mailHref, telHref, waHref } from "../../domain/contactLinks";
import { byGender, displayName } from "../../domain/names";
import { DAY_NAMES, fmt, fmtRange } from "../../domain/time";
import type { Approach, ApproachStatus, ContactPref, Lesson, Speaker, SpeakerContacts, TeamMember, Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { GenderDot, ReconfirmDot, StageDots, TopicChip, topicsOf } from "../../grid/bits";
import { Meta, Section, Sheet } from "../../grid/Panels";
import { CONTACT_PREF_LABEL, statusLabel, vettingLabel } from "../../lib/labels";
import { Button, Field, Fold, INPUT, useRunner } from "../settings/kit";
import { type Actor, actorIn } from "../weekStore";
import { MessageComposer } from "../stages/MessageComposer";
import { AvailabilityGrid, formOf, type Notify, patchOf, type ProfileForm, ProfileFields } from "./parts";
import { TaughtHere } from "./SpeakerReviews";

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

const LINK_BUTTON = "inline-flex min-h-11 items-center rounded-lg border border-line bg-paper px-3 text-sm font-semibold hover:bg-line/50";
/** The speaker's preferred channel: its button is the primary one. */
const LINK_PREFERRED = "inline-flex min-h-11 items-center rounded-lg bg-ink px-3 text-sm font-semibold text-paper hover:bg-ink/90";

const STATUS_ORDER: ApproachStatus[] = ["claimed", "approached", "positive", "declined", "no_answer"];

/** The status as a short button. */
function statusButton(st: ApproachStatus, s: Speaker): string {
  if (st === "approached") return "פנו";
  return statusLabel(st, s.gender);
}

const WHEN = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
const DAY = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" });
const when = (at: string, f = WHEN) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : f.format(d);
};

function Body({ port, me, week, s, wide, onClose, onBack, backLabel, notify, clear, reload, onPlace, onLesson }: SpeakerSheetProps & { s: Speaker }) {
  const edition = week.edition;
  const actor = actorIn(me, edition);
  const a = week.approaches.find((x) => x.speaker_id === s.id) ?? null;
  const names = useMemo(() => new Map(week.team.map((t) => [t.id, t.display_name])), [week.team]);
  const nameOf = (id: number | null | undefined) => (id == null ? "—" : (names.get(id) ?? "חבר/ת צוות"));
  const { busy, run } = useRunner(notify, clear);

  // What a Week never carries: contacts (through their policy), past editions, the timeline.
  const [contacts, setContacts] = useState<SpeakerContacts | null | undefined>(undefined);
  const [history, setHistory] = useState<HistoryLesson[] | null>(null);
  const [log, setLog] = useState<ActivityEntry[] | null>(null);
  const [sideFailed, setSideFailed] = useState(false);
  const loadSide = useCallback(async () => {
    try {
      const [c, h, l] = await Promise.all([port.speakers.contacts(s.id), port.speakers.history(s.id), port.speakers.activity(s.id)]);
      setContacts(c);
      setHistory(h);
      setLog(l);
      setSideFailed(false);
    } catch {
      setSideFailed(true);
    }
  }, [port, s.id]);
  // Again whenever the speaker or the approach changes (here or on another device): who sees the contacts may have changed with it.
  useEffect(() => void loadSide(), [loadSide, s.version, a?.version, a?.owner_member_id]);

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

      <Section title="הטיפול השנה">
        <div className="space-y-2">
          <ApproachView s={s} a={a} actor={actor} handler={handler} nameOf={nameOf} />
          {a?.offered_to != null && a.offered_to === actor.memberId && actor.canEdit && (
            <div role="group" aria-label="העברה שמחכה לך" className="space-y-2 rounded-lg border border-accent bg-accent-soft p-3">
              <p className="text-sm">{nameOf(a.owner_member_id)} מציע/ה להעביר אליך את הטיפול.</p>
              <div className="flex flex-wrap gap-2">
                <Button kind="primary" busy={busy === "accept"} onClick={() => void act("accept", () => port.speakers.answerHandOver(edition.id, a.id, true), "הטיפול עבר אליך")}>
                  קבלת הטיפול
                </Button>
                <Button busy={busy === "decline"} onClick={() => void act("decline", () => port.speakers.answerHandOver(edition.id, a.id, false), "ההצעה נדחתה")}>
                  דחיית ההצעה
                </Button>
              </div>
            </div>
          )}
          {a?.offered_to != null && a.offered_to !== actor.memberId && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>
                הוצע להעביר את הטיפול ל{nameOf(a.offered_to)}. עד שתתקבל תשובה, הטיפול לא עובר.
              </span>
              {(handler || actor.isAdmin) && actor.canEdit && (
                // The handler withdraws with «to nobody»; for an admin that would send the speaker back to the
                // pool (an admin reassigns at once), so an admin "reassigns" to the same handler, which clears the offer.
                <Button
                  kind="quiet"
                  busy={busy === "withdraw"}
                  onClick={() => void act("withdraw", () => port.speakers.handOver(edition.id, a.id, actor.isAdmin ? a.owner_member_id : null), "ההצעה בוטלה")}
                >
                  ביטול ההצעה
                </Button>
              )}
            </div>
          )}
          {mayClaim && (
            <Button kind="primary" busy={busy === "claim"} onClick={() => void act("claim", () => port.speakers.claim(edition.id, s.id), "המרצה בטיפולך")}>
              אני מטפל/ת
            </Button>
          )}
          {mayManage && a && (
            <StatusControls
              key={a.id}
              s={s}
              a={a}
              closedHere={closedHere.length > 0}
              busy={busy}
              onSet={(st, note) =>
                act(`status:${st}`, () => port.speakers.setStatus(edition.id, a.id, a.version, st, note), st === a.status ? "ההערה נשמרה" : `עודכן: ${statusLabel(st, s.gender)}`)
              }
            />
          )}
          {a?.status === "positive" && closedHere.length === 0 && mayManage && onPlace && (
            <Button kind="primary" onClick={() => onPlace(s.id)}>
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
          {mayManage && a && <HandOver key={`${a.id}:${a.owner_member_id}`} team={week.team} a={a} actor={actor} busy={busy} onGo={(to, note) => act("handover", () => port.speakers.handOver(edition.id, a.id, to, note), handOverText(s, to, actor, nameOf))} />}
        </div>
      </Section>

      <Section title="פרטי קשר">
        {sideFailed && contacts === undefined ? (
          <p role="alert" className="text-sm text-bad">
            לא הצלחנו לטעון. <button type="button" className="underline" onClick={() => void loadSide()}>לנסות שוב</button>
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

      <Section title="זמינות">
        {!a && <p className="mb-2 text-xs text-ink-soft">נשמרת אצל מי שמטפל/ת השנה.</p>}
        <AvailabilityGrid
          rows={a ? week.availability.filter((v) => v.approach_id === a.id) : []}
          gender={s.gender}
          busy={busy === "avail"}
          onSet={mayManage ? (day, part, kind, note) => act("avail", () => port.speakers.setAvailability(edition.id, s.id, day, part, kind, note), "הזמינות נשמרה") : undefined}
        />
        {a && !mayManage && <p className="mt-2 text-xs text-ink-soft">את הזמינות מעדכנים מי שמטפל/ת במרצה והמדריך/ה.</p>}
      </Section>

      <Vetting s={s} actor={actor} nameOf={nameOf} busy={busy} onVet={(state, note) => act(`vet:${state}`, () => port.speakers.vet([s.id], state, note), vetText(state, s))} />

      <TaughtHere port={port} s={s} actor={actor} edition={edition} categories={week.categories} history={history} failed={sideFailed} />

      <Timeline lines={lines} failed={sideFailed} />
    </Sheet>
  );
}

/** «מה קרה»: occasional reading, folded — its summary says how much there is and when it last moved. */
function Timeline({ lines, failed }: { lines: ReturnType<typeof timeline> | null; failed: boolean }) {
  if (lines == null || lines.length === 0) {
    return (
      <Section title="מה קרה" label="ציר הפעולות" count={lines == null ? (failed ? "לא נטען" : "טוען…") : "אין עדיין"}>
        {null}
      </Section>
    );
  }
  const latest = lines.reduce((m, l) => (l.at > m ? l.at : m), lines[0].at);
  return (
    <section aria-label="ציר הפעולות">
      <Fold title="מה קרה" hint={`${lines.length === 1 ? "פעולה אחת" : `${lines.length} פעולות`} · אחרונה ${when(latest, DAY)}`}>
        <ol className="space-y-1.5 text-sm">
          {lines.map((l) => (
            <li key={l.id} className="border-s-2 border-line ps-2">
              <span className="text-xs text-ink-soft tabular-nums">
                <bdi>{when(l.at)}</bdi>
              </span>{" "}
              {l.who && <b>{l.who}: </b>}
              {l.text}
              {l.note && <span className="block text-ink-soft">«{l.note}»</span>}
            </li>
          ))}
        </ol>
      </Fold>
    </section>
  );
}

function handOverText(s: Speaker, to: number | null, actor: Actor, nameOf: (id: number | null) => string): string {
  if (!actor.isAdmin) return to == null ? "ההצעה בוטלה" : `הוצע ל${nameOf(to)} לקבל את הטיפול`;
  return to == null ? `${displayName(s)} ${byGender(s.gender, "חזר", "חזרה")} למאגר, בלי מטפל/ת` : `הטיפול עבר ל${nameOf(to)}`;
}

function vetText(state: Speaker["vetted"], s: Speaker): string {
  if (state === "approved") return `${displayName(s)} ${byGender(s.gender, "אושר", "אושרה")}`;
  if (state === "rejected") return `${displayName(s)} ${byGender(s.gender, "לא אושר", "לא אושרה")}`;
  return `${displayName(s)} ${byGender(s.gender, "הוחזר", "הוחזרה")} להמתנה`;
}

// ------------------------------------------------------------------ details

type Act = (key: string, fn: () => Promise<unknown>, ok: string | null, onRefused?: (code: string | null) => boolean) => Promise<boolean>;

/**
 * The speaker's own record is one row across the years (CONTRACT «update»): a global admin, or — in a real
 * edition that is not archived — its admin or the speaker's handler there. A practice or demo week
 * (anyone there may claim any pool speaker) and an archived edition give no such right.
 */
export function mayEditSpeaker(actor: Actor, edition: Week["edition"], handler: boolean): boolean {
  if (actor.global) return true;
  const live = edition.kind === "real" && edition.status !== "archived";
  return actor.canEdit && live && (actor.isAdmin || handler);
}

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
      {!s.gender && <p className="text-sm font-semibold text-amber-900">מגדר לא ידוע: צריך להשלים לפני סגירת שיעור</p>}
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

const PROFILE_FIELD: Record<string, "name" | "disambiguator"> = { name_required: "name", disambiguator_required: "disambiguator", speaker_exists: "disambiguator" };

function ProfileEdit({
  s,
  week,
  actor,
  busy,
  onDone,
  onSave,
}: {
  s: Speaker;
  week: Week;
  actor: Actor;
  busy: string | null;
  onDone: () => void;
  onSave: (patch: SpeakerPatch, onRefused: (code: string | null) => boolean) => Promise<boolean>;
}) {
  const id = useId();
  const [form, setForm] = useState<ProfileForm>(() => formOf(s));
  const [retired, setRetired] = useState(s.retired);
  const [problem, setProblem] = useState<{ text: string; field: "name" | "disambiguator" | null } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const patch: SpeakerPatch = { ...patchOf(s, form), ...(retired !== s.retired ? { retired } : {}) };
    if (Object.keys(patch).length === 0) return onDone();
    const ok = await onSave(patch, (code) => {
      if (!code || !["name_required", "disambiguator_required", "speaker_exists", "bad_value", "lesson_closed"].includes(code)) return false;
      setProblem({ text: errorMessage(code), field: PROFILE_FIELD[code] ?? null });
      return true;
    });
    if (ok) onDone();
  };
  return (
    <form onSubmit={(e) => void submit(e)} aria-label="עריכת הפרטים" className="space-y-3 rounded-lg border border-line bg-paper p-3" noValidate>
      <ProfileFields id={id} form={form} set={(p) => setForm((f) => ({ ...f, ...p }))} titles={titlesOf(week.edition.settings)} categories={week.categories} withName invalid={problem?.field ?? null} problem={problem?.text} />
      {actor.global && (
        <label className="flex min-h-11 cursor-pointer items-center gap-2">
          <input type="checkbox" checked={retired} onChange={(e) => setRetired(e.target.checked)} className="size-5 accent-ink" />
          {byGender(s.gender, "לא פעיל", "לא פעילה")}: לא {byGender(s.gender, "מוצע", "מוצעת")} יותר מהמאגר
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" type="submit" busy={busy === "profile"} busyLabel="שומר…">
          שמירה
        </Button>
        <Button onClick={onDone}>ביטול</Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ the approach

function ApproachView({ s, a, actor, handler, nameOf }: { s: Speaker; a: Approach | null; actor: Actor; handler: boolean; nameOf: (id: number | null) => string }) {
  if (!a || a.owner_member_id == null) {
    return (
      <p className="text-sm">
        {a ? `אין מטפל/ת כרגע · ${statusLabel(a.status, s.gender)}` : "אף אחד/ת עוד לא מטפל/ת במרצה במחזור הזה."}
        {!actor.canEdit && " (צפייה בלבד)"}
      </p>
    );
  }
  return (
    <p className="text-sm">
      <b>{handler ? "בטיפולך" : `בטיפול ${nameOf(a.owner_member_id)}`}</b> · {statusLabel(a.status, s.gender)}
    </p>
  );
}

function StatusControls({
  s,
  a,
  closedHere,
  busy,
  onSet,
}: {
  s: Speaker;
  a: Approach;
  closedHere: boolean;
  busy: string | null;
  onSet: (st: ApproachStatus, note: string | null) => Promise<boolean>;
}) {
  const id = useId();
  const [note, setNote] = useState("");
  const vetted = s.vetted === "approved";
  return (
    <div className="space-y-2 rounded-lg border border-line bg-paper p-3">
      <div role="group" aria-label="מצב הפנייה" className="flex flex-wrap gap-1.5">
        {STATUS_ORDER.map((st) => {
          const current = st === a.status;
          const disabled = !current && (((st === "approached" || st === "positive") && !vetted) || (closedHere && st !== "positive"));
          return (
            <Button
              key={st}
              kind={current ? "primary" : "secondary"}
              aria-pressed={current}
              disabled={disabled}
              busy={busy === `status:${st}`}
              onClick={async () => {
                if (current && !note.trim()) return; // already so: tapping it again only adds a note
                if (await onSet(st, note.trim() || null)) setNote("");
              }}
            >
              {statusButton(st, s)}
            </Button>
          );
        })}
      </div>
      <Field id={`${id}-note`} label="הערה (לא חובה)" hint="נשמרת עם השינוי (או עם המצב הנוכחי), וגלויה לצוות המחזור. בלי מספרי טלפון: אלה נכנסים לפרטי הקשר.">
        <input id={`${id}-note`} value={note} maxLength={LIMITS.note} onChange={(e) => setNote(e.target.value)} className={INPUT} placeholder="למשל: שלחתי הודעה, מחכים לתשובה" />
      </Field>
      {!vetted && <p className="text-xs text-ink-soft">«פנו» ו«{byGender(s.gender, "הסכים", "הסכימה")}» אחרי אישור המדריך/ה.</p>}
      {closedHere && <p className="text-xs text-ink-soft">יש שיעור סגור במחזור. כדי לשנות את המצב, קודם פותחים אותו מחדש.</p>}
    </div>
  );
}

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
          <li key={l.id} className="space-y-1 rounded-lg border border-line bg-card px-3 pb-1 pt-2 text-sm">
            <p className="min-w-0">
              <span className="font-semibold">
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

/**
 * «העברה». The handler offers the speaker to another member, who accepts or
 * gives it back (until then nothing moves, contacts included); an admin of the
 * edition moves it at once, or back to the pool.
 */
function HandOver({ team, a, actor, busy, onGo }: { team: TeamMember[]; a: Approach; actor: Actor; busy: string | null; onGo: (to: number | null, note: string | null) => Promise<boolean> }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const options = team.filter((t) => (t.role === "content" || t.role === "admin") && t.id !== a.owner_member_id && (actor.isAdmin || t.id !== actor.memberId));
  if (!open) {
    return (
      <Button kind="quiet" onClick={() => setOpen(true)} aria-expanded={false}>
        העברה לחבר/ת צוות <span aria-hidden>▾</span>
      </Button>
    );
  }
  const go = async () => {
    if (await onGo(to === "pool" ? null : Number(to), note.trim() || null)) setOpen(false);
  };
  return (
    <div role="group" aria-label="העברת הטיפול" className="space-y-2 rounded-lg border border-line bg-paper p-3">
      <Field id={`${id}-to`} label={actor.isAdmin ? "להעביר ל…" : "להציע ל…"}>
        <select id={`${id}-to`} value={to} onChange={(e) => setTo(e.target.value)} className={INPUT}>
          <option value="">בחירה</option>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.display_name}
            </option>
          ))}
          {actor.isAdmin && a.owner_member_id != null && <option value="pool">בחזרה למאגר, בלי מטפל/ת</option>}
        </select>
      </Field>
      <Field id={`${id}-note`} label="הערה להעברה (לא חובה)">
        <input id={`${id}-note`} value={note} maxLength={LIMITS.note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
      </Field>
      <p className="text-xs text-ink-soft">
        {actor.isAdmin ? "ההעברה מיידית." : "הטיפול עובר רק כשהצד השני מקבל/ת."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" disabled={!to} busy={busy === "handover"} onClick={() => void go()}>
          {actor.isAdmin ? "העברה" : "הצעה להעביר"}
        </Button>
        <Button onClick={() => setOpen(false)}>ביטול</Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ contacts

const CONTACT_FIELD: Record<string, "phone" | "email"> = { bad_phone: "phone", bad_contact_email: "email" };

function Contacts({ s, c, busy, onSave }: { s: Speaker; c: SpeakerContacts; busy: string | null; onSave: (c: SpeakerContacts, onRefused: (code: string | null) => boolean) => Promise<boolean> }) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SpeakerContacts>(c);
  const [problem, setProblem] = useState<{ text: string; field: "phone" | "email" | null } | null>(null);
  useEffect(() => {
    if (!editing) setDraft(c);
  }, [c, editing]);
  const empty = !c.phone && !c.email && !c.secretary_note && !c.notes;

  if (editing) {
    const set = (p: Partial<SpeakerContacts>) => setDraft((d) => ({ ...d, ...p }));
    const err = (f: "phone" | "email") => (problem?.field === f ? { "aria-invalid": true as const, "aria-describedby": `${id}-problem` } : {});
    const submit = async (e: FormEvent) => {
      e.preventDefault();
      setProblem(null);
      const clean = (v: string | null) => (v && v.trim() ? v : null);
      const ok = await onSave({ phone: clean(draft.phone), email: clean(draft.email), secretary_note: clean(draft.secretary_note), notes: clean(draft.notes) }, (code) => {
        if (!code || !["bad_phone", "bad_contact_email", "bad_value"].includes(code)) return false;
        setProblem({ text: errorMessage(code), field: CONTACT_FIELD[code] ?? null });
        return true;
      });
      if (ok) setEditing(false);
    };
    return (
      <form onSubmit={(e) => void submit(e)} aria-label="עריכת פרטי הקשר" className="space-y-3 rounded-lg border border-line bg-paper p-3" noValidate>
        <Field id={`${id}-phone`} label="טלפון">
          <input id={`${id}-phone`} type="tel" inputMode="tel" dir="ltr" value={draft.phone ?? ""} maxLength={LIMITS.phone} onChange={(e) => set({ phone: e.target.value })} className={INPUT} autoComplete="off" {...err("phone")} />
        </Field>
        <Field id={`${id}-email`} label="מייל">
          <input id={`${id}-email`} type="email" dir="ltr" value={draft.email ?? ""} maxLength={LIMITS.email} onChange={(e) => set({ email: e.target.value })} className={INPUT} autoComplete="off" {...err("email")} />
        </Field>
        {problem && (
          <p id={`${id}-problem`} role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
            {problem.text}
          </p>
        )}
        <Field id={`${id}-sec`} label="דרך המזכירות">
          <textarea id={`${id}-sec`} rows={2} value={draft.secretary_note ?? ""} maxLength={LIMITS.secretary_note} onChange={(e) => set({ secretary_note: e.target.value })} className={`${INPUT} py-2`} />
        </Field>
        <Field id={`${id}-notes`} label="הערות לפנייה">
          <textarea id={`${id}-notes`} rows={3} value={draft.notes ?? ""} maxLength={LIMITS.contact_notes} onChange={(e) => set({ notes: e.target.value })} className={`${INPUT} py-2`} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button kind="primary" type="submit" busy={busy === "contacts"} busyLabel="שומר…">
            שמירה
          </Button>
          <Button
            onClick={() => {
              setProblem(null);
              setEditing(false);
            }}
          >
            ביטול
          </Button>
        </div>
      </form>
    );
  }

  const tel = telHref(c.phone);
  const wa = waHref(c.phone);
  const mail = mailHref(c.email);
  // The preferred channel is said once: its button is the primary one, and «מועדף» beside it; a channel with
  // nothing to press (no number, no address) is said in a line.
  const pref = s.contact_pref;
  const link = (p: ContactPref) => (pref === p ? LINK_PREFERRED : LINK_BUTTON);
  const mark = (p: ContactPref) => pref === p && <span className="text-xs text-ink-soft">מועדף</span>;
  const pressable: Record<ContactPref, boolean> = { phone: !!tel, whatsapp: !!wa, email: !!mail, secretary: !!c.secretary_note };
  return (
    <div className="space-y-2">
      {empty ? (
        <p className="text-sm text-ink-soft">עוד לא נרשמו פרטי קשר.</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-2 text-sm">
          {c.phone && (
            <>
              <dt className="pt-0.5 text-ink-soft">טלפון</dt>
              <dd className="min-w-0 space-y-1">
                <div className="break-all">
                  <bdi>{c.phone}</bdi>
                </div>
                {(tel || wa) && (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {tel && (
                      <a href={tel} className={link("phone")}>
                        חיוג
                      </a>
                    )}
                    {tel && mark("phone")}
                    {wa && (
                      <a href={wa} target="_blank" rel="noopener noreferrer" className={link("whatsapp")}>
                        WhatsApp
                      </a>
                    )}
                    {wa && mark("whatsapp")}
                  </span>
                )}
              </dd>
            </>
          )}
          {c.email && (
            <>
              <dt className="pt-0.5 text-ink-soft">מייל</dt>
              <dd className="min-w-0 space-y-1">
                <div className="break-all">
                  <bdi>{c.email}</bdi>
                </div>
                {mail && (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <a href={mail} className={link("email")}>
                      שליחת מייל
                    </a>
                    {mark("email")}
                  </span>
                )}
              </dd>
            </>
          )}
          {c.secretary_note && (
            <>
              <dt className="text-ink-soft">דרך המזכירות</dt>
              <dd className="min-w-0 whitespace-pre-line break-words">
                {c.secretary_note}
                {pref === "secretary" && <span className="block text-xs text-ink-soft">מועדף</span>}
              </dd>
            </>
          )}
          {c.notes && (
            <>
              <dt className="text-ink-soft">הערות</dt>
              <dd className="min-w-0 whitespace-pre-line break-words">{c.notes}</dd>
            </>
          )}
        </dl>
      )}
      {pref && !pressable[pref] && <p className="text-xs text-ink-soft">ערוץ מועדף: {CONTACT_PREF_LABEL[pref]}</p>}
      <Button onClick={() => setEditing(true)}>עריכת פרטי הקשר</Button>
    </div>
  );
}

// ------------------------------------------------------------------ vetting (a global admin's)

function Vetting({ s, actor, nameOf, busy, onVet }: { s: Speaker; actor: Actor; nameOf: (id: number | null) => string; busy: string | null; onVet: (state: Speaker["vetted"], note: string | null) => Promise<boolean> }) {
  const id = useId();
  const [note, setNote] = useState("");
  // Open for a speaker waiting for approval; once decided, behind «שינוי האישור» (it is not news on every sheet).
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [s.id, s.vetted]);
  const choices: [Speaker["vetted"], string][] = [
    ["approved", "אישור"],
    ["rejected", "דחייה"],
    ["pending", "החזרה להמתנה"],
  ];
  return (
    <Section title="אישור המדריך/ה">
      <div className="space-y-2">
        <p className="text-sm">
          {vettingLabel(s.vetted, s.gender)}
          {s.vetted !== "pending" && s.vetted_by != null && <span className="text-ink-soft"> · {nameOf(s.vetted_by)}</span>}
        </p>
        {s.vetted_note && <p className="text-sm text-ink-soft">«{s.vetted_note}»</p>}
        {actor.global && s.vetted !== "pending" && !open && (
          <Button onClick={() => setOpen(true)} aria-expanded={false}>
            שינוי האישור
          </Button>
        )}
        {actor.global && (s.vetted === "pending" || open) && (
          <div className="space-y-2 rounded-lg border border-line bg-paper p-3">
            <Field id={`${id}-note`} label="הערה על האישור (לא חובה, גלויה לכל הצוות)">
              <input id={`${id}-note`} value={note} maxLength={LIMITS.vetted_note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
            </Field>
            <div className="flex flex-wrap gap-2">
              {choices
                .filter(([st]) => st !== s.vetted || note.trim())
                .map(([st, label]) => (
                  <Button
                    key={st}
                    kind={st === "approved" ? "primary" : "secondary"}
                    busy={busy === `vet:${st}`}
                    onClick={async () => {
                      if (await onVet(st, note.trim() || null)) setNote("");
                    }}
                  >
                    {label}
                  </Button>
                ))}
              {open && (
                <Button kind="quiet" onClick={() => setOpen(false)}>
                  ביטול
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
