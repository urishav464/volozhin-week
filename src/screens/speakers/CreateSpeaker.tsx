// «מרצה חדש/ה» — search first. The name typed is looked up in the pool as you
// type (the same name key, or a similar one: pg_trgm ≥ 0.6, «הצעה»), and the
// matches are shown as «ייתכן שזה…» before the rest of the form opens (the first
// five; the rest behind one tap). A person of the very same name needs a
// disambiguator. Gender is chosen, never guessed; what is not needed now waits
// in «עוד פרטים» (ProfileFields `fold`).
// The database refuses the same cases again (CONTRACT «create»), so a race with
// someone adding the same speaker a moment earlier still ends in Hebrew.
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import type { DataPort } from "../../data/port";
import { titlesOf } from "../../data/speakerRules";
import type { Me } from "../../data/types";
import { byGender } from "../../domain/names";
import type { Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Sheet } from "../../grid/Panels";
import { Button, Field, INPUT, useRunner } from "../settings/kit";
import { actorIn } from "../weekStore";
import { FIELD_OF, MatchList, useNameCheck } from "./nameCheck";
import { EMPTY_FORM, fieldsOf, type Notify, type ProfileForm, ProfileFields } from "./parts";

interface Props {
  port: DataPort;
  me: Me;
  week: Week;
  /** What was typed in the pool's search, if anything. */
  initialName?: string;
  wide: boolean;
  onClose: () => void;
  /** «פתיחה» on a match: that speaker's sheet — with the name typed so far, so «חזרה» brings it back. */
  onOpen: (speakerId: number, typed: string) => void;
  /** Created: the new speaker's sheet (contacts and availability are added there). */
  onCreated: (speakerId: number) => void;
  notify: Notify;
  clear: () => void;
  reload: () => Promise<void>;
}

