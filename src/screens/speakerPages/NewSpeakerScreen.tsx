// «מרצה חדש/ה» as a page (/speakers/new, the reset, phase 2). Search first: the name, and the pool's «ייתכן שזה…» as
// it is typed (src/screens/speakers/nameCheck.tsx); «להמשיך» opens the rest — the title, the gender (chosen, never
// guessed), the institution and the topics. Under «לא חובה»: a short bio, «דרך תקשורת» with the phone and the e-mail
// typed right beside it, and notes for the call. «פרט מבחין» shows only when the pool asks for it: a speaker of this
// very name is there, or the database refused for want of one. Contacts are saved only by the speaker's handler in a
// real live edition (or a global admin) — otherwise one line says so instead of the fields. Created: the speaker's page.
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { CommandError } from "../../data/commands";
import type { DataPort } from "../../data/port";
import { cleanContactEmail, cleanPhone, LIMITS, titlesOf } from "../../data/speakerRules";
import type { Me } from "../../data/types";
import { byGender } from "../../domain/names";
import { speakerPath } from "../../domain/routes";
import type { SpeakerContacts, Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Button, Field, GenderField, INPUT, useRunner } from "../settings/kit";
import { FIELD_OF, MatchList, useNameCheck } from "../speakers/nameCheck";
import { AffiliationField, BioField, ContactPrefField, DisambiguatorField, EMPTY_FORM, fieldsOf, type Notify, type ProfileForm, TagInput, TitleField, useToast } from "../speakers/parts";
import { actorIn, useWeekStore } from "../weekStore";
import { BACK_LINK, type PageNotice, weekProblem } from "./page";

/** «דרך תקשורת»: the channel, in the words a trainee uses. */

const CARD = "space-y-4 rounded-xl border border-line bg-card p-4 shadow-sm sm:p-6";

type Problem = { text: string; field: "name" | "disambiguator" | "phone" | "email" | null };

export function NewSpeakerScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { notify, clear, node } = useToast();
  const problem = weekProblem(store);
  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-20">
      <Link to="/speakers" className={`-ms-3 ${BACK_LINK}`}>
        <span aria-hidden>→</span> מרצים
      </Link>
      {problem ?? (store.week && <Body port={port} me={me} week={store.week} reload={store.reload} notify={notify} clear={clear} />)}
      {node}
    </div>
  );
}

