// The logistics home's tasks (the reset, phase 4: `/logistics` with no tab — LogisticsHome.tsx) — pure, from the loaded
// Week and the three reads the home makes once each: the rota (public.load_rota), מכריכה לכריכה (public.load_kk) and the
// transports (public.get_transports_for — asked only by whoever may decide, mayDecide: outside a real live edition it
// answers [] by rule, which says nothing of who has a driver). Three groups, always all three, with no date thresholds:
// «בהתחלה», «כשהתוכן מוכן» and «קרוב לשבוע» (its line: how far the week is, weekLine(daysToWeek)). A task is
//   done     what it asks is there («כל הספרים הוזמנו»);
//   open     something is left, said in numbers («2 ספרים עוד לא הוזמנו»);
//   empty    nothing to do yet — no cohorts, no books, no transport approved: never a false «done»;
//   unknown  its read failed («לא נטען»), or the transports for a viewer who may not decide here («לא זמין במחזור הזה»).
// A failed read turns only its own tasks unknown. Each task links to the page that does it. Every count is one of the
// rules the pages themselves use (rotaWarnings, pendingPayments, printRows, paymentRows, boardCounts, the reader's
// manifest) — nothing here decides anything of its own.
import type { LessonTransport } from "../../data/commands";
import type { KkData } from "../../data/kk";
import { prepKindOf, type RotaCohort, type RotaData } from "../../data/rota";
import { daysToWeek, israelDate } from "../../domain/israelTime";
import { kkWindowState } from "../../domain/kkWindow";
import { pendingPayments } from "../../domain/mine";
import { canDrive, helpsRota } from "../../domain/rota";
import { rotaWarnings } from "../../domain/rotaWarnings";
import type { Week } from "../../domain/types";
import { paymentRows, printRows } from "../../exports/logistics";
import { filesAfterSent, readerManifest, readerRows } from "../../reader/model";
import { boardCounts } from "./lanes";

export type TaskState = "done" | "open" | "empty" | "unknown";
export type TaskKey = "presence" | "assign" | "requests" | "books" | "prints" | "drivers" | "payments" | "reader" | "prep";
export type TaskGroupKey = "start" | "content" | "near";

export interface Task {
  key: TaskKey;
  /** The task's name — the link to its page. */
  title: string;
  state: TaskState;
  /** What stands, in a line («2 ספרים עוד לא הוזמנו»). */
  line: string;
  /** The page that does it. */
  to: string;
}

export interface TaskGroup {
  key: TaskGroupKey;
  title: string;
  /** «קרוב לשבוע»: how far the week is («בעוד 21 ימים», «תאריך השבוע עוד לא נקבע»). */
  line?: string;
  tasks: Task[];
}

export interface TasksInput {
  week: Week;
  /** public.load_rota; null: the read failed. */
  rota: RotaData | null;
  /** public.load_kk; null: the read failed. */
  kk: KkData | null;
  /** public.get_transports_for; null: the read failed (or was not made: `mayDecide` false). */
  transports: readonly LessonTransport[] | null;
  /** mayDecide(actor, edition) — the viewer decides requests here, and the transports read was asked. */
  mayDecide: boolean;
}

/** The chips' words for each state. */
export const TASK_STATE_LABEL: Record<TaskState, string> = { done: "הושלם", open: "לטיפול", empty: "עוד לא התחיל", unknown: "לא ידוע" };

/** A read that failed. */
export const NOT_LOADED = "לא נטען";
/** The transports outside a real live edition (or for a viewer who may not decide there): the read answers nothing by rule. */
export const NOT_HERE = "לא זמין במחזור הזה";

export const GROUP_TITLE: Record<TaskGroupKey, string> = { start: "בהתחלה", content: "כשהתוכן מוכן", near: "קרוב לשבוע" };

