// «מכריכה לכריכה» (/kk, every member of the edition reads it), week-long since schema v15: a group reads one book
// across every kk session of the week, in one place of the campus, led by its leaders; a trainee signs up for one book.
// Top to bottom in the order of the work: where it stands (the leaders, the books, the window, the sign-ups, the
// orders), the sessions (from the grid: kkSessions ≡ app.kk_rows), the groups — each its book as the admin typed it
// (nothing is seeded; the leaders may come first), its place, its leaders, the sign-ups against the capacity (entered,
// never defaulted: a group without a book or a capacity is not offered through the link) and the books to order —
// and the sign-up: the window, the link, «עוד לא נרשמו». The edition's admins write the groups, the window and the
// placements; logistics (and admins) the book orders. Every write is a function (port.kk, CONTRACT «מכריכה לכריכה»),
// so the demo refuses what the database refuses. Not in Realtime: the screen reads again on entry, on return to the
// tab, and after every action.
import { useCallback, useEffect, useState } from "react";
import type { KkData } from "../../data/kk";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { kkSessions, kkStatus } from "../../domain/kk";
import { kkWindowState, kkWindowText } from "../../domain/kkWindow";
import { messageDate } from "../../domain/message";
import { fmtRange } from "../../domain/time";
import type { Week } from "../../domain/types";
import { Button, Fold, useFocusBack, useRunner } from "../settings/kit";
import { dayLabel } from "../public/parts";
import { EditionSelect, useToast } from "../speakers/parts";
import { archivedEdition } from "../stages/parts";
import { actorIn, useWeekStore } from "../weekStore";
import { GroupCard } from "./GroupCard";
import { GroupForm } from "./GroupForm";
import { type Act, byBook, groupsWord } from "./parts";
import { SignupPanel } from "./SignupPanel";

// «לוגיסטיקה ← ספרים» draws the same order form
export { BookOrder } from "./BookOrder";
export type { Act } from "./parts";

