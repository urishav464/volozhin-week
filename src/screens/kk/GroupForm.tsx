// A group's form on /kk — new or edited: the book (it may come later), its author, the place it meets in all week
// (typed; the edition's rooms only suggested), the capacity, open to the link, and the leaders: a trainee of the
// roster, someone of the team (from its list, or another name), or someone of Ein Prat. A name picked or typed that is
// one trainee's is sent as that trainee (leaderInput), so a trainee leader's rules hold for them. The rules between
// groups are the functions': their refusals are said here, in the form.
import { type FormEvent, useId, useMemo, useState } from "react";
import type { KkData, KkGroup, KkGroupFields, KkLeader, LeaderInput, LeaderKind } from "../../data/kk";
import { KK_LIMITS } from "../../data/kk";
import { LEADER_KIND_LABEL, leaderInput, leaderName } from "../../domain/kk";
import type { Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Button, Field, INPUT } from "../settings/kit";

/** The refusals the form says itself; anything else is the screen's toast. */
const FORM_CODES = ["bad_value", "bad_trainee", "place_taken", "leader_elsewhere", "leader_signed_up", "group_has_signups"];

/** The kinds as the form offers them: a trainee of the class first — most leaders are. */
const KINDS: readonly LeaderKind[] = ["trainee", "staff", "ein_prat"];

