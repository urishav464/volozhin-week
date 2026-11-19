// The driver of an approved transport, on the board (the reset, phase 3): the driver's name, phone and «סודר» —
// set_transport_driver's half of the details only (never the pickup, which is the handler's; never before the approval,
// when the database refuses it: the board does not offer it then). Only what changed is sent; cleaned first, as the
// database cleans (cleanTransportDriver: a phone of at least six digits), so a refusal is said beside its field.
import { type FormEvent, useId, useState } from "react";
import { CommandError, type TransportDriverPatch } from "../../data/commands";
import { cleanTransportDriver, STAGE_LIMITS } from "../../data/stageRules";
import type { TransportDetails } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Button, Field, INPUT } from "../settings/kit";
import { Problem } from "../stages/parts";
import { driverPatch } from "./lanes";

/** Once «סודר», the escort's link shows the driver — said where it is marked. */
export const ARRANGED_NOTE = "כשמסמנים «סודר», דף המלווה מציג את השם והטלפון של הנהג/ת.";

export function DriverForm({
  label,
  d,
  busy,
  onSave,
  onClose,
}: {
  /** Whose transport (the speaker, or the lesson's title) — the form's name for a screen reader. */
  label: string;
  d: Pick<TransportDetails, "driver_name" | "driver_phone" | "arranged">;
  busy: boolean;
  /** Sends the patch (set_transport_driver); `onRefused` keeps a field's refusal beside the field. */
  onSave: (patch: TransportDriverPatch, onRefused: (code: string | null) => boolean) => Promise<boolean>;
  /** Closes the form (saved, nothing to save, or «ביטול»). */
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(d.driver_name ?? "");
  const [phone, setPhone] = useState(d.driver_phone ?? "");
  const [arranged, setArranged] = useState(d.arranged);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const patch = driverPatch(d, { name, phone, arranged });
    if (Object.keys(patch).length === 0) return onClose();
    try {
      cleanTransportDriver(patch);
    } catch (err) {
      setProblem(errorMessage(err instanceof CommandError ? err.code : "bad_value"));
      return;
    }
    const ok = await onSave(patch, (code) => {
      if (code !== "bad_phone" && code !== "bad_value") return false;
      setProblem(errorMessage(code));
      return true;
    });
    if (ok) onClose();
  };
  return (
    <form onSubmit={(e) => void submit(e)} aria-label={`עריכת הנהג/ת: ${label}`} className="space-y-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-name`} label="שם הנהג/ת">
          <input id={`${id}-name`} value={name} maxLength={STAGE_LIMITS.driver_name} onChange={(e) => setName(e.target.value)} className={INPUT} autoComplete="off" autoFocus />
        </Field>
        <Field id={`${id}-phone`} label="טלפון הנהג/ת">
          <input
            id={`${id}-phone`}
            type="tel"
            inputMode="tel"
            dir="ltr"
            value={phone}
            maxLength={40}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : undefined}
            className={INPUT}
            autoComplete="off"
          />
        </Field>
      </div>
      <div>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
          <input type="checkbox" checked={arranged} onChange={(e) => setArranged(e.target.checked)} className="size-5 accent-navy" />
          סודר
        </label>
        <p className="text-xs text-ink-soft">{ARRANGED_NOTE}</p>
      </div>
      {problem && <Problem id={`${id}-problem`}>{problem}</Problem>}
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" type="submit" busy={busy} busyLabel="שומר…">
          שמירה
        </Button>
        <Button onClick={onClose}>ביטול</Button>
      </div>
    </form>
  );
}
