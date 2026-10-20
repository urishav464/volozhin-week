// «לוגיסטיקה» (/logistics, milestone 5ב-2): the four lists the logistics team
// works from, each pure and from a loaded Week — the screen, the printed A4 and
// the xlsx/CSV are this one list (src/screens/logistics/LogisticsScreen.tsx):
//   הסעות      the closed lessons whose transport the instructor approved, in grid
//              order, with what get_transports_for returned (pickup, driver,
//              «סודר») — the pickup address and the driver's phone only when
//              «כולל כתובות וטלפונים» is on;
//   תשלומים    the closed lessons with an approved amount, «שולם» or not, and
//              the totals;
//   ספרים      מכריכה לכריכה's groups, the copies to order and «הוזמן»;
//   הדפסות     the lessons whose sources are printed ahead or on the day, by
//              that and by day: «מרצה – כותרת», the files and their pages.
// Nothing here fills in a number nobody entered: no copies to print, no
// amounts, no books.
import type { LessonTransport } from "../data/commands";
import type { KkData, KkGroup, KkTrack, LeaderKind } from "../data/kk";
import { fromPreviousSpeaker } from "../data/sourceRules";
import { displayName } from "../domain/names";
import { PRINT_WHEN_LABEL, TRANSPORT_LABEL } from "../domain/stages";
import { DAY_NAMES, type Day, DAYS, fmtRange } from "../domain/time";
import type { Lesson, SourceFile, TransportDetails, Week } from "../domain/types";
import type { Table } from "./table";
import { gridOrder, phoneCell, teachingWhen, whenCell } from "./tracking";

/** The day and time a row shows, «ראשון» and «08:30–09:45». */
interface When {
  dayLabel: string;
  time: string;
}

/** The lesson's speakers, lead first: «ד״ר א · ב». */
export function speakersOf(week: Pick<Week, "lessonSpeakers" | "speakers">, lessonId: number): string {
  const speakers = new Map(week.speakers.map((s) => [s.id, s]));
  return week.lessonSpeakers
    .filter((x) => x.lesson_id === lessonId)
    .sort((a, b) => Number(a.role !== "lead") - Number(b.role !== "lead") || a.speaker_id - b.speaker_id)
    .map((x) => speakers.get(x.speaker_id))
    .filter((s) => !!s)
    .map((s) => displayName(s!))
    .join(" · ");
}

function whenOf(week: Week, l: Lesson): When {
  return teachingWhen(l, week.edition.settings?.lesson_minutes);
}

// ------------------------------------------------------------------ הסעות

export interface TransportRow extends When {
  lesson: Lesson;
  day: Day;
  speaker: string;
  title: string;
  /** «הלוך», «הלוך ושוב». */
  legs: string;
  /** What get_transports_for returned for it; null: nothing came back (not the caller's to see). */
  details: TransportDetails | null;
}

/** Is this lesson's transport one the logistics team arranges: closed, asked for, approved. */
export function approvedTransport(l: Lesson): boolean {
  return l.state === "closed" && l.kind === "lesson" && l.transport !== "none" && l.approval === "approved";
}

export function transportRows(week: Week, details: readonly LessonTransport[] | null): TransportRow[] {
  const by = new Map((details ?? []).map(({ lesson_id, ...d }) => [lesson_id, d]));
  return week.lessons
    .filter(approvedTransport)
    .sort(gridOrder(week))
    .map((l) => ({
      lesson: l,
      day: l.day,
      ...whenOf(week, l),
      speaker: speakersOf(week, l.id),
      title: l.title ?? "TBD",
      legs: TRANSPORT_LABEL[l.transport],
      details: by.get(l.id) ?? null,
    }));
}

export function transportCounts(rows: TransportRow[]): { total: number; arranged: number } {
  return { total: rows.length, arranged: rows.filter((r) => r.details?.arranged).length };
}

/**
 * The transports' table. `personal`: «כולל כתובות וטלפונים» — the pickup address after the pickup time and the
 * driver's phone after the driver; off, neither column exists. The driver's name and «סודר» are the list itself.
 */
