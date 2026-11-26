// The driver of an approved transport, on the board and on the lesson page (the reset, phase 3): the driver's name, phone
// and «סודר» — set_transport_driver's half of the details only (never the pickup, which is the handler's; never before
// the approval, when the database refuses it: neither screen offers it then). Only what changed is sent; cleaned first,
// as the database cleans (cleanTransportDriver: a phone of at least six digits), so a refusal is said beside its field.
// v20 — two suggestion lists (lanes.ts driverSuggestions; the owner's «הצעה: נהג/ת מהמשמרת»): «במשמרת בשעת האיסוף»
// (a click fills «שם הנהג/ת») and «אחריות של מכינה» (a click fills «צוות מכינת X — איש/אשת קשר: Y» and — only for whom
// app.may_see_rota_contacts lets read it, fetched on that click, one call — the contact's phone into «טלפון הנהג/ת»).
// A pick only fills the fields: typing by hand stays, and nothing is sent before «שמירה».
import { type FormEvent, useId, useMemo, useRef, useState } from "react";
import { CommandError, type TransportDriverPatch } from "../../data/commands";
import type { DataPort } from "../../data/port";
import { isCohortContact } from "../../data/rota";
import { cleanTransportDriver, STAGE_LIMITS } from "../../data/stageRules";
import { fmt, fmtRange, nightLabel } from "../../domain/time";
import type { TransportDetails } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Button, Field, INPUT } from "../settings/kit";
import { Problem } from "../stages/parts";
import { type CohortPick, type DriverSuggestions, driverPatch } from "./lanes";

/** Once «סודר», the escort's link shows the driver — said where it is marked. */
export const ARRANGED_NOTE = "כשמסמנים «סודר», דף המלווה מציג את השם והטלפון של הנהג/ת.";

/** What the form suggests: the lists (null while the rota loads), whether the rota failed, and the contact's phone for whom may read it. */
export interface DriverSuggest {
  lists: DriverSuggestions | null;
  failed?: boolean;
  /** Only where app.may_see_rota_contacts would give any (maySeeRotaContacts): a cohort's contact's phone, read on the click. */
  phoneFor?: (cohortId: number) => Promise<string | null>;
}

/**
 * A cohort's contact's phone, read when a cohort is picked — one port.rota.contacts call per click, nothing kept: only
 * while `allowed` (maySeeRotaContacts ≡ app.may_see_rota_contacts; the database decides again, row by row), else none.
 */
export function useCohortPhone(port: DataPort, editionId: number, allowed: boolean): DriverSuggest["phoneFor"] {
  return useMemo(
    () =>
      allowed
        ? async (cohortId: number) => {
            const rows = await port.rota.contacts(editionId);
            return rows.filter(isCohortContact).find((r) => r.cohort_id === cohortId)?.phone ?? null;
          }
        : undefined,
    [port, editionId, allowed],
  );
}

