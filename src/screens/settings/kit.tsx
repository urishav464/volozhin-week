// Small shared pieces of the settings screens: the context every tab reads,
// one way to run an action (progress → toast in Hebrew), and the form parts.
// Phone first: one column, every control at least 44px tall.
import { type ButtonHTMLAttributes, createContext, type ReactNode, type Ref, useCallback, useContext, useState } from "react";
import { CommandError } from "../../data/commands";
import type { SettingsPort } from "../../data/settings";
import type { Me } from "../../data/types";
import type { Edition, Gender } from "../../domain/types";
import { errorMessage } from "../../errors";

export interface SettingsContext {
  port: SettingsPort;
  me: Me;
  wide: boolean;
  notify: (kind: "ok" | "error", text: string) => void;
  /** Takes the last toast away — something new has started. */
  clear: () => void;
  /** Re-reads who I am (my name in the header). */
  onMeChanged: () => Promise<void> | void;
}

export const Ctx = createContext<SettingsContext | null>(null);

export function useSettings(): SettingsContext {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSettings outside SettingsScreen");
  return c;
}

/**
 * Runs one action at a time: `busy` names it (its button shows progress), a
 * success is toasted, a refusal is toasted in Hebrew — unless `onRefused`
 * handles the code itself (returns true), beside the form. A new action first
 * takes the last toast away, so an old «נשמר» never covers a new error.
 */
export function useAction() {
  const { notify, clear } = useSettings();
  return useRunner(notify, clear);
}

/** useAction outside «הגדרות» (the speaker screens): the same runner, with the screen's own toast. */
export function useRunner(notify: (kind: "ok" | "error", text: string) => void, clear: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, ok: string | null, onRefused?: (code: string | null) => boolean): Promise<boolean> => {
      clear();
      setBusy(key);
      try {
        await fn();
        if (ok) notify("ok", ok);
        return true;
      } catch (e) {
        const code = e instanceof CommandError ? e.code : null;
        if (!onRefused?.(code)) notify("error", errorMessage(code));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [notify, clear],
  );
  return { busy, run };
}

const BUTTON = {
  primary: "bg-ink text-paper hover:bg-ink/90",
  secondary: "border border-line bg-paper hover:bg-line/50",
  quiet: "text-ink-soft hover:bg-line/50 hover:text-ink",
  danger: "text-bad hover:bg-bad/10",
  dangerSolid: "bg-bad text-paper hover:bg-bad/90",
};

