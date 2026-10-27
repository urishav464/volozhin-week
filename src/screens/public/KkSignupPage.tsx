// The sign-up for מכריכה לכריכה (/k#token), one link for the whole class: the
// trainee picks their name from the year's list (names only; the trainees who
// lead a group are not on it — they are in their group already), then the one
// book they will read all week, and sends. A group meets in every session of
// the week, so the sessions are information, not a choice. The answer is the
// same whatever happened, so the page never tells who already signed up — and
// so it is worded as a request, not a result: «הבקשה נשלחה», what was sent, and
// when a sign-up is recorded (no book yet this week, a place left) — to check or
// change, the team. An existing sign-up is never changed through the link (only
// the staff move one), and the form says so before sending. Outside the window
// the books are shown, and nothing is sent.
import { type FormEvent, useId, useState } from "react";
import { CommandError } from "../../data/commands";
import type { KkForm, KkFormGroup, PublicPort } from "../../data/publicPort";
import { LEADER_KIND_LABEL } from "../../domain/kk";
import { kkWindowState, kkWindowText } from "../../domain/kkWindow";
import { Button, Fold, INPUT } from "../settings/kit";
import { LinkInvalid, LoadFailed, Loading, useLinkLoad, whenOf } from "./parts";

/** The window in words. The server's `open` wins over this device's clock: not open there is before or after it. */
function formWindowText(f: KkForm): string {
  if (f.open) return kkWindowText(f.window, Date.parse(f.window.opens_at!));
  return kkWindowText(f.window, kkWindowState(f.window) === "open" ? Date.parse(f.window.closes_at!) : Date.now());
}

type Sent = { name: string; book: string };

/** The same words for everyone, whatever the server did — no oracle, and no promise that it was recorded. */
export const RECORDED_WHEN = "ההרשמה נקלטת רק אם עוד לא נרשמת לספר השבוע ויש מקום בקבוצה. כדי לבדוק או לשנות — פונים לצוות.";
export const NO_CHANGE = "מי שכבר נרשם/ה לא יכול/ה לשנות את ההרשמה כאן.";