function Body({ port, me, week, reload, notify, clear }: { port: DataPort; me: Me; week: Week; reload: () => Promise<void>; notify: Notify; clear: () => void }) {
  const id = useId();
  const navigate = useNavigate();
  const initialName = new URLSearchParams(useLocation().search).get("name") ?? "";
  const actor = actorIn(me, week.edition);
  const { busy, run } = useRunner(notify, clear);
  const [form, setForm] = useState<ProfileForm>({ ...EMPTY_FORM, name: initialName });
  const [contacts, setContacts] = useState<SpeakerContacts>({ phone: "", email: "", secretary_note: "", notes: "" });
  const [details, setDetails] = useState(false);
  const [seenFor, setSeenFor] = useState<string | null>(null);
  const [showSeen, setShowSeen] = useState(false);
  const [claim, setClaim] = useState(true);
  const [approve, setApprove] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  // the database asked for a disambiguator (a race, or a namesake the search did not show): it stays in sight
  const [disAsked, setDisAsked] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<ProfileForm>) => setForm((f) => ({ ...f, ...patch }));
  const setC = (patch: Partial<SpeakerContacts>) => setContacts((c) => ({ ...c, ...patch }));

  const { key, current, sameName, again } = useNameCheck(port, form.name);
  const folded = details && seenFor === form.name && !showSeen;
  const showDis = sameName || disAsked;
  const live = week.edition.kind === "real" && week.edition.status !== "archived";
  // contacts (and the notes for the call, which are contacts) are saved only for someone who will see them
  const mayContacts = actor.global || (claim && live && actor.canEdit);

  // «להמשיך»: the fields open below the matches — the eye and the focus there.
  const opened = useRef(false);
  useEffect(() => {
    if (!details || opened.current) return;
    opened.current = true;
    const first = document.getElementById(`${id}-title`);
    first?.focus();
    first?.closest("section")?.scrollIntoView({ block: "start" });
  }, [details, id]);
  useEffect(() => {
    if (problem?.field === "disambiguator") document.getElementById(`${id}-dis`)?.focus();
    else if (problem?.field === "phone") document.getElementById(`${id}-phone`)?.focus();
    else if (problem?.field === "email") document.getElementById(`${id}-email`)?.focus();
  }, [problem, id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!details || busy) return;
    setProblem(null);
    if (showDis && !form.disambiguator.trim()) {
      setProblem({ text: errorMessage("disambiguator_required"), field: "disambiguator" });
      return;
    }
    // the contacts are checked before anything is created: a typo is fixed here, not after
    let clean: SpeakerContacts | null = null;
    if (mayContacts) {
      try {
        clean = { phone: cleanPhone(contacts.phone), email: cleanContactEmail(contacts.email), secretary_note: contacts.secretary_note?.trim() || null, notes: contacts.notes?.trim() || null };
      } catch (err) {
        const code = err instanceof CommandError ? err.code : null;
        setProblem({ text: errorMessage(code), field: code === "bad_contact_email" ? "email" : code === "bad_phone" ? "phone" : null });
        return;
      }
    }
    let made: { speaker_id: number } | null = null;
    const ok = await run(
      "create",
      async () => {
        // `confirmed`: the matches for this very name are on screen above the form
        made = await port.speakers.create(week.edition.id, { ...fieldsOf(form), disambiguator: showDis ? fieldsOf(form).disambiguator : null }, { claim: actor.canEdit && claim, approve: actor.global && approve, confirmed: (current?.length ?? 0) > 0 });
      },
      null,
      (code) => {
        if (code === "speaker_similar") again(); // someone added a similar name meanwhile: show it
        if (code === "disambiguator_required" || code === "speaker_exists") setDisAsked(true);
        if (!code || !["name_required", "disambiguator_required", "speaker_exists", "speaker_similar", "bad_value"].includes(code)) return false;
        setProblem({ text: errorMessage(code), field: FIELD_OF[code] ?? null });
        if (code === "name_required") nameRef.current?.focus();
        return true;
      },
    );
    if (!ok || !made) return;
    const { speaker_id } = made as { speaker_id: number };
    const who = `${form.title ? `${form.title} ` : ""}${form.name.trim()}`;
    const added = `${who} ${byGender(form.gender, "נוסף", "נוספה")} למאגר`;
    let notice: PageNotice["notice"] = { kind: "ok", text: added };
    if (clean && (clean.phone || clean.email || clean.secretary_note || clean.notes)) {
      try {
        await port.speakers.setContacts(speaker_id, clean);
      } catch {
        notice = { kind: "error", text: `${added}, אבל פרטי הקשר לא נשמרו. אפשר להוסיף אותם בעמוד המרצה.` };
      }
    }
    await reload();
    navigate(speakerPath(speaker_id), { state: { notice } satisfies PageNotice });
  };

  const invalid = (f: Problem["field"]) => (problem?.field === f ? { "aria-invalid": true as const, "aria-describedby": `${id}-problem` } : {});
  const problemLine = (f: Problem["field"]) =>
    problem && problem.field === f ? (
      <p id={`${id}-problem`} role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
        {problem.text}
      </p>
    ) : null;

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <div>
        <h2 className="font-display text-2xl font-extrabold text-navy">מרצה חדש/ה</h2>
        <p className="text-ink-soft">קודם בודקים שהמרצה לא כבר במאגר</p>
      </div>

      <section aria-label="השם" className={CARD}>
        <Field id={`${id}-name`} label="שם המרצה (בלי תואר)">
          <input
            ref={nameRef}
            id={`${id}-name`}
            value={form.name}
            autoFocus
            autoComplete="off"
            maxLength={LIMITS.name}
            onChange={(e) => {
              set({ name: e.target.value });
              setProblem(null); // a new name: the last refusal was about the old one
              setDisAsked(false);
            }}
            className={INPUT}
            {...invalid("name")}
          />
        </Field>
        {problemLine("name")}
        <MatchList
          name={form.name}
          nameKey={key}
          current={current}
          folded={folded}
          onUnfold={() => setShowSeen(true)}
          onFold={details && seenFor === form.name ? () => setShowSeen(false) : undefined}
          onOpen={(m) => navigate(speakerPath(m.id))}
        />
        {!details && (
          <Button
            kind="primary"
            disabled={!key || current == null}
            onClick={() => {
              setSeenFor(form.name);
              setShowSeen(false);
              setDetails(true);
            }}
          >
            {current && current.length > 0 ? "זה מישהו אחר — להמשיך" : "להמשיך"}
          </Button>
        )}
      </section>

      {details && (
        <>
          <section aria-label="מי" className={CARD}>
            <div className="grid gap-4 md:grid-cols-2">
              <TitleField id={`${id}-title`} value={form.title} titles={titlesOf(week.edition.settings)} onChange={(title) => set({ title })} />
              <AffiliationField id={`${id}-aff`} value={form.affiliation} onChange={(affiliation) => set({ affiliation })} />
              {showDis && (
                <div className="md:col-span-2">
                  <DisambiguatorField id={`${id}-dis`} value={form.disambiguator} onChange={(disambiguator) => set({ disambiguator })} required describedBy={problem?.field === "disambiguator" ? `${id}-problem` : null} />
                </div>
              )}
            </div>
            {problemLine("disambiguator")}
            <GenderField name={`${id}-gender`} value={form.gender} onChange={(gender) => set({ gender })} legend="מגדר" unknown="לא ידוע" />
            <TagInput id={`${id}-topics`} tags={form.topics} draft={form.topicDraft} categories={week.categories} onChange={set} />
          </section>

          <section aria-labelledby={`${id}-optional`} className={CARD}>
            <h3 id={`${id}-optional`} className="font-display text-lg font-bold text-navy">
              לא חובה
            </h3>
            <BioField id={`${id}-bio`} value={form.bio_short} onChange={(bio_short) => set({ bio_short })} />
            <div className="grid gap-4 md:grid-cols-3">
              <ContactPrefField id={`${id}-pref`} hint={null} value={form.contact_pref} onChange={(contact_pref) => set({ contact_pref })} />
              {mayContacts && (
                <>
                  <Field id={`${id}-phone`} label="טלפון">
                    <input id={`${id}-phone`} type="tel" inputMode="tel" dir="ltr" value={contacts.phone ?? ""} maxLength={LIMITS.phone} onChange={(e) => setC({ phone: e.target.value })} className={INPUT} autoComplete="off" {...invalid("phone")} />
                  </Field>
                  <Field id={`${id}-email`} label="מייל">
                    <input id={`${id}-email`} type="email" dir="ltr" value={contacts.email ?? ""} maxLength={LIMITS.email} onChange={(e) => setC({ email: e.target.value })} className={INPUT} autoComplete="off" {...invalid("email")} />
                  </Field>
                </>
              )}
            </div>
            {problemLine("phone")}
            {problemLine("email")}
            {mayContacts ? (
              <>
                {form.contact_pref === "secretary" && (
                  <Field id={`${id}-sec`} label="דרך המזכירות">
                    <textarea id={`${id}-sec`} rows={2} value={contacts.secretary_note ?? ""} maxLength={LIMITS.secretary_note} onChange={(e) => setC({ secretary_note: e.target.value })} className={`${INPUT} py-2`} />
                  </Field>
                )}
                <Field id={`${id}-notes`} label="הערות לפנייה" hint="רק המטפל/ת והמדריך/ה">
                  <textarea id={`${id}-notes`} rows={2} value={contacts.notes ?? ""} maxLength={LIMITS.contact_notes} onChange={(e) => setC({ notes: e.target.value })} className={`${INPUT} py-2`} />
                </Field>
              </>
            ) : (
              <p className="text-sm text-ink-soft">פרטי קשר נשמרים רק אצל מי שמטפל/ת במרצה, במחזור האמיתי של השנה.</p>
            )}
          </section>

          <div className="space-y-2">
            {actor.canEdit && (
              <label className="flex min-h-11 cursor-pointer items-center gap-2">
                <input type="checkbox" checked={claim} onChange={(e) => setClaim(e.target.checked)} className="size-5 accent-navy" />
                אני מטפל/ת במרצה
              </label>
            )}
            {actor.global && (
              <label className="flex min-h-11 cursor-pointer items-center gap-2">
                <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} className="size-5 accent-navy" />
                {`לאשר כבר עכשיו (אחרת: ${byGender(form.gender, "ממתין", "ממתינה")} לאישור)`}
              </label>
            )}
            {problemLine(null)}
            <div className="flex flex-wrap gap-2">
              <Button kind="primary" type="submit" busy={busy === "create"} busyLabel="מוסיף…" disabled={!key || !actor.canEdit}>
                הוספה למאגר
              </Button>
              <Link to="/speakers" className="inline-flex min-h-11 items-center rounded-full border border-navy bg-card px-4 font-bold text-navy hover:bg-accent-soft">
                ביטול
              </Link>
            </div>
            {!actor.canEdit && <p className="text-sm text-ink-soft">במחזור הזה אין לך תפקיד שמוסיף מרצים.</p>}
          </div>
        </>
      )}
    </form>
  );
}
