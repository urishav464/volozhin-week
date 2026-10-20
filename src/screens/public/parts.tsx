// What the three public pages share: the frame (the site's header, a reading
// column, the privacy link — no team navigation, nobody signed in), loading
// through a link's token with the one refusal `link_invalid` shown as a page of
// its own, and the day/time/date words. Phone first: one column, controls at
// least 44px tall.
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { CommandError } from "../../data/commands";
import { publicDemo } from "../../data/publicEntry";
import { messageDate } from "../../domain/message";
import { type Day, DAY_NAMES, fmtRange } from "../../domain/time";
import { errorMessage } from "../../errors";
import { Button } from "../settings/kit";
import { Card, Shell } from "../Shell";

export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <Shell demo={publicDemo}>
      <div className="mx-auto max-w-2xl space-y-4 pb-16 print:max-w-none print:pb-0">
        {children}
        <footer className="space-y-1 border-t border-line pt-3 text-center text-sm text-ink-soft print:hidden">
          {/* a plain link: the host serves the static page */}
          <a href="/privacy.html" className="underline hover:text-ink">
            מדיניות פרטיות
          </a>
          {publicDemo && (
            <p>
              <Link to="/settings/links" className="underline hover:text-ink">
                חזרה לקישורים של ההדגמה
              </Link>
            </p>
          )}
        </footer>
      </div>
    </Shell>
  );
}

export type LinkLoad<T> =
  | { state: "loading" }
  | { state: "ok"; data: T }
  | { state: "invalid" }
  | { state: "error" };

/**
 * One read through the link. `link_invalid` — whatever the reason: a wrong, expired, revoked or replaced link — is a
 * page of its own; anything else (the network) may be tried again with the token still in memory. A reload keeps what
 * is on screen until the answer comes.
 */
export function useLinkLoad<T>(read: () => Promise<T>) {
  const [load, setLoad] = useState<LinkLoad<T>>({ state: "loading" });
  const readRef = useRef(read);
  readRef.current = read;
  const reload = useCallback(async () => {
    try {
      const data = await readRef.current();
      setLoad({ state: "ok", data });
    } catch (e) {
      if (e instanceof CommandError && e.code === "link_invalid") setLoad({ state: "invalid" });
      else setLoad((cur) => (cur.state === "ok" ? cur : { state: "error" }));
      throw e;
    }
  }, []);
  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);
  const set = useCallback((fn: (d: T) => T) => setLoad((cur) => (cur.state === "ok" ? { state: "ok", data: fn(cur.data) } : cur)), []);
  return { load, reload, set, invalid: () => setLoad({ state: "invalid" }) };
}

/** The one refusal: no reason given, the same for every bad link. */
export function LinkInvalid() {
  return (
    <Card>
      <h2 className="mb-2 font-display text-lg font-semibold">הקישור לא בתוקף</h2>
      <p className="text-ink-soft">{errorMessage("link_invalid")}</p>
    </Card>
  );
}

/** No token in the address: a link cut short, or a page reloaded after the token left the address bar. */
export function LinkMissing() {
  return (
    <Card>
      <h2 className="mb-2 font-display text-lg font-semibold">הקישור לא שלם</h2>
      <div className="space-y-2 text-ink-soft">
        <p>חסר בכתובת הקוד שאחרי הסימן #. פותחים שוב את הקישור מההודעה שקיבלת.</p>
        <p>הקוד יוצא משורת הכתובת ברגע שהדף נפתח, כדי שלא יישאר בהיסטוריה של הדפדפן. לכן רענון של הדף לא מספיק: חוזרים להודעה ופותחים ממנה.</p>
      </div>
    </Card>
  );
}

export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-bad/30 bg-bad/5 p-4 text-sm">
      <p className="mb-2">לא הצלחנו לטעון. אולי אין כרגע חיבור לאינטרנט.</p>
      <Button onClick={onRetry}>לנסות שוב</Button>
    </div>
  );
}

export function Loading() {
  return <p className="mt-10 text-center text-ink-soft">טוען…</p>;
}

/** «ראשון», or a night's «ליל ראשון–שני» — as the team's tables write it (src/exports/tracking.ts). */
export function dayLabel(day: Day, startMin: number): string {
  return startMin >= 1440 && day < 4 ? `ליל ${DAY_NAMES[day]}–${DAY_NAMES[(day + 1) as Day]}` : DAY_NAMES[day];
}

/** The day, the time and the date (the calendar's: a night lesson's is the next morning's), or «התאריך TBD». */
export function whenOf(startDate: string | null, day: Day, start: number, end: number): { day: string; time: string; date: string } {
  return { day: dayLabel(day, start), time: fmtRange(start, end), date: messageDate(startDate, day, start) ?? "התאריך TBD" };
}
