// «זמינות» on the speaker page (the reset, phase 2): «יכול/ה רק ביומיים, 17:00–19:00» in seconds. Per day of the week
// «לא ידוע» · «כל היום» · «רק בשעות…» · «לא יכול/ה», and for «רק בשעות…» up to three from–to pairs (or one of the
// edition's shifts at a tap). Before saving, «מה יישמר»: each slot of the days that changed and what it will be — a
// slot counts only if one range covers it whole. One save is ONE set_availability_ranges call for those days
// (src/domain/rangesForm.ts); the slot-by-slot grid stays below, behind «דיוק לפי משבצת» (SpeakerScreen.tsx).
import { useId, useMemo, useRef, useState } from "react";
import type { AvailabilityRange } from "../../domain/availability";
import { byGender } from "../../domain/names";
import { daySpan, type DayForm, type DayMode, formMatchesSlots, MAX_PAIRS, previewOf, rangesCall, rangesFormOf, type RangesForm, shiftPresets } from "../../domain/rangesForm";
import { DAYS, DAY_NAMES, type Day, fmtRange } from "../../domain/time";
import type { Speaker, Week } from "../../domain/types";
import { Button, CHOICE_OFF, CHOICE_ON, useFocusRescue } from "../settings/kit";

const MODES: readonly DayMode[] = ["unknown", "all", "hours", "cannot"];

/** The kit's CHOICE, a little tighter on a phone, where the four modes of a day are two by two. */
const MODE_CHIP = "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-sm sm:gap-2 sm:px-3 sm:text-base";

const TIME = "min-h-11 w-28 rounded-lg border border-line bg-card px-2 text-base tabular-nums text-ink hover:border-ink-faint focus:border-navy disabled:bg-paper-light";

/** A mode's words, about the speaker (their gender). */
function modeLabel(m: DayMode, s: Speaker): string {
  switch (m) {
    case "unknown":
      return "לא ידוע";
    case "all":
      return "כל היום";
    case "hours":
      return "רק בשעות…";
    case "cannot":
      return byGender(s.gender, "לא יכול", "לא יכולה");
  }
}

const verdictText = (kind: "can" | "cannot" | null, s: Speaker) => (kind === "can" ? byGender(s.gender, "יכול", "יכולה") : kind === "cannot" ? "לא" : "לא ידוע");
const VERDICT_TONE = { can: "border-ok/50 bg-ok/10 text-ok", cannot: "border-bad/40 bg-bad/10 text-bad", none: "border-line bg-card text-ink-soft" };

