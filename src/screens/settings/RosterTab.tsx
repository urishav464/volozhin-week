// «חניכים» — the year's ~61 trainees, by name only (escorts and מכריכה לכריכה
// will pick from it). They arrive by pasting a column; the preview says what
// is new before anything is saved. No contact detail is ever kept here.
import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import type { RosterEntry } from "../../data/settings";
import { nameKey } from "../../domain/nameKey";
import type { Edition, Gender } from "../../domain/types";
import { errorMessage } from "../../errors";
import { type PasteStatus, parseRosterPaste, pasteColumns, previewPaste } from "../../settings/roster";
import { Badge, Button, Confirm, EditionPicker, Field, GENDER_LABEL, GenderField, INPUT, LoadError, Loading, Panel, Row, Rows, useAction, useSettings } from "./kit";

interface Props {
  editions: Edition[];
  editionId: number | null;
  setEditionId: (id: number) => void;
}

const STATUS: Record<PasteStatus, { label: string; tone: "ok" | "muted" }> = {
  new: { label: "חדש", tone: "ok" },
  exists: { label: "כבר ברשימה", tone: "muted" },
  repeat: { label: "כפול בהדבקה", tone: "muted" },
};

export function RosterTab({ editions, editionId, setEditionId }: Props) {
  const { port } = useSettings();
  const [list, setList] = useState<RosterEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    if (editionId == null) return;
    setFailed(false);
    try {
      setList(await port.roster(editionId));
    } catch {
      setFailed(true);
    }
  }, [port, editionId]);
  useEffect(() => {
    setList(null);
    void load();
  }, [load]);

  if (editions.length === 0) {
    return (
      <Panel title="רשימת החניכים">
        <p className="text-ink-soft">הרשימה שייכת למחזור. קודם פותחים את המחזור של השנה (לשונית «מחזור»).</p>
      </Panel>
    );
  }

  const shown = list?.filter((r) => !filter.trim() || r.name_key.includes(nameKey(filter))) ?? [];
  return (
    <>
      <EditionPicker editions={editions} value={editionId} onChange={setEditionId} />
      {failed ? (
        <LoadError onRetry={() => void load()} />
      ) : !list || editionId == null ? (
        <Loading />
      ) : (
        <>
          <PasteNames key={editionId} editionId={editionId} existing={list} onAdded={load} />
          <Panel title="רשימת החניכים" aside={<span aria-live="polite">{list.length === 1 ? "חניך/ה אחד/ת" : `${list.length} חניכים`}</span>}>
            {list.length === 0 ? (
              <p className="text-ink-soft">הרשימה ריקה. מדביקים את השמות בטופס שלמעלה.</p>
            ) : (
              <>
                {list.length > 8 && (
                  <div className="mb-3 max-w-sm">
                    <label htmlFor="roster-filter" className="sr-only">
                      חיפוש ברשימה
                    </label>
                    <input id="roster-filter" type="search" className={INPUT} placeholder="חיפוש ברשימה" value={filter} onChange={(e) => setFilter(e.target.value)} />
                  </div>
                )}
                <Rows label="רשימת החניכים" head={["שם", "מגדר"]}>
                  {shown.map((r) => (
                    <RosterItem key={r.id} r={r} onChanged={load} />
                  ))}
                </Rows>
                {shown.length === 0 && <p className="mt-2 text-sm text-ink-soft">אין שם שמתאים לחיפוש.</p>}
              </>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

function PasteNames({ editionId, existing, onAdded }: { editionId: number; existing: RosterEntry[]; onAdded: () => Promise<void> }) {
  const { port, notify } = useSettings();
  const { busy, run } = useAction();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const id = useId();
  // From a spreadsheet one column is read in every row — the likeliest by default, another if the admin picks it.
  const cols = useMemo(() => pasteColumns(text), [text]);
  const column = picked != null && cols.columns.some((c) => c.index === picked) ? picked : cols.best;
  const preview = useMemo(() => previewPaste(parseRosterPaste(text, column), new Set(existing.map((r) => r.name_key))), [text, column, existing]);
  const fresh = preview.filter((p) => p.status === "new").map((p) => p.name);
  const count = (s: PasteStatus) => preview.filter((p) => p.status === s).length;
  const exists = count("exists");
  const repeat = count("repeat");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    let added = 0;
    const ok = await run(
      "add",
      async () => {
        added = await port.addRoster(
          editionId,
          fresh.map((n) => ({ full_name: n.full_name, gender: n.gender })),
        );
      },
      null,
    );
    if (ok) {
      notify("ok", added === 1 ? "נוסף שם אחד לרשימה" : `נוספו ${added} שמות לרשימה`);
      setText("");
      setPicked(null);
      await onAdded();
    }
  };

  return (
    <Panel title="הוספת חניכים">
      <form onSubmit={save} className="space-y-3">
        <Field
          id={`${id}-paste`}
          label="הדבקת שמות"
          hint="שם בכל שורה. אפשר להעתיק עמודה מגיליון, גם עם עמודת מגדר (ז/נ). טלפונים ומיילים שמודבקים יחד לא נשמרים."
        >
          <textarea
            id={`${id}-paste`}
            rows={5}
            className={`${INPUT} py-2 leading-relaxed`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby={`${id}-paste-hint`}
          />
        </Field>
        {cols.columns.length > 1 && (
          <fieldset className="min-w-0">
            <legend className="mb-1 text-sm font-semibold">מאיזו עמודה לקחת את השמות?</legend>
            <div className="flex flex-wrap gap-1.5">
              {cols.columns.map((c) => (
                <label
                  key={c.index}
                  className={`inline-flex min-h-11 min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-lg border px-3 ${column === c.index ? "border-ink bg-ink/5 font-semibold" : "border-line bg-card"}`}
                >
                  <input type="radio" name={`${id}-column`} checked={column === c.index} onChange={() => setPicked(c.index)} className="accent-ink" />
                  <span className="min-w-0 truncate">
                    עמודה {c.index + 1}: {c.sample}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {preview.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm" aria-live="polite">
              <b>{fresh.length === 1 ? "שם חדש אחד" : `${fresh.length} חדשים`}</b>
              {exists > 0 && ` · ${exists === 1 ? "אחד כבר ברשימה" : `${exists} כבר ברשימה`}`}
              {repeat > 0 && ` · ${repeat === 1 ? "כפול אחד בהדבקה" : `${repeat} כפולים בהדבקה`}`}
            </p>
            <ul aria-label="תצוגה מקדימה" className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-paper">
              {preview.map((p, i) => (
                <li key={i} className={`flex min-w-0 items-center gap-2 px-3 py-1.5 ${p.status === "new" ? "" : "text-ink-soft"}`}>
                  <span className="min-w-0 flex-1 break-words">
                    {p.name.full_name}
                    {p.name.gender && <span className="text-ink-soft"> · {GENDER_LABEL[p.name.gender]}</span>}
                  </span>
                  <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button kind="primary" type="submit" busy={busy === "add"} busyLabel="מוסיף…" disabled={fresh.length === 0}>
            {fresh.length === 0 ? "הוספה לרשימה" : fresh.length === 1 ? "הוספת שם אחד" : `הוספת ${fresh.length} שמות`}
          </Button>
          {text && (
            <Button
              onClick={() => {
                setText("");
                setPicked(null);
              }}
            >
              ניקוי
            </Button>
          )}
        </div>
      </form>
    </Panel>
  );
}

function RosterItem({ r, onChanged }: { r: RosterEntry; onChanged: () => Promise<void> }) {
  const { port, wide } = useSettings();
  const { busy, run } = useAction();
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [name, setName] = useState(r.full_name);
  const [gender, setGender] = useState<Gender | null>(r.gender);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const cells = [r.full_name, r.gender ? GENDER_LABEL[r.gender] : ""];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const ok = await run("save", () => port.updateRoster(r.id, { full_name: name, gender }), "נשמר", (code) => {
      if (code !== "roster_exists" && code !== "name_required") return false;
      setProblem(errorMessage(code));
      return true;
    });
    if (ok) {
      setMode("view");
      await onChanged();
    }
  };
  const remove = async () => {
    const ok = await run("delete", () => port.deleteRoster(r.id), `${r.full_name} הוסר/ה מהרשימה`);
    if (ok) await onChanged();
  };

  if (mode === "edit") {
    return (
      <Row
        cells={cells}
        editing={
          <form onSubmit={save} className="grid gap-3 rounded-lg border border-line bg-paper p-3 sm:grid-cols-2" noValidate>
            <Field id={`${id}-name`} label="שם">
              <input id={`${id}-name`} className={INPUT} value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} />
            </Field>
            <GenderField name={`${id}-gender`} value={gender} onChange={setGender} />
            {problem && (
              <p role="alert" className="text-sm text-bad sm:col-span-2">
                {problem}
              </p>
            )}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button kind="primary" type="submit" busy={busy === "save"} busyLabel="שומר…">
                שמירה
              </Button>
              <Button
                onClick={() => {
                  setName(r.full_name);
                  setGender(r.gender);
                  setProblem(null);
                  setMode("view");
                }}
              >
                ביטול
              </Button>
              <Button kind="danger" className="ms-auto" onClick={() => setMode("delete")} aria-label={`מחיקת ${r.full_name}`}>
                מחיקה
              </Button>
            </div>
          </form>
        }
      />
    );
  }
  if (mode === "delete") {
    return (
      <Row
        cells={cells}
        editing={
          <Confirm
            text={
              <>
                למחוק את <b>{r.full_name}</b> מרשימת החניכים?
              </>
            }
            confirm="מחיקה"
            busy={busy === "delete"}
            onConfirm={() => void remove()}
            onCancel={() => setMode("view")}
          />
        }
      />
    );
  }
  return (
    <Row
      cells={cells}
      actions={
        <>
          <Button kind="quiet" onClick={() => setMode("edit")} aria-label={`עריכת ${r.full_name}`}>
            עריכה
          </Button>
          {/* on a phone «מחיקה» is inside «עריכה», so a row of ~61 stays one line */}
          {wide && (
            <Button kind="danger" onClick={() => setMode("delete")} aria-label={`מחיקת ${r.full_name}`}>
              מחיקה
            </Button>
          )}
        </>
      }
    />
  );
}
