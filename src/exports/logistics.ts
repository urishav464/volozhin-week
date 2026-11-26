// «לוגיסטיקה» (/logistics, milestone 5ב-2): the four lists the logistics team
// works from, each pure and from a loaded Week — the screen, the printed A4 and
// the xlsx/CSV are this one list (src/screens/logistics/LogisticsScreen.tsx):
//   הסעות      the closed lessons whose transport the instructor approved, in grid
//              order, with what get_transports_for returned (pickup, driver,
//              «סודר») — the pickup address and the driver's phone only when
//              «כולל כתובות וטלפונים» is on; v18's read also lists the requests
//              that still wait for the instructor: this list leaves them out;
//   תשלומים    the closed lessons with an approved amount, «שולם» or not, and
//              the totals;
//   ספרים      מכריכה לכריכה's groups — one book each for the whole week, its
//              place and leaders — the copies to order and «הוזמן»;
//   הדפסות     the lessons whose sources are printed ahead or on the day, by
//              that and by day: «מרצה – כותרת», the files and their pages.
// v20 «הסעות וצוות» (transportStaffTable): the week by day — the staff's shifts
// and the approved transports at their times, a pickup before 06:30 in the
// night of the day before (the staff's clock), a round trip's way back at the
// teaching's end; the address and the driver's phone only with «כולל כתובות
// וטלפונים». The logistics side's alone: /print/rota, every member's, never
// has a transport.
// Nothing here fills in a number nobody entered: no amounts, no books, and the
// copies are what logistics saved — the book order's «הצעה» (signed up +
// leaders: suggestedCopies, src/domain/kk.ts) fills the screen's field only on
// «למלא», is saved only on «שמירה», and never reaches a file.
import type { LessonTransport } from "../data/commands";
import type { KkData, KkGroup } from "../data/kk";
import type { RotaData } from "../data/rota";
import { fromPreviousSpeaker, isPresentation } from "../data/sourceRules";
import { groupName, LEADER_KIND_LABEL, leaderName, leadersOf } from "../domain/kk";
import { teachMinutes } from "../domain/message";
import { displayName } from "../domain/names";
import { typedPickupMin } from "../domain/pickup";
import { PRINT_WHEN_LABEL, TRANSPORT_LABEL } from "../domain/stages";
import { DAY_NAMES, type Day, DAYS, fmt, fmtRange, LRM, nightLabel } from "../domain/time";
import type { Lesson, SourceFile, TransportDetails, Week } from "../domain/types";
import { staffInOrder, staffWho } from "./rota";
import { onStaffClock, type TransportLeg } from "./staffSchedule";
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

/**
 * «הסעות» shows APPROVED transports only: the Week's lessons decide the rows (approvedTransport), and of the read
 * (v18: pending requests too, each with its `approval` and `pickup_min`) only an approved row gives its details — the
 * five fields, as before.
 */
