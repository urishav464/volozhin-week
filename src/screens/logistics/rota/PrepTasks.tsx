// «מוצ״ש» — the preparations from Saturday night to Sunday («מוצ"ש–ראשון»): a numbered list (the number is the place in
// it), a group for each task (or none yet), «בוצע», and the order changed by «למעלה» / «למטה». «הדבקת רשימה» takes last
// year's numbered list as pasted: the numbering taken off, empty lines dropped, a phone or an e-mail refusing the paste
// (parsePrepList). A pasted list goes after the last task, in its order. The list carries over to next year's edition
// (start_edition: the texts and their order, no group, not done).
import { type FormEvent, useId, useState } from "react";
import { CommandError } from "../../../data/commands";
import { parsePrepList, type RotaPrepTask } from "../../../data/rota";
import { errorMessage } from "../../../errors";
import { groupsInOrder } from "../../../exports/rota";
import { Button, Confirm, Fold, INPUT, useFocusBack } from "../../settings/kit";
import { CARD, codeById, formRefusal, Problem, type RotaCtx } from "./parts";

const ordered = (prep: readonly RotaPrepTask[]) => [...prep].sort((a, b) => a.sort - b.sort || a.id - b.id);

export function PrepTasks({ ctx }: { ctx: RotaCtx }) {
  const { port, week, data, busy, act, mayWrite } = ctx;
  const id = useId();
  const focus = useFocusBack();
  const tasks = ordered(data.prep);
  const groups = groupsInOrder(data);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const done = tasks.filter((t) => t.done).length;

  /** «למעלה» / «למטה»: the list numbered again in its new order — only the tasks whose place changed are written. */
  const move = async (t: RotaPrepTask, by: -1 | 1, key: string) => {
    const list = [...tasks];
    const i = list.findIndex((x) => x.id === t.id);
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const changes = list.map((x, k) => [x, k + 1] as const).filter(([x, sort]) => x.sort !== sort);
    await act(
      key,
      async () => {
        for (const [x, sort] of changes) await port.rota.updatePrepTask(x.id, { sort });
      },
      null,
    );
    focus.back(key);
  };

  const add = (ev: FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    void act("prep-new", () => port.rota.addPrepTasks(week.edition.id, [text]), "המשימה נוספה", formRefusal(setProblem, { name_required: "צריך לכתוב את המשימה." })).then((ok) => ok && setText(""));
  };

  return (
    <section aria-labelledby={`${id}-title`} className={`${CARD} space-y-3 sm:p-4`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={`${id}-title`} className="font-display text-lg font-bold text-navy">
          הכנות מוצ״ש–ראשון
        </h3>
        {tasks.length > 0 && (
          <span data-prep-done className="text-sm text-ink-soft">
            בוצעו {done} מתוך {tasks.length}
          </span>
        )}
      </div>
      {tasks.length === 0 && <p className="text-sm text-ink-soft">עוד אין משימות. אפשר להדביק את הרשימה של אשתקד.</p>}
      <ol aria-label="המשימות" className="divide-y divide-sage/60">
        {tasks.map((t, i) => {
          const n = i + 1;
          if (editing === t.id) {
            return (
              <li key={t.id} className="py-2">
                <PrepEdit
                  n={n}
                  initial={t.text}
                  busy={busy === `prep-${t.id}`}
                  onCancel={() => setEditing(null)}
                  onSave={async (v, refused) => {
                    if (await act(`prep-${t.id}`, () => port.rota.updatePrepTask(t.id, { text: v }), "המשימה נשמרה", refused)) setEditing(null);
                  }}
                />
              </li>
            );
          }
          return (
            <li key={t.id} data-prep={n} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="w-7 shrink-0 text-end font-bold text-navy tabular-nums">{n}.</span>
              <span className={`min-w-0 flex-1 basis-48 break-words ${t.done ? "text-ink-soft line-through" : ""}`}>{t.text}</span>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {mayWrite ? (
                  <select
                    aria-label={`קבוצה: משימה ${n}`}
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
                )}
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-navy"
                    checked={t.done}
                    disabled={!mayWrite}
                    onChange={(ev) => void act(`prep-done-${t.id}`, () => port.rota.updatePrepTask(t.id, { done: ev.target.checked }), null)}
                    aria-label={`בוצע: משימה ${n}`}
                  />
                  בוצע
                </label>
                {mayWrite && deleting !== t.id && (
                  <>
                    <Button kind="quiet" keepFocus disabled={i === 0} ref={focus.ref(`up-${t.id}`)} busy={busy === `up-${t.id}`} onClick={() => void move(t, -1, `up-${t.id}`)} aria-label={`הזזה למעלה: משימה ${n}`}>
                      למעלה
                    </Button>
                    <Button kind="quiet" keepFocus disabled={i === tasks.length - 1} ref={focus.ref(`down-${t.id}`)} busy={busy === `down-${t.id}`} onClick={() => void move(t, 1, `down-${t.id}`)} aria-label={`הזזה למטה: משימה ${n}`}>
                      למטה
                    </Button>
                    <Button kind="quiet" onClick={() => setEditing(t.id)} aria-label={`עריכה: משימה ${n}`}>
                      עריכה
                    </Button>
                    <Button kind="danger" ref={focus.ref(`delete-${t.id}`)} onClick={() => setDeleting(t.id)} aria-label={`מחיקה: משימה ${n}`}>
                      מחיקה
                    </Button>
                  </>
                )}
              </div>
              {deleting === t.id && (
                <div className="basis-full">
                  <Confirm
                    text={<>למחוק את משימה {n}?</>}
                    confirm="מחיקה"
                    busy={busy === `delete-prep-${t.id}`}
                    onConfirm={() =>
                      void act(`delete-prep-${t.id}`, () => port.rota.deletePrepTask(t.id), "המשימה נמחקה").then((ok) => {
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
          <form aria-label="משימה חדשה" onSubmit={add} className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 basis-56">
              <label htmlFor={`${id}-new`} className="mb-1 block text-sm font-bold text-ink">
                משימה חדשה
              </label>
              <input id={`${id}-new`} value={text} onChange={(ev) => setText(ev.target.value)} maxLength={200} className={INPUT} />
            </div>
            <Button kind="primary" type="submit" busy={busy === "prep-new"}>
              הוספה
            </Button>
          </form>
          <Problem>{problem}</Problem>
          <Paste ctx={ctx} />
        </>
      )}
    </section>
  );
}

function PrepEdit({ n, initial, busy, onSave, onCancel }: { n: number; initial: string; busy: boolean; onSave: (v: string, refused: (code: string | null) => boolean) => Promise<void>; onCancel: () => void }) {
  const id = useId();
  const [text, setText] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      aria-label={`עריכת משימה ${n}`}
      onSubmit={(ev) => {
        ev.preventDefault();
        setProblem(null);
        void onSave(text, formRefusal(setProblem, { name_required: "צריך לכתוב את המשימה." }));
      }}
      className="space-y-2 rounded-lg bg-sand-soft p-3"
    >
      <label htmlFor={`${id}-text`} className="block text-sm font-bold text-ink">
        משימה {n}
      </label>
      <input id={`${id}-text`} value={text} onChange={(ev) => setText(ev.target.value)} maxLength={200} className={INPUT} />
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

/** «הדבקת רשימה»: last year's numbered list as pasted — what will be added is counted before it is. */
function Paste({ ctx }: { ctx: RotaCtx }) {
  const { port, week, busy, act } = ctx;
  const id = useId();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  let parsed: string[] | null = null;
  let refused: string | null = null;
  try {
    parsed = text.trim() ? parsePrepList(text) : null;
  } catch (e) {
    refused = e instanceof CommandError && e.code === "bad_value" ? "הרשימה ארוכה מדי: עד 200 שורות, ועד 200 תווים בשורה." : errorMessage(e instanceof CommandError ? e.code : null);
  }
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    if (!parsed || refused) return;
    const list = parsed;
    void act("paste", () => port.rota.addPrepTasks(week.edition.id, list), list.length === 1 ? "נוספה משימה אחת" : `נוספו ${list.length} משימות`, formRefusal(setProblem)).then((ok) => ok && setText(""));
  };
  return (
    <Fold title="הדבקת רשימה" size="sm">
      <form aria-label="הדבקת רשימה" onSubmit={submit} className="space-y-2">
        <label htmlFor={`${id}-paste`} className="block text-sm text-ink-soft">
          שורה לכל משימה. המספור בתחילת השורה יורד, ושורות ריקות לא נספרות. בלי טלפונים ומיילים.
        </label>
        <textarea id={`${id}-paste`} value={text} onChange={(ev) => setText(ev.target.value)} rows={6} className={`${INPUT} py-2`} />
        {parsed && !refused && <p className="text-sm text-ink-soft">{parsed.length === 1 ? "תתווסף משימה אחת" : `יתווספו ${parsed.length} משימות`}, אחרי האחרונה.</p>}
        <Problem>{refused ?? problem}</Problem>
        <Button kind="primary" type="submit" keepFocus disabled={!parsed || !!refused} busy={busy === "paste"}>
          הוספת הרשימה
        </Button>
      </form>
    </Fold>
  );
}
