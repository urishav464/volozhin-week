// The speaker sheet («פרופיל מרצה»): who they are, who handles them this
// edition and where that stands, their contacts (only for the people the
// contacts policy names — a global admin, or the handler in the current real
// edition), the availability chips, the admin's vetting, what they taught in
// past editions, and the timeline. Opened from the pool, from a lesson, from
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
import type { Approach, ApproachStatus, Lesson, Speaker, SpeakerContacts, TeamMember, Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Chip } from "../../grid/bits";
import { Sheet } from "../../grid/Panels";
import { CONTACT_PREF_LABEL, statusLabel, vettingLabel } from "../../lib/labels";
import { Button, Field, GENDER_LABEL, INPUT, useRunner } from "../settings/kit";
import { type Actor, actorIn } from "../weekStore";
import { AvailabilityGrid, formOf, type Notify, patchOf, type ProfileForm, ProfileFields, Section } from "./parts";

export interface SpeakerSheetProps {
  port: DataPort;
  me: Me;
  week: Week;
  speakerId: number;
  wide: boolean;
  onClose: () => void;
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
      <Sheet wide={props.wide} title="מרצה" onClose={props.onClose}>
        <p className="text-ink-soft">המרצה לא נמצא/ה במאגר.</p>
      </Sheet>
    );
  }
  return <Body {...props} s={s} />;
}

const LINK_BUTTON = "inline-flex min-h-11 items-center rounded-lg border border-line bg-paper px-3 text-sm font-semibold hover:bg-line/50";

const STATUS_ORDER: ApproachStatus[] = ["claimed", "approached", "positive", "declined", "no_answer"];

/** The status as a short button. */
function statusButton(st: ApproachStatus, s: Speaker): string {
  if (st === "approached") return "פנו";
  return statusLabel(st, s.gender);
}

const WHEN = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
const when = (at: string) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : WHEN.format(d);
};