export function KkScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const editionId = week?.edition.id ?? null;
  const [data, setData] = useState<{ edition: number; kk: KkData } | null>(null);
  const [failed, setFailed] = useState(false);
  const { notify, clear, node: toast } = useToast();
  const { busy, run } = useRunner(notify, clear);

  const load = useCallback(async () => {
    if (editionId == null) return;
    try {
      const kk = await port.kk.load(editionId);
      setData({ edition: editionId, kk });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [port, editionId]);
  useEffect(() => void load(), [load]);
  // not in Realtime: back to the tab, read again
  useEffect(() => {
    const on = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [load]);

  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!week) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  const actor = actorIn(me, week.edition);
  const admin = actor.isAdmin;
  // the logistics screen's rule: logistics and admins — an archived edition the admins' alone
  const books = admin || (actor.role === "logistics" && !archivedEdition(week));
  const kk = data?.edition === editionId ? data.kk : null;

  /** One staff action: progress on its button, a toast, then the screen (and the week, for the window) read again. */
  const act: Act = async (key, fn, ok, onRefused) => {
    const done = await run(key, fn, ok, onRefused);
    await load();
    return done;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-display text-2xl font-extrabold">מכריכה לכריכה</h2>
        <EditionSelect />
      </div>
      {kk && <StatusStrip week={week} kk={kk} />}
      <Sessions week={week} />
      {failed && !kk && (
        <div role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-4 text-sm">
          <p className="mb-2">לא הצלחנו לטעון את הקבוצות.</p>
          <Button onClick={() => void load()}>לנסות שוב</Button>
        </div>
      )}
      {!kk && !failed && <p className="py-6 text-center text-ink-soft">טוען…</p>}
      {kk && <Groups week={week} kk={kk} admin={admin} books={books} busy={busy} act={act} port={port} />}
      <SignupPanel week={week} kk={kk} admin={admin} busy={busy} act={act} port={port} onSaved={store.reload} />
      {toast}
    </div>
  );
}

// ------------------------------------------------------------------ where it stands

/** The week's progress in the order of the work: leaders (a group «closed» with two), books, the window, the sign-ups, the orders. */
function StatusStrip({ week, kk }: { week: Week; kk: KkData }) {
  const s = kkStatus(kk, week.roster);
  const w = week.edition.settings?.kk_window ?? null;
  // before the first group there are no books to count
  const items: { key: string; text: string; ok?: boolean }[] = [
    { key: "leaders", text: s.groups === 0 ? "מעבירים: עוד אין קבוצות" : `מעבירים: ${groupsWord(s.groups)}, ${s.paired} עם שני מעבירים` },
    ...(s.groups === 0 ? [] : [{ key: "books", text: `ספרים: ${s.withBook} מתוך ${s.groups}` }]),
    { key: "window", text: kkWindowText(w).replace(/\.$/, ""), ok: kkWindowState(w) === "open" },
    { key: "signups", text: `נרשמו ${s.signedUp} מתוך ${s.eligible}` },
    ...(s.groups === 0 ? [] : [{ key: "orders", text: `ספרים: הוזמנו ${s.ordered} מתוך ${s.groups}` }]),
  ];
  return (
    <ul aria-label="איפה זה עומד" aria-live="polite" className="flex flex-wrap gap-1.5 text-sm">
      {items.map((i) => (
        <li key={i.key} data-kk-status={i.key} className={`rounded-full border px-2.5 py-1 ${i.ok ? "border-ok/30 bg-ok/10 text-ok" : "border-line bg-card"}`}>
          {i.text}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ the sessions

/** The grid's kk rows active each day: every group meets in each. Information — they are never stored. */
function Sessions({ week }: { week: Week }) {
  const sessions = kkSessions(week.rows, week.edition);
  return (
    <section aria-label="המפגשים" className="rounded-xl border border-line bg-card px-4 pt-3 pb-1.5 shadow-sm sm:px-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-lg font-semibold">המפגשים</h3>
        <span className="text-sm text-ink-soft">{sessions.length === 0 ? "אין ברשת משבצות «מכריכה לכריכה»." : `${sessions.length === 1 ? "מפגש אחד" : `${sessions.length} מפגשים`} · כל הקבוצות בכל מפגש`}</span>
      </div>
      {sessions.length > 0 && (
        <Fold title="הימים והשעות" size="sm">
          <ul aria-label="הימים והשעות" className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {sessions.map((x) => {
              const date = messageDate(week.edition.start_date, x.day, x.start_min);
              return (
                <li key={`${x.day}:${x.start_min}:${x.end_min}`}>
                  {dayLabel(x.day, x.start_min)} <bdi dir="ltr">{fmtRange(x.start_min, x.end_min)}</bdi>
                  {date && <span className="text-ink-soft"> · {date}</span>}
                </li>
              );
            })}
          </ul>
        </Fold>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ the groups

function Groups({ week, kk, admin, books, busy, act, port }: { week: Week; kk: KkData; admin: boolean; books: boolean; busy: string | null; act: Act; port: DataPort }) {
  const [adding, setAdding] = useState(false);
  // the form closed (saved or cancelled): «+ קבוצה» has the focus back
  const focusBack = useFocusBack();
  const doneAdding = () => {
    setAdding(false);
    focusBack.back();
  };
  const groups = byBook(kk.groups);
  return (
    <section aria-label="הקבוצות" className="space-y-3 rounded-xl border border-line bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="font-display text-lg font-semibold">הקבוצות</h3>
        <span className="text-sm text-ink-soft">{groups.length === 0 ? "עוד אין קבוצות" : groupsWord(groups.length)}</span>
        {admin && !adding && (
          <Button ref={focusBack.ref()} className="ms-auto" onClick={() => setAdding(true)}>
            + קבוצה
          </Button>
        )}
      </div>
      {admin && adding && (
        <GroupForm
          week={week}
          kk={kk}
          title="קבוצה חדשה"
          busy={busy === "add"}
          onCancel={doneAdding}
          onSave={async (fields, onRefused) => {
            const ok = await act("add", () => port.kk.addGroup(week.edition.id, fields), "הקבוצה נוספה", onRefused);
            if (ok) doneAdding();
          }}
        />
      )}
      {groups.length === 0 && !adding && admin && <p className="text-sm text-ink-soft">מתחילים מהמעבירים: את הספר, המרחב והתפוסה אפשר לכתוב אחר כך.</p>}
      {groups.map((g) => (
        <GroupCard key={g.id} g={g} groups={groups} week={week} kk={kk} admin={admin} books={books} busy={busy} act={act} port={port} />
      ))}
    </section>
  );
}
