// «צוות» — who may sign in to an edition, and as what. An edition's admin
// manages its content and logistics members; admin rows (and making someone an
// admin) belong to a global admin — the database refuses anything else
// (members_admin_write), so the screen never offers it. Nobody who has done
// anything is deleted: they are deactivated, and their history stays.
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import type { MemberRow } from "../../data/settings";
import type { Role } from "../../data/types";
import { byGender } from "../../domain/names";
import type { Edition, Gender } from "../../domain/types";
import { errorMessage } from "../../errors";
import { ROLE_LABEL } from "../../lib/labels";
import { Badge, Button, Confirm, EditionPicker, Field, Fold, GENDER_LABEL, GenderField, INPUT, LoadError, Loading, Panel, Row, Rows, useAction, useFocusBack, useSettings } from "./kit";

interface Props {
  editions: Edition[];
  editionId: number | null;
  setEditionId: (id: number) => void;
}

/** Someone who works on every edition. An edition's admin sees their name only (public.team), never the address. */
type Everywhere = Pick<MemberRow, "id" | "display_name" | "gender" | "role"> & { email: string | null; active: boolean };

const FORM_REFUSALS = ["bad_email", "name_required", "member_exists", "bad_value"];

export function TeamTab({ editions, editionId, setEditionId }: Props) {
  const { port, me } = useSettings();
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [everywhere, setEverywhere] = useState<Everywhere[] | null>(null);
  const [failed, setFailed] = useState(false);

  const none = editions.length === 0;
  const load = useCallback(async () => {
    if (editionId == null && !none) return; // the edition is about to be picked
    setFailed(false);
    try {
      // Before the first edition there is no edition's team — but my own (global) row, with my gender, is still read.
      if (editionId == null) {
        setRows([]);
        setEverywhere(me.global_admin ? await port.members(null) : []);
        return;
      }
      const mine = await port.members(editionId);
      let all: Everywhere[];
      if (me.global_admin) all = await port.members(null);
      else {
        const seen = new Set(mine.map((m) => m.id));
        all = (await port.team(editionId)).filter((t) => !seen.has(t.id)).map((t) => ({ ...t, email: null, active: true }));
      }
      setRows(mine);
      setEverywhere(all);
    } catch {
      setFailed(true);
    }
  }, [port, editionId, none, me.global_admin]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  const myRow = [...(everywhere ?? []), ...(rows ?? [])].find((r) => r.email === me.email);
  const activeCount = rows?.filter((r) => r.active).length ?? 0;
  const inactiveCount = rows?.filter((r) => !r.active).length ?? 0;

  return (
    <>
      {/* gender undefined = not read yet: the form waits, so a save never wipes a saved gender */}
      <MyProfile gender={rows && everywhere ? (myRow?.gender ?? null) : undefined} onSaved={load} />
      {editions.length === 0 ? (
        <NoEdition />
      ) : (
        <>
          <EditionPicker editions={editions} value={editionId} onChange={setEditionId} />
          {failed ? (
            <LoadError onRetry={() => void load()} />
          ) : !rows || !everywhere ? (
            <Loading />
          ) : (
            <>
              <Panel
                title="צוות המחזור"
                aside={
                  <>
                    {activeCount === 1 ? "פעיל/ה אחד/ת" : `${activeCount} פעילים`}
                    {inactiveCount > 0 && ` · ${inactiveCount === 1 ? "מושבת/ת אחד/ת" : `${inactiveCount} מושבתים`}`}
                  </>
                }
              >
                {rows.length === 0 ? (
                  <p className="text-ink-soft">עוד אין אף אחד בצוות של המחזור הזה.</p>
                ) : (
                  <Rows label="צוות המחזור" head={["שם", "מייל", "מגדר", "תפקיד", "מצב"]}>
                    {rows.map((m) => (
                      <MemberItem key={m.id} m={m} onChanged={load} />
                    ))}
                  </Rows>
                )}
                {!me.global_admin && rows.some((r) => r.role === "admin" && r.email !== me.email) && (
                  <p className="mt-3 text-xs text-ink-soft">שורה של מדריך/ה משנה רק מי שמדריך/ה בכל המחזורים.</p>
                )}
                {/* adding is occasional: under the list, folded — open while the edition has nobody */}
                {editionId != null && <AddMember key={editionId} editionId={editionId} empty={rows.length === 0} onAdded={load} />}
              </Panel>
              <Panel title="בכל המחזורים" aside={me.global_admin ? undefined : "לצפייה בלבד"}>
                {everywhere.length === 0 ? (
                  <p className="text-ink-soft">אין.</p>
                ) : (
                  <Rows label="בכל המחזורים" head={["שם", "מייל", "מגדר", "תפקיד", "מצב"]}>
                    {everywhere.map((m) => (
                      <Row
                        key={m.id}
                        muted={!m.active}
                        cells={[
                          <>
                            {m.display_name || "(בלי שם)"} {m.email === me.email && <Badge tone="accent">החשבון שלך</Badge>}
                          </>,
                          m.email ? <bdi dir="ltr">{m.email}</bdi> : "",
                          m.gender ? GENDER_LABEL[m.gender] : "",
                          ROLE_LABEL[m.role],
                          m.active ? "" : <Badge tone="muted">מושבת/ת</Badge>,
                        ]}
                      />
                    ))}
                  </Rows>
                )}
              </Panel>
            </>
          )}
        </>
      )}
    </>
  );
}

function NoEdition() {
  const { me } = useSettings();
  return (
    <Panel title="עוד לא נפתח מחזור">
      <p className="mb-3 text-ink-soft">חברי צוות מוסיפים למחזור. קודם פותחים את המחזור של השנה.</p>
      {me.global_admin && (
        <Link to="/settings/edition" className="inline-flex min-h-11 items-center rounded-lg bg-ink px-4 font-semibold text-paper hover:bg-ink/90">
          לפתיחת מחזור
        </Link>
      )}
    </Panel>
  );
}

/**
 * My own name and gender — the header shows the address until a name is set.
 * `gender` is undefined until my row is read: set_my_profile() writes both, so
 * saving before then would erase a gender saved earlier.
 */
function MyProfile({ gender, onSaved }: { gender: Gender | null | undefined; onSaved: () => Promise<void> }) {
  const { port, me, onMeChanged } = useSettings();
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(!me.display_name);
  const [name, setName] = useState(me.display_name ?? "");
  const [g, setG] = useState<Gender | null>(gender ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const known = gender !== undefined;

  useEffect(() => setG(gender ?? null), [gender]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const ok = await run("me", () => port.setMyProfile({ display_name: name, gender: g }), "הפרטים שלך נשמרו", (code) => {
      if (!code || !FORM_REFUSALS.includes(code)) return false;
      setProblem(errorMessage(code));
      return true;
    });
    if (ok) {
      setEditing(false);
      await onMeChanged();
      await onSaved();
    }
  };

  if (!editing) {
    return (
      <Panel title="הפרטים שלי">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p>
            <b>{me.display_name}</b>
            {gender && <span className="text-ink-soft"> · {GENDER_LABEL[gender]}</span>}
            <span className="text-ink-soft"> · </span>
            <bdi dir="ltr" className="text-sm text-ink-soft break-all">
              {me.email}
            </bdi>
          </p>
          <Button onClick={() => setEditing(true)}>עריכה</Button>
        </div>
      </Panel>
    );
  }
  return (
    <Panel title="הפרטים שלי">
      {!me.display_name && (
        <p className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-sm">עוד אין לך שם במערכת, ולכן בראש המסך מופיעה כתובת המייל. השם יוצג לצוות.</p>
      )}
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2" noValidate>
        <Field id={`${id}-name`} label="השם שיוצג לצוות">
          <input id={`${id}-name`} className={INPUT} value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} />
        </Field>
        <GenderField name={`${id}-gender`} value={g} onChange={setG} />
        {problem && (
          <p role="alert" className="text-sm text-bad sm:col-span-2">
            {problem}
          </p>
        )}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button kind="primary" type="submit" busy={busy === "me" || !known} busyLabel={known ? "שומר…" : "טוען…"}>
            שמירה
          </Button>
          {me.display_name && <Button onClick={() => setEditing(false)}>ביטול</Button>}
        </div>
      </form>
    </Panel>
  );
}

function RoleField({ name, value, onChange }: { name: string; value: Role; onChange: (r: Role) => void }) {
  const { me } = useSettings();
  const options: [Role, string][] = [
    ["content", "צוות תוכן"],
    ["logistics", "צוות לוגיסטי"],
    ...(me.global_admin ? ([["admin", "מדריך/ה של המחזור"]] as [Role, string][]) : []),
  ];
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-sm font-semibold">תפקיד</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([r, label]) => (
          <label key={r} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 ${value === r ? "border-ink bg-ink/5 font-semibold" : "border-line bg-card"}`}>
            <input type="radio" name={name} checked={value === r} onChange={() => onChange(r)} className="accent-ink" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AddMember({ editionId, empty, onAdded }: { editionId: number; empty: boolean; onAdded: () => Promise<void> }) {
  const { port } = useSettings();
  const { busy, run } = useAction();
  // where the fold starts, once: the first member added does not close it under the hand that added them
  const [startOpen] = useState(empty);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [role, setRole] = useState<Role>("content");
  const [problem, setProblem] = useState<{ code: string; text: string } | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const id = useId();
  // A refusal about the address marks the address field itself.
  const emailBad = problem?.code === "bad_email" || problem?.code === "member_exists";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const shown = name.trim();
    const ok = await run(
      "add",
      () => port.addMember({ email, display_name: name, gender, role, edition_id: editionId }),
      `${shown} ${byGender(gender, "נוסף", "נוספה")} לצוות`,
      (code) => {
        if (!code || !FORM_REFUSALS.includes(code)) return false;
        setProblem({ code, text: errorMessage(code) });
        if (code === "bad_email" || code === "member_exists") emailRef.current?.focus();
        return true;
      },
    );
    if (ok) {
      setEmail("");
      setName("");
      setGender(null);
      setRole("content");
      await onAdded();
    }
  };

  return (
    <Fold title="+ חבר/ת צוות" defaultOpen={startOpen} className="mt-2">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate aria-describedby={problem ? `${id}-problem` : undefined}>
        <Field id={`${id}-email`} label="כתובת Gmail" hint="הכתובת שאיתה נכנסים עם Google.">
          <input
            ref={emailRef}
            id={`${id}-email`}
            className={`${INPUT} aria-[invalid=true]:border-bad aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-bad`}
            aria-invalid={emailBad || undefined}
            type="email"
            dir="ltr"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setProblem(null);
            }}
            aria-describedby={emailBad ? `${id}-email-hint ${id}-problem` : `${id}-email-hint`}
          />
        </Field>
        <Field id={`${id}-name`} label="שם">
          <input id={`${id}-name`} className={INPUT} value={name} maxLength={80} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </Field>
        <GenderField name={`${id}-gender`} value={gender} onChange={setGender} />
        <RoleField name={`${id}-role`} value={role} onChange={setRole} />
        {problem && (
          <p id={`${id}-problem`} role="alert" className="text-sm text-bad sm:col-span-2">
            {problem.text}
          </p>
        )}
        <div className="sm:col-span-2">
          <Button kind="primary" type="submit" busy={busy === "add"} busyLabel="מוסיף…" disabled={!email.trim() || !name.trim()}>
            הוספה לצוות
          </Button>
        </div>
      </form>
    </Fold>
  );
}

function MemberItem({ m, onChanged }: { m: MemberRow; onChanged: () => Promise<void> }) {
  const { port, me, wide } = useSettings();
  const { busy, run } = useAction();
  const [mode, setMode] = useState<"view" | "edit" | "delete" | "history">("view");
  // «ביטול» (or «הבנתי») takes the confirm (and its focus) away: the row's «מחיקה», where the delete began, takes it back —
  // on a phone, where «מחיקה» is in the edit form the cancel closes, «עריכה», which holds it
  const focusBack = useFocusBack();
  const backToDelete = () => {
    setMode("view");
    focusBack.back(wide ? "delete" : "edit");
  };
  const isMe = m.email === me.email;
  // members_admin_write: a global admin manages any row; an edition's admin only non-admin rows. Never my own admin row.
  const manageable = !isMe && (me.global_admin || m.role !== "admin");
  const shown = m.display_name || m.email;

  const setActive = async (active: boolean) => {
    const ok = await run(
      "active",
      () => port.updateMember(m.id, { active }),
      active ? `${shown} ${byGender(m.gender, "חזר", "חזרה")} לצוות` : `${shown} ${byGender(m.gender, "הושבת", "הושבתה")}. הכניסה נחסמה, וההיסטוריה נשמרת.`,
    );
    if (ok) {
      setMode("view");
      await onChanged();
    }
  };
  const remove = async () => {
    const ok = await run("delete", () => port.deleteMember(m.id), `${shown} ${byGender(m.gender, "נמחק", "נמחקה")} מהרשימה`, (code) => {
      if (code !== "member_has_history") return false;
      setMode("history");
      return true;
    });
    if (ok) await onChanged();
  };

  const cells = [
    <>
      {m.display_name || "(בלי שם)"} {isMe && <Badge tone="accent">החשבון שלך</Badge>}
    </>,
    <bdi dir="ltr">{m.email}</bdi>,
    m.gender ? GENDER_LABEL[m.gender] : "",
    ROLE_LABEL[m.role],
    m.active ? "" : <Badge tone="muted">מושבת/ת</Badge>,
  ];

  const doneEditing = async (saved: boolean) => {
    setMode("view");
    if (saved) await onChanged();
  };
  if (mode === "edit") return <Row cells={cells} editing={<EditMember m={m} onDone={(saved) => void doneEditing(saved)} onDelete={() => setMode("delete")} />} />;
  if (mode === "delete") {
    return (
      <Row
        cells={cells}
        editing={
          <Confirm
            text={
              <>
                למחוק את <b>{shown}</b> מהרשימה? אפשר למחוק רק מי שעוד לא עשה/תה כלום במערכת.
              </>
            }
            confirm="מחיקה"
            busy={busy === "delete"}
            onConfirm={() => void remove()}
            onCancel={backToDelete}
          />
        }
      />
    );
  }
  if (mode === "history") {
    return (
      <Row
        cells={cells}
        editing={
          m.active ? (
            <Confirm
              text={
                <>
                  <b>{shown}</b>: {errorMessage("member_has_history")}
                </>
              }
              confirm="השבתה"
              danger={false}
              busy={busy === "active"}
              onConfirm={() => void setActive(false)}
              onCancel={backToDelete}
            />
          ) : (
            <div role="group" aria-label="אישור" className="rounded-lg border border-line bg-paper p-3 text-sm">
              <p className="mb-2">
                <b>{shown}</b> כבר מושבת/ת, וההיסטוריה נשמרת. אי אפשר למחוק.
              </p>
              <Button onClick={backToDelete}>הבנתי</Button>
            </div>
          )
        }
      />
    );
  }
  return (
    <Row
      muted={!m.active}
      cells={cells}
      actions={
        manageable && (
          <>
            <Button ref={focusBack.ref("edit")} kind="quiet" onClick={() => setMode("edit")} aria-label={`עריכת ${shown}`}>
              עריכה
            </Button>
            {m.active ? (
              <Button kind="quiet" busy={busy === "active"} onClick={() => void setActive(false)} aria-label={`השבתת ${shown}`}>
                השבתה
              </Button>
            ) : (
              <Button kind="quiet" busy={busy === "active"} onClick={() => void setActive(true)} aria-label={`החזרת ${shown}`}>
                החזרה
              </Button>
            )}
            {/* on a phone «מחיקה» is inside «עריכה», so a row stays one line */}
            {wide && (
              <Button ref={focusBack.ref("delete")} kind="danger" onClick={() => setMode("delete")} aria-label={`מחיקת ${shown}`}>
                מחיקה
              </Button>
            )}
          </>
        )
      }
    />
  );
}

function EditMember({ m, onDone, onDelete }: { m: MemberRow; onDone: (saved: boolean) => void; onDelete: () => void }) {
  const { port } = useSettings();
  const { busy, run } = useAction();
  const [name, setName] = useState(m.display_name);
  const [gender, setGender] = useState<Gender | null>(m.gender);
  const [role, setRole] = useState<Role>(m.role);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const ok = await run("save", () => port.updateMember(m.id, { display_name: name, gender, role }), "נשמר", (code) => {
      if (!code || !FORM_REFUSALS.includes(code)) return false;
      setProblem(errorMessage(code));
      return true;
    });
    if (ok) onDone(true);
  };

  return (
    <form onSubmit={save} className="grid gap-3 rounded-lg border border-line bg-paper p-3 sm:grid-cols-2" noValidate>
      <p className="text-sm text-ink-soft sm:col-span-2">
        עריכת <bdi dir="ltr">{m.email}</bdi>
      </p>
      <Field id={`${id}-name`} label="שם">
        <input id={`${id}-name`} className={INPUT} value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} />
      </Field>
      <GenderField name={`${id}-gender`} value={gender} onChange={setGender} />
      <RoleField name={`${id}-role`} value={role} onChange={setRole} />
      {problem && (
        <p role="alert" className="text-sm text-bad sm:col-span-2">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button kind="primary" type="submit" busy={busy === "save"} busyLabel="שומר…">
          שמירה
        </Button>
        <Button onClick={() => onDone(false)}>ביטול</Button>
        <Button kind="danger" className="ms-auto" onClick={onDelete} aria-label={`מחיקת ${m.display_name || m.email}`}>
          מחיקה
        </Button>
      </div>
    </form>
  );
}