export function KkSignupPage({ port, token }: { port: PublicPort; token: string }) {
  const { load, reload } = useLinkLoad(() => port.kkForm(token));
  const id = useId();
  const [rosterId, setRosterId] = useState<number | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  if (load.state === "loading") return <Loading />;
  if (load.state === "invalid") return <LinkInvalid scope="kk_signup" />;
  if (load.state === "error") return <LoadFailed onRetry={() => void reload().catch(() => {})} />;
  const f = load.data;
  // a book that filled meanwhile (the form read again) is no longer a choice
  const chosen = f.groups.find((g) => g.id === groupId && !g.full) ?? null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (rosterId == null) return setProblem("צריך לבחור את השם שלך מהרשימה.");
    if (!chosen) return setProblem("צריך לבחור ספר.");
    setBusy(true);
    try {
      await port.kkSignup(token, rosterId, chosen.id);
      setSent({ name: f.roster.find((r) => r.id === rosterId)?.full_name ?? "", book: chosen.title });
      setGroupId(null);
      setRosterId(null);
      void reload().catch(() => {}); // a group may have filled meanwhile
    } catch (err) {
      if (err instanceof CommandError && err.code === "link_invalid") void reload().catch(() => {});
      else setProblem("ההרשמה לא נשלחה. אפשר לנסות שוב.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="space-y-1">
        <h2 className="font-display text-2xl font-extrabold">הרשמה למכריכה לכריכה</h2>
        <p className="text-ink-soft">שבוע וולוז'ין {f.edition.label}</p>
      </div>
      <p className={`rounded-lg px-3 py-2 text-sm ${f.open ? "bg-ok/10" : "bg-accent-soft"}`}>{formWindowText(f)}</p>

      {sent && (
        <section role="status" aria-label="הבקשה נשלחה" className="space-y-2 rounded-xl border border-line bg-card p-4">
          <p className="font-semibold">הבקשה נשלחה.</p>
          <p className="text-sm break-words">
            <span className="text-ink-soft">מה ששלחת: </span>
            {sent.name} — {sent.book}
          </p>
          <p className="text-sm">{RECORDED_WHEN}</p>
          <Button onClick={() => setSent(null)}>הרשמה של שם נוסף</Button>
        </section>
      )}

      {!sent && <Sessions f={f} />}

      {!sent && f.groups.length === 0 && <p className="rounded-xl border border-line bg-card p-4 text-ink-soft">עוד אין ספרים להרשמה. כשהצוות יפתח קבוצות, הן יופיעו כאן.</p>}

      {!sent && f.groups.length > 0 && (
        <form onSubmit={(e) => void submit(e)} aria-label="הרשמה" className="space-y-4" noValidate>
          <fieldset disabled={!f.open || busy} className="min-w-0 space-y-4">
            <div className="rounded-xl border border-line bg-card p-4">
              <label htmlFor={`${id}-who`} className="mb-1 block font-semibold">
                השם שלי
              </label>
              <select id={`${id}-who`} value={rosterId ?? ""} onChange={(e) => setRosterId(e.target.value ? Number(e.target.value) : null)} className={INPUT} aria-describedby={`${id}-who-hint`}>
                <option value="">בחירה מהרשימה</option>
                {f.roster.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_name}
                  </option>
                ))}
              </select>
              <p id={`${id}-who-hint`} className="mt-1 text-sm text-ink-soft">
                מי שמעביר/ה קבוצה לא מופיע/ה ברשימה: הם כבר בקבוצה שלהם.
              </p>
            </div>
            <fieldset className="min-w-0 rounded-xl border border-line bg-card p-4">
              <legend className="px-1 font-display text-lg font-semibold">הספר שלי</legend>
              <ul className="space-y-1">
                {f.groups.map((g) => (
                  <li key={g.id}>
                    <label className={`flex min-h-11 items-start gap-2 py-1 ${g.full ? "text-ink-soft" : "cursor-pointer"}`}>
                      <input
                        type="radio"
                        name={`${id}-book`}
                        checked={groupId === g.id}
                        disabled={g.full}
                        onChange={() => setGroupId(g.id)}
                        className="mt-1 size-5 shrink-0 accent-ink"
                      />
                      <GroupText g={g} />
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          </fieldset>
          {problem && (
            <p role="alert" className="text-sm text-bad">
              {problem}
            </p>
          )}
          {f.open && (
            <>
              <p className="text-sm">{NO_CHANGE}</p>
              <Button kind="primary" type="submit" busy={busy} busyLabel="שולח…">
                הרשמה
              </Button>
            </>
          )}
          <p className="text-sm text-ink-soft">בהרשמה נשמרים השם שבחרת והספר. מי נרשם/ה לאיזה ספר רואה רק הצוות.</p>
        </form>
      )}
    </>
  );
}

/** Where and when: every group meets in each of the week's sessions — information, not a choice. */
function Sessions({ f }: { f: KkForm }) {
  if (f.sessions.length === 0) return null;
  return (
    <div className="rounded-xl border border-line bg-card px-4 py-1">
      <Fold title="נפגשים בכל מפגשי מכריכה לכריכה" hint={f.sessions.length === 1 ? "מפגש אחד" : `${f.sessions.length} מפגשים`}>
        <ul aria-label="המפגשים" className="space-y-0.5 text-sm">
          {f.sessions.map((s) => {
            const w = whenOf(f.edition.start_date, s.day, s.start_min, s.end_min);
            return (
              <li key={`${s.day}:${s.start_min}:${s.end_min}`}>
                {w.day} <bdi dir="ltr">{w.time}</bdi>
                {f.edition.start_date && <span className="text-ink-soft"> · {w.date}</span>}
              </li>
            );
          })}
        </ul>
      </Fold>
    </div>
  );
}

function GroupText({ g }: { g: KkFormGroup }) {
  return (
    <span className="min-w-0">
      <span className="font-semibold break-words">{g.title}</span>
      {g.author && <span className="break-words"> — {g.author}</span>}
      {g.full && <span className="ms-2 inline-block rounded-full bg-line/60 px-2 text-xs font-semibold text-ink">מלאה</span>}
      <span className="block text-sm text-ink-soft break-words">
        {[g.place, g.leaders.length ? `מעבירים: ${g.leaders.map((x) => `${x.name} (${LEADER_KIND_LABEL[x.kind]})`).join(", ")}` : null].filter(Boolean).join(" · ")}
      </span>
    </span>
  );
}