/** «שם אחר…» in the team's list (its names are picked by their place in it): the name is typed. */
const OTHER = "other";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** `group_has_signups` in this form: the book taken away from a group someone signed up for (errors.ts says deleting's). */
const KEEP_BOOK = "יש נרשמים לקבוצה הזו, ולכן אי אפשר להסיר ממנה את הספר. אפשר להחליף אותו בספר אחר, או קודם להעביר או להסיר את הנרשמים.";

/** A leader as the database tells repeats apart. */
const leaderKey = (l: LeaderInput) => (l.kind === "trainee" ? `trainee:${l.roster_id}` : `${l.kind}:${l.label}`);

export function GroupForm({
  week,
  kk,
  title,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  week: Week;
  kk: KkData;
  /** The form's name, for its label and its heading. */
  title: string;
  initial?: { g: KkGroup; leaders: KkLeader[] };
  busy: boolean;
  onSave: (fields: KkGroupFields, onRefused: (code: string | null) => boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial?.g.title ?? "");
  const [author, setAuthor] = useState(initial?.g.author ?? "");
  const [place, setPlace] = useState(initial?.g.place ?? "");
  const [capacity, setCapacity] = useState(initial?.g.capacity != null ? String(initial.g.capacity) : "");
  const [open, setOpen] = useState(initial?.g.open ?? true);
  const [leaders, setLeaders] = useState<LeaderInput[]>(
    () => initial?.leaders.map((x): LeaderInput => (x.kind === "trainee" ? { kind: "trainee", roster_id: x.roster_id! } : { kind: x.kind, label: x.label ?? "" })) ?? [],
  );
  const [kind, setKind] = useState<LeaderKind>("trainee");
  const [leaderRoster, setLeaderRoster] = useState<number | null>(null);
  const [teamPick, setTeamPick] = useState("");
  const [leaderLabel, setLeaderLabel] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  // a trainee leads one group: those who lead another are not offered (the server's `leader_elsewhere` still stands)
  const elsewhere = useMemo(() => new Set(kk.leaders.filter((l) => l.group_id !== initial?.g.id && l.roster_id != null).map((l) => l.roster_id!)), [kk.leaders, initial?.g.id]);
  const trainees = [...week.roster]
    .filter((r) => !elsewhere.has(r.id) && !leaders.some((l) => l.kind === "trainee" && l.roster_id === r.id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "he") || a.id - b.id);
  const team = [...new Set(week.team.map((m) => m.display_name))].sort((a, b) => a.localeCompare(b, "he"));
  const nameOf = (l: LeaderInput) => (l.kind === "trainee" ? leaderName({ roster_id: l.roster_id, label: null }, week.roster) : l.label);
  const order = initial ? kk.orders.find((o) => o.group_id === initial.g.id) : undefined;
  const retitled = !!order && oneLine(name) !== (initial?.g.title ?? "");

  /** The leader picked or typed below, as it is sent: a trainee's name as that trainee. */
  const pendingLeader = (): LeaderInput | null => {
    if (kind === "trainee") return leaderRoster == null ? null : { kind: "trainee", roster_id: leaderRoster };
    if (kind === "staff" && teamPick === "") return null;
    const n = kind === "staff" && teamPick !== OTHER ? (team[Number(teamPick)] ?? "") : oneLine(leaderLabel);
    return n ? (leaderInput(n, week.roster) ?? { kind, label: n }) : null;
  };
  /** The list with the pending leader added (a repeat kept once), or why not. */
  const withPending = (): { list: LeaderInput[]; problem?: string } => {
    const pending = pendingLeader();
    if (!pending || leaders.some((x) => leaderKey(x) === leaderKey(pending))) return { list: leaders };
    if (leaders.length >= KK_LIMITS.leaders) return { list: leaders, problem: `עד ${KK_LIMITS.leaders} מעבירים לקבוצה (הצעה).` };
    return { list: [...leaders, pending] };
  };
  const clearPending = () => {
    setLeaderRoster(null);
    setTeamPick("");
    setLeaderLabel("");
  };

  const addLeader = () => {
    setProblem(null);
    if (!pendingLeader()) {
      return setProblem(kind === "trainee" ? "צריך לבחור חניך/ה מהרשימה." : kind === "staff" && teamPick !== OTHER ? "צריך לבחור מרשימת הצוות, או «שם אחר…»." : "צריך לכתוב את השם של המעביר/ה.");
    }
    const { list, problem: p } = withPending();
    if (p) return setProblem(p);
    setLeaders(list);
    clearPending();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const cap = capacity.trim() === "" ? null : Number(capacity);
    if (cap != null && (!Number.isInteger(cap) || cap < 1 || cap > KK_LIMITS.capacity)) return setProblem(`תפוסה: מספר שלם בין 1 ל-${KK_LIMITS.capacity}, או ריק.`);
    // a leader picked or typed but not added with «הוספת מעביר/ה» is still meant: saved with the others
    const { list, problem: p } = withPending();
    if (p) return setProblem(p);
    if (list !== leaders) {
      setLeaders(list);
      clearPending();
    }
    // one line each, every space as a space (a no-break space pasted from WhatsApp or Word too): the demo and the database
    // key the same text (`nameKey` ≡ `app.name_key`)
    await onSave({ title: oneLine(name) || null, author: oneLine(author) || null, place: oneLine(place) || null, capacity: cap, open, leaders: list }, (code) => {
      if (!FORM_CODES.includes(code ?? "")) return false;
      setProblem(code === "group_has_signups" ? KEEP_BOOK : errorMessage(code));
      if (code === "place_taken") document.getElementById(`${id}-p`)?.focus();
      if (code === "group_has_signups") document.getElementById(`${id}-t`)?.focus();
      return true;
    });
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-label={title} className="space-y-3 rounded-lg border border-ink/30 bg-paper p-3" noValidate>
      <h4 className="font-semibold break-words">{title}</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-t`} label="שם הספר (לא חובה: אפשר גם אחר כך)" hint="בלי ספר הקבוצה לא מוצעת בקישור ההרשמה.">
          <input id={`${id}-t`} value={name} maxLength={KK_LIMITS.title} onChange={(e) => setName(e.target.value)} className={INPUT} autoComplete="off" aria-describedby={`${id}-t-hint`} />
        </Field>
        <Field id={`${id}-a`} label="מחבר/ת (לא חובה)">
          <input id={`${id}-a`} value={author} maxLength={KK_LIMITS.author} onChange={(e) => setAuthor(e.target.value)} className={INPUT} autoComplete="off" />
        </Field>
        <Field id={`${id}-p`} label="מרחב (לא חובה)" hint="איפה הקבוצה נפגשת כל השבוע. כל קבוצה במרחב משלה.">
          <input id={`${id}-p`} value={place} maxLength={KK_LIMITS.place} onChange={(e) => setPlace(e.target.value)} className={INPUT} autoComplete="off" list={`${id}-rooms`} aria-describedby={`${id}-p-hint`} />
          <datalist id={`${id}-rooms`}>
            {week.rooms.map((r) => (
              <option key={r.id} value={r.name} />
            ))}
          </datalist>
        </Field>
        <Field id={`${id}-c`} label="תפוסה" hint="כמה מקומות. בלי תפוסה הקבוצה לא מוצעת בקישור ההרשמה.">
          <input id={`${id}-c`} type="number" inputMode="numeric" min={1} max={KK_LIMITS.capacity} value={capacity} onChange={(e) => setCapacity(e.target.value)} className={INPUT} aria-describedby={`${id}-c-hint`} />
        </Field>
      </div>
      <div aria-live="polite">{retitled && <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm">לספר הזה כבר יש הזמנת ספרים — כדאי לבדוק אותה.</p>}</div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} className="size-5 accent-ink" />
        פתוחה להרשמה בקישור
      </label>
      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-semibold">מעבירים</legend>
        {leaders.length === 0 ? (
          <p className="text-sm text-ink-soft">עוד אין מעבירים.</p>
        ) : (
          <ul aria-label="המעבירים" className="flex flex-wrap gap-1.5">
            {leaders.map((l, i) => (
              <li key={i} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-card ps-3 text-sm">
                <span className="min-w-0 break-words">
                  {nameOf(l)} <span className="text-ink-soft">({LEADER_KIND_LABEL[l.kind]})</span>
                </span>
                <button type="button" aria-label={`הסרת ${nameOf(l)} מהמעבירים`} onClick={() => setLeaders((cur) => cur.filter((_, k) => k !== i))} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-line/60">
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Field id={`${id}-lk`} label="מעביר/ה">
            <select
              id={`${id}-lk`}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as LeaderKind);
                clearPending();
              }}
              className={INPUT}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {LEADER_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          {kind === "trainee" && (
            <Field id={`${id}-lr`} label="מרשימת החניכים">
              <select id={`${id}-lr`} value={leaderRoster ?? ""} onChange={(e) => setLeaderRoster(e.target.value ? Number(e.target.value) : null)} className={INPUT}>
                <option value="">בחירה</option>
                {trainees.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {kind === "staff" && (
            <Field id={`${id}-lt`} label="מרשימת הצוות">
              <select id={`${id}-lt`} value={teamPick} onChange={(e) => setTeamPick(e.target.value)} className={INPUT}>
                <option value="">בחירה</option>
                {team.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
                <option value={OTHER}>שם אחר…</option>
              </select>
            </Field>
          )}
          {(kind === "ein_prat" || (kind === "staff" && teamPick === OTHER)) && (
            <Field id={`${id}-ll`} label="שם">
              <input id={`${id}-ll`} value={leaderLabel} maxLength={KK_LIMITS.leader} onChange={(e) => setLeaderLabel(e.target.value)} className={INPUT} autoComplete="off" />
            </Field>
          )}
          <Button onClick={addLeader}>הוספת מעביר/ה</Button>
        </div>
      </fieldset>
      {problem && (
        <p role="alert" className="text-sm text-bad">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" type="submit" busy={busy} busyLabel="שומר…">
          שמירה
        </Button>
        <Button onClick={onCancel}>ביטול</Button>
      </div>
    </form>
  );
}
