// «מוצ״ש» — the preparations from Saturday night to Sunday («מוצ"ש–ראשון»), as two lists since v19: «משימות» (a
// numbered list — the number is the place in it —, a group for each task or none yet, «בוצע») and «רשימת קניות» (each
// item, its quantity as typed, «נקנה» — the row's `done`). Each list has its own count, its own order changed by
// «למעלה» / «למטה» (prepMoves: the two lists share the edition's numbering, so a move writes only the two rows that
// change places) and its own paste: «הדבקת רשימה» takes last year's numbered list as pasted — the numbering taken off,
// empty lines dropped, a phone or an e-mail refusing the paste (parsePrepList); «הדבקת רשימת קניות» the same, each line
// split at its first tab into the item and its quantity (parsePrepItems, a spreadsheet's two columns). A pasted list
// goes after the last row, in its order, in ONE insert. Both lists carry over to next year's edition (start_edition:
// the texts, the quantities and their order — no group, not done or bought).
import { type FormEvent, useId, useState } from "react";
import { CommandError } from "../../../data/commands";
import { parsePrepItems, parsePrepList, type PrepKind, type RotaPrepTask } from "../../../data/rota";
import { errorMessage } from "../../../errors";
import { groupsInOrder, prepInOrder } from "../../../exports/rota";
import { Button, Confirm, Fold, INPUT, useFocusBack } from "../../settings/kit";
import { CARD, codeById, formRefusal, Problem, type RotaCtx } from "./parts";
import { prepMoves } from "./prep";

/** Each list's words: what one row is called, its count, its tick. */
const WORDS = {
  task: {
    title: "משימות",
    one: "משימה",
    listLabel: "המשימות",
    count: (done: number, n: number) => `בוצעו ${done} מתוך ${n}`,
    empty: "עוד אין משימות. אפשר להדביק את הרשימה של אשתקד.",
    tick: "בוצע",
    newLabel: "משימה חדשה",
    required: "צריך לכתוב את המשימה.",
    added: "המשימה נוספה",
    saved: "המשימה נשמרה",
    deleted: "המשימה נמחקה",
  },
  item: {
    title: "רשימת קניות",
    one: "פריט",
    listLabel: "רשימת הקניות",
    count: (done: number, n: number) => `נקנו ${done} מתוך ${n}`,
    empty: "עוד אין פריטים ברשימת הקניות.",
    tick: "נקנה",
    newLabel: "פריט חדש",
    required: "צריך לכתוב את הפריט.",
    added: "הפריט נוסף",
    saved: "הפריט נשמר",
    deleted: "הפריט נמחק",
  },
} as const;

/** A quantity's refusal, said beside its form. */
const QTY_WORDS = { bad_value: "הכמות ארוכה מדי: עד 40 תווים." };

export function PrepTasks({ ctx }: { ctx: RotaCtx }) {
  return (
    <div className="space-y-4">
      <h3 className="font-display text-lg font-bold text-navy">הכנות מוצ״ש–ראשון</h3>
      <PrepList ctx={ctx} kind="task" />
      <PrepList ctx={ctx} kind="item" />
    </div>
  );
}

