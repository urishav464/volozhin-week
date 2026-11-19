// Pieces of a speaker's record that the speaker page (src/screens/speakerPages/SpeakerScreen.tsx, the reset's wide page;
// the grid's old side sheet went in phase 3) and the vetting chip draw: what a Week never carries (contacts,
// past editions, the timeline — read one speaker at a time), the approach and the call's frame, a hand-over, the
// contacts, the profile's edit form, the timeline and the vetting form. Every change is a port command; a refusal reads
// in Hebrew.
import { type FormEvent, type ReactNode, useCallback, useEffect, useId, useState } from "react";
import type { DataPort } from "../../data/port";
import { LIMITS, titlesOf } from "../../data/speakerRules";
import type { ActivityEntry, HistoryLesson, SpeakerPatch } from "../../data/speakers";
import type { timeline } from "../../domain/activityText";
import { mailHref, telHref, waHref } from "../../domain/contactLinks";
import { byGender, displayName } from "../../domain/names";
import { nameKey } from "../../domain/nameKey";
import type { Approach, ApproachStatus, ContactPref, Speaker, SpeakerContacts, TeamMember, Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Section } from "../../grid/Panels";
import { CONTACT_WAY, CONTACT_WAY_LABEL, statusLabel, vettingLabel } from "../../lib/labels";
import { Button, Field, Fold, INPUT } from "../settings/kit";
import type { Actor } from "../weekStore";
import { LINK_BUTTON, LINK_PRIMARY } from "../stages/parts";
import { formOf, patchOf, type ProfileForm, ProfileFields } from "./parts";

/** The speaker's preferred channel: its button is the primary one. */
export const LINK_PREFERRED = LINK_PRIMARY;

/** Before the speaker's answer: the call is still to be made (or made again). */
export const CALLING: ReadonlySet<ApproachStatus> = new Set(["claimed", "no_answer", "approached"]);

const WHEN = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
/** «19.11» — a day, in Israel. */
export const DAY_ONLY = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" });
/** An instant as «19.11, 14:05» (or `f`'s way), in Israel; nothing for a bad one. */
export const when = (at: string, f = WHEN) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : f.format(d);
};

/**
 * What a Week never carries, for one speaker: their contacts (null when the caller may not see them — the contacts
 * policy), their past editions and their timeline. Read again whenever one of `deps` changes (the speaker or their
 * approach, here or on another device: who sees the contacts may have changed with it); `reload` after a command.
 */