export function CreateSpeaker({ port, me, week, initialName = "", wide, onClose, onOpen, onCreated, notify, clear, reload }: Props) {
  const id = useId();
  const actor = actorIn(me, week.edition);
  const { busy, run } = useRunner(notify, clear);
  const [form, setForm] = useState<ProfileForm>({ ...EMPTY_FORM, name: initialName });
  const [details, setDetails] = useState(false);
  // The matches the user saw before «להמשיך» fold into one line; a new name shows its own in full.
  const [seenFor, setSeenFor] = useState<string | null>(null);
  const [showSeen, setShowSeen] = useState(false);
  const [claim, setClaim] = useState(true);
  const [approve, setApprove] = useState(false);
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState<{ text: string; field: "name" | "disambiguator" | null } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<ProfileForm>) => setForm((f) => ({ ...f, ...patch }));

  // Search as the name is typed (a short pause first); a late answer for an older name is dropped.
  const { key, current, sameName, again } = useNameCheck(port, form.name);
  const folded = details && seenFor === form.name && !showSeen;

  // «להמשיך»: the fields open below the matches — take the eye and the focus there.
  const opened = useRef(false);
  useEffect(() => {
    if (!details || opened.current) return;
    opened.current = true;
    const first = document.getElementById(`${id}-f-title`);
    first?.focus();
    first?.closest("div")?.scrollIntoView({ block: "start" });
  }, [details, id]);
  // A refusal about the disambiguator takes the focus there — once it is drawn: out of «עוד פרטים» if it was folded.
  useEffect(() => {
    if (problem?.field === "disambiguator") document.getElementById(`${id}-f-dis`)?.focus();
  }, [problem, id]);
  // Notes are private, like the contacts: saved only for someone who will see them.
  const realEdition = week.edition.kind === "real" && week.edition.status !== "archived";
  const mayNotes = actor.global || (claim && realEdition);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!details || busy) return;
    setProblem(null);
    // Said here first: the database's answer to the same case is «speaker_exists» (the same, empty, disambiguator).
    if (sameName && !form.disambiguator.trim()) {
      setProblem({ text: errorMessage("disambiguator_required"), field: "disambiguator" });
      return;
    }
    let made: { speaker_id: number; approach_id: number | null } | null = null;
    const ok = await run(
      "create",
      async () => {
        // `confirmed`: the matches for this very name are on screen above the form.
        made = await port.speakers.create(week.edition.id, fieldsOf(form), { claim, approve: actor.global && approve, confirmed: (current?.length ?? 0) > 0 });
      },
      null,
      (code) => {
        if (code === "speaker_similar") again(); // someone added a similar name meanwhile: show it
        if (!code || !["name_required", "disambiguator_required", "speaker_exists", "speaker_similar", "bad_value"].includes(code)) return false;
        setProblem({ text: errorMessage(code), field: FIELD_OF[code] ?? null });
        if (code === "name_required") nameRef.current?.focus();
        return true;
      },
    );
    if (!ok || !made) return;
    const { speaker_id } = made;
    const who = `${form.title ? `${form.title} ` : ""}${form.name.trim()}`;
    if (notes.trim() && mayNotes) {
      try {
        await port.speakers.setContacts(speaker_id, { phone: null, email: null, secretary_note: null, notes });
      } catch {
        notify("error", `${who} ${byGender(form.gender, "נוסף", "נוספה")} למאגר, אבל ההערות לא נשמרו. אפשר להוסיף אותן בפרטי הקשר.`);
        await reload();
        onCreated(speaker_id);
        return;
      }
    }
    notify("ok", `${who} ${byGender(form.gender, "נוסף", "נוספה")} למאגר`);
    await reload();
    onCreated(speaker_id);
  };

  return (
    <Sheet wide={wide} title="מרצה חדש/ה" subtitle="קודם מחפשים במאגר" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <Field id={`${id}-name`} label="שם המרצה (בלי תואר)">
          <input
            ref={nameRef}
            id={`${id}-name`}
            value={form.name}
            autoFocus
            autoComplete="off"
            maxLength={120}
            onChange={(e) => {
              set({ name: e.target.value });
              setProblem(null); // a new name: the last refusal was about the old one
            }}
            className={INPUT}
            aria-invalid={problem?.field === "name" || undefined}
            aria-describedby={problem?.field === "name" ? `${id}-f-problem` : undefined}
          />
        </Field>

        <MatchList
          name={form.name}
          nameKey={key}
          current={current}
          folded={folded}
          onUnfold={() => setShowSeen(true)}
          onFold={details && seenFor === form.name ? () => setShowSeen(false) : undefined}
          onOpen={(m) => onOpen(m.id, form.name)}
        />

        {!details ? (
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
        ) : (
          <>
            <ProfileFields
              id={`${id}-f`}
              form={form}
              set={set}
              titles={titlesOf(week.edition.settings)}
              categories={week.categories}
              withName={false}
              invalid={problem?.field === "disambiguator" ? "disambiguator" : null}
              problem={problem?.field === "disambiguator" ? problem.text : null}
              needDisambiguator={sameName}
              fold
              extra={
                mayNotes && (
                  <Field id={`${id}-notes`} label="הערות לפנייה (פרטי)" hint="רק המטפל/ת והמדריך/ה">
                    <textarea id={`${id}-notes`} value={notes} rows={2} maxLength={1000} onChange={(e) => setNotes(e.target.value)} className={`${INPUT} py-2`} />
                  </Field>
                )
              }
            />
            {actor.canEdit && (
              <label className="flex min-h-11 cursor-pointer items-center gap-2">
                <input type="checkbox" checked={claim} onChange={(e) => setClaim(e.target.checked)} className="size-5 accent-navy" />
                אני מטפל/ת במרצה (ב«המרצים שלי»)
              </label>
            )}
            {actor.global && (
              <label className="flex min-h-11 cursor-pointer items-center gap-2">
                <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} className="size-5 accent-navy" />
                {`לאשר כבר עכשיו (אחרת: ${byGender(form.gender, "ממתין", "ממתינה")} לאישור)`}
              </label>
            )}
            {problem && problem.field !== "disambiguator" && (
              <p id={`${id}-f-problem`} role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
                {problem.text}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button kind="primary" type="submit" busy={busy === "create"} busyLabel="מוסיף…" disabled={!key}>
                הוספה למאגר
              </Button>
              <Button onClick={onClose}>ביטול</Button>
            </div>
          </>
        )}
      </form>
    </Sheet>
  );
}