export function RangesEditor({
  week,
  speaker: s,
  canEdit,
  onSave,
}: {
  week: Week;
  speaker: Speaker;
  canEdit: boolean;
  /** The one call; false when it was refused (the form stays as typed). */
  onSave: (days: Day[], ranges: AvailabilityRange[]) => Promise<boolean>;
}) {
  const id = useId();
  const { rows, edition } = week;
  const slots = useMemo(() => week.slotAvailability.filter((v) => v.speaker_id === s.id), [week.slotAvailability, s.id]);
  const initial = useMemo(() => rangesFormOf(rows, edition, slots), [rows, edition, slots]);
  // null: nothing changed here — the form is what the slots say (and follows them when they change elsewhere)
  const [draft, setDraft] = useState<RangesForm | null>(null);
  const [busy, setBusy] = useState(false);
  const form = draft ?? initial;
  const call = useMemo(() => rangesCall(rows, edition, initial, form), [rows, edition, initial, form]);
  const preview = useMemo(() => previewOf(rows, edition, call.days, call.ranges), [rows, edition, call]);
  const days = DAYS.filter((d) => form[d] != null);
  const blocked = Object.keys(call.problems).length > 0;

  const setDay = (day: Day, f: DayForm) => setDraft({ ...(draft ?? initial), [day]: f });
  // «מה יישמר» goes with what it showed (saved, or the changes taken back), and its buttons with it: the focus to the
  // choice of the first day that changed
  const root = useRef<HTMLDivElement>(null);
  const rescue = useFocusRescue();
  const backTo = (day: Day | undefined) => rescue(() => root.current?.querySelector<HTMLElement>(`[data-ranges-day="${day}"] input:checked`) ?? root.current?.querySelector<HTMLElement>("input:checked"));
  const save = async () => {
    if (blocked || call.days.length === 0) return;
    const first = call.days[0];
    setBusy(true);
    const ok = await onSave(call.days, call.ranges);
    setBusy(false);
    if (ok) setDraft(null);
    backTo(first);
  };
  const discard = () => {
    const first = call.days[0];
    setDraft(null);
    backTo(first);
  };

  if (days.length === 0) return <p className="text-sm text-ink-soft">אין במחזור הזה שורות שיעור לסמן בהן זמינות.</p>;

  return (
    <div ref={root} className="space-y-4">
      <ul aria-label="זמינות לפי ימים" className="divide-y divide-line/70 border-y border-line/70">
        {days.map((day) => {
          const f = form[day]!;
          const span = daySpan(rows, edition, day)!;
          const touched = call.days.includes(day);
          const problem = touched ? call.problems[day] : undefined;
          const finer = !touched && !formMatchesSlots(rows, edition, day, f, slots);
          return (
            <li key={day} data-ranges-day={day} className="grid gap-2 py-3 md:grid-cols-[6rem_1fr]">
              <div className="font-bold text-navy">
                יום {DAY_NAMES[day]}
                <span className="block text-xs font-normal text-ink-soft tabular-nums">
                  <bdi dir="ltr">{fmtRange(span.start, span.end)}</bdi>
                </span>
              </div>
              <div className="min-w-0 space-y-2">
                {canEdit ? (
                  <fieldset className="min-w-0">
                    <legend className="sr-only">יום {DAY_NAMES[day]}</legend>
                    <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap">
                      {MODES.map((m) => (
                        <label key={m} className={`${MODE_CHIP} ${f.mode === m ? CHOICE_ON : CHOICE_OFF}`}>
                          <input
                            type="radio"
                            name={`${id}-d${day}`}
                            checked={f.mode === m}
                            onChange={() => setDay(day, { mode: m, pairs: m === "hours" && f.pairs.length === 0 ? [{ from: "", to: "" }] : f.pairs })}
                            className="accent-navy"
                          />
                          {modeLabel(m, s)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : (
                  <p className="text-sm">
                    {modeLabel(f.mode, s)}
                    {f.mode === "hours" && f.pairs.length > 0 && (
                      <>
                        {": "}
                        {f.pairs.map((p, i) => (
                          <bdi key={i} dir="ltr" className="me-2 tabular-nums">
                            {p.from}–{p.to}
                          </bdi>
                        ))}
                      </>
                    )}
                  </p>
                )}
                {canEdit && f.mode === "hours" && <Pairs id={`${id}-d${day}`} day={day} form={f} presets={shiftPresets(edition, span)} onChange={(next) => setDay(day, next)} />}
                {problem && (
                  <p role="alert" className="text-sm font-bold text-bad">
                    {problem}
                  </p>
                )}
                {finer && <p className="text-xs text-ink-soft">הסימון של היום הזה מפורט יותר: הוא מופיע ב«דיוק לפי משבצת».</p>}
              </div>
            </li>
          );
        })}
      </ul>

      {canEdit && call.days.length > 0 && (
        <section aria-label="מה יישמר" className="space-y-2 rounded-xl bg-sand-soft p-3">
          <h4 className="font-bold text-navy">מה יישמר</h4>
          <p className="text-xs text-ink-soft">משבצת נחשבת רק אם הטווח מכסה את כולה.</p>
          {call.days.map((day) => {
            const noted = slots.some((v) => v.day === day && v.note);
            return (
              <div key={day} className="space-y-1">
                <p className="text-sm font-bold">יום {DAY_NAMES[day]}</p>
                {call.problems[day] ? (
                  <p className="text-sm text-bad">{call.problems[day]}</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {preview
                      .filter((x) => x.day === day)
                      .map((x) => (
                        <li
                          key={x.row.id}
                          data-preview-slot={`${day}:${x.row.id}`}
                          data-kind={x.kind ?? "none"}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${VERDICT_TONE[x.kind ?? "none"]}`}
                        >
                          <bdi dir="ltr" className="tabular-nums">
                            {fmtRange(x.row.start_min, x.row.end_min)}
                          </bdi>
                          <span className="font-bold">{verdictText(x.kind, s)}</span>
                        </li>
                      ))}
                  </ul>
                )}
                {noted && <p className="text-xs text-ink-soft">בשמירה יימחקו ההערות של יום {DAY_NAMES[day]}.</p>}
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button kind="primary" disabled={blocked} busy={busy} busyLabel="שומר…" onClick={() => void save()}>
              שמירת הזמינות
            </Button>
            <Button onClick={discard} disabled={busy}>
              ביטול השינויים
            </Button>
          </div>
        </section>
      )}
      {!canEdit && <p className="text-xs text-ink-soft">צפייה בלבד: את הזמינות מסמנים צוות התוכן והמדריך/ה.</p>}
    </div>
  );
}

/** «רק בשעות…»: the day's pairs — «מ־» and «עד», «הסרה», «+ עוד טווח», and the shifts as quick pairs. */
function Pairs({ id, day, form, presets, onChange }: { id: string; day: Day; form: DayForm; presets: { label: string; from: string; to: string }[]; onChange: (f: DayForm) => void }) {
  const pairs = form.pairs;
  const set = (i: number, p: Partial<{ from: string; to: string }>) => onChange({ ...form, pairs: pairs.map((x, k) => (k === i ? { ...x, ...p } : x)) });
  const full = pairs.length >= MAX_PAIRS;
  // a preset fills the one empty pair, else adds a pair
  const preset = (p: { from: string; to: string }) => {
    const empty = pairs.findIndex((x) => !x.from && !x.to);
    if (empty >= 0) set(empty, p);
    else if (!full) onChange({ ...form, pairs: [...pairs, { from: p.from, to: p.to }] });
  };
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {pairs.map((p, i) => (
          <li key={i} className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="mb-0.5 block font-bold">מ־</span>
              <input type="time" step={300} dir="ltr" value={p.from} onChange={(e) => set(i, { from: e.target.value })} className={TIME} aria-label={`יום ${DAY_NAMES[day]}, טווח ${i + 1}: מ־`} id={`${id}-p${i}-from`} />
            </label>
            <label className="text-sm">
              <span className="mb-0.5 block font-bold">עד</span>
              <input type="time" step={300} dir="ltr" value={p.to} onChange={(e) => set(i, { to: e.target.value })} className={TIME} aria-label={`יום ${DAY_NAMES[day]}, טווח ${i + 1}: עד`} id={`${id}-p${i}-to`} />
            </label>
            {pairs.length > 1 && (
              <Button kind="quiet" className="text-sm" onClick={() => onChange({ ...form, pairs: pairs.filter((_, k) => k !== i) })} aria-label={`הסרת טווח ${i + 1} של יום ${DAY_NAMES[day]}`}>
                הסרה
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-1.5">
        {!full && (
          <Button kind="quiet" className="text-sm" onClick={() => onChange({ ...form, pairs: [...pairs, { from: "", to: "" }] })}>
            + עוד טווח
          </Button>
        )}
        {(!full || pairs.some((x) => !x.from && !x.to)) &&
          presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => preset(p)}
              className="inline-flex min-h-11 items-center gap-1 rounded-full border border-dashed border-line bg-card px-3 text-xs text-ink-soft transition-colors hover:border-navy/50 hover:bg-accent-soft hover:text-navy pointer-fine:sm:min-h-8"
              aria-label={`${p.label}: ${p.from}–${p.to}`}
            >
              {p.label}{" "}
              <bdi dir="ltr" className="tabular-nums">
                {p.from}–{p.to}
              </bdi>
            </button>
          ))}
      </div>
    </div>
  );
}
