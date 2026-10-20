// The tracking table (DESIGN «תוצרים» 1): one row per lesson in grid order,
// with last year's columns — מרצה · יום ושעה · כותרת · נושא · מקורות ·
// הסעה/תשלום · מלווה · «קיבל הודעת סיכום מ» (and טלפון, only when asked for and
// only the phones the caller may see) — and last year's stage colours as the
// row's tint. Pure, from a loaded Week: the screen, the print view, the CSV and
// the xlsx are all this one list.
import { teachMinutes } from "../domain/message";
import { displayName } from "../domain/names";
import { lessonTone, PROGRESS_FILL, type ProgressTone } from "../domain/progress";
import { APPROVAL_LABEL, type LessonStep, nextLessonStep, PRINT_WHEN_LABEL, readerFilesOf, requestText, SOURCES_LABEL } from "../domain/stages";
import { DAY_NAMES, type Day, fmtRange } from "../domain/time";
import { type Lesson, LIVE_PITCH, type Week } from "../domain/types";
import { LRM, type Table } from "./table";

/** What a row still needs — the stage filter: not closed, a memorial slot, the closed lesson's next step, or nothing. */
export type TrackingStage = "draft" | "memorial" | LessonStep | "ready";

export interface TrackingRow {
  lesson: Lesson;
  day: Day;
  /** The lead speaker (null for a draft or a memorial slot) — the phone is looked up by them. */
  speakerId: number | null;
  /** Who handles the lesson (the lead speaker's approach owner) — «שלי». A draft: whoever pitched someone there. */
  handlers: number[];
  speaker: string;
  /** «ראשון», or a night's «ליל ראשון–שני». */
  dayLabel: string;
  /** The teaching time, «08:30–09:45» (a screen wraps it in <bdi>). */
  time: string;
  title: string;
  category: string;
  sources: string;
  payment: string;
  escort: string;
  confirmed: string;
  tone: ProgressTone;
  stage: TrackingStage;
}

export const STAGE_FILTER_LABEL: Record<TrackingStage, string> = {
  draft: "טרם נסגר",
  payment: "תשלום/הסעה ממתין",
  reconfirm: "לעדכן את המרצה",
  send: "לשלוח הודעת סיכום",
  escort: "חסר מלווה",
  sources: "חסרים מקורות",
  ready: "הכול מוכן",
  memorial: "זמני זיכרון",
};

/** «10.11.2026» — the date in Israel, whatever the device's clock zone. */
export function israelDate(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "numeric" }).format(new Date(iso));
}

/** The grid's day (a night lesson says which night: «ליל ראשון–שני») and the teaching time («08:30–09:45»). */
export function teachingWhen(l: Pick<Lesson, "day" | "start_min" | "end_min" | "teach_min">, lessonMinutes?: number | null): { dayLabel: string; time: string } {
  const dayLabel = l.start_min >= 1440 && l.day < 4 ? `ליל ${DAY_NAMES[l.day]}–${DAY_NAMES[(l.day + 1) as Day]}` : DAY_NAMES[l.day];
  return { dayLabel, time: fmtRange(l.start_min, l.start_min + teachMinutes(l, lessonMinutes)) };
}

/** «ראשון 08:30–09:45» as a file's cell writes it (the time kept left to right). */
export function whenCell(r: { dayLabel: string; time: string }): string {
  return `${r.dayLabel} ${LRM}${r.time}`;
}

/** Grid order: day, time, the room's place, then id. */
export function gridOrder(week: Pick<Week, "rooms">): (a: Lesson, b: Lesson) => number {
  const sort = new Map(week.rooms.map((r) => [r.id, r.sort]));
  return (a, b) => a.day - b.day || a.start_min - b.start_min || (sort.get(a.room_id) ?? 0) - (sort.get(b.room_id) ?? 0) || a.id - b.id;
}

