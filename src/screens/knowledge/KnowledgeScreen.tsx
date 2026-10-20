// «ידע» (/knowledge): the milestones of the edition, counted back from the week
// (W−n, «הצעה»; the real date once the week has one), and the knowledge base's
// notes by section — cross-year or this edition's. Every member reads; the
// edition's admins write (a cross-year note: a global admin). Nothing is
// seeded: an empty section invites the instructor to write it.
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { type KnowledgePort, type Milestone, type Note, NOTE_SECTION_LABEL, NOTE_SECTIONS, type NoteSection } from "../../data/knowledge";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { errorMessage } from "../../errors";
import { byDue, fmtDate, isLate, israelToday, milestoneDate, milestoneLabel } from "../../domain/milestones";
import type { Edition } from "../../domain/types";
import { Badge, Button, Confirm, Field, INPUT, Panel, useRunner } from "../settings/kit";
import { EditionSelect, useToast } from "../speakers/parts";
import { Markdown } from "../Markdown";
import { actorIn, useWeekStore } from "../weekStore";

export function KnowledgeScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const { notify, clear, node } = useToast();
  const { busy, run } = useRunner(notify, clear);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [milestones, setMilestones] = useState<Milestone[] | null>(null);
  const [failed, setFailed] = useState(false);
  const edition = week?.edition ?? null;
  const editionId = edition?.id ?? null;
  const actor = actorIn(me, edition);

  const load = useCallback(async () => {
    if (editionId == null) return;
    setFailed(false);
    try {
      const [n, m] = await Promise.all([port.knowledge.notes(editionId), port.knowledge.milestones(editionId)]);
      setNotes(n);
      setMilestones(m);
    } catch {
      setFailed(true);
    }
  }, [port, editionId]);
  useEffect(() => {
    setNotes(null);
    setMilestones(null);
    void load();
  }, [load]);

  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error" || failed) return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!edition || !notes || !milestones || !week) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  /** A write, then everything again; `stale` (someone saved meanwhile) reloads too. */
  const act = async (key: string, fn: () => Promise<unknown>, ok: string, onRefused?: (code: string | null) => boolean) => {
    const done = await run(key, fn, ok, onRefused);
    await load();
    return done;
  };
  const k = port.knowledge;
  const names = new Map(week.team.map((t) => [t.id, t.display_name]));

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-display text-2xl font-extrabold">ידע ואבני דרך</h2>
        <EditionSelect />
      </div>
      <Milestones edition={edition} list={milestones} admin={actor.isAdmin} k={k} act={act} busy={busy} />
      <Notes edition={edition} list={notes} admin={actor.isAdmin} global={actor.global} k={k} act={act} busy={busy} names={names} />
      {node}
    </div>
  );
}

type Act = (key: string, fn: () => Promise<unknown>, ok: string, onRefused?: (code: string | null) => boolean) => Promise<boolean>;

// ------------------------------------------------------------------ milestones

function Milestones({ edition, list, admin, k, act, busy }: { edition: Edition; list: Milestone[]; admin: boolean; k: KnowledgePort; act: Act; busy: string | null }) {
  const today = israelToday();
  const sorted = [...list].sort(byDue);
  return (
    <Panel
      title="אבני דרך"
      aside={edition.start_date ? `לפי תאריך השבוע, ${fmtDate(milestoneDate(edition.start_date, 0)!)}` : "תאריך השבוע עוד TBD: מוצג רק המרחק ממנו (W−n)"}
    >
      {sorted.length === 0 ? (
        <p className="mb-3 text-ink-soft">
          עוד אין אבני דרך למחזור הזה. אבן דרך היא משימה לפי המרחק מהשבוע: W−42 הוא שישה שבועות לפני יום הפתיחה.
          {admin ? " כאן מוסיפים אותן, והן עוברות למחזור הבא." : " המדריך/ה מוסיף/ה אותן."}
        </p>
      ) : (
        <ul aria-label="אבני הדרך" className="mb-3 divide-y divide-line">
          {sorted.map((m) => (
            <MilestoneItem key={m.id} m={m} edition={edition} admin={admin} k={k} act={act} busy={busy} late={isLate(edition.start_date, m.days_before, m.done_at != null, today)} />
          ))}
        </ul>
      )}
      {admin && <MilestoneForm onSave={(v) => act("add-milestone", () => k.addMilestone(edition.id, v), "אבן הדרך נוספה")} busy={busy === "add-milestone"} />}
    </Panel>
  );
}

