// «ההרשמה» on /kk: the window (the admin sets it; none = closed), where the link is issued, and «עוד לא נרשמו» —
// the roster without the leaders and without anyone signed up — with the staff's placement. The staff are not
// bound by the window, the capacity or the offer: they place a trainee in any group (kk_place).
import { type FormEvent, useEffect, useId, useState } from "react";
import { Link } from "react-router";
import type { KkData } from "../../data/kk";
import type { DataPort } from "../../data/port";
import { israelInstant, israelLocal } from "../../domain/israelTime";
import { groupName, notYet, traineeLeaders } from "../../domain/kk";
import { kkWindowState, kkWindowText } from "../../domain/kkWindow";
import type { Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Badge, Button, Field, Fold, INPUT, useFocusBack } from "../settings/kit";
import { type Act, byBook } from "./parts";

export function SignupPanel({ week, kk, admin, busy, act, port, onSaved }: { week: Week; kk: KkData | null; admin: boolean; busy: string | null; act: Act; port: DataPort; onSaved: () => Promise<void> }) {
  const state = kkWindowState(week.edition.settings?.kk_window ?? null);
  return (
    <section aria-label="ההרשמה" className="space-y-3 rounded-xl border border-line bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-lg font-semibold">ההרשמה</h3>
        <Badge tone={state === "open" ? "ok" : "muted"}>{state === "open" ? "פתוחה עכשיו" : "סגורה עכשיו"}</Badge>
      </div>
      <WindowPanel week={week} admin={admin} busy={busy} act={act} port={port} onSaved={onSaved} />
      {/* where the link is issued: the admin's one pointer */}
      {admin && (
        <p className="text-sm text-ink-soft">
          קישור ההרשמה:{" "}
          <Link to="/settings/links" className="inline-flex min-h-11 items-center font-semibold underline">
            בהגדרות ← «קישורים»
          </Link>
        </p>
      )}
      {kk && <NotYet week={week} kk={kk} admin={admin} busy={busy} act={act} port={port} />}
    </section>
  );
}

// ------------------------------------------------------------------ the window

