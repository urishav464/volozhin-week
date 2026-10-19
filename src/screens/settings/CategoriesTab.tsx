// «קטגוריות» — the study categories, shared by every year (global admin).
// A category some lesson uses is deactivated rather than deleted
// (categories_guard), so last year's grid keeps its colours.
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import type { Category } from "../../domain/types";
import { errorMessage } from "../../errors";
import { PALETTE, colorName } from "../../settings/palette";
import { Badge, Button, Confirm, Field, INPUT, LoadError, Loading, Panel, Row, Rows, useAction, useSettings } from "./kit";

export function CategoriesTab() {
  const { port } = useSettings();
  const [list, setList] = useState<Category[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { busy, run } = useAction();

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setList(await port.categories());
    } catch {
      setFailed(true);
    }
  }, [port]);
  useEffect(() => void load(), [load]);

  if (failed) return <LoadError onRetry={() => void load()} />;
  if (!list) return <Loading />;

  const move = async (c: Category, by: -1 | 1) => {
    const ids = list.map((x) => x.id);
    const i = ids.indexOf(c.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    if (await run(`move-${c.id}`, () => port.reorderCategories(ids), "הסדר נשמר")) await load();
  };

  return (
    <>
      <Panel title="קטגוריות" aside={`${list.filter((c) => c.active).length} פעילות · לכל השנים`}>
        <p className="mb-3 text-sm text-ink-soft">הקטגוריה שייכת לשיעור, וצבעה מסמן אותו ברשת. קטגוריה שיש בה שיעורים משביתים — היא נשארת בשיעורים של שנים קודמות.</p>
        <Rows label="קטגוריות" head={["קטגוריה", "צבע", "מצב"]}>
          {list.map((c, i) => (
            <CategoryItem key={c.id} c={c} first={i === 0} last={i === list.length - 1} moving={busy === `move-${c.id}`} onMove={(by) => void move(c, by)} onChanged={load} />
          ))}
        </Rows>
      </Panel>
      <AddCategory taken={new Set(list.map((c) => c.color))} onAdded={load} />
    </>
  );
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-4 shrink-0 rounded-full border border-ink/10 align-[-2px]" style={{ background: color }} />;
}