/** «בעוד 21 ימים» · «בעוד יומיים» · «מחר» · «היום» · «השבוע כבר התחיל» · «תאריך השבוע עוד לא נקבע» (daysToWeek's answer). */
export function weekLine(days: number | null): string {
  if (days == null) return "תאריך השבוע עוד לא נקבע";
  if (days < 0) return "השבוע כבר התחיל";
  if (days === 0) return "היום";
  if (days === 1) return "מחר";
  if (days === 2) return "בעוד יומיים";
  return `בעוד ${days} ימים`;
}

/** «1 → the singular phrase, N → the plural one». */
const count = (n: number, one: string, many: (n: number) => string) => (n === 1 ? one : many(n));

/** «20.2.2027» — an instant's date in Israel. */
function dmy(iso: string): string {
  const [y, m, d] = israelDate(iso).split("-").map(Number);
  return `${d}.${m}.${y}`;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byCohort = (a: RotaCohort, b: RotaCohort) => a.sort - b.sort || cmpStr(a.letter, b.letter) || a.id - b.id;

type Base = Pick<Task, "key" | "title" | "to">;
const task = (base: Base, state: TaskState, line: string): Task => ({ ...base, state, line });

// ------------------------------------------------------------------ בהתחלה

/** «נוכחות המכינות»: the cohorts entered, each marked on campus somewhere (rotaWarnings' presence_unknown), the two flags counted. */
function presenceTask(rota: RotaData | null): Task {
  const base: Base = { key: "presence", title: "נוכחות המכינות", to: "/logistics/rota/setup" };
  if (!rota) return task(base, "unknown", NOT_LOADED);
  const cohorts = [...rota.cohorts].sort(byCohort);
  if (cohorts.length === 0) return task(base, "empty", "עוד לא הוזנו מכינות");
  // presence_unknown's rule: no presence row at all for the cohort (never assumed)
  const unmarked = cohorts.filter((c) => !rota.presence.some((p) => p.cohort_id === c.id));
  if (unmarked.length > 0) return task(base, "open", `לא סומן מתי בקמפוס: ${unmarked.map((c) => c.name).join(", ")}`);
  const n = count(cohorts.length, "מכינה אחת", (k) => `${k} מכינות`);
  return task(base, "done", `${n} · עוזרות בתורנויות: ${cohorts.filter(helpsRota).length} · יכולות להסיע: ${cohorts.filter(canDrive).length}`);
}

/**
 * «שיבוץ התורנויות»: what the board warns about that someone has to fill in — groups without a size or a head, duties
 * without a target, shifts without a lead, shifts short of groups or with too many, and hand-made assignments to a
 * group whose cohort does not help (the `not_helping` warning's rule). None of these: every shift is placed.
 */
function assignTask(rota: RotaData | null, week: Week): Task {
  const base: Base = { key: "assign", title: "שיבוץ התורנויות", to: "/logistics/rota" };
  if (!rota) return task(base, "unknown", NOT_LOADED);
  if (rota.groups.length === 0) return task(base, "empty", "עוד אין קבוצות");
  if (rota.duties.length === 0) return task(base, "empty", "עוד אין תורנויות");
  const warnings = rotaWarnings(rota, week.edition);
  const of = (kind: string) => warnings.filter((w) => w.kind === kind);
  /** The distinct shifts (day × shift) a kind of warning is about. */
  const shifts = (kind: string) => new Set(of(kind).map((w) => `${w.day}:${w.shift}`)).size;
  const sizeless = rota.groups.filter((g) => g.size == null).length;
  const headless = of("no_head").reduce((n, w) => n + w.groupIds.length, 0);
  const noTarget = of("no_target").length;
  const noLead = shifts("no_lead");
  const under = shifts("under");
  const over = shifts("over");
  const notHelping = new Set(rota.cohorts.filter((c) => !helpsRota(c)).map((c) => c.id));
  const cohortOf = new Map(rota.groups.map((g) => [g.id, g.cohort_id]));
  const byHand = rota.assignments.filter((a) => notHelping.has(cohortOf.get(a.group_id) ?? -1)).length;
  const parts = [
    sizeless && count(sizeless, "קבוצה אחת בלי גודל", (n) => `${n} קבוצות בלי גודל`),
    headless && count(headless, "קבוצה אחת בלי ראש/ת קבוצה", (n) => `${n} קבוצות בלי ראש/ת קבוצה`),
    noTarget && count(noTarget, "תורנות אחת בלי מספר קבוצות", (n) => `${n} תורנויות בלי מספר קבוצות`),
    noLead && count(noLead, "משמרת אחת בלי אחראי/ת", (n) => `${n} משמרות בלי אחראי/ת`),
    under && count(under, "חסרות קבוצות במשמרת אחת", (n) => `חסרות קבוצות ב-${n} משמרות`),
    over && count(over, "יותר מדי קבוצות במשמרת אחת", (n) => `יותר מדי קבוצות ב-${n} משמרות`),
    byHand && count(byHand, "שיבוץ אחד לקבוצה שלא עוזרת", (n) => `${n} שיבוצים לקבוצות שלא עוזרות`),
  ].filter((p): p is string => typeof p === "string");
  return parts.length > 0 ? task(base, "open", parts.join(" · ")) : task(base, "done", "כל המשמרות שובצו");
}

// ------------------------------------------------------------------ כשהתוכן מוכן

/** «בקשות שממתינות»: the payment and transport requests waiting for a decision (pendingPayments) — for whoever decides here. */
function requestsTask(week: Week, mayDecide: boolean): Task {
  const base: Base = { key: "requests", title: "בקשות שממתינות", to: "/approvals" };
  if (!mayDecide) return task(base, "unknown", NOT_HERE);
  if (!week.lessons.some((l) => l.state === "closed" && l.approval !== "none")) return task(base, "empty", "עוד לא התבקשו תשלומים או הסעות");
  const n = pendingPayments(week).length;
  return n > 0 ? task(base, "open", count(n, "בקשה אחת ממתינה", (k) => `${k} בקשות ממתינות`)) : task(base, "done", "אין בקשות שממתינות");
}

/** «ספרים»: the groups with a book, each with its order marked «הוזמן» (a line with no «הוזמן», or none at all, waits). */
function booksTask(week: Week, kk: KkData | null, nowMs: number): Task {
  const base: Base = { key: "books", title: "ספרים", to: "/logistics/books" };
  if (!kk) return task(base, "unknown", NOT_LOADED);
  const books = kk.groups.filter((g) => g.title != null);
  if (books.length === 0) return task(base, "empty", "עוד אין ספרים");
  const ordered = new Set(kk.orders.filter((o) => o.ordered_at != null).map((o) => o.group_id));
  const waiting = books.filter((g) => !ordered.has(g.id)).length;
  if (waiting === 0) return task(base, "done", "כל הספרים הוזמנו");
  const open = kkWindowState(week.edition.settings?.kk_window, nowMs) === "open";
  return task(base, "open", `${count(waiting, "ספר אחד עוד לא הוזמן", (n) => `${n} ספרים עוד לא הוזמנו`)}${open ? " · ההרשמה עדיין פתוחה" : ""}`);
}

/** «הדפסות»: the lessons printed ahead or on the day (printRows), each with its files. */
function printsTask(week: Week): Task {
  const base: Base = { key: "prints", title: "הדפסות", to: "/logistics/prints" };
  const rows = printRows(week);
  if (rows.length === 0) return task(base, "empty", "אין שיעורים להדפסה");
  const none = rows.filter((r) => r.files.length === 0).length;
  return none > 0 ? task(base, "open", count(none, "שיעור אחד עוד בלי קבצים", (n) => `${n} שיעורים עוד בלי קבצים`)) : task(base, "done", "לכל השיעורים להדפסה יש קבצים");
}

// ------------------------------------------------------------------ קרוב לשבוע

/** «נהגים»: the approved transports, each «סודר» (the board's counts, boardCounts — the read alone says who is arranged). */
function driversTask(week: Week, transports: readonly LessonTransport[] | null, mayDecide: boolean): Task {
  const base: Base = { key: "drivers", title: "נהגים", to: "/logistics/transports" };
  if (!mayDecide) return task(base, "unknown", NOT_HERE);
  if (!transports) return task(base, "unknown", NOT_LOADED);
  const c = boardCounts(week, transports);
  if (c.approved === 0) return task(base, "empty", "אין הסעות שאושרו");
  const waiting = c.approved - c.arranged;
  return waiting > 0 ? task(base, "open", count(waiting, "הסעה אחת עוד בלי נהג/ת", (n) => `${n} הסעות עוד בלי נהג/ת`)) : task(base, "done", "כל ההסעות סודרו");
}

/** «תשלומים»: the approved amounts (paymentRows), each marked «שולם». */
function paymentsTask(week: Week): Task {
  const base: Base = { key: "payments", title: "תשלומים", to: "/logistics/payments" };
  const rows = paymentRows(week);
  if (rows.length === 0) return task(base, "empty", "אין תשלומים שאושרו");
  const unpaid = rows.filter((r) => r.paidAt == null).length;
  return unpaid > 0 ? task(base, "open", count(unpaid, "תשלום אחד עוד לא שולם", (n) => `${n} תשלומים עוד לא שולמו`)) : task(base, "done", "כל התשלומים שולמו");
}

/**
 * «המקראה לדפוס»: marked «נשלח לדפוס» (settings.reader_sent) with no file uploaded since (filesAfterSent); not sent while
 * the reader has something to print (a readable file of a lesson in it) is open; nothing in it yet is empty.
 */
function readerTask(week: Week): Task {
  const base: Base = { key: "reader", title: "המקראה לדפוס", to: "/reader" };
  const at = week.edition.settings?.reader_sent?.at;
  if (at && Number.isFinite(Date.parse(at))) {
    const after = filesAfterSent(week);
    if (after === 0) return task(base, "done", `נשלחה לדפוס ב-${dmy(at)}`);
    return task(base, "open", `נשלחה ב-${dmy(at)} · ${count(after, "נוסף קובץ אחד אחרי השליחה", (n) => `נוספו ${n} קבצים אחרי השליחה`)}`);
  }
  const printable = readerRows(readerManifest(week)).some((r) => r.printable.length > 0);
  return printable ? task(base, "open", "עוד לא נשלחה לדפוס") : task(base, "empty", "עוד אין חומרים במקראה");
}

/** «מוצ״ש»: Saturday night's tasks done and its shopping list bought — each list's part only when it has rows. */
function prepTask(rota: RotaData | null): Task {
  const base: Base = { key: "prep", title: "מוצ״ש", to: "/logistics/rota/prep" };
  if (!rota) return task(base, "unknown", NOT_LOADED);
  const tasks = rota.prep.filter((t) => prepKindOf(t) === "task");
  const items = rota.prep.filter((t) => prepKindOf(t) === "item");
  if (tasks.length === 0 && items.length === 0) return task(base, "empty", "עוד אין משימות או קניות");
  const done = (xs: typeof tasks) => xs.filter((t) => t.done).length;
  const parts = [
    ...(tasks.length > 0 ? [`${done(tasks)}/${tasks.length} משימות בוצעו`] : []),
    ...(items.length > 0 ? [`${done(items)}/${items.length} פריטים נקנו`] : []),
  ];
  return task(base, rota.prep.every((t) => t.done) ? "done" : "open", parts.join(" · "));
}

/** The home's three groups, always all three, each task in one of its four states. */
export function logisticsTasks(input: TasksInput, nowIso: string): { groups: TaskGroup[] } {
  const { week, rota, kk, transports, mayDecide } = input;
  const nowMs = Date.parse(nowIso);
  return {
    groups: [
      { key: "start", title: GROUP_TITLE.start, tasks: [presenceTask(rota), assignTask(rota, week)] },
      { key: "content", title: GROUP_TITLE.content, tasks: [requestsTask(week, mayDecide), booksTask(week, kk, nowMs), printsTask(week)] },
      {
        key: "near",
        title: GROUP_TITLE.near,
        line: weekLine(daysToWeek(week.edition.start_date, nowIso)),
        tasks: [driversTask(week, transports, mayDecide), paymentsTask(week), readerTask(week), prepTask(rota)],
      },
    ],
  };
}
