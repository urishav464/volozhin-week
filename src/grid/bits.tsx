// Small shared pieces of the grid's look.
import type { ReactNode } from "react";
import type { Gender, Lesson } from "../domain/types";

export function GenderDot({ gender, className = "" }: { gender: Gender | null; className?: string }) {
  const color = gender === "f" ? "bg-pink-400" : gender === "m" ? "bg-sky-500" : "bg-ink-faint";
  const label = gender === "f" ? "אישה" : gender === "m" ? "גבר" : "מגדר לא ידוע";
  return <span role="img" aria-label={label} title={label} className={`inline-block size-2 rounded-full shrink-0 ${color} ${className}`} />;
}

export function Chip({ children, tone = "plain", title }: { children: ReactNode; tone?: "plain" | "warn" | "bad" | "ok" | "info"; title?: string }) {
  const tones = {
    plain: "bg-paper border-line text-ink-soft",
    warn: "bg-amber-50 border-amber-300 text-amber-900",
    bad: "bg-red-50 border-red-300 text-red-800",
    ok: "bg-emerald-50 border-emerald-300 text-emerald-900",
    info: "bg-sky-50 border-sky-200 text-sky-900",
  };
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

export type StageState = "done" | "open" | "waiting" | "problem" | "na";

export interface Stage {
  key: string;
  label: string;
  state: StageState;
  note: string;
}

/** The five steps after a lesson closes: payment/transport · message · escort · sources · reader. */
export function stagesOf(l: Lesson): Stage[] {
  const pay: Stage = (() => {
    const needed = l.pay_amount != null || l.transport !== "none";
    if (!needed) return { key: "pay", label: "תשלום/הסעה", state: "na", note: "לא נדרש" };
    if (l.approval === "approved") return { key: "pay", label: "תשלום/הסעה", state: "done", note: "אושר" };
    if (l.approval === "rejected") return { key: "pay", label: "תשלום/הסעה", state: "problem", note: "נדחה" };
    return { key: "pay", label: "תשלום/הסעה", state: "waiting", note: "ממתין למדריך/ה" };
  })();
  const msg: Stage = l.needs_reconfirm
    ? { key: "msg", label: "הודעת סיכום", state: "problem", note: "השיעור הוזז — לעדכן את המרצה" }
    : l.confirm_sent_at
      ? { key: "msg", label: "הודעת סיכום", state: "done", note: "נשלחה" }
      : { key: "msg", label: "הודעת סיכום", state: pay.state === "waiting" ? "waiting" : "open", note: "טרם נשלחה" };
  const escort: Stage =
    l.escort_roster_id != null || l.self_intro
      ? { key: "escort", label: "מלווה", state: "done", note: l.self_intro ? "הצגה עצמית" : "שובץ/ה" }
      : { key: "escort", label: "מלווה", state: "open", note: "חסר/ה" };
  const sources: Stage =
    l.sources_kind === "pending"
      ? { key: "sources", label: "מקורות", state: "open", note: "טרם התקבלו" }
      : { key: "sources", label: "מקורות", state: "done", note: l.sources_kind === "none" ? "ללא מקורות" : "התקבלו" };
  const reader: Stage =
    l.sources_kind === "none" || l.sources_kind === "presentation"
      ? { key: "reader", label: "מקראה", state: "na", note: "לא נכנס למקראה" }
      : l.in_reader
        ? { key: "reader", label: "מקראה", state: "done", note: "במקראה" }
        : { key: "reader", label: "מקראה", state: "open", note: "טרם נכנס" };
  return [pay, msg, escort, sources, reader];
}

const DOT: Record<StageState, string> = {
  done: "bg-ok border-ok",
  open: "bg-transparent border-ink-faint",
  waiting: "bg-warn border-warn",
  problem: "bg-bad border-bad",
  na: "bg-line border-line",
};

export function StageDots({ lesson }: { lesson: Lesson }) {
  const stages = stagesOf(lesson);
  return (
    <span className="inline-flex gap-1" aria-label={stages.map((s) => `${s.label}: ${s.note}`).join(", ")}>
      {stages.map((s) => (
        <span key={s.key} title={`${s.label}: ${s.note}`} className={`size-2 rounded-full border ${DOT[s.state]}`} />
      ))}
    </span>
  );
}

export function Initials({ name }: { name: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return <span className="inline-grid place-items-center size-5 rounded-full bg-ink text-paper text-[10px] font-semibold">{letters || "?"}</span>;
}
