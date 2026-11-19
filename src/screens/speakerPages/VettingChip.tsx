// The instructor's approval as a small chip in the speaker page's header (the reset, phase 2: not a section of its
// own). Approved is the normal case: a quiet green chip; waiting or rejected says so in amber or red. A global admin
// opens the vetting form from the chip itself (VetForm, src/screens/speakers/sheetParts.tsx).
import { useId, useState } from "react";
import type { Speaker } from "../../domain/types";
import { vettingLabel } from "../../lib/labels";
import { VetForm } from "../speakers/sheetParts";
import type { Actor } from "../weekStore";

const TONE: Record<Speaker["vetted"], string> = {
  approved: "border-emerald-300 bg-emerald-50 text-emerald-900",
  pending: "border-amber-300 bg-amber-50 text-amber-900",
  rejected: "border-red-300 bg-red-50 text-red-800",
};

export function VettingChip({
  s,
  actor,
  nameOf,
  busy,
  onVet,
}: {
  s: Speaker;
  actor: Actor;
  nameOf: (id: number | null) => string;
  busy: string | null;
  onVet: (state: Speaker["vetted"], note: string | null) => Promise<boolean>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const label = vettingLabel(s.vetted, s.gender);
  const by = s.vetted !== "pending" && s.vetted_by != null ? nameOf(s.vetted_by) : null;
  const title = [by, s.vetted_note && `«${s.vetted_note}»`].filter(Boolean).join(" · ") || undefined;
  const chip = `inline-flex items-center gap-1 rounded-full border px-2.5 text-xs font-bold ${TONE[s.vetted]}`;
  if (!actor.global) {
    return (
      <span data-vetting={s.vetted} title={title} className={`${chip} py-0.5`}>
        {label}
      </span>
    );
  }
  return (
    <>
      <button type="button" data-vetting={s.vetted} aria-expanded={open} aria-controls={`${id}-vet`} title={title} onClick={() => setOpen((x) => !x)} className={`${chip} min-h-11 pointer-fine:sm:min-h-8`}>
        {label} <span aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div id={`${id}-vet`} role="group" aria-label="אישור המדריך/ה" className="w-full basis-full rounded-xl border border-line bg-paper-light p-3">
          <VetForm
            startOpen
            s={s}
            actor={actor}
            nameOf={nameOf}
            busy={busy}
            onVet={async (st, note) => {
              const ok = await onVet(st, note);
              if (ok) setOpen(false);
              return ok;
            }}
          />
        </div>
      )}
    </>
  );
}