export function transportRows(week: Week, details: readonly LessonTransport[] | null): TransportRow[] {
  const by = new Map<number, TransportDetails>(
    (details ?? [])
      .filter((d) => d.approval === "approved")
      .map(({ lesson_id, pickup_address, pickup_time, driver_name, driver_phone, arranged }) => [lesson_id, { pickup_address, pickup_time, driver_name, driver_phone, arranged }]),
  );
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

// ------------------------------------------------------------------ הסעות וצוות (v20)

/**
 * v20: the legs of the transports the read returned — only what app.may_see_transport let this viewer read: the way
 * there at the pickup (its minute as every logistics view reads it, typedPickupMin; null when no time is typed) and, for
 * «הלוך ושוב», the way back at the teaching's end (app.teach_end). The APPROVED ones (the print's); `pending` adds the
 * requests that still wait for the decision (the staff's schedule on screen, as the board shows them). In grid order.
 * For the logistics side only.
 */
export function transportLegs(
  week: Pick<Week, "lessons" | "lessonSpeakers" | "speakers" | "rooms" | "edition">,
  details: readonly LessonTransport[] | null,
  opts: { pending?: boolean } = {},
): TransportLeg[] {
  const by = new Map((details ?? []).filter((d) => d.approval === "approved" || (opts.pending && d.approval === "pending")).map((d) => [d.lesson_id, d]));
  const lessonMinutes = week.edition.settings?.lesson_minutes;
  const asked = (l: Lesson) => l.state === "closed" && l.kind === "lesson" && l.transport !== "none" && (l.approval === "approved" || (opts.pending === true && l.approval === "pending"));
  return week.lessons
    .filter((l) => asked(l) && by.has(l.id))
    .sort(gridOrder(week))
    .flatMap((l) => {
      const d = by.get(l.id)!;
      const state: TransportLeg["state"] = l.approval === "pending" || d.approval === "pending" ? "pending" : d.arranged ? "arranged" : "approved";
      const there: TransportLeg = { lessonId: l.id, leg: "pickup", day: l.day, min: typedPickupMin(l.start_min, d), start: l.start_min, speaker: speakersOf(week, l.id), state };
      return l.transport === "round_trip" ? [there, { ...there, leg: "return" as const, min: l.start_min + teachMinutes(l, lessonMinutes) }] : [there];
    });
}

/** The words of a leg in «מה». */
export const LEG_LABEL: Record<TransportLeg["leg"], string> = { pickup: "הסעה הלוך", return: "הסעה חזרה" };

export interface TransportStaffInput {
  week: Week;
  /** The one transports read (get_transports_for); null: not loaded — the staff alone. */
  details: readonly LessonTransport[] | null;
  /** The rota (load_rota: no phone); null: not loaded — the transports alone. */
  rota: Pick<RotaData, "staff" | "cohorts"> | null;
  /** «כולל כתובות וטלפונים». */
  personal: boolean;
}

/**
 * «הסעות וצוות»: the whole week by day, and in each day by time, the staff's shifts («צוות», who, the hours, the note)
 * and the legs of the approved transports («הסעה הלוך» at the pickup, «הסעה חזרה» at the teaching's end; who = the
 * speaker; the lesson, the driver, «סודר»). On the staff's clock: a night hour is the day before it («ליל ראשון–שני»),
 * so a pickup before 06:30 sits with the night staff who could take it. `personal`: the pickup address (the way there)
 * and the driver's phone; off, neither column exists.
 */
export function transportStaffTable({ week, details, rota, personal }: TransportStaffInput): Table {
  type Item = { col: Day; min: number; order: number; row: string[] };
  const items: Item[] = [];
  const blank = personal ? ["", ""] : [];
  const day = (col: Day, min: number) => nightLabel(col, min) ?? DAY_NAMES[col];
  for (const s of rota ? staffInOrder(rota) : []) {
    items.push({ col: s.day, min: s.start_min, order: 0, row: [day(s.day, s.start_min), `${LRM}${fmtRange(s.start_min, s.end_min)}`, "צוות", staffWho(rota!, s), s.note ?? "", "", ...blank, ""] });
  }
  const lessons = new Map(week.lessons.map((l) => [l.id, l]));
  const by = new Map((details ?? []).map((d) => [d.lesson_id, d]));
  for (const g of transportLegs(week, details)) {
    const l = lessons.get(g.lessonId)!;
    const d = by.get(g.lessonId)!;
    const at = g.min ?? g.start;
    const clock = onStaffClock(g.day, at) ?? { day: g.day, min: at };
    const lesson = `${g.leg === "return" ? "מהשיעור של" : "לשיעור של"} ${LRM}${fmt(g.start)}${clock.day !== g.day ? ` (${DAY_NAMES[g.day]})` : ""} · ${l.title ?? "TBD"}`;
    items.push({
      col: clock.day,
      min: clock.min,
      order: 1,
      row: [
        day(clock.day, clock.min),
        g.min == null ? "TBD" : `${LRM}${fmt(g.min)}`,
        LEG_LABEL[g.leg],
        g.speaker || "TBD",
        lesson,
        d.driver_name ?? "",
        ...(personal ? [g.leg === "pickup" ? (d.pickup_address ?? "") : "", phoneCell(d.driver_phone ?? undefined)] : []),
        d.arranged ? "סודר" : "טרם סודר",
      ],
    });
  }
  items.sort((a, b) => a.col - b.col || a.min - b.min || a.order - b.order);
  return {
    name: `הסעות וצוות ${week.edition.label}`,
    headers: ["יום", "שעה", "מה", "מי", "פרטים", "נהג/ת", ...(personal ? ["כתובת איסוף", "טלפון הנהג/ת"] : []), "סודר"],
    widths: [16, 14, 12, 24, 40, 18, ...(personal ? [28, 18] : []), 10],
    landscape: true,
    rows: items.map((i) => i.row),
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

export interface BookRow {
  group: KkGroup;
  /** The book; a group that has an order line but no book (yet, or any more) by its name on screen. */
  title: string;
  author: string;
  /** Where the group meets all week; "" while not set. */
  place: string;
  /** «name (kind)», in their order. */
  leaders: string;
  leaderCount: number;
  signups: number;
  /** As logistics saved it; null: no line yet. The screen's «הצעה» fills the field only when asked — never this row by itself. */
  copies: number | null;
  orderedAt: string | null;
}

/** One row per group with a book or an order line — the whole week's (schema v15: no day, no time), by title then id. */
export function bookRows(week: Pick<Week, "roster">, kk: KkData): BookRow[] {
  return kk.groups
    .map((g) => ({ g, order: kk.orders.find((o) => o.group_id === g.id) ?? null }))
    .filter(({ g, order }) => g.title != null || order != null)
    .map(({ g, order }) => {
      const leaders = leadersOf(kk, g.id);
      return {
        group: g,
        title: groupName(g, kk, week.roster),
        author: g.author ?? "",
        place: g.place ?? "",
        leaders: leaders.map((x) => `${leaderName(x, week.roster) || "—"} (${LEADER_KIND_LABEL[x.kind]})`).join(", "),
        leaderCount: leaders.length,
        signups: kk.signups.filter((s) => s.group_id === g.id).length,
        copies: order?.copies ?? null,
        orderedAt: order?.ordered_at ?? null,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, "he") || a.group.id - b.group.id);
}

export function bookTable(rows: BookRow[], editionLabel: string, orderedText: (iso: string) => string): Table {
  return {
    name: `ספרים ${editionLabel}`,
    headers: ["ספר", "מחבר/ת", "מרחב", "מעבירים", "נרשמו", "עותקים להזמנה", "הוזמן"],
    widths: [28, 18, 16, 30, 8, 14, 20],
    rows: rows.map((r) => [
      r.title,
      r.author,
      r.place,
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
      // the current speaker's files to print — never a presentation (v19: shown in the room, not printed)
      const files = (week.sourceFiles ?? []).filter((f) => f.lesson_id === l.id && !fromPreviousSpeaker(f, lead) && !isPresentation(f)).sort((a, b) => a.id - b.id);
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
