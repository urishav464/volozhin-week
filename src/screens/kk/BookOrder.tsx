// A group's book order — on /kk under its card, and in «לוגיסטיקה ← ספרים».
import { type FormEvent, useEffect, useId, useState } from "react";
import type { KkData, KkGroup } from "../../data/kk";
import { KK_LIMITS } from "../../data/kk";
import type { DataPort } from "../../data/port";
import { israelMoment } from "../../domain/israelTime";
import { errorMessage } from "../../errors";
import { Button, Field, Fold, INPUT } from "../settings/kit";
import type { Act } from "./parts";

/**
 * Copies to order for the group, and whether they were ordered — logistics' and the admins'. Nothing is filled in for them:
 * beside the field, how many signed up and how many lead. A group with no book yet has nothing to order (`no_book`).
 * `folded` (on /kk, where ordering is not the screen's job): the form behind its own read-only line; «לוגיסטיקה ← ספרים»
 * keeps it open.
 */
export function BookOrder({ g, kk, signed, leaders, editable, folded = false, busy, act, port }: { g: KkGroup; kk: KkData; signed: number; leaders: number; editable: boolean; folded?: boolean; busy: string | null; act: Act; port: DataPort }) {
  const id = useId();
  const order = kk.orders.find((o) => o.group_id === g.id) ?? null;
  const [copies, setCopies] = useState(order ? String(order.copies) : "");
  const [ordered, setOrdered] = useState(order?.ordered_at != null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setCopies(order ? String(order.copies) : "");
    setOrdered(order?.ordered_at != null);
  }, [order?.copies, order?.ordered_at]);
  const line = `ספרים: ${order ? `${order.copies} עותקים${order.ordered_at ? ` · הוזמנו ב-${israelMoment(order.ordered_at)}` : " · עוד לא הוזמנו"}` : "עוד לא נקבע כמה להזמין"}`;
  if (g.title == null && !order) return <p className="text-sm text-ink-soft">ספרים: {errorMessage("no_book")}</p>;
  if (!editable) return <p className="text-sm text-ink-soft">{line}</p>;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const t = copies.trim();
    const n = t === "" ? null : Number(t);
    if (n != null && (!Number.isInteger(n) || n < 0 || n > KK_LIMITS.copies)) return setProblem(`מספר עותקים שלם, בין 0 ל-${KK_LIMITS.copies}.`);
    if (n == null && ordered) return setProblem("כדי לסמן «הוזמן» צריך לכתוב כמה עותקים.");
    await act(`books-${g.id}`, () => port.kk.setBookOrder(g.id, n, ordered), n == null ? "שורת הספרים נמחקה" : "הזמנת הספרים נשמרה", (code) => {
      if (code !== "no_book") return false;
      setProblem(errorMessage(code));
      return true;
    });
  };
  const dirty = (order ? String(order.copies) : "") !== copies.trim() || (order?.ordered_at != null) !== ordered;
  const form = (
    <form onSubmit={(e) => void save(e)} aria-label={`ספרים · ${g.title ?? "עוד לא נבחר ספר"}`} className="flex flex-wrap items-end gap-2" noValidate>
      <Field id={`${id}-n`} label="עותקים להזמנה" hint={`נרשמו ${signed} · מעבירים ${leaders}`}>
        <input id={`${id}-n`} type="number" inputMode="numeric" min={0} max={KK_LIMITS.copies} value={copies} onChange={(e) => setCopies(e.target.value)} className={`${INPUT} w-28`} aria-describedby={`${id}-n-hint`} />
      </Field>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={ordered} onChange={(e) => setOrdered(e.target.checked)} className="size-5 accent-ink" />
        הוזמן
        {order?.ordered_at && <span className="text-xs text-ink-soft">({israelMoment(order.ordered_at)})</span>}
      </label>
      {/* saved, nothing is left to save: inactive, and still where the keyboard is (logistics saves one row after another) */}
      <Button type="submit" disabled={!dirty} keepFocus busy={busy === `books-${g.id}`} busyLabel="שומר…">
        שמירה
      </Button>
      {problem && (
        <p role="alert" className="w-full text-sm text-bad">
          {problem}
        </p>
      )}
    </form>
  );
  return folded ? (
    <Fold title={line} size="sm">
      {form}
    </Fold>
  ) : (
    form
  );
}
