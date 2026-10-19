// «צוות» — who may sign in to an edition, and as what. An edition's admin
// manages its content and logistics members; admin rows (and making someone an
// admin) belong to a global admin — the database refuses anything else
// (members_admin_write), so the screen never offers it. Nobody who has done
// anything is deleted: they are deactivated, and their history stays.
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { Link } from "react-router";
import type { MemberRow } from "../../data/settings";
import type { Role } from "../../data/types";
import { byGender } from "../../domain/names";
import type { Edition, Gender } from "../../domain/types";
import { errorMessage } from "../../errors";
import { ROLE_LABEL } from "../../lib/labels";
import { Badge, Button, Confirm, EditionPicker, Field, GENDER_LABEL, GenderField, INPUT, LoadError, Loading, Panel, Row, Rows, useAction, useSettings } from "./kit";

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

  const load = useCallback(async () => {
    if (editionId == null) return;
    setFailed(false);
    try {
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
  }, [port, editionId, me.global_admin]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  const myRow = [...(everywhere ?? []), ...(rows ?? [])].find((r) => r.email === me.email);

  return (
    <>
      <MyProfile gender={myRow?.gender ?? null} onSaved={load} />
      {editions.length === 0 ? (
        <NoEdition />
      ) : (
        <>
          <EditionPicker editions={editions} value={editionId} onChange={setEditionId} />
          {editionId != null && <AddMember key={editionId} editionId={editionId} onAdded={load} />}
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
                    {rows.filter((r) => r.active).length} פעילים
                    {rows.some((r) => !r.active) && ` · ${rows.filter((r) => !r.active).length} מושבתים`}
                  </>
                }
              >
                {rows.length === 0 ? (
                  <p className="text-ink-soft">עוד אין אף אחד ברשימה של המחזור הזה. מוסיפים בטופס שלמעלה.</p>
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
              </Panel>
              <Panel title="בכל המחזורים" aside={me.global_admin ? "מוסיפים רק ב-SQL Editor, לפי מדריך ההקמה" : "לצפייה בלבד"}>
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
                            {m.display_name || "(בלי שם)"} {m.email === me.email && <Badge tone="accent">זה/זו את/ה</Badge>}
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

/** My own name and gender — the header shows the address until a name is set. */
function MyProfile({ gender, onSaved }: { gender: Gender | null; onSaved: () => Promise<void> }) {
  const { port, me, onMeChanged } = useSettings();
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(!me.display_name);
  const [name, setName] = useState(me.display_name ?? "");
  const [g, setG] = useState<Gender | null>(gender);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();

  useEffect(() => setG(gender), [gender]);

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
          <Button kind="primary" type="submit" busy={busy === "me"} busyLabel="שומר…">
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

function AddMember({ editionId, onAdded }: { editionId: number; onAdded: () => Promise<void> }) {
  const { port } = useSettings();
  const { busy, run } = useAction();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [role, setRole] = useState<Role>("content");
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();

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
        setProblem(errorMessage(code));
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
    <Panel title="הוספת חבר/ת צוות">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate aria-describedby={problem ? `${id}-problem` : undefined}>
        <Field id={`${id}-email`} label="כתובת Gmail" hint="הכתובת שאיתה נכנסים עם Google.">
          <input
            id={`${id}-email`}
            className={INPUT}
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
            aria-describedby={`${id}-email-hint`}
          />
        </Field>
        <Field id={`${id}-name`} label="שם">
          <input id={`${id}-name`} className={INPUT} value={name} maxLength={80} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </Field>
        <GenderField name={`${id}-gender`} value={gender} onChange={setGender} />
        <RoleField name={`${id}-role`} value={role} onChange={setRole} />
        {problem && (
          <p id={`${id}-problem`} role="alert" className="text-sm text-bad sm:col-span-2">
            {problem}
          </p>
        )}
        <div className="sm:col-span-2">
          <Button kind="primary" type="submit" busy={busy === "add"} busyLabel="מוסיף…" disabled={!email.trim() || !name.trim()}>
            הוספה לצוות
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function MemberItem({ m, onChanged }: { m: MemberRow; onChanged: () => Promise<void> }) {
  const { port, me } = useSettings();
  const { busy, run } = useAction();
  const [mode, setMode] = useState<"view" | "edit" | "delete" | "history">("view");
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
      {m.display_name || "(בלי שם)"} {isMe && <Badge tone="accent">זה/זו את/ה</Badge>}
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
  if (mode === "edit") return <Row cells={cells} editing={<EditMember m={m} onDone={(saved) => void doneEditing(saved)} />} />;
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
            onCancel={() => setMode("view")}
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
            <Confirm text={errorMessage("member_has_history")} confirm="השבתה" danger={false} busy={busy === "active"} onConfirm={() => void setActive(false)} onCancel={() => setMode("view")} />
          ) : (
            <div role="group" aria-label="אישור" className="rounded-lg border border-line bg-paper p-3 text-sm">
              <p className="mb-2">{shown} כבר מושבת/ת, וההיסטוריה נשמרת. אי אפשר למחוק.</p>
              <Button onClick={() => setMode("view")}>הבנתי</Button>
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
            <Button kind="quiet" onClick={() => setMode("edit")} aria-label={`עריכת ${shown}`}>
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
            <Button kind="danger" onClick={() => setMode("delete")} aria-label={`מחיקת ${shown}`}>
              מחיקה
            </Button>
          </>
        )
      }
    />
  );
}

function EditMember({ m, onDone }: { m: MemberRow; onDone: (saved: boolean) => void }) {
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
      </div>
    </form>
  );
}