export function useSpeakerSide(port: DataPort, speakerId: number, deps: readonly unknown[]) {
  const [contacts, setContacts] = useState<SpeakerContacts | null | undefined>(undefined);
  const [history, setHistory] = useState<HistoryLesson[] | null>(null);
  const [log, setLog] = useState<ActivityEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(async () => {
    try {
      const [c, h, l] = await Promise.all([port.speakers.contacts(speakerId), port.speakers.history(speakerId), port.speakers.activity(speakerId)]);
      setContacts(c);
      setHistory(h);
      setLog(l);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [port, speakerId]);
  // the caller's deps are what change who sees what
  useEffect(() => void reload(), [reload, ...deps]);
  return { contacts, history, log, failed, reload };
}

/** «מה קרה»: occasional reading, folded — its summary says how much there is and when it last moved. */
export function Timeline({ lines, failed }: { lines: ReturnType<typeof timeline> | null; failed: boolean }) {
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
      <Fold title="מה קרה" hint={`${lines.length === 1 ? "פעולה אחת" : `${lines.length} פעולות`} · אחרונה ${when(latest, DAY_ONLY)}`}>
        <ol className="space-y-1.5 text-sm">
          {lines.map((l) => (
            <li key={l.id} className="border-s-2 border-sage ps-2">
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

export function handOverText(s: Speaker, to: number | null, actor: Actor, nameOf: (id: number | null) => string): string {
  if (!actor.isAdmin) return to == null ? "ההצעה בוטלה" : `הוצע ל${nameOf(to)} לקבל את הטיפול`;
  return to == null ? `${displayName(s)} ${byGender(s.gender, "חזר", "חזרה")} למאגר, בלי מטפל/ת` : `הטיפול עבר ל${nameOf(to)}`;
}

export function vetText(state: Speaker["vetted"], s: Speaker): string {
  if (state === "approved") return `${displayName(s)} ${byGender(s.gender, "אושר", "אושרה")}`;
  if (state === "rejected") return `${displayName(s)} ${byGender(s.gender, "לא אושר", "לא אושרה")}`;
  return `${displayName(s)} ${byGender(s.gender, "הוחזר", "הוחזרה")} להמתנה`;
}

// ------------------------------------------------------------------ the record

export type Act = (key: string, fn: () => Promise<unknown>, ok: string | null, onRefused?: (code: string | null) => boolean) => Promise<boolean>;

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

const PROFILE_FIELD: Record<string, "name" | "disambiguator"> = { name_required: "name", disambiguator_required: "disambiguator", speaker_exists: "disambiguator" };

export function ProfileEdit({
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
  // another speaker of the name as typed: the pool needs a «פרט מבחין» (public.update_speaker, disambiguator_required)
  const key = nameKey(form.name);
  const namesake = key !== "" && week.speakers.some((x) => x.id !== s.id && nameKey(x.name) === key);
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
    <form onSubmit={(e) => void submit(e)} aria-label="עריכת הפרטים" className="space-y-3 rounded-xl bg-sand-soft p-3" noValidate>
      <ProfileFields
        id={id}
        form={form}
        set={(p) => setForm((f) => ({ ...f, ...p }))}
        titles={titlesOf(week.edition.settings)}
        categories={week.categories}
        withName
        invalid={problem?.field ?? null}
        problem={problem?.text}
        needDisambiguator={namesake}
        showDisambiguator={!!s.disambiguator}
      />
      {actor.global && (
        <label className="flex min-h-11 cursor-pointer items-center gap-2">
          <input type="checkbox" checked={retired} onChange={(e) => setRetired(e.target.checked)} className="size-5 accent-navy" />
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

export function ApproachView({ s, a, actor, handler, nameOf }: { s: Speaker; a: Approach | null; actor: Actor; handler: boolean; nameOf: (id: number | null) => string }) {
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

/** The call's result: in sight while the call is to be made; after the answer the next step is elsewhere, and a change of mind waits behind a fold. */
export function CallResultFrame({ calling, children }: { calling: boolean; children: ReactNode }) {
  return calling ? (
    <div className="rounded-xl bg-sand-soft p-3">{children}</div>
  ) : (
    <Fold title="שינוי תוצאת השיחה" size="sm">
      {children}
    </Fold>
  );
}

/**
 * A hand-over on its way: offered to me — «קבלת הטיפול» / «דחיית ההצעה»; offered to someone else — said, and the
 * handler (or an admin) may withdraw it. Nothing while none waits.
 */
export function HandOverOffer({
  a,
  actor,
  handler,
  busy,
  nameOf,
  onAnswer,
  onWithdraw,
}: {
  a: Approach;
  actor: Actor;
  handler: boolean;
  busy: string | null;
  nameOf: (id: number | null) => string;
  onAnswer: (accept: boolean) => void;
  onWithdraw: () => void;
}) {
  if (a.offered_to == null) return null;
  if (a.offered_to === actor.memberId && actor.canEdit) {
    return (
      <div role="group" aria-label="העברה שמחכה לך" className="space-y-2 rounded-xl border border-navy/30 bg-accent-soft p-3">
        <p className="text-sm">{nameOf(a.owner_member_id)} מציע/ה להעביר אליך את הטיפול.</p>
        <div className="flex flex-wrap gap-2">
          <Button kind="primary" busy={busy === "accept"} onClick={() => onAnswer(true)}>
            קבלת הטיפול
          </Button>
          <Button busy={busy === "decline"} onClick={() => onAnswer(false)}>
            דחיית ההצעה
          </Button>
        </div>
      </div>
    );
  }
  if (a.offered_to === actor.memberId) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>
        הוצע להעביר את הטיפול ל{nameOf(a.offered_to)}. עד שתתקבל תשובה, הטיפול לא עובר.
      </span>
      {(handler || actor.isAdmin) && actor.canEdit && (
        // The handler withdraws with «to nobody»; for an admin that would send the speaker back to the
        // pool (an admin reassigns at once), so an admin "reassigns" to the same handler, which clears the offer.
        <Button kind="quiet" busy={busy === "withdraw"} onClick={onWithdraw}>
          ביטול ההצעה
        </Button>
      )}
    </div>
  );
}

/**
 * «העברה». The handler offers the speaker to another member, who accepts or
 * gives it back (until then nothing moves, contacts included); an admin of the
 * edition moves it at once, or back to the pool.
 */
export function HandOver({ team, a, actor, busy, onGo }: { team: TeamMember[]; a: Approach; actor: Actor; busy: string | null; onGo: (to: number | null, note: string | null) => Promise<boolean> }) {
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
    <div role="group" aria-label="העברת הטיפול" className="space-y-2 rounded-xl bg-sand-soft p-3">
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

export function Contacts({ s, c, busy, onSave }: { s: Speaker; c: SpeakerContacts; busy: string | null; onSave: (c: SpeakerContacts, onRefused: (code: string | null) => boolean) => Promise<boolean> }) {
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
      <form onSubmit={(e) => void submit(e)} aria-label="עריכת פרטי הקשר" className="space-y-3 rounded-xl bg-sand-soft p-3" noValidate>
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
      {pref && !pressable[pref] && (
        <p className="text-xs text-ink-soft">
          {CONTACT_WAY}: {CONTACT_WAY_LABEL[pref]}
        </p>
      )}
      <Button onClick={() => setEditing(true)}>עריכת פרטי הקשר</Button>
    </div>
  );
}

// ------------------------------------------------------------------ vetting (a global admin's)

export function VetForm({
  s,
  actor,
  nameOf,
  busy,
  onVet,
  startOpen = false,
}: {
  s: Speaker;
  actor: Actor;
  nameOf: (id: number | null) => string;
  busy: string | null;
  onVet: (state: Speaker["vetted"], note: string | null) => Promise<boolean>;
  /** Opened on purpose (the speaker page's chip): the choices at once, not behind «שינוי האישור». */
  startOpen?: boolean;
}) {
  const id = useId();
  const [note, setNote] = useState("");
  // Open for a speaker waiting for approval; once decided, behind «שינוי האישור» (it is not news on every sheet).
  const [open, setOpen] = useState(startOpen);
  useEffect(() => setOpen(startOpen), [s.id, s.vetted, startOpen]);
  const choices: [Speaker["vetted"], string][] = [
    ["approved", "אישור"],
    ["rejected", "דחייה"],
    ["pending", "החזרה להמתנה"],
  ];
  return (
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
        <div className="space-y-2 rounded-xl bg-sand-soft p-3">
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
  );
}