export function Button({
  kind = "secondary",
  busy = false,
  busyLabel = "רגע…",
  className = "",
  children,
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: keyof typeof BUTTON;
  busy?: boolean;
  busyLabel?: string;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-2.5 font-semibold sm:px-3 disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON[kind]} ${className}`}
    >
      {busy ? busyLabel : children}
    </button>
  );
}

export const INPUT = "block w-full min-h-11 rounded-lg border border-line bg-card px-3 text-base text-ink placeholder:text-ink-faint focus:border-ink";

export function Field({ id, label, hint, children }: { id: string; label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-soft">
          {hint}
        </p>
      )}
    </div>
  );
}

export const GENDER_LABEL: Record<Gender, string> = { f: "נקבה", m: "זכר" };

/** Gender is optional everywhere: «לא צוין» is a real answer, never a guess. */
export function GenderField({
  name,
  value,
  onChange,
  legend = "מגדר (לא חובה)",
  unknown = "לא צוין",
}: {
  name: string;
  value: Gender | null;
  onChange: (g: Gender | null) => void;
  legend?: string;
  unknown?: string;
}) {
  const options: [Gender | null, string][] = [
    [null, unknown],
    ["f", GENDER_LABEL.f],
    ["m", GENDER_LABEL.m],
  ];
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-sm font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([g, label]) => (
          <label key={label} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 ${value === g ? "border-ink bg-ink/5 font-semibold" : "border-line bg-card"}`}>
            <input type="radio" name={name} checked={value === g} onChange={() => onChange(g)} className="accent-ink" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Panel({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        {aside && <div className="text-sm text-ink-soft">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Loading() {
  return <p className="py-6 text-center text-ink-soft">טוען…</p>;
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-4 text-sm">
      <p className="mb-2">לא הצלחנו לטעון. אם זה חוזר, כדאי לרענן את הדף.</p>
      <Button onClick={onRetry}>לנסות שוב</Button>
    </div>
  );
}

export const KIND_LABEL: Record<Edition["kind"], string> = { real: "שבוע אמיתי", practice: "תרגול", demo: "הדגמה", archive: "ארכיון מיובא" };
export const STATUS_LABEL: Record<Edition["status"], string> = { planning: "בתכנון", active: "פעיל", archived: "בארכיון" };

/** Which edition a tab works on — a picker when there is more than one. */
export function EditionPicker({ editions, value, onChange }: { editions: Edition[]; value: number | null; onChange: (id: number) => void }) {
  if (editions.length <= 1) {
    const e = editions[0];
    return e ? <p className="text-sm text-ink-soft">מחזור: <b className="text-ink">{e.label}</b></p> : null;
  }
  return (
    <div className="flex max-w-sm items-center gap-2">
      <label htmlFor="settings-edition" className="shrink-0 text-sm font-semibold">
        מחזור
      </label>
      <select id="settings-edition" value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} className={INPUT}>
        {editions.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
            {e.status === "archived" ? " (בארכיון)" : e.kind !== "real" ? ` (${KIND_LABEL[e.kind]})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

const HeadCtx = createContext<string[]>([]);

/** Rows as a table on a wide screen and as stacked cards on a phone. */
export function Rows({ head, children, label }: { head: string[]; children: ReactNode; label: string }) {
  const { wide } = useSettings();
  if (!wide) {
    return (
      <HeadCtx.Provider value={head}>
        <ul aria-label={label} className="divide-y divide-line border-y border-line">
          {children}
        </ul>
      </HeadCtx.Provider>
    );
  }
  return (
    <table aria-label={label} className="w-full border-collapse text-start">
      <thead>
        <tr className="border-b border-line text-sm text-ink-soft">
          {head.map((h, i) => (
            <th key={i} scope="col" className="px-2 py-2 text-start font-semibold">
              {h}
            </th>
          ))}
          <th scope="col" className="px-2 py-2">
            <span className="sr-only">פעולות</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">{children}</tbody>
    </table>
  );
}

/**
 * One row: on a wide screen its cells, then the actions; on a phone the first
 * cell as the title, the rest as a line under it (`labelled`: each with its
 * column's name, where a bare value would be unclear), the actions beside the
 * title while they fit (a list of ~61 names stays short to scroll), else
 * under it. While `editing` is set, the row is that form instead. A muted row
 * (deactivated, archived) stays readable — its badge says why.
 */
export function Row({
  cells,
  actions,
  editing,
  below,
  muted = false,
  labelled = false,
}: {
  cells: ReactNode[];
  actions?: ReactNode;
  editing?: ReactNode;
  /** Something that belongs to this row, shown right under it at full width (what its action just produced). */
  below?: ReactNode;
  muted?: boolean;
  labelled?: boolean;
}) {
  const { wide } = useSettings();
  const head = useContext(HeadCtx);
  if (wide) {
    if (editing) {
      return (
        <tr>
          <td colSpan={cells.length + 1} className="px-2 py-3">
            {editing}
          </td>
        </tr>
      );
    }
    return (
      <>
        <tr className={muted ? "text-ink-soft" : ""}>
          {cells.map((c, i) => (
            <td key={i} className={`px-2 py-1.5 align-middle ${i === 0 ? "font-semibold" : ""}`}>
              {c}
            </td>
          ))}
          <td className="px-2 py-1.5">
            <div className="flex flex-wrap justify-end gap-1">{actions}</div>
          </td>
        </tr>
        {below && (
          <tr>
            <td colSpan={cells.length + 1} className="px-2 pb-3">
              {below}
            </td>
          </tr>
        )}
      </>
    );
  }
  return (
    <li className={editing ? "py-2.5" : `flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 ${muted ? "text-ink-soft" : ""}`}>
      {editing ?? (
        <>
          <div className="min-w-0 flex-1 basis-32">
            <div className="font-semibold break-words">{cells[0]}</div>
            {cells.length > 1 &&
              (labelled ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm">
                  {cells.slice(1).map((c, i) => (
                    <div key={i} className="contents">
                      <dt className="text-ink-soft">{head[i + 1]}</dt>
                      <dd className="min-w-0 break-words">{c}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-sm text-ink-soft">
                  {cells.slice(1).map((c, i) => c != null && c !== "" && <span key={i} className="min-w-0 break-all">{c}</span>)}
                </div>
              ))}
          </div>
          {actions && <div className="flex max-w-full shrink-0 flex-wrap gap-1">{actions}</div>}
          {below && <div className="w-full basis-full pb-1.5">{below}</div>}
        </>
      )}
    </li>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "ok" | "muted" | "bad" }) {
  const t = {
    neutral: "bg-line/60 text-ink",
    accent: "bg-accent-soft text-ink",
    ok: "bg-ok/10 text-ok",
    muted: "bg-line/40 text-ink-soft",
    bad: "bg-bad/10 text-bad",
  }[tone];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${t}`}>{children}</span>;
}

/** An inline «are you sure?» inside a row — no dialog to lose on a phone. */
export function Confirm({
  text,
  confirm,
  cancel = "ביטול",
  onConfirm,
  onCancel,
  busy,
  danger = true,
}: {
  text: ReactNode;
  confirm: string;
  /** The way back — another word where «ביטול» would read as the action itself (revoking a link). */
  cancel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <div role="group" aria-label="אישור" className="rounded-lg border border-line bg-paper p-3">
      <p className="mb-2 text-sm">{text}</p>
      <div className="flex flex-wrap gap-2">
        {/* focus lands on the safe choice when the action destroys something */}
        <Button kind={danger ? "dangerSolid" : "primary"} busy={busy} onClick={onConfirm} autoFocus={!danger}>
          {confirm}
        </Button>
        <Button onClick={onCancel} autoFocus={danger}>
          {cancel}
        </Button>
      </div>
    </div>
  );
}