export function DriverForm({
  label,
  d,
  busy,
  onSave,
  onClose,
  suggest,
}: {
  /** Whose transport (the speaker, or the lesson's title) — the form's name for a screen reader. */
  label: string;
  d: Pick<TransportDetails, "driver_name" | "driver_phone" | "arranged">;
  busy: boolean;
  /** Sends the patch (set_transport_driver); `onRefused` keeps a field's refusal beside the field. */
  onSave: (patch: TransportDriverPatch, onRefused: (code: string | null) => boolean) => Promise<boolean>;
  /** Closes the form (saved, nothing to save, or «ביטול»). */
  onClose: () => void;
  /** v20: who could drive (the board, the lesson page). */
  suggest?: DriverSuggest;
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
      {suggest && <Suggestions suggest={suggest} onName={setName} onPhone={setPhone} />}
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

/** Would «שמירה» take this as the driver's phone (cleanTransportDriver: one line, at least six digits)? */
function phoneOk(phone: string): boolean {
  try {
    cleanTransportDriver({ driver_phone: phone });
    return true;
  } catch {
    return false;
  }
}

const PICK = "inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-navy/40 bg-card px-3 text-start text-sm font-semibold text-navy break-words hover:bg-accent-soft";

/** The two lists; a pick fills the fields, and a line says what it filled (read out, the focus stays on the pick). */
function Suggestions({ suggest, onName, onPhone }: { suggest: DriverSuggest; onName: (v: string) => void; onPhone: (v: string) => void }) {
  const id = useId();
  const [said, setSaid] = useState("");
  const last = useRef(0);
  const { lists, failed, phoneFor } = suggest;
  const pickCohort = async (c: CohortPick) => {
    const n = ++last.current;
    onName(c.fill);
    if (!phoneFor) return setSaid(`מולא שם הנהג/ת: ${c.fill}. את הטלפון מקלידים.`);
    setSaid(`מולא שם הנהג/ת: ${c.fill}. טוען את הטלפון של איש/אשת הקשר…`);
    try {
      const phone = await phoneFor(c.cohort.id);
      if (n !== last.current) return;
      if (!phone) return setSaid(`מולא שם הנהג/ת. לאיש/אשת הקשר של ${c.cohort.name} לא שמור טלפון — אפשר להקליד.`);
      // only what «שמירה» would take (a phone of at least six digits, as the database cleans it)
      if (!phoneOk(phone)) return setSaid(`מולא שם הנהג/ת. הטלפון השמור של איש/אשת הקשר של ${c.cohort.name} לא נראה כמו מספר טלפון — אפשר להקליד.`);
      onPhone(phone);
      setSaid(`מולאו השם והטלפון של איש/אשת הקשר של ${c.cohort.name}.`);
    } catch {
      if (n === last.current) setSaid("מולא שם הנהג/ת. לא הצלחנו לטעון את הטלפון — אפשר להקליד.");
    }
  };
  const at = lists?.at;
  const night = at ? nightLabel(at.day, at.min) : null;
  return (
    <div role="group" aria-labelledby={`${id}-title`} data-driver-suggestions className="space-y-2 rounded-lg border border-line bg-card p-3">
      <p id={`${id}-title`} className="text-sm font-bold text-ink">
        הצעות — לחיצה ממלאת את הפרטים, ואפשר גם להקליד
      </p>
      {lists == null ? (
        <p className="text-sm text-ink-soft">{failed ? "לא הצלחנו לטעון את משמרות הצוות והמכינות. אפשר להקליד." : "טוען הצעות…"}</p>
      ) : at == null ? (
        <p className="text-sm text-ink-soft">אין שעת איסוף, ולכן אין הצעות.</p>
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-sm font-semibold">
              במשמרת בשעת האיסוף{" "}
              <span className="font-normal text-ink-soft">
                (<bdi dir="ltr">{fmt(at.min)}</bdi>
                {night ? `, ${night}` : ""} עד תחילת השיעור)
              </span>
            </p>
            {lists.staff.length === 0 ? (
              <p className="text-sm text-ink-soft">אין אנשי צוות במשמרת בשעות האלה.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {lists.staff.map((p) => (
                  <li key={p.shift.id} className="min-w-0">
                    <button
                      type="button"
                      data-suggest-staff={p.shift.id}
                      className={PICK}
                      onClick={() => {
                        last.current++;
                        onName(p.who.slice(0, STAGE_LIMITS.driver_name));
                        setSaid(`מולא שם הנהג/ת: ${p.who}.`);
                      }}
                    >
                      <span className="min-w-0">{p.who}</span>
                      <bdi dir="ltr" className="text-xs font-normal text-ink-soft tabular-nums">
                        {fmtRange(p.shift.start_min, p.shift.end_min)}
                      </bdi>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">
              אחריות של מכינה <span className="font-normal text-ink-soft">(מכינות שהצוות שלהן יכול להסיע ונמצאות בקמפוס במשמרת הזו)</span>
            </p>
            {lists.cohorts.length === 0 ? (
              <p className="text-sm text-ink-soft">אין מכינה כזו במשמרת הזו.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {lists.cohorts.map((c) => (
                  <li key={c.cohort.id} className="min-w-0">
                    <button type="button" data-suggest-cohort={c.cohort.id} className={PICK} onClick={() => void pickCohort(c)}>
                      <span className="min-w-0">{c.fill}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      <p role="status" className="text-xs text-ink-soft empty:hidden">
        {said}
      </p>
    </div>
  );
}
