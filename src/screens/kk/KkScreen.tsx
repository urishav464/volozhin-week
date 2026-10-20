// «מכריכה לכריכה» (/kk, every member of the edition reads it): for each
// occurrence of a kk row in the grid (a day and its row), the groups — the book
// as the admin typed it (nothing is seeded), its room, its capacity (entered,
// never defaulted: a group without one is not offered through the link), open
// or not, and its leaders — the sign-ups against the capacity, «עוד לא נרשמו»
// from the roster, and the books to order. The edition's admins write the
// groups, the window and the placements; logistics (and admins) the book
// orders. Every write is a function (port.kk, CONTRACT «מכריכה לכריכה»), so
// the demo refuses what the database refuses. Not in Realtime: the screen reads
// again on entry, on return to the tab, and after every action.
import { type FormEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router";
import type { KkData, KkGroup, KkGroupFields, LeaderInput, LeaderKind } from "../../data/kk";
import { KK_LIMITS, LEADER_KINDS } from "../../data/kk";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { israelInstant, israelLocal, israelMoment } from "../../domain/israelTime";
import { kkWindowState, kkWindowText } from "../../domain/kkWindow";
import { messageDate } from "../../domain/message";
import { DAYS, type Day, fmtRange } from "../../domain/time";
import type { Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { rowActive } from "../../grid/layout";
import { Badge, Button, Confirm, Field, INPUT, useRunner } from "../settings/kit";
import { dayLabel } from "../public/parts";
import { EditionSelect, useToast } from "../speakers/parts";
import { actorIn, useWeekStore } from "../weekStore";

const LEADER_KIND_LABEL: Record<LeaderKind, string> = { trainee: "חניך/ה", staff: "מהצוות", ein_prat: "מעין פרת" };

/**
 * One kk occurrence of the grid: a day and the kk row starting at `start_min` (its track, once a group is on it) —
 * or a track whose row is no longer active that day (`outside`: the first or last day's hours moved after groups were
 * made), kept on the screen so its groups and sign-ups can be cleared; the link neither offers nor takes it.
 */
interface Occurrence {
  day: Day;
  start_min: number;
  end_min: number;
  trackId: number | null;
  outside?: boolean;
}

export function occurrencesOf(week: Week, data: KkData): Occurrence[] {
  const out: Occurrence[] = [];
  for (const day of DAYS) {
    for (const r of week.rows.filter((x) => x.kind === "kk" && rowActive(x, day, week.edition)).sort((a, b) => a.start_min - b.start_min)) {
      if (out.some((o) => o.day === day && o.start_min === r.start_min)) continue;
      out.push({ day, start_min: r.start_min, end_min: r.end_min, trackId: data.tracks.find((t) => t.day === day && t.start_min === r.start_min)?.id ?? null });
    }
  }
  for (const t of data.tracks) {
    if (!out.some((o) => o.trackId === t.id)) out.push({ day: t.day, start_min: t.start_min, end_min: t.end_min, trackId: t.id, outside: true });
  }
  return out.sort((a, b) => a.day - b.day || a.start_min - b.start_min);
}

/** The trainees who lead a group in the track: they need no group there, so they are not «עוד לא נרשמו». */
export function leadersIn(data: KkData, trackId: number | null): Set<number> {
  const groups = new Set(data.groups.filter((g) => g.track_id === trackId).map((g) => g.id));
  return new Set(data.leaders.filter((x) => groups.has(x.group_id) && x.roster_id != null).map((x) => x.roster_id!));
}

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
  const books = admin || actor.role === "logistics";
  const kk = data?.edition === editionId ? data.kk : null;

  /** One staff action: progress on its button, a toast, then the screen (and the week, for the window) read again. */
  const act = async (key: string, fn: () => Promise<unknown>, ok: string | null, onRefused?: (code: string | null) => boolean) => {
    const done = await run(key, fn, ok, onRefused);
    await load();
    return done;
  };

  const occ = kk ? occurrencesOf(week, kk) : [];
  const signed = kk?.signups.length ?? 0;
  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-display text-2xl font-extrabold">מכריכה לכריכה</h2>
        <EditionSelect />
      </div>
      <p className="text-sm text-ink-soft">
        קבוצות קריאה במשבצות «מכריכה לכריכה» של הרשת. הספרים, המובילים והתפוסה הם מה שהמדריך/ה כותב/ת — שום דבר לא ממולא מראש. קבוצה בלי תפוסה לא מוצעת בקישור ההרשמה.
        {admin && (
          <>
            {" "}
            את קישור ההרשמה מנפיקים ב
            <Link to="/settings/links" className="font-semibold underline">
              הגדרות ← «קישורים»
            </Link>
            .
          </>
        )}
      </p>
      <WindowPanel week={week} admin={admin} busy={busy} act={act} port={port} onSaved={store.reload} />
      {failed && !kk && (
        <div role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-4 text-sm">
          <p className="mb-2">לא הצלחנו לטעון את הקבוצות.</p>
          <Button onClick={() => void load()}>לנסות שוב</Button>
        </div>
      )}
      {!kk && !failed && <p className="py-6 text-center text-ink-soft">טוען…</p>}
      {kk && (
        <>
          <p className="text-sm text-ink-soft" aria-live="polite">
            {kk.groups.length === 0 ? "עוד אין קבוצות." : `${kk.groups.length === 1 ? "קבוצה אחת" : `${kk.groups.length} קבוצות`} · ${signed === 1 ? "הרשמה אחת" : `${signed} הרשמות`}`}
          </p>
          {occ.length === 0 && <p className="rounded-xl border border-line bg-card p-4 text-ink-soft">אין ברשת משבצות «מכריכה לכריכה».</p>}
          {occ.map((o) => (
            <OccurrenceSection key={`${o.day}:${o.start_min}`} o={o} week={week} kk={kk} admin={admin} books={books} busy={busy} act={act} port={port} />
          ))}
        </>
      )}
      {toast}
    </div>
  );
}