export function trackingRows(week: Week): TrackingRow[] {
  const speakers = new Map(week.speakers.map((s) => [s.id, s]));
  const categories = new Map(week.categories.map((c) => [c.id, c.name]));
  const roster = new Map(week.roster.map((r) => [r.id, r.full_name]));
  const team = new Map(week.team.map((t) => [t.id, t.display_name]));
  const approachBySpeaker = new Map(week.approaches.map((a) => [a.speaker_id, a]));
  const approachById = new Map(week.approaches.map((a) => [a.id, a]));
  const lessonMinutes = week.edition.settings?.lesson_minutes;

  return week.lessons
    .filter((l) => l.state !== "cancelled")
    .sort(gridOrder(week))
    .map((l): TrackingRow => {
      const tone = lessonTone(l);
      const base = { lesson: l, day: l.day, ...teachingWhen(l, lessonMinutes), category: (l.category_id != null && categories.get(l.category_id)) || "", tone };
      if (l.kind === "memorial") {
        return { ...base, speakerId: null, handlers: [], speaker: "", title: l.title ?? "זמן זיכרון", sources: "", payment: "", escort: "", confirmed: "", stage: "memorial" };
      }
      if (l.state !== "closed") {
        const live = week.pitches.filter((p) => p.lesson_id === l.id && LIVE_PITCH.has(p.state)).sort((a, b) => a.id - b.id);
        const names = live.map((p) => speakers.get(approachById.get(p.approach_id)?.speaker_id ?? -1)).filter((s) => !!s).map((s) => displayName(s!));
        const handlers = [...new Set(live.flatMap((p) => [approachById.get(p.approach_id)?.owner_member_id, p.proposed_by]).filter((m): m is number => m != null))];
        return {
          ...base,
          speakerId: null,
          handlers,
          speaker: names.length ? `טרם נסגר · מועמדים: ${names.join(", ")}` : "טרם נסגר",
          title: l.title ?? "TBD",
          sources: "",
          payment: "",
          escort: "",
          confirmed: "",
          stage: "draft",
        };
      }
      const leads = week.lessonSpeakers.filter((x) => x.lesson_id === l.id).sort((a, b) => Number(a.role !== "lead") - Number(b.role !== "lead"));
      const lead = leads[0] ? speakers.get(leads[0].speaker_id) : undefined;
      const owner = lead ? approachBySpeaker.get(lead.id)?.owner_member_id : null;
      const req = requestText(l);
      const payment = req == null ? "לא התבקשו" : `${req} · ${l.approval === "approved" && l.pay_amount != null ? (l.paid_at ? "אושר · שולם" : "אושר · טרם שולם") : APPROVAL_LABEL[l.approval]}`;
      const escortName = l.escort_roster_id != null ? roster.get(l.escort_roster_id) ?? "מלווה" : null;
      const escort = escortName ? (l.self_intro ? `${escortName} · הצגה עצמית` : escortName) : l.self_intro ? "הצגה עצמית" : "חסר/ה";
      const confirmed = l.needs_reconfirm
        ? "לעדכן (השיעור השתנה אחרי ההודעה)"
        : l.confirm_sent_at
          ? `${(l.confirm_sent_by != null && team.get(l.confirm_sent_by)) || "חבר/ת צוות"} · ${israelDate(l.confirm_sent_at)}`
          : "לעדכן";
      return {
        ...base,
        speakerId: lead?.id ?? null,
        handlers: owner != null ? [owner] : [],
        speaker: leads.map((x) => speakers.get(x.speaker_id)).filter((s) => !!s).map((s) => displayName(s!)).join(" · "),
        title: l.title ?? "TBD",
        sources: l.print_when === "none" ? SOURCES_LABEL[l.sources_kind] : `${SOURCES_LABEL[l.sources_kind]} · ${PRINT_WHEN_LABEL[l.print_when]}`,
        payment,
        escort,
        confirmed,
        stage: nextLessonStep(l, readerFilesOf(week, l.id)) ?? "ready",
      };
    });
}

export interface TrackingFilter {
  day: Day | null;
  stage: TrackingStage | null;
  /** «שלי»: only the lessons this member handles (null = everyone's). */
  mine: number | null;
}

export function filterTracking(rows: TrackingRow[], f: TrackingFilter): TrackingRow[] {
  return rows.filter((r) => (f.day == null || r.day === f.day) && (f.stage == null || r.stage === f.stage) && (f.mine == null || r.handlers.includes(f.mine)));
}

export const TRACKING_HEADERS = ["מרצה", "יום ושעה", "כותרת", "נושא", "מקורות", "הסעה/תשלום", "מלווה", "קיבל הודעת סיכום מ"] as const;

/**
 * The columns' widths, in characters: the xlsx's, and the screen's and the printed table's proportions (one
 * layout for every day). With phones, טלפון after מרצה. A printed xlsx is fitted to the page's width.
 */
export function trackingWidths(withPhone: boolean): number[] {
  const w = [24, 20, 26, 16, 22, 26, 18, 22];
  if (withPhone) w.splice(1, 0, 18);
  return w;
}

/**
 * A phone as a file's cell writes it: a LEFT-TO-RIGHT MARK first, so a spreadsheet opening the CSV keeps it
 * text («0501…» does not lose its zero to a number) and lays it out left to right. Empty stays empty.
 */
export function phoneCell(phone: string | undefined): string {
  return phone ? `${LRM}${phone}` : "";
}

/**
 * The table the CSV and the xlsx write. `phones` (lesson id → phone) adds a טלפון column after מרצה — pass it
 * only when the caller asked for phones, and only with the phones get_contacts_for returned (the ones the
 * caller may see); every other row's cell stays empty.
 */
export function trackingTable(rows: TrackingRow[], editionLabel: string, phones?: ReadonlyMap<number, string>): Table {
  const withPhone = phones != null;
  const headers: string[] = [...TRACKING_HEADERS];
  if (withPhone) headers.splice(1, 0, "טלפון");
  return {
    name: `טבלת מעקב ${editionLabel}`,
    headers,
    widths: trackingWidths(withPhone),
    landscape: true,
    fills: rows.map((r) => PROGRESS_FILL[r.tone]),
    rows: rows.map((r) => {
      const cells = [r.speaker, whenCell(r), r.title, r.category, r.sources, r.payment, r.escort, r.confirmed];
      if (withPhone) cells.splice(1, 0, phoneCell(phones.get(r.lesson.id)));
      return cells;
    }),
  };
}