function PrepList({ ctx, kind }: { ctx: RotaCtx; kind: PrepKind }) {
  const { port, week, data, busy, act, mayWrite } = ctx;
  const w = WORDS[kind];
  const id = useId();
  const focus = useFocusBack();
  const rows = prepInOrder(data, kind);
  const groups = groupsInOrder(data);
  const [text, setText] = useState("");
  const [qty, setQty] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const done = rows.filter((t) => t.done).length;
  const k = (s: string) => `${kind}-${s}`;

  /** «למעלה» / «למטה»: only the rows whose number changed are written (prepMoves). */
  const move = async (t: RotaPrepTask, by: -1 | 1, key: string) => {
    const changes = prepMoves(rows, t.id, by);
    if (changes.length === 0) return;
    await act(
      key,
      async () => {
        for (const c of changes) await port.rota.updatePrepTask(c.id, { sort: c.sort });
      },
      null,
    );
    focus.back(key);
  };

  const add = (ev: FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    const row = kind === "item" ? { text, qty: qty.trim() ? qty : null } : text;
    void act(k("new"), () => port.rota.addPrepTasks(week.edition.id, [row], kind), w.added, formRefusal(setProblem, { name_required: w.required, ...(kind === "item" ? QTY_WORDS : {}) })).then((ok) => {
      if (!ok) return;
      setText("");
      setQty("");
    });
  };

  return (
    <section aria-labelledby={`${id}-title`} data-prep-list={kind} className={`${CARD} space-y-3 sm:p-4`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 id={`${id}-title`} className="font-display text-lg font-bold text-navy">
          {w.title}
        </h4>
        {rows.length > 0 && (
          <span data-prep-count data-prep-done={kind === "task" ? "" : undefined} className="text-sm text-ink-soft">
            {w.count(done, rows.length)}
          </span>
        )}
      </div>
      {rows.length === 0 && <p className="text-sm text-ink-soft">{w.empty}</p>}
      <ol aria-label={w.listLabel} className="divide-y divide-sage/60">
        {rows.map((t, i) => {
          const n = i + 1;
          const name = `${w.one} ${n}`;
          if (editing === t.id) {
            return (
              <li key={t.id} className="py-2">
                <PrepEdit
                  kind={kind}
                  name={name}
                  initial={t}
                  busy={busy === k(`edit-${t.id}`)}
                  onCancel={() => setEditing(null)}
                  onSave={async (v, refused) => {
                    if (await act(k(`edit-${t.id}`), () => port.rota.updatePrepTask(t.id, kind === "item" ? { text: v.text, qty: v.qty } : { text: v.text }), w.saved, refused)) setEditing(null);
                  }}
                />
              </li>
            );
          }
          return (
            <li key={t.id} {...(kind === "task" ? { "data-prep": n } : { "data-prep-item": n })} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="w-7 shrink-0 text-end font-bold text-navy tabular-nums">{n}.</span>
              <span className={`min-w-0 flex-1 basis-48 break-words ${t.done ? "text-ink-soft line-through" : ""}`}>
                {t.text}
                {kind === "item" && t.qty != null && (
                  <span data-qty={t.qty} className="ms-2 text-sm text-ink-soft">
                    · כמות: {t.qty}
                  </span>
                )}
              </span>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {kind === "task" &&
                  (mayWrite ? (
                    <select
                      aria-label={`קבוצה: ${name}`}
                      value={t.group_id ?? ""}
                      onChange={(ev) => void act(`prep-group-${t.id}`, () => port.rota.updatePrepTask(t.id, { group_id: ev.target.value ? Number(ev.target.value) : null }), null)}
                      className="min-h-11 rounded-lg border border-line bg-card px-2 text-sm"
                    >
                      <option value="">בלי קבוצה</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {codeById(data, g.id)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-sm text-ink-soft">{t.group_id != null ? codeById(data, t.group_id) : "בלי קבוצה"}</span>
                  ))}
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-navy"
                    checked={t.done}
                    disabled={!mayWrite}
                    onChange={(ev) => void act(`prep-done-${t.id}`, () => port.rota.updatePrepTask(t.id, { done: ev.target.checked }), null)}
                    aria-label={`${w.tick}: ${name}`}
                  />
                  {w.tick}
                </label>
                {mayWrite && deleting !== t.id && (
                  <>
                    <Button kind="quiet" keepFocus disabled={i === 0} ref={focus.ref(`up-${t.id}`)} busy={busy === `up-${t.id}`} onClick={() => void move(t, -1, `up-${t.id}`)} aria-label={`הזזה למעלה: ${name}`}>
                      למעלה
                    </Button>
                    <Button kind="quiet" keepFocus disabled={i === rows.length - 1} ref={focus.ref(`down-${t.id}`)} busy={busy === `down-${t.id}`} onClick={() => void move(t, 1, `down-${t.id}`)} aria-label={`הזזה למטה: ${name}`}>
                      למטה
                    </Button>
                    <Button kind="quiet" onClick={() => setEditing(t.id)} aria-label={`עריכה: ${name}`}>
                      עריכה
                    </Button>
                    <Button kind="danger" ref={focus.ref(`delete-${t.id}`)} onClick={() => setDeleting(t.id)} aria-label={`מחיקה: ${name}`}>
                      מחיקה
                    </Button>
                  </>
                )}
              </div>
              {deleting === t.id && (
                <div className="basis-full">
                  <Confirm
                    text={<>למחוק את {name}?</>}
                    confirm="מחיקה"
                    busy={busy === `delete-prep-${t.id}`}
                    onConfirm={() =>
                      void act(`delete-prep-${t.id}`, () => port.rota.deletePrepTask(t.id), w.deleted).then((ok) => {
                        setDeleting(null);
                        if (!ok) focus.back(`delete-${t.id}`);
                      })
                    }
                    onCancel={() => {
                      setDeleting(null);
                      focus.back(`delete-${t.id}`);
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {mayWrite && (
        <>
          <form aria-label={w.newLabel} onSubmit={add} className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 basis-56">
              <label htmlFor={`${id}-new`} className="mb-1 block text-sm font-bold text-ink">
                {w.newLabel}
              </label>
              <input id={`${id}-new`} value={text} onChange={(ev) => setText(ev.target.value)} maxLength={200} className={INPUT} />
            </div>
            {kind === "item" && (
              <div className="w-36 min-w-0 shrink-0">
                <label htmlFor={`${id}-qty`} className="mb-1 block text-sm font-bold text-ink">
                  כמות
                </label>
                <input id={`${id}-qty`} value={qty} onChange={(ev) => setQty(ev.target.value)} maxLength={40} className={INPUT} />
              </div>
            )}
            <Button kind="primary" type="submit" busy={busy === k("new")}>
              הוספה
            </Button>
          </form>
          <Problem>{problem}</Problem>
          <Paste ctx={ctx} kind={kind} />
        </>
      )}
    </section>
  );
}

function PrepEdit({ kind, name, initial, busy, onSave, onCancel }: {
  kind: PrepKind;
  name: string;
  initial: Pick<RotaPrepTask, "text" | "qty">;
  busy: boolean;
  onSave: (v: { text: string; qty: string | null }, refused: (code: string | null) => boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const w = WORDS[kind];
  const [text, setText] = useState(initial.text);
  const [qty, setQty] = useState(initial.qty ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      aria-label={`עריכת ${name}`}
      onSubmit={(ev) => {
        ev.preventDefault();
        setProblem(null);
        void onSave({ text, qty: qty.trim() ? qty : null }, formRefusal(setProblem, { name_required: w.required, ...(kind === "item" ? QTY_WORDS : {}) }));
      }}
      className="space-y-2 rounded-lg bg-sand-soft p-3"
    >
      <label htmlFor={`${id}-text`} className="block text-sm font-bold text-ink">
        {name}
      </label>
      <input id={`${id}-text`} value={text} onChange={(ev) => setText(ev.target.value)} maxLength={200} className={INPUT} />
      {kind === "item" && (
        <>
          <label htmlFor={`${id}-qty`} className="block text-sm font-bold text-ink">
            כמות
          </label>
          <input id={`${id}-qty`} value={qty} onChange={(ev) => setQty(ev.target.value)} maxLength={40} className={`${INPUT} max-w-60`} />
        </>
      )}
      <Problem>{problem}</Problem>
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" type="submit" busy={busy}>
          שמירה
        </Button>
        <Button onClick={onCancel}>ביטול</Button>
      </div>
    </form>
  );
}

/** «כמה יתווספו», in each list's words. */
function countWords(kind: PrepKind, n: number): { preview: string; done: string } {
  if (kind === "task") return n === 1 ? { preview: "תתווסף משימה אחת, אחרי האחרונה.", done: "נוספה משימה אחת" } : { preview: `יתווספו ${n} משימות, אחרי האחרונה.`, done: `נוספו ${n} משימות` };
  return n === 1 ? { preview: "יתווסף פריט אחד, אחרי האחרון.", done: "נוסף פריט אחד" } : { preview: `יתווספו ${n} פריטים, אחרי האחרון.`, done: `נוספו ${n} פריטים` };
}

/** «הדבקת רשימה» / «הדבקת רשימת קניות»: last year's list as pasted — what will be added is counted before it is. */
function Paste({ ctx, kind }: { ctx: RotaCtx; kind: PrepKind }) {
  const { port, week, busy, act } = ctx;
  const id = useId();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  let parsed: (string | { text: string; qty: string | null })[] | null = null;
  let refused: string | null = null;
  try {
    parsed = text.trim() ? (kind === "item" ? parsePrepItems(text) : parsePrepList(text)) : null;
  } catch (e) {
    const tooLong = kind === "item" ? "הרשימה ארוכה מדי: עד 200 שורות, עד 200 תווים לפריט ועד 40 לכמות." : "הרשימה ארוכה מדי: עד 200 שורות, ועד 200 תווים בשורה.";
    refused = e instanceof CommandError && e.code === "bad_value" ? tooLong : errorMessage(e instanceof CommandError ? e.code : null);
  }
  const key = `paste-${kind}`;
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    if (!parsed || refused) return;
    const list = parsed;
    void act(key, () => port.rota.addPrepTasks(week.edition.id, list, kind), countWords(kind, list.length).done, formRefusal(setProblem)).then((ok) => ok && setText(""));
  };
  const hint =
    kind === "item"
      ? "שורה לכל פריט. את הכמות כותבים אחרי טאב (כמו עמודה שנייה בגיליון). המספור בתחילת השורה יורד, ושורות ריקות לא נספרות. בלי טלפונים ומיילים."
      : "שורה לכל משימה. המספור בתחילת השורה יורד, ושורות ריקות לא נספרות. בלי טלפונים ומיילים.";
  const title = kind === "item" ? "הדבקת רשימת קניות" : "הדבקת רשימה";
  return (
    <Fold title={title} size="sm">
      <form aria-label={title} onSubmit={submit} className="space-y-2">
        <label htmlFor={`${id}-paste`} className="block text-sm text-ink-soft">
          {hint}
        </label>
        <textarea id={`${id}-paste`} value={text} onChange={(ev) => setText(ev.target.value)} rows={6} className={`${INPUT} py-2`} />
        {parsed && !refused && <p className="text-sm text-ink-soft">{countWords(kind, parsed.length).preview}</p>}
        <Problem>{refused ?? problem}</Problem>
        <Button kind="primary" type="submit" keepFocus disabled={!parsed || !!refused} busy={busy === key}>
          {kind === "item" ? "הוספת הפריטים" : "הוספת הרשימה"}
        </Button>
      </form>
    </Fold>
  );
}
