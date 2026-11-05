// What the «לוגיסטיקה ← תורנויות» views share (milestone 7, schema v16): the loaded rota and who may do what in it, one
// way to run a write (its toast, then the rota read again — it is never in Realtime), the problems a form says itself,
// and the small parts every view draws with. The rota is direct writes under RLS (CONTRACT «תורנויות»): the port cleans
// every value first (src/data/rota.ts), so a refusal comes back as a code, said in Hebrew beside the form.
import { type ReactNode } from "react";
import type { DataPort } from "../../../data/port";
import type { RotaData } from "../../../data/rota";
import { codeOf } from "../../../domain/rota";
import type { Week } from "../../../domain/types";
import { errorMessage } from "../../../errors";
import type { Notify } from "../../speakers/parts";

/** Runs a write: progress on its button (`key`), a toast, the rota read again — after a refusal too. */
export type Act = (key: string, fn: () => Promise<unknown>, ok: string | null, onRefused?: (code: string | null) => boolean) => Promise<boolean>;

export interface RotaCtx {
  port: DataPort;
  week: Week;
  data: RotaData;
  /** app.may_write_rota: the edition's admins, its logistics team while it is not archived. */
  mayWrite: boolean;
  /** An admin of the edition: the shifts' cuts and names (set_rota_shifts). */
  isAdmin: boolean;
  /** maySeeRotaContacts: the heads' phones may be shown here, behind their switch. */
  phonesAllowed: boolean;
  busy: string | null;
  act: Act;
  notify: Notify;
  /** Re-reads the week (the shifts live in the edition's settings). */
  reloadWeek: () => Promise<void>;
}

/** The codes a rota form says beside itself (anything else is the screen's toast). */
export const FORM_CODES = new Set(["name_required", "bad_value", "rota_letter_taken", "rota_group_taken", "rota_duty_exists", "rota_contact_in_text", "bad_phone", "in_use", "outside_week", "rota_group_busy"]);

/** onRefused for a form: its own codes into `set`, the rest left to the toast. */
export function formRefusal(set: (text: string | null) => void, words: Partial<Record<string, string>> = {}) {
  return (code: string | null) => {
    if (!code || !FORM_CODES.has(code)) return false;
    set(words[code] ?? errorMessage(code));
    return true;
  };
}

/** A form's problem line, read out when it appears. */
export function Problem({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-bad">
      {children}
    </p>
  );
}

/** A group's code by id in the loaded rota («א1»). */
export function codeById(data: Pick<RotaData, "cohorts" | "groups">, id: number): string {
  const g = data.groups.find((x) => x.id === id);
  return g ? codeOf(data, g) : "?";
}

/** A whole number from a field: empty → null; anything else that is not one → NaN (the port's cleaner refuses it as bad_value). */
export function intOrNull(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

/** A card of the rota views: a line of the list, the brand's card. */
export const CARD = "rounded-xl border border-line bg-card p-3 shadow-sm";