export type Act = (key: string, fn: () => Promise<unknown>, ok: string | null, onRefused?: (code: string | null) => boolean) => Promise<boolean>;

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
  const state = kkWindowState(w);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!opens.trim() || !closes.trim()) return setProblem("צריך למלא תאריך ושעה גם לפתיחה וגם לסגירה.");
    const o = israelInstant(opens);
    const c = israelInstant(closes);
    if (!o || !c) return setProblem("השעה הזו לא קיימת בשעון ישראל (הלילה שבו עוברים לשעון קיץ). בוחרים שעה אחרת.");
    if (Date.parse(o) >= Date.parse(c)) return setProblem("הסגירה צריכה להיות אחרי הפתיחה.");
    const ok = await act("window", () => port.kk.setWindow(week.edition.id, o, c), "חלון ההרשמה נשמר");
    if (ok) await onSaved();
  };
  const close = async () => {
    setProblem(null);
    const ok = await act("window-none", () => port.kk.setWindow(week.edition.id, null, null), "ההרשמה סגורה: אין חלון");
    if (ok) await onSaved();
  };

  return (
    <section aria-label="חלון ההרשמה" className="rounded-xl border border-line bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-lg font-semibold">חלון ההרשמה</h3>
        <Badge tone={state === "open" ? "ok" : "muted"}>{state === "open" ? "פתוחה עכשיו" : "סגורה עכשיו"}</Badge>
      </div>
      <p className="text-sm">{kkWindowText(w)}</p>
      {admin ? (
        <form onSubmit={(e) => void save(e)} aria-label="חלון ההרשמה" className="mt-3 space-y-3" noValidate>
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
          </div>
        </form>
      ) : (
        <p className="mt-1 text-xs text-ink-soft">את החלון קובע/ת המדריך/ה.</p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ an occurrence: its groups, and who has not signed up

function OccurrenceSection({ o, week, kk, admin, books, busy, act, port }: { o: Occurrence; week: Week; kk: KkData; admin: boolean; books: boolean; busy: string | null; act: Act; port: DataPort }) {
  const [adding, setAdding] = useState(false);
  // the plain string names the region for a screen reader (read in logical order); what is drawn wraps the range in <bdi>
  const label = `${dayLabel(o.day, o.start_min)} ${fmtRange(o.start_min, o.end_min)}`;
  const when = (
    <>
      {dayLabel(o.day, o.start_min)} <bdi dir="ltr">{fmtRange(o.start_min, o.end_min)}</bdi>
    </>
  );
  const date = messageDate(week.edition.start_date, o.day, o.start_min);
  const groups = kk.groups.filter((g) => g.track_id === o.trackId).sort((a, b) => a.title.localeCompare(b.title, "he") || a.id - b.id);
  const signups = kk.signups.filter((s) => s.track_id === o.trackId);
  const leading = leadersIn(kk, o.trackId);
  const leaders = week.roster.filter((r) => leading.has(r.id) && !signups.some((s) => s.roster_id === r.id));
  const missing = o.trackId == null ? [] : week.roster.filter((r) => !leading.has(r.id) && !signups.some((s) => s.roster_id === r.id));
  return (
    <section aria-label={o.outside ? `${label} · מחוץ לרשת` : label} className="space-y-3 rounded-xl border border-line bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-lg font-semibold">{when}</h3>
        {date && <span className="text-sm text-ink-soft">{date}</span>}
        <span className="text-sm text-ink-soft">{groups.length === 0 ? "אין קבוצות" : groups.length === 1 ? "קבוצה אחת" : `${groups.length} קבוצות`}</span>
        {o.outside && <Badge tone="bad">מחוץ לרשת</Badge>}
      </div>
      {o.outside && (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm">
          המשבצת הזו כבר לא ברשת של היום הזה (שעות היום הראשון או האחרון השתנו). הקבוצות שלה לא מוצעות בקישור ההרשמה. מעבירים או מסירים את הנרשמים, ומוחקים את הקבוצות — או
          מחזירים את השעות בהגדרות.
        </p>
      )}
      {groups.map((g) => (
        <GroupCard key={g.id} g={g} groups={groups} week={week} kk={kk} admin={admin} books={books} busy={busy} act={act} port={port} />
      ))}
      {admin &&
        !o.outside &&
        (adding ? (
          <GroupForm
            week={week}
            title={`קבוצה חדשה · ${label}`}
            heading={<>קבוצה חדשה · {when}</>}
            busy={busy === `add-${o.day}-${o.start_min}`}
            onCancel={() => setAdding(false)}
            onSave={async (fields, onRefused) => {
              const ok = await act(`add-${o.day}-${o.start_min}`, () => port.kk.addGroup(week.edition.id, o.day, o.start_min, fields), "הקבוצה נוספה", onRefused);
              if (ok) setAdding(false);
            }}
          />
        ) : (
          <Button onClick={() => setAdding(true)} aria-label={`קבוצה חדשה: ${label}`}>
            + קבוצה
          </Button>
        ))}
      {o.trackId != null && groups.length > 0 && (
        <NotYet trackLabel={label} missing={missing} leaders={leaders} groups={groups} admin={admin && !o.outside} busy={busy} act={act} port={port} />
      )}
    </section>
  );
}

/**
 * «עוד לא נרשמו»: the roster's names with no sign-up in this track and no group of it to lead — and, for an admin,
 * placing one. The trainees who lead a group here are named apart, so the count is who still needs a group.
 */
function NotYet({
  trackLabel,
  missing,
  leaders,
  groups,
  admin,
  busy,
  act,
  port,
}: {
  trackLabel: string;
  missing: Week["roster"];
  leaders: Week["roster"];
  groups: KkGroup[];
  admin: boolean;
  busy: string | null;
  act: Act;
  port: DataPort;
}) {
  const id = useId();
  const [who, setWho] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const place = async (e: FormEvent) => {
    e.preventDefault();
    if (who == null || to == null) return;
    const ok = await act(`place-${id}`, () => port.kk.place(to, who), "שובץ/ה");
    if (ok) setWho(null);
  };
  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="min-h-11 cursor-pointer content-center font-semibold">
        עוד לא נרשמו ({missing.length})<span className="sr-only"> · {trackLabel}</span>
      </summary>
      {leaders.length > 0 && <p className="mt-1 text-sm text-ink-soft">מובילים קבוצה במשבצת הזו: {leaders.map((r) => r.full_name).join(" · ")}</p>}
      {missing.length === 0 ? (
        <p className="text-sm text-ink-soft">כל החניכים ברשימה נרשמו.</p>
      ) : (
        <ul aria-label={`עוד לא נרשמו · ${trackLabel}`} className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {missing.map((r) => (
            <li key={r.id}>{r.full_name}</li>
          ))}
        </ul>
      )}
      {admin && missing.length > 0 && (
        <form onSubmit={(e) => void place(e)} aria-label={`שיבוץ · ${trackLabel}`} className="mt-3 flex flex-wrap items-end gap-2">
          <Field id={`${id}-w`} label="חניך/ה">
            <select id={`${id}-w`} value={who ?? ""} onChange={(e) => setWho(e.target.value ? Number(e.target.value) : null)} className={INPUT}>
              <option value="">בחירה</option>
              {missing.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-g`} label="לקבוצה">
            <select id={`${id}-g`} value={to ?? ""} onChange={(e) => setTo(e.target.value ? Number(e.target.value) : null)} className={INPUT}>
              <option value="">בחירה</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </Field>
          <Button kind="primary" type="submit" disabled={who == null || to == null} busy={busy === `place-${id}`}>
            שיבוץ
          </Button>
        </form>
      )}
    </details>
  );
}

// ------------------------------------------------------------------ a group

function GroupCard({ g, groups, week, kk, admin, books, busy, act, port }: { g: KkGroup; groups: KkGroup[]; week: Week; kk: KkData; admin: boolean; books: boolean; busy: string | null; act: Act; port: DataPort }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const names = useMemo(() => new Map(week.roster.map((r) => [r.id, r.full_name])), [week.roster]);
  const leaders = kk.leaders.filter((x) => x.group_id === g.id);
  const signups = kk.signups.filter((s) => s.group_id === g.id).sort((a, b) => (names.get(a.roster_id) ?? "").localeCompare(names.get(b.roster_id) ?? "", "he"));
  const room = g.room_id == null ? null : (week.rooms.find((r) => r.id === g.room_id)?.name ?? null);
  const full = g.capacity != null && signups.length >= g.capacity;

  if (editing) {
    return (
      <GroupForm
        week={week}
        title={`עריכה · ${g.title}`}
        initial={{ g, leaders }}
        busy={busy === `edit-${g.id}`}
        onCancel={() => setEditing(false)}
        onSave={async (fields, onRefused) => {
          const ok = await act(`edit-${g.id}`, () => port.kk.updateGroup(g.id, fields), "הקבוצה נשמרה", onRefused);
          if (ok) setEditing(false);
        }}
      />
    );
  }
  return (
    <article aria-label={g.title} data-kk-group={g.id} className="space-y-2 rounded-lg border border-line bg-paper/40 p-3">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <div className="min-w-0 flex-1 basis-48">
          <h4 className="font-semibold break-words">
            {g.title}
            {g.author && <span className="font-normal"> — {g.author}</span>}
          </h4>
          <p className="text-sm text-ink-soft break-words">
            {[room ?? "בלי חדר", leaders.length ? `מובילים: ${leaders.map((x) => `${(x.roster_id != null ? names.get(x.roster_id) : x.label) ?? "—"} (${LEADER_KIND_LABEL[x.kind]})`).join(", ")}` : "בלי מובילים"].join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {!g.open && <Badge tone="muted">סגורה להרשמה</Badge>}
          {g.capacity == null && <Badge tone="accent">אין תפוסה: לא מוצעת בקישור</Badge>}
          {full && <Badge tone="neutral">מלאה</Badge>}
        </div>
      </div>
      <p className="text-sm font-semibold" data-kk-count>
        {g.capacity != null ? `נרשמו ${signups.length} מתוך ${g.capacity}` : signups.length === 1 ? "נרשם/ה אחד/ת" : `נרשמו ${signups.length}`}
      </p>
      {signups.length > 0 && (
        <ul aria-label={`הנרשמים · ${g.title}`} className="divide-y divide-line rounded-md border border-line bg-card">
          {signups.map((s) => (
            <SignupItem key={s.id} name={names.get(s.roster_id) ?? "חניך/ה שנמחק/ה"} via={s.via} groupId={g.id} groups={groups} admin={admin} busy={busy} onMove={(to) => act(`move-${s.id}`, () => port.kk.place(to, s.roster_id), "ההרשמה הועברה")} onRemove={() => act(`remove-${s.id}`, () => port.kk.unplace(s.track_id, s.roster_id), "ההרשמה הוסרה")} moveKey={`move-${s.id}`} removeKey={`remove-${s.id}`} />
          ))}
        </ul>
      )}
      <BookOrder g={g} kk={kk} signed={signups.length} leaders={leaders.length} editable={books} busy={busy} act={act} port={port} />
      {admin &&
        (deleting ? (
          <Confirm
            text={
              <>
                למחוק את הקבוצה <b>{g.title}</b>?{signups.length > 0 && " יש בה נרשמים: קודם מעבירים אותם או מסירים."}
              </>
            }
            confirm="מחיקה"
            busy={busy === `delete-${g.id}`}
            onConfirm={() => void act(`delete-${g.id}`, () => port.kk.deleteGroup(g.id), "הקבוצה נמחקה").then(() => setDeleting(false))}
            onCancel={() => setDeleting(false)}
          />
        ) : (
          <div className="flex flex-wrap gap-1">
            <Button onClick={() => setEditing(true)} aria-label={`עריכה: ${g.title}`}>
              עריכה
            </Button>
            <Button kind="danger" onClick={() => setDeleting(true)} aria-label={`מחיקה: ${g.title}`}>
              מחיקה
            </Button>
          </div>
        ))}
    </article>
  );
}

function SignupItem({
  name,
  via,
  groupId,
  groups,
  admin,
  busy,
  onMove,
  onRemove,
  moveKey,
  removeKey,
}: {
  name: string;
  via: "link" | "staff";
  groupId: number;
  groups: KkGroup[];
  admin: boolean;
  busy: string | null;
  onMove: (to: number) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
  moveKey: string;
  removeKey: string;
}) {
  const id = useId();
  const [removing, setRemoving] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1">
      <span className="min-w-0 flex-1 basis-32 break-words">
        {name} <span className="text-xs text-ink-soft">{via === "link" ? "· בקישור" : "· שובץ/ה בידי הצוות"}</span>
      </span>
      {admin &&
        (removing ? (
          <span className="flex flex-wrap items-center gap-1 text-sm">
            להסיר את {name}?
            <Button kind="dangerSolid" busy={busy === removeKey} onClick={() => void onRemove().then(() => setRemoving(false))}>
              הסרה
            </Button>
            <Button onClick={() => setRemoving(false)} autoFocus>
              ביטול
            </Button>
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-1">
            {groups.length > 1 && (
              <>
                <label htmlFor={`${id}-m`} className="sr-only">
                  העברה של {name} לקבוצה אחרת
                </label>
                <select
                  id={`${id}-m`}
                  value={groupId}
                  disabled={busy === moveKey}
                  onChange={(e) => void onMove(Number(e.target.value))}
                  className="min-h-11 max-w-48 rounded-lg border border-line bg-card px-2 text-sm"
                >
                  {groups.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.id === groupId ? `בקבוצה: ${x.title}` : `העברה ל: ${x.title}`}
                    </option>
                  ))}
                </select>
              </>
            )}
            <Button kind="danger" onClick={() => setRemoving(true)} aria-label={`הסרה: ${name}`}>
              הסרה
            </Button>
          </span>
        ))}
    </li>
  );
}

/** Copies to order for the group, and whether they were ordered — logistics' and the admins'. Nothing is filled in for them. */
export function BookOrder({ g, kk, signed, leaders, editable, busy, act, port }: { g: KkGroup; kk: KkData; signed: number; leaders: number; editable: boolean; busy: string | null; act: Act; port: DataPort }) {
  const id = useId();
  const order = kk.orders.find((o) => o.group_id === g.id) ?? null;
  const [copies, setCopies] = useState(order ? String(order.copies) : "");
  const [ordered, setOrdered] = useState(order?.ordered_at != null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setCopies(order ? String(order.copies) : "");
    setOrdered(order?.ordered_at != null);
  }, [order?.copies, order?.ordered_at]);
  const hint = `נרשמו ${signed} · מובילים ${leaders}`;
  if (!editable) {
    return (
      <p className="text-sm text-ink-soft">
        ספרים: {order ? `${order.copies} עותקים${order.ordered_at ? ` · הוזמנו ב-${israelMoment(order.ordered_at)}` : " · עוד לא הוזמנו"}` : "עוד לא נקבע כמה להזמין"}
      </p>
    );
  }
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const t = copies.trim();
    const n = t === "" ? null : Number(t);
    if (n != null && (!Number.isInteger(n) || n < 0 || n > KK_LIMITS.copies)) return setProblem(`מספר עותקים שלם, בין 0 ל-${KK_LIMITS.copies}.`);
    if (n == null && ordered) return setProblem("כדי לסמן «הוזמן» צריך לכתוב כמה עותקים.");
    await act(`books-${g.id}`, () => port.kk.setBookOrder(g.id, n, ordered), n == null ? "שורת הספרים נמחקה" : "הזמנת הספרים נשמרה");
  };
  const dirty = (order ? String(order.copies) : "") !== copies.trim() || (order?.ordered_at != null) !== ordered;
  return (
    <form onSubmit={(e) => void save(e)} aria-label={`ספרים · ${g.title}`} className="flex flex-wrap items-end gap-2" noValidate>
      <Field id={`${id}-n`} label="עותקים להזמנה" hint={hint}>
        <input id={`${id}-n`} type="number" inputMode="numeric" min={0} max={KK_LIMITS.copies} value={copies} onChange={(e) => setCopies(e.target.value)} className={`${INPUT} w-28`} aria-describedby={`${id}-n-hint`} />
      </Field>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={ordered} onChange={(e) => setOrdered(e.target.checked)} className="size-5 accent-ink" />
        הוזמן
        {order?.ordered_at && <span className="text-xs text-ink-soft">({israelMoment(order.ordered_at)})</span>}
      </label>
      <Button type="submit" disabled={!dirty} busy={busy === `books-${g.id}`} busyLabel="שומר…">
        שמירה
      </Button>
      {problem && (
        <p role="alert" className="w-full text-sm text-bad">
          {problem}
        </p>
      )}
    </form>
  );
}

// ------------------------------------------------------------------ the group's form

type LeaderRow = LeaderInput;

function GroupForm({
  week,
  title,
  heading,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  week: Week;
  /** The form's name (a plain string, for its label); `heading`, when given, is what is drawn — with a time range isolated. */
  title: string;
  heading?: ReactNode;
  initial?: { g: KkGroup; leaders: KkData["leaders"] };
  busy: boolean;
  onSave: (fields: KkGroupFields, onRefused: (code: string | null) => boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial?.g.title ?? "");
  const [author, setAuthor] = useState(initial?.g.author ?? "");
  const [roomId, setRoomId] = useState<number | null>(initial?.g.room_id ?? null);
  const [capacity, setCapacity] = useState(initial?.g.capacity != null ? String(initial.g.capacity) : "");
  const [open, setOpen] = useState(initial?.g.open ?? true);
  const [leaders, setLeaders] = useState<LeaderRow[]>(
    () => initial?.leaders.map((x): LeaderRow => (x.kind === "trainee" ? { kind: "trainee", roster_id: x.roster_id! } : { kind: x.kind, label: x.label ?? "" })) ?? [],
  );
  const [kind, setKind] = useState<LeaderKind>("trainee");
  const [leaderRoster, setLeaderRoster] = useState<number | null>(null);
  const [leaderLabel, setLeaderLabel] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const roster = useMemo(() => [...week.roster].sort((a, b) => a.full_name.localeCompare(b.full_name, "he") || a.id - b.id), [week.roster]);
  const nameOf = (l: LeaderRow) => (l.kind === "trainee" ? (week.roster.find((r) => r.id === l.roster_id)?.full_name ?? "חניך/ה שנמחק/ה") : l.label);

  /** The leader picked or typed below — the list with them added (a repeat kept once), or why not. */
  const withPending = (): { list: LeaderRow[]; problem?: string } => {
    const pending: LeaderRow | null =
      kind === "trainee"
        ? leaderRoster == null
          ? null
          : { kind: "trainee", roster_id: leaderRoster }
        : leaderLabel.replace(/\s+/g, " ").trim()
          ? { kind, label: leaderLabel.replace(/\s+/g, " ").trim() }
          : null;
    if (!pending) return { list: leaders };
    if (pending.kind === "trainee" && leaders.some((x) => x.kind === "trainee" && x.roster_id === pending.roster_id)) return { list: leaders };
    if (leaders.length >= KK_LIMITS.leaders) return { list: leaders, problem: `עד ${KK_LIMITS.leaders} מובילים לקבוצה (הצעה).` };
    return { list: [...leaders, pending] };
  };
  const clearPending = () => {
    setLeaderRoster(null);
    setLeaderLabel("");
  };

  const addLeader = () => {
    setProblem(null);
    if (kind === "trainee" && leaderRoster == null) return setProblem("צריך לבחור חניך/ה מהרשימה.");
    if (kind !== "trainee" && !leaderLabel.trim()) return setProblem("צריך לכתוב את השם של המוביל/ה.");
    const { list, problem: p } = withPending();
    if (p) return setProblem(p);
    setLeaders(list);
    clearPending();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!name.trim()) {
      document.getElementById(`${id}-t`)?.focus();
      return setProblem("צריך לכתוב את שם הספר.");
    }
    const cap = capacity.trim() === "" ? null : Number(capacity);
    if (cap != null && (!Number.isInteger(cap) || cap < 1 || cap > KK_LIMITS.capacity)) return setProblem(`תפוסה: מספר שלם בין 1 ל-${KK_LIMITS.capacity}, או ריק.`);
    // a leader picked or typed but not added with «הוספת מוביל/ה» is still meant: saved with the others
    const { list, problem: p } = withPending();
    if (p) return setProblem(p);
    if (list !== leaders) {
      setLeaders(list);
      clearPending();
    }
    await onSave({ title: name, author: author.trim() || null, room_id: roomId, capacity: cap, open, leaders: list }, (code) => {
      if (!["title_required", "bad_value", "bad_trainee", "outside_grid"].includes(code ?? "")) return false;
      setProblem(code === "title_required" ? "צריך לכתוב את שם הספר." : errorMessage(code));
      return true;
    });
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-label={title} className="space-y-3 rounded-lg border border-ink/30 bg-paper p-3" noValidate>
      <h4 className="font-semibold">{heading ?? title}</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-t`} label="שם הספר">
          <input id={`${id}-t`} value={name} maxLength={KK_LIMITS.title} onChange={(e) => setName(e.target.value)} className={INPUT} autoComplete="off" />
        </Field>
        <Field id={`${id}-a`} label="מחבר/ת (לא חובה)">
          <input id={`${id}-a`} value={author} maxLength={KK_LIMITS.author} onChange={(e) => setAuthor(e.target.value)} className={INPUT} autoComplete="off" />
        </Field>
        <Field id={`${id}-r`} label="חדר (לא חובה)">
          <select id={`${id}-r`} value={roomId ?? ""} onChange={(e) => setRoomId(e.target.value ? Number(e.target.value) : null)} className={INPUT}>
            <option value="">בלי חדר</option>
            {week.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-c`} label="תפוסה" hint="כמה מקומות. בלי תפוסה הקבוצה לא מוצעת בקישור ההרשמה.">
          <input id={`${id}-c`} type="number" inputMode="numeric" min={1} max={KK_LIMITS.capacity} value={capacity} onChange={(e) => setCapacity(e.target.value)} className={INPUT} aria-describedby={`${id}-c-hint`} />
        </Field>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} className="size-5 accent-ink" />
        פתוחה להרשמה בקישור
      </label>
      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-semibold">מובילים</legend>
        {leaders.length === 0 ? (
          <p className="text-sm text-ink-soft">עוד אין מובילים.</p>
        ) : (
          <ul aria-label="המובילים" className="flex flex-wrap gap-1.5">
            {leaders.map((l, i) => (
              <li key={i} className="inline-flex items-center gap-1 rounded-full border border-line bg-card ps-3 text-sm">
                {nameOf(l)} <span className="text-ink-soft">({LEADER_KIND_LABEL[l.kind]})</span>
                <button type="button" aria-label={`הסרת ${nameOf(l)} מהמובילים`} onClick={() => setLeaders((cur) => cur.filter((_, k) => k !== i))} className="inline-flex size-11 items-center justify-center rounded-full hover:bg-line/60">
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Field id={`${id}-lk`} label="מוביל/ה">
            <select id={`${id}-lk`} value={kind} onChange={(e) => setKind(e.target.value as LeaderKind)} className={INPUT}>
              {LEADER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LEADER_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          {kind === "trainee" ? (
            <Field id={`${id}-lr`} label="מרשימת החניכים">
              <select id={`${id}-lr`} value={leaderRoster ?? ""} onChange={(e) => setLeaderRoster(e.target.value ? Number(e.target.value) : null)} className={INPUT}>
                <option value="">בחירה</option>
                {roster.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field id={`${id}-ll`} label="שם">
              <input id={`${id}-ll`} value={leaderLabel} maxLength={KK_LIMITS.leader} onChange={(e) => setLeaderLabel(e.target.value)} className={INPUT} autoComplete="off" />
            </Field>
          )}
          <Button onClick={addLeader}>הוספת מוביל/ה</Button>
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
