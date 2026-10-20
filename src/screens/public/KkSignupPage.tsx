// The sign-up for מכריכה לכריכה (/k#token), one link for the whole class: the
// trainee picks their name from the year's list (names only), then a group in
// each track they want, and sends. The answer is the same whatever happened, so
// the page never tells who already signed up — and so it is worded as a request,
// not a result: «הבקשה נשלחה», what was sent, and when a sign-up is recorded (not
// yet signed up for that slot, a place left) — to check or change, the team. An
// existing sign-up is never changed through the link (only the staff move one),
// and the form says so before sending. Outside the window the groups are shown,
// and nothing is sent.
import { type FormEvent, useId, useState } from "react";
import { CommandError } from "../../data/commands";
import type { KkForm, KkFormGroup, KkFormTrack, PublicPort } from "../../data/publicPort";
import { kkWindowState, kkWindowText } from "../../domain/kkWindow";
import { Button, INPUT } from "../settings/kit";
import { LinkInvalid, LoadFailed, Loading, useLinkLoad, whenOf } from "./parts";

export const LEADER_KIND_LABEL: Record<KkFormGroup["leaders"][number]["kind"], string> = { staff: "מהצוות", trainee: "חניך/ה", ein_prat: "מעין פרת" };

/** The window in words. The server's `open` wins over this device's clock: not open there is before or after it. */
function formWindowText(f: KkForm): string {
  if (f.open) return kkWindowText(f.window, Date.parse(f.window.opens_at!));
  return kkWindowText(f.window, kkWindowState(f.window) === "open" ? Date.parse(f.window.closes_at!) : Date.now());
}

type Sent = { name: string; picks: { day: string; time: string; group: string }[] };

/** The same words for everyone, whatever the server did — no oracle, and no promise that it was recorded. */
export const RECORDED_WHEN = "ההרשמה נקלטת רק אם עוד לא נרשמת למשבצת הזו ויש מקום בקבוצה. כדי לבדוק או לשנות — פונים לצוות.";
export const NO_CHANGE = "מי שכבר נרשם/ה לא יכול/ה לשנות את ההרשמה כאן.";

export function KkSignupPage({ port, token }: { port: PublicPort; token: string }) {
  const { load, reload } = useLinkLoad(() => port.kkForm(token));
  const id = useId();
  const [rosterId, setRosterId] = useState<number | null>(null);
  const [picks, setPicks] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  if (load.state === "loading") return <Loading />;
  if (load.state === "invalid") return <LinkInvalid scope="kk_signup" />;
  if (load.state === "error") return <LoadFailed onRetry={() => void reload().catch(() => {})} />;
  const f = load.data;
  const trackName = (t: KkFormTrack) => {
    const w = whenOf(f.edition.start_date, t.day, t.start_min, t.end_min);
    return { day: w.day, time: w.time, date: w.date };
  };
  const chosen = f.tracks.flatMap((t) => (picks[t.id] != null && t.groups.some((g) => g.id === picks[t.id] && !g.full) ? [{ t, g: t.groups.find((g) => g.id === picks[t.id])! }] : []));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (rosterId == null) return setProblem("צריך לבחור את השם שלך מהרשימה.");
    if (chosen.length === 0) return setProblem("צריך לבחור קבוצה אחת לפחות.");
    setBusy(true);
    try {
      for (const { g } of chosen) await port.kkSignup(token, rosterId, g.id);
      setSent({
        name: f.roster.find((r) => r.id === rosterId)?.full_name ?? "",
        picks: chosen.map(({ t, g }) => ({ day: trackName(t).day, time: trackName(t).time, group: g.title })),
      });
      setPicks({});
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
          <p className="text-sm">
            <span className="text-ink-soft">מה ששלחת: </span>
            {sent.name}:{" "}
            {sent.picks.map((p, i) => (
              <span key={i}>
                {i > 0 && " · "}
                {p.day} <bdi dir="ltr">{p.time}</bdi> — {p.group}
              </span>
            ))}
          </p>
          <p className="text-sm">{RECORDED_WHEN}</p>
          <Button onClick={() => setSent(null)}>הרשמה של שם נוסף</Button>
        </section>
      )}

      {!sent && f.tracks.length === 0 && <p className="rounded-xl border border-line bg-card p-4 text-ink-soft">עוד אין קבוצות להרשמה. כשהצוות יפתח קבוצות, הן יופיעו כאן.</p>}

      {!sent && f.tracks.length > 0 && (
        <form onSubmit={(e) => void submit(e)} aria-label="הרשמה" className="space-y-4" noValidate>
          <fieldset disabled={!f.open || busy} className="min-w-0 space-y-4">
            <div className="rounded-xl border border-line bg-card p-4">
              <label htmlFor={`${id}-who`} className="mb-1 block font-semibold">
                השם שלי
              </label>
              <select id={`${id}-who`} value={rosterId ?? ""} onChange={(e) => setRosterId(e.target.value ? Number(e.target.value) : null)} className={INPUT}>
                <option value="">בחירה מהרשימה</option>
                {f.roster.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_name}
                  </option>
                ))}
              </select>
            </div>
            {f.tracks.map((t) => {
              const name = trackName(t);
              return (
                <fieldset key={t.id} className="min-w-0 rounded-xl border border-line bg-card p-4">
                  <legend className="px-1 font-display text-lg font-semibold">
                    {name.day} <bdi dir="ltr">{name.time}</bdi>
                  </legend>
                  <p className="mb-2 text-sm text-ink-soft">{name.date}</p>
                  <ul className="space-y-1">
                    <li>
                      <label className="flex min-h-11 cursor-pointer items-center gap-2">
                        <input type="radio" name={`${id}-t${t.id}`} checked={picks[t.id] == null} onChange={() => setPicks(({ [t.id]: _, ...rest }) => rest)} className="size-5 accent-ink" />
                        בלי, בפעם הזו
                      </label>
                    </li>
                    {t.groups.map((g) => (
                      <li key={g.id}>
                        <label className={`flex min-h-11 items-start gap-2 py-1 ${g.full ? "text-ink-soft" : "cursor-pointer"}`}>
                          <input
                            type="radio"
                            name={`${id}-t${t.id}`}
                            checked={picks[t.id] === g.id}
                            disabled={g.full}
                            onChange={() => setPicks((cur) => ({ ...cur, [t.id]: g.id }))}
                            className="mt-1 size-5 shrink-0 accent-ink"
                          />
                          <GroupText g={g} />
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              );
            })}
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
          <p className="text-sm text-ink-soft">בהרשמה נשמרים השם שבחרת והקבוצה. מי נרשם/ה לאיזו קבוצה רואה רק הצוות.</p>
        </form>
      )}
    </>
  );
}

function GroupText({ g }: { g: KkFormGroup }) {
  return (
    <span className="min-w-0">
      <span className="font-semibold break-words">{g.title}</span>
      {g.author && <span className="break-words"> — {g.author}</span>}
      {g.full && <span className="ms-2 inline-block rounded-full bg-line/60 px-2 text-xs font-semibold text-ink">מלאה</span>}
      <span className="block text-sm text-ink-soft break-words">
        {[g.room, g.leaders.length ? `מובילים: ${g.leaders.map((x) => `${x.name} (${LEADER_KIND_LABEL[x.kind]})`).join(", ")}` : null].filter(Boolean).join(" · ")}
      </span>
    </span>
  );
}