/** A radio group of the palette's colours — names for screen readers, a ring for the chosen one. */
function ColorField({ name, value, onChange, taken }: { name: string; value: string; onChange: (c: string) => void; taken?: Set<string> }) {
  const options = PALETTE.some((p) => p.color === value) || !value ? PALETTE : [{ color: value, name: "הצבע הנוכחי" }, ...PALETTE];
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-sm font-semibold">צבע</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((p) => (
          <label
            key={p.color}
            title={p.name}
            className={`relative inline-flex size-11 cursor-pointer items-center justify-center rounded-full border-2 ${value === p.color ? "border-ink" : "border-transparent"} has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent`}
          >
            <input type="radio" name={name} value={p.color} checked={value === p.color} onChange={() => onChange(p.color)} className="sr-only" aria-label={`${p.name}${taken?.has(p.color) ? " (כבר בשימוש)" : ""}`} />
            <span aria-hidden className="size-8 rounded-full" style={{ background: p.color }} />
            {value === p.color && (
              <span aria-hidden className="absolute text-sm font-bold text-paper">
                ✓
              </span>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CategoryItem({ c, first, last, moving, onMove, onChanged }: { c: Category; first: boolean; last: boolean; moving: boolean; onMove: (by: -1 | 1) => void; onChanged: () => Promise<void> }) {
  const { port } = useSettings();
  const { busy, run } = useAction();
  const [mode, setMode] = useState<"view" | "edit" | "delete" | "used">("view");
  const [name, setName] = useState(c.name);
  const [color, setColor] = useState(c.color);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const cells = [
    <span className="inline-flex items-center gap-2">
      <Swatch color={c.color} />
      {c.name}
    </span>,
    colorName(c.color),
    c.active ? "" : <Badge tone="muted">מושבתת</Badge>,
  ];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const ok = await run("save", () => port.updateCategory(c.id, { name, color }), "נשמר", (code) => {
      if (code !== "category_exists" && code !== "name_required" && code !== "bad_value") return false;
      setProblem(errorMessage(code));
      return true;
    });
    if (ok) {
      setMode("view");
      await onChanged();
    }
  };
  const setActive = async (active: boolean) => {
    const ok = await run("active", () => port.updateCategory(c.id, { active }), active ? `«${c.name}» פעילה שוב` : `«${c.name}» הושבתה`);
    if (ok) {
      setMode("view");
      await onChanged();
    }
  };
  const remove = async () => {
    const ok = await run("delete", () => port.deleteCategory(c.id), `«${c.name}» נמחקה`, (code) => {
      if (code !== "category_in_use") return false;
      setMode("used");
      return true;
    });
    if (ok) await onChanged();
  };

  if (mode === "edit") {
    return (
      <Row
        cells={cells}
        editing={
          <form onSubmit={save} className="grid gap-3 rounded-lg border border-line bg-paper p-3" noValidate>
            <Field id={`${id}-name`} label="שם">
              <input id={`${id}-name`} className={`${INPUT} max-w-sm`} value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />
            </Field>
            <ColorField name={`${id}-color`} value={color} onChange={setColor} />
            {problem && (
              <p role="alert" className="text-sm text-bad">
                {problem}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button kind="primary" type="submit" busy={busy === "save"} busyLabel="שומר…">
                שמירה
              </Button>
              <Button
                onClick={() => {
                  setName(c.name);
                  setColor(c.color);
                  setProblem(null);
                  setMode("view");
                }}
              >
                ביטול
              </Button>
            </div>
          </form>
        }
      />
    );
  }
  if (mode === "delete" || mode === "used") {
    return (
      <Row
        cells={cells}
        editing={
          mode === "delete" ? (
            <Confirm
              text={
                <>
                  למחוק את הקטגוריה <b>{c.name}</b>? אפשר רק כשאין בה אף שיעור.
                </>
              }
              confirm="מחיקה"
              busy={busy === "delete"}
              onConfirm={() => void remove()}
              onCancel={() => setMode("view")}
            />
          ) : c.active ? (
            <Confirm text={errorMessage("category_in_use")} confirm="השבתה" danger={false} busy={busy === "active"} onConfirm={() => void setActive(false)} onCancel={() => setMode("view")} />
          ) : (
            <div role="group" aria-label="אישור" className="rounded-lg border border-line bg-paper p-3 text-sm">
              <p className="mb-2">יש שיעורים בקטגוריה הזו, והיא כבר מושבתת. היא נשארת בשיעורים הקיימים.</p>
              <Button onClick={() => setMode("view")}>הבנתי</Button>
            </div>
          )
        }
      />
    );
  }
  return (
    <Row
      muted={!c.active}
      cells={cells}
      actions={
        <>
          <Button kind="quiet" disabled={first || moving} onClick={() => onMove(-1)} aria-label={`הזזת ${c.name} למעלה`} title="למעלה">
            ↑
          </Button>
          <Button kind="quiet" disabled={last || moving} onClick={() => onMove(1)} aria-label={`הזזת ${c.name} למטה`} title="למטה">
            ↓
          </Button>
          <Button kind="quiet" onClick={() => setMode("edit")} aria-label={`עריכת ${c.name}`}>
            עריכה
          </Button>
          <Button kind="quiet" busy={busy === "active"} onClick={() => void setActive(!c.active)} aria-label={`${c.active ? "השבתת" : "הפעלת"} ${c.name}`}>
            {c.active ? "השבתה" : "הפעלה"}
          </Button>
          <Button kind="danger" onClick={() => setMode("delete")} aria-label={`מחיקת ${c.name}`}>
            מחיקה
          </Button>
        </>
      }
    />
  );
}

function AddCategory({ taken, onAdded }: { taken: Set<string>; onAdded: () => Promise<void> }) {
  const { port } = useSettings();
  const { busy, run } = useAction();
  const [name, setName] = useState("");
  const [color, setColor] = useState(() => (PALETTE.find((p) => !taken.has(p.color)) ?? PALETTE[0]).color);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const shown = name.trim();
    const ok = await run("add", () => port.addCategory({ name, color }), `הקטגוריה «${shown}» נוספה`, (code) => {
      if (code !== "category_exists" && code !== "name_required" && code !== "bad_value") return false;
      setProblem(errorMessage(code));
      return true;
    });
    if (ok) {
      setName("");
      await onAdded();
    }
  };
  return (
    <Panel title="הוספת קטגוריה">
      <form onSubmit={submit} className="grid gap-3" noValidate>
        <Field id={`${id}-name`} label="שם">
          <input id={`${id}-name`} className={`${INPUT} max-w-sm`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ColorField name={`${id}-color`} value={color} onChange={setColor} taken={taken} />
        {problem && (
          <p role="alert" className="text-sm text-bad">
            {problem}
          </p>
        )}
        <div>
          <Button kind="primary" type="submit" busy={busy === "add"} busyLabel="מוסיף…" disabled={!name.trim()}>
            הוספה
          </Button>
        </div>
      </form>
    </Panel>
  );
}
