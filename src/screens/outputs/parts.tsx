// What the outputs' screens share: the row of outputs under the title, the
// «כולל טלפונים» rule and its one batch call, the colours' legend, and the
// print setup. Phones are personal data: hidden by default, offered only to
// whoever may see some contacts at all (a global admin, or a handler in a live
// real edition — app.may_see_contacts), and then only the rows the database
// returns (get_contacts_for, under the contacts policy).
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router";
import type { LessonPhone } from "../../data/outputs";
import type { DataPort } from "../../data/port";
import { PROGRESS_LABEL, PROGRESS_TONE, type ProgressTone } from "../../domain/progress";
import type { Week } from "../../domain/types";
import type { Actor } from "../weekStore";

/** May this member see any speaker's contacts here? Only then is «כולל טלפונים» offered. */
export function maySeeSomeContacts(actor: Actor, week: Week): boolean {
  if (actor.global) return true;
  const e = week.edition;
  if (e.kind !== "real" || e.status === "archived" || actor.role === "logistics") return false;
  return week.approaches.some((a) => a.owner_member_id === actor.memberId);
}

/**
 * «כולל טלפונים» and the phones it shows. The choice belongs to one edition: choosing another one in
 * EditionSelect turns it off, so phones are always off in a newly chosen edition — and it is on only while
 * it is offered (maySeeSomeContacts: never in a practice week, never to logistics), so it can never stay on
 * where its switch is hidden. The phones come in one call per edition and set of closed lessons: a Realtime
 * update that leaves those alone keeps the answer, and a new answer replaces the old one only once it
 * arrives (the טלפון column does not blink, a file downloaded meanwhile keeps it). Only the closed lessons'
 * lead speakers' phones are shown.
 */
export function usePhones(
  port: DataPort,
  week: Week | null,
  actor: Actor,
): { on: boolean; setOn: (v: boolean) => void; phones: Map<number, string> | null; failed: boolean } {
  const editionId = week?.edition.id ?? null;
  const [choice, setChoice] = useState<{ edition: number | null; on: boolean }>({ edition: editionId, on: false });
  // another edition: off again — also when coming back (React's «state from the previous render» pattern;
  // this render already reads it as off, so nothing is fetched for the new edition first)
  if (choice.edition !== editionId) setChoice({ edition: editionId, on: false });
  const on = week != null && choice.on && choice.edition === editionId && maySeeSomeContacts(actor, week);
  const setOn = useCallback((v: boolean) => setChoice({ edition: editionId, on: v }), [editionId]);
  const closedIds = useMemo(() => (week ? week.lessons.filter((l) => l.state === "closed").map((l) => l.id) : []), [week]);
  const key = closedIds.join(",");
  const [answer, setAnswer] = useState<{ edition: number; rows: LessonPhone[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (!on || editionId == null) {
      setAnswer(null);
      return;
    }
    let live = true;
    port.outputs.phones(editionId, key === "" ? [] : key.split(",").map(Number)).then(
      (rows) => live && setAnswer({ edition: editionId, rows }),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [port, editionId, on, key]);
  const phones = useMemo(() => {
    if (!on || !week || answer?.edition !== editionId) return null;
    const closed = new Set(closedIds);
    const lead = new Map(week.lessonSpeakers.filter((x) => x.role === "lead").map((x) => [x.lesson_id, x.speaker_id]));
    return new Map(answer.rows.filter((r) => closed.has(r.lesson_id) && lead.get(r.lesson_id) === r.speaker_id).map((r) => [r.lesson_id, r.phone]));
  }, [on, week, answer, editionId, closedIds]);
  return { on, setOn, phones, failed };
}

/** The outputs, under the screen's title: a link each (the designer's export for the edition's admins only; the reader for content and admins). */
export function OutputsTabs({ admin, reader = false }: { admin: boolean; reader?: boolean }) {
  const items = [
    { to: "/tracking", label: "טבלת מעקב" },
    { to: "/print/escorts", label: "רשימת מלווים" },
    ...(reader || admin ? [{ to: "/reader", label: "מקראה" }] : []),
    ...(admin ? [{ to: "/export/designer", label: "ייצוא למעצבת" }] : []),
  ];
  return (
    <nav aria-label="תוצרים" className="flex flex-wrap gap-1 print:hidden">
      {items.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          className={({ isActive }) =>
            `inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold ${isActive ? "bg-ink text-paper" : "border border-line bg-card text-ink hover:bg-line/50"}`
          }
        >
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** «כולל טלפונים» — only for whoever may see contacts, with what it shows and that it is personal data. */
export function PhonesToggle({ actor, week, on, setOn, failed }: { actor: Actor; week: Week; on: boolean; setOn: (v: boolean) => void; failed: boolean }) {
  if (!maySeeSomeContacts(actor, week)) return null;
  return (
    <div className="min-w-0">
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="size-4 accent-ink" />
        כולל טלפונים
      </label>
      {on && (
        <p className="text-xs text-ink-soft">
          {actor.global ? "הטלפונים של כל המרצים שיש להם טלפון במערכת." : "רק הטלפונים של המרצים שבטיפולך."} זה מידע אישי: לא משתפים דף או קובץ עם טלפונים, ומוחקים אותו כשמסיימים.
        </p>
      )}
      {failed && (
        <p role="alert" className="text-xs text-bad">
          לא הצלחנו לטעון את הטלפונים. אפשר לנסות שוב.
        </p>
      )}
    </div>
  );
}

/** Last year's colours, with their names (for whoever reads them without the colour). */
export function ToneLegend({ tones }: { tones: ProgressTone[] }) {
  return (
    <ul aria-label="מקרא הצבעים" className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-soft">
      {tones.map((t) => (
        <li key={t} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`size-3 rounded border border-line ${PROGRESS_TONE[t]}`} />
          {PROGRESS_LABEL[t]}
        </li>
      ))}
    </ul>
  );
}

/** The page size while this screen is open — and the title line a printed page carries. */
export function PrintSetup({ landscape, title, children }: { landscape: boolean; title: string; children?: ReactNode }) {
  return (
    <>
      <style media="print">{`@page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 10mm; }`}</style>
      <div className="hidden print:block">
        <p className="text-lg font-bold">{title}</p>
        {children}
      </div>
    </>
  );
}

export const SELECT = "min-h-11 rounded-lg border border-line bg-card px-2 text-base";