function Body({ port, me, week, s, wide, onClose, notify, clear, reload, onPlace, onLesson }: SpeakerSheetProps & { s: Speaker }) {
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

  return (
    <Sheet
      wide={wide}
      title={displayName(s)}
      onClose={onClose}
      subtitle={
        <span className="flex flex-wrap items-center gap-1.5">
          {s.disambiguator && <span>{s.disambiguator}</span>}
          {s.affiliation && <span>{s.affiliation}</span>}
          <Chip tone={s.vetted === "approved" ? "ok" : s.vetted === "rejected" ? "bad" : "warn"}>{vettingLabel(s.vetted, s.gender)}</Chip>
          {s.retired && <Chip>{byGender(s.gender, "לא פעיל", "לא פעילה")}</Chip>}
        </span>
      }
    >
      <Details port={port} s={s} week={week} actor={actor} handler={handler} busy={busy} act={act} />

      <Section title="הטיפול השנה" aside={edition.label} label="הטיפול השנה">
        <ApproachView s={s} a={a} actor={actor} handler={handler} nameOf={nameOf} />
        {a?.offered_to != null && a.offered_to === actor.memberId && actor.canEdit && (
          <div role="group" aria-label="העברה שמחכה לך" className="space-y-2 rounded-lg border border-accent bg-accent-soft p-3">
            <p className="text-sm">{nameOf(a.owner_member_id)} מציע/ה להעביר אליך את הטיפול.</p>
            <div className="flex flex-wrap gap-2">
              <Button kind="primary" busy={busy === "accept"} onClick={() => void act("accept", () => port.speakers.answerHandOver(edition.id, a.id, true), "הטיפול עבר אליך")}>
                קבלת הטיפול
              </Button>
              <Button busy={busy === "decline"} onClick={() => void act("decline", () => port.speakers.answerHandOver(edition.id, a.id, false), "ההצעה הוחזרה")}>
                לא עכשיו
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
        {closedHere.length > 0 && <ClosedLessons lessons={closedHere} onLesson={onLesson} />}
        {mayManage && a && <HandOver key={`${a.id}:${a.owner_member_id}`} team={week.team} a={a} actor={actor} busy={busy} onGo={(to, note) => act("handover", () => port.speakers.handOver(edition.id, a.id, to, note), handOverText(s, to, actor, nameOf))} />}
      </Section>

      <Section title="פרטי קשר" label="פרטי קשר">
        {sideFailed && contacts === undefined ? (
          <p role="alert" className="text-sm text-bad">
            לא הצלחנו לטעון. <button type="button" className="underline" onClick={() => void loadSide()}>לנסות שוב</button>
          </p>
        ) : contacts === undefined ? (
          <p className="text-sm text-ink-soft">טוען…</p>
        ) : contacts === null ? (
          <p className="text-sm text-ink-soft">
            {handler && !(edition.kind === "real" && edition.status !== "archived")
              ? "פרטי הקשר נפתחים רק במחזור האמיתי של השנה: לא במחזור תרגול, הדגמה או ארכיון."
              : errorMessage("contacts_hidden")}
          </p>
        ) : (
          <Contacts key={`${s.id}`} s={s} c={contacts} busy={busy} onSave={(c, onRefused) => act("contacts", () => port.speakers.setContacts(s.id, c), "פרטי הקשר נשמרו", onRefused)} />
        )}
      </Section>

      <Section title="זמינות" aside={a ? null : "נשמרת אצל מי שמטפל/ת השנה"} label="זמינות">
        <AvailabilityGrid
          rows={a ? week.availability.filter((v) => v.approach_id === a.id) : []}
          gender={s.gender}
          busy={busy === "avail"}
          onSet={mayManage ? (day, part, kind, note) => act("avail", () => port.speakers.setAvailability(edition.id, s.id, day, part, kind, note), "הזמינות נשמרה") : undefined}
        />
        {a && !mayManage && <p className="text-xs text-ink-soft">את הזמינות מעדכנים מי שמטפל/ת במרצה והמדריך/ה.</p>}
      </Section>

      <Vetting s={s} actor={actor} nameOf={nameOf} busy={busy} onVet={(state, note) => act(`vet:${state}`, () => port.speakers.vet([s.id], state, note), vetText(state, s))} />

      <Section title={byGender(s.gender, "לימד אצלנו", "לימדה אצלנו")} label="שיעורים במחזורים">
        {history == null ? (
          <p className="text-sm text-ink-soft">{sideFailed ? "לא נטען." : "טוען…"}</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-ink-soft">אין שיעורים סגורים במחזורים הקודמים במערכת.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {history.map((h, i) => (
              <li key={`${h.edition_id}:${i}`} className="rounded-md bg-card px-2 py-1.5">
                <b>{h.edition_label}</b> · {DAY_NAMES[h.day]} <bdi>{fmtRange(h.start_min, h.end_min)}</bdi> · {h.title ?? "ללא כותרת"}
                {h.category && <span className="text-ink-soft"> · {h.category}</span>}
                {h.role === "co" && <span className="text-ink-soft"> · מרצה שותף/ה</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="מה קרה" label="ציר הפעולות">
        {lines == null ? (
          <p className="text-sm text-ink-soft">{sideFailed ? "לא נטען." : "טוען…"}</p>
        ) : lines.length === 0 ? (
          <p className="text-sm text-ink-soft">עוד אין פעולות.</p>
        ) : (
          <ol className="space-y-1.5 text-sm">
            {lines.map((l) => (
              <li key={l.id} className="border-s-2 border-line ps-2">
                <span className="text-xs text-ink-faint tabular-nums">
                  <bdi>{when(l.at)}</bdi>
                </span>{" "}
                {l.who && <b>{l.who}: </b>}
                {l.text}
                {l.note && <span className="block text-ink-soft">«{l.note}»</span>}
              </li>
            ))}
          </ol>
        )}
      </Section>
    </Sheet>
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

function Details({ port, s, week, actor, handler, busy, act }: { port: DataPort; s: Speaker; week: Week; actor: Actor; handler: boolean; busy: string | null; act: Act }) {
  const [editing, setEditing] = useState(false);
  const mayEdit = actor.canEdit && (actor.isAdmin || handler);
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
  return (
    <Section title="פרטים" label="פרטים">
      {s.bio_short ? <p className="whitespace-pre-line">{s.bio_short}</p> : <p className="text-sm text-ink-faint">אין תיאור.</p>}
      {s.topics.length > 0 && (
        <ul aria-label="נושאים" className="flex flex-wrap gap-1">
          {s.topics.map((t) => (
            <li key={t}>
              <Chip>{t}</Chip>
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-soft">מגדר</dt>
        <dd>{s.gender ? GENDER_LABEL[s.gender] : <span className="text-warn">לא ידוע: צריך להשלים לפני סגירת שיעור</span>}</dd>
        <dt className="text-ink-soft">ערוץ מועדף</dt>
        <dd>{s.contact_pref ? CONTACT_PREF_LABEL[s.contact_pref] : "לא צוין"}</dd>
      </dl>
      {mayEdit && <Button onClick={() => setEditing(true)}>עריכת הפרטים</Button>}
    </Section>
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
      <ProfileFields id={id} form={form} set={(p) => setForm((f) => ({ ...f, ...p }))} titles={titlesOf(week.edition.settings)} withName invalid={problem?.field ?? null} problem={problem?.text} />
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

function ClosedLessons({ lessons, onLesson }: { lessons: Lesson[]; onLesson?: (id: number) => void }) {
  return (
    <ul aria-label="שיעורים סגורים במחזור" className="space-y-1.5">
      {lessons.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card px-3 py-1.5 text-sm">
          <span className="min-w-0 flex-1">
            נסגר: {DAY_NAMES[l.day]} <bdi>{fmtRange(l.start_min, l.end_min)}</bdi> · {l.title ?? "כותרת: TBD"}
          </span>
          {onLesson && <Button onClick={() => onLesson(l.id)}>לשיעור</Button>}
        </li>
      ))}
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
      <Button onClick={() => setOpen(true)} aria-expanded={false}>
        העברה לחבר/ת צוות
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
      <Field id={`${id}-note`} label="הערה (לא חובה)">
        <input id={`${id}-note`} value={note} maxLength={LIMITS.note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
      </Field>
      <p className="text-xs text-ink-soft">
        {actor.isAdmin ? "המדריך/ה מעביר/ה מיד." : "הטיפול עובר רק כשהצד השני מקבל/ת את ההצעה. עד אז פרטי הקשר נשארים אצלך."}
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
                  <span className="flex flex-wrap gap-1.5">
                    {tel && (
                      <a href={tel} className={LINK_BUTTON}>
                        חיוג
                      </a>
                    )}
                    {wa && (
                      <a href={wa} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON}>
                        WhatsApp
                      </a>
                    )}
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
                  <a href={mail} className={LINK_BUTTON}>
                    מייל
                  </a>
                )}
              </dd>
            </>
          )}
          {c.secretary_note && (
            <>
              <dt className="text-ink-soft">דרך המזכירות</dt>
              <dd className="min-w-0 whitespace-pre-line break-words">{c.secretary_note}</dd>
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
      {s.contact_pref && <p className="text-xs text-ink-soft">ערוץ מועדף: {CONTACT_PREF_LABEL[s.contact_pref]}</p>}
      <Button onClick={() => setEditing(true)}>עריכת פרטי הקשר</Button>
    </div>
  );
}

// ------------------------------------------------------------------ vetting (a global admin's)

function Vetting({ s, actor, nameOf, busy, onVet }: { s: Speaker; actor: Actor; nameOf: (id: number | null) => string; busy: string | null; onVet: (state: Speaker["vetted"], note: string | null) => Promise<boolean> }) {
  const id = useId();
  const [note, setNote] = useState("");
  const choices: [Speaker["vetted"], string][] = [
    ["approved", "אישור"],
    ["rejected", "דחייה"],
    ["pending", "החזרה להמתנה"],
  ];
  return (
    <Section title="אישור המדריך/ה" label="אישור המדריך/ה">
      <p className="text-sm">
        {vettingLabel(s.vetted, s.gender)}
        {s.vetted !== "pending" && s.vetted_by != null && <span className="text-ink-soft"> · {nameOf(s.vetted_by)}</span>}
      </p>
      {s.vetted_note && <p className="text-sm text-ink-soft">«{s.vetted_note}»</p>}
      {actor.global && (
        <div className="space-y-2 rounded-lg border border-line bg-paper p-3">
          <Field id={`${id}-note`} label="הערה (לא חובה, גלויה לצוות)">
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
          </div>
        </div>
      )}
    </Section>
  );
}