function WindowPanel({ week, admin, busy, act, port, onSaved }: { week: Week; admin: boolean; busy: string | null; act: Act; port: DataPort; onSaved: () => Promise<void> }) {
  const id = useId();
  const w = week.edition.settings?.kk_window ?? null;
  const [opens, setOpens] = useState(w ? israelLocal(w.opens_at) : "");
  const [closes, setCloses] = useState(w ? israelLocal(w.closes_at) : "");
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setOpens(w ? israelLocal(w.opens_at) : "");
    setCloses(w ? israelLocal(w.closes_at) : "");
  }, [w?.opens_at, w?.closes_at]);
  // set once or twice a season: the state for everyone, the form behind «עריכת החלון»; closed, the button has the focus
  // back — saved, the fields follow the saved window (the effect above); cancelled, they return to it
  const [editing, setEditing] = useState(false);
  const focusBack = useFocusBack();
  const done = () => {
    setProblem(null);
    setEditing(false);
    focusBack.back();
  };
  const cancel = () => {
    setOpens(w ? israelLocal(w.opens_at) : "");
    setCloses(w ? israelLocal(w.closes_at) : "");
    done();
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!opens.trim() || !closes.trim()) return setProblem("צריך למלא תאריך ושעה גם לפתיחה וגם לסגירה.");
    const o = israelInstant(opens);
    const c = israelInstant(closes);
    if (!o || !c) return setProblem("השעה הזו לא קיימת בשעון ישראל (הלילה שבו עוברים לשעון קיץ). בוחרים שעה אחרת.");
    if (Date.parse(o) >= Date.parse(c)) return setProblem("הסגירה צריכה להיות אחרי הפתיחה.");
    const ok = await act("window", () => port.kk.setWindow(week.edition.id, o, c), "חלון ההרשמה נשמר");
    if (ok) {
      await onSaved();
      done();
    }
  };
  const close = async () => {
    setProblem(null);
    const ok = await act("window-none", () => port.kk.setWindow(week.edition.id, null, null), "ההרשמה סגורה: אין חלון");
    if (ok) {
      await onSaved();
      done();
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm">{kkWindowText(w)}</p>
        {admin ? (
          <Button ref={focusBack.ref()} kind="quiet" aria-expanded={editing} aria-controls={`${id}-form`} onClick={() => (editing ? cancel() : setEditing(true))}>
            עריכת החלון
          </Button>
        ) : (
          <span className="text-xs text-ink-soft">את החלון קובע/ת המדריך/ה.</span>
        )}
      </div>
      {admin && editing && (
        <form id={`${id}-form`} onSubmit={(e) => void save(e)} aria-label="חלון ההרשמה" className="mt-3 space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`${id}-o`} label="נפתחת (שעון ישראל)">
              <input id={`${id}-o`} type="datetime-local" value={opens} onChange={(e) => setOpens(e.target.value)} className={INPUT} />
            </Field>
            <Field id={`${id}-c`} label="נסגרת (שעון ישראל)">
              <input id={`${id}-c`} type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} className={INPUT} />
            </Field>
          </div>
          <p className="text-xs text-ink-soft">הקישור להרשמה מפסיק לעבוד כשהחלון נסגר. אחרי הסגירה רק הצוות משבץ ומעביר.</p>
          {problem && (
            <p role="alert" className="text-sm text-bad">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button kind="primary" type="submit" busy={busy === "window"} busyLabel="שומר…">
              שמירת החלון
            </Button>
            {w && (
              <Button kind="quiet" onClick={() => void close()} busy={busy === "window-none"}>
                בלי חלון (ההרשמה סגורה)
              </Button>
            )}
            <Button onClick={cancel}>ביטול</Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ who has not signed up yet

/**
 * «עוד לא נרשמו»: the roster's names with no sign-up this week and no group to lead (the leaders are named apart: they
 * are in their group already) — and, for an admin, placing one in any group.
 */
function NotYet({ week, kk, admin, busy, act, port }: { week: Week; kk: KkData; admin: boolean; busy: string | null; act: Act; port: DataPort }) {
  const id = useId();
  const [who, setWho] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const missing = notYet(week.roster, kk);
  const leading = traineeLeaders(kk);
  const leaders = week.roster.filter((r) => leading.has(r.id));
  const groups = byBook(kk.groups);
  // the name picked stays picked while the screen reads again (another admin may have made them a leader meanwhile):
  // the server's refusal says so, never a silent change of who is placed
  const picked = who != null && !missing.some((r) => r.id === who) ? week.roster.find((r) => r.id === who) : undefined;
  const place = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (who == null || to == null) return;
    let refused = false;
    const ok = await act("place", () => port.kk.place(to, who), "שובץ/ה", (code) => {
      if (code !== "is_leader" && code !== "bad_trainee") return false;
      setProblem(errorMessage(code));
      refused = true;
      return true;
    });
    // placed, or not to be placed (a leader, or no longer of the roster): the name leaves the field
    if (ok || refused) setWho(null);
  };
  return (
    <Fold title="עוד לא נרשמו" hint={<span data-kk-missing>{missing.length}</span>} className="rounded-lg border border-line px-3 py-0.5">
      {leaders.length > 0 && <p className="text-sm text-ink-soft">מעבירים קבוצה (הם כבר בקבוצה שלהם): {leaders.map((r) => r.full_name).join(" · ")}</p>}
      {missing.length === 0 ? (
        <p className="text-sm text-ink-soft">כל החניכים ברשימה נרשמו.</p>
      ) : (
        <ul aria-label="עוד לא נרשמו" className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {missing.map((r) => (
            <li key={r.id}>{r.full_name}</li>
          ))}
        </ul>
      )}
      {admin && groups.length > 0 && (missing.length > 0 || picked) && (
        <form onSubmit={(e) => void place(e)} aria-label="שיבוץ" className="mt-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field id={`${id}-w`} label="חניך/ה">
              <select
                id={`${id}-w`}
                value={who ?? ""}
                onChange={(e) => {
                  setProblem(null);
                  setWho(e.target.value ? Number(e.target.value) : null);
                }}
                className={INPUT}
              >
                <option value="">בחירה</option>
                {[...(picked ? [picked] : []), ...missing].map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-g`} label="לקבוצה">
              <select id={`${id}-g`} value={to ?? ""} onChange={(e) => setTo(e.target.value ? Number(e.target.value) : null)} className={`${INPUT} max-w-72`}>
                <option value="">בחירה</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {groupName(g, kk, week.roster)}
                  </option>
                ))}
              </select>
            </Field>
            {/* placed, the name leaves the field: inactive, and the focus stays here for the next one */}
            <Button kind="primary" type="submit" disabled={who == null || to == null} keepFocus busy={busy === "place"}>
              שיבוץ
            </Button>
          </div>
        </form>
      )}
      {/* outside the form: a refusal may leave nobody to place, and the form with it */}
      {problem && (
        <p role="alert" className="mt-2 text-sm text-bad">
          {problem}
        </p>
      )}
    </Fold>
  );
}