export function transportTable(rows: TransportRow[], editionLabel: string, personal: boolean): Table {
  const headers = ["יום ושעה", "מרצה", "כותרת", "הסעה", "שעת איסוף", ...(personal ? ["כתובת איסוף"] : []), "נהג/ת", ...(personal ? ["טלפון הנהג/ת"] : []), "סודר"];
  const widths = [20, 24, 26, 12, 16, ...(personal ? [28] : []), 18, ...(personal ? [18] : []), 10];
  return {
    name: `הסעות ${editionLabel}`,
    headers,
    widths,
    landscape: true,
    rows: rows.map((r) => {
      const d = r.details;
      return [
        whenCell(r),
        r.speaker,
        r.title,
        r.legs,
        d?.pickup_time ?? "",
        ...(personal ? [d?.pickup_address ?? ""] : []),
        d?.driver_name ?? "",
        ...(personal ? [phoneCell(d?.driver_phone ?? undefined)] : []),
        d == null ? "" : d.arranged ? "סודר" : "טרם סודר",
      ];
    }),
  };
}

// ------------------------------------------------------------------ תשלומים

export interface PaymentRow extends When {
  lesson: Lesson;
  day: Day;
  speaker: string;
  title: string;
  /** Whole shekels, as approved. */
  amount: number;
  paidAt: string | null;
}

export function paymentRows(week: Week): PaymentRow[] {
  return week.lessons
    .filter((l) => l.state === "closed" && l.approval === "approved" && l.pay_amount != null)
    .sort(gridOrder(week))
    .map((l) => ({ lesson: l, day: l.day, ...whenOf(week, l), speaker: speakersOf(week, l.id), title: l.title ?? "TBD", amount: l.pay_amount!, paidAt: l.paid_at }));
}

export interface PaymentTotals {
  count: number;
  total: number;
  paidCount: number;
  paid: number;
  unpaid: number;
}

export function paymentTotals(rows: PaymentRow[]): PaymentTotals {
  const paid = rows.filter((r) => r.paidAt != null);
  const sum = (xs: PaymentRow[]) => xs.reduce((a, r) => a + r.amount, 0);
  return { count: rows.length, total: sum(rows), paidCount: paid.length, paid: sum(paid), unpaid: sum(rows) - sum(paid) };
}

/** «1200» — a file's amount: digits only, so a spreadsheet can add them up. */
function amountCell(n: number): string {
  return String(n);
}

/** The payments' table, and a last row with the totals. `paidText` writes a paid date («10.11.2026»). */
export function paymentTable(rows: PaymentRow[], editionLabel: string, paidText: (iso: string) => string): Table {
  const t = paymentTotals(rows);
  return {
    name: `תשלומים ${editionLabel}`,
    headers: ["יום ושעה", "מרצה", "כותרת", "סכום (₪)", "שולם"],
    widths: [20, 26, 28, 12, 22],
    rows: [
      ...rows.map((r) => [whenCell(r), r.speaker, r.title, amountCell(r.amount), r.paidAt ? `שולם · ${paidText(r.paidAt)}` : "טרם שולם"]),
      ["סה״כ", "", t.count === 1 ? "תשלום אחד" : `${t.count} תשלומים`, amountCell(t.total), `שולם ${t.paid} · טרם שולם ${t.unpaid}`],
    ],
  };
}

// ------------------------------------------------------------------ ספרים

const LEADER_KIND: Record<LeaderKind, string> = { trainee: "חניך/ה", staff: "מהצוות", ein_prat: "מעין פרת" };

export interface BookRow extends When {
  group: KkGroup;
  track: KkTrack;
  day: Day;
  title: string;
  author: string;
  leaders: string;
  leaderCount: number;
  signups: number;
  /** As logistics entered it; null: no line yet. Never filled in from the sign-ups. */
  copies: number | null;
  orderedAt: string | null;
}

export function bookRows(week: Pick<Week, "roster">, kk: KkData): BookRow[] {
  const tracks = new Map(kk.tracks.map((t) => [t.id, t]));
  const roster = new Map(week.roster.map((r) => [r.id, r.full_name]));
  return kk.groups
    .filter((g) => tracks.has(g.track_id))
    .map((g) => {
      const track = tracks.get(g.track_id)!;
      const leaders = kk.leaders.filter((x) => x.group_id === g.id).sort((a, b) => a.id - b.id);
      const order = kk.orders.find((o) => o.group_id === g.id) ?? null;
      return {
        group: g,
        track,
        day: track.day,
        dayLabel: DAY_NAMES[track.day],
        time: fmtRange(track.start_min, track.end_min),
        title: g.title,
        author: g.author ?? "",
        leaders: leaders.map((x) => `${(x.roster_id != null ? roster.get(x.roster_id) : x.label) ?? "—"} (${LEADER_KIND[x.kind]})`).join(", "),
        leaderCount: leaders.length,
        signups: kk.signups.filter((s) => s.group_id === g.id).length,
        copies: order?.copies ?? null,
        orderedAt: order?.ordered_at ?? null,
      };
    })
    .sort((a, b) => a.day - b.day || a.track.start_min - b.track.start_min || a.group.id - b.group.id);
}