function MilestoneItem({ m, edition, admin, k, act, busy, late }: { m: Milestone; edition: Edition; admin: boolean; k: KnowledgePort; act: Act; busy: string | null; late: boolean }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const date = milestoneDate(edition.start_date, m.days_before);
  const done = m.done_at != null;
  if (editing) {
    return (
      <li className="py-2">
        <MilestoneForm
          initial={m}
          busy={busy === `edit-${m.id}`}
          onCancel={() => setEditing(false)}
          onSave={async (v) => {
            const ok = await act(`edit-${m.id}`, () => k.updateMilestone(m.id, v), "נשמר");
            if (ok) setEditing(false);
            return ok;
          }}
        />
      </li>
    );
  }
  return (
    <li data-milestone={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      {admin ? (
        <label className="inline-flex min-h-11 min-w-0 flex-1 basis-56 cursor-pointer items-center gap-2">
          <input type="checkbox" checked={done} disabled={busy === `done-${m.id}`} onChange={(e) => void act(`done-${m.id}`, () => k.setMilestoneDone(m.id, e.target.checked), e.target.checked ? "סומן כבוצע" : "הסימון בוטל")} className="size-5 shrink-0 accent-ink" />
          <span className={`min-w-0 break-words font-semibold ${done ? "text-ink-soft line-through" : ""}`}>{m.title}</span>
        </label>
      ) : (
        <span className={`min-w-0 flex-1 basis-56 break-words font-semibold ${done ? "text-ink-soft line-through" : ""}`}>
          {m.title} <span className="sr-only">{done ? "(בוצע)" : "(עוד לא בוצע)"}</span>
        </span>
      )}
      <span className="text-sm text-ink-soft">
        <bdi>{milestoneLabel(m.days_before)}</bdi> · הצעה{date ? ` · עד ${fmtDate(date)}` : ""}
      </span>
      {done && <Badge tone="ok">בוצע {fmtDate(new Date(m.done_at!))}</Badge>}
      {late && <Badge tone="bad">באיחור</Badge>}
      {admin && !deleting && (
        <span className="flex gap-1">
          <Button kind="quiet" onClick={() => setEditing(true)} aria-label={`עריכת ${m.title}`}>
            עריכה
          </Button>
          <Button kind="danger" onClick={() => setDeleting(true)} aria-label={`מחיקת ${m.title}`}>
            מחיקה
          </Button>
        </span>
      )}
      {deleting && (
        <div className="basis-full">
          <Confirm text={<>למחוק את אבן הדרך «{m.title}»?</>} confirm="מחיקה" busy={busy === `del-${m.id}`} onCancel={() => setDeleting(false)} onConfirm={() => void act(`del-${m.id}`, () => k.deleteMilestone(m.id), "אבן הדרך נמחקה")} />
        </div>
      )}
    </li>
  );
}

function MilestoneForm({ initial, onSave, onCancel, busy }: { initial?: Milestone; onSave: (v: { title: string; days_before: number }) => Promise<boolean>; onCancel?: () => void; busy: boolean }) {
  const id = useId();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [days, setDays] = useState(initial ? String(initial.days_before) : "");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const n = Number(days.trim());
    if (!title.trim()) return setProblem(errorMessage("title_required"));
    if (days.trim() === "" || !Number.isInteger(n) || n < -90 || n > 365) return setProblem("צריך מספר שלם של ימים, בין 90- (אחרי השבוע) ל-365.");
    const ok = await onSave({ title, days_before: n });
    if (ok && !initial) {
      setTitle("");
      setDays("");
    }
  };
  return (
    <form onSubmit={submit} aria-label={initial ? "עריכת אבן דרך" : "אבן דרך חדשה"} className="grid gap-2 rounded-lg border border-line bg-paper p-3 sm:grid-cols-[1fr_12rem]" noValidate>
      <Field id={`${id}-t`} label="אבן הדרך">
        <input id={`${id}-t`} className={INPUT} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field id={`${id}-d`} label="כמה ימים לפני השבוע" hint="הצעה. 42 = W−42; מספר שלילי = אחרי השבוע.">
        <input id={`${id}-d`} className={INPUT} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} aria-describedby={`${id}-d-hint`} dir="ltr" />
      </Field>
      {problem && (
        <p role="alert" className="text-sm text-bad sm:col-span-2">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button kind="primary" type="submit" busy={busy} busyLabel="שומר…">
          {initial ? "שמירה" : "הוספת אבן דרך"}
        </Button>
        {onCancel && <Button onClick={onCancel}>ביטול</Button>}
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ notes

function Notes({ edition, list, admin, global, k, act, busy, names }: { edition: Edition; list: Note[]; admin: boolean; global: boolean; k: KnowledgePort; act: Act; busy: string | null; names: Map<number, string> }) {
  const [adding, setAdding] = useState(false);
  return (
    <Panel title="ידע" aside="הערות לפי מדור, לכל השנים או למחזור הזה">
      {list.length === 0 && (
        <p className="mb-3 text-ink-soft">
          עוד אין כאן הערות.{" "}
          {admin
            ? "כאן כותבים מה שכדאי שהצוות הבא ידע: איך עבדנו, מה למדנו, מה היה קשה, ונוסחים שחוזרים כל שנה."
            : "כשהמדריך/ה יכתוב/תכתוב כאן איך עבדנו, מה למדנו ומה היה קשה, זה יופיע כאן."}
        </p>
      )}
      {admin &&
        (adding ? (
          <NoteForm
            edition={edition}
            global={global}
            busy={busy === "add-note"}
            onCancel={() => setAdding(false)}
            onSave={async (v) => {
              const ok = await act("add-note", () => k.addNote(v), "ההערה נוספה");
              if (ok) setAdding(false);
              return ok;
            }}
          />
        ) : (
          <Button kind="primary" onClick={() => setAdding(true)} className="mb-3">
            + הערה חדשה
          </Button>
        ))}
      {NOTE_SECTIONS.map((s) => {
        const notes = list.filter((n) => n.section === s);
        if (notes.length === 0) return null;
        return (
          <section key={s} aria-label={NOTE_SECTION_LABEL[s]} className="mt-4">
            <h3 className="mb-2 font-display text-lg font-semibold">{NOTE_SECTION_LABEL[s]}</h3>
            <ul className="space-y-3">
              {notes.map((n) => (
                <NoteItem key={n.id} n={n} edition={edition} mayEdit={n.edition_id == null ? global : admin} global={global} k={k} act={act} busy={busy} names={names} />
              ))}
            </ul>
          </section>
        );
      })}
    </Panel>
  );
}

function NoteItem({ n, edition, mayEdit, global, k, act, busy, names }: { n: Note; edition: Edition; mayEdit: boolean; global: boolean; k: KnowledgePort; act: Act; busy: string | null; names: Map<number, string> }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  if (editing) {
    return (
      <li>
        <NoteForm
          initial={n}
          edition={edition}
          global={global}
          busy={busy === `note-${n.id}`}
          onCancel={() => setEditing(false)}
          onSave={async (v) => {
            const ok = await act(`note-${n.id}`, () => k.updateNote(n.id, n.version, { section: v.section, title: v.title, body_md: v.body_md }), "נשמר", (code) => {
              if (code === "stale") setEditing(false); // someone else saved it: their version is on screen now
              return false;
            });
            if (ok) setEditing(false);
            return ok;
          }}
        />
      </li>
    );
  }
  return (
    <li data-note={n.id} className="rounded-lg border border-line p-3">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h4 className="font-semibold">{n.title}</h4>
        <Badge tone={n.edition_id == null ? "accent" : "neutral"}>{n.edition_id == null ? "לכל השנים" : `מחזור ${edition.label}`}</Badge>
        {mayEdit && !deleting && (
          <span className="ms-auto flex gap-1">
            <Button kind="quiet" onClick={() => setEditing(true)} aria-label={`עריכת ${n.title}`}>
              עריכה
            </Button>
            <Button kind="danger" onClick={() => setDeleting(true)} aria-label={`מחיקת ${n.title}`}>
              מחיקה
            </Button>
          </span>
        )}
      </div>
      {n.body_md ? <Markdown source={n.body_md} top={4} /> : <p className="text-sm text-ink-soft">(בלי תוכן)</p>}
      <p className="mt-1 text-xs text-ink-soft">
        עודכן {fmtDate(new Date(n.updated_at))}
        {n.updated_by != null && names.get(n.updated_by) ? ` · ${names.get(n.updated_by)}` : ""}
      </p>
      {deleting && (
        <div className="mt-2">
          <Confirm text={<>למחוק את ההערה «{n.title}»?</>} confirm="מחיקה" busy={busy === `del-note-${n.id}`} onCancel={() => setDeleting(false)} onConfirm={() => void act(`del-note-${n.id}`, () => k.deleteNote(n.id), "ההערה נמחקה")} />
        </div>
      )}
    </li>
  );
}

function NoteForm({
  initial,
  edition,
  global,
  onSave,
  onCancel,
  busy,
}: {
  initial?: Note;
  edition: Edition;
  global: boolean;
  onSave: (v: { edition_id: number | null; section: NoteSection; title: string; body_md: string }) => Promise<boolean>;
  onCancel: () => void;
  busy: boolean;
}) {
  const id = useId();
  const [section, setSection] = useState<NoteSection>(initial?.section ?? "process");
  const [scope, setScope] = useState<"edition" | "all">(initial ? (initial.edition_id == null ? "all" : "edition") : "edition");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body_md ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!title.trim()) return setProblem(errorMessage("title_required"));
    await onSave({ edition_id: scope === "all" ? null : edition.id, section, title, body_md: body });
  };
  return (
    <form onSubmit={submit} aria-label={initial ? "עריכת הערה" : "הערה חדשה"} className="mb-3 space-y-2 rounded-lg border border-line bg-paper p-3" noValidate>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field id={`${id}-s`} label="מדור">
          <select id={`${id}-s`} className={INPUT} value={section} onChange={(e) => setSection(e.target.value as NoteSection)}>
            {NOTE_SECTIONS.map((s) => (
              <option key={s} value={s}>
                {NOTE_SECTION_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        {/* the scope is fixed once written (the database never moves a note between years) */}
        {!initial && global ? (
          <fieldset>
            <legend className="mb-1 text-sm font-semibold">למי</legend>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["edition", `למחזור ${edition.label}`],
                  ["all", "לכל השנים"],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 ${scope === v ? "border-ink bg-ink/5 font-semibold" : "border-line bg-card"}`}>
                  <input type="radio" name={`${id}-scope`} checked={scope === v} onChange={() => setScope(v)} className="accent-ink" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="self-end text-sm text-ink-soft">{scope === "all" ? "לכל השנים" : `למחזור ${edition.label}`}</p>
        )}
      </div>
      <Field id={`${id}-t`} label="כותרת">
        <input id={`${id}-t`} className={INPUT} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field id={`${id}-b`} label="התוכן" hint="פסקה בכל שורה ריקה; רשימה בשורות שמתחילות ב-«- »; **הדגשה** בין שתי כוכביות.">
        <textarea id={`${id}-b`} className={`${INPUT} min-h-32 py-2`} value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} aria-describedby={`${id}-b-hint`} />
      </Field>
      {body.trim() && (
        <section aria-label="תצוגה מקדימה של ההערה" className="rounded-lg border border-dashed border-line bg-card p-2 text-sm">
          <Markdown source={body} top={4} />
        </section>
      )}
      {problem && (
        <p role="alert" className="text-sm text-bad">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" type="submit" busy={busy} busyLabel="שומר…">
          {initial ? "שמירה" : "הוספת ההערה"}
        </Button>
        <Button onClick={onCancel}>ביטול</Button>
      </div>
    </form>
  );
}