export function bookTable(rows: BookRow[], editionLabel: string, orderedText: (iso: string) => string): Table {
  return {
    name: `ספרים ${editionLabel}`,
    headers: ["יום ושעה", "ספר", "מחבר/ת", "מובילים", "נרשמו", "עותקים להזמנה", "הוזמן"],
    widths: [20, 28, 18, 30, 8, 14, 20],
    rows: rows.map((r) => [
      whenCell(r),
      r.title,
      r.author,
      r.leaders,
      String(r.signups),
      r.copies == null ? "" : String(r.copies),
      r.orderedAt ? `הוזמן · ${orderedText(r.orderedAt)}` : r.copies == null ? "" : "טרם הוזמן",
    ]),
  };
}

// ------------------------------------------------------------------ הדפסות

export type PrintTime = "before" | "same_day";
export const PRINT_TIMES: readonly PrintTime[] = ["before", "same_day"];

export interface PrintRow extends When {
  lesson: Lesson;
  day: Day;
  when: PrintTime;
  /** «מרצה – כותרת». */
  heading: string;
  /** The current lead speaker's files (a previous speaker's are not printed). */
  files: SourceFile[];
  /** The pages the browser counted; Word files and unread ones have none (`uncounted`). */
  pages: number;
  uncounted: number;
}

/** The closed lessons whose sources are printed ahead or on the day — «להדפיס מראש» first, then by grid order. */
export function printRows(week: Week): PrintRow[] {
  return week.lessons
    .filter((l): l is Lesson & { print_when: PrintTime } => l.state === "closed" && l.kind === "lesson" && (l.print_when === "before" || l.print_when === "same_day"))
    .sort((a, b) => PRINT_TIMES.indexOf(a.print_when) - PRINT_TIMES.indexOf(b.print_when) || gridOrder(week)(a, b))
    .map((l) => {
      const lead = week.lessonSpeakers.find((x) => x.lesson_id === l.id && x.role === "lead")?.speaker_id ?? null;
      const files = (week.sourceFiles ?? []).filter((f) => f.lesson_id === l.id && !fromPreviousSpeaker(f, lead)).sort((a, b) => a.id - b.id);
      const speaker = speakersOf(week, l.id) || "TBD";
      return {
        lesson: l,
        day: l.day,
        ...whenOf(week, l),
        when: l.print_when,
        heading: `${speaker} – ${l.title ?? "TBD"}`,
        files,
        pages: files.reduce((a, f) => a + (f.page_count ?? 0), 0),
        uncounted: files.filter((f) => f.page_count == null).length,
      };
    });
}

/** The rows by «מתי» and then by day — only the groups that have rows. */
export function printGroups(rows: PrintRow[]): { when: PrintTime; days: { day: Day; rows: PrintRow[] }[] }[] {
  return PRINT_TIMES.map((when) => ({
    when,
    days: DAYS.map((day) => ({ day, rows: rows.filter((r) => r.when === when && r.day === day) })).filter((d) => d.rows.length > 0),
  })).filter((g) => g.days.length > 0);
}

/** «12 עמודים», «עמוד אחד», and the files without a count: «· 1 קובץ בלי ספירת עמודים». No files: «אין קבצים». */
export function pagesText(r: Pick<PrintRow, "files" | "pages" | "uncounted">): string {
  if (r.files.length === 0) return "אין קבצים";
  const counted = r.pages === 1 ? "עמוד אחד" : `${r.pages} עמודים`;
  if (r.uncounted === 0) return counted;
  const rest = r.uncounted === 1 ? "קובץ אחד בלי ספירת עמודים" : `${r.uncounted} קבצים בלי ספירת עמודים`;
  return r.pages > 0 ? `${counted} · ${rest}` : rest;
}

/** The prints' file (the A4 print, the CSV, the xlsx): «אין קבצים» said once, in the files' column — the pages' cell empty. */
export function printTable(rows: PrintRow[], editionLabel: string): Table {
  return {
    name: `הדפסות ${editionLabel}`,
    headers: ["מתי", "יום ושעה", "מרצה – כותרת", "קבצים", "עמודים"],
    widths: [16, 20, 36, 40, 18],
    rows: rows.map((r) => [PRINT_WHEN_LABEL[r.when], whenCell(r), r.heading, r.files.length ? r.files.map((f) => f.display_name).join("; ") : "אין קבצים", r.files.length ? pagesText(r) : ""]),
  };
}
